import * as THREE from 'three';
import { FOV, VIEW_RANGE, CLOSE_AWARENESS } from '../sim/soldier/perception.js';
import { frameVision } from '../game/recorder.js';
import { sightBlocker, gridCorners, visionPolygon } from './visibility.js';
import { TEAM_COLORS } from './soldierView.js';

const MAX_VERTS = 1024;
const CONE_Y = 0.03;
const MASK_Y = 0.011;
/**
 * Stencil layout: fog masks write 1 where the viewing team can see; cones write 2 (team A)
 * or 3 (team B) and skip pixels already holding their value, so overlapping cones of one
 * team don't stack into darker patches.
 */
const STENCIL = { seen: 1, A: 2, B: 3 };

const coneVertex = /* glsl */ `
  attribute float aT;
  attribute float aD;
  varying float vT;
  varying float vD;
  void main() {
    vT = aT;
    vD = aD;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const coneFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uRange;
  uniform float uTime;
  uniform float uSweep;
  varying float vT;
  varying float vD;
  void main() {
    float fade = 1.0 - smoothstep(0.0, uRange, vD);
    // Distance to where this ray stops (a wall or the range limit): bright rim there.
    float rimDist = vT > 0.001 ? (1.0 - vT) * vD / vT : 1.0;
    float rim = 1.0 - smoothstep(0.0, 0.12, rimDist);
    // Selected soldier: faint bands sweeping outward.
    float band = uSweep * smoothstep(0.85, 1.0, sin(vD * 1.2 - uTime * 5.0)) * fade;
    float a = uOpacity * (0.25 + 0.75 * fade * fade) + rim * 0.45 * (0.4 + 0.6 * fade) + band * 0.12;
    gl_FragColor = vec4(uColor * (1.0 + rim * 0.6), a);
  }`;

function fanGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_VERTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(MAX_VERTS), 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aD', new THREE.BufferAttribute(new Float32Array(MAX_VERTS), 1).setUsage(THREE.DynamicDrawUsage));
  const idx = new Uint16Array(MAX_VERTS * 3);
  g.setIndex(new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4); // updated in place, never culled
  return g;
}

/** Fill a fan geometry: vertex 0 is the eye, then the rim points; `closed` joins last to first. */
function writeFan(g, x, z, y, pts, closed) {
  const pos = g.attributes.position.array;
  const t = g.attributes.aT.array;
  const d = g.attributes.aD.array;
  const idx = g.index.array;
  const rim = Math.min(pts.length / 3, MAX_VERTS - 1);
  pos[0] = x;
  pos[1] = y;
  pos[2] = z;
  t[0] = 0;
  d[0] = 0;
  for (let i = 0; i < rim; i++) {
    pos[(i + 1) * 3] = pts[i * 3];
    pos[(i + 1) * 3 + 1] = y;
    pos[(i + 1) * 3 + 2] = pts[i * 3 + 1];
    t[i + 1] = 1;
    d[i + 1] = pts[i * 3 + 2];
  }
  let n = 0;
  const tris = closed ? rim : rim - 1;
  for (let i = 0; i < tris; i++) {
    idx[n++] = 0;
    idx[n++] = i + 1;
    idx[n++] = ((i + 1) % rim) + 1;
  }
  g.setDrawRange(0, n);
  for (const k of ['position', 'aT', 'aD']) g.attributes[k].needsUpdate = true;
  g.index.needsUpdate = true;
}

/**
 * Vision cones clipped by walls, closed doors and smoke, plus fog of war for the
 * viewing team (everything outside its soldiers' sight is darkened).
 */
export function createVisionView(scene, map) {
  const group = new THREE.Group();
  scene.add(group);
  const corners = { key: null, list: [] };
  let blocked = sightBlocker(map, null);
  let doorKey = null;
  const views = new Map();
  const clock = new THREE.Clock();

  const fog = new THREE.Mesh(
    new THREE.PlaneGeometry(map.width + 0.02, map.height + 0.02),
    new THREE.MeshBasicMaterial({
      color: 0x05070a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      stencilWrite: true,
      stencilRef: STENCIL.seen,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilZPass: THREE.KeepStencilOp,
    }),
  );
  fog.rotation.x = -Math.PI / 2;
  fog.position.y = MASK_Y + 0.001;
  // Transparent objects draw by renderOrder: masks, then fog, then everything else on top.
  fog.renderOrder = -1;
  fog.visible = false;
  group.add(fog);

  const maskMat = new THREE.MeshBasicMaterial({
    transparent: true,
    colorWrite: false,
    depthWrite: false,
    stencilWrite: true,
    stencilRef: STENCIL.seen,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
  });

  function create(s) {
    const material = new THREE.ShaderMaterial({
      vertexShader: coneVertex,
      fragmentShader: coneFragment,
      uniforms: {
        uColor: { value: new THREE.Color(TEAM_COLORS[s.team]) },
        uOpacity: { value: 0.1 },
        uRange: { value: VIEW_RANGE * 0.6 },
        uTime: { value: 0 },
        uSweep: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      stencilWrite: true,
      stencilRef: STENCIL[s.team],
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
    });
    const cone = new THREE.Mesh(fanGeometry(), material);
    cone.frustumCulled = false;
    const mask = new THREE.Mesh(fanGeometry(), maskMat);
    mask.frustumCulled = false;
    mask.renderOrder = -2;
    group.add(cone, mask);
    return { cone, mask, key: '' };
  }

  /**
   * @param opts { viewerTeam, selectedId, showCones, fog: bool }
   */
  function draw(prev, curr, alpha, { viewerTeam = null, selectedId = null, showCones = false, fog: fogOn = true } = {}) {
    const dk = (curr.doors ?? []).join();
    if (dk !== doorKey) {
      doorKey = dk;
      blocked = sightBlocker(map, curr.doors);
      corners.list = gridCorners(map, blocked);
      for (const v of views.values()) v.key = '';
    }
    const smokes = curr.smokes ?? [];
    const smokeKey = smokes.map((m) => `${m.x.toFixed(1)},${m.z.toFixed(1)},${m.r.toFixed(2)}`).join();
    const vision = viewerTeam ? frameVision(curr, viewerTeam) : null;
    const prevById = new Map(prev.soldiers.map((s) => [s.id, s]));
    const t = clock.getElapsedTime();
    fog.visible = !!viewerTeam && fogOn;

    for (const s of curr.soldiers) {
      let v = views.get(s.id);
      if (!v) views.set(s.id, (v = create(s)));
      const p = prevById.get(s.id) ?? s;
      const x = p.x + (s.x - p.x) * alpha;
      const z = p.z + (s.z - p.z) * alpha;
      let dh = s.h - p.h;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      const h = p.h + dh * alpha;

      const shown = !vision || s.team === viewerTeam || vision.has(s.id);
      const sees = s.alive && !s.blind;
      const selected = s.id === selectedId;
      v.cone.visible = shown && sees && (showCones || selected);
      v.mask.visible = fog.visible && sees && s.team === viewerTeam;
      if (!v.cone.visible && !v.mask.visible) continue;

      const key = `${x.toFixed(3)},${z.toFixed(3)},${h.toFixed(4)},${smokeKey}`;
      if (key !== v.key) {
        v.key = key;
        const poly = visionPolygon(map, blocked, corners.list, x, z, h, { fov: FOV, range: VIEW_RANGE, nearRange: CLOSE_AWARENESS, smokes });
        writeFan(v.mask.geometry, x, z, MASK_Y, poly.pts, true);
        const cone = visionPolygon(map, blocked, corners.list, x, z, h, { fov: FOV, range: VIEW_RANGE, smokes });
        writeFan(v.cone.geometry, x, z, CONE_Y, cone.pts, false);
      }
      const u = v.cone.material.uniforms;
      u.uOpacity.value = selected ? 0.2 : 0.09;
      u.uSweep.value = selected ? 1 : 0;
      u.uTime.value = t;
    }
  }

  function dispose() {
    scene.remove(group);
    group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material && o.material !== maskMat) o.material.dispose();
    });
    maskMat.dispose();
    views.clear();
  }

  return { draw, dispose, group };
}
