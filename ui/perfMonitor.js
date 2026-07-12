/**
 * EarthOS PerfMonitor — live FPS / memory overlay.
 * Shows FPS (exponential moving average), heap usage, and active event count.
 * Toggle with backtick key (`). Hidden by default.
 */

import bus, { Events } from '../core/eventBus.js';
import historyBuffer    from '../core/historyBuffer.js';

const STYLE = `
#eos-perf {
  position:fixed; top:52px; right:16px; z-index:30;
  background:rgba(0,0,0,0.85); border:1px solid rgba(255,255,255,0.08);
  border-radius:6px; padding:6px 10px; font-family:'JetBrains Mono',monospace;
  font-size:9px; color:rgba(255,255,255,0.5); letter-spacing:.04em;
  line-height:1.8; pointer-events:none; display:none; min-width:130px;
  backdrop-filter:blur(8px);
}
#eos-perf.visible { display:block; }
.pf-val { color:#e8c97a; }
.pf-warn { color:#f44336 !important; }
`;

export class PerfMonitor {
  #el       = null;
  #visible  = false;
  #fps      = 60;
  #last     = performance.now();
  #frames   = 0;
  #unsub    = [];
  #interval = null;

  constructor() {
    this.#inject();
  }

  init() {
    // Listen to every render frame to count FPS
    this.#unsub.push(bus.on(Events.FRAME_START, () => {
      this.#frames++;
      const now = performance.now();
      if (now - this.#last >= 1000) {
        // EMA with α=0.25
        this.#fps  = 0.75 * this.#fps + 0.25 * this.#frames;
        this.#frames = 0;
        this.#last   = now;
      }
    }));

    // Update display every 500 ms
    this.#interval = setInterval(() => this.#refresh(), 500);

    // Toggle with backtick
    document.addEventListener('keydown', e => {
      if (e.key === '`') { this.#visible = !this.#visible; this.#el.classList.toggle('visible', this.#visible); }
    });
  }

  destroy() {
    for (const u of this.#unsub) u?.();
    clearInterval(this.#interval);
    this.#el?.remove();
  }

  #refresh() {
    if (!this.#visible) return;
    const fps    = Math.round(this.#fps);
    const mem    = performance.memory?.usedJSHeapSize;
    const memMB  = mem ? (mem / 1048576).toFixed(1) : '?';
    const events = historyBuffer.size;
    const fpsWarn = fps < 30 ? ' pf-warn' : '';

    this.#el.innerHTML = `
      <div>FPS  <span class="pf-val${fpsWarn}">${fps}</span></div>
      <div>MEM  <span class="pf-val">${memMB} MB</span></div>
      <div>EVT  <span class="pf-val">${events}</span></div>
      <div style="color:rgba(255,255,255,0.2);font-size:8px;margin-top:2px">\` to toggle</div>`;
  }

  #inject() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.#el = document.createElement('div');
    this.#el.id = 'eos-perf';
    document.body.appendChild(this.#el);
  }
}

export default PerfMonitor;
