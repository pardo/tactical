import { Tile } from '../sim/map.js';

/**
 * 2D visibility polygons on the tile grid, for drawing vision cones and fog of war.
 * Render-side only: the sim decides who sees whom with real raycasts; this just
 * shows the same walls (and closed doors, smoke) cutting the view.
 */

const EPS = 1e-4;

/**
 * Blocking test for sight lines: walls, closed doors and the map edge. Low cover
 * is below eye height, so it never blocks.
 * @param doorStates frame door states in door (cell) order; missing = closed
 */
export function sightBlocker(map, doorStates) {
  const doorIdx = new Int32Array(map.width * map.height).fill(-1);
  let n = 0;
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === Tile.DOOR) doorIdx[i] = n++;
  return (cx, cz) => {
    if (cx < 0 || cz < 0 || cx >= map.width || cz >= map.height) return true;
    const i = cz * map.width + cx;
    const t = map.tiles[i];
    if (t === Tile.WALL) return true;
    if (t === Tile.DOOR) return (doorStates?.[doorIdx[i]] ?? 'closed') === 'closed';
    return false;
  };
}

/**
 * Distance along a ray from (x, z) to the first blocking cell (grid DDA), capped at maxDist.
 * World coords; cell (cx, cz) spans x ∈ [cx - w/2, cx - w/2 + 1).
 */
export function castGrid(map, blocked, x, z, dx, dz, maxDist) {
  const gx = x + map.width / 2;
  const gz = z + map.height / 2;
  let cx = Math.floor(gx);
  let cz = Math.floor(gz);
  if (blocked(cx, cz)) return 0;
  const stepX = dx > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tx = dx !== 0 ? (dx > 0 ? cx + 1 - gx : gx - cx) * tdx : Infinity;
  let tz = dz !== 0 ? (dz > 0 ? cz + 1 - gz : gz - cz) * tdz : Infinity;
  for (;;) {
    let t;
    if (tx < tz) {
      t = tx;
      cx += stepX;
      tx += tdx;
    } else {
      t = tz;
      cz += stepZ;
      tz += tdz;
    }
    if (t >= maxDist) return maxDist;
    if (blocked(cx, cz)) return t;
  }
}

/** Nearest entry distance of the ray into any smoke circle, or maxDist. */
function castSmoke(smokes, x, z, dx, dz, maxDist) {
  let best = maxDist;
  for (const s of smokes) {
    const ox = x - s.x;
    const oz = z - s.z;
    const b = ox * dx + oz * dz;
    const c = ox * ox + oz * oz - s.r * s.r;
    if (c <= 0) return 0; // standing inside smoke: sees nothing
    const disc = b * b - c;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t > 0 && t < best) best = t;
  }
  return best;
}

/** Corners of blocking cells that touch open floor: where sight lines graze walls. */
export function gridCorners(map, blocked) {
  const out = [];
  const seen = new Set();
  for (let cz = 0; cz <= map.height; cz++) {
    for (let cx = 0; cx <= map.width; cx++) {
      // Corner (cx, cz) is shared by the four cells around it.
      const a = blocked(cx - 1, cz - 1);
      const b = blocked(cx, cz - 1);
      const c = blocked(cx - 1, cz);
      const d = blocked(cx, cz);
      const k = a + b + c + d;
      // A convex or concave corner: not all-open, not all-blocked, not a straight edge.
      if (k === 0 || k === 4 || (k === 2 && ((a && b) || (c && d) || (a && c) || (b && d)))) continue;
      const key = cz * (map.width + 1) + cx;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cx - map.width / 2, cz - map.height / 2);
    }
  }
  return out;
}

const TAU = Math.PI * 2;
const wrap = (a) => ((a % TAU) + TAU) % TAU;

/**
 * Visibility polygon around (x, z), as rim points in angular order.
 * Inside the cone (heading ± fov/2) sight reaches `range`; elsewhere `nearRange`
 * (0 → just the cone, as a fan from the eye). Heading uses the sim convention:
 * 0 = +z, angles turn toward +x (dir = (sin h, cos h)).
 *
 * @returns { pts: Float32Array [x0, z0, d0, x1, z1, d1, ...] (d = distance), full: bool }
 */
export function visionPolygon(map, blocked, corners, x, z, heading, { fov, range, nearRange = 0, smokes = [], step = (3 * Math.PI) / 180 }) {
  const half = fov / 2;
  const full = nearRange > 0;
  const lo = heading - half;
  const angles = [];
  // Uniform sweep (sim angle = from +z toward +x), plus exact cone edges.
  if (full) {
    for (let a = 0; a < TAU; a += step) angles.push(lo + a);
    angles.push(lo + EPS, lo - EPS, heading + half - EPS, heading + half + EPS);
  } else {
    const n = Math.max(2, Math.ceil(fov / step));
    for (let i = 0; i <= n; i++) angles.push(lo + (fov * i) / n);
  }
  // Rays grazing wall corners give crisp shadow edges.
  const maxR = Math.max(range, nearRange);
  for (let i = 0; i < corners.length; i += 2) {
    const cdx = corners[i] - x;
    const cdz = corners[i + 1] - z;
    if (cdx * cdx + cdz * cdz > maxR * maxR) continue;
    const a = Math.atan2(cdx, cdz);
    if (!full && wrap(a - lo) > fov) continue;
    angles.push(a - EPS, a + EPS);
  }
  // Sort by angle measured from the cone's start so the fan never wraps mid-cone.
  const rel = angles.map((a) => wrap(a - lo)).filter((r) => full || r <= fov + EPS);
  rel.sort((p, q) => p - q);
  const pts = new Float32Array(rel.length * 3);
  let n = 0;
  let last = -1;
  for (const r of rel) {
    if (r - last < EPS / 4) continue;
    last = r;
    const a = lo + r;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const inCone = r <= fov;
    const reach = inCone ? range : nearRange;
    let d = castGrid(map, blocked, x, z, dx, dz, reach);
    if (smokes.length) d = Math.min(d, castSmoke(smokes, x, z, dx, dz, reach));
    pts[n++] = x + dx * d;
    pts[n++] = z + dz * d;
    pts[n++] = d;
  }
  return { pts: pts.subarray(0, n), full };
}
