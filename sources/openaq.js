/**
 * EarthOS Source: Air Quality via WAQI (World Air Quality Index)
 * API: https://waqi.info/ — demo token works globally, no key needed.
 * Rate: 15 min refresh.
 */

import { BaseSource, EarthEvent } from './base.js';
import bus, { Events }            from '../core/eventBus.js';
import scheduler, { Intervals }  from '../core/scheduler.js';
import spatialIndex               from '../core/spatialIndex.js';

const BASE  = 'https://api.waqi.info';
const TOKEN = 'demo';

const AQI_LEVELS = [
  [  0,  50, 'Good'],
  [ 51, 100, 'Moderate'],
  [101, 150, 'Unhealthy (Sensitive)'],
  [151, 200, 'Unhealthy'],
  [201, 300, 'Very Unhealthy'],
  [301, 500, 'Hazardous'],
];

function aqiLabel(aqi) {
  for (const [lo, hi, label] of AQI_LEVELS) {
    if (aqi >= lo && aqi <= hi) return label;
  }
  return 'Hazardous';
}

export class OpenAQSource extends BaseSource {
  constructor(options = {}) {
    super('openaq', options);
  }

  async connect() {
    await super.connect();
    scheduler.register('openaq:poll', () => this.run(), Intervals.FIRES, { immediate: true });
  }

  async disconnect() {
    scheduler.unregister('openaq:poll');
    await super.disconnect();
  }

  async fetch() {
    const url = `${BASE}/map/bounds/?latlng=-90,-180,90,180&token=${TOKEN}`;
    return this.fetchJSON(url, { ttl: 14 * 60_000 });
  }

  normalize(data) {
    if (data.status !== 'ok') return [];
    const events = [];

    for (const station of data.data ?? []) {
      const lat = station.lat;
      const lon = station.lon;
      const raw = station.aqi;
      const aqi = parseInt(raw, 10);
      if (!lat || !lon || isNaN(aqi) || aqi < 0) continue;

      const name  = station.station?.name ?? '';
      const id    = `aq_waqi_${station.uid}`;
      const label = aqiLabel(aqi);

      const ev = new EarthEvent('pollution', {
        id, lat, lon,
        magnitude: aqi,
        time: Date.now(),
        title: `AQI ${aqi} (${label})${name ? ' — ' + name : ''}`,
        source: 'waqi',
        detail: { aqi, label, location: name, parameter: 'AQI', value: aqi, unit: '' },
        ttl: 3_600_000,
      });

      events.push(ev);
      spatialIndex.layer('pollution').update({ id, lat, lon, ref: ev });
      if (aqi > 200) bus.emit(Events.POLLUTION, ev);
    }

    bus.emit(Events.LAYER_DATA_READY, { id: 'pollution', count: events.length, events });
    return events;
  }
}

export default OpenAQSource;
