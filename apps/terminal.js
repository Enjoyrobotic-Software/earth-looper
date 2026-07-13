/**
 * EarthOS Terminal — interactive REPL for EarthOS commands.
 * Commands: help, status, layers, layer <id> on|off, sources,
 *           history [n], graph, scenario <type>, clear, quit
 */

import windowManager from '../ui/windowManager.js';

const TERM_STYLE = `
.eos-term {
  background:#050a05; color:#4caf7d; font-family:'JetBrains Mono',monospace;
  font-size:12px; height:100%; display:flex; flex-direction:column; padding:0;
}
.eos-term-out {
  flex:1; overflow-y:auto; padding:10px 14px; white-space:pre-wrap;
  word-break:break-all; line-height:1.6;
}
.eos-term-row {
  display:flex; align-items:center; gap:6px; padding:7px 14px;
  border-top:1px solid rgba(76,175,61,0.15); flex-shrink:0;
}
.eos-term-prompt { color:#4caf7d; flex-shrink:0; opacity:.7; }
.eos-term-input  {
  flex:1; background:transparent; border:none; outline:none;
  color:#4caf7d; font:inherit; caret-color:#4caf7d;
}
.eos-tl-err { color:#e05555; }
.eos-tl-sys { color:#e8c97a; }
.eos-tl-cmd { color:rgba(255,255,255,0.28); }
.eos-tl-ok  { color:#81d4fa; }
`;

const BANNER = `EarthOS v5 Terminal  ·  type 'help' for commands
`;

export class TerminalApp {
  get id()   { return 'terminal'; }
  get icon() { return '💻'; }
  get name() { return 'Terminal'; }

  #out   = null;
  #input = null;
  #hist  = [];
  #hi    = -1;

  launch() {
    if (windowManager.isOpen(this.id)) {
      windowManager.isMinimized(this.id) ? windowManager.restore(this.id) : windowManager.focus(this.id);
      return;
    }

    const style = document.createElement('style');
    style.textContent = TERM_STYLE;
    document.head.appendChild(style);

    const root  = document.createElement('div');
    root.className = 'eos-term';
    const out   = document.createElement('div');
    out.className = 'eos-term-out';
    const row   = document.createElement('div');
    row.className = 'eos-term-row';
    const prom  = document.createElement('span');
    prom.className = 'eos-term-prompt';
    prom.textContent = 'earth$ ';
    const inp   = document.createElement('input');
    inp.className = 'eos-term-input';
    inp.type = 'text';
    inp.autocomplete = 'off';
    inp.spellcheck = false;

    row.append(prom, inp);
    root.append(out, row);
    this.#out = out;
    this.#input = inp;

    windowManager.create({ id: this.id, title: 'Terminal', icon: this.icon, contentEl: root, x: 100, y: 100, w: 560, h: 360 });
    this.#print(BANNER, 'sys');

    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const cmd = inp.value.trim();
        inp.value = '';
        if (cmd) { this.#hist.unshift(cmd); this.#hi = -1; this.#run(cmd); }
      } else if (e.key === 'ArrowUp') {
        this.#hi = Math.min(this.#hi + 1, this.#hist.length - 1);
        inp.value = this.#hist[this.#hi] ?? '';
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        this.#hi = Math.max(this.#hi - 1, -1);
        inp.value = this.#hi >= 0 ? (this.#hist[this.#hi] ?? '') : '';
        e.preventDefault();
      }
    });

    setTimeout(() => inp.focus(), 60);
  }

  #print(text, cls = '') {
    const line = document.createElement('div');
    if (cls) line.className = 'eos-tl-' + cls;
    line.textContent = text;
    this.#out.appendChild(line);
    this.#out.scrollTop = this.#out.scrollHeight;
  }

  #run(raw) {
    this.#print(`$ ${raw}`, 'cmd');
    const [verb, ...args] = raw.trim().split(/\s+/);
    const eos = window.EarthOS;

    switch (verb.toLowerCase()) {
      case 'help':
        this.#print([
          'Commands:',
          '  status              — system health',
          '  layers              — list all layers with state',
          '  layer <id> on|off   — toggle a layer',
          '  sources             — connected data sources',
          '  history [n]         — last N events (default 10)',
          '  graph               — causal graph node count',
          '  scenario <type>     — run scenario for latest event of type',
          '  clear               — clear terminal output',
          '  quit / exit         — close terminal',
        ].join('\n'), 'ok');
        break;

      case 'status': {
        if (!eos) { this.#print('EarthOS not ready', 'err'); break; }
        const s = eos.engine.status();
        const h = eos.historyBuffer.stats();
        this.#print(`uptime=${(s.uptime/1000).toFixed(0)}s  sources=${s.sources.length}  layers=${s.layers.length}`);
        this.#print(`history=${h.size} events  scheduler=${s.scheduler.running?'running':'stopped'}`);
        break;
      }

      case 'layers': {
        if (!eos) { this.#print('EarthOS not ready', 'err'); break; }
        for (const l of eos.engine.status().layers)
          this.#print(`  ${l.enabled ? '●' : '○'}  ${l.id.padEnd(14)} ${l.name}`);
        break;
      }

      case 'layer': {
        const [lid, toggle] = args;
        if (!lid || !['on','off'].includes(toggle)) { this.#print('usage: layer <id> on|off', 'err'); break; }
        import('../core/eventBus.js').then(m => {
          m.default.emit(m.Events.LAYER_TOGGLE, { id: lid, enabled: toggle === 'on' });
          this.#print(`layer '${lid}' → ${toggle}`, 'ok');
        });
        break;
      }

      case 'sources': {
        if (!eos) { this.#print('EarthOS not ready', 'err'); break; }
        const srcs = eos.engine.status().sources;
        this.#print(srcs.length ? srcs.join(', ') : '(none)');
        break;
      }

      case 'history': {
        if (!eos) { this.#print('EarthOS not ready', 'err'); break; }
        const n = Math.max(1, parseInt(args[0]) || 10);
        const evs = eos.historyBuffer.recent(24 * 3_600_000).slice(-n);
        if (!evs.length) { this.#print('(no events in last 24h)'); break; }
        for (const ev of evs)
          this.#print(`  [${ev.type.padEnd(12)}] M${(ev.magnitude ?? 0).toFixed(1).padStart(4)}  ${ev.lat?.toFixed(2)}, ${ev.lon?.toFixed(2)}`);
        break;
      }

      case 'graph': {
        if (!eos) { this.#print('EarthOS not ready', 'err'); break; }
        this.#print(`CausalGraph: ${eos.causalGraph.size()} nodes`, 'ok');
        break;
      }

      case 'scenario': {
        if (!eos) { this.#print('EarthOS not ready', 'err'); break; }
        const type = args[0];
        if (!type) { this.#print('usage: scenario <event_type>', 'err'); break; }
        const recent = eos.historyBuffer.recent(24 * 3_600_000, type);
        const seed   = recent[recent.length - 1];
        if (!seed) { this.#print(`no recent '${type}' events`, 'err'); break; }
        const result = eos.scenarioEngine.run(seed);
        this.#print(`seed: ${seed.type} M${seed.magnitude?.toFixed(1)} → ${result.projections.length} projections`);
        for (const p of result.projections)
          this.#print(`  → ${p.type.padEnd(13)} P=${(p.probability*100).toFixed(0)}%  lag=${(p.lagMs/3_600_000).toFixed(1)}h  depth=${p.depth}`);
        break;
      }

      case 'clear':
        this.#out.innerHTML = '';
        break;

      case 'quit':
      case 'exit':
        windowManager.close(this.id);
        break;

      default:
        this.#print(`unknown command: '${verb}'.  type 'help'`, 'err');
    }
  }
}

export default TerminalApp;
