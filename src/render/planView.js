import * as THREE from 'three';
import { estimatePlan, positionAt } from '../plan/estimate.js';
import { TEAM_COLORS } from './soldierView.js';

const RUN_COLOR = 0xffa64d;
const BLOCKED_COLOR = 0xff4d4d;
const LOOK_COLOR = 0xc28bff;
const SELECTED_COLOR = 0xffd34d;
const GRENADE_COLOR = { frag: 0xff6a4d, flash: 0xe8f4ff, smoke: 0xb8bcc2 };
const DANGER_COLOR = 0xff2d2d;
const BOUNCE_COLOR = 0xffb02e;
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

/**
 * Grenade predictions for one team's plans: where each planned grenade flies,
 * bounces and goes off, and which of the team's own soldiers would be caught.
 * @returns Map soldierId → [{ wpIndex, kind, path, bounces, burst, radius, at, danger: soldierId[] }]
 */
function predictGrenades(plans, estimates, predictor) {
  const out = new Map();
  for (const plan of plans) {
    const est = estimates.get(plan.soldierId);
    const list = [];
    plan.waypoints.forEach((wp, i) => {
      let k = 0;
      for (const a of wp.actions) {
        if (a.type !== 'grenade') continue;
        const at = est.marks[i]?.booms[k++]?.at ?? Infinity;
        if (!Number.isFinite(est.marks[i]?.arrive)) continue;
        const pred = predictor.predict(wp, a, a.kind);
        const danger = plans
          .filter((p) => p.team === plan.team)
          .filter((p) => predictor.reaches(pred.burst, a.kind, positionAt(estimates.get(p.soldierId), at), p.start.stance))
          .map((p) => p.soldierId);
        list.push({ wpIndex: i, kind: a.kind, ...pred, at, danger });
      }
    });
    out.set(plan.soldierId, list);
  }
  return out;
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
   * @param plans [{ soldierId, team, start:{x,z,stance}, waypoints, editable, released? }] (released: go codes)
   * @param selected { soldierId, index } | null
   * @param predictor from plan/grenadePath.js (its `id` changes when the map state does), or null
   * @returns Map soldierId → estimate (plus `.grenades`, see predictGrenades)
   */
  function setPlans(map, plans, selected, closedDoors = null, predictor = null) {
    const key = JSON.stringify([plans, selected, closedDoors && [...closedDoors], predictor?.id]);
    if (key === builtKey) return lastEstimates;
    builtKey = key;
    clear();
    lastEstimates = new Map();
    for (const plan of plans) lastEstimates.set(plan.soldierId, estimatePlan(map, plan.start, plan.waypoints, closedDoors, plan.released ?? []));
    const grenades = predictor ? predictGrenades(plans, lastEstimates, predictor) : new Map();

    for (const plan of plans) {
      const est = lastEstimates.get(plan.soldierId);
      est.grenades = grenades.get(plan.soldierId) ?? [];
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
          } else if (a.type === 'breach') {
            const charge = new THREE.Mesh(
              new THREE.RingGeometry(0.25, 0.45, 4),
              new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.9, depthWrite: false }),
            );
            charge.rotation.x = -Math.PI / 2;
            charge.position.set(a.x, 1.2, a.z);
            group.add(charge, line([v(wp, 0.5), v(a, 1.2)], 0xff3b30, 0.8, true));
          }
        }
      });

      // Predicted grenade flights: the real arc, a marker at each wall bounce, the blast where it goes off.
      for (const gr of est.grenades) {
        const color = GRENADE_COLOR[gr.kind] ?? GRENADE_COLOR.frag;
        const hurtsUs = gr.danger.length > 0;
        group.add(line(gr.path.map((p) => new THREE.Vector3(p.x, Math.max(p.y, 0.08), p.z)), hurtsUs ? DANGER_COLOR : color, 0.95));
        for (const b of gr.bounces) {
          const mark = new THREE.Mesh(
            new THREE.RingGeometry(0.12, 0.26, 16),
            new THREE.MeshBasicMaterial({ color: BOUNCE_COLOR, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
          );
          mark.rotation.x = -Math.PI / 2;
          mark.position.set(b.x, 0.6, b.z);
          group.add(mark);
        }
        const blast = new THREE.Mesh(
          new THREE.RingGeometry(gr.radius - (hurtsUs ? 0.2 : 0.08), gr.radius, 48),
          new THREE.MeshBasicMaterial({ color: hurtsUs ? DANGER_COLOR : color, transparent: true, opacity: hurtsUs ? 0.8 : 0.35, depthWrite: false }),
        );
        blast.rotation.x = -Math.PI / 2;
        blast.position.set(gr.burst.x, 0.04, gr.burst.z);
        group.add(blast);
      }

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
