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
  gl_PointSize = clamp(1.5 + aSpeed * 0.08, 1.0, 4.0);
}`;

const FRAG = `
varying float vSpeed;
void main() {
  float s = clamp(vSpeed / 60.0, 0.0, 1.0);
  vec3  c = mix(vec3(0.2, 0.4, 0.8), vec3(0.9, 0.97, 1.0), s);
  gl_FragColor = vec4(c, 0.55);
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
    scene.add(this.#mesh);

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
