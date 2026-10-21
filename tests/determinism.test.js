import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/sim/physics.js';
import { createWorld, hashWorld, spawnSquads } from '../src/sim/world.js';
import { parseMap } from '../src/sim/map.js';
import { commandMove } from '../src/sim/commands.js';
import { runTurn } from '../src/sim/turn.js';
import { createRng } from '../src/sim/rng.js';
import killhouse from '../src/maps/killhouse.js';

beforeAll(() => initPhysics());

/** Every turn, each soldier gets a random move order drawn from the world rng. */
function simulate(seed, turns) {
  const world = createWorld(seed, parseMap(killhouse));
  spawnSquads(world);
  const hashes = [];
  for (let t = 0; t < turns; t++) {
    for (const s of world.soldiers) {
      const x = world.rng.range(-15, 15);
      const z = world.rng.range(-8, 8);
      commandMove(world, s.id, x, z, world.rng.next() < 0.5 ? 'walk' : 'run');
    }
    runTurn(world, []);
    hashes.push(hashWorld(world));
  }
  return hashes;
}

describe('rng', () => {
  it('is reproducible from a seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });
});

describe('determinism', () => {
  it('same seed gives identical state hash every turn', () => {
    expect(simulate(1234, 10)).toEqual(simulate(1234, 10));
  });

  it('different seed diverges', () => {
    expect(simulate(1234, 2)).not.toEqual(simulate(4321, 2));
  });
});
