import { DT } from '../constants.js';
import { headingTo, wrapAngle, length, PI } from '../fmath.js';
import { hasLineOfSight } from '../los.js';
import { turnToward, damageSoldier, EYE_HEIGHT, BODY_HEIGHT, LEGS_HEIGHT } from './soldier.js';

const AIM_TURN_RATE = 8; // rad/s
const AIM_TOLERANCE = (4 * PI) / 180;
const FIRE_INTERVAL = 0.12; // s, ~500 rpm
const DAMAGE = 30;
const HOLDING_ARC = (15 * PI) / 180;

/**
 * Time from first seeing an enemy to being ready to shoot. This number is why
 * planning matters: a soldier holding an angle beats one running around a corner.
 */
export const REACTION = { holding: 0.12, still: 0.3, walk: 0.45, run: 0.8 };

export function reactionState(s, offAngle) {
  if (s.moving) return s.moveMode === 'run' ? 'run' : 'walk';
  return offAngle <= HOLDING_ARC ? 'holding' : 'still';
}

export function hitChance(world, s, t) {
  const dist = length(t.x - s.x, t.z - s.z);
  let p = Math.max(0.1, 0.92 - dist * 0.02);
  if (s.moving) p *= 0.55;
  if (s.stance === 'crouch') p *= 1.15;
  if (t.stance === 'crouch') p *= 0.8;
  if (t.moving && t.moveMode === 'run') p *= 0.75;
  // Legs hidden behind something low → target is in cover.
  if (!hasLineOfSight(world, s.x, EYE_HEIGHT[s.stance], s.z, t.x, LEGS_HEIGHT, t.z)) p *= 0.6;
  return Math.min(0.95, Math.max(0.05, p));
}

function pickTarget(world, s) {
  if (s.target !== null && s.visible.includes(s.target)) return s.target;
  let best = null;
  let bestScore = Infinity;
  for (const id of s.visible) {
    const e = world.soldiers.find((o) => o.id === id);
    const off = Math.abs(wrapAngle(headingTo(e.x - s.x, e.z - s.z) - s.heading));
    // Prefer whoever needs the least turning, then the closest.
    const score = off * 10 + length(e.x - s.x, e.z - s.z);
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

/**
 * Engage visible enemies. Returns true while the soldier is engaged, which
 * overrides plan facing and slows movement.
 */
export function updateCombat(world, s) {
  s.shotCooldown = Math.max(0, s.shotCooldown - DT);
  if (s.fire === 'hold' || !s.visible.length) {
    s.target = null;
    return false;
  }

  const id = pickTarget(world, s);
  const t = world.soldiers.find((o) => o.id === id);
  const desired = headingTo(t.x - s.x, t.z - s.z);
  if (id !== s.target) {
    s.target = id;
    const why = reactionState(s, Math.abs(wrapAngle(desired - s.heading)));
    s.reaction = REACTION[why] + world.rng.range(0, 0.1);
    world.events.push({ type: 'engage', id: s.id, targetId: id, reaction: s.reaction, why });
  }
  s.reaction = Math.max(0, s.reaction - DT);
  const err = turnToward(s, desired, AIM_TURN_RATE);

  if (s.reaction <= 0 && err <= AIM_TOLERANCE && s.shotCooldown <= 0) {
    s.shotCooldown = FIRE_INTERVAL;
    const hit = world.rng.next() < hitChance(world, s, t);
    world.events.push({
      type: 'shot',
      from: s.id,
      targetId: t.id,
      hit,
      x: s.x,
      y: EYE_HEIGHT[s.stance] - 0.15,
      z: s.z,
      tx: t.x + (hit ? 0 : world.rng.range(-0.8, 0.8)),
      ty: BODY_HEIGHT[t.stance],
      tz: t.z + (hit ? 0 : world.rng.range(-0.8, 0.8)),
    });
    if (hit) damageSoldier(world, t, DAMAGE, s.id);
  }
  return true;
}
