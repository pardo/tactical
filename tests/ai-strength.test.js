import { beforeAll, expect, it } from 'vitest';
import { initPhysics } from '../src/sim/physics.js';
import { createMatch } from '../src/game/match.js';
import { createAI } from '../src/ai/planner.js';
import { makeWaypoint } from '../src/sim/plan.js';
import { cellCenter } from '../src/sim/map.js';
import { MAPS, MAP_IDS } from '../src/maps/index.js';
beforeAll(() => initPhysics());

/** Naive opponent: everyone runs at the enemy spawn, fire at will. */
function rushPlans(world, team) {
  const enemy = team === 'A' ? 'B' : 'A';
  const sp = world.map.spawns[enemy][0];
  const target = cellCenter(world.map, sp.cx, sp.cz);
  const plans = {};
  for (const s of world.soldiers) if (s.team === team && s.alive) plans[s.id] = [{ ...makeWaypoint(target.x, target.z), move: 'run' }];
  return plans;
}

it('the AI beats a naive "everyone rush the spawn" opponent most of the time', () => {
  const tally = { ai: 0, rush: 0, draw: 0 };
  for (const id of MAP_IDS) {
    for (let seed = 1; seed <= 6; seed++) {
      const aiTeam = seed % 2 ? 'A' : 'B';
      const rushTeam = aiTeam === 'A' ? 'B' : 'A';
      const squad = ['breacher', 'rifleman', 'lmg', 'sniper'];
      const m = createMatch({ mode: 'replay', mapDef: MAPS[id], mapId: id, seed, squads: { A: squad, B: squad } });
      const ai = createAI(aiTeam, seed);
      while (m.phase !== 'over') {
        const plans = { [aiTeam]: ai.plan(m.world).plans, [rushTeam]: rushPlans(m.world, rushTeam) };
        m.beginTurn(plans);
        while (m.stepSim()) {
          ai.observe(m.world);
          if (m.phase !== 'simulating') break;
        }
      }
      const w = m.world.winner;
      tally[w === aiTeam ? 'ai' : w === 'draw' ? 'draw' : 'rush']++;
    }
  }
  console.log('AI vs rush', tally);
  expect(tally.ai / (tally.ai + tally.rush + tally.draw)).toBeGreaterThanOrEqual(0.65);
}, 120000);
