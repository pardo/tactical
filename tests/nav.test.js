import { describe, expect, it } from 'vitest';
import { parseMap, isWalkableAt, cellCenter, worldToCell } from '../src/sim/map.js';
import { findPath, findCellPath, isClearPath } from '../src/sim/nav.js';
import killhouse from '../src/maps/killhouse.js';

const tiny = parseMap({
  name: 'tiny',
  rows: [
    '#######', //
    '#..#..#',
    '#..D..#',
    '#..#..#',
    '#######',
  ],
});

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

describe('nav', () => {
  it('goes through the door, not the wall', () => {
    const a = cellCenter(tiny, 1, 1);
    const b = cellCenter(tiny, 5, 3);
    const path = findPath(tiny, a.x, a.z, b.x, b.z);
    expect(path).not.toBeNull();
    // Every leg of the smoothed path is collision-free, and the walked line crosses the door tile.
    let prev = a;
    let crossedDoor = false;
    for (const p of path) {
      expect(isClearPath(tiny, prev.x, prev.z, p.x, p.z)).toBe(true);
      for (let t = 0; t <= 1; t += 0.05) {
        const c = worldToCell(tiny, prev.x + (p.x - prev.x) * t, prev.z + (p.z - prev.z) * t);
        if (c.cx === 3 && c.cz === 2) crossedDoor = true;
      }
      prev = p;
    }
    expect(crossedDoor).toBe(true);
  });

  it('returns null for unreachable targets', () => {
    const a = cellCenter(tiny, 1, 1);
    const wall = cellCenter(tiny, 3, 1);
    expect(findPath(tiny, a.x, a.z, wall.x, wall.z)).toBeNull();
    const closed = parseMap({ name: 'closed', rows: ['#####', '#.#.#', '#####'] });
    expect(findCellPath(closed, 1, 1, 3, 1)).toBeNull();
  });

  it('does not cut wall corners diagonally', () => {
    const m = parseMap({ name: 'corner', rows: ['####', '#.##', '##.#', '####'] });
    expect(findCellPath(m, 1, 1, 2, 2)).toBeNull();
  });

  it('smoothed path stays on walkable ground across the killhouse', () => {
    const m = parseMap(killhouse);
    const a = cellCenter(m, 1, 1);
    const b = cellCenter(m, 13, 10); // inside the house, south-west wing
    const path = findPath(m, a.x, a.z, b.x, b.z);
    expect(path).not.toBeNull();
    for (const p of path) expect(isWalkableAt(m, p.x, p.z)).toBe(true);
  });
});
