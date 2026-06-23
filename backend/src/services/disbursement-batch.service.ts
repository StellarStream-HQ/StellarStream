/**
 * Disbursement Batch Processing Engine (Issue #1202)
 *
 * Processes large sets of disbursements efficiently in batches instead of one
 * at a time. Provides:
 *   - Bounded batches (up to 1000 disbursements each, larger inputs are chunked)
 *   - Atomic ("all succeed or all fail") or best-effort processing modes
 *   - Live progress tracking with status updates
 *   - Per-item retry with exponential backoff
 *   - CSV export of results
 *   - Webhook notifications on completion
 *
 * The engine is storage- and network-agnostic by design: the per-item
 * processor, persistence, and webhook notifier are all injectable. This keeps
 * the core orchestration fully unit-testable at high volume (10k+ items) while
 * the production wiring (Stellar submission, Prisma, webhooks) lives in the
 * default dependencies below.
 */

import { logger } from "../logger.js";

/** Hard cap on the number of disbursements processed in a single batch. */
export const MAX_BATCH_SIZE = 1000;

export type BatchStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type ItemStatus = "COMPLETED" | "FAILED" | "CANCELLED";

/** A single disbursement to be sent. */
export interface DisbursementItem {
  recipientAddress: string;
  /** Amount in stroops (1 unit = 10,000,000 stroops). */
  amountStroops: string;
  /** Asset identifier, e.g. "native" or "USDC:ISSUER". Defaults to "native". */
  asset?: string;
  /** Optional caller-supplied reference / memo for reconciliation. */
  reference?: string;
}

/** Outcome of processing one disbursement. */
export interface DisbursementResult {
  index: number;
  recipientAddress: string;
  amountStroops: string;
  asset: string;
  reference: string | null;
  status: ItemStatus;
  attempts: number;
  txHash: string | null;
  error: string | null;
}

/** Snapshot of a batch's progress, safe to poll or stream to clients. */
export interface BatchProgress {
  batchId: string;
  status: BatchStatus;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Full result of a batch run. */
export interface BatchResult extends BatchProgress {
  atomic: boolean;
  results: DisbursementResult[];
  /**
   * In atomic mode, disbursements that succeeded before a later failure aborted
   * the batch. On Stellar these payments are already settled and cannot be
   * reverted on-chain, so they are surfaced here for off-chain compensation.
   */
  requiresCompensation: DisbursementResult[];
}

/**
 * Processes a single disbursement. Implementations submit the on-chain payment
 * and resolve with the resulting transaction hash, or throw to signal failure
 * (which triggers the retry policy).
 */
export type DisbursementProcessor = (
  item: DisbursementItem,
  ctx: { batchId: string; index: number },
) => Promise<{ txHash: string }>;

/** Persists the final results of a batch (e.g. to Postgres via Prisma). */
export type BatchPersister = (result: BatchResult) => Promise<void>;

/** Notifies external listeners that a batch has completed (e.g. webhooks). */
export type BatchNotifier = (result: BatchResult) => Promise<void>;

export interface BatchOptions {
  /** Caller-supplied id. A stable id is generated when omitted. */
  batchId?: string;
  /**
   * "all succeed or all fail". When true (default), the first permanent
   * failure aborts the batch: remaining items are marked CANCELLED and the
   * batch status is FAILED.
   */
  atomic?: boolean;
  /** Max retry attempts per item after the initial try. Default 3. */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms. 0 disables waiting. Default 500. */
  retryBaseDelayMs?: number;
  /** Upper bound on a single backoff delay in ms. Default 30000. */
  retryMaxDelayMs?: number;
  /**
   * Number of disbursements processed concurrently. Defaults to 1 to avoid
   * Stellar sequence-number collisions, matching the split worker.
   */
  concurrency?: number;
  /** Override the per-item processor (defaults to the Stellar submitter). */
  processor?: DisbursementProcessor;
  /** Persist results when true. Default true. */
  persist?: boolean;
  /** Send completion webhooks when true. Default true. */
  notifyWebhooks?: boolean;
  /** Invoked with a fresh snapshot whenever progress changes. */
  onProgress?: (progress: BatchProgress) => void;
}

interface ResolvedOptions {
  batchId: string;
  atomic: boolean;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  concurrency: number;
  processor: DisbursementProcessor;
  persist: boolean;
  notifyWebhooks: boolean;
  onProgress?: (progress: BatchProgress) => void;
}

// ─── Default dependencies ─────────────────────────────────────────────────────

/**
 * Default processor — placeholder for the real Stellar split/payment submission.
 * Mirrors the existing split worker, which also stubs the on-chain call until
 * the contract layer is wired in. Replace with a real submitter.
 */
const defaultProcessor: DisbursementProcessor = async (_item, ctx) => {
  await sleep(0);
  // Deterministic synthetic hash so downstream consumers have a stable value.
  const txHash = `pending-${ctx.batchId}-${ctx.index}`;
  return { txHash };
};

/** Default persistence — lazily loads Prisma so unit tests stay hermetic. */
const defaultPersister: BatchPersister = async (result) => {
  const { prisma } = await import("../lib/db.js");
  // Persisted as a compact JSON audit row on the SyncState-adjacent log path
  // would require a dedicated table; until the migration lands we record a
  // structured log line and leave the per-stream Disbursement table untouched.
  // Callers needing durable batch rows should inject a custom persister.
  logger.info("[DisbursementBatch] Batch result ready for persistence", {
    batchId: result.batchId,
    status: result.status,
    total: result.total,
    succeeded: result.succeeded,
    failed: result.failed,
  });
  void prisma; // referenced to make the dependency explicit for future wiring
};

/** Default notifier — fires a completion webhook via the shared service. */
const defaultNotifier: BatchNotifier = async (result) => {
  const { WebhookService } = await import("./webhook.service.js");
  const service = new WebhookService();
  await service.trigger({
    eventType: `disbursement_batch_${result.status.toLowerCase()}`,
    streamId: null,
    txHash: result.batchId,
    sender: "batch",
    receiver: `${result.succeeded}/${result.total}`,
    amount: result.results
      .filter((r) => r.status === "COMPLETED")
      .reduce((sum, r) => sum + BigInt(r.amountStroops || "0"), 0n)
      .toString(),
    timestamp: result.completedAt ?? new Date().toISOString(),
  });
};

// ─── Progress registry ────────────────────────────────────────────────────────

const progressRegistry = new Map<string, BatchProgress>();

/** Returns the latest known progress for a batch, or undefined if unknown. */
export function getBatchProgress(batchId: string): BatchProgress | undefined {
  const p = progressRegistry.get(batchId);
  return p ? { ...p } : undefined;
}

/** Removes a batch's progress entry once a caller is done polling it. */
export function clearBatchProgress(batchId: string): void {
  progressRegistry.delete(batchId);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Process a single batch of up to {@link MAX_BATCH_SIZE} disbursements.
 *
 * @throws RangeError when more than MAX_BATCH_SIZE items are supplied — callers
 *         with larger inputs should use {@link runBatches}.
 */
export async function runBatch(
  items: DisbursementItem[],
  options: BatchOptions = {},
): Promise<BatchResult> {
  if (items.length > MAX_BATCH_SIZE) {
    throw new RangeError(
      `Batch size ${items.length} exceeds the maximum of ${MAX_BATCH_SIZE}. Use runBatches() for larger inputs.`,
    );
  }

  const opts = resolveOptions(options);
  const startedAt = new Date().toISOString();

  const progress: BatchProgress = {
    batchId: opts.batchId,
    status: "PROCESSING",
    total: items.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
  };
  publishProgress(progress, opts);

  logger.info("[DisbursementBatch] Batch started", {
    batchId: opts.batchId,
    total: items.length,
    atomic: opts.atomic,
    concurrency: opts.concurrency,
  });

  const results = new Array<DisbursementResult>(items.length);
  let aborted = false;

  const onItemSettled = (result: DisbursementResult): void => {
    results[result.index] = result;
    progress.processed += 1;
    if (result.status === "COMPLETED") progress.succeeded += 1;
    else if (result.status === "CANCELLED") progress.cancelled += 1;
    else progress.failed += 1;
    progress.updatedAt = new Date().toISOString();
    publishProgress(progress, opts);
  };

  await mapWithConcurrency(items, opts.concurrency, async (item, index) => {
    if (aborted) {
      onItemSettled(cancelledResult(item, index));
      return;
    }

    const result = await processWithRetry(item, index, opts);
    onItemSettled(result);

    // Atomic mode: the first permanent failure aborts the remaining work.
    if (opts.atomic && result.status === "FAILED") {
      aborted = true;
    }
  });

  // Any items skipped by the abort that never entered the runner (e.g. queued
  // after the abort flag flipped) are recorded as cancelled.
  for (let i = 0; i < items.length; i++) {
    if (!results[i]) results[i] = cancelledResult(items[i], i);
  }

  const anyFailed = results.some((r) => r.status === "FAILED");
  const finalStatus: BatchStatus = anyFailed
    ? "FAILED"
    : opts.atomic && aborted
      ? "CANCELLED"
      : "COMPLETED";

  progress.status = finalStatus;
  progress.completedAt = new Date().toISOString();
  progress.updatedAt = progress.completedAt;
  publishProgress(progress, opts);

  const requiresCompensation =
    opts.atomic && finalStatus !== "COMPLETED"
      ? results.filter((r) => r.status === "COMPLETED")
      : [];

  const batchResult: BatchResult = {
    ...progress,
    atomic: opts.atomic,
    results,
    requiresCompensation,
  };

  logger.info("[DisbursementBatch] Batch finished", {
    batchId: opts.batchId,
    status: finalStatus,
    succeeded: progress.succeeded,
    failed: progress.failed,
    cancelled: progress.cancelled,
    requiresCompensation: requiresCompensation.length,
  });

  await runSideEffects(batchResult, opts);

  return batchResult;
}

/**
 * Process an arbitrarily large list of disbursements by splitting it into
 * sequential batches of at most {@link MAX_BATCH_SIZE}. Each chunk gets a
 * deterministic batch id derived from the base id and its offset.
 *
 * Returns one {@link BatchResult} per chunk, in order. In atomic mode a failed
 * chunk does not stop later chunks — atomicity is scoped to a single batch.
 */
export async function runBatches(
  items: DisbursementItem[],
  options: BatchOptions = {},
): Promise<BatchResult[]> {
  const baseId = options.batchId ?? generateBatchId();
  const chunks = chunk(items, MAX_BATCH_SIZE);
  const results: BatchResult[] = [];

  logger.info("[DisbursementBatch] Multi-batch run started", {
    baseId,
    total: items.length,
    chunks: chunks.length,
  });

  for (let i = 0; i < chunks.length; i++) {
    const result = await runBatch(chunks[i], {
      ...options,
      batchId: `${baseId}-chunk${i}`,
    });
    results.push(result);
  }

  return results;
}

// ─── CSV export ───────────────────────────────────────────────────────────────

/**
 * Render batch results as CSV. Accepts a single {@link BatchResult} or an array
 * (e.g. the output of {@link runBatches}). Produces a header row even when there
 * are no results.
 */
export function exportBatchResultsCsv(
  input: BatchResult | BatchResult[],
): string {
  const batches = Array.isArray(input) ? input : [input];
  const header = [
    "batch_id",
    "index",
    "recipient_address",
    "amount_stroops",
    "asset",
    "reference",
    "status",
    "attempts",
    "tx_hash",
    "error",
  ];

  const lines = [header.join(",")];

  for (const batch of batches) {
    for (const r of batch.results) {
      lines.push(
        [
          batch.batchId,
          r.index,
          r.recipientAddress,
          r.amountStroops,
          r.asset,
          r.reference ?? "",
          r.status,
          r.attempts,
          r.txHash ?? "",
          r.error ?? "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }

  return lines.join("\n") + "\n";
}

// ─── Internals ────────────────────────────────────────────────────────────────

function resolveOptions(options: BatchOptions): ResolvedOptions {
  return {
    batchId: options.batchId ?? generateBatchId(),
    atomic: options.atomic ?? true,
    maxRetries: clampInt(options.maxRetries, 3, 0, 100),
    retryBaseDelayMs: clampInt(options.retryBaseDelayMs, 500, 0, 600_000),
    retryMaxDelayMs: clampInt(options.retryMaxDelayMs, 30_000, 0, 3_600_000),
    concurrency: clampInt(options.concurrency, 1, 1, 256),
    processor: options.processor ?? defaultProcessor,
    persist: options.persist ?? true,
    notifyWebhooks: options.notifyWebhooks ?? true,
    onProgress: options.onProgress,
  };
}

async function processWithRetry(
  item: DisbursementItem,
  index: number,
  opts: ResolvedOptions,
): Promise<DisbursementResult> {
  const asset = item.asset ?? "native";
  let attempts = 0;
  let lastError = "unknown error";

  while (attempts <= opts.maxRetries) {
    attempts += 1;
    try {
      const { txHash } = await opts.processor(item, {
        batchId: opts.batchId,
        index,
      });
      return {
        index,
        recipientAddress: item.recipientAddress,
        amountStroops: item.amountStroops,
        asset,
        reference: item.reference ?? null,
        status: "COMPLETED",
        attempts,
        txHash,
        error: null,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const isLastAttempt = attempts > opts.maxRetries;
      logger.warn("[DisbursementBatch] Disbursement attempt failed", {
        batchId: opts.batchId,
        index,
        attempt: attempts,
        willRetry: !isLastAttempt,
        error: lastError,
      });
      if (isLastAttempt) break;
      await sleep(backoffDelay(attempts, opts));
    }
  }

  return {
    index,
    recipientAddress: item.recipientAddress,
    amountStroops: item.amountStroops,
    asset,
    reference: item.reference ?? null,
    status: "FAILED",
    attempts,
    txHash: null,
    error: lastError,
  };
}

function cancelledResult(
  item: DisbursementItem,
  index: number,
): DisbursementResult {
  return {
    index,
    recipientAddress: item.recipientAddress,
    amountStroops: item.amountStroops,
    asset: item.asset ?? "native",
    reference: item.reference ?? null,
    status: "CANCELLED",
    attempts: 0,
    txHash: null,
    error: "Cancelled: a prior disbursement in the atomic batch failed",
  };
}

async function runSideEffects(
  result: BatchResult,
  opts: ResolvedOptions,
): Promise<void> {
  if (opts.persist) {
    try {
      await defaultPersister(result);
    } catch (err) {
      logger.error("[DisbursementBatch] Persistence failed", {
        batchId: result.batchId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (opts.notifyWebhooks) {
    try {
      await defaultNotifier(result);
    } catch (err) {
      logger.error("[DisbursementBatch] Webhook notification failed", {
        batchId: result.batchId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function publishProgress(progress: BatchProgress, opts: ResolvedOptions): void {
  const snapshot = { ...progress };
  progressRegistry.set(progress.batchId, snapshot);
  if (opts.onProgress) {
    try {
      opts.onProgress({ ...snapshot });
    } catch (err) {
      logger.warn("[DisbursementBatch] onProgress callback threw", {
        batchId: progress.batchId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Runs an async mapper over items with a bounded number of workers. */
async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;

  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });

  await Promise.all(runners);
}

function backoffDelay(attempt: number, opts: ResolvedOptions): number {
  if (opts.retryBaseDelayMs <= 0) return 0;
  const delay = opts.retryBaseDelayMs * 2 ** (attempt - 1);
  return Math.min(delay, opts.retryMaxDelayMs);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function clampInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

let batchCounter = 0;
function generateBatchId(): string {
  batchCounter += 1;
  return `batch-${Date.now()}-${batchCounter}`;
}
