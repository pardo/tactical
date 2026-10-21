import { createRng } from './rng.js';
import { createHasher } from './hash.js';
import { createPhysicsWorld, RAPIER } from './physics.js';

/**
 * Deterministic world state. No Three.js, DOM, or wall-clock time in here.
 * Entities live in an array ordered by id so iteration order is stable.
 */
export function createWorld(seed) {
  const physics = createPhysicsWorld();
  physics.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.1, 20).setTranslation(0, -0.1, 0));

  return {
    tick: 0,
    rng: createRng(seed),
    physics,
    entities: [],
    nextId: 1,
  };
}

export function addBox(world, { x, y, z, size = 0.5 }) {
  const body = world.physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z));
  world.physics.createCollider(RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2).setRestitution(0.3), body);
  const entity = { id: world.nextId++, kind: 'box', size, body };
  world.entities.push(entity);
  return entity;
}

export function step(world) {
  world.physics.step();
  world.tick++;
}

export function hashWorld(world) {
  const h = createHasher().num(world.tick).num(world.rng.state);
  for (const e of world.entities) {
    const p = e.body.translation();
    const r = e.body.rotation();
    h.num(e.id).str(e.kind).num(p.x).num(p.y).num(p.z).num(r.x).num(r.y).num(r.z).num(r.w);
  }
  return h.digest();
}
