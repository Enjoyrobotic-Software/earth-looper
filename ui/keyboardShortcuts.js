/**
 * EarthOS KeyboardShortcuts — global keyboard command handler.
 *
 * Shortcuts:
 *   L        → toggle layer bar visibility
 *   S        → focus search input
 *   Esc      → close panel / clear search
 *   Space    → play/pause timeline
 *   ← / →   → step timeline ±1h
 *   0        → go LIVE
 *   1–9      → toggle layers by index
 *   ?        → show shortcuts help
 *   `        → toggle perf monitor (handled in PerfMonitor)
 */

import bus, { Events }              from '../core/eventBus.js';
import timeEngine, { TimeMode }     from '../core/timeEngine.js';
import { layerManager }              from '../core/layerManager.js';

const STYLE = `
#eos-shortcuts {
  position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
  z-index:40; background:rgba(8,12,18,0.98);
  border:1px solid rgba(255,255,255,0.1); border-radius:14px;
  padding:20px 24px; display:none; pointer-events:auto;
  backdrop-filter:blur(24px); box-shadow:0 12px 48px rgba(0,0,0,.8);
  font-family:'JetBrains Mono',monospace; min-width:260px;
}
#eos-shortcuts.open { display:block; }
.sc-title { font-size:10px; letter-spacing:.15em; text-transform:uppercase;
            color:rgba(255,255,255,0.3); margin-bottom:12px; }
.sc-row   { display:flex; justify-content:space-between; gap:16px;
            font-size:10px; color:rgba(255,255,255,0.5); padding:3px 0; }
.sc-key   { color:#e8c97a; font-size:9px; background:rgba(255,255,255,0.07);
            border-radius:3px; padding:1px 5px; flex-shrink:0; }
#eos-sc-close { margin-top:12px; text-align:center; font-size:9px;
                color:rgba(255,255,255,0.25); cursor:pointer; }
#eos-sc-close:hover { color:#fff; }
`;

const SHORTCUTS = [
  ['L',     'Toggle layer bar'],
  ['S',     'Focus search'],
  ['Esc',   'Close / clear'],
  ['Space', 'Play / Pause timeline'],
  ['←→',   'Step ±1 hour'],
  ['0',     'Go LIVE'],
  ['1–9',   'Toggle layer 1–9'],
  ['`',     'Performance monitor'],
  ['?',     'This help'],
];

export class KeyboardShortcuts {
  #el      = null;
  #visible = false;

  constructor() {
    this.#inject();
  }

  init() {
    document.addEventListener('keydown', e => this.#handle(e));
    this.#el.querySelector('#eos-sc-close').onclick = () => this.#hide();
  }

  #handle(e) {
    // Don't fire when user is typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }

    switch (e.key) {
      case 'l': case 'L': {
        const lb = document.getElementById('eos-layer-bar');
        if (lb) lb.style.display = lb.style.display === 'none' ? '' : 'none';
        break;
      }
      case 's': case 'S': {
        const si = document.getElementById('si');
        si?.focus();
        break;
      }
      case 'Escape': {
        bus.emit(Events.PANEL_CLOSE, {});
        document.getElementById('si')?.blur();
        this.#hide();
        break;
      }
      case ' ': {
        e.preventDefault();
        if (timeEngine.mode === TimeMode.PAUSED) timeEngine.play();
        else timeEngine.pause();
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        timeEngine.seek(timeEngine.now - 3_600_000);
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        timeEngine.seek(timeEngine.now + 3_600_000);
        break;
      }
      case '0': {
        timeEngine.goLive();
        break;
      }
      case '?': {
        this.#toggle();
        break;
      }
      default: {
        const n = parseInt(e.key);
        if (n >= 1 && n <= 9) {
          const layers = layerManager.all();
          const layer  = layers[n - 1];
          if (layer) layerManager.toggle(layer.id);
        }
      }
    }
  }

  #toggle() { this.#visible ? this.#hide() : this.#show(); }
  #show()   { this.#visible = true;  this.#el.classList.add('open'); }
  #hide()   { this.#visible = false; this.#el.classList.remove('open'); }

  #inject() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.#el = document.createElement('div');
    this.#el.id = 'eos-shortcuts';
    this.#el.innerHTML = `
      <div class="sc-title">Keyboard Shortcuts</div>
      ${SHORTCUTS.map(([k, d]) => `<div class="sc-row"><span class="sc-key">${k}</span><span>${d}</span></div>`).join('')}
      <div id="eos-sc-close">Press Esc or ? to close</div>`;
    document.body.appendChild(this.#el);
  }
}

export default KeyboardShortcuts;
