/**
 * EarthOS Layer Renderer: Earthquakes
 * Uses instanced mesh for GPU performance — handles 10 000+ points at 60 fps.
 */

import bus, { Events }          from '../../core/eventBus.js';
import { latLonToXYZ, RADIUS }  from '../globe.js';

const MAX_INSTANCES = 20_000;

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
  #scene;
  #count  = 0;
  #matrix;
  #color;
  #events = [];
  #unsub;

  init(scene, camera, renderer) {
    this.#scene  = scene;
    const THREE  = window.THREE;
    this.#matrix = new THREE.Matrix4();
    this.#color  = new THREE.Color();

    const geo  = new THREE.SphereGeometry(1, 8, 8);
    const mat  = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.#mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES);
    this.#mesh.count          = 0;
    this.#mesh.frustumCulled  = false;
    this.#mesh.visible        = false;
    scene.add(this.#mesh);

    // Listen for layer data
    this.#unsub = bus.on(Events.LAYER_DATA_READY, ({ id, events }) => {
      if (id === 'earthquakes') this.#update(events);
    });

    bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      if (id === 'earthquakes') this.#mesh.visible = enabled;
    });
  }

  update() {} // animated in future (pulse rings)

  dispose() {
    this.#unsub?.();
    this.#mesh.geometry.dispose();
    this.#mesh.material.dispose();
    this.#scene.remove(this.#mesh);
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

    this.#events = sorted;
  }

  /** Return earthquake at screen position (for click handling) */
  pick(raycaster) {
    const hits = raycaster.intersectObject(this.#mesh);
    if (!hits.length) return null;
    return this.#events[hits[0].instanceId] ?? null;
  }
}

export default EarthquakeLayerRenderer;
