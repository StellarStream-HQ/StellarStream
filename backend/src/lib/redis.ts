import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  enableOfflineQueue: false,
  retryStrategy(times: number) {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
});

redis.on('error', (err: Error) => {
  console.error('[Redis] Connection error:', err.message);
});

redis.on('connect', () => {
  console.log('[Redis] Connected');
});

/**
 * Connect and verify Redis is available. Call before app.listen when using rate limiter.
 */
export async function ensureRedis(): Promise<void> {
  await redis.ping();
}

/**
 * Close Redis connection. Call on graceful shutdown.
 */
export async function closeRedis(): Promise<void> {
  await redis.quit();
}
