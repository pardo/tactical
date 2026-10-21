import { TICK_RATE } from './constants.js';
import { length } from './fmath.js';
import { ALERT_TTL } from './soldier/soldier.js';

/**
 * Sounds carry through walls. A noise heard by the enemy reveals roughly where
 * its maker is (a "sound ghost"), and idle listeners turn toward it.
 * Radii in metres.
 */
export const NOISE_RADIUS = { step: 9, door: 14, shot: 24, breach: 30 };
/** A running soldier is heard at most this often; so is a soldier who keeps shooting. */
export const NOISE_INTERVAL = { step: Math.round(TICK_RATE * 0.5), shot: TICK_RATE };

/** Idle = free to turn toward a sound (same rule as callouts). */
function canTurnToSound(s) {
  if (s.moving || s.alert || s.visible.length || s.target) return false;
  const wp = s.orders[0];
  if (!wp) return true;
  if (!s.arrived || wp.look) return false;
  const a = wp.actions[s.actionIdx];
  return !wp.actions.some((x) => x.type === 'face') && (!a || a.type === 'wait' || a.type === 'until');
}

/**
 * Soldier `src` made a `kind` noise at (x, z). Emits a 'noise' event only if a
 * living, non-stunned enemy is in earshot. Throttled kinds use src.lastNoise.
 */
export function makeNoise(world, src, kind, x = src.x, z = src.z) {
  const every = NOISE_INTERVAL[kind];
  if (every) {
    const last = src.lastNoise[kind] ?? -Infinity;
    if (world.tick - last < every) return;
  }
  const r = NOISE_RADIUS[kind];
  let heard = false;
  for (const t of world.soldiers) {
    if (!t.alive || t.team === src.team || t.blind > 0) continue;
    if (length(t.x - x, t.z - z) > r) continue;
    heard = true;
    if (canTurnToSound(t)) t.alert = { x, z, ttl: ALERT_TTL.noise };
  }
  if (every) src.lastNoise[kind] = world.tick;
  if (heard) world.events.push({ type: 'noise', kind, id: src.id, x, z, heardBy: src.team === 'A' ? 'B' : 'A' });
}
