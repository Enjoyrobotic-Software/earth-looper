/**
 * EarthOS NightLayer — renders the dark side of Earth with a sharp terminator.
 * Uses a ShaderMaterial on a globe-sized sphere.
 * The sun direction uniform updates every second from solarPosition().
 *
 * Effect: hemisphere toward sun = transparent, away from sun = dark blue overlay.
 */

import * as THREE      from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';
import bus, { Events } from '../../core/eventBus.js';
import solarPosition   from '../../core/solarPosition.js';

const VERT = `
varying vec3 vWorldNormal;
void main() {
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = `
uniform vec3  uSunDir;
uniform float uOpacity;
varying vec3  vWorldNormal;
void main() {
  float cosA = dot(normalize(vWorldNormal), normalize(uSunDir));
  // Smooth terminator: dark on night side, transparent on day side
  float night = smoothstep(0.06, -0.10, cosA);
  gl_FragColor = vec4(0.02, 0.04, 0.10, night * uOpacity);
}`;

export class NightLayer {
  #mesh    = null;
  #mat     = null;
  #rotGrp  = null;   // reference to globe's rotation group
  #timer   = null;

  init(scene, camera, renderer, pluginMap) {
    // Get globe's rotation group so we counter-rotate (night sphere is world-space)
    const geo = new THREE.SphereGeometry(1.003, 64, 64);
    this.#mat = new THREE.ShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: FRAG,
      uniforms: {
        uSunDir:  { value: new THREE.Vector3(1, 0, 0) },
        uOpacity: { value: 0.82 },
      },
      transparent: true,
      depthWrite:  false,
      side: THREE.FrontSide,
    });

    this.#mesh = new THREE.Mesh(geo, this.#mat);
    this.#mesh.renderOrder = 1;
    scene.add(this.#mesh);

    this.#updateSun();
    this.#timer = setInterval(() => this.#updateSun(), 60_000);   // update every 60s

    bus.on(Events.TIME_CHANGED, ({ time }) => this.#updateSun(time));
    bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      if (id === 'night' && this.#mesh) this.#mesh.visible = enabled;
    });
  }

  #updateSun(ts = Date.now()) {
    if (!this.#mat) return;
    const { sunDir } = solarPosition(ts);
    this.#mat.uniforms.uSunDir.value.set(sunDir.x, sunDir.y, sunDir.z);
  }

  update() {
    // Counter-rotate the night layer to stay world-aligned while globe rotates
    if (this.#mesh && this.#rotGrp) {
      this.#mesh.quaternion.copy(this.#rotGrp.quaternion).invert();
    }
  }

  setGlobeRotGroup(grp) { this.#rotGrp = grp; }

  dispose() {
    clearInterval(this.#timer);
    this.#mesh?.geometry.dispose();
    this.#mat?.dispose();
  }
}

export default NightLayer;
