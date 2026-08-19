import { PrismaClient } from "../generated/client/index.js";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { logger } from "../logger.js";
import { ConflictError, NotFoundError, ValidationError } from "../lib/app-error.js";
import {
  DEFAULT_MAX_RETRIES,
  classifyResponseStatus,
  classifyTransportError,
  decideRetry,
  parseRetryAfterMs,
  type DeadLetterReason,
  type DeliveryStatus,
  type FailureKind,
} from "../lib/webhook-retry.js";

const prisma = new PrismaClient();

export interface WebhookPayload {
  eventType: string;
  streamId?: string | null;
  splitId?: string | null;
  txHash: string;
  sender?: string;
  receiver?: string;
  amount?: string;
  totalAmount?: string;
  asset?: string;
  timestamp: string;
  [key: string]: unknown;
}

const WEBHOOK_REPLAY_WINDOW_MS = 5 * 60 * 1000;
const DELIVERY_TIMEOUT_MS = 10_000;

/** Deliveries claimed per processing tick. */
const DELIVERY_BATCH_SIZE = 100;

/** Concurrent in-flight HTTP requests per tick. */
const DELIVERY_CONCURRENCY = 10;

/**
 * A claim older than this is treated as abandoned (worker crashed mid-flight)
 * and returned to the queue. Comfortably above DELIVERY_TIMEOUT_MS so a slow
 * receiver is never double-dispatched.
 */
const STALE_CLAIM_MS = 5 * 60 * 1000;

/** Truncation bound for receiver error text persisted on the delivery row. */
const MAX_ERROR_LENGTH = 1_000;

// ─── Dashboard types ─────────────────────────────────────────────────────────

export interface DeliveryRecord {
  id: string;
  webhookId: string;
  webhookUrl?: string;
  eventType: string;
  status: DeliveryStatus;
  attempts: number;
  maxRetries: number;
  nextRetryAt: Date | null;
  lastError: string | null;
  lastStatusCode: number | null;
  lastAttemptAt: Date | null;
  deliveredAt: Date | null;
  deadLetteredAt: Date | null;
  deadLetterReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListDeliveriesFilters {
  status?: DeliveryStatus;
  webhookId?: string;
  eventType?: string;
  limit?: number;
  offset?: number;
}

export interface ListDeliveriesResult {
  deliveries: DeliveryRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface DeliveryStats {
  counts: Record<DeliveryStatus, number>;
  total: number;
  deadLetterByReason: Record<string, number>;
  dueNow: number;
  oldestPendingAt: Date | null;
  successRate: number;
}

export interface RetryResult {
  retried: number;
  deliveryIds: string[];
}

interface ClaimedDelivery {
  id: string;
  webhookId: string;
  attempts: number;
  maxRetries: number;
  payload: unknown;
  /** Null only if the receiver was deleted between claim and send. */
  webhook: { id: string; url: string; secretKey: string } | null;
}

interface AttemptOutcome {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  failureKind: FailureKind;
  retryAfterMs: number | null;
}

export class WebhookDispatcherService {
  /** Identifies this process when claiming deliveries. */
  private readonly workerId = `${process.pid}-${randomUUID()}`;

  /**
   * Register a new webhook for external developers
   */
  async registerWebhook(
    url: string,
    eventType: string = "*",
    description?: string
  ): Promise<{ id: string; secretKey: string }> {
    const secretKey = this.generateSecretKey();

    const webhook = await (prisma as any).webhook.create({
      data: {
        url,
        eventType,
        description,
        secretKey,
        isActive: true,
      },
    });

    logger.info(`Webhook registered: ${webhook.id} for ${eventType} events`);
    return { id: webhook.id, secretKey };
  }

  /**
   * Rotate the signing secret for a registered webhook receiver.
   * The new secret is returned once and should be stored by the receiver.
   */
  async rotateWebhookSecret(webhookId: string): Promise<{ id: string; secretKey: string }> {
    const secretKey = this.generateSecretKey();

    const webhook = await (prisma as any).webhook.update({
      where: { id: webhookId },
      data: { secretKey },
      select: { id: true },
    });

    logger.info(`Webhook secret rotated: ${webhook.id}`);
    return { id: webhook.id, secretKey };
  }

  /**
   * Dispatch event to all matching webhooks with retry logic
   */
  async dispatch(payload: WebhookPayload): Promise<void> {
    try {
      const webhooks = await (prisma as any).webhook.findMany({
        where: {
          isActive: true,
          OR: [
            { eventType: "*" },
            { eventType: payload.eventType },
          ],
        },
      });

      if (webhooks.length === 0) return;

      for (const webhook of webhooks) {
        await this.createDeliveryRecord(webhook.id, payload);
      }

      // Process deliveries asynchronously
      this.processDeliveries().catch((err) =>
        logger.error("Error processing webhook deliveries", err)
      );
    } catch (error) {
      logger.error("Failed to dispatch webhooks", error);
    }
  }

  /**
   * Create a delivery record for retry processing
   */
  private async createDeliveryRecord(
    webhookId: string,
    payload: WebhookPayload
  ): Promise<void> {
    await (prisma as any).webhookDelivery.create({
      data: {
        webhookId,
        eventType: payload.eventType,
        payload,
        status: "pending",
        attempts: 0,
        maxRetries: DEFAULT_MAX_RETRIES,
        nextRetryAt: new Date(),
      },
    });
  }

  // ─── Delivery processing ───────────────────────────────────────────────────

  /**
   * Claim and deliver every due webhook delivery.
   *
   * Rows are claimed with a conditional updateMany before any HTTP request is
   * made, so overlapping worker ticks (or several API instances) can run this
   * concurrently without delivering the same event twice.
   */
  async processDeliveries(): Promise<void> {
    await this.reclaimStaleDeliveries();

    const claimed = await this.claimDueDeliveries();
    if (claimed.length === 0) return;

    for (let i = 0; i < claimed.length; i += DELIVERY_CONCURRENCY) {
      const batch = claimed.slice(i, i + DELIVERY_CONCURRENCY);

      // One delivery blowing up (a DB hiccup while recording the outcome) must
      // not abandon the rest of the batch. Rows left claimed are picked back up
      // by reclaimStaleDeliveries.
      await Promise.all(
        batch.map((delivery) =>
          this.attemptDelivery(delivery).catch((error) =>
            logger.error("Unhandled webhook delivery failure", error, {
              deliveryId: delivery.id,
            }),
          ),
        ),
      );
    }
  }

  /**
   * Return deliveries whose claim outlived STALE_CLAIM_MS to the queue. Without
   * this a worker crash would strand rows in `delivering` forever.
   */
  private async reclaimStaleDeliveries(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_CLAIM_MS);

    const { count } = await (prisma as any).webhookDelivery.updateMany({
      where: { status: "delivering", lockedAt: { lt: cutoff } },
      data: {
        status: "pending",
        lockedAt: null,
        lockedBy: null,
        nextRetryAt: new Date(),
      },
    });

    if (count > 0) {
      logger.warn(`Reclaimed ${count} stale webhook deliveries`);
    }

    return count;
  }

  private async claimDueDeliveries(): Promise<ClaimedDelivery[]> {
    const candidates = await (prisma as any).webhookDelivery.findMany({
      where: {
        status: "pending",
        nextRetryAt: { lte: new Date() },
      },
      select: { id: true },
      orderBy: { nextRetryAt: "asc" },
      take: DELIVERY_BATCH_SIZE,
    });

    if (candidates.length === 0) return [];

    const candidateIds = candidates.map((row: { id: string }) => row.id);
    const claimedAt = new Date();

    // The `status: "pending"` predicate is what makes the claim exclusive: a
    // racing worker that selected the same ids updates zero rows here.
    const { count } = await (prisma as any).webhookDelivery.updateMany({
      where: { id: { in: candidateIds }, status: "pending" },
      data: { status: "delivering", lockedAt: claimedAt, lockedBy: this.workerId },
    });

    if (count === 0) return [];

    return (prisma as any).webhookDelivery.findMany({
      where: {
        id: { in: candidateIds },
        status: "delivering",
        lockedBy: this.workerId,
      },
      include: { webhook: true },
    });
  }

  /**
   * Attempt to deliver a webhook with HMAC signature
   */
  private async attemptDelivery(delivery: ClaimedDelivery): Promise<void> {
    const webhook = delivery.webhook;

    // A delivery whose webhook row vanished can never succeed. The FK makes
    // this unreachable in practice, but the queue must not spin on it.
    if (!webhook) {
      await this.deadLetter(
        { id: delivery.id, webhookId: delivery.webhookId, attempts: delivery.attempts },
        "non_retryable_response",
        { statusCode: null, error: "Webhook receiver no longer exists" },
      );
      return;
    }

    const outcome = await this.sendWebhook(webhook, delivery.payload);
    const attempts = delivery.attempts + 1;
    const now = new Date();

    if (outcome.ok) {
      await (prisma as any).webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "success",
          attempts,
          lastAttemptAt: now,
          lastStatusCode: outcome.statusCode,
          lastError: null,
          nextRetryAt: null,
          deliveredAt: now,
          lockedAt: null,
          lockedBy: null,
        },
      });
      logger.info(`Webhook delivered: ${webhook.id}`, {
        deliveryId: delivery.id,
        attempts,
      });
      return;
    }

    const decision = decideRetry({
      attempts,
      maxRetries: delivery.maxRetries,
      failureKind: outcome.failureKind,
      retryAfterMs: outcome.retryAfterMs,
    });

    if (decision.action === "dead_letter") {
      await this.deadLetter(
        { id: delivery.id, webhookId: delivery.webhookId, attempts },
        decision.reason,
        { statusCode: outcome.statusCode, error: outcome.error },
      );
      return;
    }

    const nextRetryAt = new Date(now.getTime() + decision.delayMs);

    await (prisma as any).webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "pending",
        attempts,
        nextRetryAt,
        lastAttemptAt: now,
        lastStatusCode: outcome.statusCode,
        lastError: outcome.error,
        lockedAt: null,
        lockedBy: null,
      },
    });

    logger.warn(`Webhook delivery failed, retry scheduled`, {
      deliveryId: delivery.id,
      webhookId: webhook.id,
      attempts,
      maxRetries: delivery.maxRetries,
      delayMs: decision.delayMs,
      nextRetryAt: nextRetryAt.toISOString(),
      statusCode: outcome.statusCode,
      error: outcome.error,
    });
  }

  /** Perform the signed HTTP POST and classify the result. */
  private async sendWebhook(
    webhook: { id: string; url: string; secretKey: string },
    payload: unknown,
  ): Promise<AttemptOutcome> {
    const body = JSON.stringify(payload);
    const timestamp = new Date().toISOString();
    const nonce = this.generateNonce();
    const signature = this.signPayload(body, webhook.secretKey, timestamp, nonce);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    try {
      const response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-StellarStream-Signature": signature,
          "X-StellarStream-Timestamp": timestamp,
          "X-StellarStream-Nonce": nonce,
          "X-Nebula-Signature": signature,
          "X-Webhook-Signature": signature,
          "X-Webhook-ID": webhook.id,
          "User-Agent": "StellarStream-Webhook/1.0",
        },
        body,
        signal: controller.signal,
      });

      if (response.ok) {
        return {
          ok: true,
          statusCode: response.status,
          error: null,
          failureKind: "retryable",
          retryAfterMs: null,
        };
      }

      const failureKind = classifyResponseStatus(response.status);

      return {
        ok: false,
        statusCode: response.status,
        error: truncate(`HTTP ${response.status}`),
        failureKind,
        retryAfterMs:
          failureKind === "retryable"
            ? parseRetryAfterMs(response.headers?.get?.("retry-after"))
            : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        statusCode: null,
        error: truncate(message),
        failureKind: classifyTransportError(),
        retryAfterMs: null,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Move a delivery into the dead letter queue. */
  private async deadLetter(
    delivery: { id: string; webhookId: string; attempts: number },
    reason: DeadLetterReason,
    outcome: { statusCode: number | null; error: string | null },
  ): Promise<void> {
    const now = new Date();

    await (prisma as any).webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "dead_letter",
        attempts: delivery.attempts,
        nextRetryAt: null,
        lastAttemptAt: now,
        lastStatusCode: outcome.statusCode,
        lastError: outcome.error,
        deadLetteredAt: now,
        deadLetterReason: reason,
        lockedAt: null,
        lockedBy: null,
      },
    });

    logger.error("Webhook delivery dead lettered", {
      deliveryId: delivery.id,
      webhookId: delivery.webhookId,
      attempts: delivery.attempts,
      reason,
      statusCode: outcome.statusCode,
      error: outcome.error,
    });
  }

  // ─── Retry dashboard ───────────────────────────────────────────────────────

  /** Paginated delivery listing backing the retry dashboard. */
  async listDeliveries(filters: ListDeliveriesFilters = {}): Promise<ListDeliveriesResult> {
    const limit = clampLimit(filters.limit);
    const offset = Math.max(0, Math.floor(filters.offset ?? 0));

    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.webhookId) where.webhookId = filters.webhookId;
    if (filters.eventType) where.eventType = filters.eventType;

    const [rows, total] = await Promise.all([
      (prisma as any).webhookDelivery.findMany({
        where,
        include: { webhook: { select: { url: true } } },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      (prisma as any).webhookDelivery.count({ where }),
    ]);

    return {
      deliveries: rows.map(toDeliveryRecord),
      total,
      limit,
      offset,
    };
  }

  async getDelivery(deliveryId: string): Promise<DeliveryRecord & { payload: unknown }> {
    const row = await (prisma as any).webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { webhook: { select: { url: true } } },
    });

    if (!row) {
      throw new NotFoundError("WebhookDelivery", deliveryId);
    }

    return { ...toDeliveryRecord(row), payload: row.payload };
  }

  /** Aggregate counters for the dashboard header. */
  async getDeliveryStats(): Promise<DeliveryStats> {
    const [grouped, deadLetterGrouped, dueNow, oldestPending] = await Promise.all([
      (prisma as any).webhookDelivery.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      (prisma as any).webhookDelivery.groupBy({
        by: ["deadLetterReason"],
        where: { status: "dead_letter" },
        _count: { _all: true },
      }),
      (prisma as any).webhookDelivery.count({
        where: { status: "pending", nextRetryAt: { lte: new Date() } },
      }),
      (prisma as any).webhookDelivery.findFirst({
        where: { status: "pending" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);

    const counts: Record<DeliveryStatus, number> = {
      pending: 0,
      delivering: 0,
      success: 0,
      dead_letter: 0,
    };

    let total = 0;
    for (const row of grouped as { status: string; _count: { _all: number } }[]) {
      const count = row._count._all;
      total += count;
      if (row.status in counts) {
        counts[row.status as DeliveryStatus] = count;
      }
    }

    const deadLetterByReason: Record<string, number> = {};
    for (const row of deadLetterGrouped as {
      deadLetterReason: string | null;
      _count: { _all: number };
    }[]) {
      deadLetterByReason[row.deadLetterReason ?? "unknown"] = row._count._all;
    }

    const settled = counts.success + counts.dead_letter;

    return {
      counts,
      total,
      deadLetterByReason,
      dueNow,
      oldestPendingAt: oldestPending?.createdAt ?? null,
      successRate: settled === 0 ? 0 : counts.success / settled,
    };
  }

  // ─── Manual retry ──────────────────────────────────────────────────────────

  /**
   * Requeue a dead lettered delivery for immediate re-delivery.
   *
   * The attempt counter is preserved for audit, so `maxRetries` is extended by
   * a fresh allowance — otherwise the requeued row would be dead lettered again
   * on its first failure.
   */
  async retryDelivery(
    deliveryId: string,
    options: { extraAttempts?: number } = {},
  ): Promise<DeliveryRecord> {
    const extraAttempts = options.extraAttempts ?? DEFAULT_MAX_RETRIES;

    const existing = await (prisma as any).webhookDelivery.findUnique({
      where: { id: deliveryId },
    });

    if (!existing) {
      throw new NotFoundError("WebhookDelivery", deliveryId);
    }

    if (existing.status === "delivering") {
      throw new ConflictError("Delivery is currently in flight and cannot be retried", {
        details: { deliveryId, status: existing.status },
      });
    }

    if (existing.status === "success") {
      throw new ConflictError("Delivery already succeeded and cannot be retried", {
        details: { deliveryId, status: existing.status },
      });
    }

    const updated = await (prisma as any).webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "pending",
        nextRetryAt: new Date(),
        maxRetries: existing.attempts + extraAttempts,
        deadLetteredAt: null,
        deadLetterReason: null,
        lockedAt: null,
        lockedBy: null,
      },
      include: { webhook: { select: { url: true } } },
    });

    logger.info("Webhook delivery manually requeued", {
      deliveryId,
      attempts: existing.attempts,
      maxRetries: updated.maxRetries,
    });

    return toDeliveryRecord(updated);
  }

  /**
   * Bulk requeue. Pass explicit ids, or a webhookId to drain that receiver's
   * entire dead letter queue.
   */
  async retryDeadLetterQueue(
    selector: { deliveryIds?: string[]; webhookId?: string; limit?: number } = {},
  ): Promise<RetryResult> {
    const { deliveryIds, webhookId } = selector;
    const limit = clampLimit(selector.limit);

    if (!deliveryIds?.length && !webhookId) {
      throw new ValidationError("Provide deliveryIds or webhookId to retry");
    }

    const where: Record<string, unknown> = { status: "dead_letter" };
    if (deliveryIds?.length) where.id = { in: deliveryIds };
    if (webhookId) where.webhookId = webhookId;

    const targets = await (prisma as any).webhookDelivery.findMany({
      where,
      select: { id: true },
      take: limit,
    });

    if (targets.length === 0) {
      return { retried: 0, deliveryIds: [] };
    }

    const ids: string[] = targets.map((row: { id: string }) => row.id);

    // Requeued rows keep their attempt history; retryDelivery tops the retry
    // allowance up per row so each gets a full fresh budget.
    const results = await Promise.all(
      ids.map((id: string): Promise<string | null> =>
        this.retryDelivery(id).then(
          () => id,
          (error: unknown) => {
            logger.warn("Failed to requeue webhook delivery", { deliveryId: id, error });
            return null;
          },
        ),
      ),
    );

    const requeued = results.filter((id: string | null): id is string => id !== null);

    logger.info(`Requeued ${requeued.length} dead lettered webhook deliveries`);

    return { retried: requeued.length, deliveryIds: requeued };
  }

  // ─── Signing ───────────────────────────────────────────────────────────────

  /**
   * Generate HMAC-SHA256 signature
   */
  static signPayload(
    payload: string,
    secretKey: string,
    timestamp: string,
    nonce: string
  ): string {
    const signedPayload = `${timestamp}.${nonce}.${payload}`;
    const digest = createHmac("sha256", secretKey).update(signedPayload).digest("hex");
    return `sha256=${digest}`;
  }

  private signPayload(
    payload: string,
    secretKey: string,
    timestamp: string,
    nonce: string
  ): string {
    return WebhookDispatcherService.signPayload(payload, secretKey, timestamp, nonce);
  }

  /**
   * Generate a secure random secret key
   */
  private generateSecretKey(): string {
    return randomBytes(32).toString("hex");
  }

  private generateNonce(): string {
    return randomBytes(16).toString("hex");
  }

  /**
   * Verify webhook signature (for receiver validation)
   */
  static verifySignature(
    payload: string,
    signature: string,
    secretKey: string,
    timestamp: string,
    nonce: string,
    now: Date = new Date()
  ): boolean {
    const signedAt = Date.parse(timestamp);

    if (!Number.isFinite(signedAt) || !nonce) {
      return false;
    }

    const ageMs = Math.abs(now.getTime() - signedAt);
    if (ageMs > WEBHOOK_REPLAY_WINDOW_MS) {
      return false;
    }

    const expected = WebhookDispatcherService.signPayload(
      payload,
      secretKey,
      timestamp,
      nonce
    );
    const actualSignature = signature.startsWith("sha256=")
      ? signature
      : `sha256=${signature}`;

    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actualSignature);

    return (
      expectedBuffer.length === actualBuffer.length &&
      timingSafeEqual(expectedBuffer, actualBuffer)
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(value: string): string {
  return value.length > MAX_ERROR_LENGTH ? value.slice(0, MAX_ERROR_LENGTH) : value;
}

function clampLimit(limit: number | undefined, fallback = 50, max = 200): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(1, Math.floor(limit)), max);
}

function toDeliveryRecord(row: Record<string, any>): DeliveryRecord {
  return {
    id: row.id,
    webhookId: row.webhookId,
    webhookUrl: row.webhook?.url,
    eventType: row.eventType,
    status: row.status,
    attempts: row.attempts,
    maxRetries: row.maxRetries,
    nextRetryAt: row.nextRetryAt ?? null,
    lastError: row.lastError ?? null,
    lastStatusCode: row.lastStatusCode ?? null,
    lastAttemptAt: row.lastAttemptAt ?? null,
    deliveredAt: row.deliveredAt ?? null,
    deadLetteredAt: row.deadLetteredAt ?? null,
    deadLetterReason: row.deadLetterReason ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
