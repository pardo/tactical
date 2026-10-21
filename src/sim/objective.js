import { DT } from './constants.js';
import { length } from './fmath.js';

export const MODES = {
  elimination: { label: 'Elimination', help: 'Wipe out the enemy squad.' },
  zone: { label: 'Hold the zone', help: 'Hold the centre zone uncontested for 20 s, or wipe them out.' },
};
export const MODE_IDS = Object.keys(MODES);
export const ZONE = { radius: 3, needed: 20 };

/** Objective state for a match mode (null = plain elimination). Lives in the world, so it is hashed. */
export function createObjective(mode) {
  if (mode !== 'zone') return null;
  return { type: 'zone', x: 0, z: 0, r: ZONE.radius, needed: ZONE.needed, score: { A: 0, B: 0 }, holder: null };
}

/** Zone: a team scores while it has living soldiers inside and the enemy has none. */
export function updateObjective(world) {
  const o = world.objective;
  if (!o || o.type !== 'zone') return;
  const inside = { A: 0, B: 0 };
  for (const s of world.soldiers) if (s.alive && length(s.x - o.x, s.z - o.z) <= o.r) inside[s.team]++;
  o.holder = inside.A && !inside.B ? 'A' : inside.B && !inside.A ? 'B' : inside.A ? 'contested' : null;
  if (o.holder === 'A' || o.holder === 'B') {
    o.score[o.holder] += DT;
    if (o.score[o.holder] >= o.needed - 1e-9) world.winner = o.holder;
  }
}
