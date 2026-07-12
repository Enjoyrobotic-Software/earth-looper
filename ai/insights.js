/**
 * EarthOS Insights — converts raw AI events into human-readable summaries.
 * Subscribes to AI_CAUSAL_CHAIN and AI_INSIGHT, formats messages,
 * and re-emits as NOTIFICATION for the UI notification system.
 */

import bus, { Events } from '../core/eventBus.js';

const SEV_MAP = {
  high:   'critical',
  medium: 'warning',
  low:    'info',
};

class InsightsEngine {
  #history = [];   // last 50 insights
  #maxHistory = 50;

  constructor() {
    bus.on(Events.AI_CAUSAL_CHAIN, data => this.#onCausalChain(data));
    bus.on(Events.AI_INSIGHT,      data => this.#onInsight(data));
  }

  #onCausalChain({ chain, edge, summary }) {
    const from = chain[0];
    const to   = chain[chain.length - 1];
    const conf = Math.round(edge.confidence * 100);

    const text = `Causal link (${conf}% confidence): ${summary}`;
    this.#emit({ text, severity: conf >= 60 ? 'warning' : 'info', source: 'causal-graph', edge });
  }

  #onInsight({ type, subtype, message, severity = 'medium', events = [] }) {
    const icon = this.#icon(subtype ?? type);
    const text = `${icon} ${message}`;
    this.#emit({ text, severity: SEV_MAP[severity] ?? 'info', source: 'analyzer', events });
  }

  #emit(insight) {
    const entry = { ...insight, id: `insight_${Date.now()}_${Math.random().toString(36).slice(2)}`, ts: Date.now() };
    this.#history.unshift(entry);
    if (this.#history.length > this.#maxHistory) this.#history.length = this.#maxHistory;
    bus.emit(Events.NOTIFICATION, entry);
  }

  #icon(type) {
    return {
      earthquake: '🌍', fire: '🔥', volcano: '🌋', storm: '🌀',
      tsunami: '🌊', conflict: '⚔️', pollution: '💨', swarm: '📡',
      escalation: '📈', causal: '🔗',
    }[type] ?? '⚠️';
  }

  recent(n = 10) { return this.#history.slice(0, n); }
}

export const insights = new InsightsEngine();
export default insights;
