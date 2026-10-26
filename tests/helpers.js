/** Centre of the 1 m square (mx, mz) of a map: tests are written against 1-tile-per-metre rows. */
export const metre = (map, mx, mz) => ({ x: mx + 0.5 - map.sizeX / 2, z: mz + 0.5 - map.sizeZ / 2 });

/**
 * A 1-tile-per-metre test map upscaled with solid 1 m walls (no wall thinning), so
 * geometry written against the old grid keeps its exact extents. Spawns as in upscaleRows.
 */
export function thick(def) {
  const rows = [];
  for (const row of def.rows) {
    for (let dz = 0; dz < 4; dz++) {
      rows.push([...row].map((ch) => (ch === 'A' ? (dz === 1 ? '.A..' : '....') : ch === 'B' ? (dz === 2 ? '..B.' : '....') : ch.repeat(4))).join(''));
    }
  }
  return { ...def, res: 4, rows };
}
