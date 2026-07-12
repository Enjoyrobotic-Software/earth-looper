/**
 * EarthOS Source: NASA EONET — Earth Observatory Natural Event Tracker
 * API: https://eonet.gsfc.nasa.gov/docs/v3
 * Rate: 1 min. No key required.
 * Covers: wildfires, storms, volcanoes, sea/lake ice, icebergs, floods, earthquakes,
 *         dust/haze, snow, drought, manmade events, water color, landslides.
 */

import { BaseSource, EarthEvent } from './base.js';
import bus, { Events }            from '../core/eventBus.js';
import scheduler, { Intervals }  from '../core/scheduler.js';
import spatialIndex               from '../core/spatialIndex.js';

const BASE = 'https://eonet.gsfc.nasa.gov/api/v3';

const TYPE_MAP = {
  'wildfires':       { busEvent: Events.FIRE,       layer: 'fires' },
  'severeStorms':    { busEvent: Events.STORM,      layer: 'storms' },
  'volcanoes':       { busEvent: Events.VOLCANO,    layer: 'volcanoes' },
  'floods':          { busEvent: Events.FLOOD,      layer: 'storms' },
  'earthquakes':     { busEvent: Events.EARTHQUAKE, layer: 'earthquakes' },
  'landslides':      { busEvent: null,               layer: 'fires' },
  'seaAndLakeIce':   { busEvent: null,               layer: 'ocean' },
  'drought':         { busEvent: Events.DROUGHT,    layer: 'weather' },
};

export class EONETSource extends BaseSource {
  #days;
  #known = new Set();

  constructor(options = {}) {
    super('eonet', options);
    this.#days = options.days ?? 30;
  }

  async connect() {
    await super.connect();
    scheduler.register('eonet:poll', () => this.run(), Intervals.EARTHQUAKE, { immediate: true });
  }

  async disconnect() {
    scheduler.unregister('eonet:poll');
    await super.disconnect();
  }

  async fetch() {
    return this.fetchJSON(`${BASE}/events?status=open&days=${this.#days}&limit=500`, {
      ttl: 55_000,
    });
  }

  normalize(data) {
    const events = [];

    for (const event of data.events ?? []) {
      const categoryId = event.categories?.[0]?.id ?? 'unknown';
      const mapping    = TYPE_MAP[categoryId] ?? { busEvent: null, layer: 'fires' };

      // Use the most recent geometry point
      const geoms = event.geometry ?? [];
      if (!geoms.length) continue;

      const latest = geoms[geoms.length - 1];
      const coords = latest.coordinates;
      let lat, lon;

      if (latest.type === 'Point') {
        [lon, lat] = coords;
      } else if (latest.type === 'Polygon') {
        // Centroid approx
        const pts = coords[0];
        lon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      } else continue;

      const id  = `eonet_${event.id}`;
      const isNew = !this.#known.has(id);
      this.#known.add(id);

      const ev = new EarthEvent(categoryId, {
        id, lat, lon,
        time:   new Date(latest.date).getTime(),
        title:  event.title,
        source: 'eonet',
        url:    event.link,
        detail: {
          categories: event.categories?.map(c => c.title),
          sources:    event.sources?.map(s => s.url),
          geometries: geoms.length,
          closed:     event.closed,
        },
        ttl: 7 * 24 * 3_600_000,
      });

      events.push(ev);
      spatialIndex.layer(mapping.layer).insert({ id, lat, lon, ref: ev });

      if (isNew && mapping.busEvent) {
        bus.emit(mapping.busEvent, ev);
      }
    }

    // Group by layer and emit
    const byLayer = {};
    for (const ev of events) {
      const categoryId = ev.type;
      const layer = (TYPE_MAP[categoryId] ?? { layer: 'fires' }).layer;
      (byLayer[layer] ??= []).push(ev);
    }
    for (const [layer, layerEvents] of Object.entries(byLayer)) {
      bus.emit(Events.LAYER_DATA_READY, { id: layer, count: layerEvents.length, events: layerEvents, partial: true });
    }

    return events;
  }
}

export default EONETSource;
