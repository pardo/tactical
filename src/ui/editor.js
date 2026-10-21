/**
 * Map editor state (pure logic, no DOM). Every edit is mirrored through the
 * map centre (point symmetry, Blue spawn ↔ Red spawn), so custom maps are fair
 * by construction. The outer border is always wall.
 */
export const TOOLS = [
  { id: '#', label: '▉ Wall' },
  { id: '=', label: '▬ Cover' },
  { id: 'D', label: '🚪 Door' },
  { id: '.', label: '◻ Floor' },
  { id: 'A', label: '⚑ Spawn' },
];
export const SIZES = [
  [24, 14],
  [32, 18],
  [40, 22],
];
const SWAP = { A: 'B', B: 'A' };

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

export function createEditor({ name = 'My map', rows }) {
  const st = { name, grid: rows.map((r) => [...r]), tool: '#', undoStack: [], version: 0 };
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

    /** Call at the start of a tap or drag so the whole stroke undoes in one step. */
    beginStroke() {
      st.undoStack.push(st.grid.map((r) => [...r]));
      if (st.undoStack.length > 100) st.undoStack.shift();
    },

    /** Paint the current tool at a cell (and its mirror). Returns true if anything changed. */
    paint(cx, cz) {
      const w = W();
      const h = H();
      if (cx <= 0 || cz <= 0 || cx >= w - 1 || cz >= h - 1) return false; // border stays wall
      const mx = w - 1 - cx;
      const mz = h - 1 - cz;
      const tool = st.tool;
      if (mx === cx && mz === cz && tool === 'A') return false; // the centre can't be both teams' spawn
      const mirror = SWAP[tool] ?? tool;
      if (st.grid[cz][cx] === tool && st.grid[mz][mx] === mirror) return false;
      st.grid[cz][cx] = tool;
      st.grid[mz][mx] = mirror;
      st.version++;
      return true;
    },

    undo() {
      const prev = st.undoStack.pop();
      if (!prev) return false;
      st.grid = prev;
      st.version++;
      return true;
    },

    reset(rows) {
      api.beginStroke();
      st.grid = rows.map((r) => [...r]);
      st.version++;
    },

    toDef() {
      return { name: st.name.trim() || 'My map', rows: st.grid.map((r) => r.join('')) };
    },
  };
  return api;
}
