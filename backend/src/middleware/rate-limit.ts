import rateLimit, { Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import Redis from 'ioredis';

/**
 * Creates a Redis client if REDIS_URL is configured, otherwise returns null.
 * The rate limiters fall back to in-memory store when Redis is unavailable.
 */
function createRedisClient(): any {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn('[rate-limit] REDIS_URL not set — falling back to in-memory store');
    return null;
  }

  const client = new (Redis as any)(redisUrl, { lazyConnect: true, enableOfflineQueue: false });

  client.on('error', (err: Error) => {
    console.error('[rate-limit] Redis error:', err.message);
  });

  return client;
}

const redisClient = createRedisClient();

/**
 * Builds a RedisStore for express-rate-limit when a Redis client is available.
 */
function buildStore(prefix: string): Partial<Options> {
  if (!redisClient) return {};

  return {
    store: new RedisStore({
      prefix,
      // rate-limit-redis expects a sendCommand function
      sendCommand: (...args: string[]) =>
        redisClient.call(args[0] as string, ...args.slice(1)) as Promise<number>,
    }),
  };
}

/**
 * Global rate limit: 100 requests per 15 minutes per IP.
 * Applied to all routes.
 */
export const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,   // Return X-RateLimit-* headers
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.', code: 429 },
  ...buildStore('rl:global:'),
});

/**
 * Sensitive route limit: 5 requests per minute per IP.
 * Applied to /auth/challenge and /webhook/register.
 */
export const sensitiveRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests on this endpoint, please slow down.', code: 429 },
  ...buildStore('rl:sensitive:'),
});
