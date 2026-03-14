/**
 * Redis Caching Utility
 * Purpose: High-performance caching for location filters (states, cities, colonias)
 * TTL: 24 hours
 * Fallback: Graceful degradation to direct DB queries if Redis unavailable
 */

import Redis from 'ioredis';

class CacheService {
  private redis: Redis | null = null;
  private isConnected: boolean = false;

  constructor() {
    this.initializeRedis();
  }

  /**
   * Initialize Redis connection with error handling
   */
  private initializeRedis() {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      
      this.redis = new Redis(redisUrl, {
        retryStrategy: (times) => {
          // Stop retrying after 3 attempts
          if (times > 3) {
            console.warn('[CACHE] Redis connection failed after 3 attempts. Using direct DB queries.');
            return null;
          }
          // Retry with exponential backoff
          return Math.min(times * 100, 3000);
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
      });

      // Connection event handlers
      this.redis.on('connect', () => {
        console.log('[CACHE] Redis connected successfully');
        this.isConnected = true;
      });

      this.redis.on('ready', () => {
        console.log('[CACHE] Redis ready to accept commands');
      });

      this.redis.on('error', (err) => {
        console.warn('[CACHE] Redis connection error:', err.message);
        this.isConnected = false;
      });

      this.redis.on('close', () => {
        console.log('[CACHE] Redis connection closed');
        this.isConnected = false;
      });

      // Attempt connection
      this.redis.connect().catch((err) => {
        console.warn('[CACHE] Could not connect to Redis:', err.message);
        console.warn('[CACHE] Falling back to direct database queries');
        this.isConnected = false;
      });
    } catch (error) {
      console.warn('[CACHE] Redis initialization failed:', error);
      this.redis = null;
      this.isConnected = false;
    }
  }

  /**
   * Get cached data by key
   * @param key - Cache key
   * @returns Cached data or null
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.isConnected || !this.redis) {
      return null; // Graceful fallback
    }

    try {
      const cached = await this.redis.get(key);
      if (cached) {
        return JSON.parse(cached) as T;
      }
      return null;
    } catch (error) {
      console.warn(`[CACHE] Error retrieving key "${key}":`, error);
      return null; // Graceful fallback
    }
  }

  /**
   * Set cached data with TTL
   * @param key - Cache key
   * @param value - Data to cache
   * @param ttlSeconds - Time to live in seconds (default: 24 hours)
   */
  async set(key: string, value: any, ttlSeconds: number = 86400): Promise<void> {
    if (!this.isConnected || !this.redis) {
      return; // Skip caching if Redis unavailable
    }

    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      console.warn(`[CACHE] Error setting key "${key}":`, error);
      // Don't throw - caching is optional
    }
  }

  /**
   * Invalidate cache by key pattern
   * @param pattern - Key pattern (e.g., "location:*")
   */
  async invalidate(pattern: string): Promise<void> {
    if (!this.isConnected || !this.redis) {
      return;
    }

    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        console.log(`[CACHE] Invalidated ${keys.length} keys matching "${pattern}"`);
      }
    } catch (error) {
      console.warn(`[CACHE] Error invalidating pattern "${pattern}":`, error);
    }
  }

  /**
   * Delete specific cache key
   * @param key - Cache key to delete
   */
  async delete(key: string): Promise<void> {
    if (!this.isConnected || !this.redis) {
      return;
    }

    try {
      await this.redis.del(key);
    } catch (error) {
      console.warn(`[CACHE] Error deleting key "${key}":`, error);
    }
  }

  /**
   * Check if Redis is available
   */
  isAvailable(): boolean {
    return this.isConnected && this.redis !== null;
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}

// Export singleton instance
export const cacheService = new CacheService();
