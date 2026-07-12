/**
 * EarthOS SpatialIndex — QuadTree for geo-indexed entity lookups.
 * Replaces flat arrays. Only processes what's in the viewport.
 */

class Bounds {
  constructor(minLon, minLat, maxLon, maxLat) {
    this.minLon = minLon; this.minLat = minLat;
    this.maxLon = maxLon; this.maxLat = maxLat;
  }
  contains(lon, lat) {
    return lon >= this.minLon && lon <= this.maxLon &&
           lat >= this.minLat && lat <= this.maxLat;
  }
  intersects(b) {
    return !(b.minLon > this.maxLon || b.maxLon < this.minLon ||
             b.minLat > this.maxLat || b.maxLat < this.minLat);
  }
  get cx() { return (this.minLon + this.maxLon) / 2; }
  get cy() { return (this.minLat + this.maxLat) / 2; }
}

class QuadNode {
  static MAX_ITEMS = 64;
  static MAX_DEPTH = 12;

  constructor(bounds, depth = 0) {
    this.bounds   = bounds;
    this.depth    = depth;
    this.items    = [];
    this.children = null;
  }

  insert(item) {
    if (!this.bounds.contains(item.lon, item.lat)) return false;
    if (this.children) return this.#insertIntoChildren(item);
    this.items.push(item);
    if (this.items.length > QuadNode.MAX_ITEMS && this.depth < QuadNode.MAX_DEPTH) {
      this.#subdivide();
    }
    return true;
  }

  query(bounds, result = []) {
    if (!this.bounds.intersects(bounds)) return result;
    for (const item of this.items) {
      if (bounds.contains(item.lon, item.lat)) result.push(item);
    }
    if (this.children) {
      for (const child of this.children) child.query(bounds, result);
    }
    return result;
  }

  queryRadius(lon, lat, radiusDeg, result = []) {
    const approxBounds = new Bounds(
      lon - radiusDeg, lat - radiusDeg,
      lon + radiusDeg, lat + radiusDeg
    );
    const candidates = this.query(approxBounds);
    const r2 = radiusDeg * radiusDeg;
    for (const item of candidates) {
      const dx = item.lon - lon, dy = item.lat - lat;
      if (dx*dx + dy*dy <= r2) result.push(item);
    }
    return result;
  }

  remove(id) {
    const idx = this.items.findIndex(i => i.id === id);
    if (idx !== -1) { this.items.splice(idx, 1); return true; }
    if (this.children) {
      for (const child of this.children) {
        if (child.remove(id)) return true;
      }
    }
    return false;
  }

  clear() { this.items = []; this.children = null; }

  count() {
    let n = this.items.length;
    if (this.children) for (const c of this.children) n += c.count();
    return n;
  }

  #subdivide() {
    const { minLon, minLat, maxLon, maxLat, cx, cy } = this.bounds;
    const d = this.depth + 1;
    this.children = [
      new QuadNode(new Bounds(minLon, minLat, cx, cy), d),
      new QuadNode(new Bounds(cx,     minLat, maxLon, cy), d),
      new QuadNode(new Bounds(minLon, cy,     cx, maxLat), d),
      new QuadNode(new Bounds(cx,     cy,     maxLon, maxLat), d),
    ];
    const old = this.items;
    this.items = [];
    for (const item of old) this.#insertIntoChildren(item);
  }

  #insertIntoChildren(item) {
    for (const child of this.children) {
      if (child.insert(item)) return true;
    }
    this.items.push(item); // straddles boundary
    return true;
  }
}

export class SpatialIndex {
  #root;
  #entities = new Map();

  constructor() {
    this.#root = new QuadNode(new Bounds(-180, -90, 180, 90));
  }

  insert(entity) {
    this.#entities.set(entity.id, entity);
    this.#root.insert(entity);
  }

  update(entity) {
    this.remove(entity.id);
    this.insert(entity);
  }

  remove(id) {
    this.#entities.delete(id);
    this.#root.remove(id);
  }

  get(id) { return this.#entities.get(id); }

  query(minLon, minLat, maxLon, maxLat) {
    return this.#root.query(new Bounds(minLon, minLat, maxLon, maxLat));
  }

  queryRadius(lon, lat, radiusDeg) {
    return this.#root.queryRadius(lon, lat, radiusDeg);
  }

  nearest(lon, lat, k = 1) {
    // Search with expanding radius until we have k results
    let r = 5, results = [];
    while (results.length < k && r <= 360) {
      results = this.queryRadius(lon, lat, r);
      r *= 2;
    }
    return results
      .map(e => ({ ...e, _dist: Math.hypot(e.lon - lon, e.lat - lat) }))
      .sort((a, b) => a._dist - b._dist)
      .slice(0, k);
  }

  clear() {
    this.#root.clear();
    this.#entities.clear();
  }

  get size() { return this.#entities.size; }
}

// Per-layer indexes
export class LayerSpatialIndex {
  #indexes = new Map();

  layer(name) {
    if (!this.#indexes.has(name)) this.#indexes.set(name, new SpatialIndex());
    return this.#indexes.get(name);
  }

  clear(name = null) {
    if (name) this.#indexes.get(name)?.clear();
    else for (const idx of this.#indexes.values()) idx.clear();
  }

  stats() {
    const out = {};
    for (const [k, v] of this.#indexes) out[k] = v.size;
    return out;
  }
}

export const spatialIndex = new LayerSpatialIndex();
export default spatialIndex;
