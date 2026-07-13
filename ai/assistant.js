/**
 * EarthOS Assistant — rule-based NL query engine over live planet data.
 * No LLM needed: pattern-matches commands → queries historyBuffer / causalGraph /
 * scenarioEngine / layerManager and returns structured responses.
 */

import bus, { Events } from '../core/eventBus.js';
import historyBuffer   from '../core/historyBuffer.js';

// Keyword → layer id map
const LAYER_ALIASES = {
  earthquake:['earthquakes','earthquake','sismo','terremoto','quakes'],
  volcanoes: ['volcano','volcanoes','volcán','volcanes'],
  fires:     ['fire','fires','fuego','incendio','incendios'],
  storms:    ['storm','storms','tormenta','tormentas','hurricane','cyclone'],
  flights:   ['flight','flights','vuelos','aviones','planes'],
  ships:     ['ship','ships','barco','barcos'],
  satellites:['satellite','satellites','satélite'],
  weather:   ['weather','tiempo'],
  pollution: ['pollution','contaminación','aqi'],
  gdp:       ['economy','gdp','economía'],
  ocean:     ['ocean','sst','temperatura del mar'],
  conflicts: ['conflict','conflicts','conflicto','guerra'],
  borders:   ['border','borders','fronteras'],
  night:     ['night','noche','terminator'],
};

// Build reverse lookup: alias → canonical id
const ALIAS_MAP = {};
for (const [id, aliases] of Object.entries(LAYER_ALIASES))
  for (const a of aliases) ALIAS_MAP[a] = id;

function resolveLayer(text) {
  const t = text.toLowerCase().trim();
  if (ALIAS_MAP[t]) return ALIAS_MAP[t];
  for (const [alias, id] of Object.entries(ALIAS_MAP))
    if (t.includes(alias)) return id;
  return null;
}

function resolveHours(text) {
  const m = text.match(/(\d+)\s*h(?:our)?s?/i) || text.match(/last\s+(\d+)\s*h/i);
  if (m) return parseInt(m[1]);
  if (/today|hoy|24h/.test(text)) return 24;
  if (/week|semana|7d/.test(text)) return 168;
  if (/month|mes/.test(text)) return 720;
  return 24;
}

export class EarthAssistant {
  #handlers = [];

  constructor() {
    this.#handlers = [
      { re:/^(show|muestra|activa|enable)\s+(.+)/i,   fn: m => this.#layerOp(m[2], true)  },
      { re:/^(hide|oculta|desactiva|disable)\s+(.+)/i, fn: m => this.#layerOp(m[2], false) },
      { re:/^(count|cuántos|cuantos|how many)\s+(.+)/i, fn: m => this.#count(m[2], m[0])  },
      { re:/^(scenario|escenario)\s+(.+)/i,             fn: m => this.#scenario(m[2])      },
      { re:/^(chain|cadena|causes?)\s+(.+)/i,           fn: m => this.#chain(m[2])         },
      { re:/^(stats|estado|status)\b/i,                  fn: ()  => this.#stats()           },
      { re:/^(recent|recientes|latest|últimos)\s+(.+)/i, fn: m  => this.#recent(m[2], m[0])},
      { re:/^(focus|zoom|ir a|goto)\s+(.+)/i,           fn: m  => this.#focus(m[2])        },
      { re:/^(clear|limpiar)\s+alerts?/i,               fn: ()  => this.#clearAlerts()     },
      { re:/^help|ayuda|\?$/i,                          fn: ()  => this.#help()            },
    ];
  }

  /** Main entry: returns { text, data? } */
  async query(input) {
    const q = input.trim();
    for (const { re, fn } of this.#handlers) {
      const m = q.match(re);
      if (m) return fn(m) ?? { text: '(no result)' };
    }
    // Fallback: try to infer intent from free text
    return this.#infer(q);
  }

  #layerOp(what, enabled) {
    const id = resolveLayer(what);
    if (!id) return { text: `Unknown layer: "${what}". Try 'help' for a list.`, error: true };
    bus.emit(Events.LAYER_TOGGLE, { id, enabled });
    return { text: `Layer '${id}' ${enabled ? 'enabled' : 'disabled'}.` };
  }

  #count(what, full) {
    const hours = resolveHours(full);
    const type  = resolveLayer(what);
    const evs   = historyBuffer.recent(hours * 3_600_000, type || null);
    const label = type || 'events';
    if (!evs.length) return { text: `No ${label} in the last ${hours}h.` };

    const byType = {};
    for (const ev of evs) byType[ev.type] = (byType[ev.type] || 0) + 1;
    const breakdown = Object.entries(byType).map(([t, n]) => `  ${t}: ${n}`).join('\n');
    return {
      text: `${evs.length} ${type ? type : 'total events'} in last ${hours}h:\n${breakdown}`,
      data: { count: evs.length, byType },
    };
  }

  #scenario(what) {
    const eos  = window.EarthOS;
    if (!eos) return { text: 'EarthOS not ready.', error: true };
    const type = resolveLayer(what) ?? what.toLowerCase().trim();
    const evs  = historyBuffer.recent(24 * 3_600_000, type);
    const seed = evs[evs.length - 1];
    if (!seed) return { text: `No recent '${type}' event to use as seed.`, error: true };
    const result = eos.scenarioEngine.run(seed);
    if (!result.projections.length)
      return { text: `No cascading effects projected for ${seed.type} M${seed.magnitude?.toFixed(1)}.` };
    const lines = result.projections
      .map(p => `  → ${p.type} (${(p.probability*100).toFixed(0)}%, lag ${(p.lagMs/3_600_000).toFixed(1)}h)`)
      .join('\n');
    return { text: `Scenario for ${seed.type} M${seed.magnitude?.toFixed(1)}:\n${lines}`, data: result };
  }

  #chain(what) {
    const eos  = window.EarthOS;
    if (!eos) return { text: 'EarthOS not ready.', error: true };
    const type = resolveLayer(what) ?? what.toLowerCase().trim();
    const evs  = historyBuffer.recent(24 * 3_600_000, type);
    const seed = evs[evs.length - 1];
    if (!seed) return { text: `No recent '${type}' event found.`, error: true };
    const chain = eos.causalGraph.downstreamChain?.(seed.id, 4) ?? [];
    if (!chain.length) return { text: `No causal chain found for ${seed.type}.` };
    return {
      text: `Causal chain for ${seed.type}:\n` + chain.map(n => `  ${n.from} → ${n.to} (conf ${(n.conf*100).toFixed(0)}%)`).join('\n'),
      data: chain,
    };
  }

  #stats() {
    const eos = window.EarthOS;
    if (!eos) return { text: 'EarthOS not ready.', error: true };
    const s = eos.engine.status();
    const h = historyBuffer.stats();
    return {
      text: [
        `Uptime: ${(s.uptime/1000).toFixed(0)}s`,
        `Active sources: ${s.sources.join(', ') || 'none'}`,
        `History: ${h.size} events`,
        `Layers: ${s.layers.filter(l=>l.enabled).length}/${s.layers.length} enabled`,
        `Causal nodes: ${eos.causalGraph.size()}`,
      ].join('\n'),
    };
  }

  #recent(what, full) {
    const hours = resolveHours(full);
    const type  = resolveLayer(what);
    const evs   = historyBuffer.recent(hours * 3_600_000, type || null).slice(-5).reverse();
    if (!evs.length) return { text: `No events found.` };
    const lines = evs.map(ev =>
      `  [${ev.type}] M${(ev.magnitude??0).toFixed(1)} @ ${(ev.lat??0).toFixed(1)},${(ev.lon??0).toFixed(1)} (${new Date(ev.time).toUTCString().slice(5,17)})`
    ).join('\n');
    return { text: `Last ${evs.length} ${type ?? 'events'}:\n${lines}`, data: evs };
  }

  #focus(what) {
    bus.emit(Events.COUNTRY_SELECTED, { lat: 0, lon: 0, country: { name: what } });
    return { text: `Zooming to "${what}"…` };
  }

  #clearAlerts() {
    bus.emit('alerts:clear');
    return { text: 'All alerts cleared.' };
  }

  #help() {
    return {
      text: [
        'EarthOS Assistant commands:',
        '  show <layer>           — enable a layer',
        '  hide <layer>           — disable a layer',
        '  count <type> [24h]     — count events',
        '  recent <type> [1h]     — list latest events',
        '  scenario <type>        — run what-if scenario',
        '  chain <type>           — causal chain analysis',
        '  focus <country>        — zoom to location',
        '  stats                  — system overview',
        '  clear alerts           — dismiss all alerts',
        '',
        'Layers: earthquakes, fires, volcanoes, storms,',
        '  flights, ships, pollution, economy, ocean,',
        '  conflicts, borders, night',
      ].join('\n'),
    };
  }

  #infer(q) {
    const ql = q.toLowerCase();
    if (/earthquake|quake|sismo/.test(ql)) return this.#count('earthquakes', q);
    if (/fire|incendio/.test(ql))           return this.#count('fires', q);
    if (/volcano/.test(ql))                 return this.#count('volcanoes', q);
    if (/storm|hurricane/.test(ql))         return this.#count('storms', q);
    if (/status|estado/.test(ql))           return this.#stats();
    return { text: `I don't understand "${q}". Type 'help' for available commands.`, error: true };
  }
}

export const assistant = new EarthAssistant();
export default assistant;
