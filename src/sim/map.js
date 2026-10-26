/**
 * Tile map. One tile = CELL metres. Tile (cx, cz) covers world
 * x ∈ [cx·CELL − sizeX/2, (cx + 1)·CELL − sizeX/2), so the map is centred on the origin.
 *
 * Map definitions are ASCII rows at `res` tiles per metre (1, 2 or 4; default 1).
 * Coarser maps are upscaled on load, so a 1 m wall is just 4×4 tiles and a
 * 0.25 m thin wall is one tile thick.
 */
export const CELL = 0.25;
export const TILES_PER_METRE = Math.round(1 / CELL);
export const MAP_RES = [1, 2, 4];

export const Tile = Object.freeze({ FLOOR: 0, WALL: 1, LOW_COVER: 2, DOOR: 3 });

const LEGEND = {
  '.': Tile.FLOOR,
  '#': Tile.WALL,
  '=': Tile.LOW_COVER,
  D: Tile.DOOR,
  A: Tile.FLOOR,
  B: Tile.FLOOR,
};

/**
 * Rows at `res` tiles per metre → rows at full resolution. Each spawn tile becomes one
 * spawn tile inside its block, placed so a 180° rotation maps A's onto B's: point-symmetric
 * maps stay symmetric.
 *
 * Walls in 1 m maps are drawn thin (see thinWalls); finer maps are taken as drawn.
 */
export function upscaleRows(rows, res = 1) {
  const k = TILES_PER_METRE / res;
  if (k === 1) return rows.slice();
  const lo = Math.floor((k - 1) / 2);
  const hi = k - 1 - lo;
  const out = [];
  for (const row of rows) {
    for (let dz = 0; dz < k; dz++) {
      let line = '';
      for (const ch of row) {
        for (let dx = 0; dx < k; dx++) {
          if (ch === 'A') line += dx === lo && dz === lo ? 'A' : '.';
          else if (ch === 'B') line += dx === hi && dz === hi ? 'B' : '.';
          else line += ch;
        }
      }
      out.push(line);
    }
  }
  return res === 1 ? thinWalls(rows, out, k) : out;
}

/**
 * 1 m wall blocks → one-tile walls. Each wall (or door) block draws a line through
 * itself toward each wall/door neighbour; blocks on the map edge sit flush with it.
 * The line's offset inside the block is mirrored between the two map halves, so
 * point symmetry survives. Doors become a one-tile-thick opening in the line, lone
 * pillars stay solid, and floor sealed off by the new lines is filled in.
 */
function thinWalls(coarse, fine, k) {
  const H = coarse.length;
  const W = coarse[0].length;
  const grid = fine.map((r) => [...r]);
  const solid = (x, z) => x < 0 || z < 0 || x >= W || z >= H || coarse[z][x] === '#' || coarse[z][x] === 'D';
  const lo = Math.floor((k - 1) / 2);
  const hi = k - 1 - lo;
  const offset = (b, n) => (b === 0 ? 0 : b === n - 1 ? k - 1 : b < n / 2 ? lo : hi);
  for (let bz = 0; bz < H; bz++) {
    for (let bx = 0; bx < W; bx++) {
      const ch = coarse[bz][bx];
      if (ch !== '#' && ch !== 'D') continue;
      const inside = (x, z) => x >= 0 && z >= 0 && x < W && z < H;
      const nb = {
        l: inside(bx - 1, bz) && solid(bx - 1, bz),
        r: inside(bx + 1, bz) && solid(bx + 1, bz),
        u: inside(bx, bz - 1) && solid(bx, bz - 1),
        d: inside(bx, bz + 1) && solid(bx, bz + 1),
      };
      const onEdge = bx === 0 || bz === 0 || bx === W - 1 || bz === H - 1;
      if (ch === '#' && !onEdge && !nb.l && !nb.r && !nb.u && !nb.d) continue; // lone pillar: keep the block
      const px = offset(bx, W);
      const pz = offset(bz, H);
      const x0 = bx * k;
      const z0 = bz * k;
      for (let dz = 0; dz < k; dz++) for (let dx = 0; dx < k; dx++) grid[z0 + dz][x0 + dx] = '.';
      // Map edge: the edge itself is the wall line.
      const lines = [];
      if (bx === 0 || bx === W - 1) lines.push(['v', px, 0, k - 1]);
      if (bz === 0 || bz === H - 1) lines.push(['h', pz, 0, k - 1]);
      if (ch === 'D') {
        const alongX = solid(bx - 1, bz) && solid(bx + 1, bz);
        lines.push(alongX ? ['h', pz, 0, k - 1] : ['v', px, 0, k - 1]);
      } else {
        lines.push(['h', pz, nb.l ? 0 : px, nb.r ? k - 1 : px]);
        lines.push(['v', px, nb.u ? 0 : pz, nb.d ? k - 1 : pz]);
      }
      for (const [dir, at, a, b] of lines) {
        for (let t = a; t <= b; t++) {
          const [x, z] = dir === 'h' ? [x0 + t, z0 + at] : [x0 + at, z0 + t];
          grid[z][x] = ch === 'D' && !onEdge ? 'D' : '#';
        }
      }
      if (ch === 'D') {
        // Connect the door line's ends to walls drawn on the other axis' offset.
        const alongX = solid(bx - 1, bz) && solid(bx + 1, bz);
        if (alongX) grid[z0 + pz][x0] = grid[z0 + pz][x0 + k - 1] = 'D';
        else grid[z0][x0 + px] = grid[z0 + k - 1][x0 + px] = 'D';
      }
    }
  }
  // Fill floor the thin walls sealed off (walls only; cover and doors can be crossed).
  const h = grid.length;
  const w = grid[0].length;
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) if (grid[z][x] === 'A' || grid[z][x] === 'B') stack.push(z * w + x);
  for (const i of stack) seen[i] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const z = (i - x) / w;
    for (const [nx, nz] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]) {
      if (nx < 0 || nz < 0 || nx >= w || nz >= h || grid[nz][nx] === '#') continue;
      const j = nz * w + nx;
      if (seen[j]) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  if (seen.some(Boolean)) {
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) if (!seen[z * w + x] && grid[z][x] !== '#') grid[z][x] = '#';
  }
  return grid.map((r) => r.join(''));
}

export function parseMap({ name, rows, res = 1 }) {
  if (!MAP_RES.includes(res)) throw new Error(`map "${name}" res must be one of ${MAP_RES.join(', ')}`);
  rows.forEach((row, cz) => {
    if (row.length !== rows[0].length) throw new Error(`map "${name}" row ${cz} has ${row.length} cols, expected ${rows[0].length}`);
  });
  rows = upscaleRows(rows, res);
  const height = rows.length;
  const width = rows[0].length;
  const tiles = new Uint8Array(width * height);
  const spawns = { A: [], B: [] };
  rows.forEach((row, cz) => {
    for (let cx = 0; cx < width; cx++) {
      const ch = row[cx];
      const tile = LEGEND[ch];
      if (tile === undefined) throw new Error(`map "${name}" unknown tile '${ch}' at ${cx},${cz}`);
      tiles[cz * width + cx] = tile;
      if (ch === 'A' || ch === 'B') spawns[ch].push({ cx, cz });
    }
  });
  // Team B's spawns are listed in reverse, so on point-symmetric maps the i-th
  // soldier of each team starts in mirror-image positions.
  spawns.B.reverse();
  const map = { name, width, height, sizeX: width * CELL, sizeZ: height * CELL, tiles, spawns };
  Object.assign(map, findDoors(map));
  return map;
}

/**
 * Doors: each 4-connected group of door tiles is one door. It runs along the wall
 * it sits in (axis 'x' if the wall continues left/right of it, else 'z').
 * @returns {{ doors: object[], doorIndex: Int16Array }} doorIndex: tile → door id or -1
 */
function findDoors(map) {
  const { width, height, tiles } = map;
  const doorIndex = new Int16Array(width * height).fill(-1);
  const doors = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== Tile.DOOR || doorIndex[i] >= 0) continue;
    const id = doors.length;
    let x0 = width;
    let z0 = height;
    let x1 = -1;
    let z1 = -1;
    const stack = [i];
    doorIndex[i] = id;
    while (stack.length) {
      const j = stack.pop();
      const cx = j % width;
      const cz = (j - cx) / width;
      x0 = Math.min(x0, cx);
      x1 = Math.max(x1, cx);
      z0 = Math.min(z0, cz);
      z1 = Math.max(z1, cz);
      for (const [nx, nz] of [[cx - 1, cz], [cx + 1, cz], [cx, cz - 1], [cx, cz + 1]]) {
        if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
        const k = nz * width + nx;
        if (tiles[k] === Tile.DOOR && doorIndex[k] < 0) {
          doorIndex[k] = id;
          stack.push(k);
        }
      }
    }
    const wallX = tileAt(map, x0 - 1, z0) === Tile.WALL || tileAt(map, x1 + 1, z0) === Tile.WALL;
    const wallZ = tileAt(map, x0, z0 - 1) === Tile.WALL || tileAt(map, x0, z1 + 1) === Tile.WALL;
    // A square door between walls on both axes: the longer wall decides; default x.
    const axis = wallX || !wallZ ? 'x' : 'z';
    const c0 = cellCenter(map, x0, z0);
    const c1 = cellCenter(map, x1, z1);
    const spanX = (x1 - x0 + 1) * CELL;
    const spanZ = (z1 - z0 + 1) * CELL;
    doors.push({
      id,
      x0,
      z0,
      x1,
      z1,
      x: (c0.x + c1.x) / 2,
      z: (c0.z + c1.z) / 2,
      axis,
      width: axis === 'x' ? spanX : spanZ, // opening width
      depth: axis === 'x' ? spanZ : spanX, // wall thickness
    });
  }
  return { doors, doorIndex };
}

export function tileAt(map, cx, cz) {
  if (cx < 0 || cz < 0 || cx >= map.width || cz >= map.height) return Tile.WALL;
  return map.tiles[cz * map.width + cx];
}

export function isWalkable(map, cx, cz) {
  const t = tileAt(map, cx, cz);
  return t === Tile.FLOOR || t === Tile.DOOR;
}

export function worldToCell(map, x, z) {
  return { cx: Math.floor((x + map.sizeX / 2) / CELL), cz: Math.floor((z + map.sizeZ / 2) / CELL) };
}

export function cellCenter(map, cx, cz) {
  return { x: (cx + 0.5) * CELL - map.sizeX / 2, z: (cz + 0.5) * CELL - map.sizeZ / 2 };
}

/**
 * What a soldier on tile (cx, cz) has right in front of them in direction (dx, dz)
 * (a unit grid step): the first non-walkable tile within `reach` metres, or null.
 */
export function blockerToward(map, cx, cz, dx, dz, reach = 0.6) {
  // Tile k's near edge is (k − ½)·CELL from this tile's centre.
  const n = Math.floor(reach / CELL + 0.5);
  for (let k = 1; k <= n; k++) {
    const t = tileAt(map, cx + dx * k, cz + dz * k);
    if (t === Tile.LOW_COVER || t === Tile.WALL) return t;
  }
  return null;
}

/** Door id at a tile, or -1. */
export function doorIdAt(map, cx, cz) {
  if (cx < 0 || cz < 0 || cx >= map.width || cz >= map.height) return -1;
  return map.doorIndex[cz * map.width + cx];
}

export function isWalkableAt(map, x, z) {
  const { cx, cz } = worldToCell(map, x, z);
  return isWalkable(map, cx, cz);
}
