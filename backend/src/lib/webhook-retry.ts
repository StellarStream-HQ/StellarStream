/**
 * Webhook retry policy (Issue #1348)
 *
 * Pure helpers describing *when* and *whether* a failed webhook delivery is
 * retried. Keeping the policy free of Prisma and fetch makes the backoff curve
 * and the retryable/permanent classification directly unit-testable, and lets
 * the dispatcher stay focused on I/O.
 */

/** Delivery lifecycle states persisted on WebhookDelivery.status. */
export const DELIVERY_STATUSES = [
  "pending",
  "delivering",
  "success",
  "dead_letter",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Why a delivery ended up in the dead letter queue. */
export type DeadLetterReason = "retries_exhausted" | "non_retryable_response";

export type FailureKind = "retryable" | "permanent";

// ─── Backoff configuration ───────────────────────────────────────────────────

/** Delay before the first retry. Doubles on every subsequent attempt. */
export const BASE_RETRY_DELAY_MS = 1_000;

/** Upper bound on a single backoff interval. */
export const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

/** Attempts allowed per delivery before it is dead lettered. */
export const DEFAULT_MAX_RETRIES = 5;

/**
 * Fraction of the computed delay applied as random jitter, in both directions.
 * Spreads retries out so a receiver coming back online is not hit by every
 * queued delivery in the same instant.
 */
export const RETRY_JITTER_RATIO = 0.2;

/**
 * A receiver may ask for a longer wait via Retry-After, but we cap how far it
 * can push a delivery out so a misbehaving endpoint cannot park the queue.
 */
export const MAX_RETRY_AFTER_MS = MAX_RETRY_DELAY_MS;

export interface BackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  /** Injectable for deterministic tests. Must return a value in [0, 1). */
  random?: () => number;
}

/**
 * Exponential backoff with symmetric jitter.
 *
 * `attempt` is the 1-based count of attempts already made, so the delay after
 * the first failure is `baseDelayMs`, then 2x, 4x, ... capped at `maxDelayMs`.
 */
export function computeBackoffDelayMs(
  attempt: number,
  options: BackoffOptions = {},
): number {
  const {
    baseDelayMs = BASE_RETRY_DELAY_MS,
    maxDelayMs = MAX_RETRY_DELAY_MS,
    jitterRatio = RETRY_JITTER_RATIO,
    random = Math.random,
  } = options;

  const normalizedAttempt = Math.max(1, Math.floor(attempt));

  // Exponent is clamped before the shift so a large attempt count cannot
  // overflow into Infinity on the way to the cap.
  const exponent = Math.min(normalizedAttempt - 1, 32);
  const exponential = baseDelayMs * 2 ** exponent;
  const capped = Math.min(exponential, maxDelayMs);

  const jitterSpan = capped * jitterRatio;
  const jitter = (random() * 2 - 1) * jitterSpan;

  return Math.max(0, Math.min(Math.round(capped + jitter), maxDelayMs));
}

// ─── Failure classification ──────────────────────────────────────────────────

/**
 * Statuses below 400 that still count as a failed delivery (an unfollowed
 * redirect, say) are permanent: retrying an identical request cannot help.
 */
export function classifyResponseStatus(status: number): FailureKind {
  if (status >= 500) return "retryable";
  if (status === 408 || status === 429) return "retryable";
  return "permanent";
}

/**
 * Transport-level failures (DNS, TCP reset, TLS, our own timeout abort) are
 * always assumed transient — there is no response to inspect.
 */
export function classifyTransportError(): FailureKind {
  return "retryable";
}

// ─── Retry-After ─────────────────────────────────────────────────────────────

/**
 * Parse an RFC 9110 Retry-After value, accepting both delay-seconds and an
 * HTTP date. Returns null when the header is absent or unparseable, in which
 * case the caller falls back to exponential backoff.
 */
export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!headerValue) return null;

  const trimmed = headerValue.trim();
  if (trimmed === "") return null;

  // A negative delay-seconds is nonsensical but well-defined once clamped:
  // it means "retry immediately".
  if (/^-?\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds)) return null;
    return clampRetryAfter(seconds * 1000);
  }

  const target = Date.parse(trimmed);
  if (!Number.isFinite(target)) return null;

  return clampRetryAfter(target - now.getTime());
}

function clampRetryAfter(delayMs: number): number {
  return Math.max(0, Math.min(Math.round(delayMs), MAX_RETRY_AFTER_MS));
}

// ─── Scheduling decision ─────────────────────────────────────────────────────

export interface RetryDecisionInput {
  /** Attempts already made, including the one that just failed. */
  attempts: number;
  maxRetries: number;
  failureKind: FailureKind;
  /** Delay requested by the receiver via Retry-After, when present. */
  retryAfterMs?: number | null;
  backoff?: BackoffOptions;
}

export type RetryDecision =
  | { action: "retry"; delayMs: number }
  | { action: "dead_letter"; reason: DeadLetterReason };

/**
 * Single source of truth for what happens after a failed attempt: schedule
 * another try, or move the delivery to the dead letter queue.
 */
export function decideRetry(input: RetryDecisionInput): RetryDecision {
  const { attempts, maxRetries, failureKind, retryAfterMs, backoff } = input;

  if (failureKind === "permanent") {
    return { action: "dead_letter", reason: "non_retryable_response" };
  }

  if (attempts >= maxRetries) {
    return { action: "dead_letter", reason: "retries_exhausted" };
  }

  const delayMs =
    retryAfterMs !== null && retryAfterMs !== undefined
      ? retryAfterMs
      : computeBackoffDelayMs(attempts, backoff);

  return { action: "retry", delayMs };
}
