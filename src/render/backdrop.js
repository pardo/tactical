import * as THREE from 'three';
import { parseMap, cellCenter } from '../sim/map.js';
import { findPath, isNavigable } from '../sim/nav.js';
import { createMapView, disposeMapView } from './mapView.js';
import { createSoldierModel } from './soldierModel.js';
import { TEAM_COLORS } from './soldierView.js';

const ROLES = ['rifleman', 'breacher', 'lmg', 'sniper', 'demolition', 'rifleman'];
const WALK = 1.6; // m/s
const RUN = 3.4;

/**
 * Main-menu scenery: a real map with a few soldiers patrolling it and a camera slowly
 * circling overhead. Render-only (pathfinding is reused, nothing is simulated).
 */
export function createBackdrop(view, mapDef) {
  const { scene, camera } = view;
  const map = parseMap(mapDef);
  const group = createMapView(scene, map, null);
  view.setShadowBounds(Math.max(map.sizeX, map.sizeZ) / 2 + 2);
  const open = [];
  for (let cz = 0; cz < map.height; cz++) for (let cx = 0; cx < map.width; cx++) if (isNavigable(map, cx, cz)) open.push({ cx, cz });
  const pick = () => {
    const c = open[Math.floor(Math.random() * open.length)];
    return cellCenter(map, c.cx, c.cz);
  };
  // Doors stand open so the patrols can come and go.
  const doorStates = map.doors.map(() => 'open');

  const walkers = ROLES.map((role, i) => {
    const team = i % 2 ? 'B' : 'A';
    const model = createSoldierModel(TEAM_COLORS[team], role);
    const root = new THREE.Group();
    root.add(model.figure);
    scene.add(root);
    const start = pick();
    root.position.set(start.x, 0, start.z);
    return { model, root, path: [], heading: 0, phase: Math.random() * 6, wait: Math.random() * 2, run: false, stance: 'stand' };
  });

  let yaw = Math.random() * Math.PI * 2;
  let time = 0;
  const dist = Math.max(map.sizeX, map.sizeZ) * 0.62;

  function update(dt) {
    time += dt;
    yaw += dt * 0.05;
    const pitch = 0.95 + Math.sin(time * 0.1) * 0.08;
    const h = dist * Math.cos(pitch);
    camera.position.set(Math.sin(yaw) * h, dist * Math.sin(pitch), Math.cos(yaw) * h);
    camera.lookAt(0, 0, 0);
    group.userData.setDoors(doorStates);

    for (const w of walkers) {
      const p = w.root.position;
      if (w.wait > 0) {
        w.wait -= dt;
        w.model.setPose({ stance: w.stance, moving: false, time: time + w.phase, aiming: w.stance === 'crouch' });
        if (w.wait <= 0) {
          const to = pick();
          w.path = findPath(map, p.x, p.z, to.x, to.z) ?? [];
          w.run = Math.random() < 0.3;
          w.stance = 'stand';
        }
        continue;
      }
      const next = w.path[0];
      if (!next) {
        // Arrived: hold a moment, sometimes taking a knee and covering.
        w.wait = 1 + Math.random() * 3;
        w.stance = Math.random() < 0.4 ? 'crouch' : 'stand';
        continue;
      }
      const dx = next.x - p.x;
      const dz = next.z - p.z;
      const d = Math.hypot(dx, dz);
      const step = (w.run ? RUN : WALK) * dt;
      if (d <= step) {
        p.set(next.x, 0, next.z);
        w.path.shift();
      } else {
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
      }
      const want = Math.atan2(dx, dz);
      let dh = want - w.heading;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      w.heading += dh * Math.min(1, dt * 8);
      w.root.rotation.y = w.heading;
      w.phase += step * 5.4;
      w.model.setPose({ stance: 'stand', moving: true, speed: w.run ? RUN : WALK, walkPhase: w.phase, time });
    }
  }

  function dispose() {
    disposeMapView(scene, group);
    for (const w of walkers) {
      scene.remove(w.root);
      w.model.dispose();
    }
  }

  return { update, dispose };
}
