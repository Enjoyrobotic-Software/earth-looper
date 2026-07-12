/**
 * EarthOS CountryCompare — side-by-side country stat comparison.
 * Triggered by holding Shift and clicking a second country.
 * Shows a two-column table of key metrics from COUNTRIES config and WorldBank data.
 */

import bus, { Events } from '../core/eventBus.js';

const STYLE = `
#eos-compare {
  position:fixed; bottom:56px; left:50%; transform:translateX(-50%);
  z-index:26; background:rgba(10,14,20,0.97);
  border:1px solid rgba(255,255,255,0.08); border-radius:12px;
  padding:16px; backdrop-filter:blur(20px);
  box-shadow:0 8px 32px rgba(0,0,0,.6); display:none;
  pointer-events:auto; min-width:340px; max-width:calc(100vw - 32px);
  font-family:'JetBrains Mono',monospace;
}
#eos-compare.visible { display:block; }
.cmp-head {
  display:grid; grid-template-columns:1fr 1fr 1fr; gap:4px;
  font-size:9px; letter-spacing:.08em; text-transform:uppercase;
  color:rgba(255,255,255,0.3); margin-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:6px;
}
.cmp-head span:first-child { color:rgba(255,255,255,0.2); }
.cmp-head span:nth-child(2) { color:#e8c97a; text-align:center; }
.cmp-head span:nth-child(3) { color:#4a90d4; text-align:right; }
.cmp-row {
  display:grid; grid-template-columns:1fr 1fr 1fr; gap:4px;
  font-size:10px; color:rgba(255,255,255,0.6); padding:4px 0;
  border-bottom:1px solid rgba(255,255,255,0.04);
}
.cmp-row:last-child { border-bottom:none; }
.cmp-row .key { color:rgba(255,255,255,0.3); font-size:9px; }
.cmp-row .val { text-align:center; color:rgba(255,255,255,0.7); }
.cmp-row .val2{ text-align:right;  color:rgba(255,255,255,0.7); }
.better { color:#4caf7d !important; }
.worse  { color:#e05555 !important; }
#cmp-close { position:absolute; top:10px; right:12px;
             background:none; border:none; color:rgba(255,255,255,0.3);
             cursor:pointer; font-size:12px; }
#cmp-close:hover { color:#fff; }
`;

const METRICS = [
  { key: 'gdp',  label: 'GDP/cap $',  fmt: v => v ? `$${(v/1000).toFixed(0)}k` : '—', higher:'better' },
  { key: 'pop',  label: 'Population', fmt: v => v ? (v>1e6 ? `${(v/1e6).toFixed(0)}M` : `${(v/1e3).toFixed(0)}k`) : '—', higher:'neutral' },
  { key: 'cor',  label: 'Corruption', fmt: v => v != null ? v : '—', higher:'worse'  },
  { key: 'dem',  label: 'Democracy',  fmt: v => v != null ? v : '—', higher:'better' },
  { key: 'tl',   label: 'Terror Lvl', fmt: v => v != null ? v : '—', higher:'worse'  },
];

export class CountryCompare {
  #el    = null;
  #a     = null;   // first country
  #b     = null;   // second country
  #unsub = [];

  constructor() {
    this.#inject();
  }

  init() {
    this.#unsub.push(bus.on(Events.COUNTRY_SELECTED, ({ country, shiftKey }) => {
      if (!country) return;
      if (!this.#a || !shiftKey) {
        this.#a = country;
        this.#b = null;
        this.#hide();
      } else {
        this.#b = country;
        this.#render();
      }
    }));
  }

  destroy() {
    for (const u of this.#unsub) u?.();
    this.#el?.remove();
  }

  #render() {
    if (!this.#a || !this.#b) return;
    const a = this.#a, b = this.#b;

    const head = this.#el.querySelector('#cmp-head');
    const body = this.#el.querySelector('#cmp-body');

    head.innerHTML = `
      <span>Metric</span>
      <span>${(a.n ?? a.iso ?? '?').slice(0,14)}</span>
      <span>${(b.n ?? b.iso ?? '?').slice(0,14)}</span>`;

    body.innerHTML = METRICS.map(m => {
      const va = a[m.key], vb = b[m.key];
      const aClass = this.#cls(va, vb, m.higher);
      const bClass = this.#cls(vb, va, m.higher);
      return `<div class="cmp-row">
        <span class="key">${m.label}</span>
        <span class="val ${aClass}">${m.fmt(va)}</span>
        <span class="val2 ${bClass}">${m.fmt(vb)}</span>
      </div>`;
    }).join('');

    this.#el.classList.add('visible');
  }

  #cls(own, other, direction) {
    if (own == null || other == null) return '';
    if (direction === 'better')  return own > other ? 'better' : own < other ? 'worse' : '';
    if (direction === 'worse')   return own < other ? 'better' : own > other ? 'worse' : '';
    return '';
  }

  #hide() { this.#el.classList.remove('visible'); }

  #inject() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.#el = document.createElement('div');
    this.#el.id = 'eos-compare';
    this.#el.innerHTML = `
      <button id="cmp-close">✕</button>
      <div class="cmp-head" id="cmp-head">
        <span>Metric</span><span>Country A</span><span>Country B</span>
      </div>
      <div id="cmp-body"></div>
      <div style="margin-top:8px;font-size:8px;color:rgba(255,255,255,0.2);font-family:'JetBrains Mono',monospace">
        Shift+click a second country to compare
      </div>`;
    document.body.appendChild(this.#el);
    this.#el.querySelector('#cmp-close').onclick = () => this.#hide();
  }
}

export default CountryCompare;
