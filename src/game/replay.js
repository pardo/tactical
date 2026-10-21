import { createMatch } from './match.js';
import { MAPS } from '../maps/index.js';
import { MODES } from '../sim/objective.js';

/**
 * Replays are tiny: the sim is deterministic, so seed + map + mode + squads +
 * every turn's plans reproduce the whole match exactly.
 */
export const REPLAY_VERSION = 1;

export function exportReplay(match) {
  return {
    v: REPLAY_VERSION,
    seed: match.seed,
    mapId: match.mapId,
    gameMode: match.gameMode,
    squads: match.squads,
    turns: match.history,
  };
}

export function validateReplay(data) {
  if (!data || typeof data !== 'object') throw new Error('not a replay file');
  if (data.v !== REPLAY_VERSION) throw new Error(`replay version ${data.v} is not supported`);
  if (!MAPS[data.mapId]) throw new Error(`unknown map "${data.mapId}"`);
  if (!MODES[data.gameMode]) throw new Error(`unknown mode "${data.gameMode}"`);
  if (!Number.isInteger(data.seed) || !Array.isArray(data.turns)) throw new Error('malformed replay');
  return data;
}

/**
 * Re-simulate `turns` on an existing match (fresh, or one being caught up).
 * Hooks: onTurn(match) after each turn starts, onTick(world) after every tick.
 */
export function fastForward(match, turns, { onTurn = () => {}, onTick = () => {} } = {}) {
  for (const plans of turns) {
    if (match.phase === 'over') break;
    match.beginTurn(plans);
    onTurn(match);
    while (match.stepSim()) {
      onTick(match.world);
      if (match.phase !== 'simulating') break;
    }
  }
  return match;
}

/** A spectator match rebuilt from a replay file, simulated to the end. */
export function loadReplay(data, hooks) {
  validateReplay(data);
  const match = createMatch({
    mode: 'replay',
    mapDef: MAPS[data.mapId],
    mapId: data.mapId,
    seed: data.seed,
    squads: data.squads,
    gameMode: data.gameMode,
  });
  return fastForward(match, data.turns, hooks);
}
