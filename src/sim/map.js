/**
 * Tile map. One tile = 1 m. Tile (cx, cz) covers world x ∈ [cx - w/2, cx - w/2 + 1),
 * so the map is centred on the origin.
 */
export const Tile = Object.freeze({ FLOOR: 0, WALL: 1, LOW_COVER: 2, DOOR: 3 });

const LEGEND = {
  '.': Tile.FLOOR,
  '#': Tile.WALL,
  '=': Tile.LOW_COVER,
  D: Tile.DOOR,
  A: Tile.FLOOR,
  B: Tile.FLOOR,
};

export function parseMap({ name, rows }) {
  const height = rows.length;
  const width = rows[0].length;
  const tiles = new Uint8Array(width * height);
  const spawns = { A: [], B: [] };
  rows.forEach((row, cz) => {
    if (row.length !== width) throw new Error(`map "${name}" row ${cz} has ${row.length} cols, expected ${width}`);
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
  return { name, width, height, tiles, spawns };
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
  return { cx: Math.floor(x + map.width / 2), cz: Math.floor(z + map.height / 2) };
}

export function cellCenter(map, cx, cz) {
  return { x: cx - map.width / 2 + 0.5, z: cz - map.height / 2 + 0.5 };
}

export function isWalkableAt(map, x, z) {
  const { cx, cz } = worldToCell(map, x, z);
  return isWalkable(map, cx, cz);
}
