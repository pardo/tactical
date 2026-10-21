import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/sim/physics.js';
import { createWorld, spawnSquads, step } from '../src/sim/world.js';
import { parseMap, cellCenter } from '../src/sim/map.js';
import { wrapAngle, headingTo } from '../src/sim/fmath.js';

beforeAll(() => initPhysics());

const field = {
  name: 'field',
  rows: ['####################', '#A................B#', '#..................#', '#A.................#', '####################'],
};

function setup() {
  const w = createWorld(4, parseMap(field));
  spawnSquads(w, { A: ['rifleman', 'rifleman'], B: ['rifleman'] });
  return w;
}

const facingError = (s, t) => Math.abs(wrapAngle(headingTo(t.x - s.x, t.z - s.z) - s.heading));

describe('autonomy', () => {
  it('a soldier shot in the back turns around and fights back', () => {
    const w = setup();
    const [a1, a2, b] = w.soldiers;
    a2.alive = false; // keep it 1v1
    a2.hp = 0;
    a1.heading = -Math.PI / 2; // facing the wall, back to the enemy
    a1.hp = 1000;
    b.heading = -Math.PI / 2; // B looks at A
    let engagedBack = false;
    for (let i = 0; i < 60 * 4 && !engagedBack; i++) {
      step(w);
      engagedBack = w.events.some((e) => e.type === 'engage' && e.id === a1.id);
    }
    expect(engagedBack).toBe(true);
  });

  it('an idle teammate turns toward an enemy its buddy has spotted', () => {
    const w = setup();
    const [a1, a2, b] = w.soldiers;
    b.fire = 'hold';
    b.heading = Math.PI / 2; // looking away
    a1.heading = Math.PI / 2; // a1 looks at B
    // a2 is somewhere else, looking at the wall, behind a little cover so it can't see B itself.
    const spot = cellCenter(w.map, 2, 3);
    a2.x = spot.x;
    a2.z = spot.z;
    a2.heading = Math.PI; // facing -z... any direction away from B
    a2.fire = 'hold';
    a1.fire = 'hold';
    const before = facingError(a2, b);
    for (let i = 0; i < 60; i++) step(w);
    expect(before).toBeGreaterThan(1);
    expect(facingError(a2, b)).toBeLessThan(0.2);
  });

  it('an idle soldier under heavy fire gets down', () => {
    const w = setup();
    const [a1] = w.soldiers;
    a1.suppression = 0.9;
    step(w);
    expect(a1.stance).toBe('crouch');
  });
});

describe('take cover action', () => {
  it('moves behind the nearest low cover facing the threat and crouches', async () => {
    const { applyPlans } = await import('../src/sim/world.js');
    const { makeWaypoint } = await import('../src/sim/plan.js');
    const w = createWorld(2, parseMap({ name: 'cv', rows: ['############', '#A........B#', '#..........#', '#.....=....#', '#..........#', '############'] }));
    spawnSquads(w, { A: ['rifleman'], B: ['rifleman'] });
    const [a, b] = w.soldiers;
    a.fire = b.fire = 'hold';
    const start = cellCenter(w.map, 4, 2);
    // Face +x (toward the cover at column 6 / B's side), then take cover.
    const wp = { ...makeWaypoint(start.x, start.z), fire: 'hold', actions: [{ type: 'face', x: start.x + 5, z: start.z }, { type: 'cover' }] };
    applyPlans(w, 'A', { [a.id]: [wp] });
    for (let i = 0; i < 60 * 6; i++) step(w);
    const spot = cellCenter(w.map, 5, 3); // directly west of the cover tile
    expect(Math.hypot(a.x - spot.x, a.z - spot.z)).toBeLessThan(0.05);
    expect(a.stance).toBe('crouch');
  });
});

describe('return fire mode', () => {
  it('ignores an enemy that is not engaging, but answers one that is', async () => {
    const w = setup();
    const [a1, a2, b] = w.soldiers;
    a2.alive = false;
    a2.hp = 0;
    a1.fire = 'return';
    a1.heading = Math.PI / 2; // looking at B
    b.fire = 'hold';
    b.heading = Math.PI / 2; // B looks away
    for (let i = 0; i < 60; i++) step(w);
    expect(a1.visible).toContain(b.id);
    expect(w.soldiers[2].hp).toBe(b.maxHp); // never shot
    b.fire = 'onSight';
    b.heading = -Math.PI / 2; // B turns and engages A
    let shotBack = false;
    for (let i = 0; i < 120 && !shotBack; i++) {
      step(w);
      shotBack = w.events.some((e) => e.type === 'shot' && e.from === a1.id);
    }
    expect(shotBack).toBe(true);
  });
});
