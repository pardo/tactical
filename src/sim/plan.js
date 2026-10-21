/**
 * Plan data model, shared by the sim, the planning UI, the AI and (later) the network.
 *
 * A soldier's plan is an ordered list of waypoints. For each waypoint the soldier
 * paths there using `move` and `look`, then runs `actions` in order:
 *
 *   { x, z,
 *     move: 'walk' | 'run',
 *     fire: 'onSight' | 'hold',
 *     look: null | { x, z },          // face this point while travelling ("slice the pie")
 *     actions: [ { type: 'stance', stance: 'stand' | 'crouch' }
 *              | { type: 'face', x, z }
 *              | { type: 'wait', t }  // seconds
 *              | { type: 'grenade', x, z } ] }
 */
export const MAX_WAYPOINTS = 16;
export const MAX_ACTIONS = 6;
export const MAX_WAIT = 10;
export const MOVE_MODES = ['walk', 'run'];
export const FIRE_MODES = ['onSight', 'hold'];
export const STANCES = ['stand', 'crouch'];

export function makeWaypoint(x, z, prev = null) {
  return { x, z, move: prev?.move ?? 'walk', fire: prev?.fire ?? 'onSight', look: null, actions: [] };
}

const finite = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
const oneOf = (v, allowed) => (allowed.includes(v) ? v : allowed[0]);

/** Defensive copy that only keeps well-formed data inside the map. Used on every plan entering the sim. */
export function sanitizeWaypoints(map, waypoints) {
  if (!Array.isArray(waypoints)) return [];
  const hw = map.width / 2;
  const hh = map.height / 2;
  const cx = (v) => Math.min(hw, Math.max(-hw, finite(v)));
  const cz = (v) => Math.min(hh, Math.max(-hh, finite(v)));
  const point = (p) => (p && typeof p === 'object' ? { x: cx(p.x), z: cz(p.z) } : null);

  return waypoints.slice(0, MAX_WAYPOINTS).map((w) => ({
    x: cx(w?.x),
    z: cz(w?.z),
    move: oneOf(w?.move, MOVE_MODES),
    fire: oneOf(w?.fire, FIRE_MODES),
    look: point(w?.look),
    actions: (Array.isArray(w?.actions) ? w.actions : [])
      .slice(0, MAX_ACTIONS)
      .map((a) => {
        switch (a?.type) {
          case 'stance':
            return { type: 'stance', stance: oneOf(a.stance, STANCES) };
          case 'face':
          case 'grenade':
            return { type: a.type, x: cx(a.x), z: cz(a.z) };
          case 'wait':
            return { type: 'wait', t: Math.min(MAX_WAIT, Math.max(0, finite(a.t, 1))) };
          default:
            return null;
        }
      })
      .filter(Boolean),
  }));
}

export function cloneWaypoints(waypoints) {
  return structuredClone(waypoints);
}
