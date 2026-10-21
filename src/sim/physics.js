import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { DT } from './constants.js';

let ready = null;

/** Rapier is WASM; call once before creating any physics world. */
export function initPhysics() {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}

export function createPhysicsWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  return world;
}

export { RAPIER };
