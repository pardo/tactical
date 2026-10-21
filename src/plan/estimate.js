import { findPath } from '../sim/nav.js';
import { SPEED, ACTION_TIME } from '../sim/soldier/orders.js';
import { TURN_SECONDS } from '../sim/constants.js';

const FACE_TIME = 0.4; // rough average turn time

const dist = (a, b) => Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2);

export function actionDuration(a) {
  if (a.type === 'wait') return a.t;
  if (a.type === 'face') return FACE_TIME;
  return ACTION_TIME[a.type] ?? 0;
}

/**
 * Predicts how a plan plays out if nothing interrupts it (no enemies). Used for
 * path drawing, per-waypoint ETAs and the "where am I at the end of the turn" marker.
 *
 * @returns {{
 *   legs: { points: {x,z}[], move: string, blocked: boolean }[],
 *   marks: { arrive: number, done: number }[],
 *   atTurnEnd: {x,z} | null,   // null if the plan finishes before the turn ends
 *   end: {x,z}, total: number }}
 */
export function estimatePlan(map, start, waypoints) {
  let pos = { x: start.x, z: start.z };
  let stance = start.stance ?? 'stand';
  let t = 0;
  let atTurnEnd = null;
  const legs = [];
  const marks = [];

  const span = (from, to, dt) => {
    if (!atTurnEnd && t + dt >= TURN_SECONDS) {
      const f = dt > 0 ? (TURN_SECONDS - t) / dt : 0;
      atTurnEnd = { x: from.x + (to.x - from.x) * f, z: from.z + (to.z - from.z) * f };
    }
    t += dt;
  };

  for (const wp of waypoints) {
    const path = findPath(map, pos.x, pos.z, wp.x, wp.z);
    if (!path) {
      legs.push({ points: [pos, { x: wp.x, z: wp.z }], move: wp.move, blocked: true });
      marks.push({ arrive: Infinity, done: Infinity });
      break;
    }
    if (wp.move === 'run') stance = 'stand';
    const speed = wp.move === 'run' ? SPEED.run : stance === 'crouch' ? SPEED.crouch : SPEED.walk;
    const points = [pos, ...path];
    for (let i = 1; i < points.length; i++) span(points[i - 1], points[i], dist(points[i - 1], points[i]) / speed);
    legs.push({ points, move: wp.move, blocked: false });
    const arrive = t;
    pos = points[points.length - 1];
    for (const a of wp.actions) {
      if (a.type === 'stance') stance = a.stance;
      span(pos, pos, actionDuration(a));
    }
    marks.push({ arrive, done: t });
  }
  return { legs, marks, atTurnEnd, end: pos, total: t };
}
