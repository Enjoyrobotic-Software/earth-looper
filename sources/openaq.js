/**
 * EarthOS Source: OpenAQ — global air quality measurements
 * API: https://docs.openaq.org/
 * Rate: 15 min. No key required (v2 public).
 * Parameters: PM2.5, PM10, O3, NO2, SO2, CO
 */

import { BaseSource, EarthEvent } from './base.js';
import bus, { Events }            from '../core/eventBus.js';
import scheduler, { Intervals }  from '../core/scheduler.js';
import spatialIndex               from '../core/spatialIndex.js';

const BASE = 'https://api.openaq.org/v2';

const AQI_BREAKPOINTS = {
  pm25: [
    [0, 12,    0,   50,  'Good'],
    [12.1, 35.4, 51, 100, 'Moderate'],
    [35.5, 55.4, 101, 150, 'USG'],
    [55.5, 150.4, 151, 200, 'Unhealthy'],
    [150.5, 250.4, 201, 300, 'Very Unhealthy'],
    [250.5, 500.4, 301, 500, 'Hazardous'],
  ],
};

function calcAQI(pm25) {
  for (const [cLow, cHigh, iLow, iHigh, label] of AQI_BREAKPOINTS.pm25) {
    if (pm25 >= cLow && pm25 <= cHigh) {
      const aqi = Math.round(((iHigh - iLow) / (cHigh - cLow)) * (pm25 - cLow) + iLow);
      return { aqi, label };
    }
  }
  return { aqi: 500, label: 'Hazardous' };
}

export class OpenAQSource extends BaseSource {
  #country;
  #param;

  constructor(options = {}) {
    super('openaq', options);
    this.#country = options.country ?? null; // null = global
    this.#param   = options.param   ?? 'pm25';
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
    let url = `${BASE}/latest?parameter=${this.#param}&limit=1000`;
    if (this.#country) url += `&country=${this.#country}`;
    return this.fetchJSON(url, { ttl: 14 * 60_000 });
  }

  normalize(data) {
    const events = [];

    for (const station of data.results ?? []) {
      const { coordinates, country, city, location } = station;
      if (!coordinates?.latitude || !coordinates?.longitude) continue;

      const lat = coordinates.latitude;
      const lon = coordinates.longitude;

      for (const m of station.measurements ?? []) {
        if (m.parameter !== this.#param) continue;
        const value = m.value;
        if (value < 0) continue;

        const { aqi, label } = m.parameter === 'pm25'
          ? calcAQI(value)
          : { aqi: value, label: m.parameter.toUpperCase() };

        const id = `aq_${station.location?.replace(/\s+/g,'_')}_${m.parameter}`;

        const ev = new EarthEvent('pollution', {
          id, lat, lon,
          magnitude: aqi,
          time: new Date(m.lastUpdated ?? Date.now()).getTime(),
          title: `AQI ${aqi} (${label}) — ${city ?? country}`,
          source: 'openaq',
          detail: {
            parameter: m.parameter,
            value,
            unit:       m.unit,
            aqi,
            label,
            country,
            city,
            location,
          },
          ttl: 3_600_000,
        });

        events.push(ev);
        spatialIndex.layer('pollution').update({ id, lat, lon, ref: ev });

        if (aqi > 200) bus.emit(Events.POLLUTION, ev);
      }
    }

    bus.emit(Events.LAYER_DATA_READY, { id: 'pollution', count: events.length, events });
    return events;
  }
}

export default OpenAQSource;
