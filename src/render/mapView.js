import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Tile, cellCenter } from '../sim/map.js';
import { doorAxis } from '../sim/doors.js';
import {
  themeFor,
  bakeFloor,
  wallTexture,
  capTexture,
  crateTexture,
  fabricTexture,
  drumTexture,
  concreteTexture,
  doorTexture,
  rng,
  hashString,
} from './textures.js';

// Drawn lower than their physical height so the overhead camera can see into rooms.
const WALL_VIS_HEIGHT = 1.4;
const DOOR_H = WALL_VIS_HEIGHT * 0.95;

/* ---------- prop geometry (shared by every map view) ---------- */

/** Merge parts given as [geometry, x, y, z, rotY?, scale? ([sx, sy, sz])]. */
function assemble(parts) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const geos = parts.map(([geo, x, y, z, ry = 0, sc = [1, 1, 1]]) => {
    const g = geo.clone();
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    g.applyMatrix4(m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(...sc)));
    return g.index ? g.toNonIndexed() : g;
  });
  return mergeGeometries(geos);
}

let propCache = null;
/** Low-cover props. Each is a list of [geometry, material] parts, drawn ~0.6–0.75 m tall, local +x along the cover run. */
function props() {
  if (propCache) return propCache;
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
  const bag = new THREE.SphereGeometry(1, 12, 8);
  // Three courses of bags, staggered like brickwork, two bags deep.
  const bags = [];
  for (const [y, xs] of [
    [0.1, [-0.33, 0, 0.33]],
    [0.29, [-0.17, 0.17]],
    [0.48, [-0.33, 0, 0.33]],
  ]) {
    for (const x of xs) for (const z of [-0.17, 0.17]) bags.push([bag, x, y, z, 0, [0.19, 0.11, 0.17]]);
  }
  for (const z of [-0.17, 0.17]) for (const x of [-0.42, 0.42]) bags.push([bag, x, 0.29, z, 0, [0.09, 0.11, 0.17]]);
  const sandbags = assemble(bags);
  const drum = new THREE.CylinderGeometry(0.22, 0.22, 0.72, 16);
  const barrels = assemble([
    [drum, -0.2, 0.36, -0.17],
    [drum, 0.22, 0.36, 0.12],
    [drum, -0.12, 0.36, 0.27, 0, [1, 0.9, 1]],
  ]);
  const barrierShape = new THREE.Shape();
  barrierShape.moveTo(-0.3, 0);
  barrierShape.lineTo(0.3, 0);
  barrierShape.lineTo(0.3, 0.08);
  barrierShape.lineTo(0.13, 0.25);
  barrierShape.lineTo(0.1, 0.68);
  barrierShape.lineTo(-0.1, 0.68);
  barrierShape.lineTo(-0.13, 0.25);
  barrierShape.lineTo(-0.3, 0.08);
  barrierShape.closePath();
  const barrier = new THREE.ExtrudeGeometry(barrierShape, { depth: 0.96, bevelEnabled: false });
  // Profile is in XY extruded along +z: turn it so the run goes along x.
  barrier.translate(0, 0, -0.48);
  barrier.rotateY(Math.PI / 2);
  const pallet = assemble([
    [new THREE.BoxGeometry(0.9, 0.04, 0.9), 0, 0.13, 0],
    [new THREE.BoxGeometry(0.9, 0.1, 0.12), 0, 0.05, -0.36],
    [new THREE.BoxGeometry(0.9, 0.1, 0.12), 0, 0.05, 0],
    [new THREE.BoxGeometry(0.9, 0.1, 0.12), 0, 0.05, 0.36],
  ]);
  const load = new THREE.BoxGeometry(0.8, 0.52, 0.8);
  load.translate(0, 0.41, 0);
  const planterBox = new THREE.BoxGeometry(0.86, 0.42, 0.86);
  planterBox.translate(0, 0.21, 0);
  const bush = assemble([
    [new THREE.IcosahedronGeometry(0.34, 1), 0, 0.62, 0, 0, [1, 0.75, 1]],
    [new THREE.IcosahedronGeometry(0.22, 1), 0.2, 0.7, 0.12],
    [new THREE.IcosahedronGeometry(0.2, 1), -0.18, 0.68, -0.14],
  ]);
  const sofa = assemble([
    [new THREE.BoxGeometry(0.92, 0.28, 0.72), 0, 0.2, 0.04],
    [new THREE.BoxGeometry(0.92, 0.56, 0.16), 0, 0.34, -0.32],
    [new THREE.BoxGeometry(0.12, 0.42, 0.72), -0.42, 0.27, 0.04],
    [new THREE.BoxGeometry(0.12, 0.42, 0.72), 0.42, 0.27, 0.04],
  ]);
  const crate = new THREE.BoxGeometry(0.84, 0.7, 0.84);
  crate.translate(0, 0.35, 0);
  propCache = {
    crate: [[crate, std({ map: crateTexture() })]],
    sandbags: [[sandbags, std({ map: fabricTexture(), roughness: 1 })]],
    barrels: [[barrels, std({ map: drumTexture(), metalness: 0.3, roughness: 0.55 })]],
    barrier: [[barrier, std({ map: concreteTexture() })]],
    pallet: [
      [pallet, std({ map: crateTexture() })],
      [load, std({ color: 0xb8c4cc, roughness: 0.35, metalness: 0.05 })],
    ],
    planter: [
      [planterBox, std({ map: concreteTexture() })],
      [bush, std({ color: 0x4f7a3a, flatShading: true })],
    ],
    sofa: [[sofa, std({ color: 0x7a2f2f, roughness: 1 })]],
    rubble: [
      [
        assemble([
          [new THREE.DodecahedronGeometry(0.16, 0), -0.2, 0.08, -0.1],
          [new THREE.DodecahedronGeometry(0.12, 0), 0.18, 0.06, 0.15],
          [new THREE.DodecahedronGeometry(0.1, 0), 0.05, 0.05, -0.25],
          [new THREE.BoxGeometry(0.4, 0.05, 0.12), 0.1, 0.03, 0.02, 0.7],
          [new THREE.BoxGeometry(0.3, 0.05, 0.1), -0.15, 0.03, 0.25, -0.4],
        ]),
        std({ color: 0x5b5246, flatShading: true }),
      ],
    ],
  };
  return propCache;
}

function instancedPart(geometry, material, count) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(count, 1));
  mesh.count = count;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Connected runs of low cover, so one run gets one kind of prop and one direction. */
function coverRuns(map) {
  const { width, height, tiles } = map;
  const run = new Int32Array(width * height).fill(-1);
  const runs = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== Tile.LOW_COVER || run[i] >= 0) continue;
    const cells = [];
    const stack = [i];
    run[i] = runs.length;
    while (stack.length) {
      const j = stack.pop();
      cells.push(j);
      const cx = j % width;
      const cz = (j / width) | 0;
      for (const [nx, nz] of [[cx - 1, cz], [cx + 1, cz], [cx, cz - 1], [cx, cz + 1]]) {
        if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
        const k = nz * width + nx;
        if (tiles[k] === Tile.LOW_COVER && run[k] < 0) {
          run[k] = runs.length;
          stack.push(k);
        }
      }
    }
    const xs = new Set(cells.map((j) => j % width));
    const zs = new Set(cells.map((j) => (j / width) | 0));
    runs.push({ first: i, alongX: xs.size >= zs.size });
  }
  return { run, runs };
}

/**
 * @param opts { floorPx } texture resolution per cell (the editor rebuilds often and uses less)
 */
export function createMapView(scene, map, objective = null, { floorPx = 32 } = {}) {
  const group = new THREE.Group();
  const theme = themeFor(map);
  const owned = []; // per-view GPU resources to free on dispose (shared prop assets are kept)
  const own = (x) => (owned.push(x), x);
  scene.background = new THREE.Color(theme.sky);

  const byTile = { [Tile.WALL]: [], [Tile.LOW_COVER]: [], [Tile.DOOR]: [] };
  for (let cz = 0; cz < map.height; cz++) {
    for (let cx = 0; cx < map.width; cx++) byTile[map.tiles[cz * map.width + cx]]?.push({ cx, cz });
  }

  // Ground beyond the map, fading into the background.
  const groundCanvas = document.createElement('canvas');
  groundCanvas.width = groundCanvas.height = 128;
  const gg = groundCanvas.getContext('2d');
  const grad = gg.createRadialGradient(64, 64, 10, 64, 64, 64);
  const col = (c) => `#${c.toString(16).padStart(6, '0')}`;
  grad.addColorStop(0, col(theme.ground));
  grad.addColorStop(1, col(theme.sky));
  gg.fillStyle = grad;
  gg.fillRect(0, 0, 128, 128);
  const groundTex = own(new THREE.CanvasTexture(groundCanvas));
  groundTex.colorSpace = THREE.SRGBColorSpace;
  const outerSize = Math.max(map.width, map.height) * 3 + 40;
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(outerSize, outerSize), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.02;
  outer.receiveShadow = true;
  group.add(outer);

  const floorTex = own(bakeFloor(map, theme, floorPx));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(map.width, map.height), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Faint 1 m grid for planning, over the floor art.
  const pts = [];
  const hw = map.width / 2;
  const hh = map.height / 2;
  for (let x = 0; x <= map.width; x++) pts.push(x - hw, 0.005, -hh, x - hw, 0.005, hh);
  for (let z = 0; z <= map.height; z++) pts.push(-hw, 0.005, z - hh, hw, 0.005, z - hh);
  const grid = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.14, depthWrite: false }),
  );
  grid.renderOrder = -3;
  group.add(grid);

  // Walls: textured sides, lighter cap on top.
  const side = new THREE.MeshStandardMaterial({ map: wallTexture(theme), roughness: 0.9 });
  const cap = new THREE.MeshStandardMaterial({ map: capTexture(theme), roughness: 0.8 });
  const walls = instancedPart(new THREE.BoxGeometry(1, WALL_VIS_HEIGHT, 1), [side, side, cap, side, side, side], byTile[Tile.WALL].length);
  const m4 = new THREE.Matrix4();
  byTile[Tile.WALL].forEach(({ cx, cz }, i) => {
    const c = cellCenter(map, cx, cz);
    walls.setMatrixAt(i, m4.makeTranslation(c.x, WALL_VIS_HEIGHT / 2, c.z));
  });
  group.add(walls);

  // Cover: one prop kind per connected run, chosen from the theme by a hash of the run.
  const P = props();
  const { run, runs } = coverRuns(map);
  const coverCells = byTile[Tile.LOW_COVER];
  const kindOf = runs.map((r) => theme.props[hashString(`${map.name}:${r.first}`) % theme.props.length]);
  const rand = rng(hashString(map.name ?? '') + 1);
  const placed = coverCells.map(({ cx, cz }) => {
    const r = run[cz * map.width + cx];
    const kind = kindOf[r];
    const jitter = kind === 'crate' || kind === 'barrels' || kind === 'planter' ? (rand() - 0.5) * 0.35 : 0;
    const yaw = (runs[r].alongX ? 0 : Math.PI / 2) + jitter + (kind === 'sofa' && rand() < 0.5 ? Math.PI : 0);
    return { cx, cz, kind, yaw, scale: 0.94 + rand() * 0.1 };
  });
  const propMeshes = {};
  const slot = []; // cover index → index within its kind
  const counts = {};
  for (const p of placed) slot.push((counts[p.kind] = (counts[p.kind] ?? 0) + 1) - 1);
  for (const kind of Object.keys(counts)) {
    propMeshes[kind] = P[kind].map(([geo, mat]) => instancedPart(geo, mat, counts[kind]));
    group.add(...propMeshes[kind]);
  }
  const rubble = P.rubble.map(([geo, mat]) => instancedPart(geo, mat, coverCells.length));
  group.add(...rubble);
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  function placeCover(gone) {
    placed.forEach((p, i) => {
      const c = cellCenter(map, p.cx, p.cz);
      pos.set(c.x, 0, c.z);
      q.setFromAxisAngle(up, p.yaw);
      scl.setScalar(gone.has(p.cz * map.width + p.cx) ? 0 : p.scale);
      m4.compose(pos, q, scl);
      for (const mesh of propMeshes[p.kind]) mesh.setMatrixAt(slot[i], m4);
      scl.setScalar(gone.has(p.cz * map.width + p.cx) ? 1 : 0);
      m4.compose(pos, q, scl);
      for (const mesh of rubble) mesh.setMatrixAt(i, m4);
    });
    for (const list of [...Object.values(propMeshes), rubble]) for (const mesh of list) mesh.instanceMatrix.needsUpdate = true;
  }
  placeCover(new Set());

  // Doors: a leaf hinged on one side of the opening (swings open), jambs in the trim colour,
  // and splinters left on the floor once breached.
  const doorMat = new THREE.MeshStandardMaterial({ map: doorTexture(theme), roughness: 0.8 });
  const jambMat = new THREE.MeshStandardMaterial({ color: theme.trim, roughness: 0.7 });
  const leafGeo = new THREE.BoxGeometry(0.92, DOOR_H, 0.08);
  leafGeo.translate(0.46, DOOR_H / 2, 0); // hinge at the local origin
  const jambGeo = new THREE.BoxGeometry(0.08, DOOR_H + 0.02, 1.02);
  const splinterGeo = assemble([
    [new THREE.BoxGeometry(0.5, 0.03, 0.1), -0.1, 0.02, 0.2, 0.5],
    [new THREE.BoxGeometry(0.35, 0.03, 0.12), 0.2, 0.02, -0.1, -0.8],
    [new THREE.BoxGeometry(0.25, 0.03, 0.08), -0.15, 0.02, -0.25, 1.4],
  ]);
  own(leafGeo);
  own(jambGeo);
  own(splinterGeo);
  const doors = [];
  for (let cz = 0; cz < map.height; cz++) {
    for (let cx = 0; cx < map.width; cx++) {
      if (map.tiles[cz * map.width + cx] !== Tile.DOOR) continue;
      const alongX = doorAxis(map, cx, cz) === 'x';
      const c = cellCenter(map, cx, cz);
      const root = new THREE.Group();
      root.position.set(c.x, 0, c.z);
      root.rotation.y = alongX ? 0 : Math.PI / 2;
      const hinge = new THREE.Group();
      hinge.position.x = -0.46;
      const leaf = new THREE.Mesh(leafGeo, doorMat);
      leaf.castShadow = true;
      hinge.add(leaf);
      const jambs = [-0.5, 0.5].map((x) => {
        const j = new THREE.Mesh(jambGeo, jambMat);
        j.position.set(x, (DOOR_H + 0.02) / 2, 0);
        j.scale.z = 0.3;
        j.castShadow = true;
        return j;
      });
      const splinters = new THREE.Mesh(splinterGeo, doorMat);
      splinters.visible = false;
      root.add(hinge, ...jambs, splinters);
      group.add(root);
      // Swing away from the nearer map half, so doors open "into" rooms consistently.
      doors.push({ hinge, leaf, splinters, angle: 0, dir: (alongX ? c.z : -c.x) >= 0 ? -1 : 1 });
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

  // Destroyed cover: props vanish, rubble appears. `destroyed` is the cell-index list (replay-safe:
  // scrubbing back passes a shorter prefix and the cover reappears).
  let shownDestroyed = -1;
  group.userData.setDestroyed = (destroyed) => {
    if (destroyed.length === shownDestroyed) return;
    shownDestroyed = destroyed.length;
    placeCover(new Set(destroyed));
  };

  /** @param states door states from a frame ('closed' | 'open' | 'breached'), in door order */
  group.userData.setDoors = (states) => {
    doors.forEach((d, i) => {
      const s = states?.[i] ?? 'closed';
      const target = s === 'open' ? (d.dir * Math.PI) / 2 * 0.92 : 0;
      d.angle += (target - d.angle) * 0.25;
      if (Math.abs(target - d.angle) < 1e-3) d.angle = target;
      d.hinge.rotation.y = d.angle;
      d.leaf.visible = s !== 'breached';
      d.splinters.visible = s === 'breached';
    });
  };

  group.userData.owned = owned;
  scene.add(group);
  return group;
}

/** Remove a map view and free its GPU resources (shared prop geometry/materials are kept). */
export function disposeMapView(scene, group) {
  scene.remove(group);
  const shared = new Set();
  if (propCache) for (const parts of Object.values(propCache)) for (const [g, m] of parts) shared.add(g).add(m);
  group.traverse((o) => {
    if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
    for (const m of [].concat(o.material ?? [])) if (!shared.has(m) && !m.map?.isCanvasTexture) m.dispose();
  });
  for (const x of group.userData.owned ?? []) x.dispose();
}
