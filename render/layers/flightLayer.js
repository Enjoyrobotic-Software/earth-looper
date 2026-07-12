/**
 * EarthOS Layer Renderer: Flights (OpenSky)
 * Instanced mesh — handles 10 000+ aircraft at 60 fps.
 * Each frame the positions are interpolated from last known state.
 */

import bus, { Events }         from '../../core/eventBus.js';
import { latLonToXYZ, RADIUS } from '../globe.js';

const MAX_INSTANCES = 15_000;
const FLIGHT_RADIUS = 0.0035;
const FLIGHT_COLOR  = 0x4caf7d;
const ALT_SCALE     = 0.0001; // metres → globe offset

export class FlightLayerRenderer {
  #mesh;
  #scene;
  #flights = [];
  #matrix;
  #unsub;

  init(scene, camera, renderer) {
    this.#scene  = scene;
    const THREE  = window.THREE;
    this.#matrix = new THREE.Matrix4();

    // Triangle pointing in direction of travel
    const geo = new THREE.ConeGeometry(FLIGHT_RADIUS, FLIGHT_RADIUS * 2.5, 4);
    geo.rotateX(Math.PI / 2);

    const mat  = new THREE.MeshBasicMaterial({ color: FLIGHT_COLOR });
    this.#mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES);
    this.#mesh.count         = 0;
    this.#mesh.frustumCulled = false;
    this.#mesh.visible       = false;
    scene.add(this.#mesh);

    this.#unsub = bus.on(Events.FLIGHT_UPDATE, ({ events }) => this.#update(events));
    bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      if (id === 'flights') this.#mesh.visible = enabled;
    });
  }

  update(dt) {
    // Dead-reckoning: move flights based on heading + speed
    for (let i = 0; i < Math.min(this.#flights.length, MAX_INSTANCES); i++) {
      const f   = this.#flights[i];
      if (!f?.detail) continue;
      const spd = (f.detail.speed ?? 0) * dt * 0.0001;
      const hdg = (f.detail.heading ?? 0) * (Math.PI / 180);
      f.lat    += Math.cos(hdg) * spd;
      f.lon    += Math.sin(hdg) * spd;
      this.#setInstance(i, f);
    }
    if (this.#flights.length) {
      this.#mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    this.#unsub?.();
    this.#mesh.geometry.dispose();
    this.#mesh.material.dispose();
    this.#scene.remove(this.#mesh);
  }

  #update(events) {
    this.#flights = events.slice(0, MAX_INSTANCES);
    const count   = this.#flights.length;

    for (let i = 0; i < count; i++) {
      this.#setInstance(i, this.#flights[i]);
    }
    this.#mesh.count = count;
    this.#mesh.instanceMatrix.needsUpdate = true;
  }

  #setInstance(i, flight) {
    const THREE = window.THREE;
    const alt   = Math.max(0, (flight.detail?.altitude ?? 10000));
    const r     = RADIUS + alt * ALT_SCALE + 0.002;
    const pos   = latLonToXYZ(flight.lat, flight.lon, r);

    const hdg   = (flight.detail?.heading ?? 0) * (Math.PI / 180);
    const up    = new THREE.Vector3(pos.x, pos.y, pos.z).normalize();
    const fwd   = new THREE.Vector3(Math.sin(hdg), 0, -Math.cos(hdg));
    const mat4  = new THREE.Matrix4();

    mat4.lookAt(
      new THREE.Vector3(pos.x, pos.y, pos.z),
      new THREE.Vector3(pos.x + fwd.x, pos.y + fwd.y, pos.z + fwd.z),
      up
    );
    mat4.setPosition(pos.x, pos.y, pos.z);
    this.#matrix.copy(mat4);
    this.#mesh.setMatrixAt(i, this.#matrix);
  }
}

export default FlightLayerRenderer;
