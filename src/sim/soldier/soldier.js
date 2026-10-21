import { DT } from '../constants.js';
import { headingTo, wrapAngle, length, PI } from '../fmath.js';

export const MOVE_SPEED = { walk: 1.6, run: 3.6 }; // m/s
const TURN_RATE = { walk: 7, run: 5 }; // rad/s
const SHARP_TURN = PI / 3; // slow down while turning more than this

export function createSoldier(world, { team, x, z, heading = 0 }) {
  const soldier = { id: world.nextId++, kind: 'soldier', team, x, z, heading, path: [], moveMode: 'walk' };
  world.soldiers.push(soldier);
  return soldier;
}

export function updateSoldier(s) {
  if (!s.path.length) return;
  const target = s.path[0];
  const dx = target.x - s.x;
  const dz = target.z - s.z;
  const dist = length(dx, dz);
  if (dist < 1e-6) {
    s.path.shift();
    return;
  }

  const turn = wrapAngle(headingTo(dx, dz) - s.heading);
  const maxTurn = TURN_RATE[s.moveMode] * DT;
  s.heading = wrapAngle(s.heading + Math.max(-maxTurn, Math.min(maxTurn, turn)));

  const factor = Math.abs(turn) > SHARP_TURN ? 0.3 : 1;
  const stepLen = MOVE_SPEED[s.moveMode] * factor * DT;
  if (stepLen >= dist) {
    s.x = target.x;
    s.z = target.z;
    s.path.shift();
  } else {
    s.x += (dx / dist) * stepLen;
    s.z += (dz / dist) * stepLen;
  }
}
