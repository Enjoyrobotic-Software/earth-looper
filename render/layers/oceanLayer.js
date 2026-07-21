/**
 * EarthOS OceanLayer — SST heatmap rendered as instanced flat discs on the globe.
 * Data: CopernicusSource → LAYER_DATA_READY { id:'ocean', type:'sst_grid' }
 * Color: -2°C (deep blue) → 0 (cyan) → 15 (green) → 28 (orange) → 35°C (red)
 */

import bus, { Events } from '../../core/eventBus.js';

const MAX = 300;
const R   = 1.0;

function sstColor(sst) {
  const THREE = window.THREE;
  const t = Math.max(0, Math.min(1, (sst + 2) / 37));
  if (t < 0.25) return new THREE.Color().setHSL(0.67, 1.0, 0.3 + t * 0.8);
  if (t < 0.5)  return new THREE.Color().setHSL(0.45, 1.0, 0.4);
  if (t < 0.75) return new THREE.Color().setHSL(0.10, 1.0, 0.5);
  return new THREE.Color().setHSL(0.02, 1.0, 0.45);
}

export class OceanLayer {
  #mesh  = null;
  #scene = null;
  #dummy = null;

  init(scene) {
    const THREE  = window.THREE;
    this.#scene  = scene;
    this.#dummy  = new THREE.Object3D();

    const geo  = new THREE.CircleGeometry(0.07, 6);
    const mat  = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false });
    this.#mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.#mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.#mesh.renderOrder = 1;
    this.#mesh.count = 0;
    scene.add(this.#mesh);

    bus.on(Events.LAYER_DATA_READY, data => {
      if (data.id === 'ocean' && data.type === 'sst_grid') this.#update(data.events);
    });

    bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      if (id === 'ocean' && this.#mesh) this.#mesh.visible = enabled;
    });
  }

  #update(grid) {
    if (!this.#mesh || !grid?.length) return;
    const THREE = window.THREE;
    const count = Math.min(grid.length, MAX);
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const { lat, lon, sst } = grid[i];
      const phi   = (90 - lat) * Math.PI / 180;
      const theta = (lon + 180) * Math.PI / 180;
      const r     = R + 0.001;

      this.#dummy.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      );
      this.#dummy.lookAt(0, 0, 0);
      this.#dummy.updateMatrix();
      this.#mesh.setMatrixAt(i, this.#dummy.matrix);
      this.#mesh.setColorAt(i, sstColor(sst));
    }

    this.#mesh.count = count;
    this.#mesh.instanceMatrix.needsUpdate = true;
    if (this.#mesh.instanceColor) this.#mesh.instanceColor.needsUpdate = true;
  }

  update() {}
  dispose() { this.#mesh?.geometry.dispose(); this.#mesh?.material.dispose(); }
}

export default OceanLayer;
