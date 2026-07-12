/**
 * EarthOS SolarPosition — compute the subsolar point (lat/lon directly under the sun).
 * Uses Spencer's simplified solar algorithm (±0.5° accuracy, sufficient for globe shading).
 *
 * Returns: { lat, lon, azimuthRad, declinationRad }
 * lon = 0° at UTC 12:00 on equinox (Greenwich solar noon)
 */

const TWO_PI = 2 * Math.PI;
const DEG    = Math.PI / 180;

export function solarPosition(ts = Date.now()) {
  const d  = new Date(ts);
  const jd = ts / 86_400_000 + 2440587.5;          // Julian day
  const n  = jd - 2451545.0;                        // days since J2000
  const L  = (280.460 + 0.9856474 * n) % 360;      // mean longitude (deg)
  const g  = ((357.528 + 0.9856003 * n) % 360) * DEG; // mean anomaly (rad)
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG; // ecliptic lon
  const eps = (23.439 - 0.0000004 * n) * DEG;       // obliquity

  const sinDec = Math.sin(eps) * Math.sin(lam);
  const dec    = Math.asin(sinDec);                  // solar declination (rad)

  // Greenwich Mean Sidereal Time → hour angle at prime meridian
  const UT    = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const GMST  = (6.697375 + 0.0657098242 * n + UT) % 24;         // hours
  const RA    = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)); // right ascension
  const HA    = (GMST * 15 * DEG) - RA;              // hour angle at Greenwich

  // Subsolar point: sun is directly overhead here
  const subLat = dec / DEG;
  let   subLon = (-HA / DEG) % 360;
  if (subLon > 180)  subLon -= 360;
  if (subLon < -180) subLon += 360;

  // Sun direction vector (ECI → simplified as direction toward subsolar point)
  const phi = (90 - subLat) * DEG;
  const th  = (subLon + 180) * DEG;
  const sunDir = {
    x: Math.sin(phi) * Math.cos(th),
    y: Math.cos(phi),
    z: Math.sin(phi) * Math.sin(th),
  };

  return { lat: subLat, lon: subLon, declinationRad: dec, sunDir };
}

export default solarPosition;
