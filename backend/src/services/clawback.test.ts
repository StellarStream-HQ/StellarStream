/**
 * Clawback Service — Comprehensive test suite with 20+ scenarios
 *
 * Tests cover:
 *  1. Stream existence checks
 *  2. 24-hour cooldown period
 *  3. Amount validation (zero, negative, invalid)
 *  4. Max clawbackable amount calculation
 *  5. Fully withdrawn / fully clawed back streams
 *  6. Successful clawback execution
 *  7. Clawback history tracking
 *  8. Dual-ID resolution (streamId vs internal id)
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "../generated/client/client.js";
import { ClawbackService } from "./clawback.service.js";
import { PrismaLibSql } from "@prisma/adapter-libsql";

// ─── Test helpers ───────────────────────────────────────────────────────────

/**
 * Creates a fresh Prisma client for isolated test runs.
 * Uses DATABASE_URL from environment (defaults to file:./dev.db from .env)
 */
function createTestPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const adapter = new PrismaLibSql({ url });
  return new PrismaClient({ adapter });
}

/**
 * Seed a stream with given parameters.
 * Returns the created stream record.
 */
async function seedStream(
  prisma: PrismaClient,
  overrides: {
    streamId?: string;
    sender?: string;
    receiver?: string;
    amount?: string;
    withdrawn?: string;
    createdAt?: Date;
    duration?: number;
  } = {},
) {
  return prisma.stream.create({
    data: {
      streamId: overrides.streamId ?? "test-stream-1",
      txHash: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sender: overrides.sender ?? "GBSENDER123456789",
      receiver: overrides.receiver ?? "GBRECEIVER123456789",
      amount: overrides.amount ?? "1000000000",
      withdrawn: overrides.withdrawn ?? "0",
      createdAt: overrides.createdAt ?? new Date(),
      duration: overrides.duration ?? 3600,
    },
  });
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe("ClawbackService", () => {
  let prisma: PrismaClient;
  let service: ClawbackService;

  beforeEach(async () => {
    prisma = createTestPrisma();
    // Drop and recreate tables for clean state
    await prisma.$executeRawUnsafe("DROP TABLE IF EXISTS ClawbackHistory");
    await prisma.$executeRawUnsafe("DROP TABLE IF EXISTS Stream");
    await prisma.$executeRawUnsafe("DROP TABLE IF EXISTS SyncMetadata");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS Stream (
        id TEXT PRIMARY KEY,
        streamId TEXT UNIQUE,
        txHash TEXT UNIQUE NOT NULL,
        sender TEXT NOT NULL,
        receiver TEXT NOT NULL,
        amount TEXT NOT NULL,
        withdrawn TEXT DEFAULT '0',
        duration INTEGER NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ClawbackHistory (
        id TEXT PRIMARY KEY,
        streamId TEXT NOT NULL,
        amount TEXT NOT NULL,
        reason TEXT DEFAULT '',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        executedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        txHash TEXT,
        status TEXT DEFAULT 'executed'
      )
    `);
    service = new ClawbackService(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  // ── Scenario 1-3: Stream not found ──────────────────────────────────────

  it("S1: canClawback returns false for non-existent stream", async () => {
    const result = await service.canClawback("non-existent-stream");
    expect(result).toBe(false);
  });

  it("S2: getMaxClawbackAmount returns 0 for non-existent stream", async () => {
    const amount = await service.getMaxClawbackAmount("non-existent-stream");
    expect(amount).toBe("0");
  });

  it("S3: validateClawback returns error for non-existent stream", async () => {
    const validation = await service.validateClawback("non-existent-stream", "100");
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain("Stream not found: non-existent-stream");
  });

  // ── Scenario 4-6: 24-hour cooldown ──────────────────────────────────────

  it("S4: canClawback returns false for stream created under 24h ago", async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    await seedStream(prisma, { createdAt: recent });
    const result = await service.canClawback("test-stream-1");
    expect(result).toBe(false);
  });

  it("S5: validateClawback returns cooldown error for recent stream", async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    await seedStream(prisma, { createdAt: recent });
    const validation = await service.validateClawback("test-stream-1", "100");
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("24 hours"))).toBe(true);
  });

  it("S6: canClawback returns true for stream older than 24h", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours ago
    await seedStream(prisma, { createdAt: old });
    const result = await service.canClawback("test-stream-1");
    expect(result).toBe(true);
  });

  // ── Scenario 7-8: Amount validation ─────────────────────────────────────

  it("S7: validateClawback rejects negative amount", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await seedStream(prisma, { createdAt: old });
    const validation = await service.validateClawback("test-stream-1", "-500");
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain("Clawback amount must not be negative.");
  });

  it("S8: validateClawback warns on zero amount", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await seedStream(prisma, { createdAt: old });
    const validation = await service.validateClawback("test-stream-1", "0");
    expect(validation.valid).toBe(true);
    expect(validation.warnings.some((w) => w.includes("zero"))).toBe(true);
  });

  // ── Scenario 9-10: Max clawbackable amount ──────────────────────────────

  it("S9: getMaxClawbackAmount returns total - withdrawn", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await seedStream(prisma, {
      createdAt: old,
      amount: "1000000000",
      withdrawn: "300000000",
    });
    const maxAmount = await service.getMaxClawbackAmount("test-stream-1");
    expect(maxAmount).toBe("700000000"); // 1_000_000_000 - 300_000_000
  });

  it("S10: validateClawback rejects amount exceeding max clawbackable", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await seedStream(prisma, {
      createdAt: old,
      amount: "1000000000",
      withdrawn: "300000000",
    });
    const validation = await service.validateClawback("test-stream-1", "800000000");
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("exceeds maximum"))).toBe(true);
  });

  // ── Scenario 11-12: Fully withdrawn stream ──────────────────────────────

  it("S11: canClawback returns false for fully withdrawn stream", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await seedStream(prisma, {
      createdAt: old,
      amount: "1000000000",
      withdrawn: "1000000000",
    });
    const result = await service.canClawback("test-stream-1");
    expect(result).toBe(false);
  });

  it("S12: validateClawback returns no-balance error for fully withdrawn", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await seedStream(prisma, {
      createdAt: old,
      amount: "1000000000",
      withdrawn: "1000000000",
    });
    const validation = await service.validateClawback("test-stream-1", "100");
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("no clawbackable balance"))).toBe(true);
  });

  // ── Scenario 13-14: Invalid amount strings ──────────────────────────────

  it("S13: validateClawback rejects non-numeric amount string", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await seedStream(prisma, { createdAt: old });
    const validation = await service.validateClawback("test-stream-1", "not-a-number");
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("Invalid clawback amount"))).toBe(true);
  });

  it("S14: validateClawback rejects decimal amount string", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await seedStream(prisma, { createdAt: old });
    const validation = await service.validateClawback("test-stream-1", "100.50");
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("Invalid clawback amount"))).toBe(true);
  });

  // ── Scenario 15-16: Successful clawback execution ───────────────────────

  it("S15: executeClawback creates history record and updates withdrawn", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const stream = await seedStream(prisma, {
      createdAt: old,
      amount: "1000000000",
      withdrawn: "200000000",
    });

    const record = await service.executeClawback({
      streamId: "test-stream-1",
      amount: "500000000",
      reason: "Fraudulent activity",
    });

    expect(record.amount).toBe("500000000");
    expect(record.reason).toBe("Fraudulent activity");
    expect(record.status).toBe("executed");

    // Verify withdrawn was updated
    const updated = await prisma.stream.findUnique({ where: { id: stream.id } });
    expect(updated?.withdrawn).toBe("700000000"); // 200_000_000 + 500_000_000

    // Verify clawback history recorded
    const history = await prisma.clawbackHistory.findMany({ where: { streamId: stream.id } });
    expect(history.length).toBe(1);
    expect(history[0].amount).toBe("500000000");
  });

  it("S16: executeClawback works with streamId instead of internal id", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await seedStream(prisma, {
      streamId: "custom-stream-456",
      createdAt: old,
      amount: "500000000",
    });

    const record = await service.executeClawback({
      streamId: "custom-stream-456",
      amount: "200000000",
    });

    expect(record.amount).toBe("200000000");
    expect(record.status).toBe("executed");
  });

  // ── Scenario 17: Clawback history retrieval ────────────────────────────

  it("S17: getClawbackHistory returns records in descending order", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const stream = await seedStream(prisma, {
      streamId: "history-stream",
      createdAt: old,
      amount: "1000000000",
    });

    await service.executeClawback({
      streamId: "history-stream",
      amount: "100000000",
      reason: "First clawback",
    });

    await service.executeClawback({
      streamId: "history-stream",
      amount: "200000000",
      reason: "Second clawback",
    });

    const history = await service.getClawbackHistory(stream.id);
    expect(history.length).toBe(2);
    expect(history[0].reason).toBe("Second clawback"); // Most recent first
    expect(history[1].reason).toBe("First clawback");
  });

  // ── Scenario 18: Duplicate clawback warning ─────────────────────────────

  it("S18: validateClawback warns when stream has previous clawbacks", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const streamId = "dup-clawback-stream";
    await seedStream(prisma, {
      streamId,
      createdAt: old,
      amount: "1000000000",
    });

    // Execute first clawback
    await service.executeClawback({
      streamId,
      amount: "100000000",
    });

    // Validate second clawback — should warn about previous records
    const validation = await service.validateClawback(streamId, "200000000");
    expect(validation.valid).toBe(true);
    expect(validation.warnings.some((w) => w.includes("previous clawback record"))).toBe(true);
  });

  // ── Scenario 19: executeClawback rejects when validation fails ──────────

  it("S19: executeClawback throws when validation fails", async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago — still in cooldown
    await seedStream(prisma, { createdAt: recent, streamId: "cooldown-stream" });

    await expect(
      service.executeClawback({
        streamId: "cooldown-stream",
        amount: "100000000",
      }),
    ).rejects.toThrow("Clawback validation failed");
  });

  // ── Scenario 20: Large amount precision ─────────────────────────────────

  it("S20: handles large BigInt amounts without precision loss", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await seedStream(prisma, {
      streamId: "big-amount-stream",
      createdAt: old,
      amount: "999999999999999999999999999", // very large amount
      withdrawn: "1",
    });

    const maxAmount = await service.getMaxClawbackAmount("big-amount-stream");
    expect(maxAmount).toBe("999999999999999999999999998");

    const record = await service.executeClawback({
      streamId: "big-amount-stream",
      amount: maxAmount,
    });

    expect(record.amount).toBe("999999999999999999999999998");

    // Verify no clawbackable balance remains
    const canClawback = await service.canClawback("big-amount-stream");
    expect(canClawback).toBe(false);
  });
});

// ─── Additional Edge Case Tests ──────────────────────────────────────────────

describe("ClawbackService — Additional Edge Cases", () => {
  let prisma: PrismaClient;
  let service: ClawbackService;

  beforeEach(async () => {
    prisma = createTestPrisma();
    await prisma.$executeRawUnsafe("DROP TABLE IF EXISTS ClawbackHistory");
    await prisma.$executeRawUnsafe("DROP TABLE IF EXISTS Stream");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS Stream (
        id TEXT PRIMARY KEY,
        streamId TEXT UNIQUE,
        txHash TEXT UNIQUE NOT NULL,
        sender TEXT NOT NULL,
        receiver TEXT NOT NULL,
        amount TEXT NOT NULL,
        withdrawn TEXT DEFAULT '0',
        duration INTEGER NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ClawbackHistory (
        id TEXT PRIMARY KEY,
        streamId TEXT NOT NULL,
        amount TEXT NOT NULL,
        reason TEXT DEFAULT '',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        executedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        txHash TEXT,
        status TEXT DEFAULT 'executed'
      )
    `);
    service = new ClawbackService(prisma);
  });

  it("S21: validates at exactly 24h boundary", async () => {
    // Stream created just before 24h boundary (1 second safety margin for test execution time)
    const boundary = new Date(Date.now() - 24 * 60 * 60 * 1000 + 3000);
    await seedStream(prisma, { streamId: "boundary-stream", createdAt: boundary });
    const result = await service.canClawback("boundary-stream");
    expect(result).toBe(false);
  });

  it("S22: validates just past 24h boundary", async () => {
    // Stream created just over 24 hours ago
    const justPast = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1000);
    await seedStream(prisma, { streamId: "past-boundary-stream", createdAt: justPast });
    const result = await service.canClawback("past-boundary-stream");
    expect(result).toBe(true);
  });

  it("S23: getMaxClawbackAmount returns 0 when withdrawn equals amount", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await seedStream(prisma, {
      streamId: "zero-balance-stream",
      createdAt: old,
      amount: "500000",
      withdrawn: "500000",
    });
    const maxAmount = await service.getMaxClawbackAmount("zero-balance-stream");
    expect(maxAmount).toBe("0");
  });

  it("S24: executeClawback stores optional txHash", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await seedStream(prisma, {
      streamId: "txhash-stream",
      createdAt: old,
      amount: "1000000000",
    });

    const record = await service.executeClawback({
      streamId: "txhash-stream",
      amount: "500000000",
      txHash: "abc123txhash",
    });

    expect(record.status).toBe("executed");

    // Verify txHash stored in DB
    const dbRecord = await prisma.clawbackHistory.findFirst({
      where: { streamId: record.streamId },
    });
    expect(dbRecord?.txHash).toBe("abc123txhash");
  });

  it("S25: executeClawback stores empty reason when not provided", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await seedStream(prisma, {
      streamId: "no-reason-stream",
      createdAt: old,
      amount: "1000000000",
    });

    const record = await service.executeClawback({
      streamId: "no-reason-stream",
      amount: "100000000",
      // No reason provided
    });

    expect(record.reason).toBe("");
  });
});