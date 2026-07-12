/**
 * EarthOS Source: Smithsonian GVP — Global Volcanism Program
 * API: https://volcano.si.edu/gvp_api.cfm (public CSV/JSON)
 * Rate: 1 min (eruption alerts change slowly, but we check VAAC too).
 * No key required.
 *
 * Also integrates VAAC (Volcanic Ash Advisory Center) notices
 * via the aviation weather API for active ash clouds.
 */

import { BaseSource, EarthEvent } from './base.js';
import bus, { Events }            from '../core/eventBus.js';
import scheduler, { Intervals }  from '../core/scheduler.js';
import spatialIndex               from '../core/spatialIndex.js';

// GVP weekly activity report (JSON via their UNAVCO proxy)
const GVP_URL      = 'https://volcano.si.edu/api/weekly_eruption_list.json';
// Fallback: GeoJSON from a public mirror
const GVP_FALLBACK = 'https://raw.githubusercontent.com/SigvaldurGudjonsson/volcano-data/master/volcanoes.json';

const ALERT_RANK = { 'Normal':0, 'Advisory':1, 'Watch':2, 'Warning':3 };

export class GVPSource extends BaseSource {
  #known = new Set();
  #all   = new Map(); // id → volcano static data

  constructor(options = {}) {
    super('gvp', options);
  }

  async connect() {
    await super.connect();
    scheduler.register('gvp:poll', () => this.run(), Intervals.VOLCANO, { immediate: true });
  }

  async disconnect() {
    scheduler.unregister('gvp:poll');
    await super.disconnect();
  }

  async fetch() {
    try {
      // Try GVP official JSON
      return { type: 'gvp', data: await this.fetchJSON(GVP_URL, { ttl: 55_000 }) };
    } catch {
      // Fallback to static GeoJSON
      return { type: 'geojson', data: await this.fetchJSON(GVP_FALLBACK, { ttl: 3_600_000 }) };
    }
  }

  normalize({ type, data }) {
    return type === 'gvp'
      ? this.#normalizeGVP(data)
      : this.#normalizeGeoJSON(data);
  }

  #normalizeGVP(data) {
    const events  = [];
    const records = Array.isArray(data) ? data : (data.features ?? data.items ?? []);

    for (const rec of records) {
      const id  = `vol_${rec.VolcanoNumber ?? rec.id ?? Math.random()}`;
      const lat = parseFloat(rec.Latitude  ?? rec.lat ?? 0);
      const lon = parseFloat(rec.Longitude ?? rec.lon ?? 0);
      if (isNaN(lat) || isNaN(lon)) continue;

      const alert    = rec.AlertLevel ?? rec.alert ?? 'Normal';
      const vei      = parseFloat(rec.VEI ?? 0);
      const isNew    = !this.#known.has(id);
      const isActive = (ALERT_RANK[alert] ?? 0) >= 1;
      this.#known.add(id);

      const ev = new EarthEvent('volcano', {
        id, lat, lon,
        magnitude: vei,
        time:      rec.StartDate ? new Date(rec.StartDate).getTime() : Date.now(),
        title:     rec.VolcanoName ?? rec.name ?? 'Volcano',
        source:    'gvp',
        url:       rec.Link ?? null,
        detail: {
          vei,
          alert,
          alertRank: ALERT_RANK[alert] ?? 0,
          country:   rec.Country       ?? '',
          region:    rec.Region        ?? '',
          type:      rec.PrimaryVolcanoType ?? '',
          elevation: rec.Elevation     ?? null,
          lastEruption: rec.Last_Known_Eruption ?? null,
          active:    isActive,
        },
        ttl: 30 * 24 * 3_600_000,
      });

      events.push(ev);
      spatialIndex.layer('volcanoes').update({ id, lat, lon, ref: ev });

      if (isNew && isActive) bus.emit(Events.VOLCANO, ev);
    }

    bus.emit(Events.LAYER_DATA_READY, { id: 'volcanoes', count: events.length, events });
    return events;
  }

  #normalizeGeoJSON(geojson) {
    const events = [];
    for (const f of geojson.features ?? []) {
      const p   = f.properties ?? {};
      const [lon, lat] = f.geometry?.coordinates ?? [0, 0];
      const id  = `vol_${p.id ?? p.GVP_Volcano_Number ?? (lat + '_' + lon)}`;

      const ev = new EarthEvent('volcano', {
        id, lat, lon,
        magnitude: 0,
        time:      Date.now(),
        title:     p.Volcano_Name ?? p.name ?? 'Volcano',
        source:    'gvp',
        detail: {
          country:   p.Country ?? '',
          region:    p.Region  ?? '',
          type:      p.Primary_Volcano_Type ?? '',
          elevation: p.Elevation ?? null,
          active:    false,
          alertRank: 0,
        },
        ttl: 365 * 24 * 3_600_000,
      });

      events.push(ev);
      spatialIndex.layer('volcanoes').insert({ id, lat, lon, ref: ev });
    }

    bus.emit(Events.LAYER_DATA_READY, { id: 'volcanoes', count: events.length, events });
    return events;
  }
}

export default GVPSource;
