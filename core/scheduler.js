/**
 * EarthOS Scheduler — single source of truth for all polling rates.
 * Every data source registers here. No rogue setIntervals anywhere else.
 */

import bus, { Events } from './eventBus.js';

export const Intervals = Object.freeze({
  AIS:         1_000,    // 1 s   — ship positions
  OPENSKY:     5_000,    // 5 s   — flight positions
  LIGHTNING:   10_000,   // 10 s  — lightning strikes
  SATELLITES:  10_000,   // 10 s  — TLE propagation
  EARTHQUAKE:  60_000,   // 1 min — USGS
  VOLCANO:     60_000,   // 1 min — Smithsonian/VAAC
  WEATHER:     600_000,  // 10 min — NOAA
  FIRES:       900_000,  // 15 min — NASA FIRMS
  OCEAN:       3_600_000,// 1 h   — Copernicus SST
  SPACE:       86_400_000// 24 h  — NASA imagery
});

class Task {
  constructor(id, fn, interval, options = {}) {
    this.id        = id;
    this.fn        = fn;
    this.interval  = interval;
    this.enabled   = options.enabled ?? true;
    this.immediate = options.immediate ?? true;
    this.retries   = options.retries ?? 3;
    this.backoff   = options.backoff ?? 2000;
    this._timer    = null;
    this._running  = false;
    this._errors   = 0;
    this._lastRun  = null;
    this._nextRun  = null;
  }

  get status() {
    return {
      id: this.id,
      enabled: this.enabled,
      running: this._running,
      errors: this._errors,
      lastRun: this._lastRun,
      nextRun: this._nextRun,
      interval: this.interval,
    };
  }
}

class Scheduler {
  #tasks = new Map();
  #started = false;

  register(id, fn, interval, options = {}) {
    if (this.#tasks.has(id)) this.unregister(id);
    const task = new Task(id, fn, interval, options);
    this.#tasks.set(id, task);
    if (this.#started && task.enabled) this.#start(task);
    return task;
  }

  unregister(id) {
    const task = this.#tasks.get(id);
    if (!task) return;
    if (task._timer) clearTimeout(task._timer);
    this.#tasks.delete(id);
  }

  enable(id)  { this.#toggle(id, true);  }
  disable(id) { this.#toggle(id, false); }

  #toggle(id, state) {
    const task = this.#tasks.get(id);
    if (!task) return;
    task.enabled = state;
    if (!state && task._timer) { clearTimeout(task._timer); task._timer = null; }
    else if (state && this.#started) this.#start(task);
  }

  setInterval(id, ms) {
    const task = this.#tasks.get(id);
    if (!task) return;
    task.interval = ms;
    if (task._timer) { clearTimeout(task._timer); this.#schedule(task); }
  }

  start() {
    this.#started = true;
    for (const task of this.#tasks.values()) {
      if (task.enabled) this.#start(task);
    }
  }

  stop() {
    this.#started = false;
    for (const task of this.#tasks.values()) {
      if (task._timer) clearTimeout(task._timer);
      task._timer = null;
    }
  }

  runNow(id) {
    const task = this.#tasks.get(id);
    if (task) this.#run(task);
  }

  status() {
    return [...this.#tasks.values()].map(t => t.status);
  }

  #start(task) {
    if (task.immediate) this.#run(task);
    else this.#schedule(task);
  }

  #schedule(task) {
    task._nextRun = Date.now() + task.interval;
    task._timer = setTimeout(() => this.#run(task), task.interval);
  }

  async #run(task) {
    if (task._running) return;
    task._running = true;
    task._lastRun = Date.now();

    let attempt = 0;
    while (attempt <= task.retries) {
      try {
        await task.fn();
        task._errors = 0;
        break;
      } catch (e) {
        attempt++;
        task._errors++;
        console.warn(`[Scheduler] Task ${task.id} error (attempt ${attempt}):`, e.message);
        bus.emit(Events.SOURCE_ERROR, { id: task.id, error: e.message, attempt });
        if (attempt <= task.retries) {
          await new Promise(r => setTimeout(r, task.backoff * attempt));
        }
      }
    }

    task._running = false;
    if (task.enabled && this.#started) this.#schedule(task);
  }
}

export const scheduler = new Scheduler();
export default scheduler;
