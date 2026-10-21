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
 * Modes: 'vsAI' (human A vs AI B), 'aiVsAi' (spectate), 'hotseat' (two humans, one device),
 * 'online' (local human vs remote human; the remote plan arrives via setRemotePlans),
 * 'replay' (no controllers: every turn is scripted through beginTurn(plans)).
 */
/** A random legal squad, for AI teams in spectator mode (variety between matches). */
export function randomSquad(seed) {
  const rng = createRng(seed);
  return sanitizeSquad(Array.from({ length: 12 }, () => ROLE_IDS[rng.int(0, ROLE_IDS.length)]));
}

export function createMatch({ mode, mapDef, mapId = null, seed, squads = {}, localTeam = 'A', gameMode = 'elimination' }) {
  const map = parseMap(mapDef);
  const world = createWorld(seed, map, gameMode);
  const aiSquad = (t) => (mode === 'aiVsAi' ? randomSquad(seed + (t === 'A' ? 1 : 2)) : DEFAULT_SQUAD);
  const finalSquads = { A: sanitizeSquad(squads.A ?? aiSquad('A')), B: sanitizeSquad(squads.B ?? aiSquad('B')) };
  spawnSquads(world, finalSquads);

  const controllers =
    mode === 'aiVsAi'
      ? { A: 'ai', B: 'ai' }
      : mode === 'vsAI'
        ? { A: 'human', B: 'ai' }
        : mode === 'online'
          ? { [localTeam]: 'human', [localTeam === 'A' ? 'B' : 'A']: 'remote' }
          : mode === 'replay'
            ? { A: 'script', B: 'script' }
            : { A: 'human', B: 'human' };
  const ais = {};
  for (const t of TEAMS) if (controllers[t] === 'ai') ais[t] = createAI(t, seed + (t === 'A' ? 11 : 23));

  const labels = {};
  for (const t of TEAMS) {
    world.soldiers.filter((s) => s.team === t).forEach((s, i) => (labels[s.id] = `${TEAM_NAMES[t]} ${i + 1}`));
  }

  const m = {
    mode,
    gameMode,
    mapId,
    mapDef,
    seed,
    squads: finalSquads,
    /** Every turn's plans for both teams, as simulated: enough to replay the match. */
    history: [],
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
    localTeam,
    remoteReady: false,

    /** Which team's fog of war applies; null = see everything. */
    get viewerTeam() {
      if (mode === 'aiVsAi' || mode === 'replay') return null;
      if (mode === 'vsAI') return 'A';
      if (mode === 'online') return localTeam;
      return m.phase === 'planning' || m.phase === 'handoff' ? m.planningTeam : null;
    },

    /** @param scripted optional { A, B } plans to play this turn as-is (replays, catching up after a reconnect) */
    beginTurn(scripted = null) {
      m.turn++;
      m.remoteReady = false;
      if (scripted) {
        m.drafts = structuredClone({ A: scripted.A ?? {}, B: scripted.B ?? {} });
        m.aiNotes = { A: {}, B: {} };
        return m.startSim();
      }
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
      } else if (TEAMS.some((t) => controllers[t] === 'remote') && !m.remoteReady) {
        m.phase = 'waiting';
        m.planningTeam = null;
      } else {
        m.startSim();
      }
    },

    /** The remote player's plans for this turn arrived (online mode). */
    setRemotePlans(team, plans) {
      m.drafts[team] = plans;
      m.remoteReady = true;
      if (m.phase === 'waiting') m.startSim();
    },

    acceptHandoff() {
      m.phase = 'planning';
    },

    startSim() {
      m.history.push(structuredClone({ A: m.drafts.A, B: m.drafts.B }));
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
