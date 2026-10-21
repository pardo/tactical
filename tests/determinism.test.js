import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/sim/physics.js';
import { createWorld, hashWorld } from '../src/sim/world.js';
import { spawnDemoBoxes } from '../src/sim/demo.js';
import { runTurn } from '../src/sim/turn.js';
import { createRng } from '../src/sim/rng.js';

beforeAll(() => initPhysics());

function simulate(seed, turns) {
  const world = createWorld(seed);
  spawnDemoBoxes(world);
  const hashes = [];
  for (let t = 0; t < turns; t++) {
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
    expect(simulate(1234, 3)).toEqual(simulate(1234, 3));
  });

  it('different seed diverges', () => {
    expect(simulate(1234, 1)).not.toEqual(simulate(4321, 1));
  });
});
