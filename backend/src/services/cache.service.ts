import Redis from "ioredis";
import { logger } from "../logger.js";

const redis = new (Redis as any)(process.env.REDIS_URL || "redis://localhost:6379");

export class CacheService {
  private static readonly CACHE_KEYS = {
    PROTOCOL_STATS: "protocol:stats",
    PRICES: "prices",
    TVL: "tvl",
    ACTIVE_STREAMS: "active:streams",
  };

  /**
   * Get cached value or compute and cache
   */
  async getOrCompute<T>(
    key: string,
    ttlSeconds: number,
    compute: () => Promise<T>
  ): Promise<T> {
    try {
      const cached = await redis.get(key);
      if (cached) {
        logger.debug(`Cache hit: ${key}`);
        return JSON.parse(cached);
      }
    } catch (error) {
      logger.warn(`Cache read error for ${key}`, error);
    }

    const value = await compute();

    try {
      await redis.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      logger.warn(`Cache write error for ${key}`, error);
    }

    return value;
  }

  /**
   * Cache protocol stats (5 minute TTL)
   */
  async cacheProtocolStats(stats: any): Promise<void> {
    try {
      await redis.setex(
        CacheService.CACHE_KEYS.PROTOCOL_STATS,
        300,
        JSON.stringify(stats)
      );
    } catch (error) {
      logger.warn("Error caching protocol stats", error);
    }
  }

  /**
   * Get cached protocol stats
   */
  async getProtocolStats(): Promise<any | null> {
    try {
      const cached = await redis.get(CacheService.CACHE_KEYS.PROTOCOL_STATS);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.warn("Error retrieving cached protocol stats", error);
      return null;
    }
  }

  /**
   * Cache token prices (60 second TTL)
   */
  async cachePrices(prices: any): Promise<void> {
    try {
      await redis.setex(
        CacheService.CACHE_KEYS.PRICES,
        60,
        JSON.stringify(prices)
      );
    } catch (error) {
      logger.warn("Error caching prices", error);
    }
  }

  /**
   * Get cached prices
   */
  async getPrices(): Promise<any | null> {
    try {
      const cached = await redis.get(CacheService.CACHE_KEYS.PRICES);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.warn("Error retrieving cached prices", error);
      return null;
    }
  }

  /**
   * Invalidate cache key
   */
  async invalidate(key: string): Promise<void> {
    try {
      await redis.del(key);
    } catch (error) {
      logger.warn(`Error invalidating cache key ${key}`, error);
    }
  }

  /**
   * Invalidate all caches
   */
  async invalidateAll(): Promise<void> {
    try {
      await redis.del(
        Object.values(CacheService.CACHE_KEYS)
      );
    } catch (error) {
      logger.warn("Error invalidating all caches", error);
    }
  }
}
