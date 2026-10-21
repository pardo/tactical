import { describe, expect, it } from 'vitest';
import { ACTION_HELP, helpFor, describeWaypoint } from '../src/ui/help.js';
import { makeWaypoint } from '../src/sim/plan.js';

describe('action help', () => {
  it('explains every planning control', () => {
    const controls = [
      ['move', 'walk'], ['move', 'run'],
      ['fire', 'onSight'], ['fire', 'return'], ['fire', 'hold'],
      ['addCover', ''], ['addStance', 'crouch'], ['addStance', 'stand'], ['addWait', ''], ['addSync', ''],
      ['pick', 'face'], ['pick', 'look'], ['pick', 'breach'],
      ['pick', 'grenade:frag'], ['pick', 'grenade:flash'], ['pick', 'grenade:smoke'],
    ];
    for (const [action, arg] of controls) expect(helpFor(action, arg), `${action}:${arg}`).toMatch(/: \S/);
    expect(Object.keys(ACTION_HELP)).toHaveLength(controls.length);
    expect(helpFor('deleteWaypoint')).toBeNull();
  });

  it('describes a waypoint in words, actions in order', () => {
    const w = makeWaypoint(1, 2);
    expect(describeWaypoint(w)).toBe('Walk here, firing at will.');
    w.move = 'run';
    w.fire = 'hold';
    w.actions.push({ type: 'stance', stance: 'crouch' }, { type: 'wait', t: 2 }, { type: 'grenade', kind: 'flash', x: 0, z: 0 });
    expect(describeWaypoint(w)).toBe('Run here, holding fire, then crouch → wait 2s → throw a flashbang.');
  });
});
