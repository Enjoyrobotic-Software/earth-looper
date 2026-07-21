/**
 * EarthOS ConflictLayer — glowing conflict markers with expanding ring pulses.
 * Uses custom ShaderMaterial on THREE.Points for GPU-efficient glow effect.
 * Colors encode ACLED event type. No vertex-color merge bug.
 */

import bus, { Events } from '../../core/eventBus.js';
import { latLonToXYZ } from '../globe.js';

const MAX = 500;
const R   = 1.004;

// Event type → RGB color
const TYPE_COLORS = {
  'Battles':         [0.88, 0.21, 0.21],
  'Explosions':      [1.00, 0.53, 0.00],
  'Violence vs Civ': [0.83, 0.52, 0.29],
  'Protests':        [0.29, 0.56, 0.83],
  'Riots':           [0.61, 0.43, 0.83],
  'Strategic Devs':  [0.30, 0.69, 0.49],
};
const DEFAULT_COLOR = [0.85, 0.20, 0.20];

// Core glow disc
const VERT_CORE = `
attribute vec3  aColor;
attribute float aPhase;
uniform   float uTime;
varying   vec3  vColor;
varying   float vAlpha;
void main() {
  vColor = aColor;
  float pulse = 0.8 + 0.2 * sin(uTime * 2.2 + aPhase * 6.2832);
  gl_PointSize = 9.0 * pulse;
  vAlpha = pulse;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG_CORE = `
varying vec3  vColor;
varying float vAlpha;
void main() {
  vec2  uv   = gl_PointCoord - 0.5;
  float dist = length(uv) * 2.0;
  if (dist > 1.0) discard;
  float glow  = pow(1.0 - dist, 1.8);
  float sharp = step(dist, 0.25) * 0.6;
  gl_FragColor = vec4(vColor, (glow + sharp) * vAlpha * 0.92);
}`;

// Expanding ring pulse
const VERT_RING = `
attribute float aPhase;
attribute vec3  aColor;
uniform   float uTime;
varying   vec3  vColor;
varying   float vAlpha;
void main() {
  vColor = aColor;
  float t     = fract(uTime * 0.42 + aPhase);
  gl_PointSize = 6.0 + t * 32.0;
  vAlpha = pow(1.0 - t, 1.5) * 0.75;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG_RING = `
varying vec3  vColor;
varying float vAlpha;
void main() {
  if (vAlpha < 0.01) discard;
  vec2  uv   = gl_PointCoord - 0.5;
  float dist = length(uv) * 2.0;
  float ring = abs(dist - 0.82);
  float a = max(0.0, 1.0 - ring * 10.0) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * 1.3, a);
}`;

export class ConflictLayer {
  #core  = null;
  #rings = null;
  #uni   = { uTime: { value: 0 } };
  #count = 0;

  init(scene) {
    const THREE  = window.THREE;
    const parent = scene.userData.rotGroup ?? scene;

    // Shared position + attribute buffers
    const positions = new Float32Array(MAX * 3);
    const colors    = new Float32Array(MAX * 3);
    const phases    = new Float32Array(MAX);

    // ── Core glow dots ─────────────────────────────────────────────────
    const geoCore = new THREE.BufferGeometry();
    geoCore.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
    geoCore.setAttribute('aColor',   new THREE.BufferAttribute(colors.slice(), 3));
    geoCore.setAttribute('aPhase',   new THREE.BufferAttribute(phases.slice(), 1));

    const matCore = new THREE.ShaderMaterial({
      uniforms:       this.#uni,
      vertexShader:   VERT_CORE,
      fragmentShader: FRAG_CORE,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this.#core = new THREE.Points(geoCore, matCore);
    this.#core.visible     = false;
    this.#core.renderOrder = 4;
    this.#core.frustumCulled = false;
    parent.add(this.#core);

    // ── Ring pulses ────────────────────────────────────────────────────
    const geoRing = new THREE.BufferGeometry();
    geoRing.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
    geoRing.setAttribute('aColor',   new THREE.BufferAttribute(colors.slice(), 3));
    geoRing.setAttribute('aPhase',   new THREE.BufferAttribute(phases.slice(), 1));

    const matRing = new THREE.ShaderMaterial({
      uniforms:       this.#uni,
      vertexShader:   VERT_RING,
      fragmentShader: FRAG_RING,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this.#rings = new THREE.Points(geoRing, matRing);
    this.#rings.visible      = false;
    this.#rings.renderOrder  = 3;
    this.#rings.frustumCulled = false;
    parent.add(this.#rings);

    bus.on(Events.LAYER_DATA_READY, d => {
      if (d.id === 'conflicts') this.#update(d.events);
    });
    bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      if (id !== 'conflicts') return;
      if (this.#core)  this.#core.visible  = enabled && this.#count > 0;
      if (this.#rings) this.#rings.visible = enabled && this.#count > 0;
    });
  }

  #update(events) {
    if (!this.#core) return;
    const THREE = window.THREE;
    const list  = events.slice(0, MAX);
    this.#count = list.length;

    for (const pts of [this.#core, this.#rings]) {
      const pos = pts.geometry.attributes.position.array;
      const col = pts.geometry.attributes.aColor.array;
      const phi = pts.geometry.attributes.aPhase.array;

      for (let i = 0; i < list.length; i++) {
        const ev = list[i];
        const p  = latLonToXYZ(ev.lat, ev.lon, R);
        pos[i*3] = p.x; pos[i*3+1] = p.y; pos[i*3+2] = p.z;

        const c = TYPE_COLORS[ev.detail?.type] ?? DEFAULT_COLOR;
        col[i*3] = c[0]; col[i*3+1] = c[1]; col[i*3+2] = c[2];

        phi[i] = (i * 0.618033988) % 1;  // golden-ratio phase spread
      }

      pts.geometry.attributes.position.needsUpdate = true;
      pts.geometry.attributes.aColor.needsUpdate   = true;
      pts.geometry.attributes.aPhase.needsUpdate   = true;
      pts.geometry.setDrawRange(0, list.length);
    }
  }

  update(dt) {
    this.#uni.uTime.value += dt;
  }

  dispose() {
    this.#core?.geometry.dispose();  this.#core?.material.dispose();
    this.#rings?.geometry.dispose(); this.#rings?.material.dispose();
  }
}

export default ConflictLayer;
