/**
 * EarthOS ContextMenu — right-click popup menu system.
 * Usage: contextMenu.show(x, y, items)
 * items: array of { icon, label, action, danger? } or '---' for separator
 */

const CTX_STYLE = `
#eos-ctx {
  position:fixed; z-index:500; display:none;
  background:rgba(10,14,20,0.98); border:1px solid rgba(255,255,255,0.12);
  border-radius:9px; padding:6px 0; min-width:190px;
  box-shadow:0 12px 40px rgba(0,0,0,0.8); backdrop-filter:blur(20px);
}
#eos-ctx.visible { display:block; }
.eos-ctx-item {
  padding:8px 16px; cursor:pointer; display:flex; align-items:center;
  gap:9px; color:rgba(255,255,255,0.78); white-space:nowrap;
  font-family:'JetBrains Mono',monospace; font-size:11px;
  transition:background .08s;
}
.eos-ctx-item:hover { background:rgba(255,255,255,0.08); }
.eos-ctx-item.danger { color:#e05555; }
.eos-ctx-item-icon { width:14px; text-align:center; }
.eos-ctx-sep { border-top:1px solid rgba(255,255,255,0.08); margin:4px 0; }
`;

class ContextMenu {
  #el = null;

  init() {
    const style = document.createElement('style');
    style.textContent = CTX_STYLE;
    document.head.appendChild(style);

    this.#el = document.createElement('div');
    this.#el.id = 'eos-ctx';
    document.body.appendChild(this.#el);

    document.addEventListener('click', () => this.hide(), { capture: true });
    document.addEventListener('contextmenu', e => e.preventDefault());
  }

  show(x, y, items) {
    this.#el.innerHTML = '';

    for (const item of items) {
      if (item === '---') {
        const sep = document.createElement('div');
        sep.className = 'eos-ctx-sep';
        this.#el.appendChild(sep);
        continue;
      }
      const el = document.createElement('div');
      el.className = 'eos-ctx-item' + (item.danger ? ' danger' : '');
      el.innerHTML = `<span class="eos-ctx-item-icon">${item.icon ?? ''}</span><span>${item.label}</span>`;
      el.addEventListener('click', e => {
        e.stopPropagation();
        this.hide();
        item.action?.();
      });
      this.#el.appendChild(el);
    }

    this.#el.classList.remove('visible');
    this.#el.style.left = '-9999px';
    this.#el.style.top  = '-9999px';
    this.#el.classList.add('visible');

    const vw = window.innerWidth, vh = window.innerHeight;
    const mw = this.#el.offsetWidth, mh = this.#el.offsetHeight;
    this.#el.style.left = Math.min(x, vw - mw - 8) + 'px';
    this.#el.style.top  = Math.min(y, vh - mh - 8) + 'px';
  }

  hide() { this.#el?.classList.remove('visible'); }
}

export const contextMenu = new ContextMenu();
export default contextMenu;
