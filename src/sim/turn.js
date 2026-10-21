import { TURN_TICKS } from './constants.js';
import { step } from './world.js';

/**
 * Advance the world by one 5 s turn (or until someone wins).
 * `onTick` sees the world after every tick, e.g. to record a replay.
 */
export function runTurn(world, onTick) {
  for (let i = 0; i < TURN_TICKS && !world.winner; i++) {
    step(world);
    onTick?.(world);
  }
}
