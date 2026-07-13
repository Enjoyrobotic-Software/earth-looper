/**
 * EarthOS Assistant App — floating chat window over the globe.
 * Powered by ai/assistant.js (rule-based NL engine, no LLM).
 */

import windowManager from '../ui/windowManager.js';
import assistant     from '../ai/assistant.js';

const AST_STYLE = `
.eos-ast {
  display:flex; flex-direction:column; height:100%;
  background:#07090e; font-family:'JetBrains Mono',monospace;
}
.eos-ast-msgs { flex:1; overflow-y:auto; padding:12px 14px; display:flex; flex-direction:column; gap:10px; }
.eos-ast-bubble {
  max-width:92%; padding:9px 13px; border-radius:10px; font-size:11px; line-height:1.55;
  white-space:pre-wrap; word-break:break-word;
}
.eos-ast-bubble.user {
  align-self:flex-end; background:rgba(232,201,122,0.15);
  border:1px solid rgba(232,201,122,0.25); color:rgba(255,255,255,0.85);
}
.eos-ast-bubble.bot {
  align-self:flex-start; background:rgba(255,255,255,0.04);
  border:1px solid rgba(255,255,255,0.08); color:rgba(255,255,255,0.72);
}
.eos-ast-bubble.bot.error { border-color:rgba(224,85,85,0.3); color:#e05555; }
.eos-ast-bubble.typing { color:rgba(255,255,255,0.28); font-style:italic; }
.eos-ast-row {
  display:flex; align-items:center; gap:8px; padding:10px 14px;
  border-top:1px solid rgba(255,255,255,0.06); flex-shrink:0;
}
.eos-ast-input {
  flex:1; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.10);
  border-radius:7px; color:rgba(255,255,255,0.85); font:inherit; font-size:11px;
  padding:7px 11px; outline:none; transition:border-color .12s;
}
.eos-ast-input:focus { border-color:rgba(232,201,122,0.4); }
.eos-ast-send {
  background:rgba(232,201,122,0.18); border:1px solid rgba(232,201,122,0.3);
  border-radius:7px; color:#e8c97a; font:inherit; font-size:13px; padding:6px 12px;
  cursor:pointer; transition:background .12s; flex-shrink:0;
}
.eos-ast-send:hover { background:rgba(232,201,122,0.28); }
.eos-ast-suggestions {
  display:flex; gap:6px; flex-wrap:wrap; padding:0 14px 10px;
}
.eos-ast-chip {
  background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08);
  border-radius:20px; font-size:10px; padding:4px 10px; cursor:pointer;
  color:rgba(255,255,255,0.45); transition:background .1s; white-space:nowrap;
}
.eos-ast-chip:hover { background:rgba(255,255,255,0.10); color:rgba(255,255,255,0.7); }
`;

const SUGGESTIONS = [
  'count earthquakes 24h',
  'recent fires 6h',
  'stats',
  'scenario earthquake',
  'show pollution',
  'help',
];

export class AssistantApp {
  get id()   { return 'assistant'; }
  get icon() { return '🌍'; }
  get name() { return 'Assistant'; }

  #msgs  = null;
  #input = null;
  #hist  = [];
  #hi    = -1;

  launch() {
    if (windowManager.isOpen(this.id)) {
      windowManager.isMinimized(this.id) ? windowManager.restore(this.id) : windowManager.focus(this.id);
      return;
    }

    const style = document.createElement('style');
    style.textContent = AST_STYLE;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.className = 'eos-ast';

    const msgs = document.createElement('div');
    msgs.className = 'eos-ast-msgs';

    const chips = document.createElement('div');
    chips.className = 'eos-ast-suggestions';
    for (const s of SUGGESTIONS) {
      const chip = document.createElement('div');
      chip.className = 'eos-ast-chip';
      chip.textContent = s;
      chip.addEventListener('click', () => this.#send(s));
      chips.appendChild(chip);
    }

    const row = document.createElement('div');
    row.className = 'eos-ast-row';
    const inp = document.createElement('input');
    inp.className = 'eos-ast-input';
    inp.type = 'text';
    inp.placeholder = 'Ask about the planet…';
    inp.autocomplete = 'off';
    inp.spellcheck = false;
    const sendBtn = document.createElement('button');
    sendBtn.className = 'eos-ast-send';
    sendBtn.textContent = '↵';
    row.append(inp, sendBtn);

    root.append(msgs, chips, row);
    this.#msgs  = msgs;
    this.#input = inp;

    windowManager.create({ id: this.id, title: 'Earth Assistant', icon: this.icon, contentEl: root, x: 60, y: 120, w: 400, h: 440 });

    // Greeting
    this.#botMsg(`Hello! I'm your EarthOS assistant.\nI can query live planet data, toggle layers, run scenarios, and more.\n\nType a command or pick a suggestion below.`);

    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const v = inp.value.trim(); if (v) { inp.value=''; this.#send(v); } }
      else if (e.key === 'ArrowUp') { this.#hi = Math.min(this.#hi + 1, this.#hist.length - 1); inp.value = this.#hist[this.#hi] ?? ''; e.preventDefault(); }
      else if (e.key === 'ArrowDown') { this.#hi = Math.max(this.#hi - 1, -1); inp.value = this.#hi >= 0 ? (this.#hist[this.#hi] ?? '') : ''; e.preventDefault(); }
    });
    sendBtn.addEventListener('click', () => { const v = inp.value.trim(); if (v) { inp.value=''; this.#send(v); } });

    setTimeout(() => inp.focus(), 60);
  }

  async #send(text) {
    this.#hist.unshift(text);
    this.#hi = -1;
    this.#userMsg(text);

    const typing = this.#typingIndicator();
    const result = await assistant.query(text);
    typing.remove();

    this.#botMsg(result.text, result.error);
  }

  #userMsg(text) {
    const el = document.createElement('div');
    el.className = 'eos-ast-bubble user';
    el.textContent = text;
    this.#msgs.appendChild(el);
    this.#scroll();
  }

  #botMsg(text, error = false) {
    const el = document.createElement('div');
    el.className = 'eos-ast-bubble bot' + (error ? ' error' : '');
    el.textContent = text;
    this.#msgs.appendChild(el);
    this.#scroll();
  }

  #typingIndicator() {
    const el = document.createElement('div');
    el.className = 'eos-ast-bubble bot typing';
    el.textContent = 'thinking…';
    this.#msgs.appendChild(el);
    this.#scroll();
    return el;
  }

  #scroll() { this.#msgs.scrollTop = this.#msgs.scrollHeight; }
}

export default AssistantApp;
