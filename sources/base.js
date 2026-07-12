/**
 * EarthOS BaseSource — contract that every data source must implement.
 * All sources speak the same language: EarthEvents.
 */

import bus, { Events } from '../core/eventBus.js';
import cache            from '../core/cache.js';

export class EarthEvent {
  constructor(type, data) {
    this.id        = data.id        ?? `${type}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    this.type      = type;
    this.lat       = data.lat       ?? 0;
    this.lon       = data.lon       ?? 0;
    this.magnitude = data.magnitude ?? null;
    this.depth     = data.depth     ?? null;
    this.time      = data.time      ?? Date.now();
    this.title     = data.title     ?? '';
    this.detail    = data.detail    ?? {};
    this.source    = data.source    ?? 'unknown';
    this.url       = data.url       ?? null;
    this.ttl       = data.ttl       ?? 3_600_000; // default 1h
  }

  get expired() { return Date.now() > this.time + this.ttl; }
  get age()     { return Date.now() - this.time; }

  toGeoJSON() {
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [this.lon, this.lat, this.depth ?? 0] },
      properties: {
        id: this.id, type: this.type, title: this.title,
        magnitude: this.magnitude, time: this.time, source: this.source,
        ...this.detail
      }
    };
  }
}

export class BaseSource {
  constructor(id, options = {}) {
    this.id        = id;
    this.options   = options;
    this.connected = false;
    this.enabled   = options.enabled ?? true;
    this._cache    = cache;
    this._bus      = bus;
  }

  // ── Lifecycle (override in subclasses) ────────────────────────────────────

  async connect()    { this.connected = true; }
  async disconnect() { this.connected = false; }

  /** Fetch raw data from the API. Returns raw response. */
  async fetch()  { throw new Error(`${this.id}.fetch() not implemented`); }

  /** Transform raw response into EarthEvent[]. */
  normalize(raw) { throw new Error(`${this.id}.normalize() not implemented`); }

  // ── Helpers ──────────────────────────────────────────────────────────────

  async fetchJSON(url, options = {}) {
    const cached = this._cache.get(url);
    if (cached) return cached;

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', ...options.headers },
      signal: options.signal,
      ...options,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const data = await res.json();
    if (options.ttl !== false) this._cache.set(url, data, options.ttl ?? 60_000);
    return data;
  }

  /** Fetch, normalize, emit — the standard pipeline. */
  async run() {
    try {
      const raw    = await this.fetch();
      const events = this.normalize(raw);
      bus.emit(Events.DATA_RECEIVED,   { source: this.id, count: events.length });
      bus.emit(Events.DATA_NORMALIZED, { source: this.id, events });
      return events;
    } catch (e) {
      bus.emit(Events.SOURCE_ERROR, { id: this.id, error: e.message });
      throw e;
    }
  }
}

export default BaseSource;
