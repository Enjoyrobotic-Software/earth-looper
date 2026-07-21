/**
 * EarthOS Dock — compact app launcher, inline in the top bar.
 */

const DOCK_STYLE = `
#eos-dock {
  display:flex; align-items:center; gap:2px;
  margin-left:auto; flex-shrink:0;
}
.eos-dock-btn {
  width:30px; height:30px; border-radius:8px; display:flex;
  align-items:center; justify-content:center; font-size:16px;
  background:transparent; border:1px solid transparent;
  cursor:pointer; user-select:none; position:relative;
  transition:background .12s, border-color .12s;
}
.eos-dock-btn:hover {
  background:rgba(255,255,255,0.07);
  border-color:rgba(255,255,255,0.10);
}
.eos-dock-btn.active {
  background:rgba(255,255,255,0.06);
  border-color:rgba(255,255,255,0.12);
}
.eos-dock-btn.active::after {
  content:''; position:absolute; bottom:3px; left:50%; transform:translateX(-50%);
  width:3px; height:2px; background:#4caf7d; border-radius:1px;
}
.eos-dock-sep {
  width:1px; height:16px; background:rgba(255,255,255,0.09); margin:0 5px;
}
`;

export class Dock {
  #el  = null;
  #map = new Map();

  init(apps) {
    const style = document.createElement('style');
    style.textContent = DOCK_STYLE;
    document.head.appendChild(style);

    this.#el = document.createElement('div');
    this.#el.id = 'eos-dock';

    const topBar = document.getElementById('top');
    if (topBar) topBar.appendChild(this.#el);
    else document.body.appendChild(this.#el);

    for (const app of apps) this.#addIcon(app);
  }

  #addIcon(app) {
    if (app === '---') {
      const sep = document.createElement('div');
      sep.className = 'eos-dock-sep';
      this.#el.appendChild(sep);
      return;
    }

    const btn = document.createElement('div');
    btn.className = 'eos-dock-btn';
    btn.textContent = app.icon;
    btn.title = app.name;
    this.#el.appendChild(btn);
    this.#map.set(app.id, btn);

    btn.addEventListener('click', () => {
      app.launch();
      this.#markActive(app.id);
    });
  }

  #markActive(id) {
    for (const [aid, btn] of this.#map) btn.classList.toggle('active', aid === id);
  }

  setActive(id)  { this.#markActive(id); }
  clearActive()  { for (const btn of this.#map.values()) btn.classList.remove('active'); }
}

export default Dock;
