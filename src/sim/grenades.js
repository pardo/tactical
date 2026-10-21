import { DT } from './constants.js';
import { RAPIER } from './physics.js';
import { headingTo, sin, cos, length } from './fmath.js';
import { hasLineOfSight } from './los.js';
import { damageSoldier } from './soldier/soldier.js';

export const GRENADE_RANGE = 14;
export const FUSE = 2.2; // s from throw
export const BLAST_RADIUS = 6;
const MAX_DAMAGE = 130;
const GRAVITY = 9.81;
const RELEASE_HEIGHT = 1.7;

export function throwGrenade(world, s, tx, tz) {
  s.grenades--;
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
  const g = { id: world.nextId++, team: s.team, ownerId: s.id, fuse: FUSE, body };
  world.grenades.push(g);
  world.events.push({ type: 'throw', id: s.id, grenadeId: g.id });
}

function explode(world, g) {
  const p = g.body.translation();
  world.events.push({ type: 'explosion', grenadeId: g.id, x: p.x, y: p.y, z: p.z, radius: BLAST_RADIUS });
  for (const s of world.soldiers) {
    if (!s.alive) continue;
    const d = length(s.x - p.x, s.z - p.z);
    if (d > BLAST_RADIUS) continue;
    if (!hasLineOfSight(world, p.x, p.y + 0.15, p.z, s.x, 0.9, s.z)) continue;
    damageSoldier(world, s, MAX_DAMAGE * (1 - d / BLAST_RADIUS), g.ownerId);
  }
  world.physics.removeRigidBody(g.body);
}

export function updateGrenades(world) {
  for (const g of world.grenades) {
    g.fuse -= DT;
    if (g.fuse <= 0) explode(world, g);
  }
  world.grenades = world.grenades.filter((g) => g.fuse > 0);
}
