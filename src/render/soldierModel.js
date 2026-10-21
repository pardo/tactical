import * as THREE from 'three';

/**
 * Low-poly soldier built from boxes: legs swing when walking, bend when
 * crouched, and the figure topples when dead. Local +Z is forward.
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
};
const mats = {
  fatigues: new THREE.MeshStandardMaterial({ color: 0x4b5340 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xc89a78 }),
  gear: new THREE.MeshStandardMaterial({ color: 0x2c2f2a }),
  gun: new THREE.MeshStandardMaterial({ color: 0x1b1d1f, metalness: 0.4, roughness: 0.5 }),
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
    mesh(geo.pack, mats.gear, 0, 0.33, -0.2),
    mesh(geo.head, mats.skin, 0, 0.73, 0.02),
    mesh(geo.helmet, helmetMat, 0, 0.76, 0.01),
    mesh(geo.arm, mats.fatigues, 0.2, 0.42, 0.2),
    mesh(geo.arm, mats.fatigues, -0.12, 0.4, 0.24),
  );
  const g = GUN[ROLE_WEAPON[role]] ?? GUN.rifle;
  const key = `${g.len}:${g.w}`;
  if (!gunGeos.has(key)) gunGeos.set(key, new THREE.BoxGeometry(g.w, g.w * 1.3, g.len));
  const gun = mesh(gunGeos.get(key), mats.gun, 0.1, 0.44, 0.22 + g.len / 2);
  upper.add(gun);
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
