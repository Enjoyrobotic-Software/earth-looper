/**
 * EarthOS Source: NASA FIRMS — Fire Information for Resource Management System
 * API: https://firms.modaps.eosdis.nasa.gov/api/
 * Rate: 15 min. Requires MAP_KEY (free registration).
 * Falls back to public area feeds when no key is provided.
 */

import { BaseSource, EarthEvent } from './base.js';
import bus, { Events }            from '../core/eventBus.js';
import scheduler, { Intervals }  from '../core/scheduler.js';
import spatialIndex               from '../core/spatialIndex.js';

const PUBLIC_CSV = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv';

export class FIRMSSource extends BaseSource {
  #apiKey;
  #known = new Set();

  constructor(options = {}) {
    super('firms', options);
    this.#apiKey = options.apiKey ?? null;
  }

  async connect() {
    await super.connect();
    scheduler.register('firms:poll', () => this.run(), Intervals.FIRES, { immediate: true });
  }

  async disconnect() {
    scheduler.unregister('firms:poll');
    await super.disconnect();
  }

  async fetch() {
    // With key: use JSON API with world bbox
    if (this.#apiKey) {
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/json/${this.#apiKey}/MODIS_NRT/world/1`;
      return { type: 'json', data: await this.fetchJSON(url, { ttl: 14 * 60_000 }) };
    }
    // Without key: parse public CSV
    const res = await fetch(PUBLIC_CSV);
    if (!res.ok) throw new Error(`FIRMS CSV HTTP ${res.status}`);
    return { type: 'csv', data: await res.text() };
  }

  normalize({ type, data }) {
    const events = [];
    const rows = type === 'json' ? data : this.#parseCSV(data);

    for (const row of rows) {
      const lat = parseFloat(row.latitude);
      const lon = parseFloat(row.longitude);
      if (isNaN(lat) || isNaN(lon)) continue;

      const brightness = parseFloat(row.brightness ?? row.bright_t31 ?? 0);
      const frp        = parseFloat(row.frp ?? 0);
      const confidence = row.confidence ?? 'nominal';
      const acq        = row.acq_date   ?? '';
      const acqTime    = row.acq_time   ?? '';
      const id         = `fire_${lat.toFixed(3)}_${lon.toFixed(3)}_${acq}`;

      if (this.#known.has(id)) continue;
      this.#known.add(id);

      const time = acq ? new Date(`${acq}T${acqTime.padStart(4,'0').replace(/(\d{2})(\d{2})/, '$1:$2')}Z`).getTime() : Date.now();

      const ev = new EarthEvent('fire', {
        id, lat, lon, time,
        magnitude: frp,
        title: `Fire — FRP ${frp.toFixed(0)} MW`,
        source: 'firms',
        detail: { brightness, frp, confidence, satellite: row.satellite ?? 'MODIS' },
        ttl: 24 * 3_600_000,
      });

      events.push(ev);
      spatialIndex.layer('fires').insert({ id, lat, lon, ref: ev });
      if (frp > 500) bus.emit(Events.FIRE, ev);
    }

    bus.emit(Events.LAYER_DATA_READY, { id: 'fires', count: events.length, events });
    return events;
  }

  #parseCSV(text) {
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
      const vals = line.split(',');
      return Object.fromEntries(headers.map((h, i) => [h, vals[i]?.trim()]));
    });
  }
}

export default FIRMSSource;
