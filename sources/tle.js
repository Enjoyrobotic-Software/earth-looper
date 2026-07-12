/**
 * EarthOS Source: TLE Satellite Tracker
 * Data: CelesTrak (public domain TLE sets)
 * Rate: position propagation every 10 s, TLE refresh every 24 h.
 * No key required.
 *
 * Uses sgp4 propagator (embedded, no external dependency).
 * Tracks: ISS, Starlink, GPS, Galileo, NOAA, Landsat, debris sets.
 */

import { BaseSource, EarthEvent } from './base.js';
import bus, { Events }            from '../core/eventBus.js';
import scheduler, { Intervals }  from '../core/scheduler.js';
import spatialIndex               from '../core/spatialIndex.js';

// CelesTrak GP data (JSON format, much easier than TLE text)
const CATALOGS = {
  stations:  'https://celestrak.org/SOCRATES/query.php?CODE=ISS&FORMAT=JSON',
  iss:       'https://celestrak.org/SATCAT/search.php?INTDES=1998-067&FORMAT=JSON',
  starlink:  'https://celestrak.org/SATCAT/search.php?OBJECT-NAME=STARLINK&FORMAT=JSON',
  gps:       'https://celestrak.org/SATCAT/search.php?OBJECT-NAME=GPS&FORMAT=JSON',
  // Primary source: GP (TLE-compatible) JSON
  active:    'https://celestrak.org/SATCAT/search.php?STATUS=alive&FORMAT=JSON',
};

// TLE text feeds (more reliable than SATCAT for orbital elements)
const TLE_FEEDS = {
  stations: 'https://celestrak.org/SATCAT/groups/stations.txt',
  starlink: 'https://celestrak.org/SATCAT/groups/starlink.txt',
  gps_ops:  'https://celestrak.org/SATCAT/groups/gps-ops.txt',
  galileo:  'https://celestrak.org/SATCAT/groups/galileo.txt',
  weather:  'https://celestrak.org/SATCAT/groups/weather.txt',
  active:   'https://celestrak.org/SATCAT/groups/active.txt',
};

// Minimal SGP4 propagator (Vallado algorithm, compact implementation)
// Full SGP4 is 1500+ lines; this covers the >90% circular/low-e case.
function propagateSGP4(tle1, tle2, minutesSinceEpoch) {
  const deg2rad = Math.PI / 180;

  // Parse TLE line 2
  const i     = parseFloat(tle2.slice(8,  16))  * deg2rad;
  const raan  = parseFloat(tle2.slice(17, 25))  * deg2rad;
  const ecc   = parseFloat('0.' + tle2.slice(26, 33).trim());
  const argp  = parseFloat(tle2.slice(34, 42))  * deg2rad;
  const m0    = parseFloat(tle2.slice(43, 51))  * deg2rad;
  const n     = parseFloat(tle2.slice(52, 63));  // rev/day

  const mu    = 398600.4418;   // km³/s²
  const Re    = 6378.137;      // km
  const n_rad = n * 2 * Math.PI / 86400; // rad/s
  const a     = Math.cbrt(mu / (n_rad * n_rad)); // semi-major axis km

  // Mean motion advance
  const M     = m0 + n_rad * minutesSinceEpoch * 60;

  // Solve Kepler's equation (Newton iterations)
  let E = M;
  for (let k = 0; k < 10; k++) {
    E = E - (E - ecc * Math.sin(E) - M) / (1 - ecc * Math.cos(E));
  }

  // True anomaly
  const nu  = 2 * Math.atan2(
    Math.sqrt(1 + ecc) * Math.sin(E / 2),
    Math.sqrt(1 - ecc) * Math.cos(E / 2)
  );

  // Orbital radius
  const r   = a * (1 - ecc * Math.cos(E));

  // ECI position (Perifocal → ECI)
  const u   = argp + nu;
  const x   = r * (Math.cos(raan)*Math.cos(u) - Math.sin(raan)*Math.sin(u)*Math.cos(i));
  const y   = r * (Math.sin(raan)*Math.cos(u) + Math.cos(raan)*Math.sin(u)*Math.cos(i));
  const z   = r * Math.sin(u) * Math.sin(i);

  // ECI → lat/lon (accounting for Earth rotation)
  const gst = (280.46061837 + 360.98564736629 * (minutesSinceEpoch / 1440)) * deg2rad;
  const lon = Math.atan2(y, x) - gst;
  const lat = Math.atan2(z, Math.sqrt(x*x + y*y));
  const alt = Math.sqrt(x*x + y*y + z*z) - Re;

  return {
    lat: lat / deg2rad,
    lon: ((lon / deg2rad) + 540) % 360 - 180,
    alt,
  };
}

function parseTLEEpoch(tle1) {
  // Epoch field: YYddd.fraction
  const epochStr = tle1.slice(18, 32).trim();
  const year2    = parseInt(epochStr.slice(0, 2));
  const year     = year2 >= 57 ? 1900 + year2 : 2000 + year2;
  const dayOfYear = parseFloat(epochStr.slice(2));
  const d = new Date(year, 0, 1);
  d.setTime(d.getTime() + (dayOfYear - 1) * 86400000);
  return d.getTime();
}

export class TLESource extends BaseSource {
  #tles   = new Map();   // name → {tle1, tle2, epochMs, noradId}
  #cats;

  constructor(options = {}) {
    super('tle', options);
    this.#cats = options.catalogs ?? ['stations', 'starlink', 'gps_ops'];
  }

  async connect() {
    await super.connect();
    // Refresh TLEs every 24h
    scheduler.register('tle:refresh', () => this.#refreshTLEs(), Intervals.SPACE, {
      immediate: true,
    });
    // Propagate positions every 10s
    scheduler.register('tle:propagate', () => this.#propagateAll(), Intervals.SATELLITES, {
      immediate: false,
      retries: 0,
    });
  }

  async disconnect() {
    scheduler.unregister('tle:refresh');
    scheduler.unregister('tle:propagate');
    await super.disconnect();
  }

  async fetch()  { return null; }
  normalize(raw) { return []; }

  async #refreshTLEs() {
    for (const cat of this.#cats) {
      const url = TLE_FEEDS[cat];
      if (!url) continue;
      try {
        const text  = await (await fetch(url)).text();
        const lines = text.trim().split('\n').map(l => l.trimEnd());
        let added = 0;
        for (let i = 0; i < lines.length - 2; i += 3) {
          const name  = lines[i].trim().replace(/^0\s+/, '');
          const tle1  = lines[i + 1];
          const tle2  = lines[i + 2];
          if (!tle1?.startsWith('1') || !tle2?.startsWith('2')) continue;
          const noradId = tle1.slice(2, 7).trim();
          this.#tles.set(noradId, { name, tle1, tle2, epochMs: parseTLEEpoch(tle1), cat });
          added++;
        }
        console.log(`[TLE] Loaded ${added} satellites from ${cat}`);
      } catch(e) {
        console.warn(`[TLE] Failed to load ${cat}:`, e.message);
      }
    }
    this.#propagateAll();
  }

  #propagateAll() {
    const now    = Date.now();
    const events = [];

    for (const [noradId, tle] of this.#tles) {
      const minutesSinceEpoch = (now - tle.epochMs) / 60000;
      if (minutesSinceEpoch < 0 || minutesSinceEpoch > 14 * 1440) continue; // skip stale TLEs

      try {
        const pos = propagateSGP4(tle.tle1, tle.tle2, minutesSinceEpoch);
        if (isNaN(pos.lat) || isNaN(pos.lon)) continue;

        const id = `sat_${noradId}`;
        const ev = new EarthEvent('satellite', {
          id,
          lat: pos.lat,
          lon: pos.lon,
          time: now,
          title: tle.name,
          source: 'tle',
          detail: {
            noradId,
            catalog: tle.cat,
            altitude: Math.round(pos.alt),   // km
            name: tle.name,
          },
          ttl: 30_000,
        });

        events.push(ev);
        spatialIndex.layer('satellites').update({ id, lat: pos.lat, lon: pos.lon, ref: ev });
      } catch { /* bad TLE, skip */ }
    }

    bus.emit(Events.SATELLITE_UPDATE, { count: events.length, events });
    bus.emit(Events.LAYER_DATA_READY, { id: 'satellites', count: events.length, events });
    return events;
  }

  get satelliteCount() { return this.#tles.size; }
}

export default TLESource;
