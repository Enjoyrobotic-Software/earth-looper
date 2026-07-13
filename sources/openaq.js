/**
 * EarthOS Source: OpenAQ — global air quality measurements
 * API: https://docs.openaq.org/ (v3)
 * Rate: 15 min. No key required (rate-limited at 60 req/min).
 * Parameters: PM2.5 (id=2), PM10 (id=3), NO2 (id=5), O3 (id=4)
 */

import { BaseSource, EarthEvent } from './base.js';
import bus, { Events }            from '../core/eventBus.js';
import scheduler, { Intervals }  from '../core/scheduler.js';
import spatialIndex               from '../core/spatialIndex.js';

const BASE = 'https://api.openaq.org/v3';

// OpenAQ v3 parameter IDs
const PARAM_IDS = { pm25: 2, pm10: 3, o3: 4, no2: 5, so2: 6, co: 7 };

const AQI_BREAKPOINTS = {
  pm25: [
    [0,    12,    0,   50, 'Good'],
    [12.1, 35.4, 51,  100, 'Moderate'],
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
  #param;
  #paramId;

  constructor(options = {}) {
    super('openaq', options);
    this.#param   = options.param   ?? 'pm25';
    this.#paramId = PARAM_IDS[this.#param] ?? 2;
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
    // v3: locations endpoint returns location list with latest sensor readings
    const url = `${BASE}/locations?parameters_id=${this.#paramId}&limit=1000`;
    return this.fetchJSON(url, { ttl: 14 * 60_000 });
  }

  normalize(data) {
    const events = [];

    for (const loc of data.results ?? []) {
      const lat = loc.coordinates?.latitude;
      const lon = loc.coordinates?.longitude;
      if (!lat || !lon) continue;

      for (const sensor of loc.sensors ?? []) {
        if (sensor.parameter?.name !== this.#param) continue;
        const value = sensor.latest?.value;
        if (value == null || value < 0) continue;

        const { aqi, label } = this.#param === 'pm25'
          ? calcAQI(value)
          : { aqi: value, label: this.#param.toUpperCase() };

        const city    = loc.locality ?? loc.name ?? '';
        const country = loc.country?.code ?? '';
        const id      = `aq_${loc.id}_${sensor.id}`;
        const time    = new Date(sensor.latest?.datetime?.utc ?? Date.now()).getTime();

        const ev = new EarthEvent('pollution', {
          id, lat, lon,
          magnitude: aqi,
          time,
          title: `AQI ${aqi} (${label}) — ${city || country}`,
          source: 'openaq',
          detail: {
            parameter: this.#param,
            value,
            unit:       sensor.parameter?.units ?? 'µg/m³',
            aqi,
            label,
            country,
            city,
            location:  loc.name,
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
