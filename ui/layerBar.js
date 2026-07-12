/**
 * EarthOS LayerBar UI — top pill buttons for toggling layers.
 * Self-renders into #layer-bar container.
 */

import bus, { Events } from '../core/eventBus.js';
import layerManager     from '../core/layerManager.js';

const STYLE = `
#eos-layer-bar {
  display:flex; gap:4px; flex-wrap:nowrap;
  overflow-x:auto; -webkit-overflow-scrolling:touch;
  scrollbar-width:none;
}
#eos-layer-bar::-webkit-scrollbar { display:none; }
.eos-lb {
  padding:5px 11px; border-radius:20px;
  border:1px solid rgba(255,255,255,0.07); background:rgba(255,255,255,0.03);
  color:rgba(255,255,255,0.28); font-family:'JetBrains Mono',monospace;
  font-size:9px; letter-spacing:.08em; cursor:pointer;
  transition:all .18s; white-space:nowrap; flex-shrink:0; user-select:none;
}
.eos-lb:hover { border-color:rgba(255,255,255,0.18); color:rgba(255,255,255,0.7); }
.eos-lb.on {
  border-color:var(--layer-color, #e8c97a);
  color:var(--layer-color, #e8c97a);
  background:rgba(255,255,255,0.06);
}
`;

export class LayerBarUI {
  #container;
  #buttons = new Map();

  constructor(containerId = 'eos-layer-bar') {
    this.#injectStyle();
    this.#container = document.getElementById(containerId);
    if (!this.#container) {
      this.#container = document.createElement('div');
      this.#container.id = containerId;
      document.getElementById('top')?.appendChild(this.#container);
    }
  }

  init() {
    this.#render();

    bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      const btn = this.#buttons.get(id);
      if (btn) btn.classList.toggle('on', enabled);
    });

    bus.on(Events.LAYER_DATA_READY, ({ id, count }) => {
      const btn = this.#buttons.get(id);
      if (btn) btn.title = `${count} items`;
    });
  }

  #render() {
    for (const layer of layerManager.all()) {
      const btn = document.createElement('button');
      btn.className  = 'eos-lb' + (layer.enabled ? ' on' : '');
      btn.textContent = `${layer.icon} ${layer.name.toUpperCase()}`;
      btn.style.setProperty('--layer-color', layer.color);
      btn.addEventListener('click', () => layerManager.toggle(layer.id));
      this.#container.appendChild(btn);
      this.#buttons.set(layer.id, btn);
    }
  }

  #injectStyle() {
    if (document.getElementById('eos-layer-bar-style')) return;
    const s = document.createElement('style');
    s.id = 'eos-layer-bar-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }
}

export default LayerBarUI;
