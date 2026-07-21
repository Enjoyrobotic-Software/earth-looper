/**
 * EarthOS LayerMenu — single dropdown replacing LayerBar + StatusBar + StatsHUD.
 * Shows all layers with toggle switches, live event counts, and source status dots.
 */

import bus, { Events } from '../core/eventBus.js';
import layerManager     from '../core/layerManager.js';

const SOURCE_FOR_LAYER = {
  earthquakes: 'usgs',
  fires:       'firms',
  volcanoes:   'gvp',
  flights:     'opensky',
  ships:       'aisstream',
  satellites:  'tle',
  pollution:   'openaq',
  weather:     'noaa',
  ocean:       'copernicus',
  conflicts:   'acled',
  gdp:         'worldbank',
};

const STYLE = `
#eos-layers-btn {
  padding: 5px 13px; border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.05);
  color: rgba(255,255,255,0.65);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px; letter-spacing: .1em;
  cursor: pointer; transition: all .18s;
  display: flex; align-items: center; gap: 7px;
  white-space: nowrap; flex-shrink: 0;
}
#eos-layers-btn:hover {
  border-color: rgba(255,255,255,0.25);
  color: rgba(255,255,255,0.9);
  background: rgba(255,255,255,0.08);
}
#eos-layers-btn.open {
  border-color: rgba(232,201,122,0.45);
  color: #e8c97a;
  background: rgba(232,201,122,0.07);
}
.eos-lb-badge {
  background: rgba(232,201,122,0.18);
  color: #e8c97a;
  font-size: 8px; border-radius: 10px;
  padding: 1px 5px; letter-spacing: .06em;
}

#eos-layer-menu {
  position: fixed;
  top: 52px; left: 50%; transform: translateX(-50%);
  z-index: 100;
  background: rgba(8,12,18,0.98);
  border: 1px solid rgba(255,255,255,0.09);
  border-radius: 10px;
  backdrop-filter: blur(24px);
  width: 280px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.03);
  overflow: hidden;
  display: none;
}
#eos-layer-menu.open {
  display: block;
  animation: eos-lm-in .16s cubic-bezier(.2,0,.2,1);
}
@keyframes eos-lm-in {
  from { opacity:0; transform: translateX(-50%) translateY(-8px); }
  to   { opacity:1; transform: translateX(-50%) translateY(0); }
}

.eos-lm-head {
  padding: 10px 14px 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 8px; letter-spacing: .2em;
  color: rgba(255,255,255,0.2); text-transform: uppercase;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  display: flex; align-items: center; justify-content: space-between;
}
.eos-lm-head-count {
  font-size: 8px; color: rgba(255,255,255,0.2);
}

.eos-lm-row {
  display: flex; align-items: center;
  padding: 7px 14px; gap: 10px;
  cursor: pointer; transition: background .1s;
  user-select: none; border-bottom: 1px solid rgba(255,255,255,0.03);
}
.eos-lm-row:last-child { border-bottom: none; }
.eos-lm-row:hover { background: rgba(255,255,255,0.035); }

.eos-lm-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  background: rgba(255,255,255,0.08); transition: background .3s;
}
.eos-lm-dot.ok  { background: #4caf7d; box-shadow: 0 0 5px rgba(76,175,125,0.5); }
.eos-lm-dot.err { background: #e05555; }

.eos-lm-icon { font-size: 13px; width: 18px; text-align: center; flex-shrink: 0; }

.eos-lm-name {
  flex: 1;
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px; letter-spacing: .06em; text-transform: uppercase;
  color: rgba(255,255,255,0.38); transition: color .18s;
}
.eos-lm-row.on .eos-lm-name { color: rgba(255,255,255,0.82); }

.eos-lm-count {
  font-family: 'JetBrains Mono', monospace;
  font-size: 8px; min-width: 34px; text-align: right;
  color: rgba(255,255,255,0.18); transition: color .18s;
}
.eos-lm-row.on .eos-lm-count { color: var(--lm-color); }

.eos-lm-sw {
  width: 28px; height: 15px; border-radius: 8px;
  background: rgba(255,255,255,0.1); position: relative;
  flex-shrink: 0; transition: background .18s;
}
.eos-lm-sw::after {
  content: ''; position: absolute;
  width: 11px; height: 11px; border-radius: 50%;
  background: rgba(255,255,255,0.35);
  top: 2px; left: 2px; transition: transform .18s, background .18s;
}
.eos-lm-row.on .eos-lm-sw { background: var(--lm-color); }
.eos-lm-row.on .eos-lm-sw::after {
  transform: translateX(13px);
  background: #fff;
}
`;

export class LayerMenuUI {
  #btn;
  #menu;
  #rows   = new Map();
  #srcDots = new Map(); // sourceId → [dot elements]
  #open   = false;
  #unsub  = [];

  init() {
    this.#injectStyle();

    // Button (injected into existing #eos-layers-btn placeholder or appended to #top)
    this.#btn = document.getElementById('eos-layers-btn');
    if (!this.#btn) {
      this.#btn = document.createElement('button');
      this.#btn.id = 'eos-layers-btn';
      document.getElementById('top')?.appendChild(this.#btn);
    }

    // Dropdown panel
    this.#menu = document.createElement('div');
    this.#menu.id = 'eos-layer-menu';
    document.body.appendChild(this.#menu);

    this.#buildRows();
    this.#refreshBtn();

    this.#btn.addEventListener('click', e => { e.stopPropagation(); this.#toggle(); });
    document.addEventListener('click', e => {
      if (this.#open && !this.#menu.contains(e.target)) this.#close();
    });

    this.#unsub.push(bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      this.#rows.get(id)?.classList.toggle('on', enabled);
      this.#refreshBtn();
    }));

    this.#unsub.push(bus.on(Events.LAYER_DATA_READY, ({ id, count }) => {
      const row = this.#rows.get(id);
      if (!row) return;
      const el = row.querySelector('.eos-lm-count');
      if (el) el.textContent = count > 0 ? count.toLocaleString() : '';
    }));

    this.#unsub.push(bus.on(Events.SOURCE_CONNECTED, ({ id }) => this.#setDot(id, 'ok')));
    this.#unsub.push(bus.on(Events.SOURCE_ERROR,     ({ id }) => this.#setDot(id, 'err')));
  }

  #buildRows() {
    const head = document.createElement('div');
    head.className = 'eos-lm-head';
    head.innerHTML = `<span>Data Layers</span><span class="eos-lm-head-count"></span>`;
    this.#menu.appendChild(head);

    for (const layer of layerManager.all()) {
      const row = document.createElement('div');
      row.className = 'eos-lm-row' + (layer.enabled ? ' on' : '');
      row.style.setProperty('--lm-color', layer.color);

      const dot   = document.createElement('div');  dot.className = 'eos-lm-dot';
      const icon  = document.createElement('span'); icon.className = 'eos-lm-icon'; icon.textContent = layer.icon;
      const name  = document.createElement('span'); name.className = 'eos-lm-name'; name.textContent = layer.name;
      const count = document.createElement('span'); count.className = 'eos-lm-count';
      const sw    = document.createElement('div');  sw.className = 'eos-lm-sw';

      row.append(dot, icon, name, count, sw);
      row.addEventListener('click', () => layerManager.toggle(layer.id));
      this.#menu.appendChild(row);
      this.#rows.set(layer.id, row);

      const src = SOURCE_FOR_LAYER[layer.id];
      if (src) {
        if (!this.#srcDots.has(src)) this.#srcDots.set(src, []);
        this.#srcDots.get(src).push(dot);
      }
    }
  }

  #setDot(sourceId, state) {
    for (const d of (this.#srcDots.get(sourceId) ?? [])) {
      d.classList.remove('ok', 'err');
      d.classList.add(state);
    }
  }

  #refreshBtn() {
    const active = layerManager.all().filter(l => l.enabled).length;
    const total  = layerManager.all().length;
    this.#btn.innerHTML = `
      <span style="opacity:.55;font-size:12px">☰</span> LAYERS
      <span class="eos-lb-badge">${active}/${total}</span>
    `;
    if (this.#open) this.#btn.classList.add('open');
  }

  #toggle() { this.#open ? this.#close() : this.#openMenu(); }

  #openMenu() {
    this.#open = true;
    this.#menu.classList.add('open');
    this.#btn.classList.add('open');
  }

  #close() {
    this.#open = false;
    this.#menu.classList.remove('open');
    this.#btn.classList.remove('open');
  }

  dispose() {
    for (const u of this.#unsub) u?.();
    this.#menu?.remove();
  }

  #injectStyle() {
    if (document.getElementById('eos-lm-style')) return;
    const s = document.createElement('style');
    s.id = 'eos-lm-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }
}

export default LayerMenuUI;
