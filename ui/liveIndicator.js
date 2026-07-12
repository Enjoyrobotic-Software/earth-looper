/**
 * EarthOS LiveIndicator — pulsing LED that flashes on every new data packet.
 * Sits in the top bar next to the clock. Green = receiving data, grey = idle.
 */

import bus, { Events } from '../core/eventBus.js';

const STYLE = `
#eos-live-dot {
  width:8px; height:8px; border-radius:50%; background:#555;
  flex-shrink:0; transition:background .1s; position:relative;
}
#eos-live-dot.pulse {
  background:#4caf7d;
  box-shadow:0 0 0 0 rgba(76,175,61,0.6);
  animation:eos-pulse .6s ease-out forwards;
}
@keyframes eos-pulse {
  0%  { box-shadow:0 0 0 0 rgba(76,175,61,0.6); }
  70% { box-shadow:0 0 0 6px rgba(76,175,61,0); }
  100%{ box-shadow:0 0 0 0 rgba(76,175,61,0);   }
}
#eos-live-dot.error { background:#e05555; }
`;

const DATA_EVENTS = [
  Events.LAYER_DATA_READY, Events.EARTHQUAKE, Events.FIRE,
  Events.STORM, Events.VOLCANO, Events.SHIP_UPDATE, Events.FLIGHT_UPDATE,
];

export class LiveIndicator {
  #dot      = null;
  #timeout  = null;
  #unsub    = [];

  constructor() {
    this.#inject();
  }

  init() {
    for (const event of DATA_EVENTS) {
      this.#unsub.push(bus.on(event, () => this.#flash()));
    }
    this.#unsub.push(bus.on(Events.SOURCE_ERROR, () => this.#error()));
    this.#unsub.push(bus.on(Events.SOURCE_CONNECTED, () => this.#ready()));
  }

  destroy() {
    for (const u of this.#unsub) u?.();
    this.#dot?.remove();
  }

  #flash() {
    if (!this.#dot) return;
    this.#dot.classList.remove('pulse', 'error');
    void this.#dot.offsetWidth;   // force reflow to restart animation
    this.#dot.classList.add('pulse');
    clearTimeout(this.#timeout);
    this.#timeout = setTimeout(() => this.#dot?.classList.remove('pulse'), 700);
  }

  #error()  { this.#dot?.classList.add('error'); }
  #ready()  { this.#dot?.classList.remove('error'); }

  #inject() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.#dot = document.createElement('div');
    this.#dot.id = 'eos-live-dot';
    this.#dot.title = 'Live data indicator';

    // Insert into #clkw (top-bar clock wrapper) before the clock text
    const clkw = document.getElementById('clkw');
    if (clkw) {
      clkw.style.display    = 'flex';
      clkw.style.alignItems = 'center';
      clkw.style.gap        = '7px';
      clkw.prepend(this.#dot);
    } else {
      document.body.appendChild(this.#dot);
    }
  }
}

export default LiveIndicator;
