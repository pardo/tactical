import * as THREE from 'three';
import { FOV } from '../sim/soldier/perception.js';
import { MAX_HP } from '../sim/soldier/soldier.js';
import { frameVision } from '../game/recorder.js';

export const TEAM_COLORS = { A: 0x4a90e2, B: 0xe2574a };
const DEAD_COLOR = 0x555a60;
const CONE_RADIUS = 6;

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

function textSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  g.arc(32, 32, 28, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  g.font = 'bold 40px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 32, 34);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sprite.scale.setScalar(0.5);
  sprite.renderOrder = 10;
  return sprite;
}

/**
 * Soldiers drawn from recorded frames (live or replay), interpolated between two
 * frames. Handles stance, death, fog of war (with last-seen ghosts), HP bars,
 * number tags and vision cones.
 */
export function createSoldierView(scene, labels) {
  const views = new Map();
  const bodyGeo = new THREE.CapsuleGeometry(0.28, 0.9, 4, 12);
  const gunGeo = new THREE.BoxGeometry(0.08, 0.08, 0.6);
  const ringGeo = new THREE.RingGeometry(0.42, 0.52, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, depthWrite: false });
  const coneGeo = new THREE.CircleGeometry(CONE_RADIUS, 24, Math.PI / 2 - FOV / 2, FOV);
  const ghostGeo = new THREE.RingGeometry(0.3, 0.42, 24);
  const v3 = new THREE.Vector3();

  function create(s) {
    const color = TEAM_COLORS[s.team];
    const root = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.73;
    body.castShadow = true;
    const gun = new THREE.Mesh(gunGeo, new THREE.MeshStandardMaterial({ color: 0x222222 }));
    gun.position.set(0.12, 1.05, 0.38);
    gun.castShadow = true;
    const figure = new THREE.Group();
    figure.add(body, gun);

    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;

    const cone = new THREE.Mesh(
      coneGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
    );
    // CircleGeometry lies in XY with angle 0 on +X; rotate so the fan points along local +Z (the soldier's forward).
    cone.rotation.x = Math.PI / 2;
    cone.position.y = 0.03;

    const tag = textSprite(labels[s.id]?.split(' ')[1] ?? '?', color);
    tag.position.y = 2.1;
    const hpBack = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, depthTest: false }));
    hpBack.scale.set(0.7, 0.08, 1);
    hpBack.position.y = 1.8;
    hpBack.renderOrder = 10;
    const hpBar = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x5ee07a, depthTest: false }));
    hpBar.position.y = 1.8;
    hpBar.renderOrder = 11;

    // Status ring: white = blinded by a flashbang, orange = suppressed.
    const status = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.68, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    status.rotation.x = -Math.PI / 2;
    status.position.y = 0.025;
    status.visible = false;

    root.add(figure, ring, cone, status);
    const overlay = new THREE.Group(); // not rotated with the soldier
    overlay.add(tag, hpBack, hpBar);

    const ghost = new THREE.Mesh(
      ghostGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    ghost.rotation.x = -Math.PI / 2;
    ghost.position.y = 0.03;
    ghost.visible = false;

    scene.add(root, overlay, ghost);
    return { root, figure, bodyMat, ring, cone, status, overlay, hpBar, ghost, lastSeen: null };
  }

  /**
   * @param prev,curr frames to interpolate between
   * @param opts { viewerTeam: 'A'|'B'|null, selectedId, showCones }
   */
  function draw(prev, curr, alpha, { viewerTeam = null, selectedId = null, showCones = false } = {}) {
    const vision = viewerTeam ? frameVision(curr, viewerTeam) : null;
    const prevById = new Map(prev.soldiers.map((s) => [s.id, s]));
    for (const s of curr.soldiers) {
      let v = views.get(s.id);
      if (!v) views.set(s.id, (v = create(s)));
      const p = prevById.get(s.id) ?? s;
      const x = p.x + (s.x - p.x) * alpha;
      const z = p.z + (s.z - p.z) * alpha;

      const visible = !vision || s.team === viewerTeam || vision.has(s.id) || !s.alive;
      v.root.visible = v.overlay.visible = visible;
      if (visible && s.alive) v.lastSeen = { x, z };
      v.ghost.visible = !visible && !!v.lastSeen;
      if (v.ghost.visible) v.ghost.position.set(v.lastSeen.x, 0.03, v.lastSeen.z);

      v.root.position.set(x, 0, z);
      v.root.rotation.y = lerpAngle(p.h, s.h, alpha);
      v.overlay.position.set(x, s.stance === 'crouch' ? -0.45 : 0, z);

      if (!s.alive) {
        v.figure.rotation.x = Math.PI / 2;
        v.figure.position.y = 0.3;
        v.figure.scale.y = 1;
        v.bodyMat.color.setHex(DEAD_COLOR);
        v.overlay.visible = false;
      } else {
        v.figure.rotation.x = 0;
        v.figure.position.y = 0;
        v.figure.scale.y = s.stance === 'crouch' ? 0.65 : 1;
        v.bodyMat.color.setHex(TEAM_COLORS[s.team]);
      }
      v.ring.visible = s.alive && s.id === selectedId;
      v.cone.visible = s.alive && (showCones || s.id === selectedId);

      v.status.visible = s.alive && (s.blind || s.suppressed);
      if (v.status.visible) v.status.material.color.setHex(s.blind ? 0xffffff : 0xffa040);

      const hp = Math.max(0, s.hp) / (s.maxHp ?? MAX_HP);
      v.hpBar.scale.set(0.7 * hp, 0.08, 1);
      v.hpBar.position.x = -0.35 * (1 - hp);
      v.hpBar.material.color.setHex(hp > 0.5 ? 0x5ee07a : hp > 0.25 ? 0xffc14d : 0xff5a4d);
    }
  }

  /** Clear fog-of-war memory (e.g. when starting a new match or scrubbing backwards). */
  function resetGhosts() {
    for (const v of views.values()) v.lastSeen = null;
  }

  /** Soldier nearest to a screen point within radiusPx, or null. Screen-space so it works at any zoom. */
  function pick(camera, sx, sy, width, height, filter = () => true, radiusPx = 40) {
    let best = null;
    let bestD = radiusPx;
    for (const [id, v] of views) {
      if (!v.root.visible || !filter(id)) continue;
      v3.set(v.root.position.x, 0.9, v.root.position.z).project(camera);
      const d = Math.hypot(((v3.x + 1) / 2) * width - sx, ((1 - v3.y) / 2) * height - sy);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  function dispose() {
    for (const v of views.values()) scene.remove(v.root, v.overlay, v.ghost);
    views.clear();
  }

  return { draw, pick, resetGhosts, dispose };
}
