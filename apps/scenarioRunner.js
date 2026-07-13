/**
 * EarthOS ScenarioRunner — GUI for the what-if scenario engine.
 * Pick a recent event as seed, run scenario, see cascading projections.
 */

import windowManager from '../ui/windowManager.js';

const SCN_STYLE = `
.eos-scn { display:flex; flex-direction:column; gap:14px; height:100%; }
.eos-scn-form { display:flex; flex-direction:column; gap:8px; flex-shrink:0; }
.eos-scn-lbl {
  font-size:9px; color:rgba(255,255,255,0.32);
  font-family:'JetBrains Mono',monospace; letter-spacing:.10em; text-transform:uppercase;
}
.eos-scn-sel {
  background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.10);
  border-radius:6px; color:rgba(255,255,255,0.82); font-family:'JetBrains Mono',monospace;
  font-size:11px; padding:6px 10px; outline:none; width:100%; cursor:pointer;
}
.eos-scn-btn {
  background:#e8c97a; border:none; border-radius:7px; color:#0b0f14;
  font-family:'JetBrains Mono',monospace; font-size:11px; font-weight:700;
  padding:9px 18px; cursor:pointer; letter-spacing:.06em; width:100%;
  transition:filter .12s; margin-top:4px;
}
.eos-scn-btn:hover { filter:brightness(1.14); }
.eos-scn-results { flex:1; overflow-y:auto; }
.eos-scn-proj {
  display:flex; justify-content:space-between; align-items:center;
  padding:7px 0; font-size:11px; color:rgba(255,255,255,0.75);
  border-bottom:1px solid rgba(255,255,255,0.06);
}
.eos-scn-bar-track { height:4px; border-radius:2px; background:rgba(255,255,255,0.06); margin-bottom:8px; }
.eos-scn-bar-fill  { height:4px; border-radius:2px; background:#e8c97a; }
.eos-scn-pct {
  font-family:'JetBrains Mono',monospace; font-size:10px;
  color:rgba(255,255,255,0.42); flex-shrink:0;
}
.eos-scn-empty { color:rgba(255,255,255,0.25); font-size:11px; padding:16px 0; }
`;

const SEED_TYPES = ['earthquake', 'volcano', 'fire', 'storm', 'conflict'];

export class ScenarioRunnerApp {
  get id()   { return 'scenario-runner'; }
  get icon() { return '🔮'; }
  get name() { return 'Scenarios'; }

  launch() {
    if (windowManager.isOpen(this.id)) {
      windowManager.isMinimized(this.id) ? windowManager.restore(this.id) : windowManager.focus(this.id);
      return;
    }

    const style = document.createElement('style');
    style.textContent = SCN_STYLE;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.className = 'eos-scn';

    // Form
    const form = document.createElement('div');
    form.className = 'eos-scn-form';
    form.innerHTML = `
      <div class="eos-scn-lbl">Seed event type</div>
      <select class="eos-scn-sel" id="eos-scn-type">
        ${SEED_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
      </select>
      <div class="eos-scn-lbl">Select from recent events</div>
      <select class="eos-scn-sel" id="eos-scn-event"><option>Loading…</option></select>
      <button class="eos-scn-btn" id="eos-scn-run">▶  Run Scenario</button>
    `;

    const results = document.createElement('div');
    results.className = 'eos-scn-results';

    root.append(form, results);

    windowManager.create({ id: this.id, title: 'Scenario Runner', icon: this.icon, contentEl: root, x: 160, y: 180, w: 400, h: 420 });

    const typeEl  = root.querySelector('#eos-scn-type');
    const eventEl = root.querySelector('#eos-scn-event');
    const runBtn  = root.querySelector('#eos-scn-run');

    const populateEvents = () => {
      const eos = window.EarthOS;
      if (!eos) return;
      const type = typeEl.value;
      const evs  = eos.historyBuffer.recent(24 * 3_600_000, type).slice(-20).reverse();
      eventEl.innerHTML = evs.length
        ? evs.map(ev => `<option>${ev.type} M${(ev.magnitude ?? 0).toFixed(1)} @ ${(ev.lat ?? 0).toFixed(1)}, ${(ev.lon ?? 0).toFixed(1)}</option>`).join('')
        : '<option disabled>No recent events</option>';
      eventEl._evs = evs;
    };

    typeEl.addEventListener('change', populateEvents);
    populateEvents();

    runBtn.addEventListener('click', () => {
      const eos  = window.EarthOS;
      if (!eos) return;
      const evs  = eventEl._evs ?? [];
      const seed = evs[eventEl.selectedIndex];
      if (!seed) { results.innerHTML = '<div class="eos-scn-empty">No event selected.</div>'; return; }

      const result = eos.scenarioEngine.run(seed);

      if (!result.projections.length) {
        results.innerHTML = '<div class="eos-scn-empty">No cascading effects projected for this event.</div>';
        return;
      }

      results.innerHTML = `<div style="font-size:10px;color:rgba(255,255,255,0.28);font-family:'JetBrains Mono',monospace;margin-bottom:10px">${result.projections.length} PROJECTED EFFECTS</div>` +
        result.projections.map(p => `
          <div class="eos-scn-proj">
            <span>${p.type} <span style="color:rgba(255,255,255,0.3)">(depth ${p.depth})</span></span>
            <span class="eos-scn-pct">${(p.probability * 100).toFixed(0)}%</span>
          </div>
          <div class="eos-scn-bar-track">
            <div class="eos-scn-bar-fill" style="width:${(p.probability * 100).toFixed(0)}%"></div>
          </div>
        `).join('');
    });
  }
}

export default ScenarioRunnerApp;
