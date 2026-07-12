import { describe, it, expect, beforeEach, vi } from 'vitest';

// Inline HistoryBuffer logic (decoupled from bus for testing)
class HistoryBuffer {
  #store = [];

  insert(ev) {
    const entry = { ev, ingested: Date.now() };
    if (!this.#store.length || ev.time >= this.#store[this.#store.length - 1].ev.time) {
      this.#store.push(entry);
    } else {
      let lo = 0, hi = this.#store.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.#store[mid].ev.time <= ev.time) lo = mid + 1; else hi = mid; }
      this.#store.splice(lo, 0, entry);
    }
  }

  query(fromTs, toTs, type = null) {
    return this.#store
      .filter(({ ev }) => ev.time >= fromTs && ev.time <= toTs && (!type || ev.type === type))
      .map(({ ev }) => ev);
  }

  get size() { return this.#store.length; }
  clear()    { this.#store = []; }
}

const makeEv = (type, time, extra = {}) => ({ id: `${type}_${time}`, type, time, lat: 0, lon: 0, magnitude: 1, ...extra });

describe('HistoryBuffer', () => {
  let buf;
  beforeEach(() => { buf = new HistoryBuffer(); });

  it('inserts and queries by time range', () => {
    buf.insert(makeEv('earthquake', 1000));
    buf.insert(makeEv('fire',       2000));
    buf.insert(makeEv('earthquake', 3000));

    const results = buf.query(500, 2500);
    expect(results).toHaveLength(2);
  });

  it('filters by type', () => {
    buf.insert(makeEv('earthquake', 1000));
    buf.insert(makeEv('fire',       1500));
    buf.insert(makeEv('earthquake', 2000));

    const eqs = buf.query(0, 9999, 'earthquake');
    expect(eqs).toHaveLength(2);
    expect(eqs.every(e => e.type === 'earthquake')).toBe(true);
  });

  it('maintains time order after out-of-order insert', () => {
    buf.insert(makeEv('x', 3000));
    buf.insert(makeEv('x', 1000));
    buf.insert(makeEv('x', 2000));

    const all = buf.query(0, 9999);
    expect(all.map(e => e.time)).toEqual([1000, 2000, 3000]);
  });

  it('returns empty array for out-of-range query', () => {
    buf.insert(makeEv('x', 5000));
    expect(buf.query(0, 4999)).toHaveLength(0);
  });

  it('size matches inserted count', () => {
    for (let i = 0; i < 10; i++) buf.insert(makeEv('x', i * 1000));
    expect(buf.size).toBe(10);
  });
});
