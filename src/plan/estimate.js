import { findPath } from '../sim/nav.js';
import { worldToCell } from '../sim/map.js';
import { SPEED, ACTION_TIME } from '../sim/soldier/orders.js';
import { DOOR_OPEN_TIME } from '../sim/doors.js';
import { TURN_SECONDS } from '../sim/constants.js';

const FACE_TIME = 0.4; // rough average turn time
const COVER_TIME = 1.2; // short hop to cover + crouch (destination unknown until it runs)

const dist = (a, b) => Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2);

/** Seconds an action takes when it starts at turn time t (a go code not released this turn: forever). */
export function actionDuration(a, t = 0, released = []) {
  if (a.type === 'code') return released.includes(a.code) ? 0 : Infinity;
  if (a.type === 'wait') return a.t;
  if (a.type === 'until') return Math.max(0, a.t - t);
  if (a.type === 'face') return FACE_TIME;
  if (a.type === 'cover') return COVER_TIME;
  return ACTION_TIME[a.type] ?? 0;
}

/** Closed doors crossed by the segment a→b (sampled), excluding ones already counted. */
function doorsCrossed(map, a, b, closedDoors, counted) {
  if (!closedDoors?.size) return 0;
  const len = Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2);
  const n = Math.max(1, Math.ceil(len / 0.25));
  let found = 0;
  for (let k = 0; k <= n; k++) {
    const { cx, cz } = worldToCell(map, a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n);
    const key = `${cx},${cz}`;
    if (closedDoors.has(key) && !counted.has(key)) {
      counted.add(key);
      found++;
    }
  }
  return found;
}

/**
 * Predicts how a plan plays out if nothing interrupts it (no enemies). Used for
 * path drawing, per-waypoint ETAs and the "where am I at the end of the turn" marker.
 *
 * @param closedDoors optional Set of "cx,cz" keys of closed doors (adds opening time)
 * @param released go codes released this turn; waiting on any other code holds the soldier
 * @returns {{
 *   legs: { points: {x,z}[], move: string, blocked: boolean }[],
 *   marks: { arrive: number, done: number, held?: string }[], // held: go code this waypoint waits behind
 *   atTurnEnd: {x,z} | null,   // null if the plan finishes before the turn ends
 *   end: {x,z}, total: number }}
 */
export function estimatePlan(map, start, waypoints, closedDoors = null, released = []) {
  const counted = new Set();
  let pos = { x: start.x, z: start.z };
  let stance = start.stance ?? 'stand';
  let t = 0;
  let atTurnEnd = null;
  let held = null;
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
      marks.push({ arrive: Infinity, done: Infinity, ...(held && { held }) });
      break;
    }
    if (wp.move === 'run') stance = 'stand';
    const speed = wp.move === 'run' ? SPEED.run : stance === 'crouch' ? SPEED.crouch : SPEED.walk;
    const points = [pos, ...path];
    for (let i = 1; i < points.length; i++) {
      const doors = doorsCrossed(map, points[i - 1], points[i], closedDoors, counted);
      span(points[i - 1], points[i], dist(points[i - 1], points[i]) / speed + doors * DOOR_OPEN_TIME);
    }
    legs.push({ points, move: wp.move, blocked: false });
    const arrive = t;
    const heldBefore = held;
    pos = points[points.length - 1];
    for (const a of wp.actions) {
      if (a.type === 'stance') stance = a.stance;
      if (a.type === 'code' && !released.includes(a.code)) held ??= a.code;
      span(pos, pos, actionDuration(a, t, released));
    }
    marks.push({ arrive, done: t, ...(heldBefore && { held: heldBefore }) });
  }
  return { legs, marks, atTurnEnd, end: pos, total: t };
}
