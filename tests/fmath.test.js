import { describe, expect, it } from 'vitest';
import { sin, cos, atan2, wrapAngle, PI } from '../src/sim/fmath.js';

describe('fmath', () => {
  it('sin/cos match Math within 1e-8 over a wide range', () => {
    for (let x = -20; x <= 20; x += 0.0137) {
      expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThan(1e-8);
      expect(Math.abs(cos(x) - Math.cos(x))).toBeLessThan(1e-8);
    }
  });

  it('atan2 matches Math within 1e-8 in all quadrants', () => {
    for (let a = -PI; a < PI; a += 0.0091) {
      for (const r of [0.01, 1, 37]) {
        const y = r * Math.sin(a);
        const x = r * Math.cos(a);
        expect(Math.abs(atan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-8);
      }
    }
    expect(atan2(0, -1)).toBeCloseTo(PI);
    expect(atan2(1, 0)).toBeCloseTo(PI / 2);
    expect(atan2(0, 0)).toBe(0);
  });

  it('wrapAngle lands in (-π, π]', () => {
    for (const a of [-10, -PI, 0, PI, 3 * PI, 7.5]) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThan(-PI);
      expect(w).toBeLessThanOrEqual(PI);
      expect(Math.abs(Math.sin(w) - Math.sin(a))).toBeLessThan(1e-9);
    }
  });
});
