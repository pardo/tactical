import { describe, it, expect } from 'vitest';
import { parseMap } from '../src/sim/map.js';
import { thick } from './helpers.js';
import { sightBlocker, castGrid, gridCorners, visionPolygon } from '../src/render/visibility.js';

// 9×5 room: wall column at cx=4 with a door at row 2.
const map = parseMap(thick({
  name: 't',
  rows: ['#########', '#...#...#', '#...D...#', '#...#...#', '#########'],
}));

describe('visibility', () => {
  it('walls stop rays; open doors let them through', () => {
    const closed = sightBlocker(map, ['closed']);
    const open = sightBlocker(map, ['open']);
    // From (-2.5, 0) (cell 2,2) looking +x: wall cell 4 starts at x = -0.5 → 2 m away.
    expect(castGrid(map, closed, -2.5, 0, 1, 0, 20)).toBeCloseTo(2, 5);
    // Door open: next block is the outer wall at x = 3.5 → 6 m.
    expect(castGrid(map, open, -2.5, 0, 1, 0, 20)).toBeCloseTo(6, 5);
    expect(castGrid(map, open, -2.5, 0, 1, 0, 3)).toBe(3);
  });

  it('cone polygon stays inside the room and within the fov', () => {
    const blocked = sightBlocker(map, ['closed']);
    const corners = gridCorners(map, blocked);
    // Heading π/2 = +x.
    const { pts } = visionPolygon(map, blocked, corners, -2.5, 0, Math.PI / 2, { fov: (120 * Math.PI) / 180, range: 35 });
    expect(pts.length).toBeGreaterThan(30);
    for (let i = 0; i < pts.length; i += 3) {
      expect(pts[i]).toBeLessThanOrEqual(-0.5 + 1e-3); // never past the dividing wall
      expect(Math.abs(pts[i + 1])).toBeLessThanOrEqual(1.5 + 1e-3);
      const a = Math.atan2(pts[i] + 2.5, pts[i + 1]);
      expect(Math.abs(a - Math.PI / 2)).toBeLessThanOrEqual(Math.PI / 3 + 1e-3);
    }
  });

  it('full polygon includes the short ring behind the soldier', () => {
    const blocked = sightBlocker(map, ['closed']);
    const { pts, full } = visionPolygon(map, blocked, [], -2.5, 0, Math.PI / 2, { fov: Math.PI / 2, range: 35, nearRange: 0.5 });
    expect(full).toBe(true);
    const behind = [];
    for (let i = 0; i < pts.length; i += 3) if (pts[i] < -2.5 - 0.1) behind.push(pts[i + 2]);
    expect(behind.length).toBeGreaterThan(0);
    for (const d of behind) expect(d).toBeLessThanOrEqual(0.5 + 1e-6);
  });

  it('smoke cuts the view', () => {
    const blocked = sightBlocker(map, ['open']);
    const { pts } = visionPolygon(map, blocked, [], -2.5, 0, Math.PI / 2, { fov: 0.1, range: 35, smokes: [{ x: 0, z: 0, r: 0.5 }] });
    for (let i = 0; i < pts.length; i += 3) expect(pts[i + 2]).toBeLessThan(2.1);
  });
});
