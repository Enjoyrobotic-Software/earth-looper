/**
 * EarthOS PollutionLayer — AQI heatmap of ground-level air quality stations.
 * Data: OpenAQSource → LAYER_DATA_READY { id:'pollution' }
 * Color ramp: Good (green) → Moderate → USG → Unhealthy → Very Unhealthy → Hazardous (maroon)
 * Size ∝ AQI magnitude.
 */

import * as THREE      from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';
import bus, { Events } from '../../core/eventBus.js';
import { latLonToXYZ } from '../globe.js';

const MAX    = 2000;
const RADIUS = 1.0;

const AQI_STOPS = [
  [0,   50,  '#4caf7d'],   // Good
  [51,  100, '#cddc39'],   // Moderate
  [101, 150, '#ff9800'],   // Unhealthy for Sensitive Groups
  [151, 200, '#f44336'],   // Unhealthy
  [201, 300, '#9c27b0'],   // Very Unhealthy
  [301, 500, '#880e4f'],   // Hazardous
];

function aqiColor(aqi) {
  for (const [lo, hi, hex] of AQI_STOPS) {
    if (aqi <= hi) return hex;
  }
  return '#880e4f';
}

function aqiScale(aqi) {
  return 0.003 + Math.min(aqi / 500, 1) * 0.012;
}

export class PollutionLayer {
  #mesh  = null;
  #dummy = new THREE.Object3D();

  init(scene) {
    const geo = new THREE.SphereGeometry(1, 5, 5);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false });
    this.#mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.#mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.#mesh.count = 0;
    this.#mesh.renderOrder = 3;
    (scene.userData.rotGroup ?? scene).add(this.#mesh);

    bus.on(Events.LAYER_DATA_READY, d => {
      if (d.id === 'pollution') this.#update(d.events);
    });
    bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      if (id === 'pollution' && this.#mesh) this.#mesh.visible = enabled;
    });
  }

  #update(events) {
    if (!this.#mesh) return;
    const shown = events.slice(0, MAX);
    const color = new THREE.Color();

    for (let i = 0; i < shown.length; i++) {
      const ev  = shown[i];
      const aqi = ev.magnitude ?? 0;
      const s   = aqiScale(aqi);
      const pos = latLonToXYZ(ev.lat, ev.lon, RADIUS + s * 0.5);

      this.#dummy.position.set(pos.x, pos.y, pos.z);
      this.#dummy.scale.setScalar(s);
      this.#dummy.updateMatrix();
      this.#mesh.setMatrixAt(i, this.#dummy.matrix);
      this.#mesh.setColorAt(i, color.set(aqiColor(aqi)));
    }

    this.#mesh.count = shown.length;
    this.#mesh.instanceMatrix.needsUpdate = true;
    if (this.#mesh.instanceColor) this.#mesh.instanceColor.needsUpdate = true;
  }

  update() {}
  dispose() { this.#mesh?.geometry.dispose(); this.#mesh?.material.dispose(); }
}

export default PollutionLayer;
