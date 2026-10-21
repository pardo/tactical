import * as THREE from 'three';

export const TEAM_COLORS = { A: 0x4a90e2, B: 0xe2574a };

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

/**
 * Meshes for soldiers, interpolated between the previous and current sim tick,
 * plus selection ring and planned-path line.
 */
export function createSoldierView(scene) {
  const views = new Map();
  const bodyGeo = new THREE.CapsuleGeometry(0.28, 0.9, 4, 12);
  const gunGeo = new THREE.BoxGeometry(0.08, 0.08, 0.6);
  const ringGeo = new THREE.RingGeometry(0.42, 0.52, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, depthWrite: false });
  const v3 = new THREE.Vector3();

  function create(s) {
    const color = TEAM_COLORS[s.team];
    const root = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color }));
    body.position.y = 0.73;
    body.castShadow = true;
    const gun = new THREE.Mesh(gunGeo, new THREE.MeshStandardMaterial({ color: 0x222222 }));
    gun.position.set(0.12, 1.05, 0.38);
    gun.castShadow = true;
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    ring.visible = false;
    root.add(body, gun, ring);

    const line = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }),
    );
    line.frustumCulled = false;
    scene.add(root, line);
    return { root, ring, line, prev: null, curr: null, pathKey: '' };
  }

  function sync(world) {
    for (const s of world.soldiers) {
      let v = views.get(s.id);
      if (!v) views.set(s.id, (v = create(s)));
      v.prev = v.curr;
      v.curr = { x: s.x, z: s.z, h: s.heading };
      v.prev ??= v.curr;
      v.path = s.path;
    }
  }

  function draw(alpha, selectedId) {
    for (const [id, v] of views) {
      const { prev, curr } = v;
      const x = prev.x + (curr.x - prev.x) * alpha;
      const z = prev.z + (curr.z - prev.z) * alpha;
      v.root.position.set(x, 0, z);
      v.root.rotation.y = lerpAngle(prev.h, curr.h, alpha);
      v.ring.visible = id === selectedId;

      const pts = [new THREE.Vector3(x, 0.05, z), ...v.path.map((p) => new THREE.Vector3(p.x, 0.05, p.z))];
      v.line.visible = pts.length > 1;
      if (v.line.visible) v.line.geometry.setFromPoints(pts);
    }
  }

  /** Soldier nearest to a screen point within radiusPx, or null. Screen-space so it works at any zoom. */
  function pick(camera, sx, sy, width, height, radiusPx = 40) {
    let best = null;
    let bestD = radiusPx;
    for (const [id, v] of views) {
      v3.set(v.root.position.x, 0.9, v.root.position.z).project(camera);
      const px = ((v3.x + 1) / 2) * width;
      const py = ((1 - v3.y) / 2) * height;
      const d = Math.hypot(px - sx, py - sy);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  return { sync, draw, pick };
}
