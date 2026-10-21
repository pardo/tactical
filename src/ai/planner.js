import { createRng } from '../sim/rng.js';
import { findPath } from '../sim/nav.js';
import { hasLineOfSight } from '../sim/los.js';
import { Tile, tileAt, isWalkable, cellCenter, worldToCell } from '../sim/map.js';
import { makeWaypoint } from '../sim/plan.js';
import { TURN_TICKS } from '../sim/constants.js';
import { GRENADE_RANGE, GRENADE } from '../sim/grenades.js';
import { EYE_HEIGHT, BODY_HEIGHT } from '../sim/soldier/soldier.js';
import { doorAt, BREACH_REACH } from '../sim/doors.js';

/**
 * Turn-based AI opponent. It only uses what its own team has seen (no wallhacks):
 * it remembers enemy sightings and plans with the same waypoint format as a human.
 */
/** How each soldier role behaves when no enemy is in sight. */
const BEHAVIOUR = { breacher: 'assault', rifleman: 'assault', demolition: 'flank', lmg: 'overwatch', sniper: 'overwatch' };
const OVERWATCH_RADIUS = { lmg: 7, sniper: 10 };
const FLASH_RANGE = 10;
const FORGET_AFTER = TURN_TICKS * 4;
/** Search grid: the map is split into SECTOR×SECTOR metre cells, each remembering when we last had eyes on it. */
const SECTOR = 4;
const SEARCH_SIGHT = 6;

const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);

function centroid(points) {
  const n = points.length;
  return { x: points.reduce((s, p) => s + p.x, 0) / n, z: points.reduce((s, p) => s + p.z, 0) / n };
}

/** Point `d` metres along the walkable route from s toward target. */
function pointAlongPath(world, s, target, d) {
  const path = findPath(world.map, s.x, s.z, target.x, target.z);
  if (!path) return { x: s.x, z: s.z };
  let prev = { x: s.x, z: s.z };
  let left = d;
  for (const p of path) {
    const seg = dist(prev, p);
    if (seg >= left) {
      const t = left / seg;
      return { x: prev.x + (p.x - prev.x) * t, z: prev.z + (p.z - prev.z) * t };
    }
    left -= seg;
    prev = p;
  }
  return prev;
}

/**
 * First closed door on the walking route from s to dest, with a stacking point
 * just before it (within breaching reach).
 */
function closedDoorOnRoute(world, s, dest) {
  const path = findPath(world.map, s.x, s.z, dest.x, dest.z);
  if (!path) return null;
  let prev = { x: s.x, z: s.z };
  const behind = [];
  for (const p of path) {
    const len = dist(prev, p);
    const n = Math.max(1, Math.ceil(len / 0.25));
    for (let k = 1; k <= n; k++) {
      const q = { x: prev.x + ((p.x - prev.x) * k) / n, z: prev.z + ((p.z - prev.z) * k) / n };
      const door = doorAt(world, q.x, q.z);
      if (door && door.state === 'closed') {
        // Walk back along the route to a point ~1.2 m from the door.
        const stack = [...behind].reverse().find((b) => dist(b, door) >= 1.1) ?? { x: s.x, z: s.z };
        return dist(stack, door) <= BREACH_REACH ? { door, stack } : null;
      }
      behind.push(q);
    }
    prev = p;
  }
  return null;
}

const ORTHO = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** What protects cell (cx, cz) from a threat at `threat`: 'low', 'wall' or null. */
function coverAgainst(map, cx, cz, threat) {
  const c = cellCenter(map, cx, cz);
  const dx = threat.x - c.x;
  const dz = threat.z - c.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  let best = null;
  for (const [ox, oz] of ORTHO) {
    if ((ox * dx + oz * dz) / len < 0.6) continue;
    const t = tileAt(map, cx + ox, cz + oz);
    if (t === Tile.LOW_COVER) return 'low';
    if (t === Tile.WALL) best = 'wall';
  }
  return best;
}

/** Best reachable tile within `radius` of `near`, preferring low cover facing the threat. */
function findSpot(world, s, near, threat, radius, taken) {
  const { map } = world;
  const c = worldToCell(map, near.x, near.z);
  const R = Math.ceil(radius);
  const candidates = [];
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      const cx = c.cx + dx;
      const cz = c.cz + dz;
      if (!isWalkable(map, cx, cz) || tileAt(map, cx, cz) === Tile.DOOR) continue;
      const p = cellCenter(map, cx, cz);
      const d = dist(p, near);
      if (d > radius + 0.01 || taken.some((t) => dist(t, p) < 1.2)) continue;
      const cover = threat ? coverAgainst(map, cx, cz, threat) : null;
      const score = d + (cover === 'low' ? 0 : cover === 'wall' ? 1.5 : 3);
      candidates.push({ x: p.x, z: p.z, cover, score });
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.x - b.x || a.z - b.z);
  return candidates.find((p) => findPath(map, s.x, s.z, p.x, p.z)) ?? null;
}

/** A tile within `radius` of s that can see `threat` from standing eye height. */
function findOverwatch(world, s, threat, radius, taken) {
  const { map } = world;
  const c = worldToCell(map, s.x, s.z);
  const R = Math.ceil(radius);
  let best = null;
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      const cx = c.cx + dx;
      const cz = c.cz + dz;
      if (!isWalkable(map, cx, cz) || tileAt(map, cx, cz) === Tile.DOOR) continue;
      const p = cellCenter(map, cx, cz);
      if (dist(p, s) > radius || taken.some((t) => dist(t, p) < 1.2)) continue;
      if (!hasLineOfSight(world, p.x, EYE_HEIGHT.stand, p.z, threat.x, BODY_HEIGHT.stand, threat.z)) continue;
      const cover = coverAgainst(map, cx, cz, threat);
      const score = dist(p, s) * 0.5 + (cover === 'low' ? 0 : 3) - Math.min(dist(p, threat), 20) * 0.1;
      if (!best || score < best.score) best = { x: p.x, z: p.z, cover, score };
    }
  }
  return best && findPath(map, s.x, s.z, best.x, best.z) ? best : null;
}

export function createAI(team, seed = 1) {
  const memory = new Map(); // enemyId → { x, z, tick }
  const enemyTeam = team === 'A' ? 'B' : 'A';
  let sectors = null; // last tick each sector was near one of our soldiers
  let searchTarget = null;

  function sectorGrid(map) {
    if (!sectors) {
      const cols = Math.ceil(map.width / SECTOR);
      const rows = Math.ceil(map.height / SECTOR);
      sectors = { cols, rows, seen: new Float64Array(cols * rows).fill(-Infinity) };
    }
    return sectors;
  }

  /** A walkable point in the sector we have checked least recently (ties: closest to us). */
  function pickSearchTarget(world, home) {
    const { map } = world;
    const grid = sectorGrid(map);
    let best = null;
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const seen = grid.seen[r * grid.cols + c];
        let p = null;
        for (let dz = 0; dz < SECTOR && !p; dz++) {
          for (let dx = 0; dx < SECTOR && !p; dx++) {
            const cx = c * SECTOR + ((dx + 2) % SECTOR);
            const cz = r * SECTOR + ((dz + 2) % SECTOR);
            if (isWalkable(map, cx, cz) && tileAt(map, cx, cz) !== Tile.DOOR) p = cellCenter(map, cx, cz);
          }
        }
        if (!p) continue;
        const d = dist(p, home);
        if (!best || seen < best.seen || (seen === best.seen && d < best.d)) best = { x: p.x, z: p.z, seen, d };
      }
    }
    return best && { x: best.x, z: best.z };
  }

  /** Call after every sim tick: remember what the team sees. */
  function observe(world) {
    for (const s of world.soldiers) {
      if (s.team !== team || !s.alive) continue;
      for (const id of s.visible) {
        const e = world.soldiers.find((o) => o.id === id);
        memory.set(id, { x: e.x, z: e.z, tick: world.tick });
      }
    }
    for (const e of world.soldiers) if (!e.alive) memory.delete(e.id);

    const grid = sectorGrid(world.map);
    for (const s of world.soldiers) {
      if (s.team !== team || !s.alive) continue;
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          const x = (c + 0.5) * SECTOR - world.map.width / 2;
          const z = (r + 0.5) * SECTOR - world.map.height / 2;
          if (dist({ x, z }, s) <= SEARCH_SIGHT) grid.seen[r * grid.cols + c] = world.tick;
        }
      }
    }
  }

  /** @returns {{ plans: Record<number, object[]>, notes: Record<number, string> }} */
  function plan(world) {
    const turn = Math.floor(world.tick / TURN_TICKS);
    const rng = createRng((seed * 7919 + turn * 104729 + (team === 'A' ? 1 : 2)) >>> 0);
    for (const [id, m] of memory) if (world.tick - m.tick > FORGET_AFTER) memory.delete(id);

    const squad = world.soldiers.filter((s) => s.team === team);
    const own = squad.filter((s) => s.alive);
    const known = [...memory.entries()].sort((a, b) => a[0] - b[0]).map(([id, m]) => ({ id, ...m }));
    const spawnCentroid = centroid(world.map.spawns[enemyTeam].map(({ cx, cz }) => cellCenter(world.map, cx, cz)));
    const home = own.length ? centroid(own) : spawnCentroid;
    let objective;
    let objLabel;
    if (known.length) {
      objective = known.reduce((a, b) => (dist(a, home) <= dist(b, home) ? a : b));
      objLabel = `last seen #${objective.id}`;
      searchTarget = null;
    } else {
      // Nobody in sight: first head for the enemy spawn, then sweep stale sectors.
      if (!searchTarget) searchTarget = turn <= 1 ? spawnCentroid : pickSearchTarget(world, home);
      if (own.some((s) => dist(s, searchTarget) < 3)) searchTarget = pickSearchTarget(world, home);
      objective = searchTarget ?? spawnCentroid;
      objLabel = `search (${objective.x.toFixed(0)}, ${objective.z.toFixed(0)})`;
    }

    const plans = {};
    const notes = {};
    const taken = [];

    for (const s of own) {
      const role = BEHAVIOUR[s.role] ?? 'assault';
      const wps = [];
      let note;

      const seen = s.visible.map((id) => world.soldiers.find((o) => o.id === id));
      if (seen.length) {
        // In a firefight: get into cover close by, crouch, keep the enemy in the sights.
        const enemy = seen.reduce((a, b) => (dist(a, s) <= dist(b, s) ? a : b));
        const spot = findSpot(world, s, s, enemy, 2.5, taken);
        const wp = makeWaypoint(spot && dist(spot, s) > 0.6 ? spot.x : s.x, spot && dist(spot, s) > 0.6 ? spot.z : s.z);
        wp.look = { x: enemy.x, z: enemy.z };
        if (!spot || spot.cover) wp.actions.push({ type: 'stance', stance: 'crouch' });
        wp.actions.push({ type: 'face', x: enemy.x, z: enemy.z }, { type: 'wait', t: 5 });
        wps.push(wp);
        taken.push(wp);
        note = `engaging #${enemy.id} → ${spot?.cover ? `${spot.cover} cover` : 'hold'}`;
      } else {
        let dest;
        let spot;
        if (role === 'overwatch' && known.length) {
          spot = findOverwatch(world, s, objective, OVERWATCH_RADIUS[s.role] ?? 7, taken);
          dest = spot ?? pointAlongPath(world, s, objective, 4);
        } else if (role === 'overwatch') {
          // Nothing to watch yet: creep forward with the search, a bit behind the assaulters.
          dest = pointAlongPath(world, s, objective, rng.range(3, 5));
        } else if (role === 'flank') {
          const dx = objective.x - s.x;
          const dz = objective.z - s.z;
          const len = Math.sqrt(dx * dx + dz * dz) || 1;
          const side = s.id % 2 ? 1 : -1;
          dest = { x: s.x + (dx / len) * 6 - (dz / len) * 5 * side, z: s.z + (dz / len) * 6 + (dx / len) * 5 * side };
        } else {
          dest = pointAlongPath(world, s, objective, rng.range(5, 8));
        }
        spot ??= findSpot(world, s, dest, objective, 2, taken) ?? findSpot(world, s, pointAlongPath(world, s, objective, 5), objective, 2, taken);

        if (spot) {
          const wp = makeWaypoint(spot.x, spot.z);
          const far = !known.length && dist(s, objective) > 18 && role !== 'overwatch';
          wp.move = far ? 'run' : 'walk';
          if (known.length) wp.look = { x: objective.x, z: objective.z };
          if (spot.cover === 'low') wp.actions.push({ type: 'stance', stance: 'crouch' });
          else wp.actions.push({ type: 'stance', stance: 'stand' });
          wp.actions.push({ type: 'face', x: objective.x, z: objective.z }, { type: 'wait', t: 5 });
          wps.push(wp);
          taken.push(spot);
          note = `${role} → ${wp.move} to ${spot.cover ? `${spot.cover} cover` : 'open ground'}, watching ${objLabel}`;

          // Breachers blow closed doors on the way instead of opening them by hand.
          const route = s.charges > 0 && role !== 'overwatch' ? closedDoorOnRoute(world, s, spot) : null;
          if (route) {
            const stackWp = makeWaypoint(route.stack.x, route.stack.z);
            stackWp.actions.push({ type: 'breach', x: route.door.x, z: route.door.z });
            wp.move = 'run';
            wps.unshift(stackWp);
            note += ' · breach door first';
          }
        } else {
          note = `${role} → no spot found, holding`;
        }
      }

      // Frag (or flash, for breachers) a recently seen enemy we can't currently see.
      const kind = s.gear.frag > 0 ? 'frag' : s.gear.flash > 0 ? 'flash' : null;
      const maxRange = kind === 'flash' ? FLASH_RANGE : GRENADE_RANGE;
      const fresh = known.filter((k) => world.tick - k.tick <= TURN_TICKS * 2);
      const nade =
        kind &&
        fresh.find((k) => {
          const d = dist(k, s);
          if (d < 5 || d > maxRange) return false;
          if (s.visible.includes(k.id)) return false;
          if (world.soldiers.some((o) => o.team === team && o.alive && dist(o, k) < GRENADE[kind].radius)) return false;
          return !hasLineOfSight(world, s.x, EYE_HEIGHT.stand, s.z, k.x, 1, k.z);
        });
      if (nade && rng.next() < 0.6) {
        const wp = makeWaypoint(s.x, s.z);
        wp.actions.push({ type: 'grenade', kind, x: nade.x, z: nade.z });
        wps.unshift(wp);
        note += ` · ${kind} at #${nade.id}`;
      }

      plans[s.id] = wps;
      notes[s.id] = note;
    }
    return { plans, notes };
  }

  return { team, memory, observe, plan };
}
