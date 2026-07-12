/**
 * EarthOS NotificationSystem — toast alerts for significant events.
 * Severity thresholds: EQ ≥ 6.0, Volcano warning, Fire FRP > 2000, etc.
 * Stacks up to 5 toasts; auto-dismisses after 8 s.
 */

import bus, { Events } from '../core/eventBus.js';

const STYLE = `
#eos-notifs {
  position:fixed; bottom:60px; right:16px; z-index:200;
  display:flex; flex-direction:column-reverse; gap:8px;
  pointer-events:none; max-width:320px;
}
.eos-toast {
  background:rgba(10,14,20,0.95); border-radius:10px;
  border-left:3px solid var(--t-color,#e8c97a);
  padding:10px 14px; pointer-events:auto;
  display:flex; align-items:flex-start; gap:10px;
  font-family:'Inter',sans-serif; font-size:12px; color:rgba(255,255,255,0.85);
  box-shadow:0 4px 24px rgba(0,0,0,0.6); backdrop-filter:blur(16px);
  animation:eos-slide-in .22s ease;
}
@keyframes eos-slide-in { from{transform:translateX(110%);opacity:0} to{transform:none;opacity:1} }
.eos-toast__icon { font-size:20px; line-height:1; flex-shrink:0; }
.eos-toast__body { flex:1; }
.eos-toast__title { font-weight:600; color:#fff; margin-bottom:2px; font-size:12px; }
.eos-toast__sub   { color:rgba(255,255,255,0.5); font-size:10px; }
.eos-toast__close { background:none; border:none; color:rgba(255,255,255,0.3);
                    cursor:pointer; font-size:14px; line-height:1; flex-shrink:0; }
.eos-toast__close:hover { color:#fff; }
@media(max-width:480px){ #eos-notifs { bottom:56vh; left:8px; right:8px; } }
`;

const SEVERITY = {
  earthquake: ev => (ev.magnitude ?? 0) >= 6.0,
  volcano:    ev => (ev.detail?.alertRank ?? 0) >= 2,
  fire:       ev => (ev.detail?.frp ?? 0) >= 2000,
  storm:      ev => true,
  flood:      ev => true,
  tsunami:    ev => true,
};

const ICONS   = { earthquake:'🔴', volcano:'🌋', fire:'🔥', storm:'🌀', flood:'🌊', tsunami:'⚠️', pollution:'💨' };
const COLORS  = { earthquake:'#e05555', volcano:'#d4854a', fire:'#ff6b35', storm:'#4a90d4', flood:'#0077b6', tsunami:'#ff9800' };

export class NotificationSystem {
  #container;
  #toasts = [];
  #MAX    = 5;
  #unsub  = [];

  constructor() {
    this.#injectStyle();
    this.#container = document.createElement('div');
    this.#container.id = 'eos-notifs';
    document.body.appendChild(this.#container);
  }

  init() {
    const watch = (event, type) => {
      this.#unsub.push(bus.on(event, ev => {
        if (SEVERITY[type]?.(ev) ?? true) this.push(type, ev);
      }));
    };

    watch(Events.EARTHQUAKE, 'earthquake');
    watch(Events.VOLCANO,    'volcano');
    watch(Events.FIRE,       'fire');
    watch(Events.STORM,      'storm');
    watch(Events.FLOOD,      'flood');
    watch(Events.TSUNAMI,    'tsunami');
  }

  push(type, ev) {
    if (this.#toasts.length >= this.#MAX) this.#dismiss(this.#toasts[0]);

    const color = COLORS[type] ?? '#e8c97a';
    const icon  = ICONS[type]  ?? '⚠️';

    const toast = document.createElement('div');
    toast.className = 'eos-toast';
    toast.style.setProperty('--t-color', color);
    toast.innerHTML = `
      <div class="eos-toast__icon">${icon}</div>
      <div class="eos-toast__body">
        <div class="eos-toast__title">${this.#escape(ev.title)}</div>
        <div class="eos-toast__sub">${this.#formatSub(type, ev)}</div>
      </div>
      <button class="eos-toast__close" aria-label="Dismiss">✕</button>`;

    toast.querySelector('.eos-toast__close').onclick = () => this.#dismiss(toast);
    this.#container.appendChild(toast);
    this.#toasts.push(toast);

    setTimeout(() => this.#dismiss(toast), 8000);
  }

  destroy() {
    for (const u of this.#unsub) u?.();
    this.#container.remove();
  }

  #dismiss(toast) {
    if (!toast.parentNode) return;
    toast.style.transition = 'opacity .3s, transform .3s';
    toast.style.opacity    = '0';
    toast.style.transform  = 'translateX(110%)';
    setTimeout(() => {
      toast.remove();
      this.#toasts = this.#toasts.filter(t => t !== toast);
    }, 320);
  }

  #formatSub(type, ev) {
    const ago = this.#ago(ev.time);
    if (type === 'earthquake') return `M${ev.magnitude?.toFixed(1)} · ${ev.detail?.place ?? ''} · ${ago}`;
    if (type === 'volcano')    return `Alert: ${ev.detail?.alert ?? 'Watch'} · ${ev.detail?.country ?? ''} · ${ago}`;
    if (type === 'fire')       return `FRP ${ev.detail?.frp?.toFixed(0)} MW · ${ago}`;
    return `${ev.source?.toUpperCase()} · ${ago}`;
  }

  #ago(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60)    return `${s}s ago`;
    if (s < 3600)  return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
  }

  #escape(str) {
    return String(str ?? '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
  }

  #injectStyle() {
    if (document.getElementById('eos-notifs-style')) return;
    const s = document.createElement('style');
    s.id = 'eos-notifs-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }
}

export default NotificationSystem;
