/**
 * EarthOS EventBus — decoupled pub/sub backbone
 * No module knows another exists. They only speak events.
 */

export const Events = Object.freeze({
  // Data lifecycle
  SOURCE_CONNECTED:    'source:connected',
  SOURCE_DISCONNECTED: 'source:disconnected',
  SOURCE_ERROR:        'source:error',
  DATA_RECEIVED:       'data:received',
  DATA_NORMALIZED:     'data:normalized',

  // Earth events (canonical)
  EARTHQUAKE:          'earth:earthquake',
  VOLCANO:             'earth:volcano',
  FIRE:                'earth:fire',
  STORM:               'earth:storm',
  FLOOD:               'earth:flood',
  TSUNAMI:             'earth:tsunami',
  DROUGHT:             'earth:drought',
  POLLUTION:           'earth:pollution',

  // Transport
  FLIGHT_UPDATE:       'transport:flight',
  SHIP_UPDATE:         'transport:ship',
  SATELLITE_UPDATE:    'space:satellite',

  // Layers
  LAYER_TOGGLE:        'layer:toggle',
  LAYER_OPACITY:       'layer:opacity',
  LAYER_DATA_READY:    'layer:ready',
  LAYER_CLEARED:       'layer:cleared',

  // Time
  TIME_CHANGED:        'time:changed',
  TIME_PLAY:           'time:play',
  TIME_PAUSE:          'time:pause',
  TIME_SEEK:           'time:seek',

  // UI
  COUNTRY_SELECTED:    'ui:country_selected',
  COUNTRY_DESELECTED:  'ui:country_deselected',
  SEARCH_QUERY:        'ui:search',
  PANEL_OPEN:          'ui:panel_open',
  PANEL_CLOSE:         'ui:panel_close',

  // Renderer
  FRAME_START:         'render:frame_start',
  FRAME_END:           'render:frame_end',
  VIEWPORT_CHANGE:     'render:viewport',

  // AI / Analysis
  AI_INSIGHT:          'ai:insight',
  AI_CAUSAL_CHAIN:     'ai:causal_chain',
  ANOMALY_DETECTED:    'ai:anomaly',

  // Simulation
  SIM_STEP:            'sim:step',
  SIM_RESET:           'sim:reset',
  WIND_FIELD_READY:    'sim:wind_ready',

  // Notifications
  NOTIFICATION:        'ui:notification',
});

class EventBus {
  #handlers = new Map();
  #once     = new Map();
  #history  = [];
  #maxHist  = 500;

  on(event, handler, context = null) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, []);
    this.#handlers.get(event).push({ handler, context });
    return () => this.off(event, handler);
  }

  once(event, handler, context = null) {
    if (!this.#once.has(event)) this.#once.set(event, []);
    this.#once.get(event).push({ handler, context });
    return () => this.offOnce(event, handler);
  }

  off(event, handler) {
    if (!this.#handlers.has(event)) return;
    this.#handlers.set(event, this.#handlers.get(event).filter(h => h.handler !== handler));
  }

  offOnce(event, handler) {
    if (!this.#once.has(event)) return;
    this.#once.set(event, this.#once.get(event).filter(h => h.handler !== handler));
  }

  emit(event, payload = {}) {
    const entry = { event, payload, ts: Date.now() };
    this.#history.push(entry);
    if (this.#history.length > this.#maxHist) this.#history.shift();

    const call = ({ handler, context }) => {
      try { handler.call(context, payload, entry); }
      catch (e) { console.error(`[EventBus] Error in handler for ${event}:`, e); }
    };

    this.#handlers.get(event)?.forEach(call);

    const oneshots = this.#once.get(event);
    if (oneshots?.length) {
      oneshots.forEach(call);
      this.#once.delete(event);
    }
  }

  history(event = null) {
    return event ? this.#history.filter(e => e.event === event) : [...this.#history];
  }

  clear(event = null) {
    if (event) { this.#handlers.delete(event); this.#once.delete(event); }
    else { this.#handlers.clear(); this.#once.clear(); }
  }
}

export const bus = new EventBus();
export default bus;
