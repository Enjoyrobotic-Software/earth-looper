/**
 * EarthOS BorderLayer — country outline vectors on the globe.
 * Source: world-atlas TopoJSON (110m resolution, ~120 KB).
 * Renders all borders as a single THREE.LineSegments draw call.
 *
 * Uses an inline TopoJSON decoder — no external library needed.
 */

import bus, { Events }          from '../../core/eventBus.js';
import cache                    from '../../core/cache.js';
import { latLonToXYZ }          from '../globe.js';

const TOPO_URL = './node_modules/world-atlas/countries-110m.json';
const RADIUS   = 1.0015;  // slightly above surface

export class BorderLayer {
  #mesh   = null;
  #loaded = false;

  async init(scene) {
    try {
      const rings  = await this.#load();
      const parent = scene.userData.rotGroup ?? scene;
      this.#build(parent, rings);
    } catch (e) {
      console.warn('[BorderLayer] Failed to load borders:', e.message);
    }
  }

  async #load() {
    const cached = cache.get('borders:topo');
    if (cached) return cached;

    const topo  = await fetch(TOPO_URL).then(r => r.json());
    const rings  = this.#decode(topo);
    cache.set('borders:topo', rings, 86_400_000);
    return rings;
  }

  /** Inline TopoJSON decoder — handles quantized arc decompression */
  #decode(topo) {
    const { scale, translate } = topo.transform;

    const arcs = topo.arcs.map(arc => {
      let x = 0, y = 0;
      return arc.map(([dx, dy]) => {
        x += dx; y += dy;
        return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
      });
    });

    const stitch = i => { const a = arcs[i < 0 ? ~i : i]; return i < 0 ? [...a].reverse() : a; };
    const ring   = r => r.flatMap(i => stitch(i).slice(0, -1));

    const features = [];
    for (const g of topo.objects.countries.geometries) {
      if (g.type === 'Polygon')
        features.push(...g.arcs.map(ring));
      if (g.type === 'MultiPolygon')
        features.push(...g.arcs.flatMap(p => p.map(ring)));
    }
    return features;  // array of [[lon, lat], ...] rings
  }

  #build(parent, rings) {
    const THREE = window.THREE;

    // Count total segments first
    let segCount = 0;
    for (const ring of rings) segCount += ring.length;

    const buf = new Float32Array(segCount * 6);  // 2 verts × 3 floats per segment
    let ptr = 0;

    for (const ring of rings) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const [lon0, lat0] = ring[i];
        const [lon1, lat1] = ring[(i + 1) % n];
        const a = latLonToXYZ(lat0, lon0, RADIUS);
        const b = latLonToXYZ(lat1, lon1, RADIUS);
        buf[ptr++] = a.x; buf[ptr++] = a.y; buf[ptr++] = a.z;
        buf[ptr++] = b.x; buf[ptr++] = b.y; buf[ptr++] = b.z;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(buf.slice(0, ptr), 3));

    const mat = new THREE.LineBasicMaterial({
      color:       new THREE.Color(0x8899aa),
      transparent: true,
      opacity:     0.55,
      depthWrite:  false,
    });

    this.#mesh = new THREE.LineSegments(geo, mat);
    this.#mesh.renderOrder = 1;
    parent.add(this.#mesh);
    this.#loaded = true;

    bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      if (id === 'borders' && this.#mesh) this.#mesh.visible = enabled;
    });
  }

  update() {}
  dispose() { this.#mesh?.geometry.dispose(); this.#mesh?.material.dispose(); }
}

export default BorderLayer;
