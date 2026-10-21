import * as THREE from 'three';
import { Tile, cellCenter } from '../sim/map.js';
import { doorAxis } from '../sim/doors.js';

// Drawn lower than their physical height so the overhead camera can see into rooms.
const WALL_VIS_HEIGHT = 1.4;
const COVER_VIS_HEIGHT = 0.6;

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

export function createMapView(scene, map) {
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
      new THREE.MeshStandardMaterial({ color: 0x8a8f96 }),
      byTile[Tile.WALL],
      map,
      WALL_VIS_HEIGHT / 2,
    ),
  );
  group.add(
    instanced(
      new THREE.BoxGeometry(0.9, COVER_VIS_HEIGHT, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x6b5a3e }),
      byTile[Tile.LOW_COVER],
      map,
      COVER_VIS_HEIGHT / 2,
    ),
  );
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

  scene.add(group);
  /** @param states door states from a frame ('closed' | 'open' | 'breached'), in door order */
  group.userData.setDoors = (states) => {
    doorPanels.forEach((p, i) => (p.visible = (states?.[i] ?? 'closed') === 'closed'));
  };
  return group;
}
