import { TILES_PER_METRE, upscaleRows } from '../sim/map.js';

/**
 * Map editor state (pure logic, no DOM). Edits the map at full tile resolution
 * (TILES_PER_METRE tiles per metre) with a square brush snapped to its own grid.
 * Every edit is mirrored through the map centre (point symmetry, Blue spawn ↔ Red
 * spawn), so custom maps are fair by construction. The outer border is always wall.
 */
export const TOOLS = [
  { id: '#', label: '▉ Wall' },
  { id: '=', label: '▬ Cover' },
  { id: 'D', label: '🚪 Door' },
  { id: '.', label: '◻ Floor' },
  { id: 'A', label: '⚑ Spawn' },
];
/** Brush sizes in tiles: 1 m, ½ m, ¼ m (thin walls). */
export const BRUSHES = [
  { id: TILES_PER_METRE, label: '1 m' },
  { id: TILES_PER_METRE / 2, label: '½ m' },
  { id: 1, label: '¼ m' },
];
/** Map sizes in metres. */
export const SIZES = [
  [24, 14],
  [32, 18],
  [40, 22],
];
const SWAP = { A: 'B', B: 'A' };

/** A walled W×H metre map with four spawns per team (rows at 1 tile per metre). */
export function blankRows(W, H) {
  const grid = Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (_, x) => (x === 0 || y === 0 || x === W - 1 || y === H - 1 ? '#' : '.')),
  );
  for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) {
    grid[y][x] = 'A';
    grid[H - 1 - y][W - 1 - x] = 'B';
  }
  return grid.map((r) => r.join(''));
}

/** @param res tiles per metre of `rows` (they are upscaled to full resolution) */
export function createEditor({ name = 'My map', rows, res = 1 }) {
  const st = { name, grid: upscaleRows(rows, res).map((r) => [...r]), tool: '#', brush: TILES_PER_METRE, undoStack: [], version: 0 };
  const W = () => st.grid[0].length;
  const H = () => st.grid.length;

  const api = {
    state: st,
    get width() {
      return W();
    },
    get height() {
      return H();
    },
    /** Size in metres. */
    get size() {
      return [W() / TILES_PER_METRE, H() / TILES_PER_METRE];
    },

    /** Call at the start of a tap or drag so the whole stroke undoes in one step. */
    beginStroke() {
      st.undoStack.push(st.grid.map((r) => [...r]));
      if (st.undoStack.length > 100) st.undoStack.shift();
    },

    /**
     * Paint the current tool with the brush square containing tile (cx, cz), and its
     * mirror. Spawns are single tiles (one soldier each), placed like upscaled maps place
     * them. Returns true if anything changed.
     */
    paint(cx, cz) {
      const w = W();
      const h = H();
      const b = st.brush;
      const x0 = Math.floor(cx / b) * b;
      const z0 = Math.floor(cz / b) * b;
      const tool = st.tool;
      const cells = [];
      if (tool === 'A') {
        const lo = Math.floor((b - 1) / 2);
        cells.push([x0 + lo, z0 + lo]);
      } else {
        for (let z = z0; z < z0 + b; z++) for (let x = x0; x < x0 + b; x++) cells.push([x, z]);
      }
      let changed = false;
      for (const [x, z] of cells) {
        if (x <= 0 || z <= 0 || x >= w - 1 || z >= h - 1) continue; // border stays wall
        const mx = w - 1 - x;
        const mz = h - 1 - z;
        if (mx === x && mz === z && tool === 'A') continue; // the centre can't be both teams' spawn
        const mirror = SWAP[tool] ?? tool;
        if (st.grid[z][x] === tool && st.grid[mz][mx] === mirror) continue;
        st.grid[z][x] = tool;
        st.grid[mz][mx] = mirror;
        changed = true;
      }
      if (changed) st.version++;
      return changed;
    },

    undo() {
      const prev = st.undoStack.pop();
      if (!prev) return false;
      st.grid = prev;
      st.version++;
      return true;
    },

    reset(rows, res = 1) {
      api.beginStroke();
      st.grid = upscaleRows(rows, res).map((r) => [...r]);
      st.version++;
    },

    toDef() {
      return { name: st.name.trim() || 'My map', res: TILES_PER_METRE, rows: st.grid.map((r) => r.join('')) };
    },
  };
  return api;
}
