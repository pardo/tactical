import { DT, TICK_RATE } from '../constants.js';
import { headingTo, wrapAngle, length, PI, sin, cos } from '../fmath.js';
import { findPath } from '../nav.js';
import { turnToward } from './soldier.js';
import { throwGrenade } from '../grenades.js';
import { ROLES } from '../roles.js';
import { handleDoorAhead, breachableDoor, breachDoor, BREACH_TIME } from '../doors.js';
import { Tile, tileAt, isWalkable, worldToCell, cellCenter } from '../map.js';
import { makeNoise } from '../noise.js';

export const SPEED = { walk: 1.6, run: 3.6, crouch: 0.9, engaged: 1.0 }; // m/s
const TURN_RATE = { walk: 7, run: 5 }; // rad/s
const SHARP_TURN = PI / 3;
const FACE_TOLERANCE = (3 * PI) / 180;
export const ACTION_TIME = { stance: 0.3, grenade: 0.5, breach: BREACH_TIME };

function advance(s) {
  s.orders.shift();
  s.pathReady = false;
  s.arrived = false;
  s.actionIdx = 0;
  s.actionTimer = 0;
}

function speedFor(s, engaged) {
  let base;
  if (engaged) base = SPEED.engaged;
  else if (s.moveMode === 'run') base = SPEED.run;
  else base = s.stance === 'crouch' ? SPEED.crouch : SPEED.walk;
  // Pinned down or blinded soldiers crawl.
  return base * ROLES[s.role].speed * (1 - 0.35 * s.suppression) * (s.blind > 0 ? 0.4 : 1);
}

function moveAlongPath(world, s, wp, engaged) {
  const target = s.path[0];
  const dx = target.x - s.x;
  const dz = target.z - s.z;
  const dist = length(dx, dz);
  if (dist < 1e-6) {
    s.path.shift();
    return;
  }
  const travel = headingTo(dx, dz);
  // Look half a metre ahead: a closed door there must be opened first.
  const look = Math.min(dist, 0.5);
  if (handleDoorAhead(world, s, s.x + (dx / dist) * look, s.z + (dz / dist) * look)) {
    if (!engaged) turnToward(s, travel, TURN_RATE.walk);
    return;
  }
  let factor = 1;
  if (!engaged) {
    if (s.alert) {
      // Under fire from somewhere unseen: keep moving but look toward the threat.
      turnToward(s, headingTo(s.alert.x - s.x, s.alert.z - s.z), TURN_RATE.walk);
      if (Math.abs(wrapAngle(travel - s.heading)) > PI / 2) factor = 0.6;
    } else if (wp.look) {
      turnToward(s, headingTo(wp.look.x - s.x, wp.look.z - s.z), TURN_RATE.walk);
      // Strafing or backpedalling is slower than walking forward.
      if (Math.abs(wrapAngle(travel - s.heading)) > PI / 2) factor = 0.6;
    } else {
      const err = Math.abs(wrapAngle(travel - s.heading));
      turnToward(s, travel, TURN_RATE[s.moveMode]);
      if (err > SHARP_TURN) factor = 0.3;
    }
  }
  const stepLen = speedFor(s, engaged) * factor * DT;
  if (stepLen >= dist) {
    s.x = target.x;
    s.z = target.z;
    s.path.shift();
  } else {
    s.x += (dx / dist) * stepLen;
    s.z += (dz / dist) * stepLen;
  }
  s.moving = true;
  // Running is loud; walking and crouching are quiet.
  if (s.moveMode === 'run' && !engaged) makeNoise(world, s, 'step');
}

const COVER_SEARCH = 2.5;
const ORTHO = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Best tile within COVER_SEARCH metres that has low cover between it and the
 * threat direction (dx, dz): nearest first, ties broken by "more forward" then
 * "more to the right" of the threat direction, so mirrored situations pick
 * mirrored spots for both teams.
 */
export function findCoverSpot(world, x, z, dx, dz) {
  const { map } = world;
  const c = worldToCell(map, x, z);
  let best = null;
  for (let oz = -3; oz <= 3; oz++) {
    for (let ox = -3; ox <= 3; ox++) {
      const cx = c.cx + ox;
      const cz = c.cz + oz;
      if (!isWalkable(map, cx, cz) || tileAt(map, cx, cz) === Tile.DOOR) continue;
      const p = cellCenter(map, cx, cz);
      const d = length(p.x - x, p.z - z);
      if (d > COVER_SEARCH) continue;
      const covered = ORTHO.some(([nx, nz]) => nx * dx + nz * dz >= 0.6 && tileAt(map, cx + nx, cz + nz) === Tile.LOW_COVER);
      if (!covered) continue;
      const fwd = (p.x - x) * dx + (p.z - z) * dz;
      const right = (p.x - x) * -dz + (p.z - z) * dx;
      const better =
        !best ||
        d < best.d - 1e-9 ||
        (Math.abs(d - best.d) <= 1e-9 && (fwd > best.fwd + 1e-9 || (Math.abs(fwd - best.fwd) <= 1e-9 && right > best.right)));
      if (better) best = { x: p.x, z: p.z, d, fwd, right };
    }
  }
  return best;
}

/** Runs the current action; returns true when it has finished. */
function runAction(world, s, a, engaged) {
  switch (a.type) {
    case 'stance':
      s.stance = a.stance;
      s.actionTimer += DT;
      return s.actionTimer >= ACTION_TIME.stance;
    case 'face':
      if (engaged) return false;
      s.hold = headingTo(a.x - s.x, a.z - s.z);
      return turnToward(s, s.hold, TURN_RATE.walk) <= FACE_TOLERANCE;
    case 'wait':
      s.actionTimer += DT;
      return s.actionTimer >= a.t;
    case 'cover': {
      // Insert a waypoint behind the nearest cover facing the threat (or our facing), crouched.
      const tx = s.alert ? s.alert.x - s.x : sin(s.heading);
      const tz = s.alert ? s.alert.z - s.z : cos(s.heading);
      const len = length(tx, tz) || 1;
      const spot = findCoverSpot(world, s.x, s.z, tx / len, tz / len);
      if (spot) {
        const wp = s.orders[0];
        s.orders.splice(1, 0, {
          x: spot.x,
          z: spot.z,
          move: wp.move,
          fire: wp.fire,
          look: null,
          actions: [
            { type: 'stance', stance: 'crouch' },
            { type: 'face', x: spot.x + tx / len, z: spot.z + tz / len },
          ],
        });
      }
      return true;
    }
    case 'until':
      // Synchronise with the team: hold until this many seconds into the turn.
      return (world.tick - world.turnStart) / TICK_RATE >= a.t;
    case 'breach': {
      if (s.charges <= 0) return true;
      const door = breachableDoor(world, s, a.x, a.z);
      if (!door) return true;
      if (engaged || s.blind > 0) return false;
      turnToward(s, headingTo(door.x - s.x, door.z - s.z), TURN_RATE.walk);
      s.actionTimer += DT;
      if (s.actionTimer < BREACH_TIME) return false;
      breachDoor(world, s, door);
      return true;
    }
    case 'grenade':
      if ((s.gear[a.kind] ?? 0) <= 0) return true;
      if (engaged || s.blind > 0) return false;
      turnToward(s, headingTo(a.x - s.x, a.z - s.z), TURN_RATE.walk);
      s.actionTimer += DT;
      if (s.actionTimer < ACTION_TIME.grenade) return false;
      throwGrenade(world, s, a.x, a.z, a.kind);
      return true;
    default:
      return true;
  }
}

/** Not moving: face an alert, and get low when pinned down. */
function idleReactions(s, engaged) {
  if (s.suppression > 0.6 && s.stance === 'stand' && !s.orders.length) s.stance = 'crouch';
  if (engaged) return;
  // Shot at from somewhere unseen: face it. Otherwise go back to the ordered angle (e.g. after a firefight).
  if (s.alert) turnToward(s, headingTo(s.alert.x - s.x, s.alert.z - s.z), TURN_RATE.walk);
  else if (s.hold !== null) turnToward(s, s.hold, TURN_RATE.walk);
}

/** Follow the waypoint plan for one tick. */
export function updateOrders(world, s, engaged) {
  s.moving = false;
  const wp = s.orders[0];
  if (!wp) {
    idleReactions(s, engaged);
    return;
  }

  if (!s.arrived) {
    if (!s.pathReady) {
      s.path = findPath(world.map, s.x, s.z, wp.x, wp.z) ?? [];
      s.pathReady = true;
      s.moveMode = wp.move;
      s.fire = wp.fire;
      s.hold = null; // a new leg: the old angle no longer applies
      if (wp.move === 'run') s.stance = 'stand';
    }
    if (s.path.length) moveAlongPath(world, s, wp, engaged);
    if (!s.path.length) {
      s.arrived = true;
      // Watching a point on the way in: keep covering it after arriving.
      if (wp.look) s.hold = headingTo(wp.look.x - s.x, wp.look.z - s.z);
    }
    return;
  }

  const a = wp.actions[s.actionIdx];
  if (!a) {
    advance(s);
    return;
  }
  if (a.type === 'wait' || a.type === 'until') idleReactions(s, engaged);
  if (runAction(world, s, a, engaged)) {
    s.actionIdx++;
    s.actionTimer = 0;
  }
}
