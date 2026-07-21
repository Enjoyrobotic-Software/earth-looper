/**
 * EarthOS WindLayer — renders wind particles as a THREE.Points cloud.
 * Particles are advected by ParticleSystem each frame.
 * Color encodes wind speed (calm→blue, moderate→cyan, strong→white).
 */

import * as THREE         from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';
import bus, { Events }    from '../../core/eventBus.js';
import { particleSystem } from '../../simulation/particleSystem.js';

const VERT = `
attribute float aSpeed;
varying   float vSpeed;
void main() {
  vSpeed = aSpeed;
  gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(2.0 + aSpeed * 0.12, 1.5, 6.0);
}`;

const FRAG = `
varying float vSpeed;
void main() {
  vec2  uv   = gl_PointCoord - 0.5;
  float dist = length(uv) * 2.0;
  if (dist > 1.0) discard;
  float s = clamp(vSpeed / 55.0, 0.0, 1.0);
  // calm = deep blue, moderate = cyan, strong = white
  vec3 c0 = vec3(0.10, 0.30, 0.90);
  vec3 c1 = vec3(0.20, 0.85, 1.00);
  vec3 c2 = vec3(0.95, 0.98, 1.00);
  vec3 c  = s < 0.5 ? mix(c0, c1, s*2.0) : mix(c1, c2, (s-0.5)*2.0);
  float alpha = (1.0 - dist) * 0.72;
  gl_FragColor = vec4(c, alpha);
}`;

export class WindLayer {
  #mesh   = null;
  #speeds = null;
  #geo    = null;
  #active = false;

  init(scene) {
    const count = particleSystem.count;
    this.#geo   = new THREE.BufferGeometry();

    const pos = new THREE.BufferAttribute(particleSystem.positions, 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    this.#geo.setAttribute('position', pos);

    this.#speeds = new Float32Array(count);
    this.#geo.setAttribute('aSpeed', new THREE.BufferAttribute(this.#speeds, 1));

    const mat  = new THREE.ShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite:  false,
    });

    this.#mesh = new THREE.Points(this.#geo, mat);
    this.#mesh.renderOrder = 2;
    (scene.userData.rotGroup ?? scene).add(this.#mesh);

    particleSystem.start();
    this.#active = true;

    bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      if (id === 'weather') { this.#mesh.visible = enabled; this.#active = enabled; }
    });
  }

  update(dt) {
    if (!this.#active || !this.#mesh) return;

    particleSystem.tick();

    // Refresh position buffer (shared Float32Array, just flag)
    this.#geo.attributes.position.needsUpdate = true;
    this.#geo.attributes.aSpeed.needsUpdate   = true;
  }

  dispose() {
    particleSystem.stop();
    this.#geo?.dispose();
    this.#mesh?.material.dispose();
  }
}

export default WindLayer;
