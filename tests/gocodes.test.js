import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/sim/physics.js';
import { createWorld, applyPlans, step, hashWorld } from '../src/sim/world.js';
import { parseMap, cellCenter } from '../src/sim/map.js';
import { makeWaypoint, sanitizeWaypoints, sanitizeGoCodes } from '../src/sim/plan.js';
import { createSoldier } from '../src/sim/soldier/soldier.js';
import { createPlanning } from '../src/ui/planning.js';
import { estimatePlan } from '../src/plan/estimate.js';
import { TURN_TICKS } from '../src/sim/constants.js';

beforeAll(() => initPhysics());

// An enemy sealed in its own pocket on the right keeps the match going without interfering.
const map = parseMap({ name: 'g', rows: ['#############', '#.........#.#', '#.........#.#', '#############'] });
const at = (cx, cz) => cellCenter(map, cx, cz);

function codePlan() {
  // Walk one cell, wait for Alpha, then walk on.
  const w1 = makeWaypoint(at(2, 1).x, at(2, 1).z);
  w1.actions.push({ type: 'code', code: 'A' });
  return [w1, makeWaypoint(at(8, 1).x, at(8, 1).z)];
}

describe('go codes', () => {
  it('a soldier waits on its code across turns and goes when the code is released', () => {
    const w = createWorld(1, map);
    const s = createSoldier(w, { team: 'A', ...at(1, 1) });
    createSoldier(w, { team: 'B', ...at(11, 1) });
    const turn = (plans) => {
      applyPlans(w, 'A', plans);
      for (let i = 0; i < TURN_TICKS; i++) step(w);
    };
    turn({ [s.id]: codePlan() });
    turn({ [s.id]: s.orders }); // next turn: same orders, nothing released
    expect(Math.abs(s.x - at(2, 1).x)).toBeLessThan(0.01);
    expect(s.orders).toHaveLength(2);
    turn({ [s.id]: s.orders, go: ['A'] });
    expect(s.x).toBeGreaterThan(at(6, 1).x);
  });

  it('released codes are part of the world state (hash) and reset every turn', () => {
    const w = createWorld(1, map);
    const before = hashWorld(w);
    applyPlans(w, 'A', { go: ['B', 'nope', 'A'] });
    expect(w.goCodes.A).toEqual(['A', 'B']);
    expect(hashWorld(w)).not.toBe(before);
    applyPlans(w, 'A', {});
    expect(w.goCodes.A).toEqual([]);
  });

  it('sanitizes code actions and release lists', () => {
    expect(sanitizeGoCodes('A')).toEqual([]);
    const [wp] = sanitizeWaypoints(map, [{ x: 0, z: 0, actions: [{ type: 'code', code: 'Z' }] }]);
    expect(wp.actions).toEqual([{ type: 'code', code: 'A' }]);
  });

  it('planning: tapping Go code cycles Alpha → Bravo; release buttons toggle with undo', () => {
    const drafts = {};
    const p = createPlanning(map);
    p.begin('A', drafts, () => [{ id: 1, team: 'A', alive: true, ...at(1, 1) }]);
    p.addWaypoint(at(3, 1).x, at(3, 1).z);
    p.addAction({ type: 'code', code: 'A' });
    p.addAction({ type: 'code', code: 'A' });
    expect(drafts[1][0].actions).toEqual([{ type: 'code', code: 'B' }]);
    expect(p.usedCodes).toEqual(['B']);
    p.toggleGo('B');
    expect(drafts.go).toEqual(['B']);
    p.undo();
    expect(drafts.go).toBeUndefined();
  });

  it('estimate: waypoints behind an unreleased code are held; released codes cost nothing', () => {
    const wps = codePlan();
    const held = estimatePlan(map, at(1, 1), wps);
    expect(held.marks[0].held).toBeUndefined(); // reaches the code waypoint
    expect(held.marks[1].held).toBe('A');
    expect(held.atTurnEnd.x).toBeCloseTo(at(2, 1).x);
    const go = estimatePlan(map, at(1, 1), wps, null, ['A']);
    expect(go.marks[1].held).toBeUndefined();
    expect(Number.isFinite(go.marks[1].arrive)).toBe(true);
  });
});
