/**
 * EarthOS Service Worker — PWA offline cache.
 * Cache strategy:
 *   - Static shell (HTML, JS modules, fonts): Cache-First
 *   - API calls (USGS, OpenAQ, NOAA, etc.): Network-First with stale fallback
 *   - CDN scripts (Three.js, fonts): Cache-First, long TTL
 */

const CACHE_NAME    = 'earthos-v5-r1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/core/eventBus.js',
  '/core/scheduler.js',
  '/core/cache.js',
  '/core/spatialIndex.js',
  '/core/layerManager.js',
  '/core/engine.js',
  '/core/workerPool.js',
  '/core/timeEngine.js',
  '/core/historyBuffer.js',
  '/core/solarPosition.js',
  '/render/renderer.js',
  '/render/globe.js',
  '/render/textureManager.js',
  '/render/layers/earthquakeLayer.js',
  '/render/layers/fireLayer.js',
  '/render/layers/flightLayer.js',
  '/render/layers/shipLayer.js',
  '/render/layers/satelliteLayer.js',
  '/render/layers/volcanoLayer.js',
  '/render/layers/windLayer.js',
  '/render/layers/oceanLayer.js',
  '/render/layers/conflictLayer.js',
  '/render/layers/economyLayer.js',
  '/render/layers/borderLayer.js',
  '/render/layers/pollutionLayer.js',
  '/render/layers/nightLayer.js',
  '/ai/causalGraph.js',
  '/ai/eventAnalyzer.js',
  '/ai/insights.js',
  '/simulation/windSim.js',
  '/simulation/particleSystem.js',
  '/simulation/scenarioEngine.js',
  '/sources/base.js',
  '/sources/usgs.js',
  '/sources/eonet.js',
  '/sources/firms.js',
  '/sources/opensky.js',
  '/sources/aisstream.js',
  '/sources/tle.js',
  '/sources/noaa.js',
  '/sources/copernicus.js',
  '/sources/acled.js',
  '/sources/worldbank.js',
  '/sources/openaq.js',
  '/sources/gvp.js',
  '/ui/panel.js',
  '/ui/layerBar.js',
  '/ui/search.js',
  '/ui/notifications.js',
  '/ui/statusBar.js',
  '/ui/timeline.js',
  '/ui/causalChainPanel.js',
  '/ui/exportPanel.js',
  '/ui/countryCompare.js',
  '/ui/perfMonitor.js',
  '/ui/keyboardShortcuts.js',
  '/ui/liveIndicator.js',
  '/workers/dataWorker.js',
  '/config/countries.js',
  '/config/sources.js',
  '/manifest.json',
];

const API_ORIGINS = [
  'earthquake.usgs.gov',
  'eonet.gsfc.nasa.gov',
  'api.openaq.org',
  'api.weather.gov',
  'www.nhc.noaa.gov',
  'api.worldbank.org',
  'api.open-meteo.com',
  'firms.modaps.eosdis.nasa.gov',
];

// ── Install ───────────────────────────────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())   // don't block install on asset failures
  );
});

// ── Activate ──────────────────────────────────────────────────────────────────

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET and browser-extension requests
  if (event.request.method !== 'GET' || !url.protocol.startsWith('http')) return;

  // CDN & API: Network-First with cache fallback
  if (API_ORIGINS.some(o => url.hostname.includes(o)) || url.hostname !== self.location.hostname) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Static shell: Cache-First
  event.respondWith(cacheFirst(event.request));
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) {
      const c = await caches.open(CACHE_NAME);
      c.put(req, res.clone());
    }
    return res;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const c = await caches.open(CACHE_NAME);
      c.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    return cached ?? new Response('Offline', { status: 503 });
  }
}
