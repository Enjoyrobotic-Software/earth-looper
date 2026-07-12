/**
 * EarthOS ConflictLayer — renders armed conflict zones as pulsing cross markers.
 * Data: ACLEDSource → LAYER_DATA_READY { id:'conflicts' }
 * Color: per ACLED event type (Battles=red, Explosions=orange, etc.)
 */

import * as THREE      from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';
import bus, { Events } from '../../core/eventBus.js';

const MAX    = 500;
const RADIUS = 1.0;

function typeColor(type) {
  return {
    'Battles':         '#e05555',
    'Explosions':      '#ff8800',
    'Violence vs Civ': '#d4854a',
    'Protests':        '#4a90d4',
    'Riots':           '#9c6dd4',
    'Strategic Devs':  '#4caf7d',
  }[type] ?? '#aaaaaa';
}

export class ConflictLayer {
  #mesh  = null;
  #dummy = new THREE.Object3D();
  #t     = 0;
  #data  = [];

  init(scene) {
    // Cross shape: two thin boxes merged via group
    const barH = new THREE.BoxGeometry(0.004, 0.015, 0.001);
    const barV = new THREE.BoxGeometry(0.015, 0.004, 0.001);
    // Merge both into one BufferGeometry
    const merged = this.#mergeCross(barH, barV);
    const mat    = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });
    this.#mesh   = new THREE.InstancedMesh(merged, mat, MAX);
    this.#mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.#mesh.count = 0;
    scene.add(this.#mesh);

    bus.on(Events.LAYER_DATA_READY, d => {
      if (d.id === 'conflicts') this.#update(d.events);
    });
    bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      if (id === 'conflicts' && this.#mesh) this.#mesh.visible = enabled;
    });
  }

  #update(events) {
    if (!this.#mesh) return;
    this.#data = events.slice(0, MAX);
    const color = new THREE.Color();

    for (let i = 0; i < this.#data.length; i++) {
      const ev   = this.#data[i];
      const phi  = (90 - ev.lat) * Math.PI / 180;
      const th   = (ev.lon + 180) * Math.PI / 180;
      const r    = RADIUS + 0.002;
      this.#dummy.position.set(
        r * Math.sin(phi) * Math.cos(th),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(th)
      );
      this.#dummy.lookAt(this.#dummy.position.clone().multiplyScalar(2));
      this.#dummy.updateMatrix();
      this.#mesh.setMatrixAt(i, this.#dummy.matrix);
      this.#mesh.setColorAt(i, color.set(typeColor(ev.detail?.type)));
    }

    this.#mesh.count = this.#data.length;
    this.#mesh.instanceMatrix.needsUpdate = true;
    if (this.#mesh.instanceColor) this.#mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    if (!this.#mesh || !this.#data.length) return;
    this.#t += dt;
    // Subtle pulse: scale all markers slightly in and out
    const s = 1 + 0.12 * Math.sin(this.#t * 0.002);
    this.#mesh.scale.setScalar(s);
  }

  dispose() { this.#mesh?.geometry.dispose(); this.#mesh?.material.dispose(); }

  #mergeCross(geoH, geoV) {
    const merged = new THREE.BufferGeometry();
    const posH   = geoH.attributes.position.array;
    const posV   = geoV.attributes.position.array;
    const pos    = new Float32Array(posH.length + posV.length);
    pos.set(posH); pos.set(posV, posH.length);
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const idxH = Array.from(geoH.index.array);
    const idxV = Array.from(geoV.index.array).map(i => i + posH.length / 3);
    merged.setIndex([...idxH, ...idxV]);
    merged.computeVertexNormals();
    return merged;
  }
}

export default ConflictLayer;
