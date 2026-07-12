import { eventBus } from '../core/eventBus.js';
import { scheduler } from '../core/scheduler.js';
import { LAYERS, toHex } from '../layers/layers.js';
import { NewsSource } from '../sources/newsSource.js';

// === FEATURE STUBS (available immediately for onclick) ===
window.toggleArcs = function () { window._f && window._f.toggleArcs(); };
window.toggleHeatmap = function () { window._f && window._f.toggleHeatmap(); };
window.toggleAlliancePanel = function () { window._f && window._f.toggleAlliancePanel(); };
window.toggleAlliance = function (n, v) { window._f && window._f.toggleAlliance(n, v); };
window.toggleTimeline = function () { window._f && window._f.toggleTimeline(); };
window.playTimeline = function () { window._f && window._f.playTimeline(); };
window.toggleAudio = function () { window._f && window._f.toggleAudio(); };
window.enterCompareMode = function (iso) { window._f && window._f.enterCompareMode(iso); };
window.closeCompare = function () { window._f && window._f.closeCompare(); };
// === END STUBS ===

let curLayer = 'conflict';

// Boots the whole globe/UI experience. CD, LAND_GEOJSON and BORDERS_GEOJSON
// are loaded as external assets by main.js and handed in here instead of
// being embedded in the script (they used to be ~250KB of inline JSON/base64).
export function initApp({ CD, LAND_GEOJSON, BORDERS_GEOJSON }) {

  // ══════════════════════════════════════════════════
  // THREE.JS SCENE
  // ══════════════════════════════════════════════════
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, .1, 500);
  camera.position.z = 2.9;

  // Stars — subtle, not the main event
  const sN = 6000, sPts = new Float32Array(sN * 3);
  for (let i = 0; i < sN * 3; i++) sPts[i] = (Math.random() - .5) * 250;
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPts, 3));
  scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0xffffff, size: .12, transparent: true, opacity: .55, sizeAttenuation: true })));

  // ── GLOBE — NASA textures, loaded from assets/textures ──
  const tLoader = new THREE.TextureLoader();
  const dayTex = tLoader.load('assets/textures/earth_day.jpg');
  const bumpTex = tLoader.load('assets/textures/earth_bump.png');
  const specTex = tLoader.load('assets/textures/earth_spec.png');
  const nightTex = tLoader.load('assets/textures/earth_night.png');

  const globeMat = new THREE.MeshPhongMaterial({
    map: dayTex,
    bumpMap: bumpTex, bumpScale: 0.12,    // deeper relief
    specularMap: specTex,
    specular: new THREE.Color(0.28, 0.50, 1.0),  // ocean sparkle
    shininess: 55,                             // tighter specular
    reflectivity: 0.4,
  });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 128), globeMat);
  scene.add(globe);

  // Night lights — only visible in Earth's shadow
  const nightMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: nightTex }, uSun: { value: new THREE.Vector3(5, 3, 4).normalize() } },
    vertexShader: `
    varying vec2 vUv; varying vec3 vN;
    void main(){ vUv=uv; vN=normalize(normalMatrix*normal);
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `
    uniform sampler2D uTex; uniform vec3 uSun;
    varying vec2 vUv; varying vec3 vN;
    void main(){
      float sun=dot(vN,uSun);
      float dark=smoothstep(0.05,-0.20,sun);
      vec3 c=texture2D(uTex,vUv).rgb;
      gl_FragColor=vec4(c*1.8, dark*(c.r+c.g+c.b)*1.6);
    }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
  });
  const nightMesh = new THREE.Mesh(new THREE.SphereGeometry(1.001, 128, 128), nightMat);
  scene.add(nightMesh);

  // Clouds — procedural bands
  const cCv = document.createElement('canvas'); cCv.width = 2048; cCv.height = 1024;
  const cCtx = cCv.getContext('2d');
  [[.12, 70], [.35, 90], [.52, 100], [.68, 85], [.88, 60]].forEach(([y, n]) => {
    for (let i = 0; i < n; i++) {
      const cx = Math.random() * 2048, cy = (y + (Math.random() - .5) * .1) * 1024;
      const rx = 50 + Math.random() * 150, ry = 9 + Math.random() * 25;
      const a = .035 + Math.random() * .065;
      const g = cCtx.createRadialGradient(cx, cy, 0, cx, cy, rx);
      g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      cCtx.fillStyle = g; cCtx.beginPath();
      cCtx.ellipse(cx, cy, rx, ry, (Math.random() - .5) * .7, 0, Math.PI * 2); cCtx.fill();
    }
  });
  const cloudMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.005, 64, 64),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(cCv),
      transparent: true, opacity: .32,
      blending: THREE.AdditiveBlending, depthWrite: false
    })
  );
  scene.add(cloudMesh);

  // ── ATMOSPHERE — dual layer Rayleigh scatter ──
  // Outer halo (wide, blue limbo)
  const atmOuter = new THREE.ShaderMaterial({
    uniforms: { uCam: { value: camera.position }, uSun: { value: new THREE.Vector3(5, 3, 4).normalize() } },
    vertexShader: `
    uniform vec3 uCam;
    varying float vFresnel;
    varying vec3 vWorldNormal;
    void main(){
      vec3 wn = normalize((modelMatrix * vec4(normal,0.)).xyz);
      vec3 wv = normalize(uCam - (modelMatrix*vec4(position,1.)).xyz);
      vFresnel = pow(1.0 - abs(dot(wn,wv)), 4.5);
      vWorldNormal = wn;
      gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.);
    }`,
    fragmentShader: `
    uniform vec3 uSun;
    varying float vFresnel;
    varying vec3 vWorldNormal;
    void main(){
      // Rayleigh: blue at zenith, orange near horizon toward sun
      float sunAngle = max(0., dot(vWorldNormal, uSun));
      vec3 dayCol = mix(vec3(.10,.38,.80), vec3(.55,.65,.90), sunAngle*.4);
      vec3 limboCol = mix(dayCol, vec3(.72,.42,.14), pow(sunAngle,.3)*.35);
      float alpha = vFresnel * .75;
      gl_FragColor = vec4(limboCol, alpha);
    }`,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.10, 64, 64), atmOuter));

  // Inner glow (tight blue rim)
  const atmInner = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
    varying float vI;
    void main(){
      vec3 n=normalize(normalMatrix*normal);
      vec3 v=normalize(-( modelViewMatrix*vec4(position,1.)).xyz);
      vI=pow(1.-abs(dot(n,v)),6.);
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
    }`,
    fragmentShader: `
    varying float vI;
    void main(){ gl_FragColor=vec4(.15,.50,.95,vI*.6); }`,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.035, 64, 64), atmInner));

  // Update sun direction in render (declared here for access)
  const atmSunDir = new THREE.Vector3(5, 3, 4).normalize();

  // ── LIGHTING ──
  scene.add(new THREE.AmbientLight(0x0d1f3c, .45));          // deep space ambient
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);     // warm sun
  sun.position.set(5, 3, 4); scene.add(sun);
  const fill = new THREE.DirectionalLight(0x1a3a6a, .30);    // blue fill (space)
  fill.position.set(-4, -2, -3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0x7090c0, .15);     // cold rim from back
  rim.position.set(-1, 0, -5); scene.add(rim);

  // ── LAT/LON → 3D ──
  function ll3(lat, lon, r) {
    const phi = (90 - lat) * Math.PI / 180, th = (lon + 180) * Math.PI / 180;
    return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
  }

  // ── MARKERS ──
  const mkG = new THREE.Group(); scene.add(mkG);
  const markers = [];

  function mkMarkers() {
    mkG.clear(); markers.length = 0;
    Object.entries(CD).forEach(([iso, d]) => {
      const rgb = LAYERS[curLayer](d);
      const col = new THREE.Color(...rgb);
      const pos = ll3(d.lat, d.lon, 1.012);
      const dir = pos.clone().normalize();

      // Ring
      const rM = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: .7 });
      const ring = new THREE.Mesh(new THREE.RingGeometry(.011, .02, 32), rM);
      ring.position.copy(pos); ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);

      // Dot
      const dM = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide });
      const dot = new THREE.Mesh(new THREE.CircleGeometry(.0065, 16), dM);
      dot.position.copy(pos); dot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);

      // Spike — conflict only
      if (d.s === 'conflict') {
        const h = .065, sM = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .5 });
        const spike = new THREE.Mesh(new THREE.CylinderGeometry(0, .0035, h, 8), sM);
        spike.position.copy(pos.clone().add(dir.clone().multiplyScalar(h * .5)));
        spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        mkG.add(spike);
      }
      mkG.add(ring, dot);
      markers.push({ iso, d, ring, dot, pos, ph: Math.random() * Math.PI * 2, rgb });
    });
  }
  mkMarkers();

  // Layer changes now flow through the event bus instead of being called
  // directly from the click handler, so anything else (stats, AI, future
  // layers) can react without the click handler needing to know about it.
  eventBus.on('layer:changed', ({ layer }) => {
    curLayer = layer;
    mkMarkers();
  });

  // ── CONTROLS ──
  let drag = false, prev = { x: 0, y: 0 }, tRY = .5, tRX = 0, rY = .5, rX = 0;
  const DAMP = .07;

  canvas.addEventListener('mousedown', e => { drag = true; prev = { x: e.clientX, y: e.clientY } });
  window.addEventListener('mousemove', e => { if (!drag) return; tRY += (e.clientX - prev.x) * .005; tRX = Math.max(-1.2, Math.min(1.2, tRX + (e.clientY - prev.y) * .004)); prev = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('mouseup', () => drag = false);
  canvas.addEventListener('wheel', e => { camera.position.z = Math.max(1.5, Math.min(6, camera.position.z + e.deltaY * .003)); e.preventDefault(); }, { passive: false });

  // ── TOUCH: 1 finger=rotate | 2 fingers=pinch zoom ──
  // touch-action:none on canvas (CSS) prevents browser scroll interference
  let t0 = null, pinch0 = null;

  function getTouches(e) { return Array.from(e.touches); }
  function midpt(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }
  function dst(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }

  canvas.addEventListener('touchstart', e => {
    const ts = getTouches(e);
    if (ts.length === 1) {
      t0 = { x: ts[0].clientX, y: ts[0].clientY };
      pinch0 = null;
    } else if (ts.length >= 2) {
      pinch0 = { dist: dst(ts[0], ts[1]), z: camera.position.z, mid: midpt(ts[0], ts[1]) };
      t0 = null;
    }
  }, { passive: true }); // passive OK on start — we only preventDefault on move

  canvas.addEventListener('touchmove', e => {
    e.preventDefault(); // must prevent default to stop page scroll/zoom
    const ts = getTouches(e);
    if (ts.length === 1 && t0) {
      const dx = ts[0].clientX - t0.x, dy = ts[0].clientY - t0.y;
      tRY += dx * .005;
      tRX = Math.max(-1.2, Math.min(1.2, tRX + dy * .004));
      t0 = { x: ts[0].clientX, y: ts[0].clientY };
    } else if (ts.length >= 2 && pinch0) {
      const d = dst(ts[0], ts[1]);
      const m = midpt(ts[0], ts[1]);
      // Pinch zoom
      camera.position.z = Math.max(1.4, Math.min(6, pinch0.z / (d / pinch0.dist)));
      // Two-finger pan rotates globe
      tRY += (m.x - pinch0.mid.x) * .003;
      tRX = Math.max(-1.2, Math.min(1.2, tRX + (m.y - pinch0.mid.y) * .003));
      pinch0 = { dist: d, z: camera.position.z, mid: m }; // update each frame
    }
  }, { passive: false }); // NON-passive so preventDefault works

  canvas.addEventListener('touchend', e => {
    const ts = getTouches(e);
    if (ts.length === 0) { t0 = null; pinch0 = null; }
    else if (ts.length === 1) {
      t0 = { x: ts[0].clientX, y: ts[0].clientY };
      pinch0 = null;
    }
  }, { passive: true });

  // Click / tap detection
  let clickStart = { x: 0, y: 0 }, clickTime = 0;
  canvas.addEventListener('pointerdown', e => { clickStart = { x: e.clientX, y: e.clientY }; clickTime = Date.now(); });
  canvas.addEventListener('pointerup', e => {
    if (Date.now() - clickTime > 300) return;
    if (Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y) > 10) return;
    handleTap(e);
  });

  function handleTap(e) {
    let best = null, bestD = Infinity;
    markers.forEach(m => {
      const wp = m.pos.clone(); globe.localToWorld(wp);
      const sp = wp.clone().project(camera);
      const sx = (sp.x * .5 + .5) * innerWidth, sy = (1 - (sp.y * .5 + .5)) * innerHeight;
      const dist = Math.hypot(e.clientX - sx, e.clientY - sy);
      if (dist < 34 && dist < bestD) { bestD = dist; best = m; }
    });
    if (best) openCard(e, best);
    else closeAll();
  }

  // ══════════════════════════════════════════════════
  // VISUAL MODE — toggle Real (NASA textures) ↔ Procedural (v1 shader)
  // ══════════════════════════════════════════════════

  // Procedural globe shader (v1 style)
  const _procVS = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPos;
  void main(){
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPos = (modelViewMatrix * vec4(position,1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
  }`;

  const _procFS = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPos;
  uniform vec3  uSunDir;
  uniform float uTime;
  uniform sampler2D uLandMask;   // real GeoJSON land mask
  uniform sampler2D uBiomeTex;   // pre-baked biome colors

  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){
    vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
               mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
  }
  float fbm(vec2 p){
    float v=0.,a=.5;
    for(int i=0;i<5;i++){v+=a*noise(p);p*=2.1;a*=.5;}
    return v;
  }

  void main(){
    float lat = (vUv.y - .5) * 180.;

    // ── Land mask from real GeoJSON canvas texture ──
    float landMask = texture2D(uLandMask, vUv).r;
    // Slight edge softening
    landMask = smoothstep(0.15, 0.55, landMask);

    // ── Ocean ──
    vec3 deepOcean    = vec3(.01,.06,.20);
    vec3 shallowOcean = vec3(.02,.16,.42);
    vec3 coastOcean   = vec3(.04,.24,.54);
    float shelf = fbm(vUv * 8. + vec2(3.1,.9)) * .4 + fbm(vUv*14.+vec2(.7,2.1))*.2;
    vec3 ocean = mix(deepOcean, mix(shallowOcean, coastOcean, shelf), shelf*.9);
    // Oceanic ridges and subtle variation
    float ridge = fbm(vUv*12.+vec2(5.,1.)) * .04;
    ocean += vec3(0., ridge, ridge*1.5);

    // ── Biome from pre-baked texture (real colors per lat/lon) ──
    vec3 landBase = texture2D(uBiomeTex, vUv).rgb;

    // ── Elevation noise overlay on land ──
    float elev = fbm(vUv * 11. + vec2(.5,2.1));
    // Rock at high elevation
    vec3 rock    = vec3(.30,.26,.22);
    vec3 snowCap = vec3(.91,.94,1.0);
    landBase = mix(landBase, rock,    smoothstep(.60,.70, elev));
    landBase = mix(landBase, snowCap, smoothstep(.74,.84, elev));

    // ── Ice caps by latitude ──
    float ice = smoothstep(66., 78., abs(lat)) + smoothstep(82., 90., abs(lat))*.5;
    landBase = mix(landBase, vec3(.88,.93,1.0), clamp(ice,0.,1.));
    ocean    = mix(ocean,    vec3(.75,.88,1.0), clamp(ice*.6,0.,1.));

    // ── Merge ──
    vec3 col = mix(ocean, landBase, landMask);

    // ── Animated clouds — 2 layers ──
    float c1 = fbm(vUv*5.  + vec2( uTime*.003,  uTime*.0015));
    float c2 = fbm(vUv*9.  + vec2(-uTime*.002,  uTime*.004));
    float c3 = fbm(vUv*14. + vec2( uTime*.005, -uTime*.003));
    float cloud = smoothstep(.50,.64,c1)*.8 + smoothstep(.56,.70,c2)*.35 + smoothstep(.60,.72,c3)*.15;
    cloud = clamp(cloud, 0., 1.);
    // ITCZ band near equator, storm belts at 50°
    float itcz  = exp(-pow(lat/9.,2.)) * .5;
    float storm = exp(-pow((abs(lat)-50.)/8.,2.)) * .4;
    cloud = clamp(cloud * (1. + itcz + storm), 0., 1.);
    vec3 cloudCol = mix(vec3(.88,.92,.96), vec3(.98,.98,1.0), c1);
    col = mix(col, cloudCol, cloud * .72);

    // ── Lighting ──
    float NdotL = dot(vNormal, uSunDir);
    float diff  = max(NdotL, 0.);
    float night = smoothstep(.06, -.10, NdotL);
    col *= (.09 + diff * .91);

    // Terminator twilight — orange/blue tinge at day-night boundary
    float termW = smoothstep(-.12,.12, NdotL);
    vec3 termCol = mix(vec3(.6,.35,.12), col, termW);   // warm on night side of terminator
    col = mix(termCol, col, termW);

    // ── Ocean specular highlight ──
    vec3 viewDir = normalize(-vPos);
    vec3 halfVec = normalize(uSunDir + viewDir);
    float spec = pow(max(dot(vNormal, halfVec), 0.), 64.) * (1.-landMask) * (1.-cloud) * .5;
    col += vec3(.7,.88,1.) * spec;

    // ── City lights on night side (subtle warm glow) ──
    float cityGlow = fbm(vUv*18.+vec2(2.,4.)) * landMask;
    col += vec3(.20,.12,.03) * cityGlow * night * .18;

    gl_FragColor = vec4(col, 1.);
  }`;

  // ── PROCEDURAL TEXTURES — built from GeoJSON at runtime ──────────────
  function _buildProcTextures() {
    const W = 2048, H = 1024;

    // ── Land mask canvas (white=land, black=ocean) ──
    const lc = document.createElement('canvas');
    lc.width = W; lc.height = H;
    const lx = lc.getContext('2d');
    lx.fillStyle = '#000'; lx.fillRect(0, 0, W, H);
    lx.fillStyle = '#fff'; lx.strokeStyle = '#ddd'; lx.lineWidth = 1.2;

    function drawGeo(ctx, features) {
      features.forEach(feat => {
        const geom = feat.geometry;
        const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
        polys.forEach(poly => {
          poly.forEach((ring, ri) => {
            ctx.beginPath();
            ring.forEach(([lon, lat], i) => {
              const x = (lon + 180) / 360 * W;
              const y = (90 - lat) / 180 * H;
              i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            });
            ctx.closePath();
            if (ri === 0) { ctx.fill(); ctx.stroke(); }
            else { ctx.fillStyle = '#000'; ctx.fill(); ctx.fillStyle = '#fff'; }
          });
        });
      });
    }

    if (typeof LAND_GEOJSON !== 'undefined') drawGeo(lx, LAND_GEOJSON.features);

    // ── Biome canvas — per-pixel lat/lon color ──
    const bc = document.createElement('canvas');
    bc.width = W; bc.height = H;
    const bx = bc.getContext('2d');
    const imgData = bx.createImageData(W, H);
    const px = imgData.data;
    const lmData = lx.getImageData(0, 0, W, H).data;

    function biomeRGB(lat, lon, isLand) {
      const aLat = Math.abs(lat);
      if (!isLand) {
        if (aLat > 70) return [120, 170, 210]; // polar ocean
        if (aLat > 45) return [12, 80, 145];   // cold ocean
        return [8, 55, 130];                  // tropical deep ocean
      }
      // Poles / ice
      if (aLat > 72) return [220, 235, 255];
      if (aLat > 62) return [180, 200, 180]; // tundra/snow
      // Boreal
      if (aLat > 52) return [45, 95, 50];
      // Temperate
      if (aLat > 38) {
        const m = (Math.sin(lon * 0.07 + 1.) * 0.5 + 0.5);
        if (m > 0.55) return [55, 110, 45];
        if (m > 0.3) return [105, 115, 55];
        return [155, 125, 65];
      }
      // Subtropics
      if (aLat > 24) {
        const m = (Math.sin(lon * 0.05 + 2.) * 0.5 + 0.5);
        if (m > 0.6) return [55, 105, 40];
        if (m > 0.3) return [140, 130, 55];
        return [190, 155, 75];
      }
      // Tropics
      const m = (Math.sin(lon * 0.06) * 0.5 + 0.5);
      if (m > 0.6) return [20, 85, 18];   // rainforest
      if (m > 0.35) return [90, 125, 28]; // savanna
      return [200, 162, 78];           // desert
    }

    for (let row = 0; row < H; row++) {
      const lat = 90 - (row / H) * 180;
      for (let col = 0; col < W; col++) {
        const lon = (col / W) * 360 - 180;
        const isLand = lmData[(row * W + col) * 4] > 127;
        const [r, g, b] = biomeRGB(lat, lon, isLand);
        const i = (row * W + col) * 4;
        px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
      }
    }
    bx.putImageData(imgData, 0, 0);

    return {
      landMask: new THREE.CanvasTexture(lc),
      biomeTex: new THREE.CanvasTexture(bc)
    };
  }

  let _procTextures = null;
  function _getProcTextures() {
    if (!_procTextures) _procTextures = _buildProcTextures();
    return _procTextures;
  }

  // _procMat is created lazily when first switching to proc mode
  // (textures need to be built first)
  let _procMat = null;
  function _getProcMat() {
    if (_procMat) return _procMat;
    const { landMask, biomeTex } = _getProcTextures();
    _procMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3(.8, .3, .6).normalize() },
        uTime: { value: 0 },
        uLandMask: { value: landMask },
        uBiomeTex: { value: biomeTex },
      },
      vertexShader: _procVS,
      fragmentShader: _procFS
    });
    return _procMat;
  }

  // GeoJSON land outlines for procedural mode
  function _buildContourLines() {
    const grp = new THREE.Group(); grp.name = 'contours';
    const mat = new THREE.LineBasicMaterial({ color: 0x55aadd, transparent: true, opacity: .70, linewidth: 1 });
    function ll3d(lat, lon, r) {
      const phi = (90 - lat) * Math.PI / 180, th = (lon + 180) * Math.PI / 180;
      return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
    }
    if (typeof LAND_GEOJSON !== 'undefined') {
      LAND_GEOJSON.features.forEach(feat => {
        const geom = feat.geometry;
        const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
        polys.forEach(poly => {
          poly.forEach(ring => {
            const pts = ring.map(([lon, lat]) => ll3d(lat, lon, 1.002));
            const geo = new THREE.BufferGeometry().setFromPoints(pts);
            grp.add(new THREE.Line(geo, mat));
          });
        });
      });
    }
    return grp;
  }

  let _contourGrp = null;
  let _vmode = 'real'; // 'real' | 'proc'

  // Store original real materials
  const _realGlobeMat = globe.material;
  const _realNightMat = nightMesh.material;
  const _realNightVisible = nightMesh.visible !== false;

  // ══════════════════════════════════════════════════
  // COUNTRY BORDERS — 3D lines from GeoJSON
  // ══════════════════════════════════════════════════
  let _borderGrp = null;

  function _buildBorderLines() {
    const grp = new THREE.Group();
    grp.name = 'borders';

    function ll3d(lat, lon, r) {
      const phi = (90 - lat) * Math.PI / 180;
      const th = (lon + 180) * Math.PI / 180;
      return new THREE.Vector3(
        -r * Math.sin(phi) * Math.cos(th),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(th)
      );
    }

    // Real-mode border style: subtle white lines slightly above surface
    const matReal = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.28,
    });

    // Proc-mode border style: brighter cyan/gold lines
    const matProc = new THREE.LineBasicMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.65,
    });

    const R_REAL = 1.003;  // just above globe surface

    if (typeof BORDERS_GEOJSON !== 'undefined') {
      BORDERS_GEOJSON.features.forEach(feat => {
        const geom = feat.geometry;
        // Border lines are LineString or MultiLineString
        const lines = geom.type === 'LineString'
          ? [geom.coordinates]
          : geom.coordinates;

        lines.forEach(line => {
          if (line.length < 2) return;
          const pts = line.map(([lon, lat]) => ll3d(lat, lon, R_REAL));
          const geo = new THREE.BufferGeometry().setFromPoints(pts);

          // Create two versions (real + proc) — toggle visibility
          const lReal = new THREE.Line(geo, matReal);
          const lProc = new THREE.Line(geo, matProc);
          lReal.userData.mode = 'real';
          lProc.userData.mode = 'proc';
          lProc.visible = false;  // start hidden (default real mode)
          grp.add(lReal);
          grp.add(lProc);
        });
      });
    }

    scene.add(grp);
    return grp;
  }

  // Update border visibility when mode switches
  function _updateBorderMode(mode) {
    if (!_borderGrp) return;
    _borderGrp.children.forEach(line => {
      line.visible = (line.userData.mode === mode);
    });
  }

  // Toggle borders on/off
  let _bordersVisible = true;
  function toggleBorders() {
    if (!_borderGrp) _borderGrp = _buildBorderLines();
    _bordersVisible = !_bordersVisible;
    _borderGrp.visible = _bordersVisible;
    const btn = document.getElementById('border-btn');
    if (btn) btn.textContent = _bordersVisible ? '🗺 Fronteras ON' : '🗺 Fronteras OFF';
    btn.style.opacity = _bordersVisible ? '1' : '0.45';
  }
  window.toggleBorders = toggleBorders;

  function toggleVMode() {
    if (_vmode === 'real') {
      // Switch to procedural (build textures lazily)
      globe.material = _getProcMat();
      _updateBorderMode('proc');
      nightMesh.visible = false;
      cloudMesh.visible = false;
      // Add contour lines
      if (!_contourGrp) { _contourGrp = _buildContourLines(); scene.add(_contourGrp); }
      else { _contourGrp.visible = true; }
      _vmode = 'proc';
      document.getElementById('vmode-btn').textContent = '🗺️ Modo Procedural · cambiar a 🌍 Real';
    } else {
      // Switch back to real NASA textures
      globe.material = _realGlobeMat;
      _updateBorderMode('real');
      nightMesh.visible = true;
      cloudMesh.visible = true;
      if (_contourGrp) _contourGrp.visible = false;
      _vmode = 'real';
      document.getElementById('vmode-btn').textContent = '🌍 Modo Real · cambiar a 🗺️ Procedural';
    }
  }
  window.toggleVMode = toggleVMode;

  // ── RENDER LOOP ──
  const clk3 = new THREE.Clock();
  function render() {
    requestAnimationFrame(render);
    const t = clk3.getElapsedTime();
    if (!drag) tRY += .0007;
    rY += (tRY - rY) * DAMP; rX += (tRX - rX) * DAMP;
    globe.rotation.set(rX, rY, 0);
    nightMesh.rotation.set(rX, rY, 0);
    if (_vmode === "proc" && _procMat) _procMat.uniforms.uTime.value += 0.016;
    if (_contourGrp) _contourGrp.rotation.set(rX, rY, 0);
    if (_borderGrp) _borderGrp.rotation.set(rX, rY, 0);
    cloudMesh.rotation.set(rX, rY + t * .00015, 0);
    if (cloudMesh.userData.extra) cloudMesh.userData.extra.rotation.set(rX, rY + t * .0002, 0);
    mkG.rotation.set(rX, rY, 0);
    atmOuter.uniforms.uCam.value.copy(camera.position);
    atmOuter.uniforms.uSun.value.set(5, 3, 4).normalize();
    markers.forEach(m => {
      const s = 1 + .28 * Math.sin(t * 2. + m.ph);
      m.ring.scale.setScalar(s);
      m.ring.material.opacity = .45 + .3 * Math.sin(t * 2 + m.ph);
    });
    renderer.render(scene, camera);
  }
  render();

  // Init borders immediately (visible by default)
  _borderGrp = _buildBorderLines();

  // ══════════════════════════════════════════════════
  // CARD — shared content builder
  // ══════════════════════════════════════════════════
  const SL = { conflict: '⚔ Conflicto activo', tension: '⚠ Tensión', stable: '✓ Estable', authoritarian: '⛔ Autoritario', neutral: '○ Neutral' };

  function buildCardContent(d, iso, accentCol) {
    const inds = [
      { l: 'PIB p/c', v: `$${(d.gdp || 0).toLocaleString()}`, pct: Math.min((d.gdp || 0) / 100000 * 100, 100), c: '#e8c97a' },
      { l: 'Democracia', v: `${d.dem}/100`, pct: d.dem, c: '#4a90d4' },
      { l: 'Transparencia', v: `${d.cor}/100`, pct: d.cor, c: '#4caf7d' },
      { l: 'Población', v: `${d.pop}M`, pct: Math.min(d.pop / 1500 * 100, 100), c: '#9c6dd4' },
      { l: 'Nuclear', v: d.nuc ? 'Sí ☢' : 'No', pct: null, c: d.nuc ? '#e05555' : '#334455' },
      { l: 'ISO', v: iso, pct: null, c: 'rgba(255,255,255,0.3)' },
    ];
    return {
      indsHtml: inds.map(i => `<div class="ic"><div class="il">${i.l}</div><div class="iv" style="color:${i.c}">${i.v}</div>${i.pct !== null ? `<div class="ibar"><div class="ifill" style="width:${i.pct}%;background:${i.c}"></div></div>` : ''}</div>`).join(''),
      tlHtml: (d.tl || []).map(e => `<div class="tli"><span class="tly">${e.y}</span><span class="tlt">${e.t}</span></div>`).join(''),
      badge: `<span class="card-badge" style="color:${accentCol}">${d.nuc ? '☢ ' : ''}${SL[d.s] || d.s}</span>`
    };
  }

  // ══════════════════════════════════════════════════
  // OPEN / CLOSE
  // ══════════════════════════════════════════════════
  const isMobile = () => window.innerWidth < 640;

  function openCard(e, m) {
    const { iso, d, rgb } = m;
    const col = toHex(rgb);
    const content = buildCardContent(d, iso, col);

    if (isMobile()) {
      // Bottom sheet
      document.getElementById('sname').textContent = d.n;
      document.getElementById('smeta').textContent = `${d.r} · ${d.cap}`;
      document.getElementById('sbadge').innerHTML = content.badge;
      document.getElementById('sigrnd').innerHTML = content.indsHtml;
      document.getElementById('stl').innerHTML = content.tlHtml;
      document.getElementById('aio2').innerHTML = '<div class="ld"><span></span><span></span><span></span></div>';
      document.getElementById('sheet').classList.add('open');
      document.getElementById('wrap').classList.add('panel-open');
      fetchAI(iso, d, 'aio2');
      resetTabs();
      setYtFrame('s', d.n);
      if (_newsPanelOpen) loadCountryNews(d.n);
    } else {
      // Desktop popup
      document.getElementById('pacc').style.background = `linear-gradient(90deg,${col},transparent)`;
      document.getElementById('pname').textContent = d.n;
      document.getElementById('pmeta').textContent = `${d.r} · ${d.cap}`;
      document.getElementById('pbadge').innerHTML = content.badge;
      document.getElementById('igrnd').innerHTML = content.indsHtml;
      document.getElementById('ptl').innerHTML = content.tlHtml;
      document.getElementById('aio').innerHTML = '<div class="ld"><span></span><span></span><span></span></div>';

      const pw = 320, ph = 480, vw = innerWidth, vh = innerHeight;
      let x = e.clientX + 16, y = e.clientY - 50;
      if (x + pw > vw - 10) x = e.clientX - pw - 16;
      if (y + ph > vh - 10) y = vh - ph - 10; if (y < 56) y = 56;
      const pop = document.getElementById('popup');
      pop.style.left = x + 'px'; pop.style.top = y + 'px';
      pop.style.display = 'block'; pop.style.opacity = '0'; pop.style.transform = 'scale(.97)';
      requestAnimationFrame(() => { pop.style.opacity = '1'; pop.style.transform = 'scale(1)'; pop.style.transition = 'opacity .18s,transform .18s'; });
      fetchAI(iso, d, 'aio');
      resetTabs();
      setYtFrame('p', d.n);
      if (_newsPanelOpen) loadCountryNews(d.n);
    }
  }
  window.openCard = openCard;

  function closePop() {
    const p = document.getElementById('popup');
    p.style.opacity = '0'; p.style.transform = 'scale(.97)';
    setTimeout(() => p.style.display = 'none', 180);
  }
  window.closePop = closePop;

  function closeSheet() {
    document.getElementById('sheet').classList.remove('open');
    document.getElementById('wrap').classList.remove('panel-open');
  }

  function closeAll() { closePop(); closeSheet(); }

  // Sheet drag-to-close
  let sheetY0 = null;
  document.getElementById('sheet-handle').addEventListener('pointerdown', e => { sheetY0 = e.clientY; });
  window.addEventListener('pointermove', e => { if (sheetY0 === null) return; if (e.clientY - sheetY0 > 60) closeSheet(); });
  window.addEventListener('pointerup', () => sheetY0 = null);

  // ── AI ──
  // ── TABS ─────────────────────────────────────────────────────────────
  function switchTab(prefix, tab) {
    ['hitos', 'ai', 'news'].forEach(t => {
      const pane = document.getElementById(prefix + '-' + t);
      if (pane) pane.classList.toggle('active', t === tab);
    });
    // Update button states
    const container = prefix === 'p'
      ? document.getElementById('popup')
      : document.getElementById('sheet');
    if (container) {
      container.querySelectorAll('.tab-btn').forEach((btn, i) => {
        const tabs = ['hitos', 'ai', 'news'];
        btn.classList.toggle('active', tabs[i] === tab);
      });
    }
    // Lazy-load YouTube when news tab clicked
    if (tab === 'news') {
      const ytId = prefix === 'p' ? 'p-yt' : 's-yt';
      const wrap = document.getElementById(ytId);
      const iframe = wrap && wrap.querySelector('iframe');
      if (iframe && !iframe.src) {
        iframe.src = wrap.dataset.src || '';
      }
    }
  }
  window.switchTab = switchTab;

  // ── YOUTUBE SEARCH EMBED ──────────────────────────────────────────────
  function buildYtSrc(countryName, lang) {
    // YouTube search embed — searches "<country> noticias <año>"
    // Uses the /embed/videoseries endpoint with a search query
    const year = new Date().getFullYear();
    const q = encodeURIComponent(countryName + ' noticias ' + year);
    // YouTube doesn't allow direct search iframe, so we use a curated
    // approach: embed YouTube search results page (works as iframe src)
    return `https://www.youtube.com/results?search_query=${q}&sp=CAI%253D`;
  }

  function buildYtEmbedSrc(countryName) {
    // Better approach: use YouTube's embed with list=search
    // This opens a video search in a playlist-style embed
    const year = new Date().getFullYear();
    const q = encodeURIComponent(countryName + ' latest news ' + year);
    return 'https://www.youtube-nocookie.com/embed?listType=search&list=' + q
      + '&autoplay=0&modestbranding=1&rel=0&hl=es';
  }

  function setYtFrame(prefix, countryName) {
    const ytId = prefix === 'p' ? 'p-yt' : 's-yt';
    const wrap = document.getElementById(ytId);
    if (!wrap) return;
    const src = buildYtEmbedSrc(countryName);
    wrap.dataset.src = src;  // store for lazy load
    // If news tab is already active, load immediately
    const newsPane = document.getElementById(prefix + '-news');
    if (newsPane && newsPane.classList.contains('active')) {
      const iframe = wrap.querySelector('iframe');
      if (iframe) iframe.src = src;
    }
  }

  // Reset tabs to default (Hitos) when card opens
  function resetTabs() {
    ['p', 's'].forEach(prefix => {
      switchTab(prefix, 'hitos');
    });
  }

  // ══════════════════════════════════════════════════
  // NEWS PANEL — full-screen takeover
  // ══════════════════════════════════════════════════
  let _newsPanelOpen = false;

  // Channel sets per category (using youtube-nocookie, no autoplay, modest branding)
  const NEWS_SETS = {
    tv: [
      { src: 'https://www.youtube-nocookie.com/embed/GotlA1KKWoo?autoplay=0&modestbranding=1&rel=0', label: 'CNN International' },
      { src: 'https://www.youtube-nocookie.com/embed/b4tE5aKhtlg?autoplay=0&modestbranding=1&rel=0', label: 'Noticias 24h España' },
      { src: 'https://www.youtube-nocookie.com/embed/zTv0hCakAhg?autoplay=0&modestbranding=1&rel=0', label: 'France 24 Español' },
      { src: 'https://www.youtube-nocookie.com/embed/e8LvHiIl8G0?autoplay=0&modestbranding=1&rel=0', label: 'En Vivo (ES)' },
      { src: 'https://www.youtube-nocookie.com/embed/4S9sDyooxf4?autoplay=0&modestbranding=1&rel=0', label: 'RT Español' },
      { src: 'https://www.youtube-nocookie.com/embed/hkgm9_IiQh4?autoplay=0&modestbranding=1&rel=0', label: 'Al Jazeera Español' },
      { src: 'https://www.youtube-nocookie.com/embed/m7j8RpNVnug?autoplay=0&modestbranding=1&rel=0', label: 'DW Español' },
    ],
    es: [
      { src: 'https://www.youtube-nocookie.com/embed/b4tE5aKhtlg?autoplay=0&modestbranding=1&rel=0', label: 'Noticias 24h España' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=RTVE+noticias+hoy+2025&autoplay=0&modestbranding=1&rel=0', label: 'RTVE Noticias' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=El+Pais+noticias+2025&autoplay=0&modestbranding=1&rel=0', label: 'El País Video' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=La+Sexta+noticias+hoy&autoplay=0&modestbranding=1&rel=0', label: 'La Sexta' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=TVE+telediario+hoy+2025&autoplay=0&modestbranding=1&rel=0', label: 'TVE Telediario' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=Antena3+noticias+hoy&autoplay=0&modestbranding=1&rel=0', label: 'Antena 3' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=Cadena+SER+noticias+España&autoplay=0&modestbranding=1&rel=0', label: 'Cadena SER' },
    ],
    world: [
      { src: 'https://www.youtube-nocookie.com/embed/GotlA1KKWoo?autoplay=0&modestbranding=1&rel=0', label: 'CNN International' },
      { src: 'https://www.youtube-nocookie.com/embed/zTv0hCakAhg?autoplay=0&modestbranding=1&rel=0', label: 'France 24 Español' },
      { src: 'https://www.youtube-nocookie.com/embed/hkgm9_IiQh4?autoplay=0&modestbranding=1&rel=0', label: 'Al Jazeera Español' },
      { src: 'https://www.youtube-nocookie.com/embed/m7j8RpNVnug?autoplay=0&modestbranding=1&rel=0', label: 'DW Español' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=BBC+News+world+2025&autoplay=0&modestbranding=1&rel=0', label: 'BBC World' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=Euronews+espanol+hoy+2025&autoplay=0&modestbranding=1&rel=0', label: 'Euronews ES' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=New+York+Times+video+2025&autoplay=0&modestbranding=1&rel=0', label: 'New York Times' },
    ],
    latam: [
      { src: 'https://www.youtube-nocookie.com/embed/e8LvHiIl8G0?autoplay=0&modestbranding=1&rel=0', label: 'En Vivo LATAM' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=NTN24+noticias+hoy+2025&autoplay=0&modestbranding=1&rel=0', label: 'NTN24' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=CNN+en+espanol+noticias+2025&autoplay=0&modestbranding=1&rel=0', label: 'CNN en Español' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=Telesur+noticias+2025&autoplay=0&modestbranding=1&rel=0', label: 'TeleSUR' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=Mexico+noticias+hoy+2025&autoplay=0&modestbranding=1&rel=0', label: 'México Hoy' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=Argentina+noticias+2025&autoplay=0&modestbranding=1&rel=0', label: 'Argentina' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=Brazil+noticias+2025&autoplay=0&modestbranding=1&rel=0', label: 'Brasil' },
    ],
    eco: [
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=Bloomberg+economia+2025&autoplay=0&modestbranding=1&rel=0', label: 'Bloomberg' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=Wall+Street+Journal+video+2025&autoplay=0&modestbranding=1&rel=0', label: 'WSJ' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=mercados+financieros+bolsa+2025&autoplay=0&modestbranding=1&rel=0', label: 'Mercados' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=economia+mundial+analisis+2025&autoplay=0&modestbranding=1&rel=0', label: 'Economía Mundial' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=FMI+Banco+Mundial+2025&autoplay=0&modestbranding=1&rel=0', label: 'FMI / Banco Mundial' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=tecnologia+IA+economia+2025&autoplay=0&modestbranding=1&rel=0', label: 'Tecnología & IA' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=energia+petroleo+2025&autoplay=0&modestbranding=1&rel=0', label: 'Energía' },
    ],
    geo: [
      { src: 'https://www.youtube-nocookie.com/embed/hkgm9_IiQh4?autoplay=0&modestbranding=1&rel=0', label: 'Al Jazeera Geopolitics' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=Ucrania+guerra+2025&autoplay=0&modestbranding=1&rel=0', label: 'Ucrania' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=Oriente+Medio+conflicto+2025&autoplay=0&modestbranding=1&rel=0', label: 'Oriente Medio' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=China+geopolitica+2025&autoplay=0&modestbranding=1&rel=0', label: 'China' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=OTAN+geopolitica+seguridad+2025&autoplay=0&modestbranding=1&rel=0', label: 'OTAN' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=Africa+conflictos+2025&autoplay=0&modestbranding=1&rel=0', label: 'África' },
      { src: 'https://www.youtube-nocookie.com/embed?listType=search&list=geopolitica+mundo+analisis+2025&autoplay=0&modestbranding=1&rel=0', label: 'Análisis Global' },
    ],
  };

  // Headlines panel is now backed by NewsSource + the scheduler instead of a
  // one-shot per-source fetch, so it refreshes itself on a fixed cadence like
  // every other data source in the app.
  const newsSource = new NewsSource();
  let _pressLoaded = false;

  eventBus.on('news:headlines', ({ outlets }) => {
    const list = document.getElementById('news-press-list');
    if (!list) return;
    list.innerHTML = '';
    outlets.forEach(({ sourceName, headlines }) => {
      const srcEl = document.createElement('div');
      srcEl.className = 'press-source';
      srcEl.textContent = sourceName;
      list.appendChild(srcEl);
      headlines.forEach(item => {
        const d = document.createElement('div');
        d.className = 'press-item';
        const ago = _timeAgo(item.publishedAt);
        d.innerHTML = `<a href="${item.link}" target="_blank" rel="noopener">${item.title}</a><div class="pi-meta">${ago}</div>`;
        list.appendChild(d);
      });
    });
  });

  function _loadPressFeeds() {
    if (_pressLoaded) return;
    _pressLoaded = true;
    // 10 minute refresh cadence, matching the other slow-moving sources.
    scheduler.register('news-headlines', 10 * 60 * 1000, async () => {
      const raw = await newsSource.fetch();
      eventBus.emit('news:headlines', { outlets: newsSource.normalize(raw) });
    });
  }

  function _timeAgo(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'ahora';
    if (diff < 3600) return Math.floor(diff / 60) + 'min';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    return Math.floor(diff / 86400) + 'd';
  }

  let _currentCategory = 'tv';

  function setNewsCategory(cat) {
    _currentCategory = cat;
    document.querySelectorAll('.nch-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    _loadNewsVideos(NEWS_SETS[cat] || NEWS_SETS.tv);
  }
  window.setNewsCategory = setNewsCategory;

  function _loadNewsVideos(set) {
    const ids = ['nc-featured', 'nc1', 'nc2', 'nc3', 'nc4', 'nc5', 'nc6'];
    const labelIds = ['nc-feat-label', 'nc1-lbl', 'nc2-lbl', 'nc3-lbl', 'nc4-lbl', 'nc5-lbl', 'nc6-lbl'];
    ids.forEach((id, i) => {
      const cell = document.getElementById(id);
      if (!cell) return;
      const iframe = cell.querySelector('iframe');
      const lbl = document.getElementById(labelIds[i]);
      const ch = set[i];
      if (!ch) return;
      if (iframe) iframe.src = ch.src;
      if (lbl) lbl.textContent = ch.label;
    });
  }

  function toggleNewsPanel() {
    _newsPanelOpen = !_newsPanelOpen;
    const panel = document.getElementById('news-panel');
    const toggle = document.getElementById('news-toggle');
    const wrap = document.getElementById('wrap');
    const topBar = document.getElementById('top');
    const swrap = document.getElementById('swrap');
    const stats = document.getElementById('stats');
    const legend = document.getElementById('legend');
    const zctrl = document.getElementById('zoom-ctrl');
    const miniOv = document.getElementById('globe-mini-overlay');

    panel.classList.toggle('hidden', !_newsPanelOpen);
    toggle.classList.toggle('panel-open', _newsPanelOpen);
    wrap.classList.toggle('news-open', _newsPanelOpen);
    if (topBar) topBar.classList.toggle('news-open', _newsPanelOpen);
    if (swrap) swrap.classList.toggle('news-open', _newsPanelOpen);
    if (stats) stats.classList.toggle('news-open', _newsPanelOpen);
    if (legend) legend.classList.toggle('news-open', _newsPanelOpen);
    if (zctrl) zctrl.classList.toggle('news-open', _newsPanelOpen);

    if (miniOv) miniOv.classList.toggle('visible', _newsPanelOpen);

    if (_newsPanelOpen) {
      // Load videos only on first open
      _loadNewsVideos(NEWS_SETS[_currentCategory]);
      _loadPressFeeds();
    } else {
      // Unload iframes to save bandwidth
      ['nc-featured', 'nc1', 'nc2', 'nc3', 'nc4', 'nc5', 'nc6'].forEach(id => {
        const c = document.getElementById(id);
        if (c) { const f = c.querySelector('iframe'); if (f) f.src = ''; }
      });
      _pressLoaded = false; // allow reload next time
    }
  }
  window.toggleNewsPanel = toggleNewsPanel;

  function newsSearch() {
    const val = document.getElementById('news-search').value.trim();
    if (!val) { setNewsCategory('tv'); return; }
    const yr = new Date().getFullYear();
    const topics = [
      val + ' noticias hoy ' + yr,
      val + ' breaking news ' + yr,
      val + ' últimas noticias análisis',
      val + ' política ' + yr,
      val + ' economía impacto',
      val + ' internacional',
      val + ' video reportaje',
    ];
    const custom = topics.map(t => ({
      src: `https://www.youtube-nocookie.com/embed?listType=search&list=${encodeURIComponent(t)}&autoplay=0&modestbranding=1&rel=0`,
      label: t
    }));
    _loadNewsVideos(custom);
    if (!_newsPanelOpen) toggleNewsPanel();
  }
  window.newsSearch = newsSearch;

  // Called from country card — load country-specific news
  function loadCountryNews(countryName) {
    const yr = new Date().getFullYear();
    const topics = [
      countryName + ' noticias hoy ' + yr,
      countryName + ' breaking news',
      countryName + ' política ' + yr,
      countryName + ' economía crisis',
      countryName + ' geopolitica',
      countryName + ' conflicto',
      countryName + ' análisis situación',
    ];
    const custom = topics.map(t => ({
      src: `https://www.youtube-nocookie.com/embed?listType=search&list=${encodeURIComponent(t)}&autoplay=0&modestbranding=1&rel=0`,
      label: t
    }));
    _loadNewsVideos(custom);
    _pressLoaded = false;
    if (!_newsPanelOpen) toggleNewsPanel();
  }

  async function fetchAI(iso, d, targetId) {
    const prompt = `Analista geopolítico. Análisis de ${d.n} en ≤140 palabras.
Datos: PIB $${d.gdp}/hab, democracia ${d.dem}/100, transparencia ${d.cor}/100, pop ${d.pop}M, nuclear:${!!d.nuc}, estado:${d.s}.
Contexto: ${d.note}
Cubre con negrita: **Política** · **Economía** · **Geopolítica** · **Riesgo 2025**. Sin introducción.`;
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }) });
      const data = await r.json();
      const txt = data.content?.map(b => b.text || '').join('') || 'Sin análisis disponible.';
      const el = document.getElementById(targetId);
      if (el) el.innerHTML = txt.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    } catch {
      const el = document.getElementById(targetId);
      if (el) el.textContent = 'Análisis no disponible.';
    }
  }

  // ── LAYERS ──
  document.querySelectorAll('.lb').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lb').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      eventBus.emit('layer:changed', { layer: btn.dataset.l });
    });
  });

  // ── SEARCH ──
  const si = document.getElementById('si'), sr = document.getElementById('sr');
  si.addEventListener('input', () => {
    const q = si.value.trim().toLowerCase();
    if (!q) { sr.style.display = 'none'; return; }
    const hits = Object.entries(CD).filter(([k, d]) => d.n.toLowerCase().includes(q) || k.toLowerCase().includes(q)).slice(0, 7);
    if (!hits.length) { sr.style.display = 'none'; return; }
    sr.innerHTML = hits.map(([iso, d]) => {
      const col = toHex(LAYERS[curLayer](d));
      return `<div class="sri" data-iso="${iso}"><div class="spip" style="background:${col}"></div><span class="sname">${d.n}</span><span class="siso">${iso}</span></div>`;
    }).join('');
    sr.style.display = 'block';
    sr.querySelectorAll('.sri').forEach(el => el.addEventListener('click', () => {
      const iso = el.dataset.iso; sr.style.display = 'none'; si.value = ''; si.blur(); flyTo(iso);
    }));
  });
  document.addEventListener('click', e => { if (!e.target.closest('#swrap')) sr.style.display = 'none'; });

  function flyTo(iso) {
    const d = CD[iso]; if (!d) return;
    tRY = -(d.lon + 180) * Math.PI / 180 + Math.PI;
    tRX = -(90 - d.lat) * Math.PI / 180 + Math.PI / 2;
    setTimeout(() => {
      const m = markers.find(m => m.iso === iso); if (!m) return;
      const wp = m.pos.clone(); globe.localToWorld(wp);
      const sp = wp.clone().project(camera);
      const sx = (sp.x * .5 + .5) * innerWidth, sy = (1 - (sp.y * .5 + .5)) * innerHeight;
      openCard({ clientX: sx, clientY: sy }, m);
    }, 900);
  }

  // ── CLOCK + STATS ──
  function tick() { document.getElementById('clk').textContent = new Date().toUTCString().slice(17, 25) + ' UTC'; setTimeout(tick, 1000); } tick();
  const all = Object.values(CD);
  document.getElementById('sc').textContent = all.filter(d => d.s === 'conflict').length;
  document.getElementById('st').textContent = all.filter(d => d.s === 'tension').length;
  document.getElementById('sp').textContent = all.length;

  // ── RESIZE ──
  window.addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  });

  // ── INTRO ──
  setTimeout(() => document.getElementById('intro').classList.add('out'), 2200);
  setTimeout(() => document.getElementById('intro').style.display = 'none', 3600);

  // ── ZOOM BUTTONS ──
  (function () {
    const CAM_DEFAULT = 2.9;
    let zAnimId = null;
    function animZoom(target, duration = 380) {
      if (zAnimId) cancelAnimationFrame(zAnimId);
      const start = camera.position.z, t0 = performance.now();
      (function step(now) {
        const p = Math.min((now - t0) / duration, 1);
        camera.position.z = start + (target - start) * (1 - Math.pow(1 - p, 3));
        if (p < 1) zAnimId = requestAnimationFrame(step);
      })(performance.now());
    }
    document.getElementById('zin').addEventListener('click', () => animZoom(Math.max(1.4, camera.position.z - .8)));
    document.getElementById('zout').addEventListener('click', () => animZoom(Math.min(6, camera.position.z + .8)));
    document.getElementById('zreset').addEventListener('click', () => { animZoom(CAM_DEFAULT); tRY = .5; tRX = 0; });
    setTimeout(() => { const h = document.getElementById('zoom-hint'); if (h) h.classList.add('gone'); }, 5000);
  })();

  // === FEATURE IMPLEMENTATION ===
  window.addEventListener('load', function () {
    setTimeout(function () {
      try { _initFeatures(); } catch (e) { console.warn('Features error:', e); }
    }, 900);
  });

  function _initFeatures() {
    var F = {};
    window._f = F;

    // F1 — STARFIELD
    var sg = new THREE.BufferGeometry(), n = 6000;
    var pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var r = 200 + Math.random() * 300, theta = Math.random() * Math.PI * 2, phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta); pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta); pos[i * 3 + 2] = r * Math.cos(phi);
      if (Math.random() < 0.05) { col[i * 3] = 1; col[i * 3 + 1] = 0.9; col[i * 3 + 2] = 0.5; }
      else { var v = 0.7 + Math.random() * 0.3; col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = 1; }
    }
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    var starField = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.2, vertexColors: true, transparent: true, opacity: .9, sizeAttenuation: true }));
    scene.add(starField);

    // F2 — CONFLICT ARCS
    var ARC_PAIRS = [['RUS', 'UKR', 'conflict'], ['ISR', 'PSE', 'conflict'], ['ISR', 'LBN', 'conflict'],
    ['CHN', 'TWN', 'tension'], ['IND', 'PAK', 'tension'], ['IRN', 'ISR', 'tension'],
    ['RUS', 'GEO', 'tension'], ['ETH', 'SDN', 'tension'], ['MMR', 'BGD', 'tension'],
    ['USA', 'CHN', 'tension'], ['USA', 'RUS', 'tension'], ['IRN', 'SAU', 'tension']];
    var arcGroup = new THREE.Group(), arcParticles = [], arcsOn = false;
    ARC_PAIRS.forEach(function (pair, idx) {
      var dA = CD[pair[0]], dB = CD[pair[1]]; if (!dA || !dB) return;
      var s = ll3(dA.lat, dA.lon, 1.01), e = ll3(dB.lat, dB.lon, 1.01);
      var mid = new THREE.Vector3().addVectors(s, e).multiplyScalar(0.5).normalize().multiplyScalar(1.45 + Math.random() * 0.2);
      var curve = new THREE.QuadraticBezierCurve3(s, mid, e);
      var lGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50));
      var lc = pair[2] === 'conflict' ? 0xff3333 : 0xff8833;
      var line = new THREE.Line(lGeo, new THREE.LineBasicMaterial({ color: lc, transparent: true, opacity: 0.35 }));
      line.userData.ph = idx * 0.5; arcGroup.add(line);
      var pm = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), new THREE.MeshBasicMaterial({ color: lc }));
      pm.userData = { curve: curve, t: Math.random(), sp: 0.003 + Math.random() * 0.002, ph: idx * 0.5 };
      arcGroup.add(pm); arcParticles.push(pm);
    });
    arcGroup.visible = false; scene.add(arcGroup);
    F.toggleArcs = function () { arcsOn = !arcsOn; arcGroup.visible = arcsOn; document.getElementById('arc-btn').textContent = arcsOn ? '🔗 ARCOS ON' : '🔗 ARCOS'; };

    // F3 — HEATMAP
    var hmMesh = null, hmOn = false;
    (function () {
      var W = 512, H = 256, canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d'), img = ctx.createImageData(W, H), wts = new Float32Array(W * H);
      var wm = { 'conflict': 1, 'tension': 0.6, 'authoritarian': 0.3, 'stable': 0, 'neutral': 0 };
      Object.values(CD).forEach(function (d) {
        var w = wm[d.s] || 0; if (!w) return;
        var px = ((d.lon + 180) / 360 * W) | 0, py = ((90 - d.lat) / 180 * H) | 0, r = 15;
        for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
          var nx = px + dx, ny = py + dy; if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          var dist = Math.sqrt(dx * dx + dy * dy); if (dist > r) continue;
          wts[ny * W + nx] += w * Math.exp(-dist * dist / (r * r / 2));
        }
      });
      var mx = 0; for (var i = 0; i < wts.length; i++) if (wts[i] > mx) mx = wts[i];
      for (var i = 0; i < W * H; i++) {
        var v = mx > 0 ? wts[i] / mx : 0, ii = i * 4; if (v < 0.1) { img.data[ii + 3] = 0; continue; }
        img.data[ii] = 255; img.data[ii + 1] = Math.round((1 - v) * 165); img.data[ii + 2] = 0; img.data[ii + 3] = Math.round(v * 80);
      }
      ctx.putImageData(img, 0, 0);
      hmMesh = new THREE.Mesh(new THREE.SphereGeometry(1.004, 64, 32),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      hmMesh.visible = false; scene.add(hmMesh);
    })();
    F.toggleHeatmap = function () { hmOn = !hmOn; if (hmMesh) hmMesh.visible = hmOn; document.getElementById('heat-btn').textContent = hmOn ? '🌡 HEATMAP ON' : '🌡 HEATMAP'; };

    // F4 — TIMELINE
    var tlOn = false, tlPlayId = null, tlYear = 2024;
    var tlSlider = document.getElementById('tl-slider'), tlYearEl = document.getElementById('tl-year');
    if (tlSlider) tlSlider.addEventListener('input', function () { tlYear = +tlSlider.value; tlYearEl.textContent = tlYear; doSetYear(tlYear); });
    function doSetYear(yr) {
      markers.forEach(function (m) {
        var d = CD[m.iso]; if (!d || !d.tl) return;
        var st = d.s;
        [].concat(d.tl).sort(function (a, b) { return a.y - b.y; }).forEach(function (ev) {
          if (ev.y > yr) return; var t = (ev.t || '').toLowerCase();
          if (t.includes('guerra') || t.includes('invasión')) st = 'conflict';
          else if (t.includes('paz') || t.includes('independen')) st = 'stable';
        });
        var cm = { 'conflict': [1, .1, .1], 'tension': [1, .6, .1], 'stable': [.1, .8, .3], 'authoritarian': [.8, .2, .8], 'neutral': [.5, .5, .5] };
        var c = cm[st] || [.5, .5, .5];
        if (m.dot && m.dot.material) m.dot.material.color.setRGB(c[0], c[1], c[2]);
      });
    }
    F.playTimeline = function () {
      if (tlPlayId) return; if (tlSlider) tlSlider.value = 1900; tlYear = 1900;
      var start = Date.now();
      (function step() {
        var p = (Date.now() - start) / 30000; if (p >= 1) { tlPlayId = null; return; }
        tlYear = Math.round(1900 + p * 125); if (tlSlider) tlSlider.value = tlYear; if (tlYearEl) tlYearEl.textContent = tlYear;
        doSetYear(tlYear); tlPlayId = requestAnimationFrame(step);
      })();
    };
    F.toggleTimeline = function () { tlOn = !tlOn; document.getElementById('timeline-bar').style.display = tlOn ? 'flex' : 'none'; document.getElementById('tl-btn').textContent = tlOn ? '📅 TIMELINE ON' : '📅 TIMELINE'; };

    // F5 — COMPARE
    var cmpIsoA = null, cmpMode = false;
    F.enterCompareMode = function (iso) {
      cmpIsoA = iso; cmpMode = true;
      var name = (CD[iso] && CD[iso].n) || iso;
      document.getElementById('compare-overlay').style.display = 'flex';
      document.getElementById('compare-panel').innerHTML = '<button id="compare-close" onclick="closeCompare()">✕</button><h3>Selecciona otro país para comparar con <span style="color:var(--gold)">' + name + '</span></h3>';
    };
    F.closeCompare = function () { cmpMode = false; cmpIsoA = null; document.getElementById('compare-overlay').style.display = 'none'; };
    function showCmp(iA, iB) {
      var dA = CD[iA], dB = CD[iB]; if (!dA || !dB) return;
      function nrm(v, mx) { return Math.min(1, Math.max(0, (v || 0) / mx)); }
      var labels = ['PIB', 'Demo', 'Transp', 'Pobla', 'Nucl', 'Estab'];
      function vals(d) { return [nrm(d.gdp, 60000), nrm(d.dem, 100), nrm(d.cor, 100), nrm(d.pop, 1500), d.nuc ? 1 : 0, ({ 'stable': 1, 'neutral': 0.5, 'tension': 0.3, 'authoritarian': 0.2, 'conflict': 0 }[d.s] || 0)]; }
      function svg(vs, color) {
        var n = 6, sz = 180, cx = 90, cy = 90, r = 65, ax = '', pts = [];
        for (var i = 0; i < n; i++) {
          var a = i / n * Math.PI * 2 - Math.PI / 2;
          pts.push((cx + vs[i] * r * Math.cos(a)).toFixed(1) + ',' + (cy + vs[i] * r * Math.sin(a)).toFixed(1));
          ax += '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + r * Math.cos(a)).toFixed(1) + '" y2="' + (cy + r * Math.sin(a)).toFixed(1) + '" stroke="rgba(255,255,255,.2)" stroke-width="1"/>';
          ax += '<text x="' + (cx + (r + 16) * Math.cos(a)).toFixed(1) + '" y="' + (cy + (r + 16) * Math.sin(a)).toFixed(1) + '" class="radar-label" text-anchor="middle" dominant-baseline="middle">' + labels[i] + '</text>';
        }
        return '<svg width="' + sz + '" height="' + sz + '" class="radar">' + ax + '<polygon points="' + pts.join(' ') + '" fill="' + color + '" fill-opacity=".25" stroke="' + color + '" stroke-width="2"/></svg>';
      }
      document.getElementById('compare-panel').innerHTML = '<button id="compare-close" onclick="closeCompare()">✕</button><h3>' + dA.n + ' vs ' + dB.n + '</h3><div class="compare-cols"><div class="compare-col"><h4 style="color:#e8c97a">' + dA.n + '</h4>' + svg(vals(dA), '#e8c97a') + '</div><div class="compare-col"><h4 style="color:#4a90d4">' + dB.n + '</h4>' + svg(vals(dB), '#4a90d4') + '</div></div>';
      cmpMode = false; cmpIsoA = null;
    }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') F.closeCompare(); });

    // F7 — SMART SEARCH
    (function () {
      var inp = document.getElementById('search'); if (!inp) return;
      inp.parentElement.style.position = 'relative';
      var drop = document.createElement('div'); drop.id = 'search-dropdown'; inp.parentElement.appendChild(drop);
      var ai = -1, SC = { 'conflict': '#ff4444', 'tension': '#ff8800', 'stable': '#44cc44', 'authoritarian': '#cc44cc', 'neutral': '#aaa' };
      function srch(q) {
        if (!q) return []; var r = [];
        Object.entries(CD).forEach(function (e) {
          var iso = e[0], d = e[1], s = 0;
          if (d.n.toLowerCase().includes(q.toLowerCase())) s = 3;
          else if ((d.cap || '').toLowerCase().includes(q.toLowerCase())) s = 2;
          else if ((d.r || '').toLowerCase().includes(q.toLowerCase())) s = 1;
          if (s) r.push({ iso: iso, d: d, sc: s });
        });
        return r.sort(function (a, b) { return b.sc - a.sc; }).slice(0, 6);
      }
      function render(res) {
        ai = -1; if (!res.length) { drop.style.display = 'none'; return; }
        drop.innerHTML = res.map(function (r) { return '<div class="search-item" data-iso="' + r.iso + '"><span class="search-dot" style="background:' + (SC[r.d.s] || '#aaa') + '"></span><span class="search-main">' + r.d.n + '</span><span class="search-sub">' + (r.d.cap || '') + ' · ' + (r.d.r || '') + '</span></div>'; }).join('');
        drop.style.display = 'block';
        drop.querySelectorAll('.search-item').forEach(function (el) { el.addEventListener('click', function () { flyTo(el.dataset.iso); drop.style.display = 'none'; inp.value = ''; }); });
      }
      inp.addEventListener('input', function () { render(srch(inp.value)); });
      inp.addEventListener('keydown', function (e) {
        var items = drop.querySelectorAll('.search-item');
        if (e.key === 'ArrowDown') ai = Math.min(ai + 1, items.length - 1);
        else if (e.key === 'ArrowUp') ai = Math.max(ai - 1, 0);
        else if (e.key === 'Enter' && ai >= 0) items[ai].click();
        else if (e.key === 'Escape') drop.style.display = 'none';
        items.forEach(function (el, i) { el.classList.toggle('active', i === ai); });
      });
      document.addEventListener('click', function (e) { if (!inp.parentElement.contains(e.target)) drop.style.display = 'none'; });
    })();

    // F8 — STATS UPGRADE
    (function () {
      var wm = { 'conflict': 100, 'tension': 60, 'authoritarian': 40, 'neutral': 20, 'stable': 0 };
      var tw = 0, cnt = 0, sg = 0; Object.values(CD).forEach(function (d) { tw += wm[d.s] || 0; sg += d.gdp || 0; cnt++; });
      var tn = Math.round(tw / cnt), ag = Math.round(sg / cnt);
      function anim(el, target) { var s = Date.now(); (function t() { var p = Math.min(1, (Date.now() - s) / 1500); el.textContent = Math.round(p * target); if (p < 1) requestAnimationFrame(t); })(); }
      var bar = document.getElementById('stats');
      if (bar && !document.getElementById('stat-tension')) {
        var ex = document.createElement('span');
        ex.innerHTML = ' · 🌡 <span id="stat-tension">0</span>/100'; bar.appendChild(ex);
      }
      var te = document.getElementById('stat-tension');
      if (te) { anim(te, tn); te.style.color = tn > 60 ? '#ff5555' : tn > 30 ? '#ffaa44' : '#55cc55'; }
      var ce = document.getElementById('ccount'), tce = document.getElementById('tcount');
      var cc = 0, tc = 0; Object.values(CD).forEach(function (d) { if (d.s === 'conflict') cc++; if (d.s === 'tension') tc++; });
      if (ce) anim(ce, cc); if (tce) anim(tce, tc);
    })();

    // F9 — ALLIANCE LINES
    var ALLIANCES = {
      NATO: { color: '#4a90d4', members: ['USA', 'GBR', 'DEU', 'FRA', 'ITA', 'ESP', 'POL', 'NOR', 'DNK', 'NLD', 'BEL', 'PRT', 'CAN', 'TUR', 'GRC', 'HUN', 'CZE', 'ROU', 'HRV', 'FIN'] },
      EU: { color: '#5577ff', members: ['DEU', 'FRA', 'ITA', 'ESP', 'POL', 'NLD', 'BEL', 'SWE', 'AUT', 'GRC', 'PRT', 'CZE', 'ROU', 'HUN', 'FIN', 'HRV', 'DNK', 'SVK', 'IRL', 'LTU', 'LVA', 'EST', 'SVN', 'CYP', 'MLT', 'BGR', 'LUX'] },
      BRICS: { color: '#e8c97a', members: ['BRA', 'RUS', 'IND', 'CHN', 'ZAF', 'SAU', 'ARE', 'ETH', 'EGY', 'IRN'] },
      SCO: { color: '#c0392b', members: ['CHN', 'RUS', 'IND', 'PAK', 'KAZ', 'UZB', 'KGZ', 'TJK'] },
      ASEAN: { color: '#27ae60', members: ['IDN', 'THA', 'VNM', 'PHL', 'MYS', 'SGP', 'MMR', 'KHM', 'LAO', 'BRN'] },
    };
    var alGrps = {};
    Object.entries(ALLIANCES).forEach(function (e) {
      var name = e[0], conf = e[1], grp = new THREE.Group(), pts = [];
      conf.members.forEach(function (iso) { var d = CD[iso]; if (d) pts.push(ll3(d.lat, d.lon, 1.01)); });
      if (pts.length >= 2) {
        var hub = new THREE.Vector3(pts.reduce(function (s, p) { return s + p.x; }, 0) / pts.length, pts.reduce(function (s, p) { return s + p.y; }, 0) / pts.length, pts.reduce(function (s, p) { return s + p.z; }, 0) / pts.length).normalize().multiplyScalar(1.01);
        pts.forEach(function (p) { var l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([hub, p]), new THREE.LineDashedMaterial({ color: conf.color, transparent: true, opacity: 0.4, dashSize: 0.04, gapSize: 0.02 })); l.computeLineDistances(); grp.add(l); });
      }
      grp.visible = false; scene.add(grp); alGrps[name] = grp;
    });
    F.toggleAlliance = function (n, v) { if (alGrps[n]) alGrps[n].visible = v; };
    F.toggleAlliancePanel = function () { var p = document.getElementById('alliance-panel'); p.style.display = p.style.display === 'block' ? 'none' : 'block'; };

    // F10 — AUDIO
    var aCtx = null, aOn = false, aGains = [];
    function ensureAudio() { if (aCtx) return; aCtx = new (window.AudioContext || window.webkitAudioContext)();[40, 80].forEach(function (f) { var o = aCtx.createOscillator(), g = aCtx.createGain(); o.frequency.value = f; o.type = 'sine'; g.gain.value = 0; o.connect(g); g.connect(aCtx.destination); o.start(); aGains.push(g); }); }
    F.toggleAudio = function () { ensureAudio(); aOn = !aOn; var t = aCtx.currentTime, v = aOn ? 0.015 : 0; aGains.forEach(function (g) { g.gain.linearRampToValueAtTime(v, t + 0.05); }); document.getElementById('audio-btn').textContent = aOn ? '🔊 AUDIO ON' : '🔇 AUDIO'; };
    function ping() { if (!aOn || !aCtx) return; var o = aCtx.createOscillator(), g = aCtx.createGain(); o.frequency.value = 880; o.type = 'sine'; g.gain.setValueAtTime(0.12, aCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, aCtx.currentTime + 0.3); o.frequency.exponentialRampToValueAtTime(440, aCtx.currentTime + 0.3); o.connect(g); g.connect(aCtx.destination); o.start(); o.stop(aCtx.currentTime + 0.35); }

    // EXTRA ANIMATION LOOP
    (function loop() {
      requestAnimationFrame(loop); var t = performance.now() * 0.001;
      starField.rotation.y = rY * 0.05; starField.rotation.x = rX * 0.05;
      arcGroup.rotation.set(rX, rY, 0);
      arcParticles.forEach(function (p) { p.userData.t = (p.userData.t + p.userData.sp) % 1; p.position.copy(p.userData.curve.getPoint(p.userData.t)); });
      arcGroup.children.forEach(function (c) { if (c.isLine && c.material) c.material.opacity = 0.15 + 0.28 * Math.abs(Math.sin(t + (c.userData.ph || 0))); });
      if (hmMesh) hmMesh.rotation.set(rX, rY, 0);
      Object.values(alGrps).forEach(function (g) { g.rotation.set(rX, rY, 0); });
    })();

    // PATCH openCard
    var _oc = window.openCard;
    window.openCard = function (e, m) {
      _oc(e, m); ping();
      var iso = m.iso;
      if (cmpMode && cmpIsoA && cmpIsoA !== iso) { showCmp(cmpIsoA, iso); document.getElementById('compare-overlay').style.display = 'none'; return; }
      setTimeout(function () {
        var isPop = document.getElementById('popup') && document.getElementById('popup').style.display === 'block';
        var isSh = document.getElementById('sheet') && document.getElementById('sheet').classList.contains('open');
        var container = isPop ? document.getElementById('igrnd') : isSh ? document.getElementById('sigrnd') : null;
        if (container && !container.querySelector('.compare-btn')) {
          var btn = document.createElement('button'); btn.className = 'compare-btn'; btn.textContent = '⊕ COMPARAR';
          btn.onclick = function () { F.enterCompareMode(iso); }; container.appendChild(btn);
        }
      }, 300);
    };

    console.log('Earth Looper v2 features ready ✓');
  }
  // === END FEATURE IMPLEMENTATION ===
}
