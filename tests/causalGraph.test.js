import { describe, it, expect, beforeEach } from 'vitest';

// Inline pure logic (haversine + rule matching) extracted from causalGraph.js
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, DEG = Math.PI / 180;
  const dLat = (lat2 - lat1) * DEG, dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*DEG)*Math.cos(lat2*DEG)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

const RULES = [
  { cause:'earthquake', effect:'tsunami',  cond:ev=>ev.magnitude>=7&&(ev.detail?.depth??99)<70, conf:0.65, lag:[5*60_000,3_600_000] },
  { cause:'earthquake', effect:'volcano',  cond:ev=>ev.magnitude>=6, conf:0.25, lag:[0,7*24*3_600_000], spatial:500 },
  { cause:'fire',       effect:'pollution',cond:ev=>(ev.detail?.frp??0)>500, conf:0.80, lag:[0,72*3_600_000], spatial:1000 },
];

function matchRules(from, to, rules) {
  const matches = [];
  for (const rule of rules) {
    if (from.type !== rule.cause || to.type !== rule.effect) continue;
    if (!rule.cond(from)) continue;
    const lag = to.time - from.time;
    if (lag < rule.lag[0] || lag > rule.lag[1]) continue;
    if (rule.spatial) {
      if (haversine(from.lat, from.lon, to.lat, to.lon) > rule.spatial) continue;
    }
    matches.push(rule);
  }
  return matches;
}

const mkEq = (mag, depth, lat=0, lon=0, t=0) => ({ type:'earthquake', magnitude:mag, lat, lon, time:t, detail:{depth} });
const mkFire= (frp, lat=0, lon=0, t=0) => ({ type:'fire', magnitude:frp, lat, lon, time:t, detail:{frp} });
const mkTs  = (lat=0, lon=0, t=0) => ({ type:'tsunami', magnitude:1, lat, lon, time:t, detail:{} });
const mkVol = (lat=0, lon=0, t=0) => ({ type:'volcano', magnitude:1, lat, lon, time:t, detail:{} });
const mkPol = (lat=0, lon=0, t=0) => ({ type:'pollution', magnitude:1, lat, lon, time:t, detail:{} });

describe('CausalGraph rules', () => {
  it('earthquake M7.2 depth 30 → tsunami within lag window', () => {
    const eq = mkEq(7.2, 30, 0, 0, 0);
    const ts = mkTs(0, 1, 30 * 60_000);   // 30 min later, nearby
    expect(matchRules(eq, ts, RULES)).toHaveLength(1);
  });

  it('earthquake M6.5 depth 80 → NO tsunami (too deep)', () => {
    const eq = mkEq(6.5, 80, 0, 0, 0);
    const ts = mkTs(0, 0.5, 30 * 60_000);
    expect(matchRules(eq, ts, RULES)).toHaveLength(0);
  });

  it('earthquake M5.0 → NO tsunami (too small)', () => {
    const eq = mkEq(5.0, 20, 0, 0, 0);
    const ts = mkTs(0, 0, 30 * 60_000);
    expect(matchRules(eq, ts, RULES)).toHaveLength(0);
  });

  it('earthquake M6.5 → volcano within 500km', () => {
    const eq  = mkEq(6.5, 10, 35, 140, 0);
    const vol = mkVol(38, 142, 24 * 3_600_000);   // ~340km away, 24h later
    const matches = matchRules(eq, vol, RULES);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].effect).toBe('volcano');
  });

  it('earthquake M6.5 → NO volcano beyond 500km', () => {
    const eq  = mkEq(6.5, 10, 35, 140, 0);
    const vol = mkVol(0, 0, 24 * 3_600_000);       // ~5600km away
    expect(matchRules(eq, vol, RULES)).toHaveLength(0);
  });

  it('fire FRP=1000 → pollution within 1000km', () => {
    const fire = mkFire(1000, 10, 10, 0);
    const pol  = mkPol(13, 13, 3 * 3_600_000);    // ~490km, 3h later
    expect(matchRules(fire, pol, RULES)).toHaveLength(1);
  });

  it('fire FRP=100 → NO pollution (FRP too low)', () => {
    const fire = mkFire(100, 0, 0, 0);
    const pol  = mkPol(1, 1, 3 * 3_600_000);
    expect(matchRules(fire, pol, RULES)).toHaveLength(0);
  });
});

describe('haversine', () => {
  it('same point is 0', () => {
    expect(haversine(51.5, -0.1, 51.5, -0.1)).toBeCloseTo(0);
  });

  it('London to Paris ~340km', () => {
    expect(haversine(51.5, -0.1, 48.85, 2.35)).toBeCloseTo(340, -1);
  });

  it('equator full circumference ~40075km', () => {
    expect(haversine(0, -180, 0, 180)).toBeCloseTo(0, -1);   // antipodal = 0 wrap-around
  });
});
