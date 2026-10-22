import * as THREE from 'three';

/**
 * Low-poly soldier built from boxes: legs swing when walking, bend when
 * crouched, and the figure topples when dead. Local +Z is forward.
 *
 * Each role has its own silhouette, readable from the top-down camera:
 *   sniper: wide-brim hat, ghillie cape, very long scoped rifle
 *   lmg: bulky, big ammo box on a heavy gun
 *   breacher: ballistic shield carried in front
 *   demolition: large orange explosives pack
 *   rifleman: standard helmet and pack
 */
const GUN = {
  rifle: { len: 0.7, w: 0.07 },
  carbine: { len: 0.58, w: 0.07 },
  lmg: { len: 0.8, w: 0.11 },
  sniper: { len: 1.0, w: 0.06 },
  shotgun: { len: 0.6, w: 0.09 },
};
const ROLE_WEAPON = { rifleman: 'rifle', demolition: 'carbine', lmg: 'lmg', sniper: 'sniper', breacher: 'shotgun' };

const geo = {
  leg: new THREE.BoxGeometry(0.15, 0.8, 0.17),
  torso: new THREE.BoxGeometry(0.44, 0.55, 0.28),
  vest: new THREE.BoxGeometry(0.47, 0.36, 0.31),
  head: new THREE.SphereGeometry(0.13, 12, 10),
  helmet: new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  arm: new THREE.BoxGeometry(0.11, 0.11, 0.45),
  pack: new THREE.BoxGeometry(0.3, 0.32, 0.14),
  brim: new THREE.CylinderGeometry(0.3, 0.3, 0.03, 16),
  cape: new THREE.BoxGeometry(0.56, 0.5, 0.12),
  scope: new THREE.BoxGeometry(0.07, 0.08, 0.3),
  ammo: new THREE.BoxGeometry(0.2, 0.18, 0.22),
  shield: new THREE.BoxGeometry(0.6, 0.8, 0.06),
  bigPack: new THREE.BoxGeometry(0.44, 0.44, 0.26),
  charge: new THREE.BoxGeometry(0.16, 0.1, 0.22),
};
const mats = {
  fatigues: new THREE.MeshStandardMaterial({ color: 0x4b5340 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xc89a78 }),
  gear: new THREE.MeshStandardMaterial({ color: 0x2c2f2a }),
  gun: new THREE.MeshStandardMaterial({ color: 0x1b1d1f, metalness: 0.4, roughness: 0.5 }),
  ghillie: new THREE.MeshStandardMaterial({ color: 0x5c6b34, roughness: 1 }),
  shield: new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.3, roughness: 0.6 }),
  explosive: new THREE.MeshStandardMaterial({ color: 0xff8a1f, emissive: 0x3a1600 }),
};
const gunGeos = new Map();

export function createSoldierModel(teamColor, role) {
  const figure = new THREE.Group();
  const vestMat = new THREE.MeshStandardMaterial({ color: teamColor });
  const helmetMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor).multiplyScalar(0.6) });
  const mesh = (g, m, x, y, z) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.castShadow = true;
    return o;
  };

  // Legs hang from hip pivots so they can swing and bend.
  const legs = [-0.11, 0.11].map((x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.85, 0);
    pivot.add(mesh(geo.leg, mats.fatigues, 0, -0.4, 0));
    figure.add(pivot);
    return pivot;
  });

  // Upper body moves down as one piece when crouching.
  const upper = new THREE.Group();
  upper.position.y = 0.85;
  upper.add(
    mesh(geo.torso, mats.fatigues, 0, 0.3, 0),
    mesh(geo.vest, vestMat, 0, 0.36, 0),
    mesh(geo.head, mats.skin, 0, 0.73, 0.02),
    mesh(geo.arm, mats.fatigues, 0.2, 0.42, 0.2),
    mesh(geo.arm, mats.fatigues, -0.12, 0.4, 0.24),
  );
  if (role === 'sniper') {
    // Boonie hat in team colour + ghillie cape over the shoulders.
    upper.add(mesh(geo.brim, helmetMat, 0, 0.8, 0.01), mesh(geo.helmet, mats.ghillie, 0, 0.78, 0.01), mesh(geo.cape, mats.ghillie, 0, 0.5, -0.12));
  } else {
    upper.add(mesh(geo.helmet, helmetMat, 0, 0.76, 0.01));
  }
  if (role === 'demolition') {
    const pack = mesh(geo.bigPack, mats.gear, 0, 0.36, -0.26);
    // Charges strapped on top of the pack, where the overhead camera sees them.
    upper.add(pack, mesh(geo.charge, mats.explosive, -0.11, 0.63, -0.26), mesh(geo.charge, mats.explosive, 0.11, 0.63, -0.26));
  } else if (role !== 'sniper') {
    upper.add(mesh(geo.pack, mats.gear, 0, 0.33, -0.2));
  }
  if (role === 'breacher') {
    // Shield on the left arm, angled slightly outward.
    const shield = mesh(geo.shield, mats.shield, -0.14, 0.32, 0.42);
    shield.rotation.y = 0.25;
    const stripe = mesh(new THREE.BoxGeometry(0.62, 0.08, 0.07), vestMat, -0.14, 0.62, 0.42);
    stripe.rotation.y = 0.25;
    upper.add(shield, stripe);
  }
  if (role === 'lmg') upper.scale.set(1.15, 1, 1.1); // broad and heavy
  const g = GUN[ROLE_WEAPON[role]] ?? GUN.rifle;
  const key = `${g.len}:${g.w}`;
  if (!gunGeos.has(key)) gunGeos.set(key, new THREE.BoxGeometry(g.w, g.w * 1.3, g.len));
  const gun = mesh(gunGeos.get(key), mats.gun, 0.1, 0.44, 0.22 + g.len / 2);
  upper.add(gun);
  if (role === 'sniper') upper.add(mesh(geo.scope, mats.gun, 0.1, 0.53, 0.45));
  if (role === 'lmg') upper.add(mesh(geo.ammo, mats.gear, 0.1, 0.32, 0.4));
  figure.add(upper);

  /** Muzzle position in figure space, for flashes. */
  const muzzle = new THREE.Vector3(0.1, 0.85 + 0.44, 0.22 + g.len);

  /**
   * @param pose { stance, moving, walkPhase (radians), dead, fall (0..1 how far toppled) }
   */
  function setPose({ stance, moving, walkPhase, dead, fall }) {
    if (dead) {
      figure.rotation.x = (Math.PI / 2) * fall;
      figure.position.y = 0.15 * fall;
      legs[0].rotation.x = legs[1].rotation.x = 0;
      upper.position.y = 0.85;
      vestMat.color.setHex(0x55595e);
      return;
    }
    figure.rotation.x = 0;
    figure.position.y = 0;
    vestMat.color.setHex(teamColor);
    if (stance === 'crouch') {
      // Kneel: one leg forward, one back, body lowered.
      upper.position.y = 0.5;
      legs[0].position.y = legs[1].position.y = 0.5;
      legs[0].rotation.x = -1.1;
      legs[1].rotation.x = 1.3;
      return;
    }
    upper.position.y = 0.85;
    legs[0].position.y = legs[1].position.y = 0.85;
    const swing = moving ? Math.sin(walkPhase) * 0.55 : 0;
    legs[0].rotation.x = swing;
    legs[1].rotation.x = -swing;
    upper.rotation.z = moving ? Math.sin(walkPhase) * 0.04 : 0;
  }

  return { figure, setPose, muzzle };
}
