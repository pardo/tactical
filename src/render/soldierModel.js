import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Low-poly jointed soldier. Local +Z is forward, feet at y = 0.
 *
 * Legs are forward kinematics (hip and knee angles); arms are solved with two-bone IK
 * so the hands stay on the weapon whatever it does (aim, recoil, reload).
 *
 * Each role has its own silhouette, readable from the top-down camera:
 *   sniper: boonie hat, ghillie cape, very long scoped rifle
 *   lmg: bulky, big ammo box on a heavy gun
 *   breacher: ballistic shield carried in front
 *   demolition: large orange explosives pack
 *   rifleman: standard helmet and pack
 */
const GUN = {
  rifle: { len: 0.72, w: 0.06 },
  carbine: { len: 0.6, w: 0.06 },
  lmg: { len: 0.86, w: 0.09 },
  sniper: { len: 1.05, w: 0.055 },
  shotgun: { len: 0.66, w: 0.075 },
};
const ROLE_WEAPON = { rifleman: 'rifle', demolition: 'carbine', lmg: 'lmg', sniper: 'sniper', breacher: 'shotgun' };

const HIP_Y = 0.9;
const THIGH = 0.43;
const SHIN = 0.43;
const UPPER_ARM = 0.27;
const FOREARM = 0.26;
const SHOULDER_Y = 0.5; // above the hips
const SHOULDER_X = 0.2;

const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 3, 8);
const geo = {
  thigh: capsule(0.085, THIGH - 0.1),
  shin: capsule(0.07, SHIN - 0.08),
  boot: new THREE.BoxGeometry(0.12, 0.1, 0.25),
  pelvis: new THREE.BoxGeometry(0.32, 0.17, 0.21),
  chest: capsule(0.17, 0.22),
  vest: new THREE.BoxGeometry(0.42, 0.36, 0.31),
  pouch: new THREE.BoxGeometry(0.09, 0.1, 0.05),
  head: new THREE.SphereGeometry(0.115, 12, 10),
  helmet: new THREE.SphereGeometry(0.138, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  goggles: new THREE.BoxGeometry(0.2, 0.045, 0.05),
  upperArm: capsule(0.055, UPPER_ARM - 0.1),
  forearm: capsule(0.05, FOREARM - 0.09),
  glove: new THREE.SphereGeometry(0.05, 8, 6),
  pack: new THREE.BoxGeometry(0.3, 0.32, 0.14),
  brim: new THREE.CylinderGeometry(0.27, 0.27, 0.025, 16),
  cape: new THREE.BoxGeometry(0.5, 0.5, 0.1),
  scope: new THREE.CylinderGeometry(0.03, 0.035, 0.28, 8),
  ammo: new THREE.BoxGeometry(0.18, 0.16, 0.2),
  shield: new THREE.BoxGeometry(0.56, 0.86, 0.05),
  visor: new THREE.BoxGeometry(0.22, 0.1, 0.06),
  bigPack: new THREE.BoxGeometry(0.42, 0.44, 0.24),
  charge: new THREE.BoxGeometry(0.15, 0.09, 0.2),
  mag: new THREE.BoxGeometry(0.04, 0.14, 0.06),
};
const mats = {
  fatigues: new THREE.MeshStandardMaterial({ color: 0x4f5843, roughness: 0.95 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xc89a78, roughness: 0.8 }),
  gear: new THREE.MeshStandardMaterial({ color: 0x2d302b, roughness: 0.9 }),
  boots: new THREE.MeshStandardMaterial({ color: 0x241f1a, roughness: 0.8 }),
  gloves: new THREE.MeshStandardMaterial({ color: 0x1f2120, roughness: 0.8 }),
  goggles: new THREE.MeshStandardMaterial({ color: 0x111418, metalness: 0.6, roughness: 0.2 }),
  gun: new THREE.MeshStandardMaterial({ color: 0x1b1d1f, metalness: 0.5, roughness: 0.45 }),
  ghillie: new THREE.MeshStandardMaterial({ color: 0x5c6b34, roughness: 1, flatShading: true }),
  shield: new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.4, roughness: 0.5 }),
  visor: new THREE.MeshStandardMaterial({ color: 0x9fd2ff, transparent: true, opacity: 0.45, roughness: 0.1 }),
  explosive: new THREE.MeshStandardMaterial({ color: 0xff8a1f, emissive: 0x3a1600 }),
};

/** Gun as one merged mesh: receiver, barrel, stock, magazine (+ scope / box on some). */
const gunGeos = new Map();
function gunGeometry(kind) {
  if (gunGeos.has(kind)) return gunGeos.get(kind);
  const { len, w } = GUN[kind];
  const part = (g, x, y, z) => {
    g.translate(x, y, z);
    return g.index ? g.toNonIndexed() : g;
  };
  const parts = [
    part(new THREE.BoxGeometry(w, w * 1.6, len * 0.45), 0, 0, len * 0.12), // receiver
    part(new THREE.CylinderGeometry(w * 0.28, w * 0.28, len * 0.5, 6).rotateX(Math.PI / 2), 0, w * 0.2, len * 0.55), // barrel
    part(new THREE.BoxGeometry(w * 0.9, w * 1.8, len * 0.26), 0, -w * 0.3, -len * 0.2), // stock
    part(new THREE.BoxGeometry(w * 0.7, w * 2.2, w * 1.1), 0, -w * 1.6, len * 0.16), // magazine
  ];
  const g = mergeGeometries(parts);
  gunGeos.set(kind, g);
  return g;
}

const Y = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

/** Stretch a Y-aligned limb mesh between two points (in its parent's space). */
function placeLimb(mesh, from, to) {
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  tmpC.copy(to).sub(from).normalize();
  mesh.quaternion.setFromUnitVectors(Y, tmpC);
}

/**
 * Two-bone IK: elbow position for a shoulder→hand chain of lengths a, b, bending toward
 * `pole`. Writes into `out`.
 */
function solveElbow(shoulder, hand, a, b, pole, out) {
  const d = tmpA.copy(hand).sub(shoulder);
  const dist = Math.min(d.length(), a + b - 1e-4);
  d.normalize();
  // Distance from the shoulder to the elbow's projection on the shoulder→hand line.
  const x = (a * a - b * b + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  const bend = tmpB.copy(pole).addScaledVector(d, -pole.dot(d)).normalize();
  return out.copy(shoulder).addScaledVector(d, x).addScaledVector(bend, h);
}

export function createSoldierModel(teamColor, role) {
  const figure = new THREE.Group(); // rotated as a whole when falling dead
  const vestMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.75 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor).multiplyScalar(0.55), roughness: 0.6 });
  const mesh = (g, m, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.castShadow = true;
    return o;
  };

  // Hips: everything hangs from here; lowered for crouching.
  const hips = new THREE.Group();
  hips.position.y = HIP_Y;
  figure.add(hips);
  hips.add(mesh(geo.pelvis, mats.fatigues, 0, 0, 0));

  const legs = [-0.1, 0.1].map((x) => {
    const hip = new THREE.Group();
    hip.position.set(x, -0.04, 0);
    const thigh = mesh(geo.thigh, mats.fatigues, 0, -THIGH / 2, 0);
    const knee = new THREE.Group();
    knee.position.y = -THIGH;
    const shin = mesh(geo.shin, mats.fatigues, 0, -SHIN / 2, 0);
    const boot = mesh(geo.boot, mats.boots, 0, -SHIN + 0.02, 0.05);
    knee.add(shin, boot);
    hip.add(thigh, knee);
    hips.add(hip);
    return { hip, knee };
  });

  // Upper body pivots at the hips (lean, recoil, breathing).
  const torso = new THREE.Group();
  hips.add(torso);
  const chest = mesh(geo.chest, mats.fatigues, 0, 0.3, 0);
  chest.scale.set(1.2, 1, 0.8);
  const vest = mesh(geo.vest, vestMat, 0, 0.3, 0);
  torso.add(chest, vest);
  for (const x of [-0.12, 0, 0.12]) torso.add(mesh(geo.pouch, mats.gear, x, 0.22, 0.17));

  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.6, 0.02);
  torso.add(headGroup);
  headGroup.add(mesh(geo.head, mats.skin, 0, 0.06, 0));
  if (role === 'sniper') {
    // Boonie hat in team colour + ghillie cape over the shoulders.
    headGroup.add(mesh(geo.brim, helmetMat, 0, 0.13, 0), mesh(geo.helmet, mats.ghillie, 0, 0.1, 0));
    torso.add(mesh(geo.cape, mats.ghillie, 0, 0.36, -0.15));
  } else {
    headGroup.add(mesh(geo.helmet, helmetMat, 0, 0.08, 0), mesh(geo.goggles, mats.goggles, 0, 0.1, 0.11));
  }
  if (role === 'breacher') headGroup.add(mesh(geo.visor, mats.visor, 0, 0.04, 0.12));

  if (role === 'demolition') {
    // Charges strapped on top of the pack, where the overhead camera sees them.
    torso.add(mesh(geo.bigPack, mats.gear, 0, 0.32, -0.27), mesh(geo.charge, mats.explosive, -0.1, 0.59, -0.27), mesh(geo.charge, mats.explosive, 0.1, 0.59, -0.27));
  } else if (role !== 'sniper') {
    torso.add(mesh(geo.pack, mats.gear, 0, 0.3, -0.22));
  }
  if (role === 'lmg') {
    torso.scale.set(1.15, 1, 1.1); // broad and heavy
    torso.add(mesh(geo.ammo, mats.gear, -0.14, 0.12, 0.2));
  }

  // Weapon, held at the right shoulder; hands are IK'd onto its grip and handguard.
  const kind = ROLE_WEAPON[role] ?? 'rifle';
  const g = GUN[kind];
  const gun = new THREE.Group();
  torso.add(gun);
  gun.add(mesh(gunGeometry(kind), mats.gun));
  if (role === 'sniper') {
    const scope = mesh(geo.scope, mats.gun, 0, g.w * 1.5, g.len * 0.12);
    scope.rotation.x = Math.PI / 2;
    gun.add(scope);
  }
  const gripPt = new THREE.Vector3(0, -g.w * 0.6, 0);
  const foregripPt = new THREE.Vector3(0, -g.w * 0.3, g.len * 0.36);
  let shield = null;
  if (role === 'breacher') {
    // Shield on the left forearm, angled slightly outward; the shotgun stays one-handed-ish.
    shield = new THREE.Group();
    const plate = mesh(geo.shield, mats.shield, 0, 0, 0);
    const stripe = mesh(new THREE.BoxGeometry(0.58, 0.07, 0.06), vestMat, 0, 0.3, 0.005);
    shield.add(plate, stripe);
    torso.add(shield);
  }

  const arms = [SHOULDER_X, -SHOULDER_X].map((x) => {
    const upper = mesh(geo.upperArm, mats.fatigues);
    const fore = mesh(geo.forearm, mats.fatigues);
    const glove = mesh(geo.glove, mats.gloves);
    torso.add(upper, fore, glove);
    return { shoulder: new THREE.Vector3(x, SHOULDER_Y, 0), upper, fore, glove, elbow: new THREE.Vector3(), hand: new THREE.Vector3() };
  });
  const poleR = new THREE.Vector3(0.6, -1, -0.4).normalize();
  const poleL = new THREE.Vector3(-0.8, -1, -0.2).normalize();
  const handWorld = new THREE.Vector3();

  /** Muzzle position in figure space, for flashes (approximate: standing, aiming). */
  const muzzle = new THREE.Vector3(0.1, HIP_Y + 0.44, 0.3 + g.len * 0.8);

  /**
   * @param pose {
   *   stance, moving, walkPhase (radians, advances with distance), speed (m/s),
   *   dead, fall (0..1 how far toppled), fallDir (radians, figure-local direction to fall toward),
   *   aiming (bool), kick (0..1 recoil), reload (0..1 progress or -1), time (s, for breathing)
   * }
   */
  function setPose({ stance, moving, walkPhase = 0, speed = 0, dead, fall = 0, fallDir = Math.PI, aiming = false, kick = 0, reload = -1, time = 0 }) {
    const crouch = stance === 'crouch';
    const run = moving && speed > 2.6;
    // --- legs & hips
    let hipY = HIP_Y;
    if (dead) {
      legs[0].hip.rotation.x = -0.25;
      legs[1].hip.rotation.x = 0.15;
      legs[0].knee.rotation.x = legs[1].knee.rotation.x = 0.3;
    } else if (crouch) {
      // Kneel: left foot planted forward, right knee on the ground.
      hipY = 0.56;
      legs[0].hip.rotation.x = -1.25;
      legs[0].knee.rotation.x = 1.35;
      legs[1].hip.rotation.x = 0.1;
      legs[1].knee.rotation.x = 1.6;
    } else if (moving) {
      const stride = run ? 0.75 : 0.5;
      const s = Math.sin(walkPhase);
      legs[0].hip.rotation.x = -s * stride;
      legs[1].hip.rotation.x = s * stride;
      // Knee bends while that leg swings forward.
      legs[0].knee.rotation.x = Math.max(0, Math.cos(walkPhase)) * (run ? 1.2 : 0.7);
      legs[1].knee.rotation.x = Math.max(0, -Math.cos(walkPhase)) * (run ? 1.2 : 0.7);
      hipY = HIP_Y - 0.03 + Math.abs(Math.cos(walkPhase)) * 0.035 - (run ? 0.05 : 0);
    } else {
      legs[0].hip.rotation.x = legs[1].hip.rotation.x = 0;
      legs[0].knee.rotation.x = legs[1].knee.rotation.x = 0;
    }
    hips.position.y = hipY;

    // --- torso: lean into a run, breathe at rest, kick back on recoil
    const breathe = moving || dead ? 0 : Math.sin(time * 2.2) * 0.012;
    torso.rotation.x = (run ? 0.22 : moving ? 0.08 : crouch ? 0.12 : 0) - kick * 0.1;
    torso.rotation.y = moving && !dead ? Math.sin(walkPhase) * 0.08 : 0;
    chest.scale.y = 1 + breathe;
    headGroup.rotation.x = aiming ? 0.15 : 0;

    // --- weapon: aimed at the shoulder, low-ready otherwise; reload tips it over
    const aim = aiming && !dead ? 1 : 0;
    gun.position.set(0.1, 0.36 + aim * 0.06, 0.24 + aim * 0.04 - kick * 0.07);
    gun.rotation.set(aim ? 0 : 0.35, aim ? 0 : -0.25, 0);
    if (reload >= 0) {
      const r = Math.sin(Math.min(1, reload) * Math.PI);
      gun.rotation.x += 0.4 * r;
      gun.rotation.z = 0.6 * r;
    }
    if (moving && !aim) gun.position.y += Math.sin(walkPhase * 2) * 0.012;
    if (dead) {
      // Dropped beside the body, along the torso (flat on the ground once fallen).
      gun.position.set(0.3, 0.3, 0.06);
      gun.rotation.set(-Math.PI / 2, 0, 0.3);
    }
    gun.updateMatrix();

    // --- arms: hands on grip and handguard (left hand goes to the magazine during reload)
    arms[0].hand.copy(gripPt).applyMatrix4(gun.matrix);
    arms[1].hand.copy(foregripPt).applyMatrix4(gun.matrix);
    if (reload >= 0) {
      const r = Math.sin(Math.min(1, reload) * Math.PI);
      handWorld.set(0.02, 0.2, 0.18);
      arms[1].hand.lerp(handWorld, r);
    }
    if (shield) {
      // Shield arm forward, plate held in front of the body.
      arms[1].hand.set(-0.12, 0.36, 0.34);
      shield.position.set(-0.12, 0.34, 0.44);
      shield.rotation.set(0, 0.22, 0);
    }
    if (dead) {
      arms[0].hand.set(0.32, 0.05, 0.12);
      arms[1].hand.set(-0.34, 0.08, 0.1);
    }
    for (const [i, arm] of arms.entries()) {
      solveElbow(arm.shoulder, arm.hand, UPPER_ARM, FOREARM, i === 0 ? poleR : poleL, arm.elbow);
      placeLimb(arm.upper, arm.shoulder, arm.elbow);
      placeLimb(arm.fore, arm.elbow, arm.hand);
      arm.glove.position.copy(arm.hand);
    }

    // --- death: topple about the feet, away from the killer
    if (dead) {
      figure.rotation.set(0, 0, 0);
      const ax = Math.cos(fallDir);
      const az = -Math.sin(fallDir);
      // Axis horizontal, perpendicular to the fall direction (sin d, cos d).
      figure.quaternion.setFromAxisAngle(tmpA.set(ax, 0, az).normalize(), (Math.PI / 2) * fall * 0.98);
      figure.position.y = 0.12 * fall;
      vestMat.color.setHex(0x55595e);
    } else {
      figure.quaternion.identity();
      figure.position.y = 0;
      vestMat.color.setHex(teamColor);
    }
  }

  setPose({ stance: 'stand', moving: false });
  /** Free this soldier's own materials (geometry and the rest are shared). */
  function dispose() {
    vestMat.dispose();
    helmetMat.dispose();
  }

  return { figure, setPose, muzzle, dispose };
}
