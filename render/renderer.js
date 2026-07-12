/**
 * EarthOS Renderer — Three.js scene orchestrator.
 * Owns the canvas, camera, controls, and render loop.
 * All layer renderers plug in as scene children.
 */

import bus, { Events } from '../core/eventBus.js';

export class Renderer {
  #canvas;
  #scene;
  #camera;
  #renderer;
  #clock;
  #animId = null;
  #plugins = new Map();
  #width = 0;
  #height = 0;

  constructor(canvas, options = {}) {
    this.#canvas = canvas;
    this.options = {
      antialias:   options.antialias   ?? true,
      pixelRatio:  options.pixelRatio  ?? Math.min(devicePixelRatio, 2),
      background:  options.background  ?? 0x0b0f14,
      fov:         options.fov         ?? 45,
      near:        options.near        ?? 0.1,
      far:         options.far         ?? 50,
    };
  }

  async init() {
    const THREE = window.THREE;
    if (!THREE) throw new Error('[Renderer] Three.js not loaded');

    // Scene
    this.#scene = new THREE.Scene();
    this.#scene.background = new THREE.Color(this.options.background);

    // Camera
    this.#width  = this.#canvas.clientWidth  || window.innerWidth;
    this.#height = this.#canvas.clientHeight || window.innerHeight;
    this.#camera = new THREE.PerspectiveCamera(
      this.options.fov,
      this.#width / this.#height,
      this.options.near,
      this.options.far
    );
    this.#camera.position.set(0, 0, 3);

    // Renderer
    this.#renderer = new THREE.WebGLRenderer({
      canvas:    this.#canvas,
      antialias: this.options.antialias,
      alpha:     false,
      powerPreference: 'high-performance',
    });
    this.#renderer.setPixelRatio(this.options.pixelRatio);
    this.#renderer.setSize(this.#width, this.#height);
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Clock
    this.#clock = new THREE.Clock();

    // Stars
    this.#addStars(THREE);

    // Resize
    const ro = new ResizeObserver(() => this.#onResize());
    ro.observe(this.#canvas.parentElement ?? document.body);

    this.scene    = this.#scene;
    this.camera   = this.#camera;
    this.renderer = this.#renderer;

    return this;
  }

  addPlugin(id, plugin) {
    this.#plugins.set(id, plugin);
    plugin.init?.(this.#scene, this.#camera, this.#renderer);
  }

  removePlugin(id) {
    const p = this.#plugins.get(id);
    p?.dispose?.();
    this.#plugins.delete(id);
  }

  start() {
    if (this.#animId) return;
    this.#loop();
  }

  stop() {
    if (this.#animId) { cancelAnimationFrame(this.#animId); this.#animId = null; }
  }

  dispose() {
    this.stop();
    for (const [, p] of this.#plugins) p.dispose?.();
    this.#renderer.dispose();
  }

  #loop() {
    this.#animId = requestAnimationFrame(() => this.#loop());
    const dt = this.#clock.getDelta();

    bus.emit(Events.FRAME_START, { dt });

    for (const [, plugin] of this.#plugins) plugin.update?.(dt, this.#clock.elapsedTime);

    this.#renderer.render(this.#scene, this.#camera);

    bus.emit(Events.FRAME_END, { dt });
  }

  #onResize() {
    const w = this.#canvas.parentElement?.clientWidth  ?? window.innerWidth;
    const h = this.#canvas.parentElement?.clientHeight ?? window.innerHeight;
    if (w === this.#width && h === this.#height) return;
    this.#width  = w;
    this.#height = h;
    this.#camera.aspect = w / h;
    this.#camera.updateProjectionMatrix();
    this.#renderer.setSize(w, h);
    bus.emit(Events.VIEWPORT_CHANGE, { width: w, height: h });
  }

  #addStars(THREE) {
    const count = 8000;
    const pos   = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
      pos[i] = (Math.random() - 0.5) * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat  = new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, sizeAttenuation: true });
    this.#scene.add(new THREE.Points(geo, mat));
  }

  get THREE() { return window.THREE; }
}

export default Renderer;
