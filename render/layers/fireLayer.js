/**
 * EarthOS Layer Renderer: Active Fires (NASA FIRMS)
 * Uses additive blending for the "burning planet" effect.
 * Points scale with Fire Radiative Power (FRP).
 */

import bus, { Events }         from '../../core/eventBus.js';
import { latLonToXYZ, RADIUS } from '../globe.js';

const MAX_INSTANCES = 50_000;

// FRP → visual scale mapping
function frpScale(frp) {
  if (frp > 1000) return 0.012;
  if (frp > 500)  return 0.009;
  if (frp > 100)  return 0.006;
  if (frp > 10)   return 0.004;
  return 0.002;
}

// FRP → color (yellow → orange → red → white-hot)
function frpColor(frp, THREE) {
  if (frp > 2000) return new THREE.Color(1.0, 1.0, 0.8);  // white-hot
  if (frp > 500)  return new THREE.Color(1.0, 0.3, 0.0);  // deep orange
  if (frp > 100)  return new THREE.Color(1.0, 0.5, 0.0);  // orange
  if (frp > 10)   return new THREE.Color(1.0, 0.7, 0.0);  // yellow-orange
  return new THREE.Color(0.9, 0.9, 0.2);                   // yellow
}

export class FireLayerRenderer {
  #mesh;
  #scene;
  #matrix;
  #events = [];
  #time   = 0;
  #unsub  = [];

  init(scene, camera, renderer) {
    this.#scene  = scene;
    const THREE  = window.THREE;
    this.#matrix = new THREE.Matrix4();

    const geo = new THREE.SphereGeometry(1, 5, 5);
    const mat  = new THREE.MeshBasicMaterial({
      vertexColors: true,
      blending:     THREE.AdditiveBlending,
      depthWrite:   false,
      transparent:  true,
      opacity:      0.85,
    });
    this.#mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES);
    this.#mesh.count         = 0;
    this.#mesh.frustumCulled = false;
    this.#mesh.visible       = false;
    (scene.userData.rotGroup ?? scene).add(this.#mesh);

    this.#unsub.push(bus.on(Events.LAYER_DATA_READY, ({ id, events }) => {
      if (id === 'fires') this.#update(events);
    }));
    this.#unsub.push(bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      if (id === 'fires') this.#mesh.visible = enabled;
    }));
  }

  update(dt) {
    this.#time += dt;
    // Gentle flicker on high-FRP fires
    const THREE = window.THREE;
    let dirty   = false;

    for (let i = 0; i < Math.min(this.#events.length, 500); i++) {
      const ev  = this.#events[i];
      const frp = ev.detail?.frp ?? 0;
      if (frp < 100) break; // events sorted desc — rest are small

      const flicker = 1 + 0.15 * Math.sin(this.#time * 8 + i * 1.3);
      const s   = frpScale(frp) * flicker;
      const pos = latLonToXYZ(ev.lat, ev.lon, RADIUS + 0.001);
      this.#matrix.makeScale(s, s, s);
      this.#matrix.setPosition(pos.x, pos.y, pos.z);
      this.#mesh.setMatrixAt(i, this.#matrix);
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
    const THREE  = window.THREE;
    const sorted = [...events].sort((a, b) => (b.detail?.frp ?? 0) - (a.detail?.frp ?? 0));
    const count  = Math.min(sorted.length, MAX_INSTANCES);
    const color  = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const ev  = sorted[i];
      const frp = ev.detail?.frp ?? 0;
      const s   = frpScale(frp);
      const pos = latLonToXYZ(ev.lat, ev.lon, RADIUS + 0.001);
      this.#matrix.makeScale(s, s, s);
      this.#matrix.setPosition(pos.x, pos.y, pos.z);
      this.#mesh.setMatrixAt(i, this.#matrix);
      this.#mesh.setColorAt(i, frpColor(frp, THREE));
    }

    this.#mesh.count = count;
    this.#mesh.instanceMatrix.needsUpdate = true;
    if (this.#mesh.instanceColor) this.#mesh.instanceColor.needsUpdate = true;
    this.#events = sorted;
  }
}

export default FireLayerRenderer;
