import { CELL, isWalkable, worldToCell, cellCenter } from './map.js';
import { length } from './fmath.js';

export const SOLDIER_RADIUS = 0.3;

// Integer costs keep A* exact and deterministic.
const STRAIGHT = 10;
const DIAGONAL = 14;
const DIRS = [
  [1, 0, STRAIGHT],
  [-1, 0, STRAIGHT],
  [0, 1, STRAIGHT],
  [0, -1, STRAIGHT],
  [1, 1, DIAGONAL],
  [1, -1, DIAGONAL],
  [-1, 1, DIAGONAL],
  [-1, -1, DIAGONAL],
];

function octile(ax, az, bx, bz) {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return STRAIGHT * Math.max(dx, dz) + (DIAGONAL - STRAIGHT) * Math.min(dx, dz);
}

/** Min-heap ordered by (f, h, index) so ties always break the same way. */
class Heap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  static less(a, b) {
    return a.f !== b.f ? a.f < b.f : a.h !== b.h ? a.h < b.h : a.i < b.i;
  }
  push(node) {
    const a = this.items;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!Heap.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && Heap.less(a[l], a[m])) m = l;
        if (r < a.length && Heap.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Navigation grid: tiles where a soldier (a disc of SOLDIER_RADIUS) can stand
 * centred without overlapping a wall or cover. Doors count as open ground (soldiers
 * open them on the way). Cached per tiles array; call tilesChanged() after editing tiles.
 */
const navCache = new WeakMap();

export function tilesChanged(map) {
  navCache.delete(map.tiles);
}

function navGrid(map) {
  let nav = navCache.get(map.tiles);
  if (nav) return nav;
  const { width: w, height: h } = map;
  nav = new Uint8Array(w * h);
  const K = Math.ceil(SOLDIER_RADIUS / CELL + 0.5);
  for (let cz = 0; cz < h; cz++) {
    for (let cx = 0; cx < w; cx++) {
      if (!isWalkable(map, cx, cz)) continue;
      let ok = true;
      for (let oz = -K; oz <= K && ok; oz++) {
        for (let ox = -K; ox <= K; ox++) {
          if (isWalkable(map, cx + ox, cz + oz)) continue;
          // Distance from this tile's centre to the blocked tile's square.
          const dx = Math.max(0, Math.abs(ox) * CELL - CELL / 2);
          const dz = Math.max(0, Math.abs(oz) * CELL - CELL / 2);
          if (dx * dx + dz * dz < SOLDIER_RADIUS * SOLDIER_RADIUS - 1e-9) {
            ok = false;
            break;
          }
        }
      }
      nav[cz * w + cx] = ok ? 1 : 0;
    }
  }
  navCache.set(map.tiles, nav);
  return nav;
}

/** True if a soldier can stand centred on tile (cx, cz). */
export function isNavigable(map, cx, cz) {
  if (cx < 0 || cz < 0 || cx >= map.width || cz >= map.height) return false;
  return navGrid(map)[cz * map.width + cx] === 1;
}

/** Nearest navigable tile to world point (x, z) within maxDist metres, or null. Ties: lowest index. */
export function nearestNavigable(map, x, z, maxDist) {
  const c = worldToCell(map, x, z);
  if (isNavigable(map, c.cx, c.cz)) return c;
  const R = Math.ceil(maxDist / CELL);
  let best = null;
  let bestD = maxDist * maxDist + 1e-9;
  for (let oz = -R; oz <= R; oz++) {
    for (let ox = -R; ox <= R; ox++) {
      const cx = c.cx + ox;
      const cz = c.cz + oz;
      if (!isNavigable(map, cx, cz)) continue;
      const p = cellCenter(map, cx, cz);
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD - 1e-9) {
        bestD = d;
        best = { cx, cz };
      }
    }
  }
  return best;
}

/** Grid A* over navigable tiles; returns the list of cells from start to goal (inclusive) or null. */
export function findCellPath(map, sx, sz, gx, gz) {
  if (!isNavigable(map, sx, sz) || !isNavigable(map, gx, gz)) return null;
  const nav = navGrid(map);
  const w = map.width;
  const h = map.height;
  const ok = (x, z) => x >= 0 && z >= 0 && x < w && z < h && nav[z * w + x] === 1;
  const g = new Int32Array(w * h).fill(-1);
  const from = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  const start = sz * w + sx;
  const goal = gz * w + gx;
  g[start] = 0;
  const open = new Heap();
  const h0 = octile(sx, sz, gx, gz);
  open.push({ i: start, f: h0, h: h0 });

  while (open.size) {
    const { i } = open.pop();
    if (closed[i]) continue;
    if (i === goal) break;
    closed[i] = 1;
    const cx = i % w;
    const cz = (i - cx) / w;
    for (const [dx, dz, cost] of DIRS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!ok(nx, nz)) continue;
      // No corner cutting: a diagonal step needs both orthogonal cells open.
      if (dx && dz && (!ok(cx + dx, cz) || !ok(cx, cz + dz))) continue;
      const ni = nz * w + nx;
      const ng = g[i] + cost;
      if (closed[ni] || (g[ni] !== -1 && ng >= g[ni])) continue;
      g[ni] = ng;
      from[ni] = i;
      const hh = octile(nx, nz, gx, gz);
      open.push({ i: ni, f: ng + hh, h: hh });
    }
  }

  if (g[goal] === -1) return null;
  const cells = [];
  for (let i = goal; i !== -1; i = from[i]) cells.push({ cx: i % w, cz: Math.floor(i / w) });
  return cells.reverse();
}

/** True if a disc of radius r centred at (x, z) touches no wall or cover tile. */
export function isClearAt(map, x, z, r = SOLDIER_RADIUS) {
  const a = worldToCell(map, x - r, z - r);
  const b = worldToCell(map, x + r, z + r);
  const minX = -map.sizeX / 2;
  const minZ = -map.sizeZ / 2;
  for (let cz = a.cz; cz <= b.cz; cz++) {
    for (let cx = a.cx; cx <= b.cx; cx++) {
      if (isWalkable(map, cx, cz)) continue;
      const x0 = minX + cx * CELL;
      const z0 = minZ + cz * CELL;
      const dx = Math.max(x0 - x, 0, x - x0 - CELL);
      const dz = Math.max(z0 - z, 0, z - z0 - CELL);
      if (dx * dx + dz * dz < r * r - 1e-9) return false;
    }
  }
  return true;
}

/** True if a disc of radius r can slide from a to b without touching blocked tiles. */
export function isClearPath(map, ax, az, bx, bz, r = SOLDIER_RADIUS) {
  const dx = bx - ax;
  const dz = bz - az;
  const steps = Math.max(1, Math.ceil(length(dx, dz) / (CELL / 2)));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    if (!isClearAt(map, ax + dx * t, az + dz * t, r)) return false;
  }
  return true;
}

// How far a waypoint or a soldier may be off the navigation grid and still get a path.
const GOAL_SNAP = 0.5;
const START_SNAP = 1.5;

/**
 * World-space path from (sx, sz) to (tx, tz), smoothed by skipping waypoints
 * that have a clear straight line. Excludes the start point. Null if unreachable
 * (including a target inside a wall or cover, or too tight a spot to stand in).
 */
export function findPath(map, sx, sz, tx, tz) {
  if (!isWalkable(map, worldToCell(map, tx, tz).cx, worldToCell(map, tx, tz).cz)) return null;
  const s = nearestNavigable(map, sx, sz, START_SNAP);
  const t = nearestNavigable(map, tx, tz, GOAL_SNAP);
  if (!s || !t) return null;
  const cells = findCellPath(map, s.cx, s.cz, t.cx, t.cz);
  if (!cells) return null;

  const goal = isClearAt(map, tx, tz) ? { x: tx, z: tz } : cellCenter(map, t.cx, t.cz);
  const pts = cells.map(({ cx, cz }) => cellCenter(map, cx, cz));
  pts[0] = { x: sx, z: sz };
  if (pts.length > 1) pts[pts.length - 1] = goal;
  else pts.push(goal);

  // Greedy string pulling: from each kept point, go as far along the cell path as stays clear.
  const out = [];
  let i = 0;
  while (i < pts.length - 1) {
    let j = i + 1;
    while (j + 1 < pts.length && isClearPath(map, pts[i].x, pts[i].z, pts[j + 1].x, pts[j + 1].z)) j++;
    out.push(pts[j]);
    i = j;
  }
  return out;
}
