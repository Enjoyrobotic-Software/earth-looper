/**
 * EarthOS Layer Renderer: Volcanoes
 * Active volcanoes pulse; inactive ones are static.
 * Uses instanced mesh + custom shader for glow pulse effect.
 */

import bus, { Events }         from '../../core/eventBus.js';
import { latLonToXYZ, RADIUS } from '../globe.js';

const MAX_INSTANCES = 2000;

const ALERT_COLORS = {
  3: 0xff2200,   // Warning  — red
  2: 0xff8800,   // Watch    — orange
  1: 0xffdd00,   // Advisory — yellow
  0: 0x888888,   // Normal   — grey
};

export class VolcanoLayerRenderer {
  #mesh;
  #scene;
  #matrix;
  #color;
  #events    = [];
  #time      = 0;
  #unsub     = [];

  init(scene, camera, renderer) {
    this.#scene  = scene;
    const THREE  = window.THREE;
    this.#matrix = new THREE.Matrix4();
    this.#color  = new THREE.Color();

    // Cone shape pointing outward from globe surface
    const geo = new THREE.ConeGeometry(0.006, 0.018, 6);
    geo.rotateX(Math.PI);  // point outward

    const mat  = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.#mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES);
    this.#mesh.count         = 0;
    this.#mesh.frustumCulled = false;
    this.#mesh.visible       = false;
    scene.add(this.#mesh);

    this.#unsub.push(bus.on(Events.LAYER_DATA_READY, ({ id, events }) => {
      if (id === 'volcanoes') this.#update(events);
    }));
    this.#unsub.push(bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      if (id === 'volcanoes') this.#mesh.visible = enabled;
    }));
  }

  update(dt) {
    this.#time += dt;
    // Pulse active volcanoes by modulating their scale
    const THREE  = window.THREE;
    let dirty    = false;

    for (let i = 0; i < Math.min(this.#events.length, MAX_INSTANCES); i++) {
      const ev   = this.#events[i];
      const rank = ev.detail?.alertRank ?? 0;
      if (rank < 1) continue;

      const pulse = 1 + 0.35 * Math.sin(this.#time * 2.5 + i * 0.7);
      const s     = 0.014 * pulse;
      const pos   = latLonToXYZ(ev.lat, ev.lon, RADIUS + 0.003);
      const up    = new THREE.Vector3(pos.x, pos.y, pos.z).normalize();

      const mat4  = new THREE.Matrix4();
      mat4.lookAt(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(pos.x, pos.y, pos.z),
        new THREE.Vector3(0, 1, 0)
      );
      mat4.scale(new THREE.Vector3(s, s, s));
      mat4.setPosition(pos.x, pos.y, pos.z);
      this.#mesh.setMatrixAt(i, mat4);
      dirty = true;
    }

    if (dirty) this.#mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const u of this.#unsub) u?.();
    this.#mesh.geometry.dispose();
    this.#mesh.material.dispose();
    this.#scene.remove(this.#mesh);
  }

  #update(events) {
    const THREE   = window.THREE;
    const sorted  = [...events].sort((a, b) =>
      (b.detail?.alertRank ?? 0) - (a.detail?.alertRank ?? 0)
    );
    const count   = Math.min(sorted.length, MAX_INSTANCES);

    for (let i = 0; i < count; i++) {
      const ev   = sorted[i];
      const rank = ev.detail?.alertRank ?? 0;
      const s    = rank >= 2 ? 0.014 : rank === 1 ? 0.010 : 0.006;
      const pos  = latLonToXYZ(ev.lat, ev.lon, RADIUS + 0.003);

      const mat4 = new THREE.Matrix4();
      mat4.lookAt(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(pos.x, pos.y, pos.z),
        new THREE.Vector3(0, 1, 0)
      );
      mat4.scale(new THREE.Vector3(s, s, s));
      mat4.setPosition(pos.x, pos.y, pos.z);
      this.#mesh.setMatrixAt(i, mat4);
      this.#mesh.setColorAt(i, this.#color.set(ALERT_COLORS[rank] ?? 0x888888));
    }

    this.#mesh.count = count;
    this.#mesh.instanceMatrix.needsUpdate = true;
    if (this.#mesh.instanceColor) this.#mesh.instanceColor.needsUpdate = true;
    this.#events = sorted;
  }
}

export default VolcanoLayerRenderer;
