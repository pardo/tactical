import { createRng } from './rng.js';
import { createHasher } from './hash.js';
import { createPhysicsWorld, RAPIER } from './physics.js';
import { Tile, cellCenter } from './map.js';
import { createSoldier, updateSoldier } from './soldier/soldier.js';
import { PI } from './fmath.js';

// Physical heights, used for line-of-sight later. The renderer draws walls shorter for readability.
export const WALL_HEIGHT = 2.4;
export const LOW_COVER_HEIGHT = 1.0;

/**
 * Deterministic world state. No Three.js, DOM, or wall-clock time in here.
 * Soldiers live in an array ordered by id so iteration order is stable.
 */
export function createWorld(seed, map) {
  const physics = createPhysicsWorld();
  physics.createCollider(RAPIER.ColliderDesc.cuboid(map.width / 2, 0.1, map.height / 2).setTranslation(0, -0.1, 0));
  addMapColliders(physics, map);
  return { tick: 0, rng: createRng(seed), physics, map, soldiers: [], nextId: 1 };
}

/** One cuboid per horizontal run of identical tiles keeps the collider count low. */
function addMapColliders(physics, map) {
  const heights = { [Tile.WALL]: WALL_HEIGHT, [Tile.LOW_COVER]: LOW_COVER_HEIGHT };
  for (let cz = 0; cz < map.height; cz++) {
    let cx = 0;
    while (cx < map.width) {
      const t = map.tiles[cz * map.width + cx];
      const h = heights[t];
      if (h === undefined) {
        cx++;
        continue;
      }
      let end = cx;
      while (end + 1 < map.width && map.tiles[cz * map.width + end + 1] === t) end++;
      const len = end - cx + 1;
      const c = cellCenter(map, cx, cz);
      physics.createCollider(
        RAPIER.ColliderDesc.cuboid(len / 2, h / 2, 0.5).setTranslation(c.x - 0.5 + len / 2, h / 2, c.z),
      );
      cx = end + 1;
    }
  }
}

export function spawnSquads(world, perTeam = 4) {
  for (const team of ['A', 'B']) {
    const cells = world.map.spawns[team];
    for (let i = 0; i < Math.min(perTeam, cells.length); i++) {
      const c = cellCenter(world.map, cells[i].cx, cells[i].cz);
      createSoldier(world, { team, x: c.x, z: c.z, heading: team === 'A' ? 0 : PI });
    }
  }
}

export function step(world) {
  for (const s of world.soldiers) updateSoldier(s);
  world.physics.step();
  world.tick++;
}

export function hashWorld(world) {
  const h = createHasher().num(world.tick).num(world.rng.state);
  for (const s of world.soldiers) {
    h.num(s.id).str(s.team).num(s.x).num(s.z).num(s.heading).str(s.moveMode).num(s.path.length);
    for (const p of s.path) h.num(p.x).num(p.z);
  }
  return h.digest();
}
