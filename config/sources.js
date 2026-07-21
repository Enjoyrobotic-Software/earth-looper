/**
 * EarthOS Source Configuration
 * Edit this file to configure API keys and data sources.
 * All keys are optional — public endpoints are used as fallback.
 */

export const SOURCE_CONFIG = {
  usgs: {
    enabled: true,
    feed:    'all_day',   // see sources/usgs.js FEEDS for options
    minMag:  2.5,
  },

  eonet: {
    enabled: true,
    days:    30,
  },

  firms: {
    enabled: true,
    apiKey:  null,  // Get free key at https://firms.modaps.eosdis.nasa.gov/api/map_key/
  },

  opensky: {
    enabled: false, // Enable to show live flights
    username: null, // Optional: register at https://opensky-network.org
    password: null,
  },

  openaq: {
    enabled: true,  // Public API, no key required
    param:   'pm25',
    country: null,  // null = global
  },

  aisstream: {
    enabled: false, // Enable to show ships
    apiKey:  null,  // Get key at https://aisstream.io
  },

  noaa: {
    enabled: true,  // Public APIs, no key required
  },

  copernicus: {
    enabled: true,  // Uses Open-Meteo marine proxy, no key required
  },

  acled: {
    enabled: true,
    apiKey:  null,  // Optional: register at https://acleddata.com/register/
    email:   null,  // Required with apiKey
  },

  worldbank: {
    enabled: true,  // Public API, no key required
  },

  gvp: {
    enabled: true,  // Smithsonian GVP + GitHub fallback, no key required
  },
};

export default SOURCE_CONFIG;
