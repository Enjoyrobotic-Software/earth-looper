/**
 * EarthOS Cache — TTL-based in-memory store with LRU eviction.
 * Prevents hammering APIs; shared by all data sources.
 */

class CacheEntry {
  constructor(data, ttl) {
    this.data    = data;
    this.expires = ttl > 0 ? Date.now() + ttl : Infinity;
    this.hits    = 0;
    this.created = Date.now();
  }
  get valid() { return Date.now() < this.expires; }
}

class Cache {
  #store   = new Map();
  #maxSize;
  #defaultTTL;

  constructor(maxSize = 1000, defaultTTL = 300_000) {
    this.#maxSize    = maxSize;
    this.#defaultTTL = defaultTTL;
    setInterval(() => this.#evictExpired(), 60_000);
  }

  set(key, data, ttl = this.#defaultTTL) {
    if (this.#store.size >= this.#maxSize) this.#evictLRU();
    this.#store.set(key, new CacheEntry(data, ttl));
  }

  get(key) {
    const entry = this.#store.get(key);
    if (!entry) return null;
    if (!entry.valid) { this.#store.delete(key); return null; }
    entry.hits++;
    return entry.data;
  }

  has(key) { return !!this.get(key); }

  delete(key) { this.#store.delete(key); }

  clear(prefix = null) {
    if (!prefix) { this.#store.clear(); return; }
    for (const k of this.#store.keys()) {
      if (k.startsWith(prefix)) this.#store.delete(k);
    }
  }

  stats() {
    let valid = 0, expired = 0, totalHits = 0;
    for (const e of this.#store.values()) {
      e.valid ? valid++ : expired++;
      totalHits += e.hits;
    }
    return { total: this.#store.size, valid, expired, totalHits, maxSize: this.#maxSize };
  }

  #evictExpired() {
    for (const [k, e] of this.#store.entries()) {
      if (!e.valid) this.#store.delete(k);
    }
  }

  #evictLRU() {
    // Remove the entry with fewest hits (simplest LRU approximation)
    let lruKey = null, lruHits = Infinity;
    for (const [k, e] of this.#store.entries()) {
      if (e.hits < lruHits) { lruHits = e.hits; lruKey = k; }
    }
    if (lruKey) this.#store.delete(lruKey);
  }
}

export const cache = new Cache();
export default cache;
