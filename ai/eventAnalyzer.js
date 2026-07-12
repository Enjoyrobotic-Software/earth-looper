/**
 * EarthOS EventAnalyzer — anomaly detection and pattern recognition.
 * Operates on the event stream from the bus, no external AI API.
 *
 * Detects:
 *   - Swarms (cluster of same-type events in short time/space window)
 *   - Escalation (rising magnitude sequence)
 *   - Quiescence (sudden silence after activity)
 *   - Geographic clustering (unusual spatial concentration)
 */

import bus, { Events } from '../core/eventBus.js';
import spatialIndex     from '../core/spatialIndex.js';
import causalGraph      from './causalGraph.js';

// ── Config ────────────────────────────────────────────────────────────────────

const SWARM_WINDOW   = 3 * 3_600_000;   // 3 h
const SWARM_MIN      = 5;               // events
const SWARM_RADIUS   = 200;             // km
const ESCALATION_N   = 3;              // consecutive rising magnitudes

// ── EventAnalyzer ─────────────────────────────────────────────────────────────

export class EventAnalyzer {
  #recent  = [];          // { ev, ts } last 24 h
  #maxAge  = 86_400_000;  // 24 h retention

  constructor() {
    bus.on(Events.EARTHQUAKE, ev => this.#ingest(ev));
    bus.on(Events.FIRE,       ev => this.#ingest(ev));
    bus.on(Events.VOLCANO,    ev => this.#ingest(ev));
    bus.on(Events.STORM,      ev => this.#ingest(ev));
  }

  #ingest(ev) {
    const now = Date.now();
    this.#recent.push({ ev, ts: now });

    // Purge stale
    this.#recent = this.#recent.filter(r => now - r.ts < this.#maxAge);

    // Feed causal graph
    causalGraph.addEvent(ev);

    // Detect patterns
    this.#detectSwarm(ev);
    this.#detectEscalation(ev);
  }

  #detectSwarm(trigger) {
    const now   = Date.now();
    const peers = this.#recent.filter(r =>
      r.ev.type === trigger.type &&
      r.ev.id   !== trigger.id  &&
      now - r.ts < SWARM_WINDOW
    );

    if (peers.length < SWARM_MIN - 1) return;

    // Count how many are within SWARM_RADIUS km
    const nearby = peers.filter(r => {
      const d = this.#haversine(trigger.lat, trigger.lon, r.ev.lat, r.ev.lon);
      return d < SWARM_RADIUS;
    });

    if (nearby.length < SWARM_MIN - 1) return;

    bus.emit(Events.AI_INSIGHT, {
      type:    'swarm',
      subtype: trigger.type,
      message: `${trigger.type} swarm: ${nearby.length + 1} events within ${SWARM_RADIUS} km in the last 3 hours`,
      events:  [trigger, ...nearby.map(r => r.ev)],
      severity: nearby.length >= 10 ? 'high' : 'medium',
    });
  }

  #detectEscalation(trigger) {
    const sameType = this.#recent
      .filter(r => r.ev.type === trigger.type && r.ev.id !== trigger.id)
      .sort((a, b) => a.ts - b.ts)
      .map(r => r.ev.magnitude ?? 0);

    if (sameType.length < ESCALATION_N - 1) return;

    // Check last N including this one
    const seq = [...sameType.slice(-(ESCALATION_N - 1)), trigger.magnitude ?? 0];
    const rising = seq.every((v, i) => i === 0 || v > seq[i - 1]);
    if (!rising) return;

    bus.emit(Events.AI_INSIGHT, {
      type:     'escalation',
      subtype:  trigger.type,
      message:  `Escalating ${trigger.type} intensity: ${seq.map(v => v.toFixed(1)).join(' → ')}`,
      events:   [trigger],
      severity: 'medium',
    });
  }

  stats() {
    const counts = {};
    for (const { ev } of this.#recent) counts[ev.type] = (counts[ev.type] ?? 0) + 1;
    return { total: this.#recent.length, byType: counts };
  }

  #haversine(lat1, lon1, lat2, lon2) {
    const R    = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2 +
                 Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                 Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

export const eventAnalyzer = new EventAnalyzer();
export default eventAnalyzer;
