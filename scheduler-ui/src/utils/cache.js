/**
 * Simple in-memory cache for Firebase data and API responses
 * Prevents redundant network calls for data that rarely changes
 */

class DataCache {
  constructor() {
    this.cache = new Map();
    this.timestamps = new Map();
    this.defaultTTL = 5 * 60 * 1000; // 5 minutes default
  }

  /**
   * Set a value in the cache with optional TTL (time to live)
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in milliseconds (default: 5 minutes)
   */
  set(key, value, ttl = this.defaultTTL) {
    this.cache.set(key, value);
    this.timestamps.set(key, {
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl
    });
  }

  /**
   * Get a value from the cache if it exists and hasn't expired
   * @param {string} key - Cache key
   * @returns {any|null} Cached value or null if expired/missing
   */
  get(key) {
    if (!this.cache.has(key)) {
      return null;
    }

    const timestamp = this.timestamps.get(key);
    if (!timestamp || Date.now() > timestamp.expiresAt) {
      // Expired, remove it
      this.cache.delete(key);
      this.timestamps.delete(key);
      return null;
    }

    return this.cache.get(key);
  }

  /**
   * Check if a key exists and is valid (not expired)
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Invalidate (remove) a specific cache entry
   * Returns a Promise for async-safe operations
   * @param {string} key - Cache key
   * @returns {Promise<void>}
   */
  invalidate(key) {
    return Promise.resolve().then(() => {
      this.cache.delete(key);
      this.timestamps.delete(key);
      console.log(`🗑️ Cache invalidated: ${key}`);
    });
  }

  /**
   * Invalidate all cache entries matching a pattern
   * @param {string|RegExp} pattern - String prefix or regex pattern
   */
  invalidatePattern(pattern) {
    const keys = Array.from(this.cache.keys());
    const regex = typeof pattern === 'string'
      ? new RegExp(`^${pattern}`)
      : pattern;

    keys.forEach(key => {
      if (regex.test(key)) {
        this.invalidate(key);
      }
    });
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear();
    this.timestamps.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} Stats about cache size and entries
   */
  getStats() {
    const now = Date.now();
    const entries = Array.from(this.cache.keys()).map(key => ({
      key,
      timestamp: this.timestamps.get(key),
      isExpired: now > (this.timestamps.get(key)?.expiresAt || 0)
    }));

    return {
      size: this.cache.size,
      entries: entries.length,
      expired: entries.filter(e => e.isExpired).length,
      keys: entries.map(e => e.key)
    };
  }
}

// Singleton instance
const cache = new DataCache();

export default cache;

/**
 * Helper to wrap async functions with caching
 * @param {string} cacheKey - Key to use for caching
 * @param {Function} fetchFn - Async function that fetches the data
 * @param {number} ttl - Time to live in milliseconds
 * @returns {Promise<any>} Cached or freshly fetched data
 */
export async function withCache(cacheKey, fetchFn, ttl) {
  const cached = cache.get(cacheKey);
  if (cached !== null) {
    console.log(`[Cache HIT] ${cacheKey}`);
    return cached;
  }

  console.log(`[Cache MISS] ${cacheKey} - fetching...`);
  const data = await fetchFn();
  cache.set(cacheKey, data, ttl);
  return data;
}

/**
 * Helper to invalidate all schedule-related caches
 * Call this when a schedule is updated/deleted
 * @param {string} weekStart - Optional week start to invalidate specific week (YYYY-MM-DD format)
 */
export function invalidateScheduleCaches(weekStart = null) {
  if (weekStart) {
    // Invalidate specific week
    cache.invalidate(`schedule:${weekStart}`);
    cache.invalidate(`leaves:${weekStart}`);
    console.log(`[Cache] Invalidated caches for week ${weekStart}`);
  } else {
    // Invalidate all schedules and leaves
    cache.invalidatePattern(/^schedule:/);
    cache.invalidatePattern(/^leaves:/);
    console.log('[Cache] Invalidated all schedule and leave caches');
  }
}

/**
 * Helper to invalidate team/admin data caches
 * Call this when team members or admin list is updated
 */
export function invalidateTeamCaches() {
  cache.invalidate('teamMembers');
  cache.invalidate('adminEmails');
  console.log('[Cache] Invalidated team and admin caches');
}
