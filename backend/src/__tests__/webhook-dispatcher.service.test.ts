import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { deliveryTable, webhookTable } = vi.hoisted(() => ({
  deliveryTable: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  webhookTable: {
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("../generated/client/index.js", () => ({
  PrismaClient: class {
    webhookDelivery = deliveryTable;
    webhook = webhookTable;
  },
}));

vi.mock("../logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: vi.fn(),
  },
}));

import { WebhookDispatcherService } from "../services/webhook-dispatcher.service.js";
import { ConflictError, NotFoundError } from "../lib/app-error.js";
import { MAX_RETRY_DELAY_MS } from "../lib/webhook-retry.js";

const WEBHOOK = {
  id: "wh_1",
  url: "https://receiver.example.com/hook",
  secretKey: "super-secret",
};

function claimedDelivery(overrides: Record<string, unknown> = {}): any {
  return {
    id: "del_1",
    webhookId: WEBHOOK.id,
    eventType: "stream.created",
    attempts: 0,
    maxRetries: 5,
    payload: { eventType: "stream.created", txHash: "tx_1" },
    webhook: WEBHOOK,
    ...overrides,
  };
}

/**
 * processDeliveries issues, in order: the stale-claim updateMany, a candidate
 * findMany, the claiming updateMany, then a findMany for the claimed rows.
 */
function primeClaim(deliveries: any[]): void {
  deliveryTable.updateMany.mockResolvedValueOnce({ count: 0 }); // stale reclaim
  deliveryTable.findMany.mockResolvedValueOnce(
    deliveries.map((d) => ({ id: d.id })),
  );
  deliveryTable.updateMany.mockResolvedValueOnce({ count: deliveries.length });
  deliveryTable.findMany.mockResolvedValueOnce(deliveries);
}

function response(status: number, headers: Record<string, string> = {}): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  };
}

/** Data passed to the most recent webhookDelivery.update call. */
function lastUpdateData(): any {
  const calls = deliveryTable.update.mock.calls as any[][];
  return calls[calls.length - 1][0].data;
}

let service: WebhookDispatcherService;

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so a mockResolvedValueOnce queue left
  // over from a previous test can never leak into the next one.
  vi.resetAllMocks();
  deliveryTable.create.mockResolvedValue({});
  deliveryTable.update.mockResolvedValue({});
  deliveryTable.updateMany.mockResolvedValue({ count: 0 });
  deliveryTable.findMany.mockResolvedValue([]);
  deliveryTable.findFirst.mockResolvedValue(null);
  deliveryTable.findUnique.mockResolvedValue(null);
  deliveryTable.count.mockResolvedValue(0);
  deliveryTable.groupBy.mockResolvedValue([]);
  webhookTable.findMany.mockResolvedValue([]);
  service = new WebhookDispatcherService();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ═══════════════════════════════════════════════════════════════
// Delivery outcomes
// ═══════════════════════════════════════════════════════════════

describe("processDeliveries", () => {
  it("marks a 2xx delivery as succeeded", async () => {
    primeClaim([claimedDelivery()]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200)));

    await service.processDeliveries();

    const data = lastUpdateData();
    expect(data.status).toBe("success");
    expect(data.attempts).toBe(1);
    expect(data.deliveredAt).toBeInstanceOf(Date);
    expect(data.nextRetryAt).toBeNull();
    expect(data.lastError).toBeNull();
    // The claim must be released so the row is not seen as in-flight.
    expect(data.lockedAt).toBeNull();
    expect(data.lockedBy).toBeNull();
  });

  it("signs the request and sends the documented headers", async () => {
    primeClaim([claimedDelivery()]);
    const fetchMock = vi.fn().mockResolvedValue(response(200));
    vi.stubGlobal("fetch", fetchMock);

    await service.processDeliveries();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(WEBHOOK.url);
    expect(init.method).toBe("POST");
    expect(init.headers["X-StellarStream-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(init.headers["X-StellarStream-Timestamp"]).toBeTruthy();
    expect(init.headers["X-StellarStream-Nonce"]).toMatch(/^[0-9a-f]{32}$/);
    expect(init.headers["X-Webhook-ID"]).toBe(WEBHOOK.id);

    const verified = WebhookDispatcherService.verifySignature(
      init.body,
      init.headers["X-StellarStream-Signature"],
      WEBHOOK.secretKey,
      init.headers["X-StellarStream-Timestamp"],
      init.headers["X-StellarStream-Nonce"],
    );
    expect(verified).toBe(true);
  });

  it("returns a 5xx delivery to the queue with a future retry time", async () => {
    primeClaim([claimedDelivery()]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(503)));

    const before = Date.now();
    await service.processDeliveries();

    const data = lastUpdateData();
    expect(data.status).toBe("pending");
    expect(data.attempts).toBe(1);
    expect(data.lastStatusCode).toBe(503);
    expect(data.lastError).toBe("HTTP 503");
    expect(data.nextRetryAt.getTime()).toBeGreaterThan(before);
    expect(data.lockedAt).toBeNull();
  });

  it("retries a network failure", async () => {
    primeClaim([claimedDelivery()]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await service.processDeliveries();

    const data = lastUpdateData();
    expect(data.status).toBe("pending");
    expect(data.lastStatusCode).toBeNull();
    expect(data.lastError).toBe("ECONNREFUSED");
  });

  it("backs off further on later attempts", async () => {
    primeClaim([claimedDelivery({ attempts: 3 })]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(500)));

    const before = Date.now();
    await service.processDeliveries();

    const data = lastUpdateData();
    expect(data.attempts).toBe(4);
    // Attempt 4 backs off ~8s; the jitter floor is 80% of that.
    expect(data.nextRetryAt.getTime() - before).toBeGreaterThan(6_000);
  });

  it("honours a Retry-After header on a 429", async () => {
    primeClaim([claimedDelivery()]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(429, { "retry-after": "120" })),
    );

    const before = Date.now();
    await service.processDeliveries();

    const data = lastUpdateData();
    expect(data.status).toBe("pending");
    const delay = data.nextRetryAt.getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(119_000);
    expect(delay).toBeLessThanOrEqual(121_000);
  });

  it("never schedules beyond the maximum backoff window", async () => {
    primeClaim([claimedDelivery({ attempts: 40, maxRetries: 100 })]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(500)));

    const before = Date.now();
    await service.processDeliveries();

    const data = lastUpdateData();
    expect(data.nextRetryAt.getTime() - before).toBeLessThanOrEqual(MAX_RETRY_DELAY_MS);
  });
});

// ═══════════════════════════════════════════════════════════════
// Dead letter queue
// ═══════════════════════════════════════════════════════════════

describe("dead letter queue", () => {
  it("dead letters immediately on a non-retryable 4xx", async () => {
    primeClaim([claimedDelivery()]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(404)));

    await service.processDeliveries();

    const data = lastUpdateData();
    expect(data.status).toBe("dead_letter");
    expect(data.deadLetterReason).toBe("non_retryable_response");
    expect(data.attempts).toBe(1);
    expect(data.nextRetryAt).toBeNull();
    expect(data.deadLetteredAt).toBeInstanceOf(Date);
  });

  it("dead letters once the retry budget is exhausted", async () => {
    primeClaim([claimedDelivery({ attempts: 4, maxRetries: 5 })]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(500)));

    await service.processDeliveries();

    const data = lastUpdateData();
    expect(data.status).toBe("dead_letter");
    expect(data.deadLetterReason).toBe("retries_exhausted");
    expect(data.attempts).toBe(5);
    expect(data.lastStatusCode).toBe(500);
  });

  it("dead letters a delivery whose receiver has been removed", async () => {
    primeClaim([claimedDelivery({ webhook: null })]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await service.processDeliveries();

    expect(fetchMock).not.toHaveBeenCalled();
    const data = lastUpdateData();
    expect(data.status).toBe("dead_letter");
    expect(data.deadLetterReason).toBe("non_retryable_response");
  });
});

// ═══════════════════════════════════════════════════════════════
// Claiming / concurrency
// ═══════════════════════════════════════════════════════════════

describe("delivery claiming", () => {
  it("claims rows conditionally on them still being pending", async () => {
    primeClaim([claimedDelivery()]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200)));

    await service.processDeliveries();

    const claimCall = deliveryTable.updateMany.mock.calls[1][0];
    expect(claimCall.where.status).toBe("pending");
    expect(claimCall.where.id).toEqual({ in: ["del_1"] });
    expect(claimCall.data.status).toBe("delivering");
    expect(claimCall.data.lockedBy).toEqual(expect.any(String));
  });

  it("sends nothing when a competing worker won the claim", async () => {
    deliveryTable.updateMany.mockResolvedValueOnce({ count: 0 }); // stale reclaim
    deliveryTable.findMany.mockResolvedValueOnce([{ id: "del_1" }]);
    deliveryTable.updateMany.mockResolvedValueOnce({ count: 0 }); // claim lost
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await service.processDeliveries();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(deliveryTable.update).not.toHaveBeenCalled();
  });

  it("does no work when nothing is due", async () => {
    deliveryTable.updateMany.mockResolvedValueOnce({ count: 0 });
    deliveryTable.findMany.mockResolvedValueOnce([]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await service.processDeliveries();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns claims abandoned by a crashed worker to the queue", async () => {
    deliveryTable.updateMany.mockResolvedValueOnce({ count: 3 }); // stale reclaim
    deliveryTable.findMany.mockResolvedValueOnce([]);
    vi.stubGlobal("fetch", vi.fn());

    await service.processDeliveries();

    const reclaimCall = deliveryTable.updateMany.mock.calls[0][0];
    expect(reclaimCall.where.status).toBe("delivering");
    expect(reclaimCall.where.lockedAt.lt).toBeInstanceOf(Date);
    expect(reclaimCall.data.status).toBe("pending");
    expect(reclaimCall.data.lockedBy).toBeNull();
  });

  it("delivers every claimed row in a batch", async () => {
    primeClaim([
      claimedDelivery({ id: "del_1" }),
      claimedDelivery({ id: "del_2" }),
      claimedDelivery({ id: "del_3" }),
    ]);
    const fetchMock = vi.fn().mockResolvedValue(response(200));
    vi.stubGlobal("fetch", fetchMock);

    await service.processDeliveries();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(deliveryTable.update).toHaveBeenCalledTimes(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// Manual retry
// ═══════════════════════════════════════════════════════════════

describe("retryDelivery", () => {
  it("requeues a dead lettered delivery with a fresh budget", async () => {
    deliveryTable.findUnique.mockResolvedValue({
      id: "del_1",
      status: "dead_letter",
      attempts: 5,
      maxRetries: 5,
    });
    deliveryTable.update.mockResolvedValue({
      id: "del_1",
      webhookId: WEBHOOK.id,
      eventType: "stream.created",
      status: "pending",
      attempts: 5,
      maxRetries: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.retryDelivery("del_1");

    const data = deliveryTable.update.mock.calls[0][0].data;
    expect(data.status).toBe("pending");
    expect(data.maxRetries).toBe(10); // 5 already made + 5 fresh
    expect(data.deadLetteredAt).toBeNull();
    expect(data.deadLetterReason).toBeNull();
    expect(data.nextRetryAt).toBeInstanceOf(Date);
    expect(result.status).toBe("pending");
  });

  it("accepts a custom retry allowance", async () => {
    deliveryTable.findUnique.mockResolvedValue({
      id: "del_1",
      status: "dead_letter",
      attempts: 5,
    });
    deliveryTable.update.mockResolvedValue({
      id: "del_1",
      status: "pending",
      attempts: 5,
      maxRetries: 6,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.retryDelivery("del_1", { extraAttempts: 1 });

    expect(deliveryTable.update.mock.calls[0][0].data.maxRetries).toBe(6);
  });

  it("rejects an unknown delivery", async () => {
    deliveryTable.findUnique.mockResolvedValue(null);

    await expect(service.retryDelivery("nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses to retry an in-flight delivery", async () => {
    deliveryTable.findUnique.mockResolvedValue({
      id: "del_1",
      status: "delivering",
      attempts: 1,
    });

    await expect(service.retryDelivery("del_1")).rejects.toBeInstanceOf(ConflictError);
    expect(deliveryTable.update).not.toHaveBeenCalled();
  });

  it("refuses to retry a delivery that already succeeded", async () => {
    deliveryTable.findUnique.mockResolvedValue({
      id: "del_1",
      status: "success",
      attempts: 1,
    });

    await expect(service.retryDelivery("del_1")).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("retryDeadLetterQueue", () => {
  it("requires a selector", async () => {
    await expect(service.retryDeadLetterQueue({})).rejects.toThrow(
      /deliveryIds or webhookId/,
    );
  });

  it("drains a webhook's dead letter queue", async () => {
    deliveryTable.findMany.mockResolvedValueOnce([{ id: "del_1" }, { id: "del_2" }]);
    deliveryTable.findUnique.mockResolvedValue({
      id: "del_x",
      status: "dead_letter",
      attempts: 5,
    });
    deliveryTable.update.mockResolvedValue({
      id: "del_x",
      status: "pending",
      attempts: 5,
      maxRetries: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.retryDeadLetterQueue({ webhookId: WEBHOOK.id });

    expect(deliveryTable.findMany.mock.calls[0][0].where).toMatchObject({
      status: "dead_letter",
      webhookId: WEBHOOK.id,
    });
    expect(result.retried).toBe(2);
    expect(result.deliveryIds).toEqual(["del_1", "del_2"]);
  });

  it("counts only the rows that actually requeued", async () => {
    deliveryTable.findMany.mockResolvedValueOnce([{ id: "del_1" }, { id: "del_2" }]);
    deliveryTable.findUnique
      .mockResolvedValueOnce({ id: "del_1", status: "dead_letter", attempts: 5 })
      .mockResolvedValueOnce(null);
    deliveryTable.update.mockResolvedValue({
      id: "del_1",
      status: "pending",
      attempts: 5,
      maxRetries: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.retryDeadLetterQueue({
      deliveryIds: ["del_1", "del_2"],
    });

    expect(result.retried).toBe(1);
    expect(result.deliveryIds).toEqual(["del_1"]);
  });

  it("is a no-op when the queue is empty", async () => {
    deliveryTable.findMany.mockResolvedValueOnce([]);

    const result = await service.retryDeadLetterQueue({ webhookId: WEBHOOK.id });

    expect(result).toEqual({ retried: 0, deliveryIds: [] });
    expect(deliveryTable.update).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════

describe("getDeliveryStats", () => {
  it("aggregates per-status counts, dead letter reasons and success rate", async () => {
    deliveryTable.groupBy
      .mockResolvedValueOnce([
        { status: "pending", _count: { _all: 4 } },
        { status: "delivering", _count: { _all: 1 } },
        { status: "success", _count: { _all: 90 } },
        { status: "dead_letter", _count: { _all: 10 } },
      ])
      .mockResolvedValueOnce([
        { deadLetterReason: "retries_exhausted", _count: { _all: 7 } },
        { deadLetterReason: "non_retryable_response", _count: { _all: 3 } },
      ]);
    deliveryTable.count.mockResolvedValue(2);
    deliveryTable.findFirst.mockResolvedValue({ createdAt: new Date("2026-07-28T09:00:00Z") });

    const stats = await service.getDeliveryStats();

    expect(stats.counts).toEqual({
      pending: 4,
      delivering: 1,
      success: 90,
      dead_letter: 10,
    });
    expect(stats.total).toBe(105);
    expect(stats.deadLetterByReason).toEqual({
      retries_exhausted: 7,
      non_retryable_response: 3,
    });
    expect(stats.dueNow).toBe(2);
    expect(stats.successRate).toBeCloseTo(0.9);
    expect(stats.oldestPendingAt).toEqual(new Date("2026-07-28T09:00:00Z"));
  });

  it("reports a zero success rate on an empty queue rather than NaN", async () => {
    deliveryTable.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    deliveryTable.count.mockResolvedValue(0);
    deliveryTable.findFirst.mockResolvedValue(null);

    const stats = await service.getDeliveryStats();

    expect(stats.successRate).toBe(0);
    expect(stats.total).toBe(0);
    expect(stats.oldestPendingAt).toBeNull();
  });
});

describe("listDeliveries", () => {
  it("applies filters and clamps the page size", async () => {
    deliveryTable.findMany.mockResolvedValueOnce([
      {
        id: "del_1",
        webhookId: WEBHOOK.id,
        webhook: { url: WEBHOOK.url },
        eventType: "stream.created",
        status: "dead_letter",
        attempts: 5,
        maxRetries: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    deliveryTable.count.mockResolvedValue(1);

    const result = await service.listDeliveries({
      status: "dead_letter",
      webhookId: WEBHOOK.id,
      limit: 5_000,
    });

    const query = deliveryTable.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ status: "dead_letter", webhookId: WEBHOOK.id });
    expect(query.take).toBe(200); // clamped from 5000
    expect(result.total).toBe(1);
    expect(result.deliveries[0].webhookUrl).toBe(WEBHOOK.url);
  });

  it("defaults to an unfiltered first page", async () => {
    deliveryTable.findMany.mockResolvedValueOnce([]);
    deliveryTable.count.mockResolvedValue(0);

    const result = await service.listDeliveries();

    const query = deliveryTable.findMany.mock.calls[0][0];
    expect(query.where).toEqual({});
    expect(query.take).toBe(50);
    expect(query.skip).toBe(0);
    expect(result.deliveries).toEqual([]);
  });
});

describe("getDelivery", () => {
  it("includes the original payload", async () => {
    const payload = { eventType: "stream.created", txHash: "tx_1" };
    deliveryTable.findUnique.mockResolvedValue({
      id: "del_1",
      webhookId: WEBHOOK.id,
      webhook: { url: WEBHOOK.url },
      eventType: "stream.created",
      status: "dead_letter",
      attempts: 5,
      maxRetries: 5,
      payload,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const delivery = await service.getDelivery("del_1");

    expect(delivery.payload).toEqual(payload);
    expect(delivery.webhookUrl).toBe(WEBHOOK.url);
  });

  it("rejects an unknown delivery", async () => {
    deliveryTable.findUnique.mockResolvedValue(null);

    await expect(service.getDelivery("nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});
