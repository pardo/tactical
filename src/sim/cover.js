import { Tile } from './map.js';
import { tilesChanged } from './nav.js';

/**
 * Blow away a low cover tile: it becomes floor (walkable, no longer blocks
 * sight). Cover colliders are per tile (see addMapColliders) for this reason.
 */
export function destroyCover(world, cx, cz) {
  if (cx < 0 || cz < 0 || cx >= world.map.width || cz >= world.map.height) return false;
  const i = cz * world.map.width + cx;
  const collider = world.coverColliders.get(i);
  if (!collider) return false;
  world.physics.removeCollider(collider, false);
  world.coverColliders.delete(i);
  world.map.tiles[i] = Tile.FLOOR;
  tilesChanged(world.map);
  world.destroyed.push(i);
  world.events.push({ type: 'coverDestroyed', cx, cz });
  return true;
}
