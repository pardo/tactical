import { findPath } from './nav.js';

/**
 * Direct orders used by the M1 sandbox. M2 replaces these with turn plans,
 * but plans will compile down to the same calls.
 * @returns {boolean} false if the target is unreachable
 */
export function commandMove(world, soldierId, x, z, moveMode = 'walk') {
  const s = world.soldiers.find((e) => e.id === soldierId);
  if (!s) return false;
  const path = findPath(world.map, s.x, s.z, x, z);
  if (!path) return false;
  s.path = path;
  s.moveMode = moveMode;
  return true;
}
