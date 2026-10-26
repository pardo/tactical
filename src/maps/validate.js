import { parseMap, MAP_RES, CELL, Tile, tileAt } from '../sim/map.js';
import { isNavigable } from '../sim/nav.js';

/**
 * Checks a map definition is playable. Used by the editor (live feedback),
 * when receiving a custom map online / in a replay, and by tests.
 * Sizes and areas are reported in metres whatever the def's resolution.
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
const LEGAL = new Set(['#', '.', '=', 'D', 'A', 'B']);
export const MIN_SIZE = 10; // metres
export const MAX_SIZE = 64;
/** Narrowest door a soldier can walk through (they are 0.6 m wide). */
const MIN_DOOR = 0.75;

export function validateMapDef(def) {
  const errors = [];
  const warnings = [];
  const rows = def?.rows;
  const res = def?.res ?? 1;
  if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'string') return { ok: false, errors: ['no rows'], warnings };
  if (!MAP_RES.includes(res)) return { ok: false, errors: [`res must be one of ${MAP_RES.join(', ')}`], warnings };
  const H = rows.length;
  const W = rows[0].length;
  if (rows.some((r) => typeof r !== 'string' || r.length !== W)) return { ok: false, errors: ['rows have different lengths'], warnings };
  if (W / res < MIN_SIZE || H / res < MIN_SIZE || W / res > MAX_SIZE || H / res > MAX_SIZE) {
    errors.push(`size must be ${MIN_SIZE}–${MAX_SIZE} m per side`);
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = rows[y][x];
      if (!LEGAL.has(c)) {
        errors.push(`unknown tile "${c}" at ${x},${y}`);
        return { ok: false, errors, warnings };
      }
    }
  }
  if (errors.length) return { ok: false, errors, warnings };

  const map = parseMap({ name: def.name ?? 'map', rows, res });
  const spawnsA = map.spawns.A.length;
  const spawnsB = map.spawns.B.length;
  if (spawnsA < 4) errors.push(`Blue needs 4 spawn tiles (has ${spawnsA})`);
  if (spawnsB < 4) errors.push(`Red needs 4 spawn tiles (has ${spawnsB})`);
  const cramped = [...map.spawns.A, ...map.spawns.B].filter(({ cx, cz }) => !isNavigable(map, cx, cz)).length;
  if (cramped) errors.push(`${cramped} spawn${cramped === 1 ? ' is' : 's are'} too close to a wall`);

  for (const d of map.doors) {
    const at = `${(d.x0 * CELL).toFixed(2)},${(d.z0 * CELL).toFixed(2)} m`;
    const inRow = tileAt(map, d.x0 - 1, d.z0) === Tile.WALL && tileAt(map, d.x1 + 1, d.z0) === Tile.WALL;
    const inCol = tileAt(map, d.x0, d.z0 - 1) === Tile.WALL && tileAt(map, d.x0, d.z1 + 1) === Tile.WALL;
    if (!inRow && !inCol) errors.push(`door at ${at} must sit in a straight wall`);
    else if (d.width < MIN_DOOR - 1e-9) errors.push(`door at ${at} is too narrow (${d.width} m, min ${MIN_DOOR} m)`);
  }

  // Everywhere a soldier can stand must be reachable from everywhere else.
  const { width: w, height: h } = map;
  const nav = [];
  for (let i = 0; i < w * h; i++) if (isNavigable(map, i % w, (i / w) | 0)) nav.push(i);
  if (nav.length) {
    const seen = new Uint8Array(w * h);
    const queue = [nav[0]];
    seen[nav[0]] = 1;
    while (queue.length) {
      const i = queue.pop();
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const j = ny * w + nx;
        if (isNavigable(map, nx, ny) && !seen[j]) {
          seen[j] = 1;
          queue.push(j);
        }
      }
    }
    const unreachable = nav.filter((i) => !seen[i]).length * CELL * CELL;
    if (unreachable) errors.push(`${+unreachable.toFixed(2)} m² of floor is unreachable`);
  }

  // Point symmetry keeps it fair; not required, but worth flagging.
  const swap = { A: 'B', B: 'A' };
  let symmetric = true;
  for (let y = 0; y < H && symmetric; y++) {
    for (let x = 0; x < W; x++) {
      const c = rows[y][x];
      if ((swap[c] ?? c) !== rows[H - 1 - y][W - 1 - x]) {
        symmetric = false;
        break;
      }
    }
  }
  if (!symmetric) warnings.push('not point-symmetric: one side may have an advantage');
  return { ok: errors.length === 0, errors, warnings };
}
