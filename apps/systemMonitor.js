/**
 * EarthOS SystemMonitor — live dashboard: performance, sources, layers.
 * Auto-refreshes every 2 seconds while open.
 */

import windowManager from '../ui/windowManager.js';

const MON_STYLE = `
.eos-smon { height:100%; overflow-y:auto; display:flex; flex-direction:column; gap:18px; }
.eos-smon-h {
  font-family:'JetBrains Mono',monospace; font-size:10px;
  letter-spacing:.12em; text-transform:uppercase; color:rgba(255,255,255,0.30);
  margin-bottom:8px;
}
.eos-smon-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
.eos-smon-tile {
  background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07);
  border-radius:8px; padding:10px 12px;
}
.eos-smon-val  { font-size:22px; font-weight:600; color:rgba(255,255,255,0.9); line-height:1; margin-bottom:4px; }
.eos-smon-lbl  { font-size:9px; font-family:'JetBrains Mono',monospace; color:rgba(255,255,255,0.28); letter-spacing:.08em; }
.eos-smon-row  {
  display:flex; justify-content:space-between; align-items:center;
  padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:11px;
  color:rgba(255,255,255,0.72);
}
.eos-smon-dot  { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
.dot-ok        { background:#4caf7d; box-shadow:0 0 6px rgba(76,175,61,0.5); }
.dot-off       { background:rgba(255,255,255,0.18); }
.eos-smon-badge { font-family:'JetBrains Mono',monospace; font-size:10px; color:rgba(255,255,255,0.30); }
`;

export class SystemMonitorApp {
  get id()   { return 'system-monitor'; }
  get icon() { return '📊'; }
  get name() { return 'Monitor'; }

  #interval = null;

  launch() {
    if (windowManager.isOpen(this.id)) {
      windowManager.isMinimized(this.id) ? windowManager.restore(this.id) : windowManager.focus(this.id);
      return;
    }

    const style = document.createElement('style');
    style.textContent = MON_STYLE;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.className = 'eos-smon';

    windowManager.create({ id: this.id, title: 'System Monitor', icon: this.icon, contentEl: root, x: 340, y: 100, w: 480, h: 400 });

    const render = () => {
      const eos = window.EarthOS;
      if (!eos) return;
      const s   = eos.engine.status();
      const h   = eos.historyBuffer.stats();
      const mem = typeof performance !== 'undefined' && performance.memory;

      root.innerHTML = `
<div class="eos-smon-section">
  <div class="eos-smon-h">Performance</div>
  <div class="eos-smon-grid">
    <div class="eos-smon-tile">
      <div class="eos-smon-val">${(s.uptime / 1000).toFixed(0)}s</div>
      <div class="eos-smon-lbl">UPTIME</div>
    </div>
    <div class="eos-smon-tile">
      <div class="eos-smon-val">${h.size}</div>
      <div class="eos-smon-lbl">EVENTS</div>
    </div>
    <div class="eos-smon-tile">
      <div class="eos-smon-val">${mem ? (mem.usedJSHeapSize / 1_048_576).toFixed(0) + 'M' : '—'}</div>
      <div class="eos-smon-lbl">JS HEAP</div>
    </div>
  </div>
</div>

<div class="eos-smon-section">
  <div class="eos-smon-h">Sources (${s.sources.length})</div>
  ${s.sources.map(src => `
    <div class="eos-smon-row">
      <span style="display:flex;align-items:center;gap:8px">
        <span class="eos-smon-dot dot-ok"></span>${src}
      </span>
      <span class="eos-smon-badge">LIVE</span>
    </div>`).join('') || '<div style="color:rgba(255,255,255,0.2);font-size:11px;padding:4px 0">No sources connected</div>'}
</div>

<div class="eos-smon-section">
  <div class="eos-smon-h">Layers (${s.layers.length})</div>
  ${s.layers.map(l => `
    <div class="eos-smon-row">
      <span style="display:flex;align-items:center;gap:8px">
        <span class="eos-smon-dot ${l.enabled ? 'dot-ok' : 'dot-off'}"></span>
        ${l.icon ?? ''} ${l.name}
      </span>
      <span class="eos-smon-badge">${l.enabled ? 'ON' : 'OFF'}</span>
    </div>`).join('')}
</div>`;
    };

    render();
    this.#interval = setInterval(render, 2000);

    // Clean up interval when window is closed via close button
    const origClose = windowManager.close.bind(windowManager);
    windowManager.close = (id) => {
      if (id === this.id) { clearInterval(this.#interval); windowManager.close = origClose; }
      origClose(id);
    };
  }
}

export default SystemMonitorApp;
