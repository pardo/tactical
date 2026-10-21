import { createRng } from './rng.js';
import { createHasher } from './hash.js';
import { createPhysicsWorld, RAPIER } from './physics.js';
import { Tile, cellCenter } from './map.js';
import { createSoldier, resolveDeaths } from './soldier/soldier.js';
import { updatePerception } from './soldier/perception.js';
import { updateCombat } from './soldier/combat.js';
import { updateOrders } from './soldier/orders.js';
import { updateGrenades } from './grenades.js';
import { sanitizeWaypoints, sanitizeGoCodes } from './plan.js';
import { PI } from './fmath.js';
import { DEFAULT_SQUAD, sanitizeSquad } from './roles.js';
import { createDoors } from './doors.js';
import { createObjective, updateObjective } from './objective.js';

// Physical heights, used for line of sight. The renderer draws walls shorter for readability.
export const WALL_HEIGHT = 2.4;
export const LOW_COVER_HEIGHT = 1.0;
export const TEAMS = ['A', 'B'];

/**
 * Deterministic world state. No Three.js, DOM, or wall-clock time in here.
 * Soldiers live in an array ordered by id so iteration order is stable.
 */
export function createWorld(seed, map, mode = 'elimination') {
  const physics = createPhysicsWorld();
  physics.createCollider(RAPIER.ColliderDesc.cuboid(map.width / 2, 0.1, map.height / 2).setTranslation(0, -0.1, 0));
  const coverColliders = addMapColliders(physics, map);
  const doors = createDoors(physics, map);
  // Build the query structures so line-of-sight works before the first tick.
  physics.step();
  return {
    tick: 0,
    turnStart: 0,
    doors,
    coverColliders, // cell index → collider, so single cover tiles can be destroyed
    destroyed: [], // cell indexes of destroyed cover, in destruction order
    rng: createRng(seed),
    physics,
    map,
    soldiers: [],
    grenades: [],
    smokes: [],
    events: [],
    winner: null,
    objective: createObjective(mode),
    goCodes: { A: [], B: [] }, // go codes each team released this turn
    nextId: 1,
  };
}

/**
 * Walls: one cuboid per horizontal run (keeps the collider count low).
 * Low cover: one cuboid per tile, because it can be destroyed.
 * @returns Map of cell index → cover collider
 */
function addMapColliders(physics, map) {
  const cover = new Map();
  for (let cz = 0; cz < map.height; cz++) {
    let cx = 0;
    while (cx < map.width) {
      const t = map.tiles[cz * map.width + cx];
      if (t === Tile.LOW_COVER) {
        const c = cellCenter(map, cx, cz);
        const desc = RAPIER.ColliderDesc.cuboid(0.5, LOW_COVER_HEIGHT / 2, 0.5).setTranslation(c.x, LOW_COVER_HEIGHT / 2, c.z);
        cover.set(cz * map.width + cx, physics.createCollider(desc));
        cx++;
        continue;
      }
      const h = t === Tile.WALL ? WALL_HEIGHT : undefined;
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
  return cover;
}


/** @param squads { A: roleId[], B: roleId[] } */
export function spawnSquads(world, squads = { A: DEFAULT_SQUAD, B: DEFAULT_SQUAD }) {
  for (const team of TEAMS) {
    const cells = world.map.spawns[team];
    const roles = sanitizeSquad(squads[team]);
    for (let i = 0; i < Math.min(roles.length, cells.length); i++) {
      const c = cellCenter(world.map, cells[i].cx, cells[i].cz);
      createSoldier(world, { team, role: roles[i], x: c.x, z: c.z, heading: team === 'A' ? PI / 2 : -PI / 2 });
    }
  }
}

/**
 * Replace a team's orders. `plans` maps soldierId → waypoints. Soldiers whose plan
 * is unchanged keep their progress (e.g. half-finished waits).
 */
export function applyPlans(world, team, plans) {
  world.goCodes[team] = sanitizeGoCodes(plans?.go);
  for (const s of world.soldiers) {
    if (s.team !== team || !s.alive || !(s.id in plans)) continue;
    const orders = sanitizeWaypoints(world.map, plans[s.id]);
    if (JSON.stringify(orders) === JSON.stringify(s.orders)) continue;
    s.orders = orders;
    s.path = [];
    s.pathReady = false;
    s.arrived = false;
    s.actionIdx = 0;
    s.actionTimer = 0;
  }
}

/** Mark the start of a 5 s turn (for 'until' actions). Called once per turn by the match, for both teams. */
export function beginTurnClock(world) {
  world.turnStart = world.tick;
}

export function step(world) {
  world.events = [];
  if (world.winner) return;
  updatePerception(world);
  // Alternate update order every tick so neither team systematically moves first.
  const n = world.soldiers.length;
  for (let k = 0; k < n; k++) {
    const s = world.soldiers[world.tick % 2 ? n - 1 - k : k];
    if (!s.alive) continue;
    const engaged = updateCombat(world, s);
    updateOrders(world, s, engaged);
  }
  updateGrenades(world);
  resolveDeaths(world);
  world.physics.step();
  world.tick++;

  const alive = (team) => world.soldiers.some((s) => s.team === team && s.alive);
  const a = alive('A');
  const b = alive('B');
  if (!a || !b) world.winner = a ? 'A' : b ? 'B' : 'draw';
  else updateObjective(world);
}

function hashValue(h, v) {
  if (v === null || v === undefined) h.str('~');
  else if (typeof v === 'number') h.num(v);
  else if (typeof v === 'string') h.str(v).str('|');
  else if (typeof v === 'boolean') h.str(v ? 'T' : 'F');
  else if (Array.isArray(v)) {
    h.str('[');
    for (const x of v) hashValue(h, x);
    h.str(']');
  } else {
    for (const k of Object.keys(v).sort()) {
      h.str(k);
      hashValue(h, v[k]);
    }
  }
}

export function hashWorld(world) {
  const h = createHasher().num(world.tick).num(world.rng.state).str(world.winner ?? '-');
  for (const s of world.soldiers) hashValue(h, s);
  for (const g of world.grenades) {
    const p = g.body.translation();
    const v = g.body.linvel();
    h.num(g.id).str(g.kind).num(g.fuse).num(p.x).num(p.y).num(p.z).num(v.x).num(v.y).num(v.z);
  }
  for (const s of world.smokes) h.num(s.x).num(s.z).num(s.r).num(s.until);
  h.num(world.turnStart);
  for (const i of world.destroyed) h.num(i);
  if (world.objective) hashValue(h, world.objective);
  for (const d of world.doors) h.num(d.id).str(d.state);
  for (const t of TEAMS) h.str(t).str(world.goCodes[t].join(''));
  return h.digest();
}
