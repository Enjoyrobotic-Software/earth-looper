/**
 * EarthOS CausalChainPanel — inline SVG visualization of causal event chains.
 * Injects a chain view inside the main panel whenever a high-confidence
 * causal link is detected by ai/causalGraph.js.
 *
 * Renders: Source node → [label] → Effect node, with confidence bar.
 */

import bus, { Events } from '../core/eventBus.js';
import causalGraph      from '../ai/causalGraph.js';

const STYLE = `
#eos-causal {
  position:fixed; top:72px; left:16px; z-index:22;
  background:rgba(10,14,20,0.94); border:1px solid rgba(255,255,255,0.07);
  border-radius:10px; padding:12px 14px; width:260px;
  backdrop-filter:blur(18px); pointer-events:auto;
  box-shadow:0 4px 20px rgba(0,0,0,.5); display:none;
  font-family:'JetBrains Mono',monospace; font-size:10px; color:rgba(255,255,255,0.6);
  max-height:50vh; overflow-y:auto;
}
#eos-causal.visible { display:block; }
.cc-title { font-size:9px; letter-spacing:.12em; text-transform:uppercase;
             color:rgba(255,255,255,0.3); margin-bottom:8px; }
.cc-edge   { margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.06); }
.cc-edge:last-child { margin-bottom:0; border-bottom:none; }
.cc-nodes  { display:flex; align-items:center; gap:6px; margin-bottom:4px; }
.cc-from   { color:#e8c97a; font-size:9px; max-width:80px; overflow:hidden;
             text-overflow:ellipsis; white-space:nowrap; }
.cc-to     { color:#4a90d4; font-size:9px; max-width:80px; overflow:hidden;
             text-overflow:ellipsis; white-space:nowrap; }
.cc-arrow  { color:rgba(255,255,255,0.25); flex-shrink:0; }
.cc-label  { color:rgba(255,255,255,0.35); font-size:8px; margin-bottom:3px;
             white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cc-conf   { height:2px; background:rgba(255,255,255,0.08); border-radius:1px; }
.cc-conf-fill { height:100%; border-radius:1px; background:linear-gradient(90deg,#4caf7d,#e8c97a); }
.cc-close  { position:absolute; top:8px; right:10px; background:none; border:none;
             color:rgba(255,255,255,0.3); cursor:pointer; font-size:12px; line-height:1; }
.cc-close:hover { color:#fff; }
`;

export class CausalChainPanel {
  #el     = null;
  #body   = null;
  #unsub  = [];
  #recent = [];   // last 8 edges

  constructor() {
    this.#inject();
  }

  init() {
    this.#unsub.push(bus.on(Events.AI_CAUSAL_CHAIN, ({ edge }) => this.#onEdge(edge)));
    this.#unsub.push(bus.on(Events.EARTHQUAKE,       ev  => this.#showChain(ev)));
    this.#unsub.push(bus.on(Events.VOLCANO,          ev  => this.#showChain(ev)));
    this.#unsub.push(bus.on(Events.STORM,            ev  => this.#showChain(ev)));
  }

  destroy() {
    for (const u of this.#unsub) u?.();
    this.#el?.remove();
  }

  #onEdge(edge) {
    this.#recent.unshift(edge);
    if (this.#recent.length > 8) this.#recent.length = 8;
    this.#render();
  }

  #showChain(ev) {
    const chains = causalGraph.chainsFor(ev.id);
    if (!chains.length) return;
    for (const e of chains) {
      this.#recent.unshift(e);
    }
    if (this.#recent.length > 8) this.#recent.length = 8;
    this.#render();
  }

  #render() {
    if (!this.#recent.length) return;
    this.#body.innerHTML = this.#recent.map(e => `
      <div class="cc-edge">
        <div class="cc-nodes">
          <span class="cc-from" title="${this.#esc(e.fromEvent?.title ?? e.from)}">${this.#esc(e.fromEvent?.type ?? e.from)}</span>
          <span class="cc-arrow">→</span>
          <span class="cc-to"   title="${this.#esc(e.toEvent?.title ?? e.to)}">${this.#esc(e.toEvent?.type ?? e.to)}</span>
        </div>
        <div class="cc-label">${this.#esc(e.label ?? e.type ?? '')}</div>
        <div class="cc-conf"><div class="cc-conf-fill" style="width:${Math.round((e.confidence ?? 0)*100)}%"></div></div>
      </div>`).join('');
    this.#el.classList.add('visible');
  }

  #inject() {
    const style  = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.#el = document.createElement('div');
    this.#el.id = 'eos-causal';
    this.#el.innerHTML = `
      <button class="cc-close" id="cc-close">✕</button>
      <div class="cc-title">Causal Chains</div>
      <div id="cc-body"></div>`;
    document.body.appendChild(this.#el);

    this.#body = this.#el.querySelector('#cc-body');
    this.#el.querySelector('#cc-close').onclick = () => {
      this.#el.classList.remove('visible');
      this.#recent = [];
    };
  }

  #esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}

export default CausalChainPanel;
