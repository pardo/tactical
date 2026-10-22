import { createWorld } from '../sim/world.js';
import { launchGrenadeBody, GRENADE } from '../sim/grenades.js';
import { hasLineOfSight } from '../sim/los.js';
import { DT } from '../sim/constants.js';
import { EYE_HEIGHT } from '../sim/soldier/soldier.js';

/** A change in horizontal direction sharper than this (cos of the angle) counts as hitting a wall. */
const WALL_TURN = 0.8;

/**
 * Predicts grenade flights for the planning view by throwing them in a private
 * copy of the map's static physics (walls, low cover, doors as they are now).
 * The throw uses the sim's own launch code, so the arc, bounces and resting
 * point match the real thing unless a door opens or cover is blown first.
 */
export function createGrenadePredictor(world) {
  // Destroyed cover is already floor in world.map.tiles, so a fresh build leaves it out.
  const copy = createWorld(0, { ...world.map, tiles: world.map.tiles.slice() });
  world.doors.forEach((d, i) => {
    const c = copy.doors[i];
    if (d.state !== 'closed' && c.collider) {
      copy.physics.removeCollider(c.collider, false);
      c.collider = null;
      c.state = d.state;
    }
  });
  copy.physics.step();
  const cache = new Map();

  /**
   * @returns {{ path: {x,y,z}[], bounces: {x,z}[], burst: {x,z}, radius: number }}
   *   bounces: where it hits a wall or cover; burst: where it goes off.
   */
  function predict(from, target, kind) {
    const key = `${from.x},${from.z},${target.x},${target.z},${kind}`;
    if (cache.has(key)) return cache.get(key);
    const body = launchGrenadeBody(copy.physics, from.x, from.z, target.x, target.z);
    const path = [];
    const bounces = [];
    const p0 = body.translation();
    path.push({ x: p0.x, y: p0.y, z: p0.z });
    let v = body.linvel();
    // Same order as the sim: the fuse burns down before each physics step.
    for (let fuse = GRENADE[kind].fuse - DT; fuse > 0; fuse -= DT) {
      copy.physics.step();
      const p = body.translation();
      const nv = body.linvel();
      const before = Math.hypot(v.x, v.z);
      const after = Math.hypot(nv.x, nv.z);
      if (before > 0.5 && after > 0.05 && (v.x * nv.x + v.z * nv.z) / (before * after) < WALL_TURN) bounces.push({ x: p.x, z: p.z });
      v = nv;
      path.push({ x: p.x, y: p.y, z: p.z });
    }
    copy.physics.removeRigidBody(body);
    const last = path[path.length - 1];
    const result = { path, bounces, burst: { x: last.x, z: last.z, y: last.y }, radius: GRENADE[kind].radius };
    cache.set(key, result);
    return result;
  }

  /** Would a blast at `burst` reach someone standing/crouching at p? (Same test as the sim.) */
  function reaches(burst, kind, p, stance = 'stand') {
    const spec = GRENADE[kind];
    if (kind === 'smoke' || Math.hypot(p.x - burst.x, p.z - burst.z) > spec.radius) return false;
    const y = kind === 'frag' ? 0.9 : EYE_HEIGHT[stance];
    return hasLineOfSight(copy, burst.x, burst.y + 0.15, burst.z, p.x, y, p.z);
  }

  return { predict, reaches, dispose: () => copy.physics.free() };
}
