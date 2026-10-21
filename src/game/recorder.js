import { TURN_TICKS } from '../sim/constants.js';

/** Sound ghosts fade after this long without a new noise from that soldier. */
export const HEARD_TTL = TURN_TICKS * 2;

/**
 * What each team has heard: { A: [{ id, x, z, tick, kind }], B: [...] }, newest
 * noise per enemy soldier, carried forward from the previous frame.
 */
function heardMemory(world, prev) {
  const out = {};
  for (const team of ['A', 'B']) {
    const byId = new Map((prev?.heard?.[team] ?? []).map((h) => [h.id, h]));
    for (const e of world.events) {
      if (e.type === 'noise' && e.heardBy === team) byId.set(e.id, { id: e.id, x: e.x, z: e.z, tick: world.tick, kind: e.kind });
    }
    out[team] = [...byId.values()].filter((h) => world.tick - h.tick <= HEARD_TTL && world.soldiers.find((s) => s.id === h.id)?.alive);
  }
  return out;
}

/**
 * Records a lightweight snapshot of every tick so the whole match can be
 * scrubbed and replayed without re-running the sim.
 */
export function snapshot(world, prev = null) {
  return {
    tick: world.tick,
    soldiers: world.soldiers.map((s) => ({
      id: s.id,
      team: s.team,
      x: s.x,
      z: s.z,
      h: s.heading,
      stance: s.stance,
      alive: s.alive,
      hp: s.hp,
      maxHp: s.maxHp,
      role: s.role,
      moving: s.moving,
      blind: s.blind > 0,
      suppressed: s.suppression > 0.5,
      reloading: s.reloadTimer > 0,
      visible: s.visible.slice(),
    })),
    smokes: world.smokes.map((sm) => ({ x: sm.x, z: sm.z, r: sm.r })),
    doors: world.doors.map((d) => d.state),
    destroyed: world.destroyed.length, // count; indexes are in world.destroyed (append-only)
    objective: world.objective && { score: { ...world.objective.score }, holder: world.objective.holder },
    grenades: world.grenades.map((g) => {
      const p = g.body.translation();
      return { id: g.id, kind: g.kind, x: p.x, y: p.y, z: p.z };
    }),
    events: world.events.slice(),
    heard: heardMemory(world, prev),
  };
}

export function createRecorder(world) {
  const rec = {
    frames: [snapshot(world)],
    /** One entry per turn: where it starts in `frames` and what everyone planned. */
    turns: [],

    record(w) {
      rec.frames.push(snapshot(w, rec.frames[rec.frames.length - 1]));
    },

    startTurn(turn, plans, notes) {
      rec.turns.push({ turn, frame: rec.frames.length - 1, plans: structuredClone(plans), notes: { ...notes } });
    },

    /** Turn record containing frame index i. */
    turnAt(i) {
      let found = rec.turns[0] ?? null;
      for (const t of rec.turns) if (t.frame <= i) found = t;
      return found;
    },
  };
  return rec;
}

/** Ids of enemies of `team` seen by any living team member in this frame. */
export function frameVision(frame, team) {
  const seen = new Set();
  for (const s of frame.soldiers) if (s.team === team && s.alive) for (const id of s.visible) seen.add(id);
  return seen;
}
