import { describe, expect, it } from 'vitest';
import { parseMap, isWalkableAt, worldToCell, cellCenter, doorIdAt } from '../src/sim/map.js';
import { metre } from './helpers.js';
import { findPath, findCellPath, isClearPath, isNavigable } from '../src/sim/nav.js';
import killhouse from '../src/maps/killhouse.js';


describe('map', () => {
  it('parses killhouse with 4 spawns per team', () => {
    const m = parseMap(killhouse);
    expect(m.spawns.A).toHaveLength(4);
    expect(m.spawns.B).toHaveLength(4);
  });

  it('killhouse is point-symmetric so both teams get the same map', () => {
    const rows = killhouse.rows;
    const swap = { A: 'B', B: 'A' };
    rows.forEach((row, z) =>
      [...row].forEach((ch, x) => {
        const mirrored = rows[rows.length - 1 - z][row.length - 1 - x];
        expect(swap[ch] ?? ch).toBe(mirrored);
      }),
    );
  });

  it('rejects ragged rows', () => {
    expect(() => parseMap({ name: 'bad', rows: ['###', '##'] })).toThrow(/cols/);
  });
});

// Two 2.25 m rooms at full resolution (4 tiles per metre), split by a thin wall with
// a 1 m door; `gap(n)` instead leaves an n-tile hole in the wall.
const ROW = '#.........#.........#';
const rooms = (mid) => [
  '#'.repeat(21),
  ...Array(4).fill(ROW),
  ...mid,
  ...Array(4).fill(ROW),
  '#'.repeat(21),
];
const tiny = parseMap({ name: 'tiny', res: 4, rows: rooms(Array(4).fill('#.........D.........#')) });
const gap = (n) => parseMap({ name: 'gap', res: 4, rows: rooms(Array(4).fill(null).map((_, i) => (i < n ? '#...................#' : ROW))) });

describe('nav', () => {
  it('goes through the door, not the wall', () => {
    const a = cellCenter(tiny, 2, 2);
    const b = cellCenter(tiny, 18, 10);
    const path = findPath(tiny, a.x, a.z, b.x, b.z);
    expect(path).not.toBeNull();
    // Every leg of the smoothed path is collision-free, and the walked line crosses the door.
    let prev = a;
    let crossedDoor = false;
    for (const p of path) {
      expect(isClearPath(tiny, prev.x, prev.z, p.x, p.z)).toBe(true);
      for (let t = 0; t <= 1; t += 0.05) {
        const c = worldToCell(tiny, prev.x + (p.x - prev.x) * t, prev.z + (p.z - prev.z) * t);
        if (doorIdAt(tiny, c.cx, c.cz) === 0) crossedDoor = true;
      }
      prev = p;
    }
    expect(crossedDoor).toBe(true);
  });

  it('returns null for unreachable targets', () => {
    const a = cellCenter(tiny, 2, 2);
    const wall = cellCenter(tiny, 10, 2);
    expect(findPath(tiny, a.x, a.z, wall.x, wall.z)).toBeNull();
    const closed = gap(0);
    expect(findCellPath(closed, 2, 2, 18, 2)).toBeNull();
  });

  it('soldiers fit through a 0.75 m gap but not a 0.5 m one', () => {
    for (const [n, ok] of [[2, false], [3, true]]) {
      const m = gap(n);
      const a = cellCenter(m, 2, 2);
      const b = cellCenter(m, 18, 2);
      expect(findPath(m, a.x, a.z, b.x, b.z) !== null).toBe(ok);
    }
  });

  it('keeps a soldier-radius clear of walls', () => {
    expect(isNavigable(tiny, 1, 5)).toBe(false); // touching the outer wall
    expect(isNavigable(tiny, 2, 5)).toBe(true);
    expect(isNavigable(tiny, 9, 5)).toBe(false); // touching the thin wall
  });

  it('smoothed path stays on walkable ground across the killhouse', () => {
    const m = parseMap(killhouse);
    const a = metre(m, 1, 1);
    const b = metre(m, 13, 10); // inside the house, south-west wing
    const path = findPath(m, a.x, a.z, b.x, b.z);
    expect(path).not.toBeNull();
    for (const p of path) expect(isWalkableAt(m, p.x, p.z)).toBe(true);
  });
});
