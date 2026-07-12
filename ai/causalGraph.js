/**
 * EarthOS CausalGraph — event relationship engine.
 * Builds a directed graph of EarthEvents and infers causal chains.
 *
 * No external AI API. Pure graph analysis:
 *   Earthquake → Tsunami → Coastal evacuation → ...
 *   Hurricane  → Refinery shutdown → Oil prices → Supply chain
 *   Volcano    → Ash cloud → Flight cancellations → ...
 *
 * Nodes  = EarthEvents
 * Edges  = CausalRelation { type, confidence, lag (ms) }
 */

import bus, { Events } from '../core/eventBus.js';
import spatialIndex     from '../core/spatialIndex.js';

// ── Causal rules ─────────────────────────────────────────────────────────────

const RULES = [
  {
    cause:   'earthquake',
    effect:  'tsunami',
    cond:    (ev) => ev.magnitude >= 7.0 && ev.depth < 70,
    lag:     [5*60_000, 60*60_000],   // 5 min – 1 h
    conf:    0.65,
    label:   'Seismic displacement may generate tsunami',
  },
  {
    cause:   'earthquake',
    effect:  'volcano',
    cond:    (ev) => ev.magnitude >= 6.0,
    spatial: 500,   // km radius
    lag:     [0, 7*24*3_600_000],
    conf:    0.25,
    label:   'Seismic activity can trigger volcanic unrest nearby',
  },
  {
    cause:   'volcano',
    effect:  'storm',
    cond:    (ev) => (ev.detail?.vei ?? 0) >= 4,
    lag:     [24*3_600_000, 30*24*3_600_000],
    conf:    0.40,
    label:   'Volcanic aerosols alter atmospheric circulation',
  },
  {
    cause:   'fire',
    effect:  'pollution',
    cond:    (ev) => (ev.detail?.frp ?? 0) > 500,
    spatial: 1000,
    lag:     [0, 72*3_600_000],
    conf:    0.80,
    label:   'Large fires generate PM2.5 plumes downwind',
  },
  {
    cause:   'storm',
    effect:  'conflict',
    cond:    (ev) => (ev.detail?.windKnots ?? 0) > 100,
    spatial: 800,
    lag:     [0, 90*24*3_600_000],
    conf:    0.20,
    label:   'Major storms can destabilize fragile regions (resource competition)',
  },
  {
    cause:   'conflict',
    effect:  'pollution',
    cond:    (ev) => (ev.detail?.fatalities ?? 0) > 100,
    spatial: 300,
    lag:     [0, 30*24*3_600_000],
    conf:    0.60,
    label:   'Armed conflict damages infrastructure, causing pollution spikes',
  },
  {
    cause:   'earthquake',
    effect:  'conflict',
    cond:    (ev) => ev.magnitude >= 6.5,
    spatial: 400,
    lag:     [0, 180*24*3_600_000],
    conf:    0.15,
    label:   'Disasters can exacerbate political instability',
  },
];

// ── Graph ─────────────────────────────────────────────────────────────────────

export class CausalGraph {
  #nodes = new Map();   // id → EarthEvent
  #edges = [];          // { from, to, rule, confidence, detected }

  constructor() {}

  addEvent(ev) {
    this.#nodes.set(ev.id, ev);
    this.#scanNewEvent(ev);
  }

  #scanNewEvent(newEv) {
    // Check if newEv could be caused by any existing event
    for (const [, existingEv] of this.#nodes) {
      if (existingEv.id === newEv.id) continue;

      for (const rule of RULES) {
        if (existingEv.type !== rule.cause) continue;
        if (newEv.type     !== rule.effect) continue;
        if (!rule.cond(existingEv)) continue;

        const timeLag = newEv.time - existingEv.time;
        if (timeLag < (rule.lag?.[0] ?? 0) || timeLag > (rule.lag?.[1] ?? Infinity)) continue;

        if (rule.spatial) {
          const dist = this.#haversine(existingEv.lat, existingEv.lon, newEv.lat, newEv.lon);
          if (dist > rule.spatial) continue;
        }

        this.#addEdge(existingEv, newEv, rule);
      }

      // Also check if existingEv could be caused by newEv (reverse — for batch loading)
      for (const rule of RULES) {
        if (newEv.type      !== rule.cause) continue;
        if (existingEv.type !== rule.effect) continue;
        if (!rule.cond(newEv)) continue;

        const timeLag = existingEv.time - newEv.time;
        if (timeLag < (rule.lag?.[0] ?? 0) || timeLag > (rule.lag?.[1] ?? Infinity)) continue;

        if (rule.spatial) {
          const dist = this.#haversine(newEv.lat, newEv.lon, existingEv.lat, existingEv.lon);
          if (dist > rule.spatial) continue;
        }

        this.#addEdge(newEv, existingEv, rule);
      }
    }
  }

  #addEdge(from, to, rule) {
    // Avoid duplicate edges
    const key = `${from.id}→${to.id}→${rule.cause}→${rule.effect}`;
    if (this.#edges.find(e => e.key === key)) return;

    const edge = {
      key,
      from:       from.id,
      to:         to.id,
      fromEvent:  from,
      toEvent:    to,
      type:       `${rule.cause}→${rule.effect}`,
      label:      rule.label,
      confidence: rule.conf,
      detected:   Date.now(),
    };

    this.#edges.push(edge);

    // Emit if high-confidence
    if (rule.conf >= 0.4) {
      bus.emit(Events.AI_CAUSAL_CHAIN, {
        chain: [from, to],
        edge,
        summary: this.#summarize(from, to, rule),
      });
    }
  }

  /** Return all causal chains that include an event */
  chainsFor(eventId) {
    return this.#edges.filter(e => e.from === eventId || e.to === eventId);
  }

  /** Return the full causal chain starting from an event (BFS) */
  downstreamChain(eventId, maxDepth = 4) {
    const visited = new Set([eventId]);
    const chain   = [];
    let frontier  = [eventId];

    for (let d = 0; d < maxDepth && frontier.length; d++) {
      const next = [];
      for (const id of frontier) {
        for (const edge of this.#edges.filter(e => e.from === id)) {
          if (!visited.has(edge.to)) {
            visited.add(edge.to);
            chain.push(edge);
            next.push(edge.to);
          }
        }
      }
      frontier = next;
    }
    return chain;
  }

  allEdges()  { return [...this.#edges]; }
  allNodes()  { return [...this.#nodes.values()]; }
  size()      { return { nodes: this.#nodes.size, edges: this.#edges.length }; }

  clear() { this.#nodes.clear(); this.#edges = []; }

  #summarize(from, to, rule) {
    const fromTitle = from.title?.slice(0, 40) ?? from.type;
    const toTitle   = to.title?.slice(0, 40)   ?? to.type;
    return `${fromTitle} → [${rule.label}] → ${toTitle} (conf: ${Math.round(rule.conf*100)}%)`;
  }

  #haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 +
              Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
}

export const causalGraph = new CausalGraph();
export default causalGraph;
