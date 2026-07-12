/**
 * EarthOS LayerManager — registry and lifecycle for all visualization layers.
 */

import bus, { Events } from './eventBus.js';

export class Layer {
  constructor(config) {
    this.id       = config.id;
    this.name     = config.name;
    this.icon     = config.icon     ?? '●';
    this.color    = config.color    ?? '#ffffff';
    this.enabled  = config.enabled  ?? false;
    this.opacity  = config.opacity  ?? 1.0;
    this.minZoom  = config.minZoom  ?? 0;
    this.maxZoom  = config.maxZoom  ?? Infinity;
    this.sources  = config.sources  ?? [];   // data source IDs
    this.renderer = config.renderer ?? null; // renderer function/class
    this.legend   = config.legend   ?? null;
    this._data    = [];
    this._ready   = false;
  }

  toggle()   { this.setEnabled(!this.enabled); }

  setEnabled(state) {
    this.enabled = state;
    bus.emit(Events.LAYER_TOGGLE, { id: this.id, enabled: state });
  }

  setOpacity(v) {
    this.opacity = Math.max(0, Math.min(1, v));
    bus.emit(Events.LAYER_OPACITY, { id: this.id, opacity: this.opacity });
  }

  setData(data) {
    this._data  = data;
    this._ready = true;
    bus.emit(Events.LAYER_DATA_READY, { id: this.id, count: data.length });
  }

  clear() {
    this._data  = [];
    this._ready = false;
    bus.emit(Events.LAYER_CLEARED, { id: this.id });
  }

  get data()  { return this._data; }
  get ready() { return this._ready; }
}

class LayerManager {
  #layers = new Map();

  register(config) {
    const layer = config instanceof Layer ? config : new Layer(config);
    this.#layers.set(layer.id, layer);
    return layer;
  }

  get(id)     { return this.#layers.get(id); }
  has(id)     { return this.#layers.has(id); }
  remove(id)  { this.#layers.delete(id); }

  toggle(id)  { this.get(id)?.toggle(); }

  enable(id)  { this.get(id)?.setEnabled(true); }
  disable(id) { this.get(id)?.setEnabled(false); }

  setOpacity(id, v) { this.get(id)?.setOpacity(v); }

  all()     { return [...this.#layers.values()]; }
  enabled() { return this.all().filter(l => l.enabled); }

  bySource(sourceId) {
    return this.all().filter(l => l.sources.includes(sourceId));
  }

  serialize() {
    return this.all().map(l => ({
      id: l.id, enabled: l.enabled, opacity: l.opacity
    }));
  }

  restore(state = []) {
    for (const { id, enabled, opacity } of state) {
      const l = this.get(id);
      if (!l) continue;
      l.enabled = enabled;
      l.opacity = opacity;
    }
  }
}

export const layerManager = new LayerManager();
export default layerManager;
