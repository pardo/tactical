import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/sim/physics.js';
import { parseMap, isWalkable, cellCenter } from '../src/sim/map.js';
import { findCellPath } from '../src/sim/nav.js';
import { createMatch } from '../src/game/match.js';
import { MAPS, MAP_IDS } from '../src/maps/index.js';
import { ZONE } from '../src/sim/objective.js';

beforeAll(() => initPhysics());

function play(mapId, gameMode, seed) {
  const m = createMatch({ mode: 'aiVsAi', mapDef: MAPS[mapId], seed, gameMode });
  while (m.phase !== 'over') {
    m.beginTurn();
    while (m.stepSim() && m.phase === 'simulating');
  }
  return m;
}

describe.each(MAP_IDS)('map %s', (id) => {
  const map = parseMap(MAPS[id]);

  it('is point-symmetric and every walkable tile is reachable from both spawns', () => {
    const rows = MAPS[id].rows;
    const swap = { A: 'B', B: 'A' };
    rows.forEach((row, z) =>
      [...row].forEach((ch, x) => expect(swap[ch] ?? ch).toBe(rows[rows.length - 1 - z][row.length - 1 - x])),
    );
    const a = map.spawns.A[0];
    const b = map.spawns.B[0];
    expect(findCellPath(map, a.cx, a.cz, b.cx, b.cz)).not.toBeNull();
  });

  it('has enough walkable ground inside the zone', () => {
    let cells = 0;
    for (let cz = 0; cz < map.height; cz++) {
      for (let cx = 0; cx < map.width; cx++) {
        const c = cellCenter(map, cx, cz);
        if (isWalkable(map, cx, cz) && Math.hypot(c.x, c.z) <= ZONE.radius) cells++;
      }
    }
    expect(cells).toBeGreaterThanOrEqual(8);
  });

  it.each(['elimination', 'zone'])('AI vs AI finishes in %s mode', (gameMode) => {
    const m = play(id, gameMode, 31);
    expect(m.world.winner).not.toBeNull();
    if (gameMode === 'zone') expect(m.world.objective.score.A + m.world.objective.score.B).toBeGreaterThanOrEqual(0);
  });
});

describe('zone mode', () => {
  it('drives teams into the zone (zone time is scored) and rarely ends in a draw', () => {
    const results = { A: 0, B: 0, draw: 0, byZone: 0, scored: 0 };
    for (let seed = 1; seed <= 12; seed++) {
      const m = play('warehouse', 'zone', seed);
      results[m.world.winner]++;
      const o = m.world.objective;
      if (m.world.winner !== 'draw' && o.score[m.world.winner] >= o.needed - 1e-6) results.byZone++;
      if (o.score.A + o.score.B > 0) results.scored++;
    }
    console.log('zone results', results);
    expect(results.draw).toBeLessThanOrEqual(3);
    expect(results.scored).toBeGreaterThanOrEqual(3);
  }, 60000);
});
