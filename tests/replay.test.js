import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/sim/physics.js';
import { hashWorld } from '../src/sim/world.js';
import { createMatch } from '../src/game/match.js';
import { exportReplay, loadReplay, validateReplay } from '../src/game/replay.js';
import { MAPS } from '../src/maps/index.js';
import { blankRows } from '../src/ui/editor.js';

beforeAll(() => initPhysics());

function playAi(seed, mapId = 'embassy', gameMode = 'elimination') {
  const m = createMatch({ mode: 'aiVsAi', mapDef: MAPS[mapId], mapId, seed, gameMode });
  const hashes = [];
  while (m.phase !== 'over') {
    m.beginTurn();
    while (m.stepSim() && m.phase === 'simulating');
    hashes.push(hashWorld(m.world));
  }
  return { m, hashes };
}

describe('replays', () => {
  it('a saved match re-simulates to the identical result, turn by turn', () => {
    const { m, hashes } = playAi(77);
    const file = JSON.parse(JSON.stringify(exportReplay(m))); // through a file and back
    expect(file.turns).toHaveLength(m.turn);
    const replayed = [];
    let lastTick = -1;
    const r = loadReplay(file, {
      onTick: (w) => {
        if (w.tick % 300 === 0 || w.winner) {
          if (w.tick !== lastTick) replayed.push(w.tick);
          lastTick = w.tick;
        }
      },
    });
    expect(hashWorld(r.world)).toBe(hashes[hashes.length - 1]);
    expect(r.world.winner).toBe(m.world.winner);
    expect(replayed.length).toBeGreaterThan(0);
  });

  it('replays of zone matches keep the objective state', () => {
    const { m } = playAi(5, 'warehouse', 'zone');
    const r = loadReplay(JSON.parse(JSON.stringify(exportReplay(m))));
    expect(r.world.objective.score).toEqual(m.world.objective.score);
  });

  it('custom maps are embedded in the file and replay without the map installed', () => {
    const def = { name: 'Garage', rows: blankRows(24, 14) };
    const m = createMatch({ mode: 'aiVsAi', mapDef: def, mapId: 'custom:Garage', seed: 9 });
    while (m.phase !== 'over') {
      m.beginTurn();
      while (m.stepSim() && m.phase === 'simulating');
    }
    const file = JSON.parse(JSON.stringify(exportReplay(m)));
    expect(file.mapDef.rows).toEqual(def.rows);
    const r = loadReplay(file);
    expect(hashWorld(r.world)).toBe(hashWorld(m.world));
  });

  it('rejects bad files', () => {
    expect(() => validateReplay(null)).toThrow();
    expect(() => validateReplay({ v: 99 })).toThrow(/version/);
    expect(() => validateReplay({ v: 1, mapId: 'nope', gameMode: 'zone', seed: 1, turns: [] })).toThrow(/map/);
  });
});
