import { parseMap } from '../sim/map.js';
import { createWorld, spawnSquads, applyPlans, step, beginTurnClock, TEAMS } from '../sim/world.js';
import { cloneWaypoints } from '../sim/plan.js';
import { TURN_TICKS } from '../sim/constants.js';
import { createAI } from '../ai/planner.js';
import { createRng } from '../sim/rng.js';
import { DEFAULT_SQUAD, ROLE_IDS, sanitizeSquad } from '../sim/roles.js';

export const MAX_TURNS = 30;
export const TEAM_NAMES = { A: 'Blue', B: 'Red' };

/**
 * Turn flow around the deterministic sim:
 *   planning(team) → [handoff → planning(other team)] → simulating → turnEnd → planning …
 * Modes: 'vsAI' (human A vs AI B), 'aiVsAi' (spectate), 'hotseat' (two humans, one device).
 */
/** A random legal squad, for AI teams in spectator mode (variety between matches). */
export function randomSquad(seed) {
  const rng = createRng(seed);
  return sanitizeSquad(Array.from({ length: 12 }, () => ROLE_IDS[rng.int(0, ROLE_IDS.length)]));
}

export function createMatch({ mode, mapDef, seed, squads = {} }) {
  const map = parseMap(mapDef);
  const world = createWorld(seed, map);
  const aiSquad = (t) => (mode === 'aiVsAi' ? randomSquad(seed + (t === 'A' ? 1 : 2)) : DEFAULT_SQUAD);
  spawnSquads(world, { A: squads.A ?? aiSquad('A'), B: squads.B ?? aiSquad('B') });

  const controllers =
    mode === 'aiVsAi' ? { A: 'ai', B: 'ai' } : mode === 'vsAI' ? { A: 'human', B: 'ai' } : { A: 'human', B: 'human' };
  const ais = {};
  for (const t of TEAMS) if (controllers[t] === 'ai') ais[t] = createAI(t, seed + (t === 'A' ? 11 : 23));

  const labels = {};
  for (const t of TEAMS) {
    world.soldiers.filter((s) => s.team === t).forEach((s, i) => (labels[s.id] = `${TEAM_NAMES[t]} ${i + 1}`));
  }

  const m = {
    mode,
    world,
    map,
    controllers,
    labels,
    turn: 0,
    phase: 'idle',
    planningTeam: null,
    pending: [],
    drafts: { A: {}, B: {} },
    aiNotes: { A: {}, B: {} },
    turnTick: 0,

    /** Which team's fog of war applies; null = see everything. */
    get viewerTeam() {
      if (mode === 'aiVsAi') return null;
      if (mode === 'vsAI') return 'A';
      return m.phase === 'planning' || m.phase === 'handoff' ? m.planningTeam : null;
    },

    beginTurn() {
      m.turn++;
      for (const t of TEAMS) {
        m.drafts[t] = {};
        for (const s of world.soldiers) if (s.team === t && s.alive) m.drafts[t][s.id] = cloneWaypoints(s.orders);
        if (ais[t]) {
          const { plans, notes } = ais[t].plan(world);
          Object.assign(m.drafts[t], plans);
          m.aiNotes[t] = notes;
        }
      }
      m.pending = TEAMS.filter((t) => controllers[t] === 'human');
      if (m.pending.length) {
        m.phase = 'planning';
        m.planningTeam = m.pending[0];
      } else {
        m.startSim();
      }
    },

    /** Current planning team is done. */
    confirm() {
      const next = m.pending[m.pending.indexOf(m.planningTeam) + 1];
      if (next) {
        m.phase = 'handoff';
        m.planningTeam = next;
      } else {
        m.startSim();
      }
    },

    acceptHandoff() {
      m.phase = 'planning';
    },

    startSim() {
      for (const t of TEAMS) applyPlans(world, t, m.drafts[t]);
      beginTurnClock(world);
      m.phase = 'simulating';
      m.planningTeam = null;
      m.turnTick = 0;
    },

    /** One sim tick; returns false when not simulating. */
    stepSim() {
      if (m.phase !== 'simulating') return false;
      step(world);
      for (const ai of Object.values(ais)) ai.observe(world);
      m.turnTick++;
      if (!world.winner && m.turnTick >= TURN_TICKS && m.turn >= MAX_TURNS) world.winner = 'draw';
      if (world.winner) m.phase = 'over';
      else if (m.turnTick >= TURN_TICKS) m.phase = 'turnEnd';
      return true;
    },
  };
  return m;
}
