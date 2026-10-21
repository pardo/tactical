import { RAPIER } from './physics.js';
import { length } from './fmath.js';

/** True if nothing static blocks the segment a → b. Grenades (dynamic bodies) never block sight. */
export function hasLineOfSight(world, ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return true;
  const ray = new RAPIER.Ray({ x: ax, y: ay, z: az }, { x: dx / len, y: dy / len, z: dz / len });
  return !world.physics.castRay(ray, len, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
}

export function distance2d(a, b) {
  return length(b.x - a.x, b.z - a.z);
}
