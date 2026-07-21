/**
 * EarthOS Source: Sea Surface Temperature via Open-Meteo Marine API
 * Uses a fixed set of known ocean coordinates (avoids 404s for land points).
 * Rate: 1h. No key required.
 */

import { BaseSource, EarthEvent } from './base.js';
import bus, { Events }            from '../core/eventBus.js';
import scheduler, { Intervals }  from '../core/scheduler.js';

// Known ocean points at ~30° spacing — avoids sending marine requests to land
const OCEAN_POINTS = [
  // Central Pacific
  { lat:  0,   lon: -160 }, { lat:  20, lon: -155 }, { lat: -20, lon: -155 },
  { lat:  40,  lon: -150 }, { lat: -40, lon: -150 }, { lat:  55, lon: -165 },
  { lat: -55,  lon: -150 }, { lat:   0, lon: -120 }, { lat:   0, lon: -90 },
  // North Pacific
  { lat:  50,  lon: -170 }, { lat:  50, lon: -140 }, { lat:  50, lon:  160 },
  // South Pacific
  { lat: -30,  lon: -110 }, { lat: -20, lon: -170 }, { lat: -30, lon:  170 },
  // Atlantic
  { lat:   0,  lon:  -30 }, { lat:  20, lon:  -50 }, { lat: -20, lon:  -30 },
  { lat:  40,  lon:  -40 }, { lat: -40, lon:  -30 }, { lat:  55, lon:  -30 },
  { lat: -55,  lon:  -40 }, { lat:  18, lon:  -65 }, { lat:  25, lon:  -85 },
  // Indian Ocean
  { lat:   0,  lon:   75 }, { lat: -20, lon:   80 }, { lat:  20, lon:   75 },
  { lat: -40,  lon:   75 }, { lat: -55, lon:   85 },
  // Mediterranean
  { lat:  38,  lon:   15 }, { lat:  35, lon:   25 },
  // Southern Ocean
  { lat: -60,  lon:    0 }, { lat: -60, lon:   60 }, { lat: -60, lon:  120 },
  { lat: -60,  lon: -120 },
  // Arctic Ocean (ice edge)
  { lat:  75,  lon:    0 }, { lat:  75, lon:   90 }, { lat:  75, lon: -90 },
  // North Atlantic
  { lat:  60,  lon:  -20 }, { lat:  60, lon:   10 },
];

export class CopernicusSource extends BaseSource {
  #sstGrid = null;

  constructor(options = {}) {
    super('copernicus', options);
  }

  async connect() {
    await super.connect();
    scheduler.register('cop:sst', () => this.#fetchSST(), Intervals.OCEAN, { immediate: true });
  }

  async disconnect() {
    scheduler.unregister('cop:sst');
    await super.disconnect();
  }

  async fetch()  { return null; }
  normalize(raw) { return []; }

  async #fetchSST() {
    const grid = [];

    const tasks = OCEAN_POINTS.map(({ lat, lon }) =>
      this.fetchJSON(
        `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=sea_surface_temperature&forecast_days=1&timezone=UTC`,
        { ttl: 3_500_000 }
      )
      .then(d => {
        const arr = d.hourly?.sea_surface_temperature;
        const sst = Array.isArray(arr) ? arr.find(v => v != null && !isNaN(v)) : null;
        if (sst != null) grid.push({ lat, lon, sst });
      })
      .catch(() => {})
    );

    await Promise.allSettled(tasks);
    this.#sstGrid = grid;

    bus.emit(Events.LAYER_DATA_READY, {
      id:     'ocean',
      count:  grid.length,
      events: grid,
      type:   'sst_grid',
    });

    return grid;
  }

  get sstGrid() { return this.#sstGrid; }
}

export default CopernicusSource;
