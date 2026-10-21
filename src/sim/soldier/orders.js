import { DT } from '../constants.js';
import { headingTo, wrapAngle, length, PI } from '../fmath.js';
import { findPath } from '../nav.js';
import { turnToward } from './soldier.js';
import { throwGrenade } from '../grenades.js';
import { ROLES } from '../roles.js';

export const SPEED = { walk: 1.6, run: 3.6, crouch: 0.9, engaged: 1.0 }; // m/s
const TURN_RATE = { walk: 7, run: 5 }; // rad/s
const SHARP_TURN = PI / 3;
const FACE_TOLERANCE = (3 * PI) / 180;
export const ACTION_TIME = { stance: 0.3, grenade: 0.5 };

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

function moveAlongPath(s, wp, engaged) {
  const target = s.path[0];
  const dx = target.x - s.x;
  const dz = target.z - s.z;
  const dist = length(dx, dz);
  if (dist < 1e-6) {
    s.path.shift();
    return;
  }
  const travel = headingTo(dx, dz);
  let factor = 1;
  if (!engaged) {
    if (wp.look) {
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
      return turnToward(s, headingTo(a.x - s.x, a.z - s.z), TURN_RATE.walk) <= FACE_TOLERANCE;
    case 'wait':
      s.actionTimer += DT;
      return s.actionTimer >= a.t;
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

/** Follow the waypoint plan for one tick. */
export function updateOrders(world, s, engaged) {
  s.moving = false;
  const wp = s.orders[0];
  if (!wp) return;

  if (!s.arrived) {
    if (!s.pathReady) {
      s.path = findPath(world.map, s.x, s.z, wp.x, wp.z) ?? [];
      s.pathReady = true;
      s.moveMode = wp.move;
      s.fire = wp.fire;
      if (wp.move === 'run') s.stance = 'stand';
    }
    if (s.path.length) moveAlongPath(s, wp, engaged);
    if (!s.path.length) s.arrived = true;
    return;
  }

  const a = wp.actions[s.actionIdx];
  if (!a) {
    advance(s);
    return;
  }
  if (runAction(world, s, a, engaged)) {
    s.actionIdx++;
    s.actionTimer = 0;
  }
}
