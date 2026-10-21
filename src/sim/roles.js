/**
 * Role and weapon data. Everything gameplay-tunable about a soldier lives here.
 *
 * Weapon accuracy: p = max(0.08, accNear − distance × accFalloff), then
 * multiplied by moveAcc while the shooter is moving.
 */
export const WEAPONS = {
  rifle: { label: 'Rifle', damage: 30, interval: 0.12, mag: 30, reload: 2.2, accNear: 0.92, accFalloff: 0.02, moveAcc: 0.55, aimRate: 8, suppression: 0.12 },
  carbine: { label: 'Carbine', damage: 26, interval: 0.1, mag: 30, reload: 2.0, accNear: 0.9, accFalloff: 0.028, moveAcc: 0.65, aimRate: 9, suppression: 0.1 },
  lmg: { label: 'LMG', damage: 26, interval: 0.075, mag: 100, reload: 4.5, accNear: 0.82, accFalloff: 0.017, moveAcc: 0.3, aimRate: 5, suppression: 0.35 },
  sniper: { label: 'Sniper rifle', damage: 100, interval: 1.3, mag: 5, reload: 3.0, accNear: 0.97, accFalloff: 0.003, moveAcc: 0.15, aimRate: 5, suppression: 0.5 },
  // Shotgun damage falls off between falloffStart and falloffEnd metres.
  shotgun: { label: 'Shotgun', damage: 80, interval: 0.75, mag: 7, reload: 3.2, accNear: 0.96, accFalloff: 0.045, moveAcc: 0.85, aimRate: 10, suppression: 0.25, falloffStart: 4, falloffEnd: 14 },
};

export const GRENADE_KINDS = ['frag', 'flash', 'smoke'];

export const ROLES = {
  rifleman: {
    label: 'Rifleman',
    short: 'RF',
    weapon: 'rifle',
    hp: 100,
    speed: 1,
    gear: { frag: 1, flash: 1, smoke: 1 },
    charges: 0,
    // Multipliers on reaction time: holding = standing still, moving = walking/running.
    reaction: { holding: 1, moving: 1 },
  },
  lmg: {
    label: 'Machine gunner',
    short: 'MG',
    weapon: 'lmg',
    hp: 115,
    speed: 0.85,
    gear: { frag: 1, flash: 0, smoke: 0 },
    charges: 0,
    reaction: { holding: 1.1, moving: 1.25 },
  },
  sniper: {
    label: 'Sniper',
    short: 'SN',
    weapon: 'sniper',
    hp: 90,
    speed: 0.95,
    gear: { frag: 0, flash: 0, smoke: 1 },
    charges: 0,
    reaction: { holding: 0.6, moving: 1.6 },
  },
  breacher: {
    label: 'Breacher',
    short: 'BR',
    weapon: 'shotgun',
    hp: 110,
    speed: 1.05,
    gear: { frag: 0, flash: 2, smoke: 0 },
    charges: 2,
    reaction: { holding: 0.9, moving: 0.85 },
  },
  demolition: {
    label: 'Demolition',
    short: 'DM',
    weapon: 'carbine',
    hp: 100,
    speed: 1,
    gear: { frag: 3, flash: 0, smoke: 1 },
    charges: 1,
    reaction: { holding: 1, moving: 1 },
  },
};

export const ROLE_IDS = Object.keys(ROLES);
export const SQUAD_SIZE = 4;
export const DEFAULT_SQUAD = ['breacher', 'rifleman', 'lmg', 'sniper'];
/** Max of a role per squad; unlisted roles are unlimited. */
export const SQUAD_LIMITS = { sniper: 1, lmg: 1 };

/** Coerce any input into a legal squad (right size, known roles, limits respected). */
export function sanitizeSquad(list) {
  const out = [];
  const counts = {};
  for (const r of Array.isArray(list) ? list : []) {
    if (out.length >= SQUAD_SIZE || !ROLES[r]) continue;
    if ((counts[r] ?? 0) >= (SQUAD_LIMITS[r] ?? Infinity)) continue;
    counts[r] = (counts[r] ?? 0) + 1;
    out.push(r);
  }
  while (out.length < SQUAD_SIZE) out.push('rifleman');
  return out;
}

/** Next legal role for slot i when the player taps it. */
export function cycleRole(squad, i) {
  const next = [...squad];
  let idx = ROLE_IDS.indexOf(squad[i]);
  for (let k = 0; k < ROLE_IDS.length; k++) {
    idx = (idx + 1) % ROLE_IDS.length;
    const r = ROLE_IDS[idx];
    const used = next.filter((x, j) => x === r && j !== i).length;
    if (used < (SQUAD_LIMITS[r] ?? Infinity)) {
      next[i] = r;
      return next;
    }
  }
  return next;
}
