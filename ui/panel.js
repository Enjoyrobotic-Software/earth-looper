/**
 * EarthOS Panel UI — side panel for country/event details.
 * Fully decoupled: listens to EventBus, renders to DOM.
 */

import bus, { Events } from '../core/eventBus.js';

const TEMPLATE = `
<div id="eos-panel" class="eos-panel eos-panel--closed">
  <button class="eos-panel__close" aria-label="Close">✕</button>
  <div class="eos-panel__inner">
    <div class="eos-panel__header">
      <span class="eos-panel__icon"></span>
      <div>
        <h2 class="eos-panel__title">—</h2>
        <p class="eos-panel__sub"></p>
      </div>
    </div>
    <div class="eos-panel__body"></div>
  </div>
</div>`;

const STYLE = `
.eos-panel {
  position:fixed; bottom:0; left:0; right:0; z-index:100;
  background:rgba(10,14,20,0.97); border-top:1px solid rgba(255,255,255,0.08);
  backdrop-filter:blur(24px); color:#ffffffb8;
  font-family:'Inter','Segoe UI',sans-serif; font-size:13px;
  transition:transform .38s cubic-bezier(.32,0,.12,1);
  transform:translateY(100%); max-height:55vh; overflow-y:auto;
  border-radius:16px 16px 0 0;
}
.eos-panel--open { transform:translateY(0); }
.eos-panel__close {
  position:absolute; top:12px; right:16px; background:none;
  border:none; color:#ffffff60; font-size:18px; cursor:pointer; line-height:1;
}
.eos-panel__close:hover { color:#fff; }
.eos-panel__inner { padding:20px 20px 28px; }
.eos-panel__header { display:flex; align-items:center; gap:14px; margin-bottom:16px; }
.eos-panel__icon { font-size:32px; line-height:1; }
.eos-panel__title { font-size:17px; font-weight:600; color:#fffffff0; margin:0; }
.eos-panel__sub { font-size:11px; color:#ffffff60; margin:2px 0 0; letter-spacing:.05em; text-transform:uppercase; }
.eos-panel__body { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.eos-stat { background:rgba(255,255,255,.04); border-radius:8px; padding:10px 12px; }
.eos-stat__label { font-size:9px; letter-spacing:.12em; text-transform:uppercase; color:#ffffff44; margin-bottom:4px; }
.eos-stat__value { font-size:15px; font-weight:500; color:#ffffffd0; }
.eos-stat--wide { grid-column:1/-1; }
.eos-bar { height:5px; border-radius:3px; background:rgba(255,255,255,.08); margin-top:6px; overflow:hidden; }
.eos-bar__fill { height:100%; border-radius:3px; transition:width .4s; }
@media(min-width:640px){
  .eos-panel {
    top:0; bottom:0; right:0; left:auto;
    width:340px; max-height:100vh;
    border-left:1px solid rgba(255,255,255,0.08); border-top:none;
    border-radius:0; transform:translateX(100%);
  }
  .eos-panel--open { transform:translateX(0); }
}`;

export class PanelUI {
  #el;
  #titleEl;
  #subEl;
  #iconEl;
  #bodyEl;

  constructor() {
    this.#inject();
  }

  init() {
    bus.on(Events.COUNTRY_SELECTED, (payload) => {
      if (payload.country) this.showCountry(payload.country);
      else this.close();
    });
    bus.on(Events.EARTHQUAKE, ev => this.showEvent(ev));
    bus.on(Events.FIRE,       ev => this.showEvent(ev));
    bus.on(Events.VOLCANO,    ev => this.showEvent(ev));
    bus.on(Events.STORM,      ev => this.showEvent(ev));
    bus.on(Events.PANEL_CLOSE,    () => this.close());
    bus.on(Events.PANEL_OPEN,     (d) => { if (d?.content) this.showRaw(d.content); });
  }

  showCountry(data) {
    this.#iconEl.textContent  = data.icon ?? '🌍';
    this.#titleEl.textContent = data.name ?? data.n ?? '—';
    this.#subEl.textContent   = `${data.region ?? data.r ?? ''} · ${data.capital ?? data.cap ?? ''}`;

    const stats = [];

    if (data.gdp != null) {
      stats.push(this.#stat('GDP per capita', `$${Number(data.gdp).toLocaleString()}`));
    }
    if (data.pop != null) {
      stats.push(this.#stat('Population', `${data.pop}M`));
    }
    if (data.dem != null) {
      stats.push(this.#barStat('Democracy', data.dem, '#4caf7d'));
    }
    if (data.cor != null) {
      stats.push(this.#barStat('Transparency', data.cor, '#e8c97a'));
    }
    if (data.note) {
      stats.push(this.#stat('Notes', data.note, true));
    }

    this.#bodyEl.innerHTML = stats.join('');
    this.open();
  }

  showEvent(ev) {
    const icons = {
      earthquake: '🔴', fire: '🔥', volcano: '🌋',
      storm: '🌀', flood: '🌊', pollution: '💨',
    };
    this.#iconEl.textContent  = icons[ev.type] ?? '⚠️';
    this.#titleEl.textContent = ev.title;
    this.#subEl.textContent   = `${ev.source.toUpperCase()} · ${this.#ago(ev.time)}`;

    const stats = [];
    if (ev.magnitude != null) {
      stats.push(this.#stat('Magnitude', ev.magnitude.toFixed(1)));
    }
    if (ev.depth != null) {
      stats.push(this.#stat('Depth', `${ev.depth.toFixed(0)} km`));
    }
    if (ev.detail?.place) {
      stats.push(this.#stat('Location', ev.detail.place, true));
    }
    if (ev.detail?.alert) {
      stats.push(this.#stat('Alert', ev.detail.alert.toUpperCase()));
    }
    if (ev.detail?.tsunami) {
      stats.push(this.#stat('Tsunami', '⚠️ Possible', true));
    }
    if (ev.url) {
      stats.push(`<div class="eos-stat eos-stat--wide"><a href="${ev.url}" target="_blank" rel="noopener" style="color:#4a90d4;font-size:12px;">View on USGS ↗</a></div>`);
    }

    this.#bodyEl.innerHTML = stats.join('');
    this.open();
  }

  showRaw(html) {
    this.#iconEl.textContent  = '';
    this.#titleEl.textContent = '';
    this.#subEl.textContent   = '';
    this.#bodyEl.innerHTML    = html;
    this.open();
  }

  open()  {
    this.#el.classList.add('eos-panel--open');
    this.#el.classList.remove('eos-panel--closed');
    bus.emit(Events.PANEL_OPEN, {});
    document.getElementById('wrap')?.classList.add('panel-open');
  }

  close() {
    this.#el.classList.remove('eos-panel--open');
    this.#el.classList.add('eos-panel--closed');
    document.getElementById('wrap')?.classList.remove('panel-open');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  #stat(label, value, wide = false) {
    return `<div class="eos-stat${wide ? ' eos-stat--wide' : ''}">
      <div class="eos-stat__label">${label}</div>
      <div class="eos-stat__value">${value}</div>
    </div>`;
  }

  #barStat(label, value, color) {
    return `<div class="eos-stat">
      <div class="eos-stat__label">${label}</div>
      <div class="eos-stat__value">${value}/100</div>
      <div class="eos-bar"><div class="eos-bar__fill" style="width:${value}%;background:${color}"></div></div>
    </div>`;
  }

  #ago(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60)   return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400)return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
  }

  #inject() {
    const style  = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const wrap  = document.createElement('div');
    wrap.innerHTML = TEMPLATE;
    this.#el     = wrap.firstElementChild;
    document.body.appendChild(this.#el);

    this.#titleEl = this.#el.querySelector('.eos-panel__title');
    this.#subEl   = this.#el.querySelector('.eos-panel__sub');
    this.#iconEl  = this.#el.querySelector('.eos-panel__icon');
    this.#bodyEl  = this.#el.querySelector('.eos-panel__body');

    this.#el.querySelector('.eos-panel__close').onclick = () => this.close();
  }
}

export default PanelUI;
