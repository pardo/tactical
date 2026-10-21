/**
 * Records a lightweight snapshot of every tick so the whole match can be
 * scrubbed and replayed without re-running the sim.
 */
export function snapshot(world) {
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
      moving: s.moving,
      visible: s.visible.slice(),
    })),
    grenades: world.grenades.map((g) => {
      const p = g.body.translation();
      return { id: g.id, x: p.x, y: p.y, z: p.z };
    }),
    events: world.events.slice(),
  };
}

export function createRecorder(world) {
  const rec = {
    frames: [snapshot(world)],
    /** One entry per turn: where it starts in `frames` and what everyone planned. */
    turns: [],

    record(w) {
      rec.frames.push(snapshot(w));
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
