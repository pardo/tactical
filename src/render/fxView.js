import * as THREE from 'three';

/** Short-lived effects driven by sim events: tracers, explosions, plus grenade meshes. */
export function createFxView(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const live = [];
  const grenadeMeshes = new Map();
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2f3b23 });
  const blastGeo = new THREE.SphereGeometry(1, 20, 14);

  function tracer(e) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(e.x, e.y, e.z),
      new THREE.Vector3(e.tx, e.ty, e.tz),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: e.hit ? 0xfff2a8 : 0xd8c88a, transparent: true });
    const line = new THREE.Line(geo, mat);
    group.add(line);
    live.push({ obj: line, age: 0, life: 0.12, update: (t) => (mat.opacity = 1 - t) });
  }

  function explosion(e) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, depthWrite: false });
    const ball = new THREE.Mesh(blastGeo, mat);
    ball.position.set(e.x, Math.max(e.y, 0.3), e.z);
    group.add(ball);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff6030, transparent: true, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(e.radius - 0.15, e.radius, 48), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(e.x, 0.04, e.z);
    group.add(ring);
    live.push({
      obj: ball,
      sharedGeometry: true,
      age: 0,
      life: 0.5,
      update: (t) => {
        ball.scale.setScalar(0.5 + t * e.radius * 0.5);
        mat.opacity = 1 - t;
      },
    });
    live.push({ obj: ring, age: 0, life: 0.8, update: (t) => (ringMat.opacity = 0.8 * (1 - t)) });
  }

  return {
    /** Spawn effects for a frame's events (only when playing forward, not when scrubbing). */
    play(frame) {
      for (const e of frame.events) {
        if (e.type === 'shot') tracer(e);
        else if (e.type === 'explosion') explosion(e);
      }
    },

    /** Grenades in flight, interpolated between frames. */
    drawGrenades(prev, curr, alpha) {
      const prevById = new Map(prev.grenades.map((g) => [g.id, g]));
      const seen = new Set();
      for (const g of curr.grenades) {
        seen.add(g.id);
        let mesh = grenadeMeshes.get(g.id);
        if (!mesh) {
          mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
          mesh.castShadow = true;
          group.add(mesh);
          grenadeMeshes.set(g.id, mesh);
        }
        const p = prevById.get(g.id) ?? g;
        mesh.position.set(p.x + (g.x - p.x) * alpha, p.y + (g.y - p.y) * alpha, p.z + (g.z - p.z) * alpha);
      }
      for (const [id, mesh] of grenadeMeshes) {
        if (seen.has(id)) continue;
        group.remove(mesh);
        grenadeMeshes.delete(id);
      }
    },

    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        const fx = live[i];
        fx.age += dt;
        const t = Math.min(1, fx.age / fx.life);
        fx.update(t);
        if (t >= 1) {
          group.remove(fx.obj);
          if (!fx.sharedGeometry) fx.obj.geometry.dispose();
          fx.obj.material.dispose();
          live.splice(i, 1);
        }
      }
    },

    clear() {
      for (const fx of live) group.remove(fx.obj);
      live.length = 0;
    },
  };
}
