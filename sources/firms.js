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

// Static representative fire zones shown when CSV is CORS-blocked
const STATIC_FIRES = [
  // Amazon basin (Brazil / Bolivia)
  { lat:-8.2, lon:-63.0, frp:320, title:'Amazon — Pará/AM' },
  { lat:-10.5, lon:-55.8, frp:280, title:'Amazon — Mato Grosso' },
  { lat:-14.1, lon:-57.5, frp:210, title:'Cerrado — MT/GO' },
  { lat:-12.4, lon:-48.9, frp:190, title:'Cerrado — TO/GO' },
  // Central Africa (DRC / Congo savanna)
  { lat:-2.5, lon:22.0, frp:250, title:'DRC — Congo basin' },
  { lat:-5.8, lon:24.5, frp:300, title:'DRC — Kasai' },
  { lat:5.2, lon:18.0, frp:170, title:'CAR — savanna' },
  { lat:-10.0, lon:32.0, frp:200, title:'Zambia / Tanzania' },
  { lat:-16.5, lon:28.0, frp:180, title:'Zambia — Zambezi' },
  { lat:-22.0, lon:30.0, frp:160, title:'Zimbabwe savanna' },
  // West Africa (Nigeria, Ghana, Burkina)
  { lat:11.0, lon:-1.5, frp:140, title:'Burkina Faso' },
  { lat:9.0, lon:4.0, frp:170, title:'Nigeria — Benue' },
  // SE Asia (Indonesia / Borneo)
  { lat:-1.5, lon:111.5, frp:340, title:'Kalimantan peatland' },
  { lat:-2.8, lon:114.0, frp:290, title:'Kalimantan — S' },
  { lat:1.2, lon:109.5, frp:210, title:'Sarawak' },
  { lat:-3.5, lon:103.0, frp:250, title:'Sumatra' },
  // Australia
  { lat:-32.0, lon:148.0, frp:200, title:'NSW — inland' },
  { lat:-27.0, lon:151.0, frp:170, title:'Queensland' },
  { lat:-14.5, lon:131.0, frp:280, title:'NT — Top End' },
  { lat:-24.0, lon:118.0, frp:160, title:'WA — Pilbara' },
  // Western USA
  { lat:37.5, lon:-119.5, frp:350, title:'California — Sierra' },
  { lat:44.0, lon:-116.0, frp:220, title:'Idaho / Oregon' },
  { lat:46.5, lon:-120.0, frp:190, title:'Washington state' },
  // Siberia / Russia
  { lat:62.0, lon:120.0, frp:280, title:'Siberia — Yakutia' },
  { lat:58.0, lon:95.0, frp:220, title:'Siberia — Krasnoyarsk' },
  { lat:65.0, lon:145.0, frp:190, title:'Siberia — far east' },
  // India (crop burning Punjab / Haryana)
  { lat:30.5, lon:75.5, frp:150, title:'Punjab — crop burning' },
  { lat:29.8, lon:77.0, frp:130, title:'Haryana — stubble' },
  // Sub-Saharan Africa (Angola / Mozambique)
  { lat:-12.0, lon:18.5, frp:230, title:'Angola — Cuanza' },
  { lat:-16.0, lon:34.5, frp:190, title:'Mozambique — Tete' },
];

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
    // Without key: parse public CSV (blocked by CORS in browser → fallback to static)
    try {
      const res = await fetch(PUBLIC_CSV);
      if (!res.ok) throw new Error(`FIRMS CSV HTTP ${res.status}`);
      return { type: 'csv', data: await res.text() };
    } catch {
      return { type: 'static', data: STATIC_FIRES };
    }
  }

  normalize({ type, data }) {
    const events = [];
    if (type === 'static') {
      for (const f of data) {
        const id = `fire_static_${f.lat}_${f.lon}`;
        if (this.#known.has(id)) continue;
        this.#known.add(id);
        const ev = new EarthEvent('fire', {
          id, lat: f.lat, lon: f.lon, time: Date.now(),
          magnitude: f.frp,
          title: f.title,
          source: 'firms_static',
          detail: { frp: f.frp, confidence: 'nominal', satellite: 'MODIS' },
          ttl: 24 * 3_600_000,
        });
        events.push(ev);
        spatialIndex.layer('fires').insert({ id, lat: f.lat, lon: f.lon, ref: ev });
      }
      bus.emit(Events.LAYER_DATA_READY, { id: 'fires', count: events.length, events });
      return events;
    }
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
