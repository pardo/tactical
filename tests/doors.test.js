import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/sim/physics.js';
import { createWorld, spawnSquads, applyPlans, step, beginTurnClock } from '../src/sim/world.js';
import { parseMap, cellCenter } from '../src/sim/map.js';
import { makeWaypoint } from '../src/sim/plan.js';
import { hasLineOfSight } from '../src/sim/los.js';
import { DOOR_OPEN_TIME } from '../src/sim/doors.js';

beforeAll(() => initPhysics());

// Two rooms joined by a single door at column 6.
const rooms = {
  name: 'rooms',
  rows: [
    '#############', //
    '#A....#.....#',
    '#.....D....B#',
    '#.....#.....#',
    '#############',
  ],
};

const run = (w, ticks) => {
  for (let i = 0; i < ticks && !w.winner; i++) step(w);
};

describe('doors', () => {
  it('a closed door blocks sight; an open one does not', () => {
    const w = createWorld(1, parseMap(rooms));
    const a = cellCenter(w.map, 3, 2);
    const b = cellCenter(w.map, 9, 2);
    expect(w.doors).toHaveLength(1);
    expect(hasLineOfSight(w, a.x, 1.5, a.z, b.x, 1.5, b.z)).toBe(false);
    w.doors[0].state = 'open';
    w.physics.removeCollider(w.doors[0].collider, false);
    w.physics.step();
    expect(hasLineOfSight(w, a.x, 1.5, a.z, b.x, 1.5, b.z)).toBe(true);
  });

  it('walking through a closed door opens it after a short pause', () => {
    const w = createWorld(1, parseMap(rooms));
    spawnSquads(w, { A: ['rifleman'], B: ['rifleman'] });
    const [a, b] = w.soldiers;
    b.fire = 'hold';
    a.fire = 'hold';
    const target = cellCenter(w.map, 8, 2);
    applyPlans(w, 'A', { [a.id]: [{ ...makeWaypoint(target.x, target.z), fire: 'hold' }] });
    let openedAt = null;
    for (let i = 0; i < 60 * 8 && openedAt === null; i++) {
      step(w);
      if (w.events.some((e) => e.type === 'door' && e.state === 'open')) openedAt = i;
    }
    expect(openedAt).not.toBeNull();
    // 4 m at walking speed is 2.5 s; the door adds DOOR_OPEN_TIME on top.
    expect(openedAt / 60).toBeGreaterThan(DOOR_OPEN_TIME);
    run(w, 60 * 4);
    expect(Math.hypot(a.x - target.x, a.z - target.z)).toBeLessThan(0.05);
  });

  it('a breach charge blows the door and stuns the defender behind it', () => {
    const w = createWorld(2, parseMap(rooms));
    spawnSquads(w, { A: ['breacher'], B: ['rifleman'] });
    const [a, b] = w.soldiers;
    const stack = cellCenter(w.map, 5, 2);
    const door = w.doors[0];
    // Defender waits right behind the door, facing it.
    const behind = cellCenter(w.map, 8, 2);
    b.x = behind.x;
    b.z = behind.z;
    b.heading = -Math.PI / 2;
    const wp = { ...makeWaypoint(stack.x, stack.z), actions: [{ type: 'breach', x: door.x, z: door.z }] };
    applyPlans(w, 'A', { [a.id]: [wp] });
    let breach = null;
    for (let i = 0; i < 60 * 8 && !breach; i++) {
      step(w);
      breach = w.events.find((e) => e.type === 'breach');
    }
    expect(breach).toBeTruthy();
    expect(door.state).toBe('breached');
    expect(a.charges).toBe(1);
    expect(b.blind).toBeGreaterThan(0.5);
  });

  it("'until' holds a soldier until that moment of the turn", () => {
    const w = createWorld(1, parseMap(rooms));
    spawnSquads(w, { A: ['rifleman'], B: ['rifleman'] });
    const [a] = w.soldiers;
    const here = { x: a.x, z: a.z };
    const next = cellCenter(w.map, 3, 2);
    applyPlans(w, 'A', {
      [a.id]: [{ ...makeWaypoint(here.x, here.z), actions: [{ type: 'until', t: 2 }] }, makeWaypoint(next.x, next.z)],
    });
    beginTurnClock(w);
    run(w, 60 * 1.9);
    expect(Math.hypot(a.x - here.x, a.z - here.z)).toBeLessThan(0.01);
    run(w, 60 * 0.5);
    expect(Math.hypot(a.x - here.x, a.z - here.z)).toBeGreaterThan(0.1);
  });
});

describe('destructible cover', () => {
  it('a frag next to low cover destroys it: walkable, and no longer blocks sight', async () => {
    const { Tile, isWalkable } = await import('../src/sim/map.js');
    const w = createWorld(1, parseMap({ name: 'c', rows: ['############', '#A........B#', '#....==....#', '#..........#', '############'] }));
    spawnSquads(w, { A: ['demolition'], B: ['rifleman'] });
    const [a] = w.soldiers;
    a.hp = 1e6;
    w.soldiers[1].hp = 1e6;
    const cover = cellCenter(w.map, 5, 2);
    // Line across the cover at knee height is blocked before the blast.
    expect(hasLineOfSight(w, cover.x, 0.5, cover.z - 1.2, cover.x, 0.5, cover.z + 1.2)).toBe(false);
    const wp = { ...makeWaypoint(a.x, a.z), fire: 'hold', actions: [{ type: 'grenade', kind: 'frag', x: cover.x + 0.5, z: cover.z }] };
    applyPlans(w, 'A', { [a.id]: [wp] });
    run(w, 60 * 4);
    expect(w.destroyed.length).toBeGreaterThan(0);
    expect(w.map.tiles[2 * w.map.width + 5]).toBe(Tile.FLOOR);
    expect(isWalkable(w.map, 5, 2)).toBe(true);
    w.physics.step();
    expect(hasLineOfSight(w, cover.x, 0.5, cover.z - 1.2, cover.x, 0.5, cover.z + 1.2)).toBe(true);
  });
});
