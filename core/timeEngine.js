/**
 * EarthOS TimeEngine — master clock for the entire system.
 * Controls: live mode, historical playback, scrubbing, speed.
 * Every data source and renderer reads time from here.
 */

import bus, { Events } from './eventBus.js';

export const TimeMode = Object.freeze({
  LIVE:       'live',
  PLAYBACK:   'playback',
  PAUSED:     'paused',
});

export const PlaySpeed = Object.freeze({
  '1x':    1,
  '10x':   10,
  '60x':   60,
  '1h/s':  3600,
  '1d/s':  86400,
  '1w/s':  604800,
});

class TimeEngine {
  #mode      = TimeMode.LIVE;
  #current   = Date.now();
  #speed     = 1;
  #stepMs    = 100;         // wall-clock ms between sim steps in playback
  #timer     = null;
  #listeners = new Set();

  constructor() {
    this.MIN = new Date('2000-01-01').getTime();
    this.MAX = Date.now() + 30 * 24 * 3_600_000; // 30 days ahead for sats
  }

  // ── Public API ───────────────────────────────────────────────────────────

  get now()   { return this.#current; }
  get mode()  { return this.#mode; }
  get speed() { return this.#speed; }
  get isLive(){ return this.#mode === TimeMode.LIVE; }
  get date()  { return new Date(this.#current); }

  /** Switch to live mode (follow wall clock) */
  goLive() {
    this.#stop();
    this.#mode    = TimeMode.LIVE;
    this.#current = Date.now();
    this.#liveLoop();
    bus.emit(Events.TIME_PLAY, { mode: TimeMode.LIVE, time: this.#current });
  }

  /** Start playback from a specific timestamp */
  play(fromTs = this.#current, speed = this.#speed) {
    this.#stop();
    this.#mode    = TimeMode.PLAYBACK;
    this.#current = Math.max(this.MIN, Math.min(this.MAX, fromTs));
    this.#speed   = speed;
    this.#playLoop();
    bus.emit(Events.TIME_PLAY, { mode: TimeMode.PLAYBACK, time: this.#current, speed });
  }

  pause() {
    this.#stop();
    this.#mode = TimeMode.PAUSED;
    bus.emit(Events.TIME_PAUSE, { time: this.#current });
  }

  seek(ts) {
    this.#current = Math.max(this.MIN, Math.min(this.MAX, ts));
    bus.emit(Events.TIME_SEEK, { time: this.#current });
    bus.emit(Events.TIME_CHANGED, { time: this.#current, mode: this.#mode });
  }

  setSpeed(speed) {
    this.#speed = speed;
    if (this.#mode === TimeMode.PLAYBACK) { this.#stop(); this.#playLoop(); }
    bus.emit(Events.TIME_CHANGED, { time: this.#current, mode: this.#mode, speed });
  }

  step(deltaMs) {
    this.seek(this.#current + deltaMs);
  }

  // ── Loops ────────────────────────────────────────────────────────────────

  #liveLoop() {
    this.#timer = setInterval(() => {
      this.#current = Date.now();
      bus.emit(Events.TIME_CHANGED, { time: this.#current, mode: TimeMode.LIVE });
    }, 1000);
  }

  #playLoop() {
    const simDt = this.#stepMs * this.#speed;
    this.#timer = setInterval(() => {
      this.#current += simDt;
      if (this.#current >= this.MAX) { this.pause(); return; }
      bus.emit(Events.TIME_CHANGED, { time: this.#current, mode: TimeMode.PLAYBACK, speed: this.#speed });
    }, this.#stepMs);
  }

  #stop() {
    if (this.#timer) { clearInterval(this.#timer); this.#timer = null; }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  format(ts = this.#current, opts = {}) {
    return new Date(ts).toLocaleString('es-ES', {
      year:'numeric', month:'short', day:'numeric',
      hour:'2-digit', minute:'2-digit', timeZone:'UTC', timeZoneName:'short',
      ...opts
    });
  }

  iso(ts = this.#current) { return new Date(ts).toISOString(); }

  /** Return USGS-compatible time range string */
  usgsRange(windowMs = 24 * 3_600_000) {
    const end   = new Date(this.#current);
    const start = new Date(this.#current - windowMs);
    return { starttime: start.toISOString().slice(0,19), endtime: end.toISOString().slice(0,19) };
  }
}

export const timeEngine = new TimeEngine();
export default timeEngine;
