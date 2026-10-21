import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/sim/physics.js';
import { createWorld, applyPlans, step } from '../src/sim/world.js';
import { parseMap, cellCenter } from '../src/sim/map.js';
import { makeWaypoint } from '../src/sim/plan.js';
import { createSoldier } from '../src/sim/soldier/soldier.js';
import { createRecorder, HEARD_TTL } from '../src/game/recorder.js';
import { NOISE_RADIUS } from '../src/sim/noise.js';

beforeAll(() => initPhysics());

// Two rooms joined by a door at column 6; a long corridor below, walled off from them.
const map = {
  name: 'noise',
  rows: [
    '###########################', //
    '#.....#.....#.............#',
    '#.....D.....#.............#',
    '#.....#.....#.............#',
    '###########################',
    '#.........................#',
    '###########################',
  ],
};

const noises = (w, ticks, team) => {
  const out = [];
  for (let i = 0; i < ticks; i++) {
    step(w);
    out.push(...w.events.filter((e) => e.type === 'noise' && (!team || e.heardBy === team)));
  }
  return out;
};

function setup(soldiers) {
  const w = createWorld(1, parseMap(map));
  const made = soldiers.map(([team, cx, cz, heading = 0]) => {
    const c = cellCenter(w.map, cx, cz);
    return createSoldier(w, { team, x: c.x, z: c.z, heading });
  });
  return { w, made };
}

describe('noise', () => {
  it('opening a door is heard through the wall by a nearby enemy, who turns toward it', () => {
    const { w, made } = setup([
      ['A', 3, 2],
      ['B', 9, 1, Math.PI], // in the next room, facing away from the door
    ]);
    const [a, b] = made;
    applyPlans(w, 'A', { [a.id]: [makeWaypoint(cellCenter(w.map, 8, 3).x, cellCenter(w.map, 8, 3).z)] });
    const heard = [];
    for (let i = 0; i < 120 && !heard.length; i++) {
      step(w);
      heard.push(...w.events.filter((e) => e.type === 'noise' && e.kind === 'door'));
    }
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ id: a.id, heardBy: 'B' });
    expect(b.alert).toMatchObject({ x: w.doors[0].x, z: w.doors[0].z });
  });

  it('nobody hears a door beyond its radius', () => {
    const { w, made } = setup([
      ['A', 3, 2],
      ['B', 25, 5], // far end of the corridor
    ]);
    const [a] = made;
    const door = w.doors[0];
    expect(Math.hypot(made[1].x - door.x, made[1].z - door.z)).toBeGreaterThan(NOISE_RADIUS.door);
    applyPlans(w, 'A', { [a.id]: [makeWaypoint(cellCenter(w.map, 8, 2).x, cellCenter(w.map, 8, 2).z)] });
    expect(noises(w, 120)).toHaveLength(0);
    expect(door.state).toBe('open');
  });

  it('running makes footsteps every half second; walking is silent', () => {
    for (const move of ['walk', 'run']) {
      const { w, made } = setup([
        ['A', 2, 5],
        ['B', 8, 2], // other side of the corridor wall
      ]);
      const dest = cellCenter(w.map, 9, 5);
      const wp = makeWaypoint(dest.x, dest.z);
      wp.move = move;
      applyPlans(w, 'A', { [made[0].id]: [wp] });
      const steps = noises(w, 60, 'B').filter((e) => e.kind === 'step');
      if (move === 'walk') expect(steps).toHaveLength(0);
      else expect(steps.length).toBeGreaterThanOrEqual(1);
      expect(steps.length).toBeLessThanOrEqual(2);
    }
  });

  it('the recorder remembers what each team heard until it goes stale', () => {
    const { w, made } = setup([
      ['A', 2, 5],
      ['B', 10, 2],
    ]);
    const dest = cellCenter(w.map, 6, 5);
    const wp = makeWaypoint(dest.x, dest.z);
    wp.move = 'run';
    applyPlans(w, 'A', { [made[0].id]: [wp] });
    const rec = createRecorder(w);
    for (let i = 0; i < 90; i++) {
      step(w);
      rec.record(w);
    }
    const last = rec.frames[rec.frames.length - 1];
    expect(last.heard.B.map((h) => h.id)).toEqual([made[0].id]);
    expect(last.heard.A).toEqual([]);
    for (let i = 0; i < HEARD_TTL + 1; i++) {
      step(w);
      rec.record(w);
    }
    expect(rec.frames[rec.frames.length - 1].heard.B).toEqual([]);
  });

  it('a soldier ordered to face an angle keeps covering it when it hears a noise', () => {
    const { w, made } = setup([
      ['A', 3, 2],
      ['B', 11, 1],
    ]);
    const [a, b] = made;
    // Blue stands in the next room and is ordered to face away from the door.
    const here = cellCenter(w.map, 11, 1);
    const wp = makeWaypoint(here.x, here.z);
    wp.actions.push({ type: 'face', x: here.x + 3, z: here.z });
    applyPlans(w, 'B', { [b.id]: [wp] });
    for (let i = 0; i < 60; i++) step(w);
    expect(b.orders).toHaveLength(0); // orders done: the soldier is idle but holding the angle
    const held = b.heading;
    // Red walks through the door behind Blue's back.
    applyPlans(w, 'A', { [a.id]: [makeWaypoint(cellCenter(w.map, 7, 2).x, cellCenter(w.map, 7, 2).z)] });
    let heard = false;
    for (let i = 0; i < 150 && !a.visible.length && !b.visible.length; i++) {
      step(w);
      heard ||= w.events.some((e) => e.type === 'noise' && e.heardBy === 'B');
    }
    expect(heard).toBe(true);
    expect(b.alert).toBeNull();
    expect(Math.abs(b.heading - held)).toBeLessThan(1e-6);
  });

  it('without a facing order, an idle soldier turns toward the noise', () => {
    const { w, made } = setup([
      ['A', 3, 2],
      ['B', 11, 1, Math.PI / 2],
    ]);
    const [a, b] = made;
    const held = b.heading;
    applyPlans(w, 'A', { [a.id]: [makeWaypoint(cellCenter(w.map, 7, 2).x, cellCenter(w.map, 7, 2).z)] });
    for (let i = 0; i < 120 && !w.doors[0].state.startsWith('open'); i++) step(w);
    step(w);
    step(w);
    expect(Math.abs(b.heading - held)).toBeGreaterThan(0.05);
  });
});
