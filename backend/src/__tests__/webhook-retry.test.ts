import { describe, expect, it } from "vitest";
import {
  BASE_RETRY_DELAY_MS,
  DELIVERY_STATUSES,
  MAX_RETRY_DELAY_MS,
  classifyResponseStatus,
  classifyTransportError,
  computeBackoffDelayMs,
  decideRetry,
  parseRetryAfterMs,
} from "../lib/webhook-retry.js";

// Removes jitter so the exponential curve itself can be asserted exactly.
const noJitter = { jitterRatio: 0 };

describe("computeBackoffDelayMs", () => {
  it("doubles the delay on each successive attempt", () => {
    expect(computeBackoffDelayMs(1, noJitter)).toBe(BASE_RETRY_DELAY_MS);
    expect(computeBackoffDelayMs(2, noJitter)).toBe(BASE_RETRY_DELAY_MS * 2);
    expect(computeBackoffDelayMs(3, noJitter)).toBe(BASE_RETRY_DELAY_MS * 4);
    expect(computeBackoffDelayMs(4, noJitter)).toBe(BASE_RETRY_DELAY_MS * 8);
    expect(computeBackoffDelayMs(5, noJitter)).toBe(BASE_RETRY_DELAY_MS * 16);
  });

  it("caps the delay at MAX_RETRY_DELAY_MS", () => {
    expect(computeBackoffDelayMs(50, noJitter)).toBe(MAX_RETRY_DELAY_MS);
    expect(computeBackoffDelayMs(1000, noJitter)).toBe(MAX_RETRY_DELAY_MS);
  });

  it("never returns Infinity or NaN for a very large attempt count", () => {
    const delay = computeBackoffDelayMs(Number.MAX_SAFE_INTEGER, noJitter);
    expect(Number.isFinite(delay)).toBe(true);
    expect(delay).toBe(MAX_RETRY_DELAY_MS);
  });

  it("treats attempt values below 1 as the first attempt", () => {
    expect(computeBackoffDelayMs(0, noJitter)).toBe(BASE_RETRY_DELAY_MS);
    expect(computeBackoffDelayMs(-5, noJitter)).toBe(BASE_RETRY_DELAY_MS);
  });

  it("applies jitter symmetrically around the exponential value", () => {
    const base = BASE_RETRY_DELAY_MS * 4; // attempt 3

    // random() === 0 maps to the bottom of the jitter band, 1 to the top.
    const low = computeBackoffDelayMs(3, { jitterRatio: 0.2, random: () => 0 });
    const high = computeBackoffDelayMs(3, { jitterRatio: 0.2, random: () => 0.999999 });
    const mid = computeBackoffDelayMs(3, { jitterRatio: 0.2, random: () => 0.5 });

    expect(low).toBe(Math.round(base * 0.8));
    expect(high).toBeCloseTo(base * 1.2, -1);
    expect(mid).toBe(base);
  });

  it("keeps jittered delays within [0, maxDelayMs]", () => {
    for (let attempt = 1; attempt <= 40; attempt++) {
      for (const random of [() => 0, () => 0.5, () => 0.9999]) {
        const delay = computeBackoffDelayMs(attempt, { random });
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(MAX_RETRY_DELAY_MS);
      }
    }
  });

  it("honours custom base and cap", () => {
    expect(
      computeBackoffDelayMs(3, { baseDelayMs: 100, maxDelayMs: 250, jitterRatio: 0 }),
    ).toBe(250);
  });
});

describe("classifyResponseStatus", () => {
  it("treats server errors as retryable", () => {
    for (const status of [500, 502, 503, 504, 599]) {
      expect(classifyResponseStatus(status)).toBe("retryable");
    }
  });

  it("treats timeout and rate limit responses as retryable", () => {
    expect(classifyResponseStatus(408)).toBe("retryable");
    expect(classifyResponseStatus(429)).toBe("retryable");
  });

  it("treats other client errors as permanent", () => {
    for (const status of [400, 401, 403, 404, 410, 422]) {
      expect(classifyResponseStatus(status)).toBe("permanent");
    }
  });

  it("treats unfollowed redirects as permanent", () => {
    expect(classifyResponseStatus(301)).toBe("permanent");
  });

  it("classifies transport failures as retryable", () => {
    expect(classifyTransportError()).toBe("retryable");
  });
});

describe("parseRetryAfterMs", () => {
  const now = new Date("2026-07-28T12:00:00.000Z");

  it("parses delay-seconds", () => {
    expect(parseRetryAfterMs("30", now)).toBe(30_000);
    expect(parseRetryAfterMs("0", now)).toBe(0);
  });

  it("parses an HTTP date", () => {
    expect(parseRetryAfterMs("Tue, 28 Jul 2026 12:01:00 GMT", now)).toBe(60_000);
  });

  it("clamps a past date to zero", () => {
    expect(parseRetryAfterMs("Tue, 28 Jul 2026 11:00:00 GMT", now)).toBe(0);
  });

  it("caps an absurdly distant value so one receiver cannot park the queue", () => {
    expect(parseRetryAfterMs("999999999", now)).toBe(MAX_RETRY_DELAY_MS);
  });

  it("clamps a negative delay-seconds to retry-immediately", () => {
    expect(parseRetryAfterMs("-5", now)).toBe(0);
  });

  it("returns null for absent or unparseable values", () => {
    expect(parseRetryAfterMs(null, now)).toBeNull();
    expect(parseRetryAfterMs(undefined, now)).toBeNull();
    expect(parseRetryAfterMs("", now)).toBeNull();
    expect(parseRetryAfterMs("   ", now)).toBeNull();
    expect(parseRetryAfterMs("soon", now)).toBeNull();
  });
});

describe("decideRetry", () => {
  it("schedules another attempt while the budget remains", () => {
    const decision = decideRetry({
      attempts: 1,
      maxRetries: 5,
      failureKind: "retryable",
      backoff: noJitter,
    });

    expect(decision).toEqual({ action: "retry", delayMs: BASE_RETRY_DELAY_MS });
  });

  it("dead letters once attempts reach maxRetries", () => {
    expect(
      decideRetry({ attempts: 5, maxRetries: 5, failureKind: "retryable" }),
    ).toEqual({ action: "dead_letter", reason: "retries_exhausted" });
  });

  it("dead letters immediately on a permanent failure, budget notwithstanding", () => {
    expect(
      decideRetry({ attempts: 1, maxRetries: 5, failureKind: "permanent" }),
    ).toEqual({ action: "dead_letter", reason: "non_retryable_response" });
  });

  it("prefers a Retry-After hint over the exponential delay", () => {
    const decision = decideRetry({
      attempts: 3,
      maxRetries: 5,
      failureKind: "retryable",
      retryAfterMs: 7_500,
      backoff: noJitter,
    });

    expect(decision).toEqual({ action: "retry", delayMs: 7_500 });
  });

  it("falls back to backoff when Retry-After is absent", () => {
    const decision = decideRetry({
      attempts: 2,
      maxRetries: 5,
      failureKind: "retryable",
      retryAfterMs: null,
      backoff: noJitter,
    });

    expect(decision).toEqual({ action: "retry", delayMs: BASE_RETRY_DELAY_MS * 2 });
  });

  it("respects a Retry-After of zero rather than treating it as missing", () => {
    const decision = decideRetry({
      attempts: 2,
      maxRetries: 5,
      failureKind: "retryable",
      retryAfterMs: 0,
      backoff: noJitter,
    });

    expect(decision).toEqual({ action: "retry", delayMs: 0 });
  });
});

describe("DELIVERY_STATUSES", () => {
  it("declares the full lifecycle", () => {
    expect([...DELIVERY_STATUSES]).toEqual([
      "pending",
      "delivering",
      "success",
      "dead_letter",
    ]);
  });
});
