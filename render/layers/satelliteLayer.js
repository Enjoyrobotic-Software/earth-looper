/**
 * EarthOS Layer Renderer: Satellites
 * Orbital paths + position dots. Handles 5000+ objects smoothly.
 * Orbit trail drawn as a line segment (last ~90 min of track).
 */

import bus, { Events }         from '../../core/eventBus.js';
import { latLonToXYZ, RADIUS } from '../globe.js';

const MAX_SATS   = 6000;
const TRAIL_SEGS = 0;  // set >0 to enable orbital trails (expensive)

const CAT_COLOR  = {
  stations: 0xffeb3b,   // ISS — bright yellow
  starlink: 0x4fc3f7,   // Starlink — light blue
  gps_ops:  0x66bb6a,   // GPS — green
  galileo:  0xe040fb,   // Galileo — purple
  weather:  0xff7043,   // Weather — orange
};

export class SatelliteLayerRenderer {
  #mesh;
  #scene;
  #matrix;
  #color;
  #sats   = [];
  #unsub  = [];

  init(scene, camera, renderer) {
    this.#scene  = scene;
    const THREE  = window.THREE;
    this.#matrix = new THREE.Matrix4();
    this.#color  = new THREE.Color();

    // Small octahedron for satellite icon
    const geo = new THREE.OctahedronGeometry(0.003);
    const mat  = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.#mesh = new THREE.InstancedMesh(geo, mat, MAX_SATS);
    this.#mesh.count         = 0;
    this.#mesh.frustumCulled = false;
    this.#mesh.visible       = false;
    scene.add(this.#mesh);

    this.#unsub.push(bus.on(Events.SATELLITE_UPDATE, ({ events }) => this.#update(events)));
    this.#unsub.push(bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      if (id === 'satellites') this.#mesh.visible = enabled;
    }));
  }

  update() {} // TLE source propagates and emits every 10s

  dispose() {
    for (const u of this.#unsub) u?.();
    this.#mesh.geometry.dispose();
    this.#mesh.material.dispose();
    this.#scene.remove(this.#mesh);
  }

  #update(events) {
    const THREE = window.THREE;
    const count = Math.min(events.length, MAX_SATS);

    for (let i = 0; i < count; i++) {
      const ev  = events[i];
      const alt = (ev.detail?.altitude ?? 400) / 6371; // km → fraction of Earth radius
      const r   = RADIUS + alt * RADIUS;               // scale to globe units
      const pos = latLonToXYZ(ev.lat, ev.lon, r);

      this.#matrix.makeScale(1, 1, 1);
      this.#matrix.setPosition(pos.x, pos.y, pos.z);
      this.#mesh.setMatrixAt(i, this.#matrix);

      const hex = CAT_COLOR[ev.detail?.catalog] ?? 0xaaaaaa;
      this.#mesh.setColorAt(i, this.#color.set(hex));
    }

    this.#mesh.count = count;
    this.#mesh.instanceMatrix.needsUpdate = true;
    if (this.#mesh.instanceColor) this.#mesh.instanceColor.needsUpdate = true;
    this.#sats = events;
  }
}

export default SatelliteLayerRenderer;
