import { GRENADE_RANGE } from '../sim/grenades.js';

/**
 * Plain-language help for every planning control. Keys match the panel's
 * data-action:data-arg so tapping a button can show its explanation (phones
 * have no hover tooltips).
 */
export const ACTION_HELP = {
  'move:walk': ['🚶 Walk', 'Moves at normal speed and quietly. Reacts faster to enemies (≈0.45 s) than running.'],
  'move:run': ['🏃 Run', 'Over twice as fast, but slow to react (≈0.8 s) and loud: enemies within 9 m hear the footsteps through walls.'],
  'fire:onSight': ['🎯 Fire at will', 'Shoots any enemy it sees on this leg and afterwards.'],
  'fire:return': ['↩ Return fire', 'Stays hidden: only shoots at enemies who are already aiming or shooting at this soldier.'],
  'fire:hold': ['🤫 Hold fire', "Never shoots. For sneaking past or waiting for the moment an ambush starts."],
  cover: ['🛡 Take cover', 'On arrival, steps to the nearest low cover (within 2.5 m), crouches behind it and faces the threat (or the way it was facing).'],
  'stance:crouch': ['▼ Crouch', 'Gets low: harder to hit, hidden behind low cover, but moves slowly.'],
  'stance:stand': ['▲ Stand', 'Stands up: sees and shoots over low cover, moves at full speed.'],
  face: ['➜ Face…', 'Turns toward a point you tap and keeps covering that angle — "holding the angle" gives the fastest reaction (≈0.12 s). Sounds and teammates\' calls won\'t turn it away; after a firefight it turns back.'],
  faceHere: ['➜ Face…', 'Turns in place toward a point you tap and holds that angle, no waypoint needed. Sounds and teammates\' calls won\'t turn it away.'],
  wait: ['⏱ Wait', 'Stays put for 1 s before the next action or waypoint. Tap again to add another second.'],
  until: ['⏲ Sync', 'Waits until a moment of the 5 s turn (e.g. @2s), so several soldiers can move at once. Tap again for +0.5 s.'],
  breach: ['🧨 Breach…', 'Tap a closed door next to the soldier: blows it open, stunning (and maybe hurting) enemies right behind it. Very loud.'],
  'grenade:frag': ['💣 Frag…', `Tap where to throw (max ${GRENADE_RANGE} m). Explodes after a short fuse: hurts everyone nearby, friends too, and destroys low cover.`],
  'grenade:flash': ['⚡ Flash…', `Tap where to throw (max ${GRENADE_RANGE} m). Blinds anyone within 9 m with a clear view of the bang (worse if they look at it) for up to 3 s — follow up fast.`],
  'grenade:smoke': ['☁ Smoke…', `Tap where to throw (max ${GRENADE_RANGE} m). A cloud nobody can see through for 15 s: cross open ground behind it.`],
  look: ['👁 Look while moving…', 'Tap a point to keep watching while walking there (strafing, slower), and keep covering it after arriving. Without it the soldier looks where it walks.'],
};

/** Help for a tapped control, or null if it has none. */
export function helpFor(action, arg) {
  const key =
    action === 'move' || action === 'fire' ? `${action}:${arg}`
    : action === 'addStance' ? `stance:${arg}`
    : action === 'addCover' ? 'cover'
    : action === 'addWait' ? 'wait'
    : action === 'addSync' ? 'until'
    : action === 'pick' ? arg
    : null;
  const h = key && ACTION_HELP[key];
  return h ? `${h[0].replace('…', '')}: ${h[1]}` : null;
}

const FIRE_TEXT = { onSight: 'firing at will', return: 'only returning fire', hold: 'holding fire' };
const GRENADE_TEXT = { frag: 'throw a frag', flash: 'throw a flashbang', smoke: 'throw smoke' };

function actionText(a) {
  if (a.type === 'stance') return a.stance === 'crouch' ? 'crouch' : 'stand up';
  if (a.type === 'face') return 'turn and hold that angle';
  if (a.type === 'wait') return `wait ${a.t}s`;
  if (a.type === 'until') return `wait until ${a.t}s into the turn`;
  if (a.type === 'grenade') return GRENADE_TEXT[a.kind];
  if (a.type === 'breach') return 'blow the door';
  if (a.type === 'cover') return 'take cover';
  return a.type;
}

/** One sentence saying what a waypoint will make the soldier do, e.g. "Run here, firing at will, then crouch → wait 1s." */
export function describeWaypoint(w) {
  let text = `${w.move === 'run' ? 'Run' : 'Walk'} here${w.look ? ' watching the 👁 point' : ''}, ${FIRE_TEXT[w.fire] ?? FIRE_TEXT.onSight}`;
  if (w.actions.length) text += `, then ${w.actions.map(actionText).join(' → ')}`;
  return `${text}.`;
}
