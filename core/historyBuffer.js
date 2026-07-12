/**
 * EarthOS HistoryBuffer — 24-hour sliding window of all EarthEvents.
 * Subscribes to all canonical event types and stores them with timestamps.
 * Used by the TimeEngine for scrubbing back in time.
 *
 * Max retention: 24 h. Max events: 50 000 (circular eviction by age).
 */

import bus, { Events } from './eventBus.js';

const MAX_AGE  = 24 * 3_600_000;   // 24 h in ms
const PRUNE_IV = 5  * 60_000;      // prune every 5 min

const WATCHED = [
  Events.EARTHQUAKE, Events.VOLCANO, Events.FIRE,
  Events.STORM, Events.FLOOD, Events.TSUNAMI,
  Events.POLLUTION, Events.FLIGHT_UPDATE, Events.SHIP_UPDATE,
  Events.SATELLITE_UPDATE,
];

class HistoryBuffer {
  #store = [];   // sorted by ev.time ascending

  constructor() {
    for (const event of WATCHED) {
      bus.on(event, ev => this.#insert(ev));
    }
    setInterval(() => this.#prune(), PRUNE_IV);
  }

  #insert(ev) {
    const entry = { ev, ingested: Date.now() };
    // Maintain approximate time order (most new events come at the end)
    if (!this.#store.length || ev.time >= this.#store[this.#store.length - 1].ev.time) {
      this.#store.push(entry);
    } else {
      // Binary-search insertion point
      let lo = 0, hi = this.#store.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (this.#store[mid].ev.time <= ev.time) lo = mid + 1;
        else hi = mid;
      }
      this.#store.splice(lo, 0, entry);
    }
  }

  #prune() {
    const cutoff = Date.now() - MAX_AGE;
    let i = 0;
    while (i < this.#store.length && this.#store[i].ingested < cutoff) i++;
    if (i > 0) this.#store.splice(0, i);
  }

  /**
   * Query events within a time range.
   * @param {number} fromTs  Unix ms (inclusive)
   * @param {number} toTs    Unix ms (inclusive)
   * @param {string} [type]  Filter by event type (optional)
   * @returns {EarthEvent[]}
   */
  query(fromTs, toTs, type = null) {
    const results = [];
    for (const { ev } of this.#store) {
      if (ev.time < fromTs) continue;
      if (ev.time > toTs)   break;
      if (type && ev.type !== type) continue;
      results.push(ev);
    }
    return results;
  }

  /** Events within the last N milliseconds */
  recent(windowMs = 3_600_000, type = null) {
    const from = Date.now() - windowMs;
    return this.query(from, Date.now(), type);
  }

  get size() { return this.#store.length; }

  stats() {
    if (!this.#store.length) return { size: 0 };
    const first = this.#store[0].ev.time;
    const last  = this.#store[this.#store.length - 1].ev.time;
    return { size: this.#store.length, spanMs: last - first };
  }
}

export const historyBuffer = new HistoryBuffer();
export default historyBuffer;
