import * as THREE from 'three';
import { Tile } from '../sim/map.js';

/**
 * Procedural textures, drawn on canvases at load time: no image assets to download.
 * Seeded so a map always looks the same.
 */

export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

/** Shade a 0xRRGGBB colour by f (1 = same, <1 darker, >1 lighter) → css string. */
function shade(color, f) {
  const r = Math.min(255, ((color >> 16) & 255) * f);
  const g = Math.min(255, ((color >> 8) & 255) * f);
  const b = Math.min(255, (color & 255) * f);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/** Speckle noise over a rect: many tiny light/dark dots. */
function speckle(g, rand, x, y, w, h, n, alpha = 0.08) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${alpha * rand()})` : `rgba(255,255,255,${alpha * rand()})`;
    const s = 1 + rand() * 2;
    g.fillRect(x + rand() * w, y + rand() * h, s, s);
  }
}

function toTexture(c, { repeat = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* ---------- floor patterns, drawn per cell ---------- */

const FLOOR_PAINTERS = {
  /** Poured concrete slabs, 2×2 m, faint seams. */
  concrete(g, rand, x, y, p, base, cx, cz) {
    g.fillStyle = shade(base, 0.94 + rand() * 0.1);
    g.fillRect(x, y, p, p);
    speckle(g, rand, x, y, p, p, p / 2, 0.07);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    if (cx % 2 === 0) g.fillRect(x, y, 1, p);
    if (cz % 2 === 0) g.fillRect(x, y, p, 1);
  },
  /** Square ceramic tiles, 1 per metre, with grout. */
  tiles(g, rand, x, y, p, base) {
    g.fillStyle = shade(base, 0.6);
    g.fillRect(x, y, p, p);
    g.fillStyle = shade(base, 0.95 + rand() * 0.1);
    g.fillRect(x + 1, y + 1, p - 2, p - 2);
    speckle(g, rand, x, y, p, p, p / 4, 0.05);
  },
  /** Checkered marble. */
  marble(g, rand, x, y, p, base, cx, cz) {
    const dark = (cx + cz) % 2 === 0;
    g.fillStyle = shade(base, dark ? 0.62 : 1.05);
    g.fillRect(x, y, p, p);
    g.strokeStyle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    g.lineWidth = 1;
    for (let i = 0; i < 2; i++) {
      g.beginPath();
      g.moveTo(x + rand() * p, y);
      g.bezierCurveTo(x + rand() * p, y + p / 3, x + rand() * p, y + (2 * p) / 3, x + rand() * p, y + p);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x, y, p, 1);
    g.fillRect(x, y, 1, p);
  },
  /** Wooden planks running along x. */
  planks(g, rand, x, y, p, base) {
    const rows = 4;
    const h = p / rows;
    for (let r = 0; r < rows; r++) {
      g.fillStyle = shade(base, 0.85 + rand() * 0.25);
      g.fillRect(x, y + r * h, p, h);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let k = 0; k < 3; k++) g.fillRect(x, y + r * h + rand() * h, p, 1);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x, y + r * h, p, 1);
      if (rand() < 0.4) g.fillRect(x + rand() * p, y + r * h, 1, h);
    }
  },
  /** Asphalt: dark, grainy. */
  asphalt(g, rand, x, y, p, base) {
    g.fillStyle = shade(base, 0.96 + rand() * 0.08);
    g.fillRect(x, y, p, p);
    speckle(g, rand, x, y, p, p, p * 1.5, 0.12);
  },
  /** Plywood sheets (training facility): 2×1 m boards. */
  plywood(g, rand, x, y, p, base, cx, cz) {
    g.fillStyle = shade(base, 0.92 + rand() * 0.14);
    g.fillRect(x, y, p, p);
    g.strokeStyle = 'rgba(80,50,20,0.12)';
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      const yy = y + rand() * p;
      g.moveTo(x, yy);
      g.quadraticCurveTo(x + p / 2, yy + (rand() - 0.5) * 6, x + p, yy + (rand() - 0.5) * 4);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.3)';
    if (cx % 2 === 0) g.fillRect(x, y, 1, p);
    g.fillRect(x, y, p, 1);
    if (cz % 2 === 0) speckle(g, rand, x, y, p, p, 4, 0.2);
  },
};

/**
 * Map themes: floor pattern for the open area and for rooms (cells only reachable
 * through a door), wall and cap colours, props used for low cover.
 */
export const THEMES = {
  killhouse: {
    outdoor: { pattern: 'concrete', color: 0x6b6f72 },
    indoor: { pattern: 'plywood', color: 0x9a7f5c },
    wall: 0x8c8a84,
    cap: 0xc9c5bb,
    trim: 0x3d3f42,
    ground: 0x2a2d2b,
    sky: 0x14171b,
    props: ['crate', 'crate', 'sandbags', 'barrels'],
  },
  warehouse: {
    outdoor: { pattern: 'concrete', color: 0x777b7e },
    indoor: { pattern: 'tiles', color: 0x8d9296 },
    wall: 0x7d8a96,
    cap: 0xb6c0c8,
    trim: 0xc9a227,
    ground: 0x262a2e,
    sky: 0x12161b,
    props: ['crate', 'barrels', 'pallet', 'crate'],
    markings: true,
  },
  streets: {
    outdoor: { pattern: 'asphalt', color: 0x45484c },
    indoor: { pattern: 'planks', color: 0x8a6646 },
    wall: 0xa39282,
    cap: 0xd2c6b5,
    trim: 0x5b4c40,
    ground: 0x2b2a28,
    sky: 0x151617,
    props: ['barrier', 'sandbags', 'barrier', 'barrels'],
    curbs: true,
  },
  embassy: {
    outdoor: { pattern: 'tiles', color: 0xb7ad99 },
    indoor: { pattern: 'marble', color: 0xd8d2c8 },
    wall: 0xd9cfbd,
    cap: 0xf1eadc,
    trim: 0x6e5a44,
    ground: 0x22281f,
    sky: 0x141813,
    props: ['planter', 'sofa', 'planter', 'crate'],
  },
};

/** Theme for a map: built-ins by name, custom maps get one picked from their name. */
export function themeFor(map) {
  const key = map.name?.toLowerCase();
  if (THEMES[key]) return THEMES[key];
  const keys = Object.keys(THEMES);
  return THEMES[keys[hashString(map.name ?? '') % keys.length]];
}

/** Cells reachable from the spawns without going through a door: the "outdoor"/main area. */
export function mainArea(map) {
  const { width, height, tiles } = map;
  const seen = new Uint8Array(width * height);
  const stack = [];
  for (const team of ['A', 'B']) for (const { cx, cz } of map.spawns[team]) stack.push(cz * width + cx);
  if (!stack.length) seen.fill(1);
  while (stack.length) {
    const i = stack.pop();
    if (seen[i]) continue;
    const t = tiles[i];
    if (t === Tile.WALL || t === Tile.DOOR) continue;
    seen[i] = 1;
    const cx = i % width;
    const cz = (i / width) | 0;
    if (cx > 0) stack.push(i - 1);
    if (cx < width - 1) stack.push(i + 1);
    if (cz > 0) stack.push(i - width);
    if (cz < height - 1) stack.push(i + width);
  }
  return seen;
}

/**
 * The whole floor as one baked texture: per-cell material, ambient occlusion along
 * wall bases, grime, cracks and painted spawn zones.
 * @param px pixels per cell (lower for the editor, which rebuilds often)
 */
export function bakeFloor(map, theme, px = 32) {
  const { width, height, tiles } = map;
  const [c, g] = canvas(width * px, height * px);
  const rand = rng(hashString(map.name ?? 'map') ^ (width * 73856093) ^ (height * 19349663));
  const main = mainArea(map);
  const isWall = (cx, cz) => cx < 0 || cz < 0 || cx >= width || cz >= height || tiles[cz * width + cx] === Tile.WALL;

  for (let cz = 0; cz < height; cz++) {
    for (let cx = 0; cx < width; cx++) {
      const i = cz * width + cx;
      const region = main[i] ? theme.outdoor : theme.indoor;
      FLOOR_PAINTERS[region.pattern](g, rand, cx * px, cz * px, px, region.color, cx, cz);
    }
  }

  // Doorway thresholds: a darker strip across the door cell.
  for (let cz = 0; cz < height; cz++) {
    for (let cx = 0; cx < width; cx++) {
      if (tiles[cz * width + cx] !== Tile.DOOR) continue;
      g.fillStyle = shade(theme.trim, 0.7);
      g.fillRect(cx * px + px * 0.08, cz * px + px * 0.08, px * 0.84, px * 0.84);
    }
  }

  // Curbs: lighter sidewalk strip where the open street meets a building wall.
  if (theme.curbs) {
    for (let cz = 0; cz < height; cz++) {
      for (let cx = 0; cx < width; cx++) {
        const i = cz * width + cx;
        if (!main[i] || tiles[i] === Tile.WALL) continue;
        const near = isWall(cx - 1, cz) || isWall(cx + 1, cz) || isWall(cx, cz - 1) || isWall(cx, cz + 1);
        if (!near) continue;
        g.fillStyle = 'rgba(170,165,155,0.28)';
        g.fillRect(cx * px, cz * px, px, px);
      }
    }
  }

  // Painted spawn zones: team-coloured hatched pads.
  const SPAWN = { A: '74,144,226', B: '226,87,74' };
  for (const team of ['A', 'B']) {
    for (const { cx, cz } of map.spawns[team]) {
      const x = cx * px;
      const y = cz * px;
      g.fillStyle = `rgba(${SPAWN[team]},0.16)`;
      g.fillRect(x, y, px, px);
      g.save();
      g.beginPath();
      g.rect(x, y, px, px);
      g.clip();
      g.strokeStyle = `rgba(${SPAWN[team]},0.35)`;
      g.lineWidth = px / 10;
      for (let k = -px; k < px * 2; k += px / 3) {
        g.beginPath();
        g.moveTo(x + k, y);
        g.lineTo(x + k - px, y + px);
        g.stroke();
      }
      g.restore();
    }
  }

  // Warehouse: yellow safety lines a cell away from the outer walls.
  if (theme.markings) {
    g.strokeStyle = 'rgba(230,190,40,0.55)';
    g.lineWidth = px / 8;
    g.setLineDash([px * 0.8, px * 0.4]);
    g.strokeRect(1.5 * px, 1.5 * px, (width - 3) * px, (height - 3) * px);
    g.setLineDash([]);
  }

  // Grime: soft dark stains, more of them indoors' corners and along walls.
  for (let k = 0; k < width * height * 0.08; k++) {
    const x = rand() * width * px;
    const y = rand() * height * px;
    const r = px * (0.4 + rand() * 1.6);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(20,16,10,${0.08 + rand() * 0.12})`);
    grad.addColorStop(1, 'rgba(20,16,10,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Cracks: short jagged polylines.
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1;
  for (let k = 0; k < width * height * 0.03; k++) {
    let x = rand() * width * px;
    let y = rand() * height * px;
    g.beginPath();
    g.moveTo(x, y);
    let a = rand() * Math.PI * 2;
    for (let s = 0; s < 5; s++) {
      a += (rand() - 0.5) * 1.4;
      x += Math.cos(a) * px * 0.25;
      y += Math.sin(a) * px * 0.25;
      g.lineTo(x, y);
    }
    g.stroke();
  }

  // Ambient occlusion: darken floor along walls (soft gradient into the cell).
  const ao = (x, y, w, h, x0, y0, x1, y1) => {
    const grad = g.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
  };
  const d = px * 0.45;
  for (let cz = 0; cz < height; cz++) {
    for (let cx = 0; cx < width; cx++) {
      if (isWall(cx, cz)) continue;
      const x = cx * px;
      const y = cz * px;
      if (isWall(cx - 1, cz)) ao(x, y, d, px, x, 0, x + d, 0);
      if (isWall(cx + 1, cz)) ao(x + px - d, y, d, px, x + px, 0, x + px - d, 0);
      if (isWall(cx, cz - 1)) ao(x, y, px, d, 0, y, 0, y + d);
      if (isWall(cx, cz + 1)) ao(x, y + px - d, px, d, 0, y + px, 0, y + px - d);
    }
  }
  // Under-wall cells (hidden by the wall boxes) in a neutral dark.
  g.fillStyle = '#16181a';
  for (let cz = 0; cz < height; cz++) for (let cx = 0; cx < width; cx++) if (isWall(cx, cz)) g.fillRect(cx * px, cz * px, px, px);

  return toTexture(c);
}

/* ---------- small tiling textures for props and walls (cached) ---------- */

const cache = new Map();
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

/** Wall side: plaster/paint with a dark skirting band and grime rising from the floor. */
export function wallTexture(theme) {
  return cached(`wall:${theme.wall}`, () => {
    const [c, g] = canvas(128, 128);
    const rand = rng(theme.wall);
    g.fillStyle = shade(theme.wall, 1);
    g.fillRect(0, 0, 128, 128);
    speckle(g, rand, 0, 0, 128, 128, 500, 0.06);
    // Vertical streaks.
    for (let i = 0; i < 10; i++) {
      g.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.04})`;
      g.fillRect(rand() * 128, 0, 2 + rand() * 6, 128);
    }
    const grad = g.createLinearGradient(0, 70, 0, 128);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = grad;
    g.fillRect(0, 70, 128, 58);
    g.fillStyle = shade(theme.trim, 1);
    g.fillRect(0, 116, 128, 12);
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(0, 116, 128, 1);
    return toTexture(c);
  });
}

/** Wall top: lighter concrete cap with an edge bevel. */
export function capTexture(theme) {
  return cached(`cap:${theme.cap}`, () => {
    const [c, g] = canvas(64, 64);
    const rand = rng(theme.cap);
    g.fillStyle = shade(theme.cap, 1);
    g.fillRect(0, 0, 64, 64);
    speckle(g, rand, 0, 0, 64, 64, 200, 0.07);
    return toTexture(c);
  });
}

/** Wooden crate face: frame, diagonal brace, planks. */
export function crateTexture() {
  return cached('crate', () => {
    const [c, g] = canvas(128, 128);
    const rand = rng(7);
    g.fillStyle = '#9a7445';
    g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 21) {
      g.fillStyle = shade(0x9a7445, 0.85 + rand() * 0.25);
      g.fillRect(0, y, 128, 20);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, y + 20, 128, 1);
    }
    g.strokeStyle = '#6e4f2b';
    g.lineWidth = 14;
    g.strokeRect(7, 7, 114, 114);
    g.beginPath();
    g.moveTo(12, 116);
    g.lineTo(116, 12);
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.lineWidth = 1;
    g.strokeRect(14, 14, 100, 100);
    speckle(g, rand, 0, 0, 128, 128, 300, 0.1);
    // Stencilled marking.
    g.fillStyle = 'rgba(30,20,10,0.45)';
    g.font = 'bold 14px monospace';
    g.fillText('A-17', 46, 70);
    return toTexture(c);
  });
}

/** Sandbag fabric: coarse weave. */
export function fabricTexture() {
  return cached('fabric', () => {
    const [c, g] = canvas(64, 64);
    const rand = rng(11);
    g.fillStyle = '#b1a07a';
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 64; i += 2) {
      g.fillStyle = `rgba(0,0,0,${0.05 + rand() * 0.05})`;
      g.fillRect(i, 0, 1, 64);
      g.fillRect(0, i, 64, 1);
    }
    speckle(g, rand, 0, 0, 64, 64, 120, 0.12);
    return toTexture(c, { repeat: true });
  });
}

/** Painted steel drum: coloured with ribs and a hazard band. */
export function drumTexture() {
  return cached('drum', () => {
    const [c, g] = canvas(128, 64);
    const rand = rng(5);
    g.fillStyle = '#2f5f8a';
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, 14, 128, 3);
    g.fillRect(0, 46, 128, 3);
    g.fillStyle = '#d9b43a';
    g.fillRect(0, 26, 128, 10);
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `rgba(90,50,20,${0.2 + rand() * 0.3})`;
      g.fillRect(rand() * 128, rand() * 64, 2 + rand() * 6, 1 + rand() * 6);
    }
    return toTexture(c, { repeat: true });
  });
}

/** Concrete (jersey barriers, planters). */
export function concreteTexture() {
  return cached('concrete', () => {
    const [c, g] = canvas(64, 64);
    const rand = rng(3);
    g.fillStyle = '#a8a59d';
    g.fillRect(0, 0, 64, 64);
    speckle(g, rand, 0, 0, 64, 64, 300, 0.12);
    g.fillStyle = 'rgba(200,40,30,0.55)';
    g.fillRect(0, 48, 64, 5);
    return toTexture(c, { repeat: true });
  });
}


/** Door leaf: painted wood with two inset panels. */
export function doorTexture(theme) {
  return cached(`door:${theme.trim}`, () => {
    const [c, g] = canvas(64, 128);
    const rand = rng(13);
    const base = 0x8a6440;
    g.fillStyle = shade(base, 1);
    g.fillRect(0, 0, 64, 128);
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.lineWidth = 3;
    g.strokeRect(10, 10, 44, 46);
    g.strokeRect(10, 68, 44, 50);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    g.strokeRect(12, 12, 40, 42);
    g.strokeRect(12, 70, 40, 46);
    speckle(g, rand, 0, 0, 64, 128, 150, 0.1);
    g.fillStyle = shade(theme.trim, 1);
    g.fillRect(0, 0, 64, 4);
    return toTexture(c);
  });
}
