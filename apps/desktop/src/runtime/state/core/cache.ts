class CacheEntry {
  value: unknown;
  createdAt: number;
  ttlMs: number;

  constructor(value: unknown, ttlMs = 60_000) {
    this.value = value;
    this.createdAt = Date.now();
    this.ttlMs = ttlMs;
  }

  isExpired() {
    return Date.now() - this.createdAt > this.ttlMs;
  }
}

export class MemoryCache {
  private readonly cache: Map<string, CacheEntry>;
  private readonly defaultTtlMs: number;

  constructor(defaultTtlMs = 60_000) {
    this.cache = new Map();
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key: string): unknown {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.isExpired()) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: unknown, ttlMs?: number) {
    this.cache.set(key, new CacheEntry(value, ttlMs || this.defaultTtlMs));
  }

  delete(key: string) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  invalidate(pattern: string | RegExp) {
    if (typeof pattern === 'string') {
      this.cache.forEach((_, key) => {
        if (key.includes(pattern)) {
          this.cache.delete(key);
        }
      });
      return;
    }
    this.cache.forEach((_, key) => {
      if (pattern.test(key)) {
        this.cache.delete(key);
      }
    });
  }
}
