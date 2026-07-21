/**
 * EarthOS GlobePlugin — Earth sphere with texture + controls.
 * Plugs into Renderer as a scene plugin.
 */

import bus, { Events }       from '../core/eventBus.js';
import { getTexture }         from './textureManager.js';

const RADIUS  = 1.0;
const SEG     = 96;

export function latLonToXYZ(lat, lon, r = RADIUS + 0.002) {
  const phi   = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return {
    x: -(r * Math.sin(phi) * Math.cos(theta)),
    y:   r * Math.cos(phi),
    z:   r * Math.sin(phi) * Math.sin(theta),
  };
}

export function xyzToLatLon(x, y, z) {
  const r   = Math.sqrt(x*x + y*y + z*z);
  const lat = 90 - Math.acos(y / r) * (180 / Math.PI);
  const lon = (Math.atan2(z, -x) * (180 / Math.PI)) - 180;
  return { lat, lon };
}

export class GlobePlugin {
  #scene; #camera; #renderer;
  #globe; #atmosphere; #clouds;
  #autoRotate = true;
  #rotSpeed   = 0.0005;
  #isDragging = false;
  #prevMouse  = { x: 0, y: 0 };
  #rotGroup;
  #raycaster;

  init(scene, camera, renderer) {
    this.#scene    = scene;
    this.#camera   = camera;
    this.#renderer = renderer;

    const THREE = window.THREE;
    this.#raycaster = new THREE.Raycaster();
    this.#rotGroup  = new THREE.Group();
    scene.add(this.#rotGroup);
    scene.userData.rotGroup = this.#rotGroup;

    this.#buildStars(THREE);
    this.#buildGlobe(THREE);
    this.#buildAtmosphere(THREE);
    this.#buildClouds(THREE);
    this.#bindEvents();
  }

  update(dt) {
    if (this.#autoRotate && !this.#isDragging) {
      this.#rotGroup.rotation.y += this.#rotSpeed;
    }
    if (this.#clouds) this.#clouds.rotation.y += 0.00008;
  }

  dispose() {
    this.#unbindEvents();
    this.#globe?.geometry.dispose();
    this.#globe?.material.dispose();
    this.#atmosphere?.geometry.dispose();
    this.#atmosphere?.material.dispose();
  }

  setAutoRotate(v) { this.#autoRotate = v; }

  projectToGlobe(screenX, screenY) {
    const THREE  = window.THREE;
    const canvas = this.#renderer.domElement;
    const rect   = canvas.getBoundingClientRect();
    const mouse  = new THREE.Vector2(
      ((screenX - rect.left)  / rect.width)  * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1
    );
    this.#raycaster.setFromCamera(mouse, this.#camera);
    const hits = this.#raycaster.intersectObject(this.#globe);
    if (!hits.length) return null;
    const local = this.#rotGroup.worldToLocal(hits[0].point.clone());
    return xyzToLatLon(local.x, local.y, local.z);
  }

  get rotGroup() { return this.#rotGroup; }

  // ── Build ────────────────────────────────────────────────────────────────

  #buildGlobe(THREE) {
    const geo = new THREE.SphereGeometry(RADIUS, SEG, SEG);
    const mat = new THREE.MeshPhongMaterial({
      color:     new THREE.Color(0x2244aa),
      specular:  new THREE.Color(0x333333),
      shininess: 18,
    });
    this.#globe = new THREE.Mesh(geo, mat);
    this.#rotGroup.add(this.#globe);

    // Async texture loading — CDN fallback via textureManager
    const maxAniso = this.#renderer.capabilities.getMaxAnisotropy();
    const applyAniso = t => { t.anisotropy = maxAniso; t.needsUpdate = true; return t; };
    getTexture('earth_day').then(t      => { applyAniso(t); mat.map         = t; mat.color.setHex(0xffffff); mat.needsUpdate = true; }).catch(() => {});
    getTexture('earth_normal').then(t   => { applyAniso(t); mat.normalMap   = t; mat.needsUpdate = true; }).catch(() => {});
    getTexture('earth_specular').then(t => { applyAniso(t); mat.specularMap = t; mat.needsUpdate = true; }).catch(() => {});

    // Lighting — warm sunlight + dim space ambient
    const ambient = new THREE.AmbientLight(0x182840, 0.45);
    const sun     = new THREE.DirectionalLight(0xfff4d6, 1.8);
    sun.position.set(5, 3, 5);
    // Soft back-fill from space (very dim blue)
    const fill = new THREE.DirectionalLight(0x1a3060, 0.18);
    fill.position.set(-4, -2, -3);
    this.#scene.add(ambient, sun, fill);
  }

  #buildAtmosphere(THREE) {
    // Outer halo (Back-face, large, soft)
    const geoOuter = new THREE.SphereGeometry(RADIUS * 1.12, 64, 64);
    const matOuter = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vNormal  = normalize(mat3(modelMatrix) * normal);
          vViewDir = normalize(cameraPosition - worldPos.xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float rim  = 1.0 - max(dot(vViewDir, vNormal), 0.0);
          float glow = pow(rim, 4.5) * 0.55;
          gl_FragColor = vec4(0.18, 0.52, 1.0, glow);
        }`,
      transparent: true, depthWrite: false,
      side: THREE.BackSide, blending: THREE.AdditiveBlending,
    });
    this.#scene.add(new THREE.Mesh(geoOuter, matOuter));

    // Inner fresnel (tighter rim, brighter, cyan tint)
    const geo = new THREE.SphereGeometry(RADIUS * 1.035, 64, 64);
    const mat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vNormal   = normalize(mat3(modelMatrix) * normal);
          vViewDir  = normalize(cameraPosition - worldPos.xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float rim  = 1.0 - max(dot(vViewDir, vNormal), 0.0);
          float glow = pow(rim, 2.8) * 1.1;
          vec3  col  = mix(vec3(0.20, 0.60, 1.00), vec3(0.50, 0.85, 1.00), rim * rim);
          gl_FragColor = vec4(col, glow);
        }`,
      transparent: true, depthWrite: false,
      side: THREE.BackSide, blending: THREE.AdditiveBlending,
    });
    this.#atmosphere = new THREE.Mesh(geo, mat);
    this.#scene.add(this.#atmosphere);
  }

  #buildStars(THREE) {
    const count = 6000;
    const pos   = new Float32Array(count * 3);
    const col   = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Random point on sphere, radius 80–120
      const r     = 80 + Math.random() * 40;
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
      pos[i*3+1] = r * Math.cos(phi);
      pos[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
      // Slight color variation: blue-white to warm-white
      const t = Math.random();
      col[i*3]   = 0.75 + t * 0.25;
      col[i*3+1] = 0.80 + t * 0.18;
      col[i*3+2] = 0.90 + (1-t) * 0.10;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.18, vertexColors: true,
      transparent: true, opacity: 0.9, sizeAttenuation: true,
    });
    this.#scene.add(new THREE.Points(geo, mat));
  }

  #buildClouds(THREE) {
    const geo = new THREE.SphereGeometry(RADIUS * 1.006, 64, 64);
    const mat = new THREE.MeshPhongMaterial({
      transparent: true, opacity: 0.38, depthWrite: false,
    });
    this.#clouds = new THREE.Mesh(geo, mat);
    this.#rotGroup.add(this.#clouds);
    getTexture('earth_clouds').then(t => { t.anisotropy = this.#renderer.capabilities.getMaxAnisotropy(); mat.map = t; mat.needsUpdate = true; }).catch(() => {});
  }


  // ── Mouse / touch controls ───────────────────────────────────────────────

  #handlers = {};

  #bindEvents() {
    const el = this.#renderer.domElement;
    this.#handlers.mousedown  = e => this.#onDown(e.clientX, e.clientY);
    this.#handlers.mousemove  = e => this.#onMove(e.clientX, e.clientY);
    this.#handlers.mouseup    = ()  => this.#onUp();
    this.#handlers.wheel      = e => this.#onWheel(e.deltaY);
    this.#handlers.touchstart = e => this.#onDown(e.touches[0].clientX, e.touches[0].clientY);
    this.#handlers.touchmove  = e => { e.preventDefault(); this.#onMove(e.touches[0].clientX, e.touches[0].clientY); };
    this.#handlers.touchend   = ()  => this.#onUp();
    this.#handlers.click      = e => this.#onClick(e.clientX, e.clientY, e.shiftKey);

    for (const [ev, fn] of Object.entries(this.#handlers)) {
      el.addEventListener(ev, fn, { passive: ev.startsWith('touch') && ev !== 'touchmove' });
    }
  }

  #unbindEvents() {
    const el = this.#renderer.domElement;
    for (const [ev, fn] of Object.entries(this.#handlers)) el.removeEventListener(ev, fn);
  }

  #onDown(x, y) {
    this.#isDragging = true;
    this.#autoRotate = false;
    this.#prevMouse  = { x, y };
  }

  #onMove(x, y) {
    if (!this.#isDragging) return;
    const dx = (x - this.#prevMouse.x) * 0.005;
    const dy = (y - this.#prevMouse.y) * 0.005;
    this.#rotGroup.rotation.y += dx;
    this.#rotGroup.rotation.x  = Math.max(-1.2, Math.min(1.2, this.#rotGroup.rotation.x + dy));
    this.#prevMouse = { x, y };
  }

  #onUp() { this.#isDragging = false; }

  #onWheel(delta) {
    const z = this.#camera.position.z + delta * 0.002;
    this.#camera.position.z = Math.max(1.05, Math.min(8, z));
    // Tighten near plane when zoomed in to preserve depth precision
    this.#camera.near = Math.max(0.001, (this.#camera.position.z - 1.0) * 0.1);
    this.#camera.updateProjectionMatrix();
  }

  #onClick(x, y, shiftKey = false) {
    const pos = this.projectToGlobe(x, y);
    if (pos) bus.emit(Events.COUNTRY_SELECTED, { ...pos, shiftKey });
  }
}

export { RADIUS };
export default GlobePlugin;
