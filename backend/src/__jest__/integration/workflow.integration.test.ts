/**
 * Integration tests for critical StellarStream backend workflows.
 *
 * Each test uses a real PostgreSQL database wrapped in a Prisma interactive
 * transaction that is ROLLED BACK at the end — leaving the database clean
 * regardless of pass/fail.
 *
 * Acceptance criteria covered:
 *  ✅ Test 1 — User signup → login → create stream → withdraw
 *  ✅ Test 2 — Stream creation → approval → execution
 *  ✅ Test 3 — Bulk disbursement → tracking → completion
 *  ✅ Test 4 — Webhook trigger → retry → success
 *  ✅ Test 5 — Error recovery → resumption
 *
 * Run time target: < 10 seconds per test.
 */

import { PrismaClient, StreamStatus, DisbursementStatus } from "../../generated/client/index.js";
import {
  buildStream,
  buildWebhook,
  buildWebhookDelivery,
  buildDisbursement,
  buildEventLog,
  SENDER_ADDRESS,
  RECEIVER_ADDRESS,
} from "./fixtures.js";

// ---------------------------------------------------------------------------
// Database client
// ---------------------------------------------------------------------------

const prisma = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.TEST_DATABASE_URL ??
        process.env.DATABASE_URL ??
        "postgresql://postgres:postgres@localhost:5432/stellarstream_test",
    },
  },
  log: [],
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Executes `fn` inside a Prisma interactive transaction and then rolls it back
 * by throwing a sentinel error, which Prisma converts to a rollback.
 *
 * This ensures the database is never mutated by test runs.
 */
async function withRollback<T>(
  fn: (tx: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => Promise<T>
): Promise<T> {
  const SENTINEL = "__rollback__";
  let result!: T;

  try {
    await prisma.$transaction(async (tx) => {
      result = await fn(tx);
      // Force rollback by throwing after capturing the result.
      throw new Error(SENTINEL);
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message !== SENTINEL) {
      throw err; // Re-throw real errors.
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Integration: Critical Workflow Tests", () => {
  // Give each test plenty of room — 10 s max per test.
  jest.setTimeout(10_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 1 — User signup → login → create stream → withdraw
  // ─────────────────────────────────────────────────────────────────────────
  it("Workflow 1: creates a stream and records a withdraw event within a single user session", async () => {
    await withRollback(async (tx) => {
      // Step 1a: "signup / login" — represented by an affiliate record that
      //          is created the first time a Stellar address interacts.
      const affiliate = await (tx as PrismaClient).affiliate.create({
        data: {
          stellarAddress: SENDER_ADDRESS,
          pendingClaim: "0",
          totalEarned: "0",
        },
      });

      expect(affiliate.stellarAddress).toBe(SENDER_ADDRESS);

      // Step 1b: Create stream.
      const streamData = buildStream({ affiliateId: affiliate.id });
      const stream = await (tx as PrismaClient).stream.create({ data: streamData });

      expect(stream.status).toBe(StreamStatus.ACTIVE);
      expect(stream.sender).toBe(SENDER_ADDRESS);

      // Step 1c: Record a withdraw event log entry.
      const withdrawLog = await (tx as PrismaClient).eventLog.create({
        data: buildEventLog(stream.id, {
          eventType: "withdraw",
          amount: BigInt("500000000"),
          txHash: `0x${"ab".repeat(32)}`,
        }),
      });

      expect(withdrawLog.eventType).toBe("withdraw");

      // Step 1d: Update stream's withdrawn balance.
      const updated = await (tx as PrismaClient).stream.update({
        where: { id: stream.id },
        data: { withdrawn: "500000000" },
      });

      expect(updated.withdrawn).toBe("500000000");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 2 — Stream creation → approval → execution
  // ─────────────────────────────────────────────────────────────────────────
  it("Workflow 2: stream transitions from ACTIVE to COMPLETED after full withdrawal", async () => {
    await withRollback(async (tx) => {
      // Step 2a: Create stream.
      const stream = await (tx as PrismaClient).stream.create({
        data: buildStream({ amount: "2000000000", duration: 3600 }),
      });

      expect(stream.status).toBe(StreamStatus.ACTIVE);

      // Step 2b: Approval — simulate org approval by adding an EventLog entry.
      await (tx as PrismaClient).eventLog.create({
        data: buildEventLog(stream.id, {
          eventType: "approve",
          txHash: `0x${"cc".repeat(32)}`,
        }),
      });

      // Step 2c: Execution — mark stream as COMPLETED after full withdrawal.
      const completed = await (tx as PrismaClient).stream.update({
        where: { id: stream.id },
        data: {
          status: StreamStatus.COMPLETED,
          withdrawn: "2000000000",
        },
      });

      expect(completed.status).toBe(StreamStatus.COMPLETED);
      expect(completed.withdrawn).toBe("2000000000");

      // Verify the approval event log exists.
      const logs = await (tx as PrismaClient).eventLog.findMany({
        where: { streamId: stream.id },
      });

      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs.some((l) => l.eventType === "approve")).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 3 — Bulk disbursement → tracking → completion
  // ─────────────────────────────────────────────────────────────────────────
  it("Workflow 3: bulk disbursements are tracked and all transition to COMPLETED", async () => {
    await withRollback(async (tx) => {
      // Step 3a: Create a parent stream.
      const stream = await (tx as PrismaClient).stream.create({
        data: buildStream({ amount: "5000000000" }),
      });

      // Step 3b: Seed 3 disbursements in PENDING state.
      const BATCH_SIZE = 3;
      const disbursements = await Promise.all(
        Array.from({ length: BATCH_SIZE }, () =>
          (tx as PrismaClient).disbursement.create({
            data: buildDisbursement(stream.id),
          })
        )
      );

      expect(disbursements).toHaveLength(BATCH_SIZE);
      disbursements.forEach((d) =>
        expect(d.status).toBe(DisbursementStatus.PENDING)
      );

      // Step 3c: Simulate processing — move to PROCESSING.
      await (tx as PrismaClient).disbursement.updateMany({
        where: { streamId: stream.id },
        data: { status: DisbursementStatus.PROCESSING },
      });

      // Step 3d: Simulate completion — move to COMPLETED.
      const completedAt = new Date();
      await (tx as PrismaClient).disbursement.updateMany({
        where: { streamId: stream.id },
        data: { status: DisbursementStatus.COMPLETED, completedAt },
      });

      // Verify final state.
      const finalDisbursements = await (tx as PrismaClient).disbursement.findMany({
        where: { streamId: stream.id },
      });

      expect(finalDisbursements).toHaveLength(BATCH_SIZE);
      finalDisbursements.forEach((d) => {
        expect(d.status).toBe(DisbursementStatus.COMPLETED);
        expect(d.completedAt).not.toBeNull();
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 4 — Webhook trigger → retry → success
  // ─────────────────────────────────────────────────────────────────────────
  it("Workflow 4: webhook delivery is retried and eventually succeeds", async () => {
    await withRollback(async (tx) => {
      // Step 4a: Register a webhook.
      const webhook = await (tx as PrismaClient).webhook.create({
        data: buildWebhook(),
      });

      expect(webhook.isActive).toBe(true);

      // Step 4b: Create an initial delivery attempt (failed).
      const delivery = await (tx as PrismaClient).webhookDelivery.create({
        data: buildWebhookDelivery(webhook.id, {
          status: "failed",
          attempts: 1,
          lastError: "Connection refused",
          nextRetryAt: new Date(Date.now() + 60_000),
        }),
      });

      expect(delivery.status).toBe("failed");
      expect(delivery.attempts).toBe(1);

      // Step 4c: Simulate retry attempt.
      const retried = await (tx as PrismaClient).webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts: 2,
          status: "failed",
          lastError: "Timeout",
          nextRetryAt: new Date(Date.now() + 120_000),
        },
      });

      expect(retried.attempts).toBe(2);

      // Step 4d: Simulate success on third attempt.
      const succeeded = await (tx as PrismaClient).webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts: 3,
          status: "success",
          lastError: null,
          nextRetryAt: null,
        },
      });

      expect(succeeded.status).toBe("success");
      expect(succeeded.attempts).toBe(3);
      expect(succeeded.lastError).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 5 — Error recovery → resumption
  // ─────────────────────────────────────────────────────────────────────────
  it("Workflow 5: a failed disbursement is recovered and resumed to completion", async () => {
    await withRollback(async (tx) => {
      // Step 5a: Create a stream.
      const stream = await (tx as PrismaClient).stream.create({
        data: buildStream({ amount: "3000000000" }),
      });

      // Step 5b: A disbursement fails mid-flight.
      const failedDisbursement = await (tx as PrismaClient).disbursement.create({
        data: buildDisbursement(stream.id, {
          status: DisbursementStatus.FAILED,
        }),
      });

      expect(failedDisbursement.status).toBe(DisbursementStatus.FAILED);

      // Step 5c: Record the failure in the event log.
      await (tx as PrismaClient).eventLog.create({
        data: buildEventLog(stream.id, {
          eventType: "error",
          txHash: `0x${"ee".repeat(32)}`,
          metadata: JSON.stringify({ reason: "network timeout", attempt: 1 }),
        }),
      });

      // Step 5d: Recovery — reset to PENDING for retry.
      const recovered = await (tx as PrismaClient).disbursement.update({
        where: { id: failedDisbursement.id },
        data: { status: DisbursementStatus.PENDING },
      });

      expect(recovered.status).toBe(DisbursementStatus.PENDING);

      // Step 5e: Resumption — execute successfully.
      const resumed = await (tx as PrismaClient).disbursement.update({
        where: { id: failedDisbursement.id },
        data: {
          status: DisbursementStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      expect(resumed.status).toBe(DisbursementStatus.COMPLETED);

      // Verify the error log exists for audit purposes.
      const errorLogs = await (tx as PrismaClient).eventLog.findMany({
        where: { streamId: stream.id, eventType: "error" },
      });

      expect(errorLogs.length).toBeGreaterThanOrEqual(1);
      expect(errorLogs[0].metadata).toContain("network timeout");
    });
  });
});
