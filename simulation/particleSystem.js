/**
 * EarthOS ParticleSystem — CPU-side wind particle advection.
 * Particles are advected on the globe surface using WindSim's bilinear field.
 * Positions are uploaded to a Float32Array consumed by windLayer.js.
 *
 * 5 000 particles, 50-second lifetime, restart at random when they die.
 */

import windSim from './windSim.js';

const COUNT    = 5_000;
const LIFETIME = 50_000;   // ms
const SPEED    = 0.00006;  // globe-surface units per ms per knot

function randLat() { return (Math.random() - 0.5) * 160; }
function randLon() { return (Math.random() - 0.5) * 360; }

export class ParticleSystem {
  #lat   = new Float32Array(COUNT);
  #lon   = new Float32Array(COUNT);
  #age   = new Float32Array(COUNT);
  #life  = new Float32Array(COUNT);  // randomised per particle
  #positions = new Float32Array(COUNT * 3);  // XYZ for renderer
  #running = false;
  #last    = 0;

  constructor() {
    for (let i = 0; i < COUNT; i++) this.#spawn(i);
  }

  start() { this.#running = true; this.#last = performance.now(); }
  stop()  { this.#running = false; }

  tick(now = performance.now()) {
    if (!this.#running) return this.#positions;
    const dt = Math.min(now - this.#last, 100);
    this.#last = now;

    for (let i = 0; i < COUNT; i++) {
      this.#age[i] += dt;
      if (this.#age[i] > this.#life[i]) { this.#spawn(i); continue; }

      const { u, v } = windSim.sample(this.#lat[i], this.#lon[i]);
      this.#lon[i] += u * SPEED * dt;
      this.#lat[i] += v * SPEED * dt;

      // Clamp lat; wrap lon
      this.#lat[i] = Math.max(-85, Math.min(85, this.#lat[i]));
      if (this.#lon[i] >  180) this.#lon[i] -= 360;
      if (this.#lon[i] < -180) this.#lon[i] += 360;

      this.#toXYZ(i, this.#lat[i], this.#lon[i]);
    }

    return this.#positions;
  }

  get positions() { return this.#positions; }
  get count()     { return COUNT; }

  #spawn(i) {
    this.#lat[i]  = randLat();
    this.#lon[i]  = randLon();
    this.#age[i]  = 0;
    this.#life[i] = LIFETIME * (0.3 + Math.random() * 0.7);
    this.#toXYZ(i, this.#lat[i], this.#lon[i]);
  }

  #toXYZ(i, lat, lon) {
    const phi   = (90 - lat) * Math.PI / 180;
    const theta = (lon + 180) * Math.PI / 180;
    const r     = 1.001;   // just above surface
    this.#positions[i * 3]     = -(r * Math.sin(phi) * Math.cos(theta));
    this.#positions[i * 3 + 1] = r * Math.cos(phi);
    this.#positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
}

export const particleSystem = new ParticleSystem();
export default particleSystem;
