import { headingTo, wrapAngle, length, PI } from '../fmath.js';
import { hasLineOfSight } from '../los.js';
import { EYE_HEIGHT, BODY_HEIGHT, ALERT_TTL } from './soldier.js';

export const FOV = (120 * PI) / 180;
export const VIEW_RANGE = 35;
/** Enemies this close are noticed even behind you (footsteps, peripheral vision). */
export const CLOSE_AWARENESS = 2.5;
/** Teammates within this range hear a callout. */
export const CALLOUT_RANGE = 12;

/**
 * Idle = not moving and not under an explicit facing order, so free to turn
 * toward a teammate's callout or a noise. A soldier told to Face / Look keeps
 * covering that angle (s.hold) even after its orders run out.
 */
export function isFreeToTurn(s) {
  if (s.moving || s.alert || s.visible.length || s.target || s.hold !== null) return false;
  const wp = s.orders[0];
  if (!wp) return true;
  if (!s.arrived || wp.look) return false;
  const a = wp.actions[s.actionIdx];
  return !wp.actions.some((x) => x.type === 'face') && (!a || a.type === 'wait' || a.type === 'until' || a.type === 'code');
}

export function canSee(world, s, e) {
  const dx = e.x - s.x;
  const dz = e.z - s.z;
  const dist = length(dx, dz);
  if (dist > VIEW_RANGE) return false;
  const off = Math.abs(wrapAngle(headingTo(dx, dz) - s.heading));
  if (off > FOV / 2 && dist > CLOSE_AWARENESS) return false;
  return hasLineOfSight(world, s.x, EYE_HEIGHT[s.stance], s.z, e.x, BODY_HEIGHT[e.stance], e.z);
}

/** Fills s.visible with ids of enemies in sight, in id order. */
export function updatePerception(world) {
  for (const s of world.soldiers) {
    s.visible = [];
    if (!s.alive || s.blind > 0) continue;
    for (const e of world.soldiers) {
      if (e.alive && e.team !== s.team && canSee(world, s, e)) s.visible.push(e.id);
    }
  }
  // Callouts: idle teammates nearby turn toward a spotted enemy.
  for (const s of world.soldiers) {
    if (!s.alive || !s.visible.length) continue;
    const e = world.soldiers.find((o) => o.id === s.visible[0]);
    for (const t of world.soldiers) {
      if (t === s || t.team !== s.team || !t.alive || t.blind > 0) continue;
      if (length(t.x - s.x, t.z - s.z) > CALLOUT_RANGE || !isFreeToTurn(t)) continue;
      t.alert = { x: e.x, z: e.z, ttl: ALERT_TTL.callout };
    }
  }
}

/** Ids of enemies of `team` currently seen by any living team member. */
export function teamVision(world, team) {
  const seen = new Set();
  for (const s of world.soldiers) if (s.team === team && s.alive) for (const id of s.visible) seen.add(id);
  return seen;
}
