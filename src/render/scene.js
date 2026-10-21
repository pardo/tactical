import * as THREE from 'three';

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  // Phones report DPR 3+; capping at 2 keeps fill-rate sane with little visible loss.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1d21);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);

  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x30302a, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(8, 20, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  /** Fit the shadow camera to the playable area. */
  function setShadowBounds(halfSize) {
    const c = sun.shadow.camera;
    c.left = c.bottom = -halfSize;
    c.right = c.top = halfSize;
    c.updateProjectionMatrix();
  }

  const resizeHandlers = [];
  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    // Portrait phones: widen the vertical FOV so the map isn't cropped to a sliver.
    camera.fov = w < h ? 60 : 45;
    camera.updateProjectionMatrix();
    for (const fn of resizeHandlers) fn(w, h);
  }
  // ResizeObserver also catches orientation changes and mobile URL-bar show/hide.
  new ResizeObserver(resize).observe(container);

  return {
    renderer,
    scene,
    camera,
    onResize(fn) {
      resizeHandlers.push(fn);
      resize();
    },
    setShadowBounds,
    render: () => renderer.render(scene, camera),
  };
}
