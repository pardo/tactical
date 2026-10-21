import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/sim/physics.js';
import { createWorld, spawnSquads, applyPlans, step } from '../src/sim/world.js';
import { parseMap, cellCenter } from '../src/sim/map.js';
import { makeWaypoint } from '../src/sim/plan.js';
import { sanitizeSquad, cycleRole, ROLES, WEAPONS } from '../src/sim/roles.js';
import { reactionTime, weaponDamage } from '../src/sim/soldier/combat.js';
import { hasLineOfSight } from '../src/sim/los.js';

beforeAll(() => initPhysics());

// Long open corridor: A on the left, B on the right, nothing in between.
const corridor = {
  name: 'corridor',
  rows: ['##########################', '#A......................B#', '##########################'],
};

function duel(roleA, roleB, setup = () => {}) {
  const world = createWorld(5, parseMap(corridor));
  spawnSquads(world, { A: [roleA], B: [roleB] });
  // spawnSquads fills to 4 with riflemen but only one spawn cell each exists.
  setup(world);
  let ticks = 0;
  while (!world.winner && ticks < 60 * 20) {
    step(world);
    ticks++;
  }
  return { world, ticks };
}

describe('squads', () => {
  it('sanitizes size, unknown roles and limits', () => {
    expect(sanitizeSquad(['sniper', 'sniper', 'bogus', 'lmg', 'lmg'])).toEqual(['sniper', 'lmg', 'rifleman', 'rifleman']);
  });

  it('cycling skips roles that are at their limit', () => {
    const squad = ['sniper', 'rifleman', 'rifleman', 'rifleman'];
    const seen = new Set();
    let s = squad;
    for (let i = 0; i < 10; i++) {
      s = cycleRole(s, 1);
      seen.add(s[1]);
    }
    expect(seen.has('sniper')).toBe(false);
    expect(seen.has('lmg')).toBe(true);
  });

  it('spawns soldiers with role stats and gear', () => {
    const world = createWorld(1, parseMap(corridor));
    spawnSquads(world, { A: ['breacher'], B: ['lmg'] });
    const [a, b] = world.soldiers;
    expect(a).toMatchObject({ role: 'breacher', weapon: 'shotgun', hp: ROLES.breacher.hp, charges: 2 });
    expect(a.gear.flash).toBe(2);
    expect(b.ammo).toBe(WEAPONS.lmg.mag);
  });
});

describe('weapons', () => {
  it('sniper holding an angle reacts faster than anyone; moving it is the slowest', () => {
    const sniper = { role: 'sniper', suppression: 0 };
    const rifle = { role: 'rifleman', suppression: 0 };
    expect(reactionTime(sniper, 'holding')).toBeLessThan(reactionTime(rifle, 'holding'));
    expect(reactionTime(sniper, 'run')).toBeGreaterThan(reactionTime(rifle, 'run'));
  });

  it('shotgun damage falls off with range', () => {
    expect(weaponDamage('shotgun', 2)).toBe(WEAPONS.shotgun.damage);
    expect(weaponDamage('shotgun', 20)).toBeLessThan(WEAPONS.shotgun.damage * 0.3);
    expect(weaponDamage('rifle', 30)).toBe(WEAPONS.rifle.damage);
  });

  it('a holding sniper wins a long-range duel against a walking rifleman', () => {
    let wins = 0;
    for (let seed = 0; seed < 6; seed++) {
      const { world } = duel('sniper', 'rifleman', (w) => {
        w.rng.state = seed * 977 + 1;
        const b = w.soldiers.find((s) => s.team === 'B');
        const a = w.soldiers.find((s) => s.team === 'A');
        const target = cellCenter(w.map, 2, 1);
        applyPlans(w, 'B', { [b.id]: [makeWaypoint(target.x, target.z)] });
        a.heading = Math.PI / 2; // facing down the corridor towards B
      });
      if (world.winner === 'A') wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(5);
  });

  it('magazines run dry and reload', () => {
    const w = createWorld(5, parseMap(corridor));
    spawnSquads(w, { A: ['rifleman'], B: ['rifleman'] });
    for (const s of w.soldiers) s.hp = 1e6; // nobody dies; just burn ammo
    w.soldiers[0].heading = Math.PI / 2;
    w.soldiers[1].heading = -Math.PI / 2;
    let reloads = 0;
    for (let i = 0; i < 60 * 8; i++) {
      step(w);
      reloads += w.events.filter((e) => e.type === 'reload').length;
    }
    expect(reloads).toBeGreaterThan(0);
  });
});

describe('utility grenades', () => {
  it('smoke blocks line of sight', () => {
    const w = createWorld(1, parseMap(corridor));
    expect(hasLineOfSight(w, -10, 1.5, 0, 10, 1.5, 0)).toBe(true);
    w.smokes.push({ x: 0, z: 0, r: 3, until: 1e9 });
    expect(hasLineOfSight(w, -10, 1.5, 0, 10, 1.5, 0)).toBe(false);
  });

  it('a flashbang blinds whoever sees it and they stop shooting', () => {
    const w = createWorld(3, parseMap(corridor));
    spawnSquads(w, { A: ['breacher'], B: ['rifleman'] });
    const [a, b] = w.soldiers;
    a.hp = 1e6; // the thrower must survive until the fuse runs out, or the match ends first
    b.heading = -Math.PI / 2; // looking towards A, and towards the incoming flash
    const mid = cellCenter(w.map, 18, 1);
    // Hold fire, otherwise the thrower starts shooting instead of throwing.
    const wp = { ...makeWaypoint(a.x, a.z), fire: 'hold', actions: [{ type: 'grenade', kind: 'flash', x: mid.x, z: mid.z }] };
    applyPlans(w, 'A', { [a.id]: [wp] });
    let blinded = null;
    for (let i = 0; i < 60 * 4 && !blinded; i++) {
      step(w);
      blinded = w.events.find((e) => e.type === 'blinded' && e.id === b.id);
    }
    expect(blinded).toBeTruthy();
    expect(b.blind).toBeGreaterThan(1);
    step(w);
    expect(b.visible).toEqual([]);
  });
});
