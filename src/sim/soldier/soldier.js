import { DT } from '../constants.js';
import { wrapAngle } from '../fmath.js';
import { ROLES, WEAPONS } from '../roles.js';

export const MAX_HP = 100;
export const EYE_HEIGHT = { stand: 1.6, crouch: 1.1 };
/** Point others aim at / need to see. Crouched sits just above low cover (1.0 m). */
export const BODY_HEIGHT = { stand: 1.3, crouch: 1.05 };
export const LEGS_HEIGHT = 0.5;

export function createSoldier(world, { team, x, z, heading = 0, role = 'rifleman' }) {
  const r = ROLES[role] ?? ROLES.rifleman;
  const soldier = {
    id: world.nextId++,
    kind: 'soldier',
    team,
    role,
    weapon: r.weapon,
    x,
    z,
    heading,
    stance: 'stand',
    hp: r.hp,
    maxHp: r.hp,
    alive: true,
    gear: { ...r.gear },
    charges: r.charges,
    ammo: WEAPONS[r.weapon].mag,
    reloadTimer: 0,
    suppression: 0, // 0..1, from incoming fire
    blind: 0, // seconds left blinded by a flashbang
    alert: null, // { x, z, ttl }: a threat to turn toward (shot from there, or a teammate's callout)
    // Orders: orders[0] is the current waypoint.
    orders: [],
    path: [],
    pathReady: false,
    arrived: false,
    actionIdx: 0,
    actionTimer: 0,
    doorTimer: 0,
    moveMode: 'walk',
    fire: 'onSight',
    moving: false,
    // Perception / combat.
    visible: [],
    target: null,
    reaction: 0,
    shotCooldown: 0,
    lastNoise: {}, // kind → tick of the last throttled noise (see noise.js)
  };
  world.soldiers.push(soldier);
  return soldier;
}

/** Rotate toward `desired` at `rate` rad/s; returns the remaining absolute error. */
export function turnToward(s, desired, rate) {
  const diff = wrapAngle(desired - s.heading);
  const max = rate * DT;
  s.heading = wrapAngle(s.heading + Math.max(-max, Math.min(max, diff)));
  return Math.abs(wrapAngle(desired - s.heading));
}

export function killSoldier(world, s) {
  s.alive = false;
  s.hp = 0;
  s.orders = [];
  s.path = [];
  s.target = null;
  s.visible = [];
  s.moving = false;
  world.events.push({ type: 'death', id: s.id });
}

/**
 * Damage lands immediately but deaths are resolved at the end of the tick
 * (resolveDeaths), so soldiers who shoot each other in the same tick both fire
 * regardless of update order.
 */
export function damageSoldier(world, s, amount, sourceId) {
  if (!s.alive) return;
  s.hp -= amount;
  world.events.push({ type: 'damage', id: s.id, amount, sourceId });
  // Shot by someone we can't see: turn toward where it came from.
  const src = world.soldiers.find((o) => o.id === sourceId);
  if (src && src.team !== s.team && !s.visible.includes(src.id)) s.alert = { x: src.x, z: src.z, ttl: ALERT_TTL.shot };
}

export const ALERT_TTL = { shot: 2, callout: 1.5, noise: 1.2 };

export function resolveDeaths(world) {
  for (const s of world.soldiers) if (s.alive && s.hp <= 0) killSoldier(world, s);
}
