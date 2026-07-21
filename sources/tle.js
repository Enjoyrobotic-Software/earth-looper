import { BaseSource, EarthEvent } from './base.js';
import bus, { Events }            from '../core/eventBus.js';
import scheduler                  from '../core/scheduler.js';
import spatialIndex               from '../core/spatialIndex.js';

// wheretheiss.at — CORS-friendly real-time satellite positions
const N2YO_BASE = 'https://api.wheretheiss.at/v1/satellites';
// Additional tracked objects (NORAD IDs) via wheretheiss.at
const EXTRA_NORAD = [
  { id: 20580,  name: 'Hubble (HST)' },
  { id: 25544,  name: 'ISS' },          // primary ISS feed
  { id: 48274,  name: 'CSS (Tiangong)' },
];


export class TLESource extends BaseSource {
  constructor(options = {}) {
    super('tle', options);
  }

  async connect() {
    await super.connect();
    // Real-time positions via wheretheiss.at (CORS-friendly) — every 30 s
    scheduler.register('tle:live', () => this.#fetchLive(), 30_000, { immediate: true });
  }

  async disconnect() {
    scheduler.unregister('tle:live');
    await super.disconnect();
  }

  async fetch()  { return null; }
  normalize(raw) { return []; }

  async #fetchLive() {
    const events = [];
    for (const sat of EXTRA_NORAD) {
      try {
        const d = await this.fetchJSON(`${N2YO_BASE}/${sat.id}`, { ttl: 25_000 });
        const lat = d.latitude, lon = d.longitude;
        if (lat == null || isNaN(lat) || isNaN(lon)) continue;
        const id = `sat_${sat.id}`;
        const ev = new EarthEvent('satellite', {
          id, lat, lon,
          time: Date.now(),
          title: sat.name,
          source: 'tle',
          detail: {
            noradId: String(sat.id),
            altitude: Math.round(d.altitude ?? 400),
            velocity: Math.round(d.velocity ?? 27600),
            name: sat.name,
          },
          ttl: 35_000,
        });
        events.push(ev);
        spatialIndex.layer('satellites').update({ id, lat, lon, ref: ev });
      } catch { /* API unreachable, skip */ }
    }
    if (events.length) {
      bus.emit(Events.SATELLITE_UPDATE, { count: events.length, events });
      bus.emit(Events.LAYER_DATA_READY, { id: 'satellites', count: events.length, events });
    }
  }

  get satelliteCount() { return EXTRA_NORAD.length; }
}

export default TLESource;
