/**
 * Plan data model, shared by the sim, the planning UI, the AI and (later) the network.
 *
 * A soldier's plan is an ordered list of waypoints. For each waypoint the soldier
 * paths there using `move` and `look`, then runs `actions` in order:
 *
 *   { x, z,
 *     move: 'walk' | 'run',
 *     fire: 'onSight' | 'return' | 'hold',
 *     look: null | { x, z },          // face this point while travelling ("slice the pie")
 *     actions: [ { type: 'stance', stance: 'stand' | 'crouch' }
 *              | { type: 'face', x, z }
 *              | { type: 'wait', t }  // seconds
 *              | { type: 'until', t } // hold until t seconds into the turn (team sync)
 *              | { type: 'breach', x, z } // blow the closed door nearest (x, z)
 *              | { type: 'cover' }    // move behind the nearest low cover facing the threat, crouch
 *              | { type: 'grenade', kind: 'frag' | 'flash' | 'smoke', x, z } ] }
 */
export const MAX_WAYPOINTS = 16;
export const MAX_ACTIONS = 6;
export const MAX_WAIT = 10;
const TURN_LENGTH = 5;
export const MOVE_MODES = ['walk', 'run'];
/** onSight: shoot anyone seen · return: only shoot enemies who are engaging you · hold: never shoot */
export const FIRE_MODES = ['onSight', 'return', 'hold'];
export const STANCES = ['stand', 'crouch'];
export const GRENADE_KINDS = ['frag', 'flash', 'smoke'];

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
            return { type: 'face', x: cx(a.x), z: cz(a.z) };
          case 'grenade':
            return { type: 'grenade', kind: oneOf(a.kind, GRENADE_KINDS), x: cx(a.x), z: cz(a.z) };
          case 'wait':
            return { type: 'wait', t: Math.min(MAX_WAIT, Math.max(0, finite(a.t, 1))) };
          case 'until':
            return { type: 'until', t: Math.min(TURN_LENGTH, Math.max(0, finite(a.t, 1))) };
          case 'breach':
            return { type: 'breach', x: cx(a.x), z: cz(a.z) };
          case 'cover':
            return { type: 'cover' };
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
