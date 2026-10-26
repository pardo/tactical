import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/sim/physics.js';
import { createWorld, applyPlans, step } from '../src/sim/world.js';
import { parseMap } from '../src/sim/map.js';
import { metre, thick } from './helpers.js';
import { makeWaypoint } from '../src/sim/plan.js';
import { createSoldier } from '../src/sim/soldier/soldier.js';
import { createGrenadePredictor } from '../src/plan/grenadePath.js';

beforeAll(() => initPhysics());

// A room with a wall 4 m in front of the thrower; the enemy is sealed off on the far right.
const rows = [
  '##############',
  '#.....#.....##',
  '#.....#.....#.',
  '#...........##',
  '##############',
];

function throwAndWatch(target) {
  const w = createWorld(1, parseMap(thick({ name: 'g', rows })));
  const at = metre(w.map, 2, 2);
  const s = createSoldier(w, { team: 'A', x: at.x, z: at.z, role: 'demolition' });
  createSoldier(w, { team: 'B', ...metre(w.map, 13, 2) });
  const predictor = createGrenadePredictor(w);
  const wp = makeWaypoint(at.x, at.z);
  wp.actions.push({ type: 'grenade', kind: 'frag', x: target.x, z: target.z });
  const pred = predictor.predict(wp, target, 'frag');
  applyPlans(w, 'A', { [s.id]: [wp] });
  let boom = null;
  for (let i = 0; i < 400 && !boom; i++) {
    step(w);
    boom = w.events.find((e) => e.type === 'explosion') ?? null;
  }
  return { pred, boom, predictor, s };
}

describe('grenade flight prediction', () => {
  it('matches where the sim grenade goes off, and flags a throw into a wall as a bounce', () => {
    const map = parseMap(thick({ name: 'g', rows }));
    // Target behind the wall at column 6: the grenade hits the wall and drops back.
    const { pred, boom } = throwAndWatch(metre(map, 8, 1));
    expect(boom).not.toBeNull();
    expect(Math.hypot(pred.burst.x - boom.x, pred.burst.z - boom.z)).toBeLessThan(0.05);
    expect(pred.bounces.length).toBeGreaterThan(0);
    expect(pred.burst.x).toBeLessThan(metre(map, 6, 1).x); // stayed on our side of the wall
  });

  it('an open throw lands near the target without wall bounces', () => {
    const map = parseMap(thick({ name: 'g', rows }));
    const target = metre(map, 5, 3);
    const { pred, boom } = throwAndWatch(target);
    expect(pred.bounces).toEqual([]);
    expect(Math.hypot(pred.burst.x - boom.x, pred.burst.z - boom.z)).toBeLessThan(0.05);
    // It rolls on a bit after landing; the preview shows where it really ends up.
    expect(Math.hypot(pred.burst.x - target.x, pred.burst.z - target.z)).toBeLessThan(2.5);
  });

  it('knows when the blast reaches the thrower', () => {
    const map = parseMap(thick({ name: 'g', rows }));
    const { pred, predictor, s } = throwAndWatch(metre(map, 8, 1));
    expect(predictor.reaches(pred.burst, 'frag', s)).toBe(true);
    expect(predictor.reaches(pred.burst, 'smoke', s)).toBe(false);
  });
});
