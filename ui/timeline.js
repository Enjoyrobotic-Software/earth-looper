/**
 * EarthOS Timeline UI — scrubber bar for time travel.
 * Shows: current time, play/pause, speed selector, date range.
 * Sits at the bottom of the screen above the status bar.
 */

import bus, { Events }              from '../core/eventBus.js';
import timeEngine, { TimeMode, PlaySpeed } from '../core/timeEngine.js';

const STYLE = `
#eos-timeline {
  position:fixed; bottom:40px; left:50%; transform:translateX(-50%);
  z-index:25; display:flex; align-items:center; gap:10px;
  background:rgba(10,14,20,0.92); border:1px solid rgba(255,255,255,0.08);
  border-radius:12px; padding:8px 14px; backdrop-filter:blur(20px);
  box-shadow:0 4px 24px rgba(0,0,0,0.5); pointer-events:auto;
  max-width:calc(100vw - 32px);
}
.tl-btn {
  background:none; border:none; color:rgba(255,255,255,0.6);
  font-size:14px; cursor:pointer; padding:0 2px; line-height:1;
  transition:color .15s; flex-shrink:0;
}
.tl-btn:hover { color:#fff; }
.tl-btn.active { color:#e8c97a; }
#tl-scrub {
  -webkit-appearance:none; appearance:none; width:160px; height:3px;
  background:rgba(255,255,255,0.12); border-radius:2px; outline:none; cursor:pointer;
  flex-shrink:0;
}
#tl-scrub::-webkit-slider-thumb {
  -webkit-appearance:none; width:12px; height:12px; border-radius:50%;
  background:#e8c97a; cursor:pointer; margin-top:-4.5px;
}
#tl-scrub::-moz-range-thumb { width:12px; height:12px; border-radius:50%; background:#e8c97a; border:none; cursor:pointer; }
#tl-scrub::-webkit-slider-runnable-track { height:3px; border-radius:2px; }
#tl-time {
  font-family:'JetBrains Mono',monospace; font-size:10px;
  color:rgba(255,255,255,0.55); letter-spacing:.04em; white-space:nowrap; flex-shrink:0;
}
#tl-time.live { color:#4caf7d; }
.tl-speed {
  background:none; border:1px solid rgba(255,255,255,0.12); border-radius:4px;
  color:rgba(255,255,255,0.5); font-family:'JetBrains Mono',monospace; font-size:9px;
  padding:3px 6px; cursor:pointer; outline:none; flex-shrink:0;
  transition:border-color .15s;
}
.tl-speed:hover { border-color:rgba(255,255,255,0.3); color:#fff; }
@media(max-width:480px){
  #eos-timeline { bottom:2px; border-radius:0; left:0; right:0; transform:none;
                  max-width:100%; border-left:none; border-right:none; }
  #tl-scrub { width:100px; }
}
`;

const RANGE_MS = 30 * 24 * 3_600_000; // 30 days window

export class TimelineUI {
  #el;
  #scrub;
  #timeLabel;
  #playBtn;
  #liveBtn;
  #speedSel;
  #dragging = false;
  #unsub    = [];

  constructor() {
    this.#inject();
  }

  init() {
    this.#scrub.addEventListener('mousedown', () => { this.#dragging = true; timeEngine.pause(); });
    this.#scrub.addEventListener('mouseup',   () => { this.#dragging = false; this.#onScrub(); });
    this.#scrub.addEventListener('input',     () => { if (this.#dragging) this.#preview(); });
    this.#scrub.addEventListener('touchstart',() => { this.#dragging = true; timeEngine.pause(); });
    this.#scrub.addEventListener('touchend',  () => { this.#dragging = false; this.#onScrub(); });

    this.#playBtn.addEventListener('click', () => {
      if (timeEngine.mode === TimeMode.LIVE || timeEngine.mode === TimeMode.PLAYBACK) {
        timeEngine.pause();
      } else {
        timeEngine.play();
      }
    });

    this.#liveBtn.addEventListener('click', () => timeEngine.goLive());

    this.#speedSel.addEventListener('change', (e) => {
      const speed = PlaySpeed[e.target.value] ?? 1;
      timeEngine.setSpeed(speed);
    });

    this.#unsub.push(bus.on(Events.TIME_CHANGED, ({ time, mode }) => this.#onTime(time, mode)));
    this.#unsub.push(bus.on(Events.TIME_PLAY,    ({ time, mode }) => this.#onTime(time, mode)));
    this.#unsub.push(bus.on(Events.TIME_PAUSE,   ({ time })       => this.#onTime(time, TimeMode.PAUSED)));

    // Start in live mode
    timeEngine.goLive();
  }

  destroy() {
    for (const u of this.#unsub) u?.();
    this.#el?.remove();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  #onTime(time, mode) {
    if (this.#dragging) return;

    const now   = Date.now();
    const pct   = Math.max(0, Math.min(1, (time - (now - RANGE_MS)) / RANGE_MS));
    this.#scrub.value = Math.round(pct * 1000);

    const d   = new Date(time);
    const str = d.toUTCString().slice(5, 22);  // "DD Mon YYYY HH:MM"

    if (mode === TimeMode.LIVE) {
      this.#timeLabel.textContent = '● LIVE  ' + str;
      this.#timeLabel.className   = 'live';
      this.#playBtn.textContent   = '⏸';
      this.#liveBtn.className     = 'tl-btn active';
    } else if (mode === TimeMode.PLAYBACK) {
      this.#timeLabel.textContent = str;
      this.#timeLabel.className   = '';
      this.#playBtn.textContent   = '⏸';
      this.#liveBtn.className     = 'tl-btn';
    } else {
      this.#timeLabel.textContent = str;
      this.#timeLabel.className   = '';
      this.#playBtn.textContent   = '▶';
      this.#liveBtn.className     = 'tl-btn';
    }
  }

  #onScrub() {
    const pct  = parseInt(this.#scrub.value) / 1000;
    const now  = Date.now();
    const ts   = (now - RANGE_MS) + pct * RANGE_MS;
    timeEngine.seek(ts);
    timeEngine.play(ts, timeEngine.speed);
  }

  #preview() {
    const pct = parseInt(this.#scrub.value) / 1000;
    const now = Date.now();
    const ts  = (now - RANGE_MS) + pct * RANGE_MS;
    this.#timeLabel.textContent = new Date(ts).toUTCString().slice(5, 22);
    this.#timeLabel.className   = '';
  }

  #inject() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.#el = document.createElement('div');
    this.#el.id = 'eos-timeline';
    this.#el.innerHTML = `
      <button class="tl-btn" id="tl-play" title="Play / Pause">⏸</button>
      <button class="tl-btn active" id="tl-live" title="Go Live">LIVE</button>
      <input type="range" id="tl-scrub" min="0" max="1000" value="1000" step="1">
      <span id="tl-time" class="live">● LIVE</span>
      <select class="tl-speed" id="tl-speed" title="Playback speed">
        ${Object.keys(PlaySpeed).map(k => `<option value="${k}">${k}</option>`).join('')}
      </select>`;
    document.body.appendChild(this.#el);

    this.#scrub     = this.#el.querySelector('#tl-scrub');
    this.#timeLabel = this.#el.querySelector('#tl-time');
    this.#playBtn   = this.#el.querySelector('#tl-play');
    this.#liveBtn   = this.#el.querySelector('#tl-live');
    this.#speedSel  = this.#el.querySelector('#tl-speed');
  }
}

export default TimelineUI;
