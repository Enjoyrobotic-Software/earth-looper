/**
 * EarthOS Dock — macOS-style bottom app launcher.
 * Apps register themselves; icons appear in the dock; click launches or restores.
 */

const DOCK_STYLE = `
#eos-dock {
  position:fixed; bottom:16px; left:50%; transform:translateX(-50%);
  z-index:150; display:flex; align-items:flex-end; gap:6px;
  background:rgba(10,14,20,0.82); border:1px solid rgba(255,255,255,0.10);
  border-radius:18px; padding:9px 14px; backdrop-filter:blur(24px);
  box-shadow:0 8px 32px rgba(0,0,0,0.6); pointer-events:auto;
}
.eos-dock-item {
  display:flex; flex-direction:column; align-items:center; gap:4px;
  cursor:pointer; user-select:none;
}
.eos-dock-btn {
  width:44px; height:44px; border-radius:13px; display:flex;
  align-items:center; justify-content:center; font-size:22px;
  background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08);
  transition:transform .15s cubic-bezier(.34,1.56,.64,1), background .12s;
  position:relative;
}
.eos-dock-btn:hover { transform:scale(1.20) translateY(-6px); background:rgba(255,255,255,0.10); }
.eos-dock-btn.active::after {
  content:''; position:absolute; bottom:-6px; left:50%; transform:translateX(-50%);
  width:4px; height:4px; background:#4caf7d; border-radius:50%;
}
.eos-dock-label {
  font-size:9px; font-family:'JetBrains Mono',monospace;
  color:rgba(255,255,255,0.28); letter-spacing:.06em; white-space:nowrap;
}
.eos-dock-sep {
  width:1px; height:36px; background:rgba(255,255,255,0.10);
  align-self:center; margin:0 4px;
}
`;

export class Dock {
  #el   = null;
  #map  = new Map();   // id → btn element

  init(apps) {
    const style = document.createElement('style');
    style.textContent = DOCK_STYLE;
    document.head.appendChild(style);

    this.#el = document.createElement('div');
    this.#el.id = 'eos-dock';
    document.body.appendChild(this.#el);

    for (const app of apps) this.#addIcon(app);
  }

  #addIcon(app) {
    if (app === '---') {
      const sep = document.createElement('div');
      sep.className = 'eos-dock-sep';
      this.#el.appendChild(sep);
      return;
    }

    const item = document.createElement('div');
    item.className = 'eos-dock-item';

    const btn = document.createElement('div');
    btn.className = 'eos-dock-btn';
    btn.textContent = app.icon;
    btn.title = app.name;

    const label = document.createElement('div');
    label.className = 'eos-dock-label';
    label.textContent = app.name;

    item.append(btn, label);
    this.#el.appendChild(item);
    this.#map.set(app.id, btn);

    btn.addEventListener('click', () => {
      app.launch();
      this.#markActive(app.id);
    });
  }

  #markActive(id) {
    for (const [aid, btn] of this.#map) btn.classList.toggle('active', aid === id);
  }

  setActive(id)   { this.#markActive(id); }
  clearActive()   { for (const btn of this.#map.values()) btn.classList.remove('active'); }
}

export default Dock;
