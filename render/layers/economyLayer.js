/**
 * EarthOS EconomyLayer — GDP per capita choropleth on the globe.
 * Renders extruded pillars at each country's centroid.
 * Height ∝ GDP per capita (log scale). Color: low=red → mid=yellow → high=green.
 * Data: WorldBankSource → LAYER_DATA_READY { id:'gdp' }
 */

import * as THREE      from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';
import bus, { Events } from '../../core/eventBus.js';

const MAX    = 250;
const RADIUS = 1.0;
const MAX_H  = 0.08;   // max pillar height in globe units

function gdpColor(gdp) {
  // log scale 0–120 000
  const t = Math.min(1, Math.log10(Math.max(1, gdp)) / Math.log10(120_000));
  if (t < 0.4)  return new THREE.Color('#cc3333');
  if (t < 0.65) return new THREE.Color('#ddaa00');
  return new THREE.Color('#33bb55');
}

function gdpHeight(gdp) {
  return MAX_H * Math.min(1, Math.log10(Math.max(1, gdp)) / Math.log10(120_000));
}

export class EconomyLayer {
  #mesh  = null;
  #dummy = new THREE.Object3D();

  init(scene) {
    const geo = new THREE.CylinderGeometry(0.003, 0.003, 1, 5);
    geo.translate(0, 0.5, 0);   // pivot at base
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 });
    this.#mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.#mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.#mesh.count = 0;
    scene.add(this.#mesh);

    bus.on(Events.LAYER_DATA_READY, d => {
      if (d.id === 'gdp') this.#update(d.events);
    });
    bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      if (id === 'gdp' && this.#mesh) this.#mesh.visible = enabled;
    });
  }

  #update(events) {
    if (!this.#mesh) return;
    const shown = events.slice(0, MAX);
    const color = new THREE.Color();

    for (let i = 0; i < shown.length; i++) {
      const ev  = shown[i];
      const gdp = ev.magnitude ?? 0;
      const h   = gdpHeight(gdp);

      const phi = (90 - ev.lat) * Math.PI / 180;
      const th  = (ev.lon + 180) * Math.PI / 180;
      const nx  = Math.sin(phi) * Math.cos(th);
      const ny  = Math.cos(phi);
      const nz  = Math.sin(phi) * Math.sin(th);

      // Position pillar base on surface
      this.#dummy.position.set(nx * RADIUS, ny * RADIUS, nz * RADIUS);

      // Align pillar along outward normal (up = outward)
      const up = new THREE.Vector3(nx, ny, nz);
      this.#dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);

      this.#dummy.scale.set(1, h, 1);
      this.#dummy.updateMatrix();
      this.#mesh.setMatrixAt(i, this.#dummy.matrix);
      this.#mesh.setColorAt(i, color.set(gdpColor(gdp)));
    }

    this.#mesh.count = shown.length;
    this.#mesh.instanceMatrix.needsUpdate = true;
    if (this.#mesh.instanceColor) this.#mesh.instanceColor.needsUpdate = true;
  }

  update() {}
  dispose() { this.#mesh?.geometry.dispose(); this.#mesh?.material.dispose(); }
}

export default EconomyLayer;
