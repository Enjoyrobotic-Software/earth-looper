/**
 * EarthOS ScenarioEngine — "what if?" simulation runner.
 * Lets users inject a synthetic EarthEvent and propagates it through
 * the causal graph to compute predicted downstream effects.
 *
 * API:
 *   scenarioEngine.run(seed)     → Promise<ScenarioResult>
 *   scenarioEngine.clear()
 *
 * A seed is a partial EarthEvent: { type, lat, lon, magnitude, time?, detail? }
 * The engine clones the current causal graph, inserts the seed, and
 * performs BFS on the RULES to project likely effects with probability decay.
 */

import bus, { Events }  from '../core/eventBus.js';
import causalGraph       from '../ai/causalGraph.js';

// Import rules directly from causalGraph module
// We re-declare them here to avoid coupling to private class internals.
const PROJECTION_RULES = [
  { cause:'earthquake', effect:'tsunami',   cond:ev=>ev.magnitude>=7.0 && (ev.detail?.depth??99)<70, conf:0.65, lag:30*60_000 },
  { cause:'earthquake', effect:'volcano',   cond:ev=>ev.magnitude>=6.0, conf:0.25, lag:3*24*3_600_000, spatial:500 },
  { cause:'volcano',    effect:'storm',     cond:ev=>(ev.detail?.vei??0)>=4, conf:0.40, lag:7*24*3_600_000 },
  { cause:'fire',       effect:'pollution', cond:ev=>(ev.detail?.frp??0)>500, conf:0.80, lag:12*3_600_000, spatial:1000 },
  { cause:'storm',      effect:'conflict',  cond:ev=>(ev.detail?.windKnots??0)>100, conf:0.20, lag:30*24*3_600_000, spatial:800 },
  { cause:'conflict',   effect:'pollution', cond:ev=>(ev.detail?.fatalities??0)>100, conf:0.60, lag:15*24*3_600_000, spatial:300 },
  { cause:'earthquake', effect:'conflict',  cond:ev=>ev.magnitude>=6.5, conf:0.15, lag:90*24*3_600_000, spatial:400 },
];

const MAX_DEPTH = 5;
const MIN_PROB  = 0.05;

function haversine(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

class ScenarioEngine {
  #active = null;

  /**
   * Run a what-if scenario from a seed event.
   * @param {Object} seed  Partial EarthEvent
   * @returns {ScenarioResult} { seed, projections: [{ type, lat, lon, probability, lagMs, rule }] }
   */
  run(seed) {
    const root = {
      id:        `scenario_seed_${Date.now()}`,
      type:      seed.type,
      lat:       seed.lat,
      lon:       seed.lon,
      magnitude: seed.magnitude ?? 0,
      time:      seed.time ?? Date.now(),
      detail:    seed.detail ?? {},
    };

    const projections = [];
    const queue       = [{ ev: root, depth: 0, probChain: 1 }];

    while (queue.length) {
      const { ev, depth, probChain } = queue.shift();
      if (depth >= MAX_DEPTH) continue;

      for (const rule of PROJECTION_RULES) {
        if (ev.type !== rule.cause)  continue;
        if (!rule.cond(ev))          continue;

        const prob = probChain * rule.conf;
        if (prob < MIN_PROB) continue;

        // Estimate effect location: same point or slightly offset
        const effectLat = ev.lat + (Math.random() - 0.5) * (rule.spatial ? Math.min(rule.spatial/111, 5) : 1);
        const effectLon = ev.lon + (Math.random() - 0.5) * (rule.spatial ? Math.min(rule.spatial/111, 5) : 1);

        const projection = {
          type:        rule.effect,
          lat:         effectLat,
          lon:         effectLon,
          probability: prob,
          lagMs:       rule.lag ?? 0,
          estimatedAt: root.time + (rule.lag ?? 0),
          rule:        `${rule.cause}→${rule.effect}`,
          fromType:    ev.type,
          depth,
        };

        projections.push(projection);

        // Continue chain
        const nextEv = {
          id: `scenario_proj_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          type: rule.effect,
          lat: effectLat, lon: effectLon,
          magnitude: ev.magnitude * 0.7,
          time: root.time + (rule.lag ?? 0),
          detail: {},
        };
        queue.push({ ev: nextEv, depth: depth + 1, probChain: prob });
      }
    }

    projections.sort((a, b) => b.probability - a.probability);
    const result = { seed: root, projections };
    this.#active = result;

    bus.emit(Events.SCENARIO_RESULT, result);
    return result;
  }

  clear() {
    this.#active = null;
    bus.emit(Events.SCENARIO_CLEAR, {});
  }

  get active() { return this.#active; }
}

export const scenarioEngine = new ScenarioEngine();
export default scenarioEngine;
