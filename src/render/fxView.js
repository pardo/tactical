import * as THREE from 'three';
import { GRENADE } from '../sim/grenades.js';

/** Short-lived effects driven by sim events: tracers, explosions, plus grenade meshes. */
/** @param mapSize { width, height } so cell events can be placed in the world */
export function createFxView(scene, mapSize = { width: 0, height: 0 }) {
  const mapHalf = { w: mapSize.width / 2, h: mapSize.height / 2 };
  const group = new THREE.Group();
  scene.add(group);
  const live = [];
  const grenadeMeshes = new Map();
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2f3b23 });
  const blastGeo = new THREE.SphereGeometry(1, 20, 14);
  // Danger zone of a live grenade, shown while the turn isn't playing (e.g. a late throw carried into planning).
  const dangerGeo = new THREE.RingGeometry(0.94, 1, 48);
  const dangerMat = { frag: 0xff5a4d, flash: 0xffffff, smoke: 0xb9b2a4 };

  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true, depthWrite: false });
  const puffMat = new THREE.MeshBasicMaterial({ color: 0xb9b2a4, transparent: true, depthWrite: false });

  /** Muzzle flash at the shooter, and a dust puff where a miss lands. */
  function shotFx(e) {
    const dx = e.tx - e.x;
    const dz = e.tz - e.z;
    const len = Math.hypot(dx, dz) || 1;
    const flash = new THREE.Mesh(blastGeo, flashMat.clone());
    flash.position.set(e.x + (dx / len) * 0.8, e.y + 0.05, e.z + (dz / len) * 0.8);
    flash.scale.setScalar(0.12);
    group.add(flash);
    live.push({ obj: flash, sharedGeometry: true, age: 0, life: 0.06, update: (t) => (flash.material.opacity = 1 - t) });
    if (e.hit) return;
    const puff = new THREE.Mesh(blastGeo, puffMat.clone());
    puff.position.set(e.tx, Math.max(0.1, e.ty - 0.4), e.tz);
    group.add(puff);
    live.push({
      obj: puff,
      sharedGeometry: true,
      age: 0,
      life: 0.35,
      update: (t) => {
        puff.scale.setScalar(0.08 + t * 0.25);
        puff.material.opacity = 0.7 * (1 - t);
      },
    });
  }

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

  const smokeMeshes = [];
  const smokeGeo = new THREE.SphereGeometry(1, 16, 10);
  const smokeMat = new THREE.MeshLambertMaterial({ color: 0xb8bcc2, transparent: true, opacity: 0.82, depthWrite: false });

  function explosion(e) {
    if (e.kind === 'smoke') return; // drawn from frame state instead (it lingers)
    const color = e.kind === 'flash' || e.kind === 'breach' ? 0xffffff : 0xffa040;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    const ball = new THREE.Mesh(blastGeo, mat);
    ball.position.set(e.x, Math.max(e.y, 0.3), e.z);
    group.add(ball);
    const ringMat = new THREE.MeshBasicMaterial({ color: e.kind === 'flash' ? 0xe8f4ff : 0xff6030, transparent: true, depthWrite: false });
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

  const debrisMat = new THREE.MeshLambertMaterial({ color: 0x8a7350, transparent: true });
  /** Chunks of a destroyed cover tile flying out and fading. */
  function debris(e) {
    const c = { x: e.cx - mapHalf.w + 0.5, z: e.cz - mapHalf.h + 0.5 };
    for (let i = 0; i < 6; i++) {
      const chunk = new THREE.Mesh(blastGeo, debrisMat.clone());
      chunk.scale.setScalar(0.12);
      chunk.position.set(c.x, 0.5, c.z);
      const vx = Math.cos(i) * 2.5;
      const vz = Math.sin(i) * 2.5;
      group.add(chunk);
      live.push({
        obj: chunk,
        sharedGeometry: true,
        age: 0,
        life: 0.7,
        update: (t) => {
          chunk.position.set(c.x + vx * t * 0.7, 0.5 + 2 * t - 3.5 * t * t, c.z + vz * t * 0.7);
          chunk.material.opacity = 1 - t;
        },
      });
    }
  }

  return {
    /** Spawn effects for a frame's events (only when playing forward, not when scrubbing). */
    play(frame) {
      for (const e of frame.events) {
        if (e.type === 'shot') {
          tracer(e);
          shotFx(e);
        }
        else if (e.type === 'explosion') explosion(e);
        else if (e.type === 'breach') explosion({ ...e, kind: 'breach', y: 1, radius: 2.5 });
        else if (e.type === 'coverDestroyed') debris(e);
      }
    },

    /** Lingering smoke clouds from the frame state. */
    drawSmokes(frame) {
      while (smokeMeshes.length < frame.smokes.length) {
        const m = new THREE.Mesh(smokeGeo, smokeMat);
        group.add(m);
        smokeMeshes.push(m);
      }
      smokeMeshes.forEach((m, i) => {
        const sm = frame.smokes[i];
        m.visible = !!sm;
        if (!sm) return;
        m.position.set(sm.x, 1.2, sm.z);
        m.scale.set(sm.r, 1.6, sm.r);
      });
    },

    /** Grenades in flight, interpolated between frames. */
    /** @param showDanger draw each grenade's blast radius (when the turn is not playing) */
    drawGrenades(prev, curr, alpha, showDanger = false) {
      const prevById = new Map(prev.grenades.map((g) => [g.id, g]));
      const seen = new Set();
      for (const g of curr.grenades) {
        seen.add(g.id);
        let mesh = grenadeMeshes.get(g.id);
        if (!mesh) {
          mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
          mesh.castShadow = true;
          const danger = new THREE.Mesh(
            dangerGeo,
            new THREE.MeshBasicMaterial({ color: dangerMat[g.kind] ?? 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }),
          );
          danger.rotation.x = -Math.PI / 2;
          danger.scale.setScalar(GRENADE[g.kind]?.radius ?? 1);
          mesh.userData.danger = danger;
          group.add(mesh, danger);
          grenadeMeshes.set(g.id, mesh);
        }
        const p = prevById.get(g.id) ?? g;
        mesh.position.set(p.x + (g.x - p.x) * alpha, p.y + (g.y - p.y) * alpha, p.z + (g.z - p.z) * alpha);
        const danger = mesh.userData.danger;
        danger.visible = showDanger;
        danger.position.set(mesh.position.x, 0.05, mesh.position.z);
      }
      for (const [id, mesh] of grenadeMeshes) {
        if (seen.has(id)) continue;
        group.remove(mesh, mesh.userData.danger);
        mesh.userData.danger.material.dispose();
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
