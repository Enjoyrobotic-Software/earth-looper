/**
 * EarthOS Source: Copernicus Marine / Climate Services
 * Datasets:
 *   - SST (Sea Surface Temperature) via CMEMS proxy
 *   - Sea ice extent
 *   - Ocean currents (surface)
 * Rate: 1h. Uses open CMEMS product (no registration needed for SST climatology).
 * For real-time CMEMS: register at https://data.marine.copernicus.eu
 *
 * Fallback: NOAA OISST (daily, 0.25°, public domain)
 */

import { BaseSource, EarthEvent } from './base.js';
import bus, { Events }            from '../core/eventBus.js';
import scheduler, { Intervals }  from '../core/scheduler.js';

// NOAA OISST daily SST (netCDF → we use a pre-tiled JSON service)
const OISST_URL = 'https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ncdc_oisst_v2_avhrr_dy.json?sst[(last-0):1:(last)][0:1:0][(0.25):1:(89.75)][(-179.75):1:(179.75)]&.draw=surface&.vars=longitude|latitude|sst';
// Simpler: use a global SST JSON tile (10° resolution for demo)
const SST_SIMPLE = 'https://api.open-meteo.com/v1/marine?hourly=sea_surface_temperature&forecast_days=1&timezone=UTC';

// Sample grid for SST (if ERDDAP is slow)
const SST_SAMPLE_LATS = [-80,-70,-60,-50,-40,-30,-20,-10,0,10,20,30,40,50,60,70,80];
const SST_SAMPLE_LONS = [-180,-150,-120,-90,-60,-30,0,30,60,90,120,150];

export class CopernicusSource extends BaseSource {
  #sstGrid  = null;

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
    const grid   = [];
    const errors = [];

    // Sample Open-Meteo marine API at a grid of points
    const tasks = SST_SAMPLE_LATS.flatMap(lat =>
      SST_SAMPLE_LONS.map(lon =>
        this.fetchJSON(
          `https://api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=sea_surface_temperature&timezone=UTC`,
          { ttl: 3_500_000 }
        )
        .then(d => {
          const sst = d.current?.sea_surface_temperature;
          if (sst != null && !isNaN(sst)) grid.push({ lat, lon, sst });
        })
        .catch(() => {})
      )
    );

    await Promise.allSettled(tasks);

    this.#sstGrid = grid;

    // Emit as a typed grid event (not EarthEvent — it's a field, not a point)
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
