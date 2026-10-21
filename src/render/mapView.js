import * as THREE from 'three';
import { Tile, cellCenter } from '../sim/map.js';
import { doorAxis } from '../sim/doors.js';

// Drawn lower than their physical height so the overhead camera can see into rooms.
const WALL_VIS_HEIGHT = 1.4;
const COVER_VIS_HEIGHT = 0.6;

/** Box materials with a lighter top face: reads much better from the overhead camera. */
function topLit(side, top) {
  const sideMat = new THREE.MeshStandardMaterial({ color: side });
  const topMat = new THREE.MeshStandardMaterial({ color: top });
  // BoxGeometry face order: +x, -x, +y (top), -y, +z, -z
  return [sideMat, sideMat, topMat, sideMat, sideMat, sideMat];
}

function instanced(geometry, material, cells, map, y) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(cells.length, 1));
  mesh.count = cells.length;
  const m = new THREE.Matrix4();
  cells.forEach(({ cx, cz }, i) => {
    const c = cellCenter(map, cx, cz);
    mesh.setMatrixAt(i, m.makeTranslation(c.x, y, c.z));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createMapView(scene, map, objective = null) {
  const group = new THREE.Group();
  const byTile = { [Tile.WALL]: [], [Tile.LOW_COVER]: [], [Tile.DOOR]: [] };
  for (let cz = 0; cz < map.height; cz++) {
    for (let cx = 0; cx < map.width; cx++) byTile[map.tiles[cz * map.width + cx]]?.push({ cx, cz });
  }

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(map.width, map.height),
    new THREE.MeshStandardMaterial({ color: 0x3a3f44 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Tile grid as one LineSegments object.
  const pts = [];
  const hw = map.width / 2;
  const hh = map.height / 2;
  for (let x = 0; x <= map.width; x++) pts.push(x - hw, 0.005, -hh, x - hw, 0.005, hh);
  for (let z = 0; z <= map.height; z++) pts.push(-hw, 0.005, z - hh, hw, 0.005, z - hh);
  const grid = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
    new THREE.LineBasicMaterial({ color: 0x2c3034 }),
  );
  group.add(grid);

  group.add(
    instanced(
      new THREE.BoxGeometry(1, WALL_VIS_HEIGHT, 1),
      topLit(0x6f747b, 0xb4b9bf),
      byTile[Tile.WALL],
      map,
      WALL_VIS_HEIGHT / 2,
    ),
  );
  const coverCells = byTile[Tile.LOW_COVER];
  const coverMesh = instanced(
    new THREE.BoxGeometry(0.9, COVER_VIS_HEIGHT, 0.9),
    topLit(0x5e4f37, 0x9c8762),
    coverCells,
    map,
    COVER_VIS_HEIGHT / 2,
  );
  group.add(coverMesh);
  const doors = instanced(
    new THREE.BoxGeometry(1, 0.02, 1),
    new THREE.MeshStandardMaterial({ color: 0x8c6a3f }),
    byTile[Tile.DOOR],
    map,
    0.01,
  );
  doors.castShadow = false;
  group.add(doors);

  // Door panels, toggled from frame state.
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x9c7445 });
  const doorPanels = [];
  for (let cz = 0; cz < map.height; cz++) {
    for (let cx = 0; cx < map.width; cx++) {
      if (map.tiles[cz * map.width + cx] !== Tile.DOOR) continue;
      const along = doorAxis(map, cx, cz) === 'x';
      const panel = new THREE.Mesh(new THREE.BoxGeometry(along ? 1 : 0.16, WALL_VIS_HEIGHT * 0.95, along ? 0.16 : 1), doorMat);
      const c = cellCenter(map, cx, cz);
      panel.position.set(c.x, (WALL_VIS_HEIGHT * 0.95) / 2, c.z);
      panel.castShadow = true;
      group.add(panel);
      doorPanels.push(panel);
    }
  }

  // Objective zone: translucent disc + ring, tinted by whoever holds it.
  let zone = null;
  if (objective?.type === 'zone') {
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(objective.r, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false }),
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(objective.r - 0.12, objective.r, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    for (const m of [fill, ring]) {
      m.rotation.x = -Math.PI / 2;
      m.position.set(objective.x, 0.02, objective.z);
      group.add(m);
    }
    zone = { fill, ring };
  }
  const ZONE_COLORS = { A: 0x4a90e2, B: 0xe2574a, contested: 0xffd34d };
  group.userData.setZone = (holder) => {
    if (!zone) return;
    const c = ZONE_COLORS[holder] ?? 0xffffff;
    zone.fill.material.color.setHex(c);
    zone.ring.material.color.setHex(c);
    zone.fill.material.opacity = holder ? 0.18 : 0.08;
  };

  // Destroyed cover: collapse those instances. `destroyed` is the cell-index list (replay-safe:
  // scrubbing back passes a shorter prefix and the cover reappears).
  const m4 = new THREE.Matrix4();
  let shownDestroyed = -1;
  group.userData.setDestroyed = (destroyed) => {
    if (destroyed.length === shownDestroyed) return;
    shownDestroyed = destroyed.length;
    const gone = new Set(destroyed);
    coverCells.forEach(({ cx, cz }, i) => {
      const c = cellCenter(map, cx, cz);
      const hidden = gone.has(cz * map.width + cx);
      m4.makeTranslation(c.x, COVER_VIS_HEIGHT / 2, c.z);
      if (hidden) m4.scale(new THREE.Vector3(0, 0, 0));
      coverMesh.setMatrixAt(i, m4);
    });
    coverMesh.instanceMatrix.needsUpdate = true;
  };

  scene.add(group);
  /** @param states door states from a frame ('closed' | 'open' | 'breached'), in door order */
  group.userData.setDoors = (states) => {
    doorPanels.forEach((p, i) => (p.visible = (states?.[i] ?? 'closed') === 'closed'));
  };
  return group;
}

/** Remove a map view and free its GPU resources. */
export function disposeMapView(scene, group) {
  scene.remove(group);
  group.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) for (const m of [].concat(o.material)) m.dispose();
  });
}
