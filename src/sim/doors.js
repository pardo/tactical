import { RAPIER } from './physics.js';
import { DT } from './constants.js';
import { Tile, cellCenter, worldToCell, tileAt } from './map.js';
import { length, headingTo, wrapAngle, PI } from './fmath.js';
import { hasLineOfSight } from './los.js';
import { damageSoldier, EYE_HEIGHT } from './soldier/soldier.js';

export const DOOR_OPEN_TIME = 0.6;
export const BREACH_TIME = 1.2;
export const BREACH_REACH = 1.8; // how close to the door the soldier must stand
const DOOR_HEIGHT = 2.2;
const BREACH_STUN_RADIUS = 5;
const BREACH_KILL_RADIUS = 2.5;
const BREACH_DAMAGE = 70;

/** Doors run along the wall they sit in: 'x' if the wall continues left/right, else 'z'. */
export function doorAxis(map, cx, cz) {
  return tileAt(map, cx - 1, cz) === Tile.WALL || tileAt(map, cx + 1, cz) === Tile.WALL ? 'x' : 'z';
}

/** One closed door per DOOR tile, in cell order. */
export function createDoors(physics, map) {
  const doors = [];
  for (let cz = 0; cz < map.height; cz++) {
    for (let cx = 0; cx < map.width; cx++) {
      if (tileAt(map, cx, cz) !== Tile.DOOR) continue;
      const c = cellCenter(map, cx, cz);
      const collider = physics.createCollider(
        RAPIER.ColliderDesc.cuboid(0.5, DOOR_HEIGHT / 2, 0.5).setTranslation(c.x, DOOR_HEIGHT / 2, c.z),
      );
      doors.push({ id: doors.length, cx, cz, x: c.x, z: c.z, axis: doorAxis(map, cx, cz), state: 'closed', collider });
    }
  }
  return doors;
}

export function doorAt(world, x, z) {
  const { cx, cz } = worldToCell(world.map, x, z);
  return world.doors.find((d) => d.cx === cx && d.cz === cz) ?? null;
}

export function openDoor(world, door, how = 'open') {
  if (door.state !== 'closed') return;
  world.physics.removeCollider(door.collider, false);
  door.collider = null;
  door.state = how === 'breach' ? 'breached' : 'open';
  world.events.push({ type: 'door', id: door.id, state: door.state, x: door.x, z: door.z });
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
    openDoor(world, door);
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
  openDoor(world, door, 'breach');
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
