import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { redis } from '../lib/redis.js';

const PUBLIC_POINTS = 100;
const PUBLIC_DURATION_SEC = 60;
const DEFAULT_PARTNER_POINTS = 1000;
const PARTNER_DURATION_SEC = 60;

// Sensitive endpoints: 5 req/min (auth challenge, webhook register)
const SENSITIVE_POINTS = 5;
const SENSITIVE_DURATION_SEC = 60;

const publicLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:public',
  points: PUBLIC_POINTS,
  duration: PUBLIC_DURATION_SEC,
});

// Default partner limiter — used when no per-key override is needed
const defaultPartnerLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:partner',
  points: DEFAULT_PARTNER_POINTS,
  duration: PARTNER_DURATION_SEC,
});

const sensitiveLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:sensitive',
  points: SENSITIVE_POINTS,
  duration: SENSITIVE_DURATION_SEC,
});

/** Returns a per-key limiter when the key has a custom rateLimit value. */
function getPartnerLimiter(_keyId: string, points: number): RateLimiterRedis {
  if (points === DEFAULT_PARTNER_POINTS) return defaultPartnerLimiter;
  return new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: `rl:partner:${points}`,
    points,
    duration: PARTNER_DURATION_SEC,
  });
}

function getRateLimitKey(req: Request): string {
  if (req.authenticated && req.authenticatedKeyId) {
    return `apikey:${req.authenticatedKeyId}`;
  }
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

/** Attach X-RateLimit-Limit and X-RateLimit-Remaining headers to the response. */
function setRateLimitHeaders(res: Response, limit: number, rateLimiterRes: RateLimiterRes): void {
  res.set('X-RateLimit-Limit', String(limit));
  res.set('X-RateLimit-Remaining', String(rateLimiterRes.remainingPoints));
}

/**
 * Tiered rate limit:
 *   - Public (unauthenticated): 100 req/min by IP
 *   - Partner (authenticated API key): per-key rateLimit from DB (default 1000 req/min)
 *
 * Returns X-RateLimit-Limit and X-RateLimit-Remaining headers on every response.
 */
export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const key = getRateLimitKey(req);

  let limiter: RateLimiterRedis;
  let limit: number;

  if (req.authenticated && req.authenticatedKeyId) {
    const points = req.apiKeyRateLimit ?? DEFAULT_PARTNER_POINTS;
    limiter = getPartnerLimiter(req.authenticatedKeyId, points);
    limit = points;
  } else {
    limiter = publicLimiter;
    limit = PUBLIC_POINTS;
  }

  limiter
    .consume(key)
    .then((rateLimiterRes) => {
      setRateLimitHeaders(res, limit, rateLimiterRes);
      next();
    })
    .catch((rejRes) => {
      if (rejRes instanceof Error) {
        res.status(503).json({
          error: 'Rate limit unavailable',
          message: 'Service temporarily unable to check rate limit. Try again later.',
        });
        return;
      }
      const rlRes = rejRes as RateLimiterRes;
      const secs = Math.round((rlRes.msBeforeNext ?? 1000) / 1000) || 1;
      res.set('Retry-After', String(secs));
      res.set('X-RateLimit-Limit', String(limit));
      res.set('X-RateLimit-Remaining', '0');
      res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${secs} seconds.`,
      });
    });
}

/**
 * Strict rate limit for sensitive endpoints (/auth/challenge, /webhook/register):
 * 5 req/min per IP. Returns X-RateLimit-Limit and X-RateLimit-Remaining headers.
 */
export function sensitiveRateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip ?? req.socket?.remoteAddress ?? 'unknown';

  sensitiveLimiter
    .consume(key)
    .then((rateLimiterRes) => {
      setRateLimitHeaders(res, SENSITIVE_POINTS, rateLimiterRes);
      next();
    })
    .catch((rejRes) => {
      if (rejRes instanceof Error) {
        res.status(503).json({
          error: 'Rate limit unavailable',
          message: 'Service temporarily unable to check rate limit. Try again later.',
        });
        return;
      }
      const rlRes = rejRes as RateLimiterRes;
      const secs = Math.round((rlRes.msBeforeNext ?? 1000) / 1000) || 1;
      res.set('Retry-After', String(secs));
      res.set('X-RateLimit-Limit', String(SENSITIVE_POINTS));
      res.set('X-RateLimit-Remaining', '0');
      res.status(429).json({
        error: 'Too Many Requests',
        message: `Sensitive endpoint rate limit exceeded. Try again in ${secs} seconds.`,
      });
    });
}

function isLocalhostDev(req: Request): boolean {
  const ip = (req.ip ?? '').toString();
  const ra = (req.socket?.remoteAddress ?? '').toString();
  return ip === '127.0.0.1' || ip === '::1' || ra === '127.0.0.1' || ra === '::1';
}

function computeExponentialDelaySeconds(params: {
  // delay starts at `initialBackoffSeconds` when threshold is first exceeded,
  // then doubles each additional exceeded window (attempt grows).
  initialBackoffSeconds: number;
  attempt: number;
  maxSeconds: number;
}): number {
  const { initialBackoffSeconds, attempt, maxSeconds } = params;

  // attempt=1 => initial, attempt=2 => 2x, etc.
  const exp = Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(maxSeconds, Math.round(initialBackoffSeconds * exp));
}


async function checkAndConsumeExponentialBackoff(params: {
  redisKeyBase: string;
  ip: string;
  nowMs: number;
  maxAttempts: number;
  windowSec: number;
  // when attempts exceed maxAttempts, we apply backoff lock
  baseBackoffSec: number;
  maxBackoffSec: number;
}): Promise<{ allowed: boolean; retryAfterSec: number; lockedUntilMs: number; failureStreak: number }> {
  const {
    redisKeyBase,
    ip,
    nowMs,
    maxAttempts,
    windowSec,
    baseBackoffSec,
    maxBackoffSec,
  } = params;

  // Track failures with a sliding window-ish counter using a TTL on a Redis key.
  const counterKey = `${redisKeyBase}:ctr:${ip}`;
  const failureKey = `${redisKeyBase}:fail:${ip}`;
  const lockedUntilKey = `${redisKeyBase}:lockedUntil:${ip}`;

  const lockedUntilStr = await redis.get(lockedUntilKey);
  const lockedUntilMs = lockedUntilStr ? parseInt(lockedUntilStr, 10) : 0;
  if (lockedUntilMs > nowMs) {
    const retryAfterSec = Math.max(1, Math.ceil((lockedUntilMs - nowMs) / 1000));
    const failureStreak = (await redis.get(failureKey)).then((v: string | null) =>
      v ? parseInt(v, 10) : 0,
    );
    return {
      allowed: false,
      retryAfterSec,
      lockedUntilMs,
      failureStreak: await failureStreak,
    };

  }

  const multi = redis.multi();
  multi.incr(counterKey);
  multi.expire(counterKey, windowSec);
  const execRes = await multi.exec();
  const counterRes = execRes?.[0]?.[1];
  const current = typeof counterRes === 'number' ? counterRes : parseInt(String(counterRes ?? '0'), 10);

  if (current <= maxAttempts) {
    return { allowed: true, retryAfterSec: 0, lockedUntilMs: 0, failureStreak: 0 };
  }

  const failure = await redis.incr(failureKey);
  await redis.expire(failureKey, windowSec * 2);

  const backoffSec = computeExponentialDelaySeconds({
    initialBackoffSeconds: baseBackoffSec,
    attempt: failure,
    maxSeconds: maxBackoffSec,
  });


  const newLockedUntilMs = nowMs + backoffSec * 1000;
  await redis.set(lockedUntilKey, String(newLockedUntilMs), 'EX', backoffSec);

  return {
    allowed: false,
    retryAfterSec: Math.max(1, backoffSec),
    lockedUntilMs: newLockedUntilMs,
    failureStreak: failure,
  };
}

/**
 * Exponential backoff limiter for authentication endpoints.
 * - Uses Redis for distributed tracking.
 * - Returns 429 with Retry-After.
 * - Bypasses localhost (127.0.0.1 / ::1).
 */
export function authExponentialBackoffRateLimit(params: {
  redisKeyBase: string;
  maxAttempts: number;
  windowSec: number;
  // baseBackoffSec doubles each failure until maxBackoffSec
  baseBackoffSec: number;
  maxBackoffSec: number;
}): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isLocalhostDev(req)) {
      next();
      return;
    }

    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const nowMs = Date.now();

    checkAndConsumeExponentialBackoff({
      redisKeyBase: params.redisKeyBase,
      ip,
      nowMs,
      maxAttempts: params.maxAttempts,
      windowSec: params.windowSec,
      baseBackoffSec: params.baseBackoffSec,
      maxBackoffSec: params.maxBackoffSec,
    })
      .then((result) => {
        if (result.allowed) {
          next();
          return;
        }

        res.set('Retry-After', String(result.retryAfterSec));
        res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${result.retryAfterSec} seconds.`,
        });

        // Monitoring signal (replace with real alerting integration later)
        console.warn('[auth-rate-limit] triggered', {
          endpoint: req.originalUrl,
          ip,
          retryAfterSec: result.retryAfterSec,
          failureStreak: result.failureStreak,
        });
      })
      .catch(() => {
        // fail open: don't block auth if limiter is unhealthy
        next();
      });
  };
}

