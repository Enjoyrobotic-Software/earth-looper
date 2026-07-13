/**
 * EarthOS Layer Renderer: Satellites
 * Orbital paths + position dots. Handles 5000+ objects smoothly.
 * ISS gets a real-time orbit trail (last 90 minutes of position history).
 */

import bus, { Events }         from '../../core/eventBus.js';
import { latLonToXYZ, RADIUS } from '../globe.js';

const MAX_SATS   = 6000;
const ISS_TRAIL_MAX = 180;  // 180 positions × 30s interval = 90 minutes of trail

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
  #sats      = [];
  #issTrail  = [];     // position history for ISS
  #trailLine = null;   // THREE.Line for ISS trail
  #unsub     = [];

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

    // ISS orbit trail — a LINE with gradient opacity
    this.#buildTrail(THREE, scene);

    this.#unsub.push(bus.on(Events.SATELLITE_UPDATE, ({ events }) => this.#update(events)));
    this.#unsub.push(bus.on(Events.LAYER_DATA_READY, ({ id, events }) => {
      if (id === 'satellites') this.#update(events);
    }));
    this.#unsub.push(bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      if (id === 'satellites') {
        this.#mesh.visible = enabled;
        if (this.#trailLine) this.#trailLine.visible = enabled;
      }
    }));
  }

  #buildTrail(THREE, scene) {
    const maxPts = ISS_TRAIL_MAX;
    const pos    = new Float32Array(maxPts * 3);
    const geo    = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setDrawRange(0, 0);

    const mat = new THREE.LineBasicMaterial({
      color:       0xffeb3b,
      transparent: true,
      opacity:     0.55,
      depthWrite:  false,
      linewidth:   1,
    });

    this.#trailLine = new THREE.Line(geo, mat);
    this.#trailLine.frustumCulled = false;
    this.#trailLine.visible       = false;
    this.#trailLine.renderOrder   = 1;
    scene.add(this.#trailLine);
  }

  update() {}

  dispose() {
    for (const u of this.#unsub) u?.();
    this.#mesh.geometry.dispose();
    this.#mesh.material.dispose();
    this.#trailLine?.geometry.dispose();
    this.#trailLine?.material.dispose();
    this.#scene.remove(this.#mesh);
    if (this.#trailLine) this.#scene.remove(this.#trailLine);
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

      // Track ISS position for trail
      if (ev.detail?.catalog === 'stations' || ev.id === 'sat_25544') {
        this.#updateISSTrail(ev, RADIUS + alt * RADIUS);
      }
    }

    this.#mesh.count = count;
    this.#mesh.instanceMatrix.needsUpdate = true;
    if (this.#mesh.instanceColor) this.#mesh.instanceColor.needsUpdate = true;
    this.#sats = events;
  }

  #updateISSTrail(ev, r) {
    const pos = latLonToXYZ(ev.lat, ev.lon, r);
    this.#issTrail.push({ x: pos.x, y: pos.y, z: pos.z });
    if (this.#issTrail.length > ISS_TRAIL_MAX) this.#issTrail.shift();

    const n = this.#issTrail.length;
    if (n < 2 || !this.#trailLine) return;

    const arr = this.#trailLine.geometry.attributes.position.array;
    for (let i = 0; i < n; i++) {
      const p = this.#issTrail[i];
      arr[i * 3]     = p.x;
      arr[i * 3 + 1] = p.y;
      arr[i * 3 + 2] = p.z;
    }
    this.#trailLine.geometry.attributes.position.needsUpdate = true;
    this.#trailLine.geometry.setDrawRange(0, n);
  }
}

export default SatelliteLayerRenderer;
