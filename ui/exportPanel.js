/**
 * EarthOS ExportPanel — screenshot and data export tools.
 * Screenshot: reads the WebGL canvas and downloads as PNG.
 * Data export: serializes current events from historyBuffer as GeoJSON or CSV.
 * Accessible via a small floating button (bottom-right).
 */

import bus, { Events }   from '../core/eventBus.js';
import historyBuffer      from '../core/historyBuffer.js';

const STYLE = `
#eos-export-btn {
  position:fixed; bottom:90px; right:16px; z-index:28;
  background:rgba(10,14,20,0.88); border:1px solid rgba(255,255,255,0.1);
  border-radius:8px; padding:7px 11px; cursor:pointer;
  font-family:'JetBrains Mono',monospace; font-size:10px;
  color:rgba(255,255,255,0.55); backdrop-filter:blur(14px);
  pointer-events:auto; letter-spacing:.06em; transition:color .15s;
  display:flex; align-items:center; gap:6px;
}
#eos-export-btn:hover { color:#fff; }
#eos-export-menu {
  position:fixed; bottom:130px; right:16px; z-index:29;
  background:rgba(10,14,20,0.97); border:1px solid rgba(255,255,255,0.08);
  border-radius:10px; padding:6px 0; display:none;
  backdrop-filter:blur(18px); box-shadow:0 4px 20px rgba(0,0,0,.6);
  pointer-events:auto;
}
#eos-export-menu.open { display:block; }
.exp-item {
  padding:8px 16px; cursor:pointer;
  font-family:'JetBrains Mono',monospace; font-size:10px;
  color:rgba(255,255,255,0.6); letter-spacing:.05em; white-space:nowrap;
  transition:background .12s, color .12s;
}
.exp-item:hover { background:rgba(255,255,255,0.06); color:#fff; }
`;

export class ExportPanel {
  #btn    = null;
  #menu   = null;
  #canvas = null;

  constructor(canvas) {
    this.#canvas = canvas;
    this.#inject();
  }

  init() {
    this.#btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.#menu.classList.toggle('open');
    });
    document.addEventListener('click', () => this.#menu.classList.remove('open'));
  }

  // ── Export methods ─────────────────────────────────────────────────────────

  screenshot() {
    const canvas = this.#canvas;
    if (!canvas) return;

    // Force a render tick to ensure the canvas is current
    const link = document.createElement('a');
    link.download = `earthos_${this.#stamp()}.png`;
    link.href     = canvas.toDataURL('image/png');
    link.click();
  }

  exportGeoJSON() {
    const events = historyBuffer.recent(3_600_000);   // last 1h
    const geojson = {
      type: 'FeatureCollection',
      features: events.map(ev => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [ev.lon, ev.lat] },
        properties: {
          id:        ev.id,
          type:      ev.type,
          magnitude: ev.magnitude,
          time:      new Date(ev.time).toISOString(),
          title:     ev.title,
          source:    ev.source,
          ...ev.detail,
        },
      })),
    };
    this.#download(JSON.stringify(geojson, null, 2), `earthos_${this.#stamp()}.geojson`, 'application/geo+json');
  }

  exportCSV() {
    const events = historyBuffer.recent(3_600_000);
    const cols   = ['id','type','lat','lon','magnitude','time','title','source'];
    const rows   = [cols.join(',')];
    for (const ev of events) {
      rows.push(cols.map(k => JSON.stringify(ev[k] ?? '')).join(','));
    }
    this.#download(rows.join('\n'), `earthos_${this.#stamp()}.csv`, 'text/csv');
  }

  // ── Private ────────────────────────────────────────────────────────────────

  #inject() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.#btn = document.createElement('div');
    this.#btn.id = 'eos-export-btn';
    this.#btn.innerHTML = `<span>⬇</span> Export`;
    document.body.appendChild(this.#btn);

    this.#menu = document.createElement('div');
    this.#menu.id = 'eos-export-menu';
    this.#menu.innerHTML = `
      <div class="exp-item" id="exp-png">📷 Screenshot (PNG)</div>
      <div class="exp-item" id="exp-geojson">🗺 Events → GeoJSON</div>
      <div class="exp-item" id="exp-csv">📋 Events → CSV</div>`;
    document.body.appendChild(this.#menu);

    this.#menu.querySelector('#exp-png').onclick     = (e) => { e.stopPropagation(); this.screenshot();    this.#menu.classList.remove('open'); };
    this.#menu.querySelector('#exp-geojson').onclick = (e) => { e.stopPropagation(); this.exportGeoJSON(); this.#menu.classList.remove('open'); };
    this.#menu.querySelector('#exp-csv').onclick     = (e) => { e.stopPropagation(); this.exportCSV();     this.#menu.classList.remove('open'); };
  }

  #stamp() {
    return new Date().toISOString().slice(0,19).replace(/[T:]/g,'-');
  }

  #download(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

export default ExportPanel;
