import * as THREE from 'three';

const MIN_DIST = 6;
const MAX_DIST = 90;
const MIN_PITCH = THREE.MathUtils.degToRad(35);
const MAX_PITCH = THREE.MathUtils.degToRad(85);
/** Glide speed: fraction of the remaining distance covered per second is 1 - e^-RATE. */
const GLIDE_RATE = 7;
const KEYS = ['x', 'z', 'distance', 'yaw', 'pitch'];

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Tactical camera: orbits a ground target. yaw rotates around the vertical axis,
 * pitch is the angle above the horizon, distance is zoom.
 *
 * Finger/mouse gestures move the camera immediately (content sticks to the finger);
 * programmatic moves (focus, reset, framing a team, follow cam) glide there over a
 * few hundred ms via update(dt). Any gesture cancels a glide and marks `userMoved`.
 *
 * @param bounds half-extent of the area the target may move in: a number or { x, z }
 */
export function createCameraRig(camera, { bounds = 20, distance = 26, focus = { x: 0, z: 0 }, yaw = 0 } = {}) {
  const home = { x: focus.x, z: focus.z, distance, yaw, pitch: THREE.MathUtils.degToRad(62) };
  const s = { ...home };
  const bx = typeof bounds === 'number' ? bounds : bounds.x;
  const bz = typeof bounds === 'number' ? bounds : bounds.z;
  const raycaster = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  let viewW = 1;
  let viewH = 1;
  /** Glide target (partial camera state) and its speed, or null. */
  let goal = null;
  let goalRate = GLIDE_RATE;
  const rig = { userMoved: false };

  function clampState(o) {
    if (o.distance !== undefined) o.distance = THREE.MathUtils.clamp(o.distance, MIN_DIST, MAX_DIST);
    if (o.pitch !== undefined) o.pitch = THREE.MathUtils.clamp(o.pitch, MIN_PITCH, MAX_PITCH);
    if (o.x !== undefined) o.x = THREE.MathUtils.clamp(o.x, -bx, bx);
    if (o.z !== undefined) o.z = THREE.MathUtils.clamp(o.z, -bz, bz);
  }

  function apply() {
    clampState(s);
    const h = s.distance * Math.cos(s.pitch);
    camera.position.set(s.x + Math.sin(s.yaw) * h, s.distance * Math.sin(s.pitch), s.z + Math.cos(s.yaw) * h);
    camera.lookAt(s.x, 0, s.z);
    camera.updateMatrixWorld();
  }

  /** User input: stop any glide so the camera never fights the finger. */
  function manual() {
    goal = null;
    rig.userMoved = true;
  }

  /** World point on the ground under a screen pixel, or null if looking at the sky. */
  function groundAt(sx, sy) {
    ndc.set((sx / viewW) * 2 - 1, -(sy / viewH) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(ground, hit) ? hit.clone() : null;
  }

  /** Content follows the finger: drag right → map moves right. */
  function pan(dx, dy) {
    manual();
    const worldPerPx = (2 * s.distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / viewH;
    const rx = Math.cos(s.yaw);
    const rz = -Math.sin(s.yaw);
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    // Screen-vertical drags cover more ground the flatter the camera is.
    const k = worldPerPx;
    const kv = worldPerPx / Math.sin(s.pitch);
    s.x += -rx * dx * k + fx * dy * kv;
    s.z += -rz * dx * k + fz * dy * kv;
    apply();
  }

  /** Zoom keeping the ground point under (sx, sy) fixed — feels natural for pinch and wheel. */
  function zoom(factor, sx = viewW / 2, sy = viewH / 2) {
    manual();
    const before = groundAt(sx, sy);
    s.distance /= factor;
    apply();
    const after = groundAt(sx, sy);
    if (before && after) {
      s.x += before.x - after.x;
      s.z += before.z - after.z;
      apply();
    }
  }

  function rotate(dYaw) {
    manual();
    s.yaw += dYaw;
    apply();
  }

  function orbit(dx, dy) {
    manual();
    s.yaw -= dx * 0.008;
    s.pitch += dy * 0.006;
    apply();
  }

  function setViewport(w, h) {
    viewW = w;
    viewH = h;
    apply();
  }

  /** Distance at which a ground strip `width` metres wide fits across the screen. */
  function distanceForWidth(width) {
    const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * (viewW / viewH));
    return (width / 2 + 1) / Math.tan(hHalf);
  }

  /** Zoom so a map `width` metres wide fits across the screen (portrait phones need this). */
  function fitWidth(width) {
    s.distance = home.distance = distanceForWidth(width);
    apply();
  }

  /**
   * Glide toward a partial camera state. `rate` sets the speed (higher = snappier);
   * `instant` jumps there. Yaw takes the short way round.
   */
  function glideTo(target, { rate = GLIDE_RATE, instant = false } = {}) {
    const t = { ...target };
    clampState(t);
    if (t.yaw !== undefined) t.yaw = s.yaw + wrapAngle(t.yaw - s.yaw);
    if (instant) {
      Object.assign(s, t);
      goal = null;
      apply();
      return;
    }
    goal = t;
    goalRate = rate;
  }

  /** Advance a glide; call once per rendered frame. */
  function update(dt) {
    if (!goal) return;
    const k = 1 - Math.exp(-goalRate * Math.min(dt, 0.1));
    let done = true;
    for (const key of KEYS) {
      if (goal[key] === undefined) continue;
      const d = goal[key] - s[key];
      const eps = key === 'yaw' || key === 'pitch' ? 1e-4 : 1e-3;
      if (Math.abs(d) <= eps) s[key] = goal[key];
      else {
        s[key] += d * k;
        done = false;
      }
    }
    if (done) goal = null;
    apply();
  }

  /** Centre the view on a ground point, keeping zoom and rotation. */
  function focusOn(x, z, opts) {
    glideTo({ x, z }, opts);
  }

  function reset(opts) {
    rig.userMoved = false;
    glideTo(home, opts);
  }

  /** Make the current target the new home (what reset returns to). */
  function setHome(partial) {
    Object.assign(home, partial);
    clampState(home);
  }

  apply();
  return Object.assign(rig, {
    state: s,
    pan,
    zoom,
    rotate,
    orbit,
    groundAt,
    setViewport,
    reset,
    apply,
    focusOn,
    fitWidth,
    distanceForWidth,
    glideTo,
    update,
    setHome,
    gliding: () => goal !== null,
  });
}
