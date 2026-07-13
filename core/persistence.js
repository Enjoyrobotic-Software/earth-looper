/**
 * EarthOS Persistence — thin localStorage wrapper for settings and UI state.
 */

const PREFIX = 'earthos5_';

export const persistence = {
  save(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (_) {}
  },
  load(key, fallback = null) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v !== null ? JSON.parse(v) : fallback;
    } catch (_) { return fallback; }
  },
  remove(key) { try { localStorage.removeItem(PREFIX + key); } catch (_) {} },
  clear() {
    try {
      for (const k of Object.keys(localStorage))
        if (k.startsWith(PREFIX)) localStorage.removeItem(k);
    } catch (_) {}
  },
};

export default persistence;
