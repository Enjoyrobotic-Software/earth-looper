/**
 * EarthOS WindSim — bilinear interpolation of sparse wind grid into dense field.
 * Input: array of { lat, lon, speed, dir } samples from NOAA/Open-Meteo.
 * Output: dense grid for GPU particle advection.
 *
 * Resolution: 2° × 2° → 90 × 180 cells = 16 200 grid points.
 */

import bus, { Events } from '../core/eventBus.js';

const GRID_LAT  = 90;     // cells  (-90 → +90)
const GRID_LON  = 180;    // cells  (-180 → +180)
const LAT_STEP  = 2;      // degrees per cell
const LON_STEP  = 2;      // degrees per cell

export class WindSim {
  #u    = new Float32Array(GRID_LAT * GRID_LON);  // u-component (east)
  #v    = new Float32Array(GRID_LAT * GRID_LON);  // v-component (north)
  #fill = 0;               // count of non-zero cells

  constructor() {
    bus.on(Events.LAYER_DATA_READY, data => {
      if (data.id === 'weather' && data.type === 'wind_grid') this.ingest(data.events);
    });
  }

  /** Update internal grid from sparse sample array */
  ingest(samples) {
    if (!samples?.length) return;
    this.#u.fill(0);
    this.#v.fill(0);
    this.#fill = 0;

    for (const s of samples) {
      const i = this.#idx(s.lat, s.lon);
      if (i < 0) continue;
      const rad = (s.dir ?? 0) * Math.PI / 180;
      this.#u[i] = (s.speed ?? 0) * Math.sin(rad);
      this.#v[i] = (s.speed ?? 0) * Math.cos(rad);
      this.#fill++;
    }

    bus.emit(Events.WIND_FIELD_READY, { u: this.#u, v: this.#v, rows: GRID_LAT, cols: GRID_LON });
  }

  /** Sample wind at arbitrary lat/lon via bilinear interpolation */
  sample(lat, lon) {
    const c = this.#cell(lat, lon);
    // Bilinear weights
    const u = this.#bilerp(this.#u, c.r, c.c, c.fr, c.fc);
    const v = this.#bilerp(this.#v, c.r, c.c, c.fr, c.fc);
    return { u, v, speed: Math.hypot(u, v) };
  }

  get grid() { return { u: this.#u, v: this.#v, rows: GRID_LAT, cols: GRID_LON }; }
  get filled() { return this.#fill; }

  #idx(lat, lon) {
    const r = Math.floor((90  - lat) / LAT_STEP);
    const c = Math.floor((lon + 180) / LON_STEP);
    if (r < 0 || r >= GRID_LAT || c < 0 || c >= GRID_LON) return -1;
    return r * GRID_LON + c;
  }

  #cell(lat, lon) {
    const rf  = (90  - lat) / LAT_STEP;
    const cf  = (lon + 180) / LON_STEP;
    const r   = Math.max(0, Math.min(GRID_LAT - 1, Math.floor(rf)));
    const c   = Math.max(0, Math.min(GRID_LON - 1, Math.floor(cf)));
    return { r, c, fr: rf - r, fc: cf - c };
  }

  #bilerp(arr, r, c, fr, fc) {
    const r1 = Math.min(r + 1, GRID_LAT - 1);
    const c1 = Math.min(c + 1, GRID_LON  - 1);
    const q00 = arr[r  * GRID_LON + c ];
    const q10 = arr[r  * GRID_LON + c1];
    const q01 = arr[r1 * GRID_LON + c ];
    const q11 = arr[r1 * GRID_LON + c1];
    return q00*(1-fr)*(1-fc) + q10*(1-fr)*fc + q01*fr*(1-fc) + q11*fr*fc;
  }
}

export const windSim = new WindSim();
export default windSim;
