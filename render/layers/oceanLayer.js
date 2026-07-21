/**
 * EarthOS OceanLayer — SST heatmap + animated ocean current trajectories.
 * Currents are rendered as static colored path lines + flowing particles.
 * SST data comes from CopernicusSource via Open-Meteo Marine API.
 */

import bus, { Events } from '../../core/eventBus.js';
import { latLonToXYZ } from '../globe.js';

const MAX_SST = 300;
const SURF_R  = 1.003;

// Major ocean current paths: [lat, lon] waypoints, speed in t-units/second
// (speed 0.05 = one full lap in 20s at 60fps)
const CURRENT_DEFS = [
  {
    name: 'Gulf Stream',
    color: 0xff7043, speed: 0.052,
    pts: [[25,-80],[28,-79],[32,-76],[35,-74],[38,-70],[42,-65],[45,-55],[48,-45],[50,-35],[52,-22],[55,-15]],
  },
  {
    name: 'Kuroshio',
    color: 0xff8f00, speed: 0.048,
    pts: [[15,120],[20,122],[25,125],[30,128],[35,140],[38,145],[40,150],[42,160],[40,170],[38,175]],
  },
  {
    name: 'Antarctic Circumpolar',
    color: 0x80cbc4, speed: 0.022,
    pts: [[-58,-180],[-60,-150],[-57,-120],[-54,-90],[-58,-60],[-56,-30],[-55,0],[-54,30],[-56,60],[-58,90],[-56,120],[-54,150],[-58,180]],
  },
  {
    name: 'North Atlantic Drift',
    color: 0x4db6ac, speed: 0.038,
    pts: [[42,-65],[45,-55],[48,-42],[51,-30],[53,-18],[55,-8],[57,0],[58,8]],
  },
  {
    name: 'California Current',
    color: 0x64b5f6, speed: 0.040,
    pts: [[50,-130],[46,-126],[42,-124],[38,-122],[34,-120],[30,-117],[26,-112],[22,-108]],
  },
  {
    name: 'Benguela Current',
    color: 0x81d4fa, speed: 0.042,
    pts: [[-35,18],[-30,16],[-25,14.5],[-20,13.5],[-15,12.5],[-10,11.5],[-5,11]],
  },
  {
    name: 'Brazil Current',
    color: 0xffa726, speed: 0.038,
    pts: [[-5,-35],[-10,-37],[-15,-38],[-20,-39],[-25,-43],[-30,-48],[-35,-52],[-38,-55]],
  },
  {
    name: 'East Australian',
    color: 0xff7043, speed: 0.044,
    pts: [[-15,148],[-20,153],[-25,154],[-30,153],[-35,151],[-40,148],[-45,148]],
  },
  {
    name: 'Labrador Current',
    color: 0x90caf9, speed: 0.035,
    pts: [[70,-60],[65,-57],[60,-55],[56,-53],[52,-52],[48,-55],[45,-57]],
  },
  {
    name: 'Canary Current',
    color: 0xb3e5fc, speed: 0.036,
    pts: [[45,-10],[40,-13],[35,-14],[30,-15],[25,-17],[20,-18],[15,-17],[10,-16]],
  },
  {
    name: 'Humboldt / Peru',
    color: 0x4fc3f7, speed: 0.041,
    pts: [[-55,-73],[-50,-75],[-45,-76],[-40,-75],[-35,-74],[-30,-73],[-25,-71],[-20,-70],[-15,-77],[-10,-80],[-5,-82],[0,-82]],
  },
  {
    name: 'Agulhas Current',
    color: 0xff6f00, speed: 0.050,
    pts: [[-22,36],[-26,35],[-30,33],[-34,27],[-37,26],[-38,28],[-40,23]],
  },
  {
    name: 'North Pacific Current',
    color: 0x26c6da, speed: 0.030,
    pts: [[42,170],[42,-170],[42,-160],[40,-150],[38,-140],[36,-130],[33,-125]],
  },
  {
    name: 'Equatorial Counter',
    color: 0xffab40, speed: 0.028,
    pts: [[6,-155],[6,-140],[6,-125],[6,-110],[6,-95],[6,-80],[6,-70]],
  },
  {
    name: 'South Equatorial Pac.',
    color: 0x26a69a, speed: 0.030,
    pts: [[0,-80],[-3,-100],[-6,-125],[-8,-150],[-10,-170],[-12,170],[-10,150]],
  },
  {
    name: 'Indian Ocean Equat.',
    color: 0xffd54f, speed: 0.032,
    pts: [[5,45],[5,55],[5,65],[5,75],[5,85],[5,95],[5,105]],
  },
  {
    name: 'Mozambique Channel',
    color: 0xffb300, speed: 0.040,
    pts: [[-12,45],[-15,42],[-18,38],[-22,36],[-26,35],[-30,33]],
  },
];

const PER_PATH    = 28;  // particles per current
const LINE_OPACITY = 0.35;

function sstColor(sst) {
  const THREE = window.THREE;
  const t = Math.max(0, Math.min(1, (sst + 2) / 37));
  if (t < 0.25) return new THREE.Color().setHSL(0.67, 1.0, 0.3 + t * 0.8);
  if (t < 0.5)  return new THREE.Color().setHSL(0.45, 1.0, 0.4);
  if (t < 0.75) return new THREE.Color().setHSL(0.10, 1.0, 0.5);
  return new THREE.Color().setHSL(0.02, 1.0, 0.45);
}

export class OceanLayer {
  #sstMesh    = null;
  #lineGroup  = null;
  #particles  = null;
  #pPositions = null;
  #paths      = [];    // [{xyzPts, speed, tArr}]
  #dummy      = null;
  #visible    = false;

  init(scene) {
    const THREE  = window.THREE;
    const parent = scene.userData.rotGroup ?? scene;
    this.#dummy  = new THREE.Object3D();

    // ── SST heatmap (instanced discs)
    const geo = new THREE.CircleGeometry(0.065, 6);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false,
    });
    this.#sstMesh = new THREE.InstancedMesh(geo, mat, MAX_SST);
    this.#sstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.#sstMesh.renderOrder = 1;
    this.#sstMesh.count = 0;
    parent.add(this.#sstMesh);

    // ── Current path lines + particles
    this.#lineGroup = new THREE.Group();
    parent.add(this.#lineGroup);
    this.#buildCurrents(THREE);

    const totalPts = this.#paths.length * PER_PATH;
    this.#pPositions = new Float32Array(totalPts * 3);

    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.BufferAttribute(this.#pPositions, 3));

    const pColors = new Float32Array(totalPts * 3);
    let ci = 0;
    for (const path of this.#paths) {
      const c = new THREE.Color(path.color);
      for (let p = 0; p < PER_PATH; p++) {
        pColors[ci++] = c.r; pColors[ci++] = c.g; pColors[ci++] = c.b;
      }
    }
    pgeo.setAttribute('color', new THREE.BufferAttribute(pColors, 3));

    const pmat = new THREE.PointsMaterial({
      size: 0.010, vertexColors: true,
      transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true,
    });
    this.#particles = new THREE.Points(pgeo, pmat);
    this.#particles.renderOrder = 2;
    parent.add(this.#particles);

    this.#syncParticlePositions();

    bus.on(Events.LAYER_DATA_READY, data => {
      if (data.id === 'ocean' && data.type === 'sst_grid') this.#updateSST(data.events);
    });

    bus.on(Events.LAYER_TOGGLE, ({ id, enabled }) => {
      if (id !== 'ocean') return;
      this.#visible = enabled;
      if (this.#sstMesh)   this.#sstMesh.visible   = enabled;
      if (this.#lineGroup) this.#lineGroup.visible  = enabled;
      if (this.#particles) this.#particles.visible  = enabled;
    });
  }

  #buildCurrents(THREE) {
    for (const def of CURRENT_DEFS) {
      const xyzPts = def.pts.map(([lat, lon]) => {
        const p = latLonToXYZ(lat, lon, SURF_R);
        return new THREE.Vector3(p.x, p.y, p.z);
      });

      // Static path line
      const verts = [];
      for (let i = 0; i < xyzPts.length - 1; i++) {
        verts.push(xyzPts[i].x, xyzPts[i].y, xyzPts[i].z,
                   xyzPts[i+1].x, xyzPts[i+1].y, xyzPts[i+1].z);
      }
      const lgeo = new THREE.BufferGeometry();
      lgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
      const lmat = new THREE.LineBasicMaterial({
        color: def.color, transparent: true, opacity: LINE_OPACITY, depthWrite: false,
      });
      const line = new THREE.LineSegments(lgeo, lmat);
      line.renderOrder = 1;
      this.#lineGroup.add(line);

      // Stagger initial particle positions along path
      const tArr = [];
      for (let p = 0; p < PER_PATH; p++) tArr.push(p / PER_PATH);

      this.#paths.push({ xyzPts, color: def.color, speed: def.speed, tArr });
    }
  }

  #posOnPath(xyzPts, t) {
    const n   = xyzPts.length - 1;
    const s   = Math.max(0, Math.min(0.9999, t)) * n;
    const seg = Math.floor(s);
    const f   = s - seg;
    const a   = xyzPts[seg];
    const b   = xyzPts[Math.min(seg + 1, n)];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
  }

  #syncParticlePositions() {
    let pi = 0;
    for (const path of this.#paths) {
      for (let p = 0; p < PER_PATH; p++) {
        const pos = this.#posOnPath(path.xyzPts, path.tArr[p]);
        this.#pPositions[pi * 3]     = pos.x;
        this.#pPositions[pi * 3 + 1] = pos.y;
        this.#pPositions[pi * 3 + 2] = pos.z;
        pi++;
      }
    }
    if (this.#particles) {
      this.#particles.geometry.attributes.position.needsUpdate = true;
    }
  }

  #updateSST(grid) {
    if (!this.#sstMesh || !grid?.length) return;
    const count = Math.min(grid.length, MAX_SST);

    for (let i = 0; i < count; i++) {
      const { lat, lon, sst } = grid[i];
      const pos = latLonToXYZ(lat, lon, SURF_R - 0.002);
      this.#dummy.position.set(pos.x, pos.y, pos.z);
      this.#dummy.lookAt(pos.x * 2, pos.y * 2, pos.z * 2);
      this.#dummy.updateMatrix();
      this.#sstMesh.setMatrixAt(i, this.#dummy.matrix);
      this.#sstMesh.setColorAt(i, sstColor(sst));
    }

    this.#sstMesh.count = count;
    this.#sstMesh.instanceMatrix.needsUpdate = true;
    if (this.#sstMesh.instanceColor) this.#sstMesh.instanceColor.needsUpdate = true;
  }

  // dt is in seconds (from THREE.Clock.getDelta())
  update(dt) {
    if (!this.#visible || !this.#paths.length) return;
    for (const path of this.#paths) {
      const adv = path.speed * dt;
      for (let p = 0; p < PER_PATH; p++) {
        path.tArr[p] = (path.tArr[p] + adv) % 1;
      }
    }
    this.#syncParticlePositions();
  }

  dispose() {
    this.#sstMesh?.geometry.dispose();
    this.#sstMesh?.material.dispose();
    this.#sstMesh?.parent?.remove(this.#sstMesh);
    this.#lineGroup?.parent?.remove(this.#lineGroup);
    this.#particles?.geometry.dispose();
    this.#particles?.material.dispose();
    this.#particles?.parent?.remove(this.#particles);
  }
}

export default OceanLayer;
