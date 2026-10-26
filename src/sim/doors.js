import { RAPIER } from './physics.js';
import { DT } from './constants.js';
import { CELL, worldToCell, doorIdAt } from './map.js';
import { length, headingTo, wrapAngle, PI } from './fmath.js';
import { hasLineOfSight } from './los.js';
import { damageSoldier, EYE_HEIGHT } from './soldier/soldier.js';
import { makeNoise } from './noise.js';

export const DOOR_OPEN_TIME = 0.6;
export const BREACH_TIME = 1.2;
export const BREACH_REACH = 1.8; // how close to the door the soldier must stand
const DOOR_HEIGHT = 2.2;
const BREACH_STUN_RADIUS = 5;
const BREACH_KILL_RADIUS = 2.5;
const BREACH_DAMAGE = 70;

/** One closed door per door (a connected group of door tiles, see map.js), in map order. */
export function createDoors(physics, map) {
  return map.doors.map((d) => {
    const hx = ((d.x1 - d.x0 + 1) * CELL) / 2;
    const hz = ((d.z1 - d.z0 + 1) * CELL) / 2;
    const collider = physics.createCollider(RAPIER.ColliderDesc.cuboid(hx, DOOR_HEIGHT / 2, hz).setTranslation(d.x, DOOR_HEIGHT / 2, d.z));
    return { id: d.id, x: d.x, z: d.z, axis: d.axis, state: 'closed', collider };
  });
}

export function doorAt(world, x, z) {
  const { cx, cz } = worldToCell(world.map, x, z);
  const id = doorIdAt(world.map, cx, cz);
  return id >= 0 ? world.doors[id] : null;
}

/** @param by soldier opening it (heard by nearby enemies), or null */
export function openDoor(world, door, how = 'open', by = null) {
  if (door.state !== 'closed') return;
  world.physics.removeCollider(door.collider, false);
  door.collider = null;
  door.state = how === 'breach' ? 'breached' : 'open';
  world.events.push({ type: 'door', id: door.id, state: door.state, x: door.x, z: door.z });
  if (by) makeNoise(world, by, how === 'breach' ? 'breach' : 'door', door.x, door.z);
}

/**
 * Called before a soldier steps toward (nx, nz). If that point is inside a
 * closed door, the soldier stops and spends DOOR_OPEN_TIME opening it.
 * @returns true if the soldier is busy with a door this tick
 */
export function handleDoorAhead(world, s, nx, nz) {
  const door = doorAt(world, nx, nz);
  if (!door || door.state !== 'closed') {
    s.doorTimer = 0;
    return false;
  }
  s.doorTimer += DT;
  if (s.doorTimer >= DOOR_OPEN_TIME) {
    s.doorTimer = 0;
    openDoor(world, door, 'open', s);
  }
  return true;
}

/** Nearest closed door within BREACH_REACH of the soldier (preferring the one nearest the aim point). */
export function breachableDoor(world, s, ax, az) {
  let best = null;
  let bestD = Infinity;
  for (const d of world.doors) {
    if (d.state !== 'closed' || length(d.x - s.x, d.z - s.z) > BREACH_REACH) continue;
    const score = length(d.x - ax, d.z - az);
    if (score < bestD) {
      bestD = score;
      best = d;
    }
  }
  return best;
}

/** Blow a door: it is gone, and people just behind it are stunned or hurt. */
export function breachDoor(world, s, door) {
  s.charges--;
  openDoor(world, door, 'breach', s);
  for (const t of world.soldiers) {
    if (!t.alive || t === s) continue;
    const d = length(t.x - door.x, t.z - door.z);
    if (d > BREACH_STUN_RADIUS) continue;
    if (!hasLineOfSight(world, door.x, 1.2, door.z, t.x, EYE_HEIGHT[t.stance], t.z)) continue;
    // Whoever placed the charge (and their side of the door) is braced for it.
    const sameSide = t.team === s.team && length(t.x - s.x, t.z - s.z) < d + 0.5;
    if (sameSide) continue;
    const facing = Math.abs(wrapAngle(headingTo(door.x - t.x, door.z - t.z) - t.heading)) < PI / 2;
    const dur = (facing ? 2.5 : 1.5) * (1 - (0.5 * d) / BREACH_STUN_RADIUS);
    t.blind = Math.max(t.blind, dur);
    t.suppression = 1;
    t.target = null;
    world.events.push({ type: 'blinded', id: t.id, duration: dur });
    if (d < BREACH_KILL_RADIUS) damageSoldier(world, t, BREACH_DAMAGE * (1 - d / BREACH_KILL_RADIUS), s.id);
  }
  world.events.push({ type: 'breach', id: s.id, doorId: door.id, x: door.x, z: door.z });
}
