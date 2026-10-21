import * as THREE from 'three';

/**
 * Mirrors sim entities as meshes, interpolating between the previous and
 * current tick so motion is smooth at any frame rate.
 */
export function createEntityView(scene) {
  const views = new Map();
  const material = new THREE.MeshStandardMaterial({ color: 0xc8a25a });
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();

  function sync(world) {
    for (const e of world.entities) {
      let v = views.get(e.id);
      if (!v) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(e.size, e.size, e.size), material);
        mesh.castShadow = true;
        scene.add(mesh);
        v = { mesh, prev: null, curr: null };
        views.set(e.id, v);
      }
      v.prev = v.curr;
      v.curr = { p: { ...e.body.translation() }, r: { ...e.body.rotation() } };
      v.prev ??= v.curr;
    }
  }

  function draw(alpha) {
    for (const { mesh, prev, curr } of views.values()) {
      mesh.position.set(
        prev.p.x + (curr.p.x - prev.p.x) * alpha,
        prev.p.y + (curr.p.y - prev.p.y) * alpha,
        prev.p.z + (curr.p.z - prev.p.z) * alpha,
      );
      qa.set(prev.r.x, prev.r.y, prev.r.z, prev.r.w);
      qb.set(curr.r.x, curr.r.y, curr.r.z, curr.r.w);
      mesh.quaternion.slerpQuaternions(qa, qb, alpha);
    }
  }

  return { sync, draw };
}
