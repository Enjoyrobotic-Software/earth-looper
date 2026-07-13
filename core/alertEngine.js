/**
 * EarthOS AlertEngine — threshold-based alerting over live event stream.
 * Default rules fire on M7+ earthquakes, FRP>2000 fires, Cat 4+ storms.
 * User rules are persisted via persistence.js.
 * Emits Events.NOTIFICATION for each triggered alert + 'alert:triggered'.
 */

import bus, { Events }  from './eventBus.js';
import persistence      from './persistence.js';

const PERSIST_KEY = 'alert_rules';

const DEFAULT_RULES = [
  { id:'eq_major',   label:'Major Earthquake',  type:'earthquake', field:'magnitude', op:'>=', value:7.0,  icon:'🔴', severity:'critical' },
  { id:'eq_strong',  label:'Strong Earthquake', type:'earthquake', field:'magnitude', op:'>=', value:6.0,  icon:'🟠', severity:'warning'  },
  { id:'fire_extreme',label:'Extreme Fire',     type:'fire',       field:'magnitude', op:'>=', value:2000, icon:'🔥', severity:'critical' },
  { id:'storm_major',label:'Major Storm',       type:'storm',      field:'magnitude', op:'>=', value:100,  icon:'🌀', severity:'warning'  },
];

function evalRule(rule, ev) {
  if (ev.type !== rule.type) return false;
  const val = ev[rule.field] ?? ev.detail?.[rule.field] ?? 0;
  switch (rule.op) {
    case '>=': return val >= rule.value;
    case '>' : return val >  rule.value;
    case '<=': return val <= rule.value;
    case '<' : return val <  rule.value;
    case '==': return val === rule.value;
    default:   return false;
  }
}

class AlertEngine {
  #rules    = [];
  #cooldown = new Map();   // ruleId → last fired timestamp
  #COOLDOWN = 5 * 60_000; // 5 min between same rule

  init() {
    // Load persisted user rules, merge with defaults
    const saved = persistence.load(PERSIST_KEY, []);
    this.#rules = [...DEFAULT_RULES, ...saved];

    // Subscribe to all event types
    const ALL = [
      Events.EARTHQUAKE, Events.FIRE, Events.VOLCANO,
      Events.STORM, Events.FLOOD, Events.TSUNAMI, Events.POLLUTION,
    ];
    for (const ev of ALL) bus.on(ev, e => this.#check(e));
  }

  #check(ev) {
    for (const rule of this.#rules) {
      if (!evalRule(rule, ev)) continue;
      const last = this.#cooldown.get(rule.id) ?? 0;
      if (Date.now() - last < this.#COOLDOWN) continue;
      this.#cooldown.set(rule.id, Date.now());
      this.#fire(rule, ev);
    }
  }

  #fire(rule, ev) {
    const text = `${rule.icon} ${rule.label}: ${ev.type} M${(ev.magnitude ?? 0).toFixed(1)} @ ${(ev.lat ?? 0).toFixed(1)}, ${(ev.lon ?? 0).toFixed(1)}`;
    bus.emit(Events.NOTIFICATION, { text, severity: rule.severity, source: 'alert', ev, rule });
    bus.emit('alert:triggered',   { rule, ev, text, time: Date.now() });
  }

  getRules()   { return [...this.#rules]; }

  addRule(rule) {
    rule.id = rule.id ?? `user_${Date.now()}`;
    this.#rules.push(rule);
    this.#saveUserRules();
    return rule;
  }

  removeRule(id) {
    this.#rules = this.#rules.filter(r => r.id !== id);
    this.#saveUserRules();
  }

  #saveUserRules() {
    const user = this.#rules.filter(r => !DEFAULT_RULES.some(d => d.id === r.id));
    persistence.save(PERSIST_KEY, user);
  }
}

export const alertEngine = new AlertEngine();
export default alertEngine;
