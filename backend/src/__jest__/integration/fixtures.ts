/**
 * Test fixtures for integration tests.
 *
 * These fixtures provide stable, deterministic seed data for database
 * integration tests. Each fixture returns a plain object that can be
 * passed directly to the relevant Prisma `create` calls inside a
 * managed transaction.
 */

import crypto from "crypto";

// ── Stellar address helpers ────────────────────────────────────────────────────

/** A stable fake G-address for the default sender. */
export const SENDER_ADDRESS =
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

/** A stable fake G-address for the default receiver. */
export const RECEIVER_ADDRESS =
  "GBHQBHD6JSHGDGJY73YQ7OLFHH63QD5XBVXPTQT5LMJZJM65E4M4JBJ";

/** A stable fake G-address for a webhook-owning admin. */
export const ADMIN_ADDRESS =
  "GDKIJJIKXLOM2NRMPNQZUUYK24ZPVFC6426GZAEP3KUK6OJRIN4NMUQ";

// ── Token / asset fixtures ─────────────────────────────────────────────────────

export const USDC_TOKEN_ADDRESS =
  "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

// ── Stream fixtures ───────────────────────────────────────────────────────────

export function buildStream(overrides: Record<string, unknown> = {}) {
  return {
    txHash: `0x${crypto.randomBytes(32).toString("hex")}`,
    sender: SENDER_ADDRESS,
    receiver: RECEIVER_ADDRESS,
    amount: "1000000000", // 1 000 XLM in stroops
    status: "ACTIVE" as const,
    withdrawn: "0",
    duration: 86_400, // 1 day in seconds
    tokenAddress: USDC_TOKEN_ADDRESS,
    ...overrides,
  };
}

// ── Webhook fixtures ──────────────────────────────────────────────────────────

export function buildWebhook(overrides: Record<string, unknown> = {}) {
  const uid = crypto.randomBytes(6).toString("hex");
  return {
    url: `https://example.com/webhook-${uid}`,
    secretKey: crypto.randomBytes(16).toString("hex"),
    eventType: "*",
    isActive: true,
    ...overrides,
  };
}

// ── WebhookDelivery fixtures ──────────────────────────────────────────────────

export function buildWebhookDelivery(
  webhookId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    webhookId,
    eventType: "stream_created",
    payload: { streamId: "test-stream-1", amount: "1000000000" },
    status: "pending",
    attempts: 0,
    maxRetries: 5,
    ...overrides,
  };
}

// ── Disbursement fixtures ─────────────────────────────────────────────────────

export function buildDisbursement(
  streamId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    streamId,
    txHash: `0x${crypto.randomBytes(32).toString("hex")}`,
    sender: SENDER_ADDRESS,
    receiver: RECEIVER_ADDRESS,
    amount: BigInt("500000000"),
    tokenAddress: USDC_TOKEN_ADDRESS,
    status: "PENDING" as const,
    ledger: 50_000_000,
    ...overrides,
  };
}

// ── EventLog fixtures ─────────────────────────────────────────────────────────

export function buildEventLog(
  streamId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    eventType: "create",
    streamId,
    txHash: `0x${crypto.randomBytes(32).toString("hex")}`,
    eventIndex: 0,
    ledger: 50_000_000,
    ledgerClosedAt: new Date().toISOString(),
    sender: SENDER_ADDRESS,
    receiver: RECEIVER_ADDRESS,
    amount: BigInt("1000000000"),
    ...overrides,
  };
}
