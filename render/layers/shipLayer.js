/**
 * EarthOS Layer Renderer: Ships (AIS)
 * InstancedMesh — handles 500K+ vessels.
 * Color-coded by ship category (cargo, tanker, passenger, fishing, military…).
 */

import bus, { Events }         from '../../core/eventBus.js';
import { latLonToXYZ, RADIUS } from '../globe.js';

const MAX_INSTANCES = 100_000;

const CATEGORY_COLOR = {
  'Cargo':     0x2196f3,
  'Tanker':    0xe91e63,
  'Passenger': 0x4caf7d,
  'Fishing':   0xff9800,
  'Military':  0xf44336,
  'Tug':       0x9c27b0,
  'Sailing':   0x00bcd4,
  'Pleasure':  0x8bc34a,
  'SAR':       0xffeb3b,
  'HSC':       0x00e5ff,
  'Unknown':   0x607d8b,
  'Other':     0x607d8b,
};

export class ShipLayerRenderer {
  #mesh;
  #scene;
  #matrix;
  #color;
  #ships  = [];
  #unsub  = [];

  init(scene, camera, renderer) {
    this.#scene  = scene;
    const THREE  = window.THREE;
    this.#matrix = new THREE.Matrix4();
    this.#color  = new THREE.Color();

    // Flat diamond shape
    const geo = new THREE.ConeGeometry(0.0015, 0.004, 4);
    geo.rotateX(Math.PI / 2);

    const mat  = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.#mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES);
    this.#mesh.count         = 0;
    this.#mesh.frustumCulled = false;
    this.#mesh.visible       = false;
    scene.add(this.#mesh);

    this.#unsub.push(bus.on(Events.LAYER_DATA_READY, ({ id, events }) => {
      if (id === 'ships') this.#batch(events);
    }));
    this.#unsub.push(bus.on(Events.SHIP_UPDATE, (ev) => this.#updateOne(ev)));
    this.#unsub.push(bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      if (id === 'ships') this.#mesh.visible = enabled;
    }));
  }

  update() {} // ships don't dead-reckon (AIS updates fast enough)

  dispose() {
    for (const u of this.#unsub) u?.();
    this.#mesh.geometry.dispose();
    this.#mesh.material.dispose();
    this.#scene.remove(this.#mesh);
  }

  #batch(events) {
    this.#ships = events.slice(0, MAX_INSTANCES);
    for (let i = 0; i < this.#ships.length; i++) {
      this.#setInstance(i, this.#ships[i]);
    }
    this.#mesh.count = this.#ships.length;
    this.#mesh.instanceMatrix.needsUpdate = true;
    if (this.#mesh.instanceColor) this.#mesh.instanceColor.needsUpdate = true;
  }

  #updateOne(ev) {
    // Find existing or append
    const idx = this.#ships.findIndex(s => s.id === ev.id);
    if (idx >= 0) {
      this.#ships[idx] = ev;
      this.#setInstance(idx, ev);
    } else if (this.#ships.length < MAX_INSTANCES) {
      const i = this.#ships.length;
      this.#ships.push(ev);
      this.#setInstance(i, ev);
      this.#mesh.count = this.#ships.length;
    }
    this.#mesh.instanceMatrix.needsUpdate = true;
    if (this.#mesh.instanceColor) this.#mesh.instanceColor.needsUpdate = true;
  }

  #setInstance(i, ship) {
    const THREE = window.THREE;
    const pos   = latLonToXYZ(ship.lat, ship.lon, RADIUS + 0.001);
    const hdg   = ((ship.detail?.heading ?? 0) * Math.PI) / 180;

    const fwd = new THREE.Vector3(Math.sin(hdg), 0, -Math.cos(hdg));
    const up  = new THREE.Vector3(pos.x, pos.y, pos.z).normalize();
    const mat4 = new THREE.Matrix4();
    mat4.lookAt(
      new THREE.Vector3(pos.x, pos.y, pos.z),
      new THREE.Vector3(pos.x + fwd.x * 0.01, pos.y, pos.z + fwd.z * 0.01),
      up
    );
    mat4.setPosition(pos.x, pos.y, pos.z);
    this.#mesh.setMatrixAt(i, mat4);

    const hex = CATEGORY_COLOR[ship.detail?.category] ?? CATEGORY_COLOR.Unknown;
    this.#mesh.setColorAt(i, this.#color.set(hex));
  }
}

export default ShipLayerRenderer;
