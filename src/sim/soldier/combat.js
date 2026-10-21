import { DT } from '../constants.js';
import { headingTo, wrapAngle, length, PI } from '../fmath.js';
import { hasLineOfSight } from '../los.js';
import { WEAPONS, ROLES } from '../roles.js';
import { turnToward, damageSoldier, EYE_HEIGHT, BODY_HEIGHT, LEGS_HEIGHT } from './soldier.js';

const AIM_TOLERANCE = (4 * PI) / 180;
const HOLDING_ARC = (15 * PI) / 180;
const SUPPRESSION_DECAY = 0.35; // per second
const TACTICAL_RELOAD = 0.3; // reload when idle below this fraction of a magazine
/** A friendly closer than this to the line of fire blocks the shot. */
const FRIENDLY_CLEARANCE = 0.6;

/**
 * Time from first seeing an enemy to being ready to shoot. This number is why
 * planning matters: a soldier holding an angle beats one running around a corner.
 */
export const REACTION = { holding: 0.12, still: 0.3, walk: 0.45, run: 0.8 };

export function reactionState(s, offAngle) {
  if (s.moving) return s.moveMode === 'run' ? 'run' : 'walk';
  return offAngle <= HOLDING_ARC ? 'holding' : 'still';
}

export function reactionTime(s, why) {
  const role = ROLES[s.role];
  const mul = why === 'holding' || why === 'still' ? role.reaction.holding : role.reaction.moving;
  return REACTION[why] * mul + s.suppression * 0.4;
}

export function hitChance(world, s, t) {
  const w = WEAPONS[s.weapon];
  const dist = length(t.x - s.x, t.z - s.z);
  let p = Math.max(0.08, w.accNear - dist * w.accFalloff);
  if (s.moving) p *= w.moveAcc;
  if (s.stance === 'crouch') p *= 1.15;
  if (t.stance === 'crouch') p *= 0.8;
  if (t.moving && t.moveMode === 'run') p *= 0.75;
  p *= 1 - 0.5 * s.suppression;
  // Legs hidden behind something low → target is in cover.
  if (!hasLineOfSight(world, s.x, EYE_HEIGHT[s.stance], s.z, t.x, LEGS_HEIGHT, t.z)) p *= 0.6;
  return Math.min(0.95, Math.max(0.03, p));
}

export function weaponDamage(weapon, dist) {
  const w = WEAPONS[weapon];
  if (w.falloffStart === undefined || dist <= w.falloffStart) return w.damage;
  const t = Math.min(1, (dist - w.falloffStart) / (w.falloffEnd - w.falloffStart));
  return w.damage * (1 - 0.8 * t);
}

/** True if a living friendly stands in the line of fire between s and t. */
function friendlyInTheWay(world, s, t) {
  const dx = t.x - s.x;
  const dz = t.z - s.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-6) return false;
  for (const f of world.soldiers) {
    if (f === s || !f.alive || f.team !== s.team) continue;
    const u = ((f.x - s.x) * dx + (f.z - s.z) * dz) / len2;
    if (u <= 0 || u >= 1) continue;
    if (length(s.x + dx * u - f.x, s.z + dz * u - f.z) < FRIENDLY_CLEARANCE) return true;
  }
  return false;
}

/** Enemies this soldier may shoot at: everyone seen, or (return fire) only those engaging them. */
function candidates(world, s) {
  if (s.fire !== 'return') return s.visible;
  return s.visible.filter((id) => world.soldiers.find((o) => o.id === id).target === s.id);
}

function pickTarget(world, s, ids) {
  if (s.target !== null && ids.includes(s.target)) return s.target;
  let best = null;
  let bestScore = Infinity;
  for (const id of ids) {
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

function startReload(world, s) {
  s.reloadTimer = WEAPONS[s.weapon].reload;
  world.events.push({ type: 'reload', id: s.id });
}

/** Timers that tick whether or not the soldier is fighting. */
function updateStatus(world, s) {
  s.shotCooldown = Math.max(0, s.shotCooldown - DT);
  s.suppression = Math.max(0, s.suppression - SUPPRESSION_DECAY * DT);
  s.blind = Math.max(0, s.blind - DT);
  if (s.alert) {
    s.alert.ttl -= DT;
    if (s.alert.ttl <= 0) s.alert = null;
  }
  if (s.reloadTimer > 0) {
    s.reloadTimer -= DT;
    if (s.reloadTimer <= 0) {
      s.reloadTimer = 0;
      s.ammo = WEAPONS[s.weapon].mag;
    }
  }
}

/**
 * Engage visible enemies. Returns true while the soldier is engaged, which
 * overrides plan facing and slows movement.
 */
export function updateCombat(world, s) {
  updateStatus(world, s);
  const w = WEAPONS[s.weapon];
  const ids = s.blind > 0 || s.fire === 'hold' ? [] : candidates(world, s);
  if (!ids.length) {
    s.target = null;
    if (!s.visible.length && s.reloadTimer === 0 && s.ammo < w.mag * TACTICAL_RELOAD) startReload(world, s);
    return false;
  }

  s.alert = null; // we can see someone now; no need to search
  const id = pickTarget(world, s, ids);
  const t = world.soldiers.find((o) => o.id === id);
  const desired = headingTo(t.x - s.x, t.z - s.z);
  if (id !== s.target) {
    s.target = id;
    const why = reactionState(s, Math.abs(wrapAngle(desired - s.heading)));
    s.reaction = reactionTime(s, why) + world.rng.range(0, 0.1);
    world.events.push({ type: 'engage', id: s.id, targetId: id, reaction: s.reaction, why });
  }
  s.reaction = Math.max(0, s.reaction - DT);
  const err = turnToward(s, desired, w.aimRate);

  const ready = s.reaction <= 0 && err <= AIM_TOLERANCE && s.shotCooldown <= 0 && s.reloadTimer === 0;
  if (ready && !friendlyInTheWay(world, s, t)) {
    s.shotCooldown = w.interval;
    s.ammo--;
    const hit = world.rng.next() < hitChance(world, s, t);
    world.events.push({
      type: 'shot',
      from: s.id,
      targetId: t.id,
      weapon: s.weapon,
      hit,
      x: s.x,
      y: EYE_HEIGHT[s.stance] - 0.15,
      z: s.z,
      tx: t.x + (hit ? 0 : world.rng.range(-0.8, 0.8)),
      ty: BODY_HEIGHT[t.stance],
      tz: t.z + (hit ? 0 : world.rng.range(-0.8, 0.8)),
    });
    // Rounds cracking past keep heads down; hits less so (the target is busy being hit).
    t.suppression = Math.min(1, t.suppression + w.suppression * (hit ? 0.5 : 1));
    if (hit) damageSoldier(world, t, weaponDamage(s.weapon, length(t.x - s.x, t.z - s.z)), s.id);
    if (s.ammo <= 0) startReload(world, s);
  }
  return true;
}
