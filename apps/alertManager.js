/**
 * EarthOS AlertManager — GUI to view, add, and remove alert rules.
 */

import windowManager from '../ui/windowManager.js';
import alertEngine   from '../core/alertEngine.js';

const AM_STYLE = `
.eos-am { display:flex; flex-direction:column; gap:14px; height:100%; }
.eos-am-list { flex:1; overflow-y:auto; }
.eos-am-h {
  font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:.12em;
  text-transform:uppercase; color:rgba(255,255,255,0.28); margin-bottom:8px;
}
.eos-am-rule {
  display:flex; align-items:center; gap:10px; padding:9px 0;
  border-bottom:1px solid rgba(255,255,255,0.05); font-size:11px;
}
.eos-am-rule-label { flex:1; color:rgba(255,255,255,0.75); }
.eos-am-rule-cond {
  font-family:'JetBrains Mono',monospace; font-size:10px; color:rgba(255,255,255,0.3);
}
.eos-am-del {
  background:none; border:1px solid rgba(224,85,85,0.3); border-radius:5px;
  color:#e05555; font-size:10px; padding:3px 7px; cursor:pointer; flex-shrink:0;
  transition:background .1s;
}
.eos-am-del:hover { background:rgba(224,85,85,0.12); }
.eos-am-form { border-top:1px solid rgba(255,255,255,0.07); padding-top:12px; }
.eos-am-form-row { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px; }
.eos-am-inp, .eos-am-sel {
  background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.10);
  border-radius:6px; color:rgba(255,255,255,0.82); font-family:'JetBrains Mono',monospace;
  font-size:11px; padding:6px 9px; outline:none; width:100%; cursor:pointer;
}
.eos-am-add {
  width:100%; background:rgba(76,175,61,0.12); border:1px solid rgba(76,175,61,0.3);
  border-radius:7px; color:#4caf7d; font-family:'JetBrains Mono',monospace;
  font-size:11px; padding:8px; cursor:pointer; transition:background .12s;
}
.eos-am-add:hover { background:rgba(76,175,61,0.22); }
.eos-am-sev { display:flex; align-items:center; gap:6px; font-size:11px; }
.eos-am-dot-c { width:8px;height:8px;border-radius:50%;background:#e05555;flex-shrink:0; }
.eos-am-dot-w { width:8px;height:8px;border-radius:50%;background:#e8c97a;flex-shrink:0; }
`;

const EVENT_TYPES = ['earthquake','fire','volcano','storm','flood','tsunami','pollution','conflict'];
const OPS = ['>=','>','<=','<','=='];

export class AlertManagerApp {
  get id()   { return 'alert-manager'; }
  get icon() { return '🚨'; }
  get name() { return 'Alerts'; }

  launch() {
    if (windowManager.isOpen(this.id)) {
      windowManager.isMinimized(this.id) ? windowManager.restore(this.id) : windowManager.focus(this.id);
      return;
    }

    const style = document.createElement('style');
    style.textContent = AM_STYLE;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.className = 'eos-am';

    windowManager.create({ id: this.id, title: 'Alert Manager', icon: this.icon, contentEl: root, x: 300, y: 140, w: 440, h: 460 });

    this.#render(root);
  }

  #render(root) {
    root.innerHTML = '';

    // Rule list
    const list = document.createElement('div');
    list.className = 'eos-am-list';
    list.innerHTML = `<div class="eos-am-h">Active rules</div>`;

    const rules = alertEngine.getRules();
    for (const rule of rules) {
      const row = document.createElement('div');
      row.className = 'eos-am-rule';
      row.innerHTML = `
        <span style="font-size:16px">${rule.icon ?? '⚡'}</span>
        <span class="eos-am-rule-label">${rule.label}</span>
        <span class="eos-am-rule-cond">${rule.type} ${rule.field} ${rule.op} ${rule.value}</span>
        <div class="eos-am-sev">
          <span class="${rule.severity === 'critical' ? 'eos-am-dot-c' : 'eos-am-dot-w'}"></span>
        </div>
      `;
      // Only show delete for user rules (no matching default id)
      const DEFAULT_IDS = ['eq_major','eq_strong','fire_extreme','storm_major'];
      if (!DEFAULT_IDS.includes(rule.id)) {
        const del = document.createElement('button');
        del.className = 'eos-am-del';
        del.textContent = 'Del';
        del.addEventListener('click', () => { alertEngine.removeRule(rule.id); this.#render(root); });
        row.appendChild(del);
      }
      list.appendChild(row);
    }

    // Add rule form
    const form = document.createElement('div');
    form.className = 'eos-am-form';
    form.innerHTML = `
      <div class="eos-am-h">Add rule</div>
      <div class="eos-am-form-row">
        <input  class="eos-am-inp" id="am-label"  placeholder="Label (e.g. Big quake)" />
        <select class="eos-am-sel" id="am-sev">
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
      </div>
      <div class="eos-am-form-row">
        <select class="eos-am-sel" id="am-type">
          ${EVENT_TYPES.map(t=>`<option value="${t}">${t}</option>`).join('')}
        </select>
        <input class="eos-am-inp" id="am-field" placeholder="field (e.g. magnitude)" value="magnitude" />
      </div>
      <div class="eos-am-form-row">
        <select class="eos-am-sel" id="am-op">
          ${OPS.map(o=>`<option value="${o}">${o}</option>`).join('')}
        </select>
        <input class="eos-am-inp" id="am-val" type="number" placeholder="value" step="0.1" />
      </div>
      <button class="eos-am-add" id="am-add">+ Add Rule</button>
    `;

    form.querySelector('#am-add').addEventListener('click', () => {
      const label = form.querySelector('#am-label').value.trim();
      const sev   = form.querySelector('#am-sev').value;
      const type  = form.querySelector('#am-type').value;
      const field = form.querySelector('#am-field').value.trim() || 'magnitude';
      const op    = form.querySelector('#am-op').value;
      const val   = parseFloat(form.querySelector('#am-val').value);
      if (!label || isNaN(val)) return;
      alertEngine.addRule({ label, severity: sev, type, field, op, value: val, icon: '⚡' });
      this.#render(root);
    });

    root.append(list, form);
  }
}

export default AlertManagerApp;
