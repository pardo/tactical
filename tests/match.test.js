import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/sim/physics.js';
import { hashWorld } from '../src/sim/world.js';
import { createMatch, MAX_TURNS } from '../src/game/match.js';
import killhouse from '../src/maps/killhouse.js';

beforeAll(() => initPhysics());

function playAiVsAi(seed) {
  const m = createMatch({ mode: 'aiVsAi', mapDef: killhouse, seed });
  const stats = { shots: 0, hits: 0, deaths: 0, throws: 0, explosions: 0, engages: 0 };
  const hashes = [];
  while (m.phase !== 'over') {
    m.beginTurn();
    while (m.stepSim()) {
      for (const e of m.world.events) {
        if (e.type === 'shot') {
          stats.shots++;
          if (e.hit) stats.hits++;
        } else if (e.type === 'death') stats.deaths++;
        else if (e.type === 'throw') stats.throws++;
        else if (e.type === 'explosion') stats.explosions++;
        else if (e.type === 'engage') stats.engages++;
      }
      if (m.phase !== 'simulating') break;
    }
    hashes.push(hashWorld(m.world));
  }
  return { m, stats, hashes };
}

describe('AI vs AI match', () => {
  it('plays to a finish with real fighting', () => {
    const { m, stats } = playAiVsAi(7);
    console.log(`winner ${m.world.winner} after ${m.turn} turns`, stats);
    expect(m.turn).toBeLessThanOrEqual(MAX_TURNS);
    expect(stats.engages).toBeGreaterThan(0);
    expect(stats.hits).toBeGreaterThan(0);
    expect(stats.deaths).toBeGreaterThan(0);
  });

  it('is deterministic turn by turn', () => {
    expect(playAiVsAi(99).hashes).toEqual(playAiVsAi(99).hashes);
  });

  it('several seeds mostly end decisively', () => {
    const results = [1, 2, 3, 4, 5].map((seed) => {
      const { m, stats } = playAiVsAi(seed);
      return { seed, winner: m.world.winner, turns: m.turn, deaths: stats.deaths, throws: stats.throws };
    });
    console.table(results);
    expect(results.filter((r) => r.winner !== 'draw').length).toBeGreaterThanOrEqual(3);
  });

  it('no side advantage: 40 seeds with identical squads split roughly evenly', () => {
    const tally = { A: 0, B: 0, draw: 0 };
    const squad = ['breacher', 'rifleman', 'lmg', 'sniper'];
    for (let seed = 200; seed < 240; seed++) {
      const m = createMatch({ mode: 'aiVsAi', mapDef: killhouse, seed, squads: { A: squad, B: squad } });
      while (m.phase !== 'over') {
        m.beginTurn();
        while (m.stepSim() && m.phase === 'simulating');
      }
      tally[m.world.winner]++;
    }
    console.log('mirrored 40-seed tally', tally);
    expect(tally.draw).toBeLessThanOrEqual(6);
    expect(tally.A).toBeGreaterThanOrEqual(14);
    expect(tally.B).toBeGreaterThanOrEqual(14);
  }, 120000);
});
