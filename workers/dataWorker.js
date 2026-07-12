/**
 * EarthOS DataWorker — off-main-thread data processing.
 * Runs fetch + normalize for heavy sources (TLE propagation, CSV parsing,
 * large GeoJSON processing) so the render loop never stutters.
 *
 * Communication protocol:
 *   Main → Worker:  { type: 'TASK', taskId, source, payload }
 *   Worker → Main:  { type: 'RESULT', taskId, events, error? }
 *   Worker → Main:  { type: 'PROGRESS', taskId, pct }
 */

// ── Task handlers ─────────────────────────────────────────────────────────

const handlers = {

  /**
   * Parse a CSV text into an array of row objects.
   * columns: string[]  — header names in order
   */
  parseCSV({ text, columns }) {
    const lines = text.trim().split('\n');
    const headers = columns ?? lines[0].split(',').map(h => h.trim());
    const start   = columns ? 0 : 1;
    return lines.slice(start).map(line => {
      const vals = line.split(',');
      return Object.fromEntries(headers.map((h, i) => [h, vals[i]?.trim() ?? '']));
    });
  },

  /**
   * Propagate TLE positions.
   * tles: Array<{noradId, name, tle1, tle2, epochMs, cat}>
   * Returns: Array<{id, lat, lon, alt, name, noradId, cat}>
   */
  propagateTLEs({ tles, now }) {
    const results = [];
    for (const tle of tles) {
      const minutesSinceEpoch = (now - tle.epochMs) / 60000;
      if (minutesSinceEpoch < 0 || minutesSinceEpoch > 14 * 1440) continue;
      try {
        const pos = propagateSGP4(tle.tle1, tle.tle2, minutesSinceEpoch);
        if (isNaN(pos.lat) || isNaN(pos.lon)) continue;
        results.push({ id: `sat_${tle.noradId}`, ...pos, name: tle.name, noradId: tle.noradId, cat: tle.cat });
      } catch { /* bad TLE */ }
    }
    return results;
  },

  /**
   * Cluster points by geo-grid (fast heatmap bucketing).
   * points: [{lat, lon, value}]
   * gridDeg: grid cell size in degrees
   */
  clusterPoints({ points, gridDeg = 2 }) {
    const grid = {};
    for (const p of points) {
      const gx = Math.round(p.lon / gridDeg) * gridDeg;
      const gy = Math.round(p.lat / gridDeg) * gridDeg;
      const key = `${gx}_${gy}`;
      if (!grid[key]) grid[key] = { lon: gx, lat: gy, count: 0, sum: 0 };
      grid[key].count++;
      grid[key].sum += p.value ?? 1;
    }
    return Object.values(grid).map(c => ({ ...c, avg: c.sum / c.count }));
  },

  /**
   * Filter GeoJSON features by bounding box.
   */
  filterGeoJSON({ geojson, bounds }) {
    const [minLon, minLat, maxLon, maxLat] = bounds;
    return {
      ...geojson,
      features: (geojson.features ?? []).filter(f => {
        const [lon, lat] = f.geometry?.coordinates ?? [0, 0];
        return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
      }),
    };
  },
};

// ── Message handler ───────────────────────────────────────────────────────

self.onmessage = async ({ data }) => {
  const { type, taskId, source, payload } = data;
  if (type !== 'TASK') return;

  const handler = handlers[source];
  if (!handler) {
    self.postMessage({ type: 'RESULT', taskId, error: `Unknown source: ${source}` });
    return;
  }

  try {
    const result = await handler(payload);
    self.postMessage({ type: 'RESULT', taskId, events: result });
  } catch (e) {
    self.postMessage({ type: 'RESULT', taskId, error: e.message });
  }
};

// ── Embedded SGP4 (same as sources/tle.js) ──────────────────────────────

function propagateSGP4(tle1, tle2, minutesSinceEpoch) {
  const deg2rad = Math.PI / 180;
  const i       = parseFloat(tle2.slice(8,  16)) * deg2rad;
  const raan    = parseFloat(tle2.slice(17, 25)) * deg2rad;
  const ecc     = parseFloat('0.' + tle2.slice(26, 33).trim());
  const argp    = parseFloat(tle2.slice(34, 42)) * deg2rad;
  const m0      = parseFloat(tle2.slice(43, 51)) * deg2rad;
  const n       = parseFloat(tle2.slice(52, 63));
  const mu      = 398600.4418;
  const Re      = 6378.137;
  const n_rad   = n * 2 * Math.PI / 86400;
  const a       = Math.cbrt(mu / (n_rad * n_rad));
  const M       = m0 + n_rad * minutesSinceEpoch * 60;
  let E         = M;
  for (let k = 0; k < 10; k++) E = E - (E - ecc * Math.sin(E) - M) / (1 - ecc * Math.cos(E));
  const nu  = 2 * Math.atan2(Math.sqrt(1+ecc)*Math.sin(E/2), Math.sqrt(1-ecc)*Math.cos(E/2));
  const r   = a * (1 - ecc * Math.cos(E));
  const u   = argp + nu;
  const x   = r*(Math.cos(raan)*Math.cos(u)-Math.sin(raan)*Math.sin(u)*Math.cos(i));
  const y   = r*(Math.sin(raan)*Math.cos(u)+Math.cos(raan)*Math.sin(u)*Math.cos(i));
  const z   = r*Math.sin(u)*Math.sin(i);
  const gst = (280.46061837 + 360.98564736629*(minutesSinceEpoch/1440)) * deg2rad;
  const lon = Math.atan2(y, x) - gst;
  const lat = Math.atan2(z, Math.sqrt(x*x+y*y));
  const alt = Math.sqrt(x*x+y*y+z*z) - Re;
  return { lat: lat/deg2rad, lon: ((lon/deg2rad)+540)%360-180, alt };
}
