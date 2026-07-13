/**
 * EarthOS Settings — configure layers, appearance, and persistence.
 */

import windowManager  from '../ui/windowManager.js';
import bus, { Events } from '../core/eventBus.js';
import persistence    from '../core/persistence.js';

const SET_STYLE = `
.eos-set { height:100%; overflow-y:auto; display:flex; flex-direction:column; gap:20px; }
.eos-set-h {
  font-family:'JetBrains Mono',monospace; font-size:10px;
  letter-spacing:.12em; text-transform:uppercase; color:rgba(255,255,255,0.28);
  margin-bottom:10px;
}
.eos-set-row {
  display:flex; justify-content:space-between; align-items:center;
  padding:9px 0; border-bottom:1px solid rgba(255,255,255,0.05);
}
.eos-set-label { font-size:12px; display:flex; align-items:center; gap:9px; color:rgba(255,255,255,0.75); }
.eos-toggle {
  width:36px; height:20px; border-radius:10px; background:rgba(255,255,255,0.12);
  border:none; cursor:pointer; position:relative; transition:background .18s; flex-shrink:0;
}
.eos-toggle.on { background:#4caf7d; }
.eos-toggle::after {
  content:''; position:absolute; top:3px; left:3px; width:14px; height:14px;
  border-radius:50%; background:#fff; transition:left .15s;
  box-shadow:0 1px 4px rgba(0,0,0,0.4);
}
.eos-toggle.on::after { left:19px; }
.eos-set-about-row {
  display:flex; justify-content:space-between; align-items:center;
  padding:7px 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:11px;
}
.eos-set-about-val { font-family:'JetBrains Mono',monospace; font-size:11px; color:rgba(255,255,255,0.28); }
.eos-set-clear-btn {
  background:rgba(224,85,85,0.15); border:1px solid rgba(224,85,85,0.3);
  border-radius:6px; color:#e05555; font-family:'JetBrains Mono',monospace;
  font-size:11px; padding:7px 14px; cursor:pointer; transition:background .12s; width:100%;
}
.eos-set-clear-btn:hover { background:rgba(224,85,85,0.25); }
`;

export class SettingsApp {
  get id()   { return 'settings'; }
  get icon() { return '⚙️'; }
  get name() { return 'Settings'; }

  launch() {
    if (windowManager.isOpen(this.id)) {
      windowManager.isMinimized(this.id) ? windowManager.restore(this.id) : windowManager.focus(this.id);
      return;
    }

    const style = document.createElement('style');
    style.textContent = SET_STYLE;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.className = 'eos-set';

    windowManager.create({ id: this.id, title: 'Settings', icon: this.icon, contentEl: root, x: 500, y: 90, w: 360, h: 480 });

    this.#render(root);
  }

  #render(root) {
    const eos = window.EarthOS;

    // ── Layers section ───────────────────────────────────────────────────────
    const layerSec = document.createElement('div');
    layerSec.innerHTML = `<div class="eos-set-h">Layers</div>`;

    const layers = eos ? eos.engine.status().layers : [];
    for (const layer of layers) {
      const savedState = persistence.load(`layer_${layer.id}`);
      const enabled    = savedState !== null ? savedState : layer.enabled;

      const row = document.createElement('div');
      row.className = 'eos-set-row';

      const lbl = document.createElement('div');
      lbl.className = 'eos-set-label';
      lbl.innerHTML = `<span>${layer.icon ?? ''}</span><span>${layer.name}</span>`;

      const btn = document.createElement('button');
      btn.className = 'eos-toggle' + (enabled ? ' on' : '');

      btn.addEventListener('click', () => {
        const nowOn = !btn.classList.contains('on');
        btn.classList.toggle('on', nowOn);
        bus.emit(Events.LAYER_TOGGLE, { id: layer.id, enabled: nowOn });
        persistence.save(`layer_${layer.id}`, nowOn);
      });

      row.append(lbl, btn);
      layerSec.appendChild(row);
    }

    // ── About section ────────────────────────────────────────────────────────
    const aboutSec = document.createElement('div');
    aboutSec.innerHTML = `
      <div class="eos-set-h">About</div>
      <div class="eos-set-about-row"><span>EarthOS</span><span class="eos-set-about-val">v5.0.0</span></div>
      <div class="eos-set-about-row"><span>Build</span><span class="eos-set-about-val">Sprint 9 · OS Shell</span></div>
      <div class="eos-set-about-row"><span>Engine</span><span class="eos-set-about-val">Three.js r128</span></div>
    `;

    // ── Storage section ──────────────────────────────────────────────────────
    const storageSec = document.createElement('div');
    storageSec.innerHTML = `<div class="eos-set-h">Storage</div>`;
    const clearBtn = document.createElement('button');
    clearBtn.className = 'eos-set-clear-btn';
    clearBtn.textContent = 'Clear saved preferences';
    clearBtn.addEventListener('click', () => {
      persistence.clear();
      clearBtn.textContent = 'Cleared ✓';
      setTimeout(() => { clearBtn.textContent = 'Clear saved preferences'; }, 2000);
    });
    storageSec.appendChild(clearBtn);

    root.append(layerSec, aboutSec, storageSec);
  }
}

export default SettingsApp;
