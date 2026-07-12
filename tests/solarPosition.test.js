import { describe, it, expect } from 'vitest';
import { solarPosition } from '../core/solarPosition.js';

describe('solarPosition', () => {
  it('returns valid lat/lon', () => {
    const { lat, lon } = solarPosition(Date.now());
    expect(lat).toBeGreaterThanOrEqual(-90);
    expect(lat).toBeLessThanOrEqual(90);
    expect(lon).toBeGreaterThanOrEqual(-180);
    expect(lon).toBeLessThanOrEqual(180);
  });

  it('declination near 0 at equinox (Mar 20 2024 UTC)', () => {
    const equinox = new Date('2024-03-20T03:06:00Z').getTime();
    const { lat } = solarPosition(equinox);
    expect(Math.abs(lat)).toBeLessThan(1.5);   // within 1.5° of equator
  });

  it('max declination ~+23.4° near summer solstice (Jun 21 2024 UTC)', () => {
    const solstice = new Date('2024-06-21T00:00:00Z').getTime();
    const { lat } = solarPosition(solstice);
    expect(lat).toBeGreaterThan(22);
    expect(lat).toBeLessThan(25);
  });

  it('min declination ~-23.4° near winter solstice (Dec 21 2024 UTC)', () => {
    const solstice = new Date('2024-12-21T00:00:00Z').getTime();
    const { lat } = solarPosition(solstice);
    expect(lat).toBeLessThan(-22);
    expect(lat).toBeGreaterThan(-25);
  });

  it('sunDir is a unit vector', () => {
    const { sunDir } = solarPosition(Date.now());
    const mag = Math.sqrt(sunDir.x**2 + sunDir.y**2 + sunDir.z**2);
    expect(mag).toBeCloseTo(1, 5);
  });
});
