/**
 * EarthOS WindowManager — floating window system (WM).
 * Creates, destroys, focuses, drags, and resizes windows.
 * All windows render inside a fixed overlay above the globe.
 */

const WM_STYLE = `
.eos-wm-overlay { position:fixed; inset:0; pointer-events:none; z-index:100; }
.eos-win {
  position:absolute; pointer-events:auto;
  background:rgba(10,14,20,0.97); border:1px solid rgba(255,255,255,0.10);
  border-radius:10px; box-shadow:0 24px 60px rgba(0,0,0,0.7);
  display:flex; flex-direction:column; min-width:280px; min-height:160px;
  backdrop-filter:blur(20px); overflow:hidden;
}
.eos-win.focused { border-color:rgba(255,255,255,0.18); box-shadow:0 28px 72px rgba(0,0,0,0.85); }
.eos-win.minimized { display:none; }
.eos-win-bar {
  display:flex; align-items:center; gap:8px; padding:10px 14px;
  background:rgba(255,255,255,0.04); border-bottom:1px solid rgba(255,255,255,0.06);
  cursor:move; user-select:none; flex-shrink:0;
}
.eos-win-dots { display:flex; gap:6px; }
.eos-win-dot {
  width:12px; height:12px; border-radius:50%; cursor:pointer; transition:filter .12s;
}
.eos-win-dot:hover { filter:brightness(1.4); }
.eos-win-close { background:#e05555; }
.eos-win-min   { background:#e8c97a; }
.eos-win-max   { background:#4caf7d; }
.eos-win-icon  { font-size:14px; }
.eos-win-title {
  flex:1; font-family:'JetBrains Mono',monospace; font-size:11px;
  color:rgba(255,255,255,0.55); letter-spacing:.08em; text-align:center;
}
.eos-win-body  { flex:1; overflow:auto; padding:14px; position:relative; }
.eos-win-resize {
  position:absolute; bottom:0; right:0; width:16px; height:16px;
  cursor:nwse-resize; border-radius:4px 0 8px 0;
}
`;

let zTop = 200;

export class WindowManager {
  #overlay = null;
  #windows = new Map();

  init() {
    const style = document.createElement('style');
    style.textContent = WM_STYLE;
    document.head.appendChild(style);

    this.#overlay = document.createElement('div');
    this.#overlay.className = 'eos-wm-overlay';
    document.body.appendChild(this.#overlay);
  }

  create(opts) {
    const { id, title = 'Window', icon = '🪟', x = 120, y = 80, w = 420, h = 320, resizable = true } = opts;

    if (this.#windows.has(id)) {
      const rec = this.#windows.get(id);
      if (rec.minimized) this.restore(id);
      this.focus(id);
      return rec.el;
    }

    const win = document.createElement('div');
    win.className = 'eos-win';
    win.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;z-index:${++zTop}`;

    win.innerHTML = `
      <div class="eos-win-bar">
        <div class="eos-win-dots">
          <div class="eos-win-dot eos-win-close" title="Close"></div>
          <div class="eos-win-dot eos-win-min"   title="Minimize"></div>
          <div class="eos-win-dot eos-win-max"   title="Maximize"></div>
        </div>
        <span class="eos-win-icon">${icon}</span>
        <span class="eos-win-title">${title}</span>
      </div>
      <div class="eos-win-body"></div>
      ${resizable ? '<div class="eos-win-resize"></div>' : ''}
    `;

    const body = win.querySelector('.eos-win-body');
    if (opts.contentEl) body.appendChild(opts.contentEl);
    else if (opts.content) body.innerHTML = opts.content;

    win.querySelector('.eos-win-close').onclick = () => this.close(id);
    win.querySelector('.eos-win-min').onclick   = () => this.minimize(id);
    win.querySelector('.eos-win-max').onclick   = () => this.#toggleMax(id);

    win.addEventListener('mousedown', () => this.focus(id));
    this.#makeDraggable(win, win.querySelector('.eos-win-bar'));
    if (resizable) this.#makeResizable(win, win.querySelector('.eos-win-resize'));

    this.#overlay.appendChild(win);
    this.#windows.set(id, { el: win, opts, minimized: false, maximized: false, prevRect: null });
    this.focus(id);
    return win;
  }

  close(id) {
    const rec = this.#windows.get(id);
    if (!rec) return;
    rec.el.remove();
    this.#windows.delete(id);
  }

  focus(id) {
    this.#windows.forEach(r => r.el.classList.remove('focused'));
    const rec = this.#windows.get(id);
    if (rec) { rec.el.style.zIndex = ++zTop; rec.el.classList.add('focused'); }
  }

  minimize(id) {
    const rec = this.#windows.get(id);
    if (!rec) return;
    rec.minimized = true;
    rec.el.classList.add('minimized');
  }

  restore(id) {
    const rec = this.#windows.get(id);
    if (!rec) return;
    rec.minimized = false;
    rec.el.classList.remove('minimized');
  }

  isOpen(id)      { return this.#windows.has(id); }
  isMinimized(id) { return this.#windows.get(id)?.minimized ?? false; }
  body(id)        { return this.#windows.get(id)?.el.querySelector('.eos-win-body') ?? null; }
  all()           { return [...this.#windows.keys()]; }

  #toggleMax(id) {
    const rec = this.#windows.get(id);
    if (!rec) return;
    const el = rec.el;
    if (rec.maximized) {
      const { left, top, width, height } = rec.prevRect;
      el.style.left = left; el.style.top = top; el.style.width = width; el.style.height = height;
      rec.maximized = false;
    } else {
      rec.prevRect = { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height };
      el.style.cssText += ';left:0;top:0;width:100vw;height:calc(100vh - 72px)';
      rec.maximized = true;
    }
  }

  #makeDraggable(win, handle) {
    let ox = 0, oy = 0, sx = 0, sy = 0;
    const onMove = e => {
      win.style.left = Math.max(0, sx + e.clientX - ox) + 'px';
      win.style.top  = Math.max(0, sy + e.clientY - oy) + 'px';
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    handle.addEventListener('mousedown', e => {
      if (e.target.classList.contains('eos-win-dot')) return;
      ox = e.clientX; oy = e.clientY;
      sx = parseInt(win.style.left) || 0;
      sy = parseInt(win.style.top)  || 0;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }

  #makeResizable(win, handle) {
    let ox = 0, oy = 0, sw = 0, sh = 0;
    const onMove = e => {
      win.style.width  = Math.max(280, sw + e.clientX - ox) + 'px';
      win.style.height = Math.max(160, sh + e.clientY - oy) + 'px';
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    handle.addEventListener('mousedown', e => {
      ox = e.clientX; oy = e.clientY;
      sw = parseInt(win.style.width); sh = parseInt(win.style.height);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }
}

export const windowManager = new WindowManager();
export default windowManager;
