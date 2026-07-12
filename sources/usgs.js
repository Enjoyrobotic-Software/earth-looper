/**
 * EarthOS Source: USGS Earthquake Hazards Program
 * API: https://earthquake.usgs.gov/earthquakes/feed/v1.0/
 * Rate: 1 min. No key required.
 */

import { BaseSource, EarthEvent } from './base.js';
import bus, { Events }            from '../core/eventBus.js';
import scheduler, { Intervals }  from '../core/scheduler.js';
import spatialIndex               from '../core/spatialIndex.js';

const FEEDS = {
  'significant_hour':  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_hour.geojson',
  'significant_day':   'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson',
  'significant_week':  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson',
  'all_hour':          'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson',
  'all_day':           'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
  'all_week':          'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson',
  'm1_day':            'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/1.0_day.geojson',
  'm2.5_day':          'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
  'm4.5_day':          'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson',
};

export class USGSSource extends BaseSource {
  #feed;
  #minMag;
  #known = new Set();

  constructor(options = {}) {
    super('usgs', options);
    this.#feed   = options.feed   ?? 'all_day';
    this.#minMag = options.minMag ?? 2.5;
  }

  async connect() {
    await super.connect();
    scheduler.register('usgs:poll', () => this.run(), Intervals.EARTHQUAKE, {
      immediate: true,
      retries: 3,
    });
  }

  async disconnect() {
    scheduler.unregister('usgs:poll');
    await super.disconnect();
  }

  setFeed(feed) {
    if (!FEEDS[feed]) throw new Error(`Unknown USGS feed: ${feed}`);
    this.#feed = feed;
    this.#known.clear();
    scheduler.runNow('usgs:poll');
  }

  async fetch() {
    const url = FEEDS[this.#feed];
    return this.fetchJSON(url, { ttl: 55_000 }); // just under 1 min
  }

  normalize(geojson) {
    const events = [];
    for (const f of geojson.features ?? []) {
      const p = f.properties;
      const mag = p.mag ?? 0;
      if (mag < this.#minMag) continue;

      const [lon, lat, depth] = f.geometry?.coordinates ?? [0, 0, 0];
      const id = f.id ?? `usgs_${p.time}`;
      const isNew = !this.#known.has(id);
      this.#known.add(id);

      const ev = new EarthEvent('earthquake', {
        id, lat, lon,
        magnitude: mag,
        depth:     depth ?? 0,
        time:      p.time,
        title:     p.title ?? `M${mag} - ${p.place}`,
        source:    'usgs',
        url:       p.url,
        detail: {
          place:    p.place,
          alert:    p.alert,
          tsunami:  p.tsunami === 1,
          felt:     p.felt,
          cdi:      p.cdi,
          mmi:      p.mmi,
          status:   p.status,
          net:      p.net,
          type:     p.type,
        },
        ttl: 7 * 24 * 3_600_000, // keep for 7 days
      });

      events.push(ev);
      spatialIndex.layer('earthquakes').insert({ id, lat, lon, ref: ev });

      if (isNew && mag >= 5.0) {
        bus.emit(Events.EARTHQUAKE, ev);
      }
    }

    // Refresh full layer dataset
    bus.emit(Events.LAYER_DATA_READY, {
      id: 'earthquakes',
      count: events.length,
      events,
    });

    return events;
  }
}

export default USGSSource;
