import * as THREE from 'three';

const MIN_DIST = 6;
const MAX_DIST = 90;
const MIN_PITCH = THREE.MathUtils.degToRad(35);
const MAX_PITCH = THREE.MathUtils.degToRad(85);

/**
 * Tactical camera: orbits a ground target. yaw rotates around the vertical axis,
 * pitch is the angle above the horizon, distance is zoom.
 */
export function createCameraRig(camera, { bounds = 20, distance = 26, focus = { x: 0, z: 0 }, yaw = 0 } = {}) {
  const home = { x: focus.x, z: focus.z, distance, yaw, pitch: THREE.MathUtils.degToRad(62) };
  const s = { ...home };
  const raycaster = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  let viewW = 1;
  let viewH = 1;

  function apply() {
    s.distance = THREE.MathUtils.clamp(s.distance, MIN_DIST, MAX_DIST);
    s.pitch = THREE.MathUtils.clamp(s.pitch, MIN_PITCH, MAX_PITCH);
    s.x = THREE.MathUtils.clamp(s.x, -bounds, bounds);
    s.z = THREE.MathUtils.clamp(s.z, -bounds, bounds);
    const h = s.distance * Math.cos(s.pitch);
    camera.position.set(s.x + Math.sin(s.yaw) * h, s.distance * Math.sin(s.pitch), s.z + Math.cos(s.yaw) * h);
    camera.lookAt(s.x, 0, s.z);
    camera.updateMatrixWorld();
  }

  /** World point on the ground under a screen pixel, or null if looking at the sky. */
  function groundAt(sx, sy) {
    ndc.set((sx / viewW) * 2 - 1, -(sy / viewH) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(ground, hit) ? hit.clone() : null;
  }

  /** Content follows the finger: drag right → map moves right. */
  function pan(dx, dy) {
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
    s.yaw += dYaw;
    apply();
  }

  function orbit(dx, dy) {
    s.yaw -= dx * 0.008;
    s.pitch += dy * 0.006;
    apply();
  }

  function setViewport(w, h) {
    viewW = w;
    viewH = h;
    apply();
  }

  /** Zoom so a map `width` metres wide fits across the screen (portrait phones need this). */
  function fitWidth(width) {
    const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * (viewW / viewH));
    s.distance = (width / 2 + 1) / Math.tan(hHalf);
    home.distance = s.distance;
    apply();
  }

  /** Centre the view on a ground point, keeping zoom and rotation. */
  function focusOn(x, z) {
    s.x = x;
    s.z = z;
    apply();
  }

  function reset() {
    Object.assign(s, home);
    apply();
  }

  apply();
  return { state: s, pan, zoom, rotate, orbit, groundAt, setViewport, reset, apply, focusOn, fitWidth };
}
