/**
 * EarthOS TextureManager — lazy-loads and caches globe textures.
 * Serves textures from local assets/ with CDN fallback.
 *
 * Supported textures:
 *   earth_day      — daytime surface map
 *   earth_night    — city lights / night map
 *   earth_specular — specular (ocean shininess) map
 *   earth_normal   — normal map for terrain bump
 *   earth_clouds   — cloud layer
 *
 * If local files are absent, falls back to a freely-licensed CDN version.
 * All textures are reused via a shared THREE.TextureLoader.
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';

const LOCAL_BASE = './assets/';
const CDN_BASE   = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/textures/';

const TEXTURE_MAP = {
  earth_day:      { local:'earth_atmos_2048.jpg',  cdn:'land_ocean_ice_lights_2048.jpg',  fallbackColor: 0x2233aa },
  earth_night:    { local:'earth_night_2048.jpg',  cdn:'mars_1k_color.jpg',               fallbackColor: 0x000510 },
  earth_specular: { local:'earth_specular_2048.jpg', cdn:null,                            fallbackColor: 0x111122 },
  earth_normal:   { local:'earth_normal_2048.jpg',   cdn:null,                            fallbackColor: 0x8080ff },
  earth_clouds:   { local:'earth_clouds_2048.png',   cdn:'disturb.jpg',                   fallbackColor: 0xffffff },
};

const loader = new THREE.TextureLoader();
const cache  = new Map();

function loadTexture(src) {
  if (cache.has(src)) return cache.get(src);
  const p = new Promise((resolve, reject) => loader.load(src, resolve, undefined, reject));
  cache.set(src, p);
  return p;
}

export async function getTexture(name) {
  const def = TEXTURE_MAP[name];
  if (!def) throw new Error(`Unknown texture: ${name}`);

  // Try local first
  try {
    return await loadTexture(LOCAL_BASE + def.local);
  } catch {}

  // Try CDN
  if (def.cdn) {
    try { return await loadTexture(CDN_BASE + def.cdn); } catch {}
  }

  // Fallback: 1×1 solid-color texture
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = `#${def.fallbackColor.toString(16).padStart(6,'0')}`;
  ctx.fillRect(0,0,1,1);
  return new THREE.CanvasTexture(canvas);
}

export async function preloadAll() {
  return Promise.allSettled(Object.keys(TEXTURE_MAP).map(k => getTexture(k)));
}

export default { getTexture, preloadAll };
