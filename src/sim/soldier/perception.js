import { headingTo, wrapAngle, length, PI } from '../fmath.js';
import { hasLineOfSight } from '../los.js';
import { EYE_HEIGHT, BODY_HEIGHT } from './soldier.js';

export const FOV = (120 * PI) / 180;
export const VIEW_RANGE = 35;
/** Enemies this close are noticed even behind you (footsteps, peripheral vision). */
export const CLOSE_AWARENESS = 2.5;

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
}

/** Ids of enemies of `team` currently seen by any living team member. */
export function teamVision(world, team) {
  const seen = new Set();
  for (const s of world.soldiers) if (s.team === team && s.alive) for (const id of s.visible) seen.add(id);
  return seen;
}
