import { initApp } from './render/app.js';

async function loadJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

async function boot() {
  const [CD, LAND_GEOJSON, BORDERS_GEOJSON] = await Promise.all([
    loadJSON('assets/data/countries.json'),
    loadJSON('assets/data/land.geojson'),
    loadJSON('assets/data/borders.geojson'),
  ]);
  initApp({ CD, LAND_GEOJSON, BORDERS_GEOJSON });
}

boot();
