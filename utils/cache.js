// Async caching mechanism with background refresh and file persistence
import { EventEmitter } from "events";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

class AsyncCache extends EventEmitter {
  constructor(options = {}) {
    super();
    this.cache = new Map();
    this.refreshPromises = new Map(); // Track ongoing refresh operations
    this.defaultTTL = options.defaultTTL || 5 * 60 * 1000; // 5 minutes default
    this.maxSize = options.maxSize || 1000; // Maximum cache entries
    this.refreshThreshold = options.refreshThreshold || 0.8; // Refresh when 80% of TTL has passed

    // File persistence options
    this.persistToFile = options.persistToFile !== false; // Default to true
    this.cacheDir = options.cacheDir || path.join(process.cwd(), ".cache");
    this.fileWriteDebounce = options.fileWriteDebounce || 1000; // Debounce file writes
    this.pendingWrites = new Map(); // Track pending file writes

    // Initialize cache directory and load existing cache
    if (this.persistToFile) {
      this.initializeCacheDir().then(() => {
        this.loadCacheFromFiles();
      });
    }

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // Cleanup every minute
  }

  /**
   * Initialize cache directory
   */
  async initializeCacheDir() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      this.emit("cacheDir", { path: this.cacheDir, created: true });
    } catch (error) {
      console.error("Failed to create cache directory:", error);
      this.persistToFile = false; // Disable file persistence on error
    }
  }

  /**
   * Generate a safe filename from cache key
   */
  getFilePath(key) {
    const hash = crypto.createHash("sha256").update(key).digest("hex");
    return path.join(this.cacheDir, `${hash}.json`);
  }

  /**
   * Load cache from existing JSON files
   */
  async loadCacheFromFiles() {
    if (!this.persistToFile) return;

    try {
      const files = await fs.readdir(this.cacheDir);
      const jsonFiles = files.filter((file) => file.endsWith(".json"));

      let loadedCount = 0;
      let expiredCount = 0;
      const now = Date.now();

      for (const file of jsonFiles) {
        try {
          const filePath = path.join(this.cacheDir, file);
          const content = await fs.readFile(filePath, "utf8");
          const { key, entry } = JSON.parse(content);

          // Check if entry is still valid
          if (now <= entry.expiresAt) {
            this.cache.set(key, entry);
            loadedCount++;
          } else {
            // Remove expired file
            await fs.unlink(filePath);
            expiredCount++;
          }
        } catch (error) {
          console.warn(`Failed to load cache file ${file}:`, error.message);
        }
      }

      this.emit("cacheLoaded", { loadedCount, expiredCount });
    } catch (error) {
      console.error("Failed to load cache from files:", error);
    }
  }

  /**
   * Save cache entry to file (debounced)
   */
  async saveCacheEntryToFile(key, entry) {
    if (!this.persistToFile) return;

    // Clear existing timeout for this key
    if (this.pendingWrites.has(key)) {
      clearTimeout(this.pendingWrites.get(key));
    }

    // Set new debounced write
    const timeout = setTimeout(async () => {
      try {
        const filePath = this.getFilePath(key);
        const data = JSON.stringify({ key, entry }, null, 2);
        await fs.writeFile(filePath, data, "utf8");
        this.pendingWrites.delete(key);
        this.emit("fileSaved", { key, filePath });
      } catch (error) {
        console.error(`Failed to save cache file for key ${key}:`, error);
        this.pendingWrites.delete(key);
      }
    }, this.fileWriteDebounce);

    this.pendingWrites.set(key, timeout);
  }

  /**
   * Remove cache file
   */
  async removeCacheFile(key) {
    if (!this.persistToFile) return;

    // Cancel pending write
    if (this.pendingWrites.has(key)) {
      clearTimeout(this.pendingWrites.get(key));
      this.pendingWrites.delete(key);
    }

    try {
      const filePath = this.getFilePath(key);
      await fs.unlink(filePath);
      this.emit("fileDeleted", { key, filePath });
    } catch (error) {
      // File might not exist, which is fine
      if (error.code !== "ENOENT") {
        console.error(`Failed to delete cache file for key ${key}:`, error);
      }
    }
  }

  /**
   * Generate a cache key from request parameters
   */
  generateKey(req) {
    const { path, query, body } = req;
    return JSON.stringify({ path, query, body });
  }

  /**
   * Get cached data and potentially trigger background refresh
   */
  async get(key, refreshFunction, ttl = this.defaultTTL) {
    const entry = this.cache.get(key);
    const now = Date.now();

    // If no cache entry exists, fetch fresh data
    if (!entry) {
      return this.fetchAndCache(key, refreshFunction, ttl);
    }

    // Check if cache has expired
    if (now > entry.expiresAt) {
      // Cache expired, fetch fresh data
      return this.fetchAndCache(key, refreshFunction, ttl);
    }

    // Check if we should refresh in background
    const refreshAt = entry.createdAt + ttl * this.refreshThreshold;
    if (now > refreshAt && !this.refreshPromises.has(key)) {
      // Trigger background refresh
      this.refreshInBackground(key, refreshFunction, ttl);
    }

    // Return cached data immediately
    return {
      data: entry.data,
      fromCache: true,
      age: now - entry.createdAt
    };
  }

  /**
   * Fetch fresh data and cache it
   */
  async fetchAndCache(key, refreshFunction, ttl) {
    try {
      // Check if there's already a refresh in progress for this key
      if (this.refreshPromises.has(key)) {
        const data = await this.refreshPromises.get(key);
        return {
          data,
          fromCache: false,
          age: 0
        };
      }

      // Create refresh promise
      const refreshPromise = refreshFunction();
      this.refreshPromises.set(key, refreshPromise);

      const data = await refreshPromise;

      // Cache the result
      this.set(key, data, ttl);

      // Clean up refresh promise
      this.refreshPromises.delete(key);

      return {
        data,
        fromCache: false,
        age: 0
      };
    } catch (error) {
      // Clean up refresh promise on error
      this.refreshPromises.delete(key);

      // If we have stale cache data, return it with error info
      const entry = this.cache.get(key);
      if (entry) {
        console.warn(
          `Cache refresh failed for key ${key}, serving stale data:`,
          error.message
        );
        return {
          data: entry.data,
          fromCache: true,
          stale: true,
          age: Date.now() - entry.createdAt,
          error: error.message
        };
      }

      // No cache data available, throw the error
      throw error;
    }
  }

  /**
   * Refresh cache in background without blocking the response
   */
  refreshInBackground(key, refreshFunction, ttl) {
    // Don't start multiple background refreshes for the same key
    if (this.refreshPromises.has(key)) {
      return;
    }

    const refreshPromise = refreshFunction()
      .then((data) => {
        this.set(key, data, ttl);
        this.emit("backgroundRefresh", { key, success: true });
        return data;
      })
      .catch((error) => {
        console.warn(
          `Background refresh failed for key ${key}:`,
          error.message
        );
        this.emit("backgroundRefresh", {
          key,
          success: false,
          error: error.message
        });
      })
      .finally(() => {
        this.refreshPromises.delete(key);
      });

    this.refreshPromises.set(key, refreshPromise);
  }

  /**
   * Set cache entry
   */
  set(key, data, ttl = this.defaultTTL) {
    // Enforce max cache size
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      // Remove oldest entry
      const oldestKey = this.cache.keys().next().value;
      this.delete(oldestKey);
    }

    const now = Date.now();
    const entry = {
      data,
      createdAt: now,
      expiresAt: now + ttl,
      ttl
    };

    this.cache.set(key, entry);

    // Save to file
    this.saveCacheEntryToFile(key, entry);

    this.emit("set", { key, size: this.cache.size });
  }

  /**
   * Delete cache entry
   */
  delete(key) {
    const deleted = this.cache.delete(key);
    if (deleted) {
      // Remove file
      this.removeCacheFile(key);
      this.emit("delete", { key, size: this.cache.size });
    }
    return deleted;
  }

  /**
   * Clear all cache entries
   */
  async clear() {
    const size = this.cache.size;

    // Clear all pending writes
    for (const timeout of this.pendingWrites.values()) {
      clearTimeout(timeout);
    }
    this.pendingWrites.clear();

    // Remove all cache files
    if (this.persistToFile) {
      try {
        const files = await fs.readdir(this.cacheDir);
        const jsonFiles = files.filter((file) => file.endsWith(".json"));

        await Promise.all(
          jsonFiles.map((file) =>
            fs.unlink(path.join(this.cacheDir, file)).catch(() => {})
          )
        );
      } catch (error) {
        console.error("Failed to clear cache files:", error);
      }
    }

    this.cache.clear();
    this.refreshPromises.clear();
    this.emit("clear", { previousSize: size });
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.delete(key); // This will also remove the file
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.emit("cleanup", { cleanedCount, remainingSize: this.cache.size });
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const now = Date.now();
    let expiredCount = 0;
    let totalAge = 0;

    for (const entry of this.cache.values()) {
      if (now > entry.expiresAt) {
        expiredCount++;
      }
      totalAge += now - entry.createdAt;
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      expiredCount,
      activeRefreshes: this.refreshPromises.size,
      pendingWrites: this.pendingWrites.size,
      persistToFile: this.persistToFile,
      cacheDir: this.cacheDir,
      averageAge:
        this.cache.size > 0 ? Math.round(totalAge / this.cache.size) : 0
    };
  }

  /**
   * Destroy cache and cleanup resources
   */
  async destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Clear all pending writes
    for (const timeout of this.pendingWrites.values()) {
      clearTimeout(timeout);
    }
    this.pendingWrites.clear();

    await this.clear();
    this.removeAllListeners();
  }
}

// Create default cache instance
export const cache = new AsyncCache({
  defaultTTL: 5 * 60 * 1000, // 5 minutes
  maxSize: 1000,
  refreshThreshold: 0.8 // Refresh when 80% of TTL has passed
});

// Cache middleware factory
export function createCacheMiddleware(options = {}) {
  const {
    ttl = cache.defaultTTL,
    keyGenerator = (req) => cache.generateKey(req),
    shouldCache = () => true,
    onCacheHit = () => {},
    onCacheMiss = () => {},
    onError = (error) => console.error("Cache error:", error)
  } = options;

  return function cacheMiddleware(req, res, next) {
    // Skip caching for non-GET requests by default
    if (req.method !== "GET" && !shouldCache(req)) {
      return next();
    }

    const cacheKey = keyGenerator(req);

    // Store original res.json to intercept response
    const originalJson = res.json.bind(res);
    let responseSent = false;

    // Create refresh function that calls the next middleware/route handler
    const refreshFunction = () => {
      return new Promise((resolve, reject) => {
        // Override res.json to capture the response data
        res.json = function (data) {
          if (!responseSent) {
            resolve(data);
          }
          return res;
        };

        // Call next middleware/route handler
        next();

        // Set a timeout to handle cases where next() doesn't call res.json
        setTimeout(() => {
          if (!responseSent) {
            reject(
              new Error("Route handler did not send response within timeout")
            );
          }
        }, 30000); // 30 second timeout
      });
    };

    // Try to get cached data
    cache
      .get(cacheKey, refreshFunction, ttl)
      .then((result) => {
        if (!responseSent) {
          responseSent = true;

          // Add cache headers
          res.set({
            "X-Cache": result.fromCache ? "HIT" : "MISS",
            "X-Cache-Age": result.age ? Math.round(result.age / 1000) : 0,
            "X-Cache-Stale": result.stale ? "true" : "false"
          });

          if (result.fromCache) {
            onCacheHit(req, result);
          } else {
            onCacheMiss(req, result);
          }

          // Restore original res.json and send response
          res.json = originalJson;
          res.json(result.data);
        }
      })
      .catch((error) => {
        if (!responseSent) {
          responseSent = true;
          onError(error);

          // Restore original res.json
          res.json = originalJson;

          // Let the error bubble up to Express error handler
          next(error);
        }
      });
  };
}

export default AsyncCache;
