/**
 * EarthOS NotificationCenter — bell icon in top bar, slide-in history panel.
 * Subscribes to Events.NOTIFICATION and 'alert:triggered'.
 * Shows badge count, opens panel with categorized, dismissable entries.
 */

import bus, { Events } from '../core/eventBus.js';

const NC_STYLE = `
#eos-nc-btn {
  position:relative; width:32px; height:32px; border-radius:8px;
  background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08);
  display:flex; align-items:center; justify-content:center;
  cursor:pointer; flex-shrink:0; font-size:16px; transition:background .12s;
  pointer-events:auto;
}
#eos-nc-btn:hover { background:rgba(255,255,255,0.12); }
#eos-nc-badge {
  position:absolute; top:-5px; right:-5px; min-width:16px; height:16px;
  border-radius:8px; background:#e05555; color:#fff;
  font-family:'JetBrains Mono',monospace; font-size:9px; font-weight:700;
  display:none; align-items:center; justify-content:center; padding:0 4px;
}
#eos-nc-badge.visible { display:flex; }

#eos-nc-panel {
  position:fixed; top:0; right:-360px; width:340px; height:100vh;
  background:rgba(10,14,20,0.98); border-left:1px solid rgba(255,255,255,0.08);
  backdrop-filter:blur(24px); z-index:300; display:flex; flex-direction:column;
  transition:right .28s cubic-bezier(.32,0,.12,1); pointer-events:auto;
}
#eos-nc-panel.open { right:0; }

.nc-header {
  display:flex; align-items:center; justify-content:space-between;
  padding:16px 18px; border-bottom:1px solid rgba(255,255,255,0.07); flex-shrink:0;
}
.nc-title {
  font-family:'JetBrains Mono',monospace; font-size:12px; letter-spacing:.12em;
  text-transform:uppercase; color:rgba(255,255,255,0.5);
}
.nc-clear {
  font-family:'JetBrains Mono',monospace; font-size:10px; color:rgba(255,255,255,0.28);
  cursor:pointer; background:none; border:none; padding:0; transition:color .1s;
}
.nc-clear:hover { color:rgba(255,255,255,0.6); }

.nc-list  { flex:1; overflow-y:auto; padding:8px 0; }
.nc-empty { padding:32px 18px; text-align:center; color:rgba(255,255,255,0.2);
  font-size:12px; font-family:'JetBrains Mono',monospace; }

.nc-item {
  padding:11px 18px; border-bottom:1px solid rgba(255,255,255,0.04);
  display:flex; gap:10px; align-items:flex-start; cursor:default;
  transition:background .08s;
}
.nc-item:hover { background:rgba(255,255,255,0.03); }
.nc-item-icon { font-size:16px; flex-shrink:0; margin-top:1px; }
.nc-item-body { flex:1; min-width:0; }
.nc-item-text {
  font-size:11px; color:rgba(255,255,255,0.78); line-height:1.45;
  word-break:break-word;
}
.nc-item-time {
  font-family:'JetBrains Mono',monospace; font-size:9px;
  color:rgba(255,255,255,0.22); margin-top:3px; letter-spacing:.04em;
}
.nc-item-dismiss {
  font-size:13px; color:rgba(255,255,255,0.18); cursor:pointer;
  line-height:1; flex-shrink:0; padding:2px;
  transition:color .1s;
}
.nc-item-dismiss:hover { color:rgba(255,255,255,0.5); }

.nc-sev-critical .nc-item-icon { filter:drop-shadow(0 0 4px #e05555); }
.nc-sev-warning  .nc-item-icon { filter:drop-shadow(0 0 4px #e8c97a); }
`;

const SEV_ICONS = { critical:'🔴', warning:'🟠', info:'🔵', default:'⚪' };

export class NotificationCenter {
  #list    = [];
  #unread  = 0;
  #badge   = null;
  #listEl  = null;
  #panel   = null;
  #open    = false;

  init() {
    const style = document.createElement('style');
    style.textContent = NC_STYLE;
    document.head.appendChild(style);

    this.#buildUI();

    // Subscribe to all notifications
    bus.on(Events.NOTIFICATION, n => this.#push(n));
    bus.on('alert:triggered',   a => this.#push({ text: a.text, severity: 'critical', source: 'alert' }));
    bus.on('alerts:clear', () => this.clear());
  }

  #buildUI() {
    // Bell button — insert into top bar
    const btn = document.createElement('div');
    btn.id = 'eos-nc-btn';
    btn.title = 'Notifications';
    btn.textContent = '🔔';

    const badge = document.createElement('div');
    badge.id = 'eos-nc-badge';
    btn.appendChild(badge);
    this.#badge = badge;

    const top = document.getElementById('top');
    if (top) {
      // Insert before the clock wrapper
      const clkw = document.getElementById('clkw');
      top.insertBefore(btn, clkw ?? null);
    }

    btn.addEventListener('click', e => { e.stopPropagation(); this.#toggle(); });

    // Panel
    const panel = document.createElement('div');
    panel.id = 'eos-nc-panel';
    panel.innerHTML = `
      <div class="nc-header">
        <span class="nc-title">Notifications</span>
        <button class="nc-clear" id="nc-clear-btn">Clear all</button>
      </div>
      <div class="nc-list" id="nc-list"></div>
    `;
    document.body.appendChild(panel);
    this.#panel   = panel;
    this.#listEl  = panel.querySelector('#nc-list');

    panel.querySelector('#nc-clear-btn').addEventListener('click', () => this.clear());
    document.addEventListener('click', e => {
      if (this.#open && !panel.contains(e.target) && e.target.id !== 'eos-nc-btn')
        this.#close();
    });

    this.#renderEmpty();
  }

  #push(n) {
    const entry = {
      text:     n.text ?? String(n),
      severity: n.severity ?? 'default',
      source:   n.source  ?? 'system',
      time:     Date.now(),
      id:       Math.random().toString(36).slice(2),
    };
    this.#list.unshift(entry);
    if (this.#list.length > 100) this.#list.pop();
    this.#unread++;
    this.#updateBadge();
    this.#prependItem(entry);
  }

  #prependItem(entry) {
    const empty = this.#listEl.querySelector('.nc-empty');
    if (empty) empty.remove();

    const icon = SEV_ICONS[entry.severity] ?? '⚪';
    const el = document.createElement('div');
    el.className = `nc-item nc-sev-${entry.severity}`;
    el.dataset.id = entry.id;
    el.innerHTML = `
      <span class="nc-item-icon">${icon}</span>
      <div class="nc-item-body">
        <div class="nc-item-text">${entry.text.replace(/</g,'&lt;')}</div>
        <div class="nc-item-time">${new Date(entry.time).toUTCString().slice(5,22)}</div>
      </div>
      <span class="nc-item-dismiss" title="Dismiss">✕</span>
    `;
    el.querySelector('.nc-item-dismiss').addEventListener('click', () => {
      this.#list = this.#list.filter(e => e.id !== entry.id);
      el.remove();
      if (!this.#listEl.children.length) this.#renderEmpty();
    });
    this.#listEl.prepend(el);
  }

  #renderEmpty() {
    this.#listEl.innerHTML = '<div class="nc-empty">No notifications</div>';
  }

  #updateBadge() {
    if (this.#unread > 0) {
      this.#badge.textContent = this.#unread > 99 ? '99+' : String(this.#unread);
      this.#badge.classList.add('visible');
    } else {
      this.#badge.classList.remove('visible');
    }
  }

  #toggle() { this.#open ? this.#close() : this.#open_(); }

  #open_() {
    this.#panel.classList.add('open');
    this.#open   = true;
    this.#unread = 0;
    this.#updateBadge();
  }

  #close() {
    this.#panel.classList.remove('open');
    this.#open = false;
  }

  clear() {
    this.#list   = [];
    this.#unread = 0;
    this.#updateBadge();
    this.#listEl.innerHTML = '';
    this.#renderEmpty();
  }

  get count() { return this.#list.length; }
}

export default NotificationCenter;
