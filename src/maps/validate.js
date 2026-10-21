/**
 * Checks a map definition is playable. Used by the editor (live feedback),
 * when receiving a custom map online / in a replay, and by tests.
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
const LEGAL = new Set(['#', '.', '=', 'D', 'A', 'B']);
export const MIN_SIZE = 10;
export const MAX_SIZE = 64;

export function validateMapDef(def) {
  const errors = [];
  const warnings = [];
  const rows = def?.rows;
  if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'string') return { ok: false, errors: ['no rows'], warnings };
  const H = rows.length;
  const W = rows[0].length;
  if (W < MIN_SIZE || H < MIN_SIZE || W > MAX_SIZE || H > MAX_SIZE) errors.push(`size must be ${MIN_SIZE}–${MAX_SIZE} tiles per side`);
  if (rows.some((r) => typeof r !== 'string' || r.length !== W)) return { ok: false, errors: ['rows have different lengths'], warnings };
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? '#' : rows[y][x]);

  let spawnsA = 0;
  let spawnsB = 0;
  const walkable = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = rows[y][x];
      if (!LEGAL.has(c)) {
        errors.push(`unknown tile "${c}" at ${x},${y}`);
        continue;
      }
      if (c === 'A') spawnsA++;
      if (c === 'B') spawnsB++;
      if (c !== '#' && c !== '=') walkable.push(y * W + x);
      if (c === 'D') {
        const inRow = at(x - 1, y) === '#' && at(x + 1, y) === '#';
        const inCol = at(x, y - 1) === '#' && at(x, y + 1) === '#';
        if (!inRow && !inCol) errors.push(`door at ${x},${y} must sit in a straight wall`);
      }
    }
  }
  if (spawnsA < 4) errors.push(`Blue needs 4 spawn tiles (has ${spawnsA})`);
  if (spawnsB < 4) errors.push(`Red needs 4 spawn tiles (has ${spawnsB})`);

  // Everything walkable must be reachable from everything else.
  if (walkable.length) {
    const seen = new Uint8Array(W * H);
    const queue = [walkable[0]];
    seen[walkable[0]] = 1;
    while (queue.length) {
      const i = queue.pop();
      const x = i % W;
      const y = (i - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const c = at(nx, ny);
        const j = ny * W + nx;
        if (c !== '#' && c !== '=' && !seen[j]) {
          seen[j] = 1;
          queue.push(j);
        }
      }
    }
    const unreachable = walkable.filter((i) => !seen[i]).length;
    if (unreachable) errors.push(`${unreachable} floor tile${unreachable === 1 ? ' is' : 's are'} unreachable`);
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
