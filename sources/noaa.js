/**
 * EarthOS Source: NOAA — National Oceanic and Atmospheric Administration
 * APIs used:
 *   - GFS wind/pressure grid (NOMADS)
 *   - NHC active tropical cyclones
 *   - SPC severe weather alerts
 * Rate: wind 1h, cyclones 10min, alerts 5min. No key required.
 */

import { BaseSource, EarthEvent } from './base.js';
import bus, { Events }            from '../core/eventBus.js';
import scheduler, { Intervals }  from '../core/scheduler.js';
import spatialIndex               from '../core/spatialIndex.js';

// NOAA NHC active storms (Atlantic + Pacific)
const NHC_URL  = 'https://www.nhc.noaa.gov/CurrentStorms.json';
// NWS active alerts GeoJSON
const ALERTS_URL = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert,update&urgency=Immediate,Expected&limit=50';
// GFS 0.25deg wind components (NOMADS OpenDAP simplified)
// We use a pre-processed wind tile service instead of raw GRIB2
const WIND_URL = 'https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&hourly=windspeed_10m,winddirection_10m&forecast_days=1&timezone=UTC';

export class NOAASource extends BaseSource {
  #storms   = new Map();
  #alerts   = new Map();
  #windGrid = null;

  constructor(options = {}) {
    super('noaa', options);
  }

  async connect() {
    await super.connect();
    scheduler.register('noaa:storms', () => this.#fetchStorms(), 600_000,  { immediate: true });
    scheduler.register('noaa:alerts', () => this.#fetchAlerts(), 300_000,  { immediate: true });
    scheduler.register('noaa:wind',   () => this.#fetchWind(),   3_600_000, { immediate: true });
  }

  async disconnect() {
    scheduler.unregister('noaa:storms');
    scheduler.unregister('noaa:alerts');
    scheduler.unregister('noaa:wind');
    await super.disconnect();
  }

  async fetch()  { return null; }
  normalize(raw) { return []; }

  // ── Tropical Cyclones ────────────────────────────────────────────────────

  async #fetchStorms() {
    let data;
    try {
      data = await this.fetchJSON(NHC_URL, { ttl: 9 * 60_000 });
    } catch { return; }

    const events = [];
    const activeStorms = data.activeStorms ?? [];

    for (const storm of activeStorms) {
      const id  = `storm_${storm.id}`;
      const lat = parseFloat(storm.latitude);
      const lon = parseFloat(storm.longitude);
      if (isNaN(lat) || isNaN(lon)) continue;

      const isNew = !this.#storms.has(id);
      this.#storms.set(id, storm);

      const ev = new EarthEvent('storm', {
        id, lat, lon,
        magnitude: parseFloat(storm.maxWindMPH ?? 0) * 0.868976,  // mph → knots
        time:      Date.now(),
        title:     `${storm.type ?? 'Storm'} ${storm.name ?? '?'} (${storm.basin})`,
        source:    'noaa',
        url:       storm.publicAdvisoryUrl,
        detail: {
          name:        storm.name,
          type:        storm.type,
          basin:       storm.basin,
          windMPH:     storm.maxWindMPH,
          windKnots:   Math.round(parseFloat(storm.maxWindMPH ?? 0) * 0.868976),
          pressure:    storm.minimumPressureMB,
          category:    this.#category(parseFloat(storm.maxWindMPH ?? 0)),
          movementDir: storm.movementDir,
          movementMPH: storm.movementMPH,
        },
        ttl: 3_600_000,
      });

      events.push(ev);
      spatialIndex.layer('storms').update({ id, lat, lon, ref: ev });
      if (isNew) bus.emit(Events.STORM, ev);
    }

    bus.emit(Events.LAYER_DATA_READY, { id: 'storms', count: events.length, events });
    return events;
  }

  // ── Severe Weather Alerts ────────────────────────────────────────────────

  async #fetchAlerts() {
    let data;
    try {
      data = await this.fetchJSON(ALERTS_URL, { ttl: 4 * 60_000 });
    } catch { return; }

    const events = [];
    for (const f of data.features ?? []) {
      const p   = f.properties;
      const geo = f.geometry;
      if (!geo || !p) continue;

      // Use centroid of the alert area polygon
      let lat = 0, lon = 0, pts = 0;
      const coords = geo.type === 'Polygon'
        ? geo.coordinates[0]
        : geo.type === 'MultiPolygon'
          ? geo.coordinates.flat(2)
          : [];
      for (const [lo, la] of coords) { lon += lo; lat += la; pts++; }
      if (pts === 0) continue;
      lat /= pts; lon /= pts;

      const id = `alert_${p.id ?? p['@id']}`;
      this.#alerts.set(id, p);

      const ev = new EarthEvent('storm', {
        id, lat, lon,
        time:   new Date(p.onset ?? p.sent).getTime(),
        title:  p.headline ?? p.event,
        source: 'noaa',
        url:    p['@id'],
        detail: {
          event:       p.event,
          severity:    p.severity,
          urgency:     p.urgency,
          certainty:   p.certainty,
          area:        p.areaDesc,
          description: (p.description ?? '').slice(0, 300),
          instruction: (p.instruction ?? '').slice(0, 200),
          expires:     p.expires,
        },
        ttl: new Date(p.expires ?? Date.now() + 3_600_000).getTime() - Date.now(),
      });

      events.push(ev);
    }

    bus.emit(Events.LAYER_DATA_READY, { id: 'weather', count: events.length, events, partial: true });
    return events;
  }

  // ── Global Wind Grid (Open-Meteo proxy) ─────────────────────────────────

  async #fetchWind() {
    // Build a global wind grid from Open-Meteo point samples
    // Sample ~144 points (10° spacing) and interpolate client-side
    const LATS = [-60,-50,-40,-30,-20,-10,0,10,20,30,40,50,60];
    const LONS = [-180,-150,-120,-90,-60,-30,0,30,60,90,120,150];
    const grid = [];

    const batch = LATS.flatMap(lat =>
      LONS.map(lon =>
        this.fetchJSON(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=UTC`,
          { ttl: 3_500_000 }
        ).then(d => ({
          lat, lon,
          speed:   d.current_weather?.windspeed   ?? 0,
          dir:     d.current_weather?.winddirection ?? 0,
        })).catch(() => ({ lat, lon, speed: 0, dir: 0 }))
      )
    );

    const results = await Promise.allSettled(batch);
    for (const r of results) {
      if (r.status === 'fulfilled') grid.push(r.value);
    }

    this.#windGrid = grid;
    bus.emit(Events.LAYER_DATA_READY, {
      id: 'weather',
      count: grid.length,
      events: grid,
      type: 'wind_grid',
      partial: true,
    });
    return grid;
  }

  #category(windMPH) {
    if (windMPH < 39)  return 'TD';
    if (windMPH < 74)  return 'TS';
    if (windMPH < 96)  return 'Cat 1';
    if (windMPH < 111) return 'Cat 2';
    if (windMPH < 130) return 'Cat 3';
    if (windMPH < 157) return 'Cat 4';
    return 'Cat 5';
  }

  get windGrid() { return this.#windGrid; }
}

export default NOAASource;
