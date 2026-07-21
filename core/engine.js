/**
 * EarthOS Engine — master orchestrator.
 * Boots the system, wires all subsystems, exposes the public API.
 */

import bus, { Events }    from './eventBus.js';
import scheduler           from './scheduler.js';
import { layerManager }    from './layerManager.js';
import { spatialIndex }    from './spatialIndex.js';
import cache               from './cache.js';

// ── Layer definitions ────────────────────────────────────────────────────────
const LAYER_DEFS = [
  { id:'earthquakes', name:'Earthquakes',  icon:'🔴', color:'#e05555', sources:['usgs'],      enabled:true  },
  { id:'volcanoes',   name:'Volcanoes',    icon:'🌋', color:'#d4854a', sources:['gvp'],       enabled:true  },
  { id:'fires',       name:'Fires',        icon:'🔥', color:'#ff6b35', sources:['firms'],     enabled:false },
  { id:'storms',      name:'Storms',       icon:'🌀', color:'#4a90d4', sources:['noaa'],      enabled:false },
  { id:'flights',     name:'Flights',      icon:'✈️', color:'#4caf7d', sources:['opensky'],   enabled:false },
  { id:'ships',       name:'Ships',        icon:'🚢', color:'#2196f3', sources:['aisstream'], enabled:false },
  { id:'satellites',  name:'Satellites',   icon:'🛰️', color:'#9c6dd4', sources:['tle'],       enabled:false },
  { id:'weather',     name:'Weather',      icon:'🌦️', color:'#81d4fa', sources:['noaa'],      enabled:false },
  { id:'pollution',   name:'Pollution',    icon:'💨', color:'#78909c', sources:['openaq'],    enabled:true  },
  { id:'gdp',         name:'Economy',      icon:'💰', color:'#e8c97a', sources:['worldbank'], enabled:false },
  { id:'ocean',       name:'Ocean SST',    icon:'🌊', color:'#0077b6', sources:['copernicus'],enabled:true  },
  { id:'conflicts',   name:'Conflicts',    icon:'⚔️', color:'#880e4f', sources:['acled'],     enabled:true  },
  { id:'borders',    name:'Borders',      icon:'🗺️', color:'#445566', sources:[],            enabled:true  },
  { id:'night',      name:'Night Side',   icon:'🌑', color:'#000510', sources:[],            enabled:true  },
];

class EarthEngine {
  #renderer  = null;
  #sources   = new Map();
  #ui        = null;
  #ready     = false;
  #startTime = null;

  constructor() {
    this.bus      = bus;
    this.scheduler = scheduler;
    this.layers    = layerManager;
    this.spatial   = spatialIndex;
    this.cache     = cache;
  }

  async init(options = {}) {
    console.log('[EarthOS] Initializing...');
    this.#startTime = Date.now();

    // Register all layers
    for (const def of LAYER_DEFS) layerManager.register(def);

    // Hook global events for debugging
    if (options.debug) this.#wireDebug();

    this.#ready = true;
    console.log(`[EarthOS] Core ready in ${Date.now() - this.#startTime}ms`);
    bus.emit('earthos:ready', { layers: layerManager.all().length });
    return this;
  }

  setRenderer(renderer) {
    this.#renderer = renderer;
    return this;
  }

  setUI(ui) {
    this.#ui = ui;
    return this;
  }

  registerSource(id, sourceInstance) {
    this.#sources.set(id, sourceInstance);
    return this;
  }

  getSource(id) { return this.#sources.get(id); }

  async start() {
    if (!this.#ready) throw new Error('[EarthOS] Call init() first');

    // Boot UI
    await this.#ui?.init?.();

    // Connect enabled sources
    for (const [id, src] of this.#sources) {
      try {
        await src.connect();
        bus.emit(Events.SOURCE_CONNECTED, { id });
        console.log(`[EarthOS] Source connected: ${id}`);
      } catch(e) {
        console.warn(`[EarthOS] Source ${id} failed to connect:`, e.message);
        bus.emit(Events.SOURCE_ERROR, { id, error: e.message });
      }
    }

    // Start scheduler (all tasks that were registered will fire)
    scheduler.start();

    bus.emit('earthos:started', {
      sources: this.#sources.size,
      layers:  layerManager.all().length,
    });
    console.log(`[EarthOS] System started. ${this.#sources.size} sources active.`);
  }

  async stop() {
    scheduler.stop();
    for (const src of this.#sources.values()) await src.disconnect?.();
    this.#renderer?.dispose?.();
    bus.emit('earthos:stopped');
  }

  get ready() { return this.#ready; }
  get uptime() { return this.#startTime ? Date.now() - this.#startTime : 0; }

  status() {
    return {
      ready:    this.#ready,
      uptime:   this.uptime,
      sources:  [...this.#sources.keys()],
      layers:   layerManager.serialize(),
      scheduler:scheduler.status(),
      cache:    cache.stats(),
      spatial:  spatialIndex.stats(),
    };
  }

  #wireDebug() {
    bus.on(Events.SOURCE_ERROR,      d => console.warn('[EventBus] SOURCE_ERROR', d));
    bus.on(Events.DATA_RECEIVED,     d => console.debug('[EventBus] DATA_RECEIVED', d.source, d.count));
    bus.on(Events.LAYER_TOGGLE,      d => console.debug('[EventBus] LAYER_TOGGLE', d));
    bus.on(Events.EARTHQUAKE,        d => console.debug('[EventBus] EARTHQUAKE', d.mag, d.place));
  }
}

export const engine = new EarthEngine();
export default engine;
