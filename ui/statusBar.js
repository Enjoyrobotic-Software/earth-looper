/**
 * EarthOS StatusBar — live source status and entity counts.
 * Shows: connected sources, item counts per layer, last update time.
 */

import bus, { Events } from '../core/eventBus.js';
import engine           from '../core/engine.js';

const STYLE = `
#eos-status {
  position:fixed; bottom:10px; left:50%; transform:translateX(-50%);
  z-index:20; display:flex; gap:6px; flex-wrap:wrap; justify-content:center;
  pointer-events:none; max-width:calc(100vw - 32px);
}
.eos-sp {
  font-family:'JetBrains Mono',monospace; font-size:9px; letter-spacing:.06em;
  padding:3px 9px; border-radius:20px; border:1px solid rgba(255,255,255,.07);
  background:rgba(10,14,20,.8); color:rgba(255,255,255,.35);
  backdrop-filter:blur(8px); white-space:nowrap; transition:color .3s, border-color .3s;
}
.eos-sp.ok  { border-color:rgba(76,175,125,.35); color:#4caf7d; }
.eos-sp.err { border-color:rgba(224,85,85,.35);  color:#e05555; }
.eos-sp.dim { opacity:.5; }
`;

const SOURCE_PILL = {
  earthquakes: { label:'EQ',       source:'usgs',      id:'s-eq'      },
  fires:       { label:'FIRES',    source:'firms',     id:'s-fires'   },
  volcanoes:   { label:'VOL',      source:'gvp',       id:'s-vol'     },
  flights:     { label:'FLIGHTS',  source:'opensky',   id:'s-flights' },
  ships:       { label:'SHIPS',    source:'aisstream', id:'s-ships'   },
  satellites:  { label:'SATS',     source:'tle',       id:'s-sats'    },
  pollution:   { label:'AQI',      source:'openaq',    id:'s-aqi'     },
};

export class StatusBar {
  #pills  = {};
  #unsub  = [];

  constructor() {
    this.#injectStyle();
  }

  init() {
    // Create or reuse existing #eos-status container
    let container = document.getElementById('eos-status');
    if (!container) {
      container = document.createElement('div');
      container.id = 'eos-status';
      document.body.appendChild(container);
    }

    // Create one pill per layer
    for (const [layerId, cfg] of Object.entries(SOURCE_PILL)) {
      const pill = document.createElement('div');
      pill.className = 'eos-sp dim';
      pill.id = cfg.id;
      pill.textContent = cfg.label + ' —';
      container.appendChild(pill);
      this.#pills[layerId] = pill;
    }

    // Clock pill
    const clkPill = document.createElement('div');
    clkPill.className = 'eos-sp';
    clkPill.id = 'sp-clock';
    container.appendChild(clkPill);
    setInterval(() => {
      clkPill.textContent = new Date().toUTCString().slice(17, 25) + ' UTC';
    }, 1000);

    // Wire events
    this.#unsub.push(bus.on(Events.LAYER_DATA_READY, ({ id, count }) => {
      const pill = this.#pills[id];
      if (!pill) return;
      const cfg = SOURCE_PILL[id];
      pill.textContent = `${cfg?.label ?? id} ${count.toLocaleString()}`;
      pill.className   = 'eos-sp ok';
    }));

    this.#unsub.push(bus.on(Events.SOURCE_ERROR, ({ id }) => {
      for (const [layerId, cfg] of Object.entries(SOURCE_PILL)) {
        if (cfg.source === id) {
          const pill = this.#pills[layerId];
          if (pill) pill.className = 'eos-sp err';
        }
      }
    }));

    this.#unsub.push(bus.on(Events.SOURCE_CONNECTED, ({ id }) => {
      for (const [layerId, cfg] of Object.entries(SOURCE_PILL)) {
        if (cfg.source === id) {
          const pill = this.#pills[layerId];
          if (pill) pill.classList.remove('dim');
        }
      }
    }));
  }

  destroy() {
    for (const u of this.#unsub) u?.();
  }

  #injectStyle() {
    if (document.getElementById('eos-status-style')) return;
    const s = document.createElement('style');
    s.id = 'eos-status-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }
}

export default StatusBar;
