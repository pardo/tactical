import { TURN_TICKS } from './constants.js';
import { step } from './world.js';

/**
 * Advance the world by one 5 s turn. Plans are ignored until M2.
 * `onTick` lets the renderer record snapshots for replay.
 */
export function runTurn(world, _plans, onTick) {
  for (let i = 0; i < TURN_TICKS; i++) {
    step(world);
    onTick?.(world);
  }
  return { events: [] };
}
