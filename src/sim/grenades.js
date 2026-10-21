import { RAPIER } from './physics.js';
import { DT, TICK_RATE } from './constants.js';
import { headingTo, sin, cos, length, wrapAngle, PI } from './fmath.js';
import { hasLineOfSight } from './los.js';
import { damageSoldier, EYE_HEIGHT } from './soldier/soldier.js';
import { worldToCell, cellCenter } from './map.js';
import { destroyCover } from './cover.js';

export const GRENADE_RANGE = 14;
export const GRENADE = {
  // shatter: low cover whose centre is this close to the blast is destroyed.
  frag: { fuse: 2.2, radius: 6, damage: 130, shatter: 1.6 },
  flash: { fuse: 1.5, radius: 9, blind: 3.2 },
  smoke: { fuse: 1.2, radius: 3.2, duration: 15 },
};
/** Kept for callers that only care about frags. */
export const BLAST_RADIUS = GRENADE.frag.radius;
const GRAVITY = 9.81;
const RELEASE_HEIGHT = 1.7;

export function throwGrenade(world, s, tx, tz, kind = 'frag') {
  s.gear[kind]--;
  let dx = tx - s.x;
  let dz = tz - s.z;
  const dist = length(dx, dz);
  if (dist > GRENADE_RANGE) {
    dx *= GRENADE_RANGE / dist;
    dz *= GRENADE_RANGE / dist;
  }
  const h = headingTo(dx, dz);
  const ox = s.x + sin(h) * 0.3;
  const oz = s.z + cos(h) * 0.3;
  // Ballistic arc that lands on the target after time T (ignores bounces).
  const T = 0.6 + Math.min(dist, GRENADE_RANGE) * 0.05;
  const vx = (s.x + dx - ox) / T;
  const vz = (s.z + dz - oz) / T;
  const vy = (-RELEASE_HEIGHT + 0.5 * GRAVITY * T * T) / T;

  const body = world.physics.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(ox, RELEASE_HEIGHT, oz)
      .setLinvel(vx, vy, vz)
      .setLinearDamping(0.1)
      .setAngularDamping(2)
      .setCcdEnabled(true),
  );
  world.physics.createCollider(RAPIER.ColliderDesc.ball(0.06).setRestitution(0.35).setFriction(0.8).setDensity(4), body);
  const g = { id: world.nextId++, kind, team: s.team, ownerId: s.id, fuse: GRENADE[kind].fuse, body };
  world.grenades.push(g);
  world.events.push({ type: 'throw', id: s.id, grenadeId: g.id, kind });
}

function detonate(world, g) {
  const p = g.body.translation();
  const spec = GRENADE[g.kind];
  world.events.push({ type: 'explosion', kind: g.kind, grenadeId: g.id, x: p.x, y: p.y, z: p.z, radius: spec.radius });

  if (g.kind === 'frag') shatterCover(world, p.x, p.z, spec.shatter);
  if (g.kind === 'smoke') {
    world.smokes.push({ x: p.x, z: p.z, r: spec.radius, until: world.tick + spec.duration * TICK_RATE });
  } else {
    for (const s of world.soldiers) {
      if (!s.alive) continue;
      const d = length(s.x - p.x, s.z - p.z);
      if (d > spec.radius) continue;
      if (g.kind === 'frag') {
        if (!hasLineOfSight(world, p.x, p.y + 0.15, p.z, s.x, 0.9, s.z)) continue;
        damageSoldier(world, s, spec.damage * (1 - d / spec.radius), g.ownerId);
      } else {
        // Flashbang: needs line of sight to the eyes; looking at it is much worse.
        if (!hasLineOfSight(world, p.x, p.y + 0.15, p.z, s.x, EYE_HEIGHT[s.stance], s.z)) continue;
        const facing = Math.abs(wrapAngle(headingTo(p.x - s.x, p.z - s.z) - s.heading)) < PI / 2;
        const dur = spec.blind * (facing ? 1 : 0.5) * (1 - (0.6 * d) / spec.radius);
        s.blind = Math.max(s.blind, dur);
        s.suppression = 1;
        s.target = null;
        world.events.push({ type: 'blinded', id: s.id, duration: dur });
      }
    }
  }
  world.physics.removeRigidBody(g.body);
}

function shatterCover(world, x, z, radius) {
  const { cx, cz } = worldToCell(world.map, x, z);
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const c = cellCenter(world.map, cx + dx, cz + dz);
      if (length(c.x - x, c.z - z) <= radius) destroyCover(world, cx + dx, cz + dz);
    }
  }
}

export function updateGrenades(world) {
  for (const g of world.grenades) {
    g.fuse -= DT;
    if (g.fuse <= 0) detonate(world, g);
  }
  world.grenades = world.grenades.filter((g) => g.fuse > 0);
  world.smokes = world.smokes.filter((s) => s.until > world.tick);
}
