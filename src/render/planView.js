import * as THREE from 'three';
import { estimatePlan } from '../plan/estimate.js';
import { GRENADE, GRENADE_RANGE } from '../sim/grenades.js';
import { TEAM_COLORS } from './soldierView.js';

const RUN_COLOR = 0xffa64d;
const BLOCKED_COLOR = 0xff4d4d;
const LOOK_COLOR = 0xc28bff;
const SELECTED_COLOR = 0xffd34d;
const GRENADE_COLOR = { frag: 0xff6a4d, flash: 0xe8f4ff, smoke: 0xb8bcc2 };
const Y = 0.06;

const v = (p, y = Y) => new THREE.Vector3(p.x, y, p.z);

function line(points, color, opacity = 0.9, dashed = false) {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.25, gapSize: 0.18 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const l = new THREE.Line(geo, mat);
  if (dashed) l.computeLineDistances();
  l.frustumCulled = false;
  return l;
}

function arc(from, to, height = 2.2, n = 16) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(new THREE.Vector3(from.x + (to.x - from.x) * t, 1.2 + 4 * height * t * (1 - t) - 1.1 * t, from.z + (to.z - from.z) * t));
  }
  return pts;
}

/**
 * Draws soldiers' plans: route (walk / run / unreachable), waypoint handles,
 * look and face directions, grenade arcs with blast radius, and a marker for
 * where the soldier will be when the 5 s turn ends. Also does waypoint picking.
 */
export function createPlanView(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const discGeo = new THREE.CircleGeometry(0.32, 24);
  const handles = []; // { mesh, soldierId, index }
  const v3 = new THREE.Vector3();
  let builtKey = '';
  let lastEstimates = new Map();

  function clear() {
    for (const child of [...group.children]) {
      group.remove(child);
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
    handles.length = 0;
  }

  /**
   * @param map sim map
   * @param plans [{ soldierId, team, start:{x,z,stance}, waypoints, editable }]
   * @param selected { soldierId, index } | null
   */
  function setPlans(map, plans, selected) {
    const key = JSON.stringify([plans, selected]);
    if (key === builtKey) return lastEstimates;
    builtKey = key;
    clear();
    lastEstimates = new Map();

    for (const plan of plans) {
      const est = estimatePlan(map, plan.start, plan.waypoints);
      lastEstimates.set(plan.soldierId, est);
      const teamColor = TEAM_COLORS[plan.team];
      const isSelSoldier = selected?.soldierId === plan.soldierId;
      const opacity = plan.editable && !isSelSoldier ? 0.55 : 0.95;

      est.legs.forEach((leg) => {
        const color = leg.blocked ? BLOCKED_COLOR : leg.move === 'run' ? RUN_COLOR : teamColor;
        group.add(line(leg.points.map((p) => v(p)), color, opacity, leg.move === 'run'));
      });

      plan.waypoints.forEach((wp, i) => {
        const sel = isSelSoldier && selected.index === i;
        const disc = new THREE.Mesh(
          discGeo,
          new THREE.MeshBasicMaterial({ color: sel ? SELECTED_COLOR : teamColor, transparent: true, opacity: 0.85, depthWrite: false }),
        );
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(wp.x, Y + 0.01, wp.z);
        disc.userData.baseScale = sel ? 1.3 : 1;
        group.add(disc);
        if (plan.editable) handles.push({ mesh: disc, soldierId: plan.soldierId, index: i });

        if (wp.look) {
          group.add(line([v(wp, 0.5), v(wp.look, 0.5)], LOOK_COLOR, 0.7, true));
        }
        for (const a of wp.actions) {
          if (a.type === 'face') {
            const dir = new THREE.Vector3(a.x - wp.x, 0, a.z - wp.z);
            if (dir.lengthSq() > 1e-6) {
              const arrow = new THREE.ArrowHelper(dir.normalize(), v(wp, 0.15), 1.4, 0xffffff, 0.4, 0.3);
              group.add(arrow);
            }
          } else if (a.type === 'grenade') {
            const d = Math.hypot(a.x - wp.x, a.z - wp.z);
            const k = d > GRENADE_RANGE ? GRENADE_RANGE / d : 1;
            const land = { x: wp.x + (a.x - wp.x) * k, z: wp.z + (a.z - wp.z) * k };
            const color = GRENADE_COLOR[a.kind] ?? GRENADE_COLOR.frag;
            const radius = (GRENADE[a.kind] ?? GRENADE.frag).radius;
            group.add(line(arc(wp, land), color, 0.9));
            const blast = new THREE.Mesh(
              new THREE.RingGeometry(radius - 0.08, radius, 48),
              new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }),
            );
            blast.rotation.x = -Math.PI / 2;
            blast.position.set(land.x, 0.04, land.z);
            group.add(blast);
          }
        }
      });

      if (est.atTurnEnd) {
        const tick = new THREE.Mesh(
          new THREE.RingGeometry(0.18, 0.28, 20),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
        );
        tick.rotation.x = -Math.PI / 2;
        tick.position.set(est.atTurnEnd.x, Y + 0.02, est.atTurnEnd.z);
        group.add(tick);
      }
    }
    return lastEstimates;
  }

  /** Keep waypoint handles a usable size on screen at any zoom. */
  function update(cameraDistance) {
    const s = Math.max(1, cameraDistance / 22);
    for (const h of handles) h.mesh.scale.setScalar(s * h.mesh.userData.baseScale);
  }

  function pickWaypoint(camera, sx, sy, width, height, radiusPx = 32) {
    let best = null;
    let bestD = radiusPx;
    for (const h of handles) {
      v3.copy(h.mesh.position).project(camera);
      const d = Math.hypot(((v3.x + 1) / 2) * width - sx, ((1 - v3.y) / 2) * height - sy);
      if (d < bestD) {
        bestD = d;
        best = { soldierId: h.soldierId, index: h.index };
      }
    }
    return best;
  }

  function hide() {
    if (builtKey === '') return;
    builtKey = '';
    clear();
    lastEstimates = new Map();
  }

  return { setPlans, update, pickWaypoint, hide, get estimates() { return lastEstimates; } };
}
