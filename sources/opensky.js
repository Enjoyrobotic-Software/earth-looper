/**
 * EarthOS Source: OpenSky Network — real-time flight positions
 * API: https://openskynetwork.github.io/opensky-api/rest.html
 * Rate: 5s (anon), 1s (auth). No key required for anonymous.
 * Up to ~8000 flights globally.
 */

import { BaseSource, EarthEvent } from './base.js';
import bus, { Events }            from '../core/eventBus.js';
import scheduler, { Intervals }  from '../core/scheduler.js';
import spatialIndex               from '../core/spatialIndex.js';

const FIELDS = ['icao24','callsign','origin_country','time_position','last_contact',
                 'longitude','latitude','baro_altitude','on_ground','velocity',
                 'true_track','vertical_rate','sensors','geo_altitude','squawk',
                 'spi','position_source'];

const URL_ANON = 'https://opensky-network.org/api/states/all';
const URL_AUTH = (u, p) => `https://${u}:${p}@opensky-network.org/api/states/all`;

export class OpenSkySource extends BaseSource {
  #user; #pass;
  #flights = new Map(); // icao24 → state

  constructor(options = {}) {
    super('opensky', options);
    this.#user = options.username ?? null;
    this.#pass = options.password ?? null;
  }

  async connect() {
    await super.connect();
    scheduler.register('opensky:poll', () => this.run(), Intervals.OPENSKY, { immediate: true });
  }

  async disconnect() {
    scheduler.unregister('opensky:poll');
    await super.disconnect();
  }

  async fetch() {
    const url = (this.#user && this.#pass) ? URL_AUTH(this.#user, this.#pass) : URL_ANON;
    return this.fetchJSON(url, { ttl: 4_500, cache: false });
  }

  normalize(raw) {
    const states  = raw.states ?? [];
    const events  = [];
    const seen    = new Set();

    for (const s of states) {
      const obj = Object.fromEntries(FIELDS.map((f, i) => [f, s[i]]));
      const lon = obj.longitude, lat = obj.latitude;
      if (lon == null || lat == null) continue;
      if (obj.on_ground) continue;

      const icao = obj.icao24;
      seen.add(icao);

      const ev = new EarthEvent('flight', {
        id:     `flight_${icao}`,
        lat, lon,
        time:   (obj.time_position ?? raw.time ?? 0) * 1000,
        title:  (obj.callsign?.trim() || icao).toUpperCase(),
        source: 'opensky',
        detail: {
          icao24:        icao,
          callsign:      obj.callsign?.trim() ?? '',
          country:       obj.origin_country,
          altitude:      obj.baro_altitude ?? obj.geo_altitude ?? 0,
          speed:         obj.velocity ?? 0,           // m/s
          heading:       obj.true_track ?? 0,         // degrees
          verticalRate:  obj.vertical_rate ?? 0,
          squawk:        obj.squawk,
        },
        ttl: 30_000,
      });

      this.#flights.set(icao, ev);
      spatialIndex.layer('flights').update({ id: `flight_${icao}`, lat, lon, ref: ev });
      events.push(ev);
    }

    // Remove stale flights (no longer in feed)
    for (const [icao] of this.#flights) {
      if (!seen.has(icao)) {
        this.#flights.delete(icao);
        spatialIndex.layer('flights').remove(`flight_${icao}`);
      }
    }

    bus.emit(Events.FLIGHT_UPDATE, { count: events.length, events });
    bus.emit(Events.LAYER_DATA_READY, { id: 'flights', count: events.length, events });
    return events;
  }

  getFlightByICAO(icao) { return this.#flights.get(icao); }
  get activeCount() { return this.#flights.size; }
}

export default OpenSkySource;
