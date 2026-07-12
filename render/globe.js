/**
 * EarthOS GlobePlugin — Earth sphere with texture + controls.
 * Plugs into Renderer as a scene plugin.
 */

import bus, { Events } from '../core/eventBus.js';

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
      map:         this.#loadTex('assets/earth_day.jpg'),
      bumpMap:     this.#loadTex('assets/earth_bump.jpg'),
      bumpScale:   0.008,
      specularMap: this.#loadTex('assets/earth_spec.jpg'),
      specular:    new THREE.Color(0x333333),
      shininess:   18,
    });
    this.#globe = new THREE.Mesh(geo, mat);
    this.#rotGroup.add(this.#globe);

    // Lighting
    const ambient = new THREE.AmbientLight(0x303050, 0.6);
    const sun     = new THREE.DirectionalLight(0xfff8e7, 1.4);
    sun.position.set(5, 3, 5);
    this.#scene.add(ambient, sun);
  }

  #buildAtmosphere(THREE) {
    const geo = new THREE.SphereGeometry(RADIUS * 1.015, 64, 64);
    const mat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float rim = pow(1.0 - abs(dot(vNormal, vec3(0,0,1))), 3.0);
          gl_FragColor = vec4(0.3, 0.6, 1.0, rim * 0.4);
        }`,
      transparent: true,
      side: window.THREE?.BackSide ?? 1,
      blending: window.THREE?.AdditiveBlending ?? 2,
      depthWrite: false,
    });
    this.#atmosphere = new THREE.Mesh(geo, mat);
    this.#rotGroup.add(this.#atmosphere);
  }

  #buildClouds(THREE) {
    const tex = this.#loadTex('assets/earth_clouds.png');
    if (!tex) return;
    const geo = new THREE.SphereGeometry(RADIUS * 1.006, 64, 64);
    const mat = new THREE.MeshPhongMaterial({
      map: tex, transparent: true, opacity: 0.38, depthWrite: false,
    });
    this.#clouds = new THREE.Mesh(geo, mat);
    this.#rotGroup.add(this.#clouds);
  }

  #loadTex(path) {
    try { return new window.THREE.TextureLoader().load(path); }
    catch { return null; }
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
    this.#camera.position.z = Math.max(1.15, Math.min(8, z));
  }

  #onClick(x, y, shiftKey = false) {
    const pos = this.projectToGlobe(x, y);
    if (pos) bus.emit(Events.COUNTRY_SELECTED, { ...pos, shiftKey });
  }
}

export { RADIUS, latLonToXYZ };
export default GlobePlugin;
