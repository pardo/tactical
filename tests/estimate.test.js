import { describe, expect, it } from 'vitest';
import { parseMap, cellCenter } from '../src/sim/map.js';
import { makeWaypoint } from '../src/sim/plan.js';
import { estimatePlan } from '../src/plan/estimate.js';
import { SPEED } from '../src/sim/soldier/orders.js';

const open = parseMap({ name: 'open', rows: ['############', '#..........#', '#..........#', '############'] });

describe('estimatePlan', () => {
  it('times a straight walk and finds the turn-end position', () => {
    const a = cellCenter(open, 1, 1);
    const b = cellCenter(open, 10, 1); // 9 m away
    const est = estimatePlan(open, { ...a, stance: 'stand' }, [makeWaypoint(b.x, b.z)]);
    expect(est.marks[0].arrive).toBeCloseTo(9 / SPEED.walk, 5);
    // 5 s of walking at 1.6 m/s = 8 m from the start.
    expect(est.atTurnEnd.x).toBeCloseTo(a.x + 5 * SPEED.walk, 5);
  });

  it('adds action time and reports no turn-end point when the plan is short', () => {
    const a = cellCenter(open, 1, 1);
    const wp = makeWaypoint(a.x + 1, a.z);
    wp.actions.push({ type: 'wait', t: 2 });
    const est = estimatePlan(open, { ...a }, [wp]);
    expect(est.marks[0].done - est.marks[0].arrive).toBeCloseTo(2, 5);
    expect(est.atTurnEnd).toBeNull();
  });

  it('marks unreachable waypoints as blocked', () => {
    const a = cellCenter(open, 1, 1);
    const est = estimatePlan(open, { ...a }, [makeWaypoint(0, -1.5)]); // the wall row
    expect(est.legs[0].blocked).toBe(true);
    expect(est.marks[0].arrive).toBe(Infinity);
  });
});
