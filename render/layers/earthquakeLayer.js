/**
 * EarthOS Layer Renderer: Earthquakes
 * Uses instanced mesh for GPU performance — handles 10 000+ points at 60 fps.
 * M≥5 earthquakes get animated pulsing rings (additive blending, no extra draw cost).
 */

import bus, { Events }          from '../../core/eventBus.js';
import { latLonToXYZ, RADIUS }  from '../globe.js';

const MAX_INSTANCES = 20_000;
const MAX_RINGS     = 200;   // M≥5 earthquakes shown with pulsing rings
const RING_PERIOD   = 2.8;   // seconds per pulse cycle
const MIN_MAG_RING  = 5.0;   // minimum magnitude for ring animation

const MAG_COLOR = [
  [0, 2,   0x44aaff],  // micro
  [2, 4,   0x88dd55],  // minor
  [4, 5,   0xffdd00],  // light
  [5, 6,   0xff9900],  // moderate
  [6, 7,   0xff4400],  // strong
  [7, 8,   0xdd0000],  // major
  [8, 10,  0xaa00ff],  // great
];

function magColor(mag, THREE) {
  for (const [lo, hi, hex] of MAG_COLOR) {
    if (mag >= lo && mag < hi) return new THREE.Color(hex);
  }
  return new THREE.Color(0xaa00ff);
}

function magScale(mag) {
  return Math.max(0.002, Math.min(0.05, 0.002 * Math.pow(2, mag - 1)));
}

export class EarthquakeLayerRenderer {
  #mesh;
  #rings;
  #scene;
  #matrix;
  #color;
  #events    = [];
  #sigEvents = [];   // significant (M≥5) earthquakes
  #time      = 0;
  #unsub;

  init(scene, camera, renderer) {
    this.#scene  = scene;
    const THREE  = window.THREE;
    this.#matrix = new THREE.Matrix4();
    this.#color  = new THREE.Color();

    // ── Dot markers ──────────────────────────────────────────────────────────
    const geo  = new THREE.SphereGeometry(1, 8, 8);
    const mat  = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.#mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES);
    this.#mesh.count          = 0;
    this.#mesh.frustumCulled  = false;
    this.#mesh.visible        = false;

    // ── Pulsing rings for M≥5 ────────────────────────────────────────────────
    const ringGeo = new THREE.TorusGeometry(1, 0.06, 4, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      blending:     THREE.AdditiveBlending,
      depthWrite:   false,
      transparent:  true,
    });
    this.#rings = new THREE.InstancedMesh(ringGeo, ringMat, MAX_RINGS);
    this.#rings.count         = 0;
    this.#rings.frustumCulled = false;
    this.#rings.visible       = false;
    this.#rings.renderOrder   = 2;

    const _g = scene.userData.rotGroup ?? scene;
    _g.add(this.#mesh);
    _g.add(this.#rings);

    // Listen for layer data
    this.#unsub = bus.on(Events.LAYER_DATA_READY, ({ id, events }) => {
      if (id === 'earthquakes') this.#update(events);
    });

    bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      if (id === 'earthquakes') {
        this.#mesh.visible  = enabled;
        this.#rings.visible = enabled;
      }
    });
  }

  update(dt) {
    if (!this.#rings.visible || !this.#sigEvents.length) return;
    const THREE = window.THREE;
    this.#time += dt;

    const count = Math.min(this.#sigEvents.length, MAX_RINGS);
    for (let i = 0; i < count; i++) {
      const ev    = this.#sigEvents[i];
      const mag   = ev.magnitude ?? 5;
      const base  = magScale(mag) * 1.2;
      // Each ring gets a phase offset so they don't pulse in lockstep
      const phase = (this.#time / RING_PERIOD + i * 0.13) % 1.0;
      const s     = base * (1 + phase * 6);          // grows 1x → 7x
      const alpha = Math.pow(1 - phase, 1.8) * 0.9;  // fast fade

      const pos = latLonToXYZ(ev.lat, ev.lon, RADIUS + 0.001);
      // Orient ring to face outward from globe surface
      // TorusGeometry lies in XY plane — need to align it to the surface normal
      this.#matrix.makeScale(s, s, s);
      this.#matrix.setPosition(pos.x, pos.y, pos.z);
      this.#rings.setMatrixAt(i, this.#matrix);

      const col = magColor(mag, THREE).clone().multiplyScalar(alpha);
      this.#rings.setColorAt(i, col);
    }

    this.#rings.instanceMatrix.needsUpdate = true;
    if (this.#rings.instanceColor) this.#rings.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.#unsub?.();
    this.#mesh.geometry.dispose();
    this.#mesh.material.dispose();
    this.#rings.geometry.dispose();
    this.#rings.material.dispose();
    this.#mesh.parent?.remove(this.#mesh);
    this.#rings.parent?.remove(this.#rings);
  }

  #update(events) {
    const THREE  = window.THREE;
    const sorted = [...events].sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0));
    const count  = Math.min(sorted.length, MAX_INSTANCES);

    for (let i = 0; i < count; i++) {
      const ev   = sorted[i];
      const mag  = ev.magnitude ?? 0;
      const s    = magScale(mag);
      const pos  = latLonToXYZ(ev.lat, ev.lon);

      this.#matrix.makeScale(s, s, s);
      this.#matrix.setPosition(pos.x, pos.y, pos.z);
      this.#mesh.setMatrixAt(i, this.#matrix);
      this.#mesh.setColorAt(i, magColor(mag, THREE));
    }

    this.#mesh.count = count;
    this.#mesh.instanceMatrix.needsUpdate = true;
    if (this.#mesh.instanceColor) this.#mesh.instanceColor.needsUpdate = true;

    this.#events    = sorted;
    this.#sigEvents = sorted.filter(e => (e.magnitude ?? 0) >= MIN_MAG_RING).slice(0, MAX_RINGS);
    this.#rings.count = this.#sigEvents.length;
  }

  /** Return earthquake at screen position (for click handling) */
  pick(raycaster) {
    const hits = raycaster.intersectObject(this.#mesh);
    if (!hits.length) return null;
    return this.#events[hits[0].instanceId] ?? null;
  }
}

export default EarthquakeLayerRenderer;
