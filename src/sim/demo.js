import { addBox } from './world.js';

/** M0 sandbox: drop a seeded pile of boxes to exercise physics + RNG. */
export function spawnDemoBoxes(world, count = 40) {
  for (let i = 0; i < count; i++) {
    addBox(world, {
      x: world.rng.range(-4, 4),
      y: 2 + i * 0.6,
      z: world.rng.range(-4, 4),
      size: world.rng.range(0.3, 0.8),
    });
  }
}
