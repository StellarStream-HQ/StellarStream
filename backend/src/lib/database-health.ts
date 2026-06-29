import { randomUUID } from "crypto";
import { logger } from "../logger.js";
import { prisma } from "./db.js";

// Node typings are not always present in this repo, so keep runtime code
// dependency-free from TS lib/dom definitions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _setTimeout: any = setTimeout;



export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

type Metrics = {
  attempts: number;
  successes: number;
  failures: number;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const DEFAULTS = {
  initialMinTimeoutMs: 1000,
  maxTimeoutMs: 32000,
  retries: 6, // total retry attempts (async-retry style); we treat as max extra attempts

  consecutiveFailuresToOpen: 5,
  halfOpenAfterMs: 30_000,

  dbConnectivityQuery: "SELECT 1" as const,
};

class DatabaseCircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private lastFailureTime?: Date;

  getState(): CircuitState {
    return this.state;
  }

  async execute<T>(operation: () => Promise<T>, correlationId?: string): Promise<T> {
    if (this.state === "OPEN") {
      const last = this.lastFailureTime?.getTime() ?? 0;
      const timeSinceFailure = Date.now() - last;

      if (timeSinceFailure > DEFAULTS.halfOpenAfterMs) {
        this.state = "HALF_OPEN";
        logger.warn("[db-circuit] transitioning to HALF_OPEN", {
          correlationId,
        });
      } else {
        throw new Error("Database circuit breaker is OPEN");
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    if (this.state !== "CLOSED") {
      this.state = "CLOSED";
      logger.info("[db-circuit] transitioning to CLOSED", {
        reason: "success",
      });
    } else {
      this.state = "CLOSED";
    }
  }

  private onFailure() {
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.failureCount >= DEFAULTS.consecutiveFailuresToOpen) {
      if (this.state !== "OPEN") {
        this.state = "OPEN";
        logger.error("[db-circuit] opened after consecutive failures", {
          failureCount: this.failureCount,
        });
      } else {
        this.state = "OPEN";
      }
    }
  }
}

const breaker = new DatabaseCircuitBreaker();

// In-memory metrics (best-effort, process-local)
const metrics: Metrics = {
  attempts: 0,
  successes: 0,
  failures: 0,
};

let initialized = false;

export function getDbHealthState(): {
  state: CircuitState;
  metrics: Metrics;
  lastAttemptedAt?: number;
} {
  return {
    state: breaker.getState(),
    metrics: { ...metrics },
  };
}

export async function initDatabaseWithRetry(correlationId?: string): Promise<void> {
  if (initialized) return;
  initialized = true;

  const cid = correlationId ?? randomUUID();
  logger.info("[db] initDatabaseWithRetry starting", { correlationId: cid });

  // Retry connect with exponential backoff: 1,2,4,8,16,32 (max 6 attempts)
  // Note: prisma.$connect() is safe to call multiple times; Prisma will manage.
  const timeouts = [
    DEFAULTS.initialMinTimeoutMs,
    2_000,
    4_000,
    8_000,
    16_000,
    32_000,
  ];

  let lastErr: unknown;
  metrics.attempts = 0;
  metrics.successes = 0;
  metrics.failures = 0;

  for (let attemptIndex = 0; attemptIndex < timeouts.length; attemptIndex++) {
    metrics.attempts++;

    try {
      await prisma.$connect();
      metrics.successes++;
      logger.info("[db] connected successfully", {
        correlationId: cid,
        attempt: attemptIndex + 1,
      });
      // Reset breaker on success by running a no-op through it
      // (this keeps behavior consistent)
      await breaker.execute(async () => true, cid);
      return;
    } catch (err: any) {
      lastErr = err;
      metrics.failures++;
      const errorCode = err?.code;

      logger.warn("[db] connection attempt failed", {
        correlationId: cid,
        attempt: attemptIndex + 1,
        errorMessage: err?.message,
        errorCode,
      });

      // Don't retry on authentication/credential errors
      if (errorCode === "P1001" || errorCode === "P1002") {
        throw err;
      }

      const timeout = timeouts[attemptIndex];
      if (attemptIndex < timeouts.length - 1) {
        await sleep(timeout);
      }
    }
  }

  logger.error("[db] initDatabaseWithRetry exhausted retries", {
    correlationId: cid,
  });
  throw lastErr;
}

export async function checkDbConnection(correlationId?: string): Promise<boolean> {
  const cid = correlationId ?? randomUUID();
  try {
    await breaker.execute(async () => {
      // Ensure Prisma can perform at least one simple query.
      // Use a minimal raw query.
      await prisma.$queryRawUnsafe(DEFAULTS.dbConnectivityQuery);
      return true;
    }, cid);

    return true;
  } catch (err) {
    logger.warn("[db] checkDbConnection degraded/unhealthy", {
      correlationId: cid,
      state: breaker.getState(),
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function executeDb<T>(
  operation: () => Promise<T>,
  correlationId?: string,
): Promise<T> {
  const cid = correlationId ?? randomUUID();
  return breaker.execute(operation, cid);
}

