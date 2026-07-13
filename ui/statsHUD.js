/**
 * EarthOS StatsHUD — floating real-time event counters.
 * Listens to bus events and shows live counts per active layer.
 */

import bus, { Events } from '../core/eventBus.js';

const STATS = [
  { id: 'earthquakes', icon: '🔴', label: 'EQ', color: '#e05555' },
  { id: 'fires',       icon: '🔥', label: 'Fires', color: '#ff6b35' },
  { id: 'satellites',  icon: '🛰️',  label: 'Sats',  color: '#9c6dd4' },
  { id: 'flights',     icon: '✈️',  label: 'Flights', color: '#4caf7d' },
  { id: 'conflicts',   icon: '⚔️',  label: 'Events', color: '#880e4f' },
  { id: 'ocean',       icon: '🌊',  label: 'SST pts', color: '#0077b6' },
];

export class StatsHUD {
  #el      = null;
  #counts  = {};
  #enabled = {};
  #unsubs  = [];

  init() {
    this.#el = document.createElement('div');
    this.#el.id = 'eos-stats-hud';
    this.#el.style.cssText = `
      position: fixed;
      bottom: 72px;
      left: 16px;
      z-index: 15;
      display: flex;
      flex-direction: column;
      gap: 4px;
      pointer-events: none;
    `;
    document.body.appendChild(this.#el);

    // Listen for data updates
    this.#unsubs.push(bus.on(Events.LAYER_DATA_READY, ({ id, count }) => {
      if (count != null) { this.#counts[id] = count; this.#render(); }
    }));

    // Track layer enabled state
    this.#unsubs.push(bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      this.#enabled[id] = enabled;
      this.#render();
    }));

    this.#render();
  }

  #render() {
    if (!this.#el) return;
    const items = STATS.filter(s => this.#enabled[s.id] && this.#counts[s.id] > 0);
    if (!items.length) { this.#el.innerHTML = ''; return; }

    this.#el.innerHTML = items.map(s => `
      <div style="
        display: flex; align-items: center; gap: 6px;
        background: rgba(10,14,20,0.82); border: 1px solid rgba(255,255,255,0.07);
        border-left: 2px solid ${s.color}; border-radius: 4px;
        padding: 4px 10px; backdrop-filter: blur(8px);
        font-family: 'JetBrains Mono', monospace; font-size: 10px;
        color: rgba(255,255,255,0.72); letter-spacing: 0.05em;
      ">
        <span>${s.icon}</span>
        <span style="color:${s.color}; font-weight:500;">${(this.#counts[s.id] ?? 0).toLocaleString()}</span>
        <span style="color:rgba(255,255,255,0.4)">${s.label}</span>
      </div>
    `).join('');
  }

  dispose() {
    for (const u of this.#unsubs) u?.();
    this.#el?.remove();
  }
}

export default StatsHUD;
