import { RAPIER } from './physics.js';
import { length } from './fmath.js';

/** True if the 2D segment a→b passes within r of (cx, cz). */
function segmentNearPoint(ax, az, bx, bz, cx, cz, r) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const u = len2 > 0 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / len2)) : 0;
  return length(ax + dx * u - cx, az + dz * u - cz) < r;
}

/**
 * True if nothing blocks the segment a → b: static geometry (walls, cover,
 * closed doors) or smoke clouds. Grenades (dynamic bodies) never block sight.
 */
export function hasLineOfSight(world, ax, ay, az, bx, by, bz) {
  for (const s of world.smokes) if (segmentNearPoint(ax, az, bx, bz, s.x, s.z, s.r)) return false;
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
