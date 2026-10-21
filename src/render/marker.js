import * as THREE from 'three';

/** Expanding ring that shows where a tap/click landed on the ground. */
export function createTapMarker(scene) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.5, 32),
    new THREE.MeshBasicMaterial({ color: 0x5ad1ff, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  scene.add(mesh);
  let age = Infinity;

  return {
    show(point, color = 0x5ad1ff) {
      mesh.position.set(point.x, 0.02, point.z);
      mesh.material.color.setHex(color);
      mesh.visible = true;
      age = 0;
    },
    update(dt) {
      if (!mesh.visible) return;
      age += dt;
      const t = age / 0.6;
      if (t >= 1) {
        mesh.visible = false;
        return;
      }
      mesh.scale.setScalar(1 + t);
      mesh.material.opacity = 1 - t;
    },
  };
}
