/**
 * EarthOS Source: ACLED — Armed Conflict Location & Event Data
 * API: https://apidocs.acleddata.com/
 * Rate: 1h. Free API key required (register at https://acleddata.com/register/).
 * Without key: uses curated static dataset of ongoing conflicts.
 *
 * Event types: battles, explosions, protests, violence against civilians,
 *              strategic developments, riots.
 */

import { BaseSource, EarthEvent } from './base.js';
import bus, { Events }            from '../core/eventBus.js';
import scheduler, { Intervals }  from '../core/scheduler.js';
import spatialIndex               from '../core/spatialIndex.js';

const BASE = 'https://api.acleddata.com/acled/read';

// Static curated conflict zones (used when no API key)
const STATIC_CONFLICTS = [
  { id:'c_ukr', lat:49.0, lon:31.5,  n:'Ukraine War',       region:'Eastern Europe', fatalities:1000, type:'Battles',        note:'Full-scale invasion since 2022' },
  { id:'c_gaz', lat:31.4, lon:34.4,  n:'Gaza Conflict',     region:'Middle East',    fatalities:500,  type:'Battles',        note:'Israel-Hamas war since Oct 2023' },
  { id:'c_sdn', lat:15.5, lon:32.5,  n:'Sudan Civil War',   region:'Africa',         fatalities:800,  type:'Battles',        note:'SAF vs RSF since 2023' },
  { id:'c_myr', lat:19.5, lon:96.5,  n:'Myanmar Civil War', region:'Southeast Asia', fatalities:300,  type:'Battles',        note:'Resistance vs military junta' },
  { id:'c_eth', lat:9.5,  lon:40.0,  n:'Ethiopia Conflict', region:'Africa',         fatalities:200,  type:'Battles',        note:'Amhara and Oromia regions' },
  { id:'c_cod', lat:-1.5, lon:28.5,  n:'DRC Eastern',       region:'Africa',         fatalities:400,  type:'Battles',        note:'M23 and ADF groups' },
  { id:'c_som', lat:5.0,  lon:45.5,  n:'Somalia/Al-Shabaab',region:'Africa',         fatalities:150,  type:'Explosions',     note:'Al-Shabaab insurgency' },
  { id:'c_mli', lat:16.0, lon:-3.5,  n:'Mali Insurgency',   region:'Africa',         fatalities:120,  type:'Battles',        note:'Wagner and jihadist groups' },
  { id:'c_bfa', lat:12.5, lon:-2.0,  n:'Burkina Faso',      region:'Africa',         fatalities:100,  type:'Battles',        note:'JNIM and GSIM insurgencies' },
  { id:'c_yem', lat:15.5, lon:47.5,  n:'Yemen Conflict',    region:'Middle East',    fatalities:200,  type:'Battles',        note:'Houthis + Red Sea attacks' },
  { id:'c_syr', lat:35.0, lon:38.5,  n:'Syria Residual',    region:'Middle East',    fatalities:50,   type:'Battles',        note:'Post-Assad fragmentation' },
  { id:'c_irq', lat:33.5, lon:43.5,  n:'Iraq/PMF',          region:'Middle East',    fatalities:40,   type:'Explosions',     note:'Pro-Iran militia activity' },
  { id:'c_lbn', lat:33.8, lon:35.5,  n:'Lebanon/Hezbollah', region:'Middle East',    fatalities:80,   type:'Battles',        note:'Post-2024 ceasefire fragile' },
  { id:'c_moz', lat:-15.0,lon:40.5,  n:'Mozambique North',  region:'Africa',         fatalities:60,   type:'Battles',        note:'Cabo Delgado insurgency' },
  { id:'c_col', lat:5.0,  lon:-75.0, n:'Colombia ELN',      region:'Latin America',  fatalities:30,   type:'Battles',        note:'ELN guerrilla operations' },
  { id:'c_mex', lat:22.0, lon:-101.0,n:'Mexico Cartel Wars',region:'Latin America',  fatalities:90,   type:'Violence vs Civ',note:'CJNG and Sinaloa cartel wars' },
  { id:'c_ecq', lat:-1.0, lon:-78.5, n:'Ecuador Narco',     region:'Latin America',  fatalities:45,   type:'Violence vs Civ',note:'Narco violence escalation 2024' },
  { id:'c_phl', lat:7.5,  lon:124.5, n:'Philippines/NPA',   region:'Southeast Asia', fatalities:20,   type:'Battles',        note:'NPA and Abu Sayyaf' },
  { id:'c_pak', lat:32.5, lon:70.0,  n:'Pakistan/TTP',      region:'South Asia',     fatalities:80,   type:'Explosions',     note:'Tehrik-i-Taliban Pakistan' },
  { id:'c_afg', lat:33.5, lon:65.5,  n:'Afghanistan',       region:'Central Asia',   fatalities:60,   type:'Battles',        note:'Post-Taliban residual conflict' },
  { id:'c_hti', lat:18.8, lon:-72.3, n:'Haiti Gang Crisis',  region:'Caribbean',     fatalities:100,  type:'Violence vs Civ',note:'Gang control of Port-au-Prince' },
];

const TYPE_COLOR = {
  'Battles':          '#e05555',
  'Explosions':       '#ff8800',
  'Violence vs Civ':  '#d4854a',
  'Protests':         '#4a90d4',
  'Riots':            '#9c6dd4',
  'Strategic Devs':   '#4caf7d',
};

export class ACLEDSource extends BaseSource {
  #apiKey;
  #email;
  #known = new Set();

  constructor(options = {}) {
    super('acled', options);
    this.#apiKey = options.apiKey ?? null;
    this.#email  = options.email  ?? null;
  }

  async connect() {
    await super.connect();
    scheduler.register('acled:poll', () => this.run(), Intervals.WEATHER, { immediate: true });
  }

  async disconnect() {
    scheduler.unregister('acled:poll');
    await super.disconnect();
  }

  async fetch() {
    if (!this.#apiKey || !this.#email) {
      return { type: 'static', data: STATIC_CONFLICTS };
    }

    const yesterday = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const url = `${BASE}?key=${this.#apiKey}&email=${this.#email}&event_date=${yesterday}&event_date_where=%3E%3D&limit=500&fields=event_id_cnty,event_date,event_type,latitude,longitude,country,location,fatalities,notes,source`;
    return { type: 'api', data: await this.fetchJSON(url, { ttl: 3_500_000 }) };
  }

  normalize({ type, data }) {
    if (type === 'static') return this.#normalizeStatic(data);
    return this.#normalizeAPI(data);
  }

  #normalizeStatic(conflicts) {
    const events = [];
    for (const c of conflicts) {
      const ev = new EarthEvent('conflict', {
        id:    c.id,
        lat:   c.lat,
        lon:   c.lon,
        magnitude: c.fatalities,
        time:  Date.now(),
        title: c.n,
        source:'acled',
        detail: {
          region:     c.region,
          type:       c.type,
          fatalities: c.fatalities,
          note:       c.note,
          color:      TYPE_COLOR[c.type] ?? '#888',
          isStatic:   true,
        },
        ttl: 7 * 24 * 3_600_000,
      });
      events.push(ev);
      spatialIndex.layer('conflicts').update({ id: c.id, lat: c.lat, lon: c.lon, ref: ev });
    }
    bus.emit(Events.LAYER_DATA_READY, { id: 'conflicts', count: events.length, events });
    return events;
  }

  #normalizeAPI(raw) {
    const events = [];
    for (const row of raw.data ?? []) {
      const lat = parseFloat(row.latitude);
      const lon = parseFloat(row.longitude);
      if (isNaN(lat) || isNaN(lon)) continue;

      const id  = `acled_${row.event_id_cnty}`;
      const isNew = !this.#known.has(id);
      this.#known.add(id);

      const ev = new EarthEvent('conflict', {
        id, lat, lon,
        magnitude: parseInt(row.fatalities ?? 0),
        time:      new Date(row.event_date).getTime(),
        title:     `${row.event_type} — ${row.location}, ${row.country}`,
        source:    'acled',
        detail: {
          type:       row.event_type,
          country:    row.country,
          location:   row.location,
          fatalities: parseInt(row.fatalities ?? 0),
          note:       (row.notes ?? '').slice(0, 200),
          source:     row.source,
          color:      TYPE_COLOR[row.event_type] ?? '#888',
        },
        ttl: 72 * 3_600_000,
      });

      events.push(ev);
      spatialIndex.layer('conflicts').update({ id, lat, lon, ref: ev });
    }
    bus.emit(Events.LAYER_DATA_READY, { id: 'conflicts', count: events.length, events });
    return events;
  }
}

export default ACLEDSource;
