import * as THREE from 'three';
import { FOV } from '../sim/soldier/perception.js';
import { MAX_HP } from '../sim/soldier/soldier.js';
import { frameVision, HEARD_TTL } from '../game/recorder.js';
import { createSoldierModel } from './soldierModel.js';

export const TEAM_COLORS = { A: 0x4a90e2, B: 0xe2574a };
/**
 * Number tag and HP bar keep a fixed size on screen (sizeAttenuation off: scale is
 * a fraction of ~0.83 × screen height at fov 45°), so zooming in shows the model
 * instead of a huge disc over it.
 */
const TAG_SIZE = 0.028;
const HP_W = 0.034;
const HP_H = 0.0045;
const HP_BELOW = 3.6; // HP bar sits this many of its own heights under the tag's centre
/** Ripple radius (m) a second after the noise, roughly in proportion to how far it carries. */
const RIPPLE_SIZE = { step: 2, door: 3, shot: 4, breach: 5 };

const heardBy = (frame, team, id) => frame.heard?.[team]?.find((h) => h.id === id) ?? null;

/** Most recent noise by soldier `id` heard by anyone (for full-vision spectating). */
function freshestNoise(frame, id) {
  const a = heardBy(frame, 'A', id);
  const b = heardBy(frame, 'B', id);
  return !a ? b : !b ? a : a.tick >= b.tick ? a : b;
}
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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, sizeAttenuation: false }));
  sprite.scale.setScalar(TAG_SIZE);
  sprite.renderOrder = 10;
  return sprite;
}

/**
 * Soldiers drawn from recorded frames (live or replay), interpolated between two
 * frames. Handles stance, death, fog of war (last-seen rings and sound ghosts),
 * HP bars, number tags and vision cones.
 */
export function createSoldierView(scene, labels) {
  const views = new Map();
  const ringGeo = new THREE.RingGeometry(0.42, 0.52, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, depthWrite: false });
  const coneGeo = new THREE.CircleGeometry(CONE_RADIUS, 24, Math.PI / 2 - FOV / 2, FOV);
  const ghostGeo = new THREE.RingGeometry(0.3, 0.42, 24);
  const echoBodyGeo = new THREE.CapsuleGeometry(0.28, 0.9, 4, 10);
  const rippleGeo = new THREE.RingGeometry(0.9, 1, 40);
  const v3 = new THREE.Vector3();

  function create(s) {
    const color = TEAM_COLORS[s.team];
    const root = new THREE.Group();
    const model = createSoldierModel(color, s.role);
    const figure = model.figure;

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

    // Number only: the role reads from the model's silhouette (and the squad chips), not more text.
    const tag = textSprite(labels[s.id]?.split(' ')[1] ?? '?', color);
    tag.position.y = 2.1;
    const hpBack = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, depthTest: false, sizeAttenuation: false }));
    hpBack.scale.set(HP_W, HP_H, 1);
    hpBack.center.set(0.5, HP_BELOW);
    hpBack.position.y = 2.1;
    hpBack.renderOrder = 10;
    const hpBar = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x5ee07a, depthTest: false, sizeAttenuation: false }));
    hpBar.position.y = 2.1;
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

    // Sound ghost: a see-through figure where the enemy was last heard, plus an expanding ripple.
    const echo = new THREE.Group();
    const echoMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false });
    const echoBody = new THREE.Mesh(echoBodyGeo, echoMat);
    echoBody.position.y = 0.73;
    const echoTag = textSprite('?', color);
    echoTag.position.y = 1.8;
    echo.add(echoBody, echoTag);
    echo.visible = false;
    const ripple = new THREE.Mesh(
      rippleGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.y = 0.04;
    ripple.visible = false;

    scene.add(root, overlay, ghost, echo, ripple);
    return { root, figure, model, ring, cone, status, overlay, hpBar, ghost, echo, echoMat, ripple, lastSeen: null, fall: 0 };
  }

  /**
   * @param prev,curr frames to interpolate between
   * @param opts { viewerTeam: 'A'|'B'|null, selectedId, showCones }
   */
  function draw(prev, curr, alpha, { viewerTeam = null, selectedId = null, showCones = false, playing = true, dt = 0 } = {}) {
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
      if (visible && s.alive) v.lastSeen = { x, z, tick: curr.tick };
      // Heard more recently than seen → sound ghost instead of the last-seen ring.
      const heard = !visible && heardBy(curr, viewerTeam, s.id);
      const echo = heard && (!v.lastSeen || heard.tick > v.lastSeen.tick) ? heard : null;
      v.ghost.visible = !visible && !!v.lastSeen && !echo;
      if (v.ghost.visible) v.ghost.position.set(v.lastSeen.x, 0.03, v.lastSeen.z);
      v.echo.visible = !!echo;
      if (echo) {
        v.echo.position.set(echo.x, 0, echo.z);
        v.echoMat.opacity = 0.45 - 0.3 * Math.min(1, (curr.tick - echo.tick) / HEARD_TTL);
      }
      // Ripple for a second after any noise: for the listener's view, or for everyone with full vision.
      const ripple = vision ? echo : freshestNoise(curr, s.id);
      const age = ripple ? (curr.tick - ripple.tick) / 60 : 1;
      v.ripple.visible = s.alive && age < 1;
      if (v.ripple.visible) {
        v.ripple.position.set(ripple.x, 0.04, ripple.z);
        v.ripple.scale.setScalar(0.6 + age * (RIPPLE_SIZE[ripple.kind] ?? 3));
        v.ripple.material.opacity = 0.7 * (1 - age);
      }

      v.root.position.set(x, 0, z);
      v.root.rotation.y = lerpAngle(p.h, s.h, alpha);
      v.overlay.position.set(x, s.stance === 'crouch' ? -0.45 : 0, z);

      // Topple over ~0.35 s while playing; when scrubbing, the dead are simply down.
      if (!s.alive) {
        v.fall = playing ? Math.min(1, v.fall + dt / 0.35) : 1;
        v.overlay.visible = false;
      } else v.fall = 0;
      // Walk cycle from the sim clock, so replays animate identically.
      v.model.setPose({ stance: s.stance, moving: s.moving, walkPhase: (curr.tick / 60) * 9 + s.id, dead: !s.alive, fall: v.fall });
      v.ring.visible = s.alive && s.id === selectedId;
      v.cone.visible = s.alive && (showCones || s.id === selectedId);

      v.status.visible = s.alive && (s.blind || s.suppressed);
      if (v.status.visible) v.status.material.color.setHex(s.blind ? 0xffffff : 0xffa040);

      const hp = Math.max(0, s.hp) / (s.maxHp ?? MAX_HP);
      // Fill grows from the bar's left edge: anchor it so its left side lines up with the background's.
      v.hpBar.visible = hp > 0;
      v.hpBar.scale.set(HP_W * Math.max(hp, 0.01), HP_H, 1);
      v.hpBar.center.set(0.5 / Math.max(hp, 0.01), HP_BELOW);
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
    for (const v of views.values()) scene.remove(v.root, v.overlay, v.ghost, v.echo, v.ripple);
    views.clear();
  }

  return { draw, pick, resetGhosts, dispose };
}
