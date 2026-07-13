/**
 * EarthOS DataExplorer — browse and filter events from the 24h history buffer.
 */

import windowManager from '../ui/windowManager.js';

const EXP_STYLE = `
.eos-exp { display:flex; flex-direction:column; height:100%; gap:10px; }
.eos-exp-filters {
  display:flex; gap:8px; flex-wrap:wrap; align-items:center; flex-shrink:0;
}
.eos-exp-sel {
  background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.10);
  border-radius:6px; color:rgba(255,255,255,0.82); font-family:'JetBrains Mono',monospace;
  font-size:11px; padding:5px 9px; outline:none; cursor:pointer;
}
.eos-exp-count {
  font-size:10px; color:rgba(255,255,255,0.28); font-family:'JetBrains Mono',monospace;
  margin-left:auto;
}
.eos-exp-table { flex:1; overflow-y:auto; }
table.eos-ev-tbl { width:100%; border-collapse:collapse; font-size:11px; }
table.eos-ev-tbl th {
  text-align:left; padding:6px 8px; color:rgba(255,255,255,0.32);
  font-family:'JetBrains Mono',monospace; font-weight:normal; letter-spacing:.06em;
  border-bottom:1px solid rgba(255,255,255,0.08); position:sticky; top:0;
  background:rgba(10,14,20,0.98);
}
table.eos-ev-tbl td { padding:5px 8px; border-bottom:1px solid rgba(255,255,255,0.04); color:rgba(255,255,255,0.72); }
table.eos-ev-tbl tr:hover td { background:rgba(255,255,255,0.04); }
.eos-ev-badge {
  font-family:'JetBrains Mono',monospace; font-size:9px;
  padding:2px 6px; border-radius:4px; background:rgba(255,255,255,0.08);
  white-space:nowrap;
}
`;

const TYPE_ICONS = {
  earthquake:'🔴', fire:'🔥', volcano:'🌋', storm:'🌀',
  flood:'💧', pollution:'💨', conflict:'⚔️', ship:'🚢',
  satellite:'🛰️', tsunami:'🌊',
};

export class DataExplorerApp {
  get id()   { return 'data-explorer'; }
  get icon() { return '🔍'; }
  get name() { return 'Explorer'; }

  launch() {
    if (windowManager.isOpen(this.id)) {
      windowManager.isMinimized(this.id) ? windowManager.restore(this.id) : windowManager.focus(this.id);
      return;
    }

    const style = document.createElement('style');
    style.textContent = EXP_STYLE;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.className = 'eos-exp';

    const filters = document.createElement('div');
    filters.className = 'eos-exp-filters';

    const typeSelect = document.createElement('select');
    typeSelect.className = 'eos-exp-sel';
    for (const t of ['all types','earthquake','fire','volcano','storm','flood','pollution','conflict','ship','satellite'])
      typeSelect.innerHTML += `<option value="${t === 'all types' ? 'all' : t}">${t}</option>`;

    const windowSelect = document.createElement('select');
    windowSelect.className = 'eos-exp-sel';
    for (const [lbl, val] of [['1 hour','1'],['6 hours','6'],['24 hours','24'],['7 days','168']])
      windowSelect.innerHTML += `<option value="${val}">${lbl}</option>`;
    windowSelect.value = '24';

    const count = document.createElement('span');
    count.className = 'eos-exp-count';

    filters.append(typeSelect, windowSelect, count);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'eos-exp-table';

    root.append(filters, tableWrap);

    windowManager.create({ id: this.id, title: 'Data Explorer', icon: this.icon, contentEl: root, x: 180, y: 80, w: 620, h: 420 });

    const render = () => {
      const eos   = window.EarthOS;
      if (!eos) { tableWrap.innerHTML = '<div style="color:#e05555;font-size:11px">EarthOS not ready</div>'; return; }
      const hours = parseInt(windowSelect.value) || 24;
      const type  = typeSelect.value === 'all' ? null : typeSelect.value;
      const events = eos.historyBuffer.recent(hours * 3_600_000, type);
      count.textContent = `${events.length} events`;

      const rows = events.slice(-300).reverse().map(ev => `<tr>
        <td><span class="eos-ev-badge">${TYPE_ICONS[ev.type] ?? ''} ${ev.type}</span></td>
        <td>${(ev.magnitude ?? 0).toFixed(1)}</td>
        <td>${(ev.lat ?? 0).toFixed(2)}</td>
        <td>${(ev.lon ?? 0).toFixed(2)}</td>
        <td>${new Date(ev.time).toUTCString().slice(5, 22)}</td>
      </tr>`).join('');

      tableWrap.innerHTML = `<table class="eos-ev-tbl">
        <thead><tr><th>Type</th><th>Mag</th><th>Lat</th><th>Lon</th><th>Time (UTC)</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" style="color:rgba(255,255,255,0.28);text-align:center;padding:20px">No events</td></tr>'}</tbody>
      </table>`;
    };

    typeSelect.onchange   = render;
    windowSelect.onchange = render;
    render();
  }
}

export default DataExplorerApp;
