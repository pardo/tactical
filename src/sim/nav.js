import { isWalkable, isWalkableAt, worldToCell, cellCenter } from './map.js';
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

/** Grid A*; returns the list of cells from start to goal (inclusive) or null. */
export function findCellPath(map, sx, sz, gx, gz) {
  if (!isWalkable(map, sx, sz) || !isWalkable(map, gx, gz)) return null;
  const w = map.width;
  const g = new Int32Array(w * map.height).fill(-1);
  const from = new Int32Array(w * map.height).fill(-1);
  const closed = new Uint8Array(w * map.height);
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
      if (!isWalkable(map, nx, nz)) continue;
      // No corner cutting: a diagonal step needs both orthogonal cells open.
      if (dx && dz && (!isWalkable(map, cx + dx, cz) || !isWalkable(map, cx, cz + dz))) continue;
      const ni = nz * w + nx;
      const ng = g[i] + cost;
      if (closed[ni] || (g[ni] !== -1 && ng >= g[ni])) continue;
      g[ni] = ng;
      from[ni] = i;
      const h = octile(nx, nz, gx, gz);
      open.push({ i: ni, f: ng + h, h });
    }
  }

  if (g[goal] === -1) return null;
  const cells = [];
  for (let i = goal; i !== -1; i = from[i]) cells.push({ cx: i % w, cz: Math.floor(i / w) });
  return cells.reverse();
}

/** True if a disc of radius r can slide from a to b without touching blocked tiles. */
export function isClearPath(map, ax, az, bx, bz, r = SOLDIER_RADIUS) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = length(dx, dz);
  const steps = Math.max(1, Math.ceil(len / 0.2));
  const px = len > 0 ? (-dz / len) * r : 0;
  const pz = len > 0 ? (dx / len) * r : 0;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const x = ax + dx * t;
    const z = az + dz * t;
    if (!isWalkableAt(map, x, z) || !isWalkableAt(map, x + px, z + pz) || !isWalkableAt(map, x - px, z - pz)) {
      return false;
    }
  }
  return true;
}

/** Nudge a point away from blocked neighbours so a soldier standing there doesn't overlap a wall. */
export function clampToClearance(map, x, z, r = SOLDIER_RADIUS) {
  const { cx, cz } = worldToCell(map, x, z);
  const minX = cx - map.width / 2;
  const minZ = cz - map.height / 2;
  if (!isWalkable(map, cx - 1, cz)) x = Math.max(x, minX + r);
  if (!isWalkable(map, cx + 1, cz)) x = Math.min(x, minX + 1 - r);
  if (!isWalkable(map, cx, cz - 1)) z = Math.max(z, minZ + r);
  if (!isWalkable(map, cx, cz + 1)) z = Math.min(z, minZ + 1 - r);
  return { x, z };
}

/**
 * World-space path from (sx, sz) to (tx, tz), smoothed by skipping waypoints
 * that have a clear straight line. Excludes the start point. Null if unreachable.
 */
export function findPath(map, sx, sz, tx, tz) {
  const s = worldToCell(map, sx, sz);
  const t = worldToCell(map, tx, tz);
  const cells = findCellPath(map, s.cx, s.cz, t.cx, t.cz);
  if (!cells) return null;

  const goal = clampToClearance(map, tx, tz);
  const pts = cells.map(({ cx, cz }) => cellCenter(map, cx, cz));
  pts[0] = { x: sx, z: sz };
  if (pts.length > 1) pts[pts.length - 1] = goal;
  else pts.push(goal);

  const out = [];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !isClearPath(map, pts[i].x, pts[i].z, pts[j].x, pts[j].z)) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}
