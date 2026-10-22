/**
 * Per-soldier match statistics from recorded frames: shots, hits, damage dealt, kills.
 * A kill goes to whoever last damaged the soldier before their death event; friendly fire
 * (including your own grenade) counts for nobody.
 * @returns Map id → { shots, hits, damage, kills, alive }
 */
export function matchStats(frames) {
  const stats = new Map();
  const last = frames[frames.length - 1];
  for (const s of last?.soldiers ?? []) stats.set(s.id, { shots: 0, hits: 0, damage: 0, kills: 0, alive: s.alive });
  const team = new Map((last?.soldiers ?? []).map((s) => [s.id, s.team]));
  const lastHitBy = new Map();
  const of = (id) => stats.get(id);
  for (const f of frames) {
    for (const e of f.events ?? []) {
      if (e.type === 'shot' && of(e.from)) {
        of(e.from).shots++;
        if (e.hit) of(e.from).hits++;
      } else if (e.type === 'damage') {
        if (e.sourceId !== undefined && team.get(e.sourceId) !== team.get(e.id) && of(e.sourceId)) {
          of(e.sourceId).damage += e.amount;
          lastHitBy.set(e.id, e.sourceId);
        }
      } else if (e.type === 'death') {
        const killer = lastHitBy.get(e.id);
        if (killer !== undefined && of(killer)) of(killer).kills++;
      }
    }
  }
  return stats;
}

/** Id of the standout soldier: most kills, then most damage. Null if nobody did anything. */
export function mvp(stats) {
  let best = null;
  for (const [id, s] of stats) {
    if (!s.kills && !s.damage) continue;
    const b = best && stats.get(best);
    if (!b || s.kills > b.kills || (s.kills === b.kills && s.damage > b.damage)) best = id;
  }
  return best;
}
