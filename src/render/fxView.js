import * as THREE from 'three';
import { GRENADE } from '../sim/grenades.js';
import { createParticleSystem, glowTexture, puffTexture } from './particles.js';

const MAX_DECALS = 40;
const col = (hex) => new THREE.Color(hex);
const C = {
  flash: col(0xfff3c4),
  flashEnd: col(0xff8a2a),
  fire: col(0xffd27a),
  fireEnd: col(0xc2361a),
  smoke: col(0x4a4846),
  smokeLight: col(0x8d8a85),
  dust: col(0xa49a88),
  spark: col(0xffe7a0),
  sparkEnd: col(0xff6a1a),
  brass: col(0xd9a441),
  blood: col(0x7a1010),
  white: col(0xffffff),
  cloud: col(0xc9ccd0),
  cloudShade: col(0x9ea3a9),
  debris: col(0x5b5246),
};
const rand = (a, b) => a + Math.random() * (b - a);

/**
 * Short-lived effects driven by sim events: muzzle flashes, tracers, casings, impacts,
 * explosions, debris; plus grenade meshes and smoke clouds drawn from frame state.
 *
 * @param mapSize { width, height } so cell events can be placed in the world
 * @param hooks { onShake(strength 0..1, x, z), onFlash(strength 0..1, x, z) } for camera shake / white-out
 */
export function createFxView(scene, mapSize = { width: 0, height: 0 }, hooks = {}) {
  const mapHalf = { w: mapSize.width / 2, h: mapSize.height / 2 };
  const group = new THREE.Group();
  scene.add(group);
  const glowTex = glowTexture();
  const puffTex = puffTexture();
  const glow = createParticleSystem(group, { max: 700, additive: true, map: glowTex, renderOrder: 6 });
  const soft = createParticleSystem(group, { max: 900, map: puffTex, renderOrder: 5 });
  const bits = createParticleSystem(group, { max: 400, map: glowTex, renderOrder: 5 });
  // Smoke grenade clouds get their own system so their puffs persist with the frame state.
  const clouds = createParticleSystem(group, { max: 400, map: puffTex, renderOrder: 7 });

  // One muzzle light and one blast light, always in the scene with zero intensity when idle:
  // a constant light count means materials never recompile mid-firefight.
  const muzzleLight = new THREE.PointLight(0xffc070, 0, 6, 2);
  const blastLight = new THREE.PointLight(0xff8a3a, 0, 14, 2);
  group.add(muzzleLight, blastLight);

  const live = []; // { obj, age, life, update(t), dispose? }
  const grenadeMeshes = new Map();
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2f3b23, roughness: 0.6 });
  // Danger zone of a live grenade, shown while the turn isn't playing (e.g. a late throw carried into planning).
  const dangerGeo = new THREE.RingGeometry(0.94, 1, 48);
  const dangerMat = { frag: 0xff5a4d, flash: 0xffffff, smoke: 0xb9b2a4 };

  // Tracer: a bright stretched bolt that flies along the shot, plus a faint additive streak.
  const boltGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 5).rotateX(Math.PI / 2);
  const ringGeo = new THREE.RingGeometry(0.85, 1, 48);

  // Scorch marks: dark radial decals on the floor, oldest recycled.
  const scorchCanvas = document.createElement('canvas');
  scorchCanvas.width = scorchCanvas.height = 64;
  {
    const g = scorchCanvas.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(10,8,6,0.85)');
    grad.addColorStop(0.6, 'rgba(20,16,12,0.45)');
    grad.addColorStop(1, 'rgba(20,16,12,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  const scorchMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(scorchCanvas), transparent: true, depthWrite: false });
  const decalGeo = new THREE.PlaneGeometry(1, 1);
  const decals = [];
  function scorch(x, z, r) {
    const m = decals.length >= MAX_DECALS ? decals.shift() : new THREE.Mesh(decalGeo, scorchMat);
    m.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    m.position.set(x, 0.012 + decals.length * 0.0002, z);
    m.scale.setScalar(r);
    m.renderOrder = -0.5;
    group.add(m);
    decals.push(m);
  }

  function addLive(obj, life, update, dispose) {
    group.add(obj);
    live.push({ obj, age: 0, life, update, dispose });
  }

  function shot(e) {
    const dx = e.tx - e.x;
    const dy = e.ty - e.y;
    const dz = e.tz - e.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;
    const mx = e.x + ux * 0.75;
    const my = e.y + 0.05;
    const mz = e.z + uz * 0.75;
    const heavy = e.weapon === 'shotgun' || e.weapon === 'lmg' || e.weapon === 'sniper';

    // Muzzle flash: a hot core plus a short cone of sparks.
    glow.spawn({ x: mx, y: my, z: mz, life: 0.06, size0: heavy ? 0.75 : 0.55, size1: 0.2, color0: C.flash, color1: C.flashEnd, alpha0: 1, alpha1: 0.2 });
    for (let i = 0; i < 3; i++) {
      const s = rand(4, 9);
      glow.spawn({ x: mx, y: my, z: mz, vx: ux * s + rand(-1, 1), vy: uy * s + rand(-0.5, 0.8), vz: uz * s + rand(-1, 1), life: 0.07, size0: 0.18, size1: 0.05, color0: C.flash, color1: C.flashEnd });
    }
    muzzleLight.position.set(mx, my + 0.2, mz);
    muzzleLight.intensity = heavy ? 9 : 6;
    // Smoke wisp and an ejected casing (to the gun's right).
    soft.spawn({ x: mx, y: my, z: mz, vx: ux * 0.4, vy: 0.4, vz: uz * 0.4, drag: 2, life: 0.7, size0: 0.15, size1: 0.55, color0: C.smokeLight, alpha0: 0.25, alpha1: 0 });
    bits.spawn({ x: e.x - uz * 0.15, y: e.y - 0.1, z: e.z + ux * 0.15, vx: -uz * rand(1.2, 2) + rand(-0.3, 0.3), vy: rand(1.5, 2.5), vz: ux * rand(1.2, 2) + rand(-0.3, 0.3), gravity: 9.8, life: 1.4, size0: 0.05, color0: C.brass, alpha0: 1, alpha1: 1, floor: 0.03 });

    // Tracer bolt flying to the target, and a fading streak.
    const mat = new THREE.MeshBasicMaterial({ color: e.hit ? 0xfff1b0 : 0xffd98a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const bolt = new THREE.Mesh(boltGeo, mat);
    const boltLen = Math.min(1.6, len * 0.4);
    bolt.scale.set(1, 1, boltLen);
    bolt.position.set(mx, my, mz);
    bolt.lookAt(mx + ux, my + uy, mz + uz);
    const flight = Math.max(0.05, len / 180);
    addLive(bolt, flight, (t) => {
      const d = t * len;
      bolt.position.set(mx + ux * d, my + uy * d, mz + uz * d);
      mat.opacity = 1 - t * 0.3;
    }, () => mat.dispose());
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(mx, my, mz), new THREE.Vector3(e.tx, e.ty, e.tz)]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    addLive(new THREE.Line(lineGeo, lineMat), 0.14, (t) => (lineMat.opacity = 0.35 * (1 - t)), () => {
      lineGeo.dispose();
      lineMat.dispose();
    });

    // Impact: blood mist on a hit, sparks + dust where a miss lands.
    const ix = e.tx;
    const iy = Math.max(0.1, e.hit ? e.ty : e.ty - 0.4);
    const iz = e.tz;
    if (e.hit) {
      for (let i = 0; i < 6; i++) {
        soft.spawn({ x: ix, y: iy, z: iz, vx: ux * rand(0.5, 2) + rand(-0.6, 0.6), vy: rand(-0.2, 0.8), vz: uz * rand(0.5, 2) + rand(-0.6, 0.6), drag: 3, gravity: 2, life: rand(0.3, 0.5), size0: 0.12, size1: 0.35, color0: C.blood, alpha0: 0.7, alpha1: 0 });
      }
    } else {
      for (let i = 0; i < 5; i++) {
        glow.spawn({ x: ix, y: iy, z: iz, vx: -ux * rand(1, 3) + rand(-2, 2), vy: rand(1, 3), vz: -uz * rand(1, 3) + rand(-2, 2), gravity: 9.8, life: rand(0.15, 0.3), size0: 0.07, size1: 0.02, color0: C.spark, color1: C.sparkEnd });
      }
      for (let i = 0; i < 3; i++) {
        soft.spawn({ x: ix, y: iy, z: iz, vx: rand(-0.5, 0.5), vy: rand(0.2, 0.7), vz: rand(-0.5, 0.5), drag: 2, life: rand(0.5, 0.8), size0: 0.15, size1: 0.6, color0: C.dust, alpha0: 0.55, alpha1: 0 });
      }
    }
  }

  function explosion(e) {
    if (e.kind === 'smoke') {
      // The cloud itself comes from frame state; a pop of grey on release.
      for (let i = 0; i < 6; i++) soft.spawn({ x: e.x, y: 0.3, z: e.z, vx: rand(-1, 1), vy: rand(0.5, 1.2), vz: rand(-1, 1), drag: 2, life: 0.8, size0: 0.4, size1: 1.4, color0: C.cloud, alpha0: 0.5, alpha1: 0 });
      return;
    }
    const flash = e.kind === 'flash';
    const breach = e.kind === 'breach';
    const r = e.radius ?? 2;
    const y = Math.max(e.y ?? 0.3, 0.3);
    if (flash) {
      glow.spawn({ x: e.x, y: y + 0.3, z: e.z, life: 0.35, size0: 1.5, size1: r * 2.4, color0: C.white, color1: C.white, alpha0: 1, alpha1: 0 });
      for (let i = 0; i < 14; i++) {
        const a = rand(0, Math.PI * 2);
        const s = rand(3, 7);
        glow.spawn({ x: e.x, y, z: e.z, vx: Math.cos(a) * s, vy: rand(0, 3), vz: Math.sin(a) * s, drag: 3, life: 0.3, size0: 0.15, size1: 0.05, color0: C.white, color1: C.spark });
      }
      blastLight.color.setHex(0xe8f2ff);
    } else {
      // Fireball: hot core + rolling flames rising.
      glow.spawn({ x: e.x, y: y + 0.2, z: e.z, life: 0.18, size0: r * 1.2, size1: r * 2, color0: C.flash, color1: C.fire, alpha0: 1, alpha1: 0 });
      for (let i = 0; i < 18; i++) {
        const a = rand(0, Math.PI * 2);
        const s = rand(0.5, r * 1.2);
        glow.spawn({ x: e.x + rand(-0.3, 0.3), y: y + rand(0, 0.4), z: e.z + rand(-0.3, 0.3), vx: Math.cos(a) * s, vy: rand(0.8, 2.5), vz: Math.sin(a) * s, drag: 3, life: rand(0.35, 0.65), size0: rand(0.6, 1.1), size1: rand(1.2, 2), color0: C.fire, color1: C.fireEnd, alpha0: 0.9, alpha1: 0, spin: rand(-2, 2) });
      }
      // Smoke column lingering after the fire.
      for (let i = 0; i < 14; i++) {
        const a = rand(0, Math.PI * 2);
        const s = rand(0.3, r * 0.6);
        soft.spawn({ x: e.x, y: y + rand(0.2, 0.8), z: e.z, vx: Math.cos(a) * s, vy: rand(0.4, 1.4), vz: Math.sin(a) * s, drag: 1.2, life: rand(1.6, 2.6), size0: 0.8, size1: rand(2.2, 3.4), color0: C.smoke, color1: C.smokeLight, alpha0: 0.75, alpha1: 0, spin: rand(-0.5, 0.5) });
      }
      // Sparks and dark fragments thrown out.
      for (let i = 0; i < 22; i++) {
        const a = rand(0, Math.PI * 2);
        const s = rand(4, 10);
        glow.spawn({ x: e.x, y, z: e.z, vx: Math.cos(a) * s, vy: rand(2, 6), vz: Math.sin(a) * s, gravity: 9.8, drag: 0.8, life: rand(0.4, 0.8), size0: 0.09, size1: 0.03, color0: C.spark, color1: C.sparkEnd });
      }
      for (let i = 0; i < 10; i++) {
        const a = rand(0, Math.PI * 2);
        const s = rand(2, 6);
        bits.spawn({ x: e.x, y, z: e.z, vx: Math.cos(a) * s, vy: rand(2, 5), vz: Math.sin(a) * s, gravity: 9.8, life: rand(1, 1.6), size0: rand(0.06, 0.12), color0: breach ? col(0x6e4f2b) : C.debris, alpha0: 1, alpha1: 0.8, floor: 0.03 });
      }
      if (!breach) scorch(e.x, e.z, r * 1.1);
      blastLight.color.setHex(0xff8a3a);
    }
    blastLight.position.set(e.x, y + 1.2, e.z);
    blastLight.intensity = flash ? 60 : 45;
    // Shockwave ring along the floor.
    const ringMat = new THREE.MeshBasicMaterial({ color: flash ? 0xe8f4ff : 0xffb070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(e.x, 0.05, e.z);
    addLive(ring, 0.45, (t) => {
      ring.scale.setScalar(0.3 + t * r);
      ringMat.opacity = 0.8 * (1 - t);
    }, () => ringMat.dispose());
    hooks.onShake?.(flash ? 0.35 : breach ? 0.5 : 0.8, e.x, e.z);
    if (flash) hooks.onFlash?.(1, e.x, e.z);
  }

  /** Chunks of a destroyed cover tile flying out, plus dust. */
  function debris(e) {
    const x = e.cx - mapHalf.w + 0.5;
    const z = e.cz - mapHalf.h + 0.5;
    for (let i = 0; i < 12; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(1.5, 4);
      bits.spawn({ x, y: 0.5, z, vx: Math.cos(a) * s, vy: rand(1.5, 4), vz: Math.sin(a) * s, gravity: 9.8, life: rand(1, 1.6), size0: rand(0.07, 0.14), color0: col(0x8a7350), alpha0: 1, alpha1: 0.7, floor: 0.03 });
    }
    for (let i = 0; i < 6; i++) soft.spawn({ x, y: 0.4, z, vx: rand(-1, 1), vy: rand(0.3, 1), vz: rand(-1, 1), drag: 1.5, life: rand(0.8, 1.3), size0: 0.4, size1: 1.4, color0: C.dust, alpha0: 0.6, alpha1: 0 });
  }

  // Smoke clouds: a churning set of big soft puffs per cloud, kept in step with frame state.
  const cloudState = []; // per smoke index: [{ ox, oy, oz, size, phase }]
  let cloudTime = 0;

  return {
    /** Spawn effects for a frame's events (only when playing forward, not when scrubbing). */
    play(frame) {
      for (const e of frame.events) {
        if (e.type === 'shot') shot(e);
        else if (e.type === 'explosion') explosion(e);
        else if (e.type === 'breach') explosion({ ...e, kind: 'breach', y: 1, radius: 2.5 });
        else if (e.type === 'coverDestroyed') debris(e);
      }
    },

    /** Lingering smoke clouds from the frame state. */
    drawSmokes(frame) {
      clouds.clear();
      frame.smokes.forEach((sm, i) => {
        if (!cloudState[i]) {
          cloudState[i] = Array.from({ length: 22 }, (_, k) => ({
            a: (k / 22) * Math.PI * 2 + rand(-0.3, 0.3),
            d: Math.sqrt(rand(0, 1)),
            oy: rand(0.3, 1.9),
            size: rand(1.4, 2.2),
            phase: rand(0, Math.PI * 2),
            shade: rand(0, 1),
          }));
        }
        for (const p of cloudState[i]) {
          const wob = Math.sin(cloudTime * 0.6 + p.phase) * 0.15;
          const a = p.a + cloudTime * 0.05;
          clouds.spawn({
            x: sm.x + Math.cos(a) * p.d * sm.r * 0.75,
            y: p.oy + wob,
            z: sm.z + Math.sin(a) * p.d * sm.r * 0.75,
            life: 1e9,
            size0: p.size * (0.7 + sm.r * 0.45),
            color0: p.shade > 0.5 ? C.cloud : C.cloudShade,
            alpha0: 0.95,
            alpha1: 0.95,
            rot: p.phase + cloudTime * 0.1,
          });
        }
      });
      cloudState.length = Math.min(cloudState.length, frame.smokes.length);
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
      cloudTime += dt;
      for (let i = live.length - 1; i >= 0; i--) {
        const fx = live[i];
        fx.age += dt;
        const t = Math.min(1, fx.age / fx.life);
        fx.update(t);
        if (t >= 1) {
          group.remove(fx.obj);
          fx.dispose?.();
          live.splice(i, 1);
        }
      }
      glow.update(dt);
      soft.update(dt);
      bits.update(dt);
      clouds.update(0);
      muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 120);
      blastLight.intensity = Math.max(0, blastLight.intensity - dt * 110);
    },

    /** Drop running effects (scrubbing / jumping in the timeline). Scorch marks stay. */
    clear() {
      for (const fx of live) {
        group.remove(fx.obj);
        fx.dispose?.();
      }
      live.length = 0;
      glow.clear();
      soft.clear();
      bits.clear();
      muzzleLight.intensity = blastLight.intensity = 0;
    },

    dispose() {
      this.clear();
      scene.remove(group);
      for (const s of [glow, soft, bits, clouds]) s.dispose();
      glowTex.dispose();
      puffTex.dispose();
      scorchMat.map.dispose();
      scorchMat.dispose();
      for (const g of [grenadeGeo, dangerGeo, boltGeo, ringGeo, decalGeo]) g.dispose();
      grenadeMat.dispose();
    },
  };
}
