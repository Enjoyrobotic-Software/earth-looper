/**
 * EarthOS Source: World Bank Open Data
 * API: https://data.worldbank.org/  (public, no key)
 * Indicators: GDP, population, CO2, renewable energy, HDI proxy
 * Rate: 24h (data is annual, refreshed yearly).
 */

import { BaseSource, EarthEvent } from './base.js';
import bus, { Events }            from '../core/eventBus.js';
import scheduler, { Intervals }  from '../core/scheduler.js';
import { COUNTRIES }              from '../config/countries.js';

const BASE = 'https://api.worldbank.org/v2/country';

const INDICATORS = {
  'NY.GDP.PCAP.PP.CD': 'gdpPerCapita',
  'SP.POP.TOTL':       'population',
  'EN.ATM.CO2E.PC':    'co2PerCapita',
  'EG.FEC.RNEW.ZS':    'renewableEnergy',
  'SI.POV.GINI':       'giniIndex',
  'SH.DYN.MORT':       'infantMortality',
  'SE.ADT.LITR.ZS':    'literacy',
  'IT.NET.USER.ZS':    'internetUsers',
};

// ISO2 → ISO3 mapping for countries in our DB
const ISO2_TO_ISO3 = {
  US:'USA',GB:'GBR',DE:'DEU',FR:'FRA',JP:'JPN',CN:'CHN',IN:'IND',BR:'BRA',
  CA:'CAN',AU:'AUS',RU:'RUS',KR:'KOR',TR:'TUR',MX:'MEX',ID:'IDN',SA:'SAU',
  NG:'NGA',AR:'ARG',ZA:'ZAF',EG:'EGY',PK:'PAK',BD:'BGD',VN:'VNM',PH:'PHL',
  UA:'UKR',PL:'POL',IT:'ITA',ES:'ESP',NL:'NLD',SE:'SWE',NO:'NOR',FI:'FIN',
  CH:'CHE',BE:'BEL',AT:'AUT',CZ:'CZE',RO:'ROU',GR:'GRC',PT:'PRT',HU:'HUN',
  DK:'DNK',IL:'ISR',IR:'IRN',IQ:'IRQ',SY:'SYR',YE:'YEM',LB:'LBN',JO:'JOR',
  QA:'QAT',KW:'KWT',OM:'OMN',AE:'ARE',TN:'TUN',DZ:'DZA',MA:'MAR',KE:'KEN',
  GH:'GHA',SN:'SEN',ET:'ETH',SD:'SDN',CD:'COD',CL:'CHL',CO:'COL',PE:'PER',
  VE:'VEN',EC:'ECU',BO:'BOL',UY:'URY',CR:'CRI',CU:'CUB',HT:'HTI',DO:'DOM',
  SG:'SGP',TH:'THA',MY:'MYS',KH:'KHM',MM:'MMR',MN:'MNG',NP:'NPL',LK:'LKA',
  KZ:'KAZ',UZ:'UZB',AZ:'AZE',AM:'ARM',GE:'GEO',MD:'MDL',BY:'BLR',RS:'SRB',
  HR:'HRV',IS:'ISL',NZ:'NZL',
};

export class WorldBankSource extends BaseSource {
  #cache = {};
  #year  = new Date().getFullYear() - 2; // WB lags 2 years

  constructor(options = {}) {
    super('worldbank', options);
  }

  async connect() {
    await super.connect();
    scheduler.register('wb:fetch', () => this.run(), Intervals.SPACE, { immediate: true });
  }

  async disconnect() {
    scheduler.unregister('wb:fetch');
    await super.disconnect();
  }

  async fetch() {
    // Fetch GDP per capita for all countries in one call
    const url = `${BASE}/all/indicator/NY.GDP.PCAP.PP.CD?format=json&date=${this.#year}&per_page=300`;
    return this.fetchJSON(url, { ttl: 86_000_000 }); // ~1 day
  }

  normalize(raw) {
    const [meta, data] = Array.isArray(raw) ? raw : [null, []];
    const enriched = {};

    for (const row of (data ?? [])) {
      if (!row.countryiso3code || row.value == null) continue;
      const iso3 = row.countryiso3code;
      enriched[iso3] = { gdpPerCapita: row.value };
    }

    // Merge with local country data
    const result = [];
    for (const [iso3, country] of Object.entries(COUNTRIES)) {
      const wb = enriched[iso3];
      if (wb) {
        const ev = new EarthEvent('economy', {
          id:    `wb_${iso3}`,
          lat:   country.lat,
          lon:   country.lon,
          magnitude: wb.gdpPerCapita,
          time:  Date.now(),
          title: `${country.n} — GDP $${Math.round(wb.gdpPerCapita).toLocaleString()}/cap`,
          source:'worldbank',
          detail: { iso3, ...wb, year: this.#year },
          ttl: 86_400_000,
        });
        result.push(ev);
        this.#cache[iso3] = { ...this.#cache[iso3], ...wb };
      }
    }

    bus.emit(Events.LAYER_DATA_READY, { id: 'gdp', count: result.length, events: result });
    return result;
  }

  getCountryData(iso3) { return this.#cache[iso3] ?? null; }
}

export default WorldBankSource;
