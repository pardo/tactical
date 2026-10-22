import * as THREE from 'three';

export function createScene(container) {
  // Browser tests set this to skip the WebGL draw: scene, camera and HUD still update, but
  // software GL (llvmpipe) no longer eats the CPU and slows the fixed-step loop down.
  const noDraw = import.meta.env.DEV && (window.__noDraw || new URLSearchParams(location.search).has('nodraw'));
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    stencil: true, // vision cones and fog of war use the stencil buffer
    powerPreference: 'high-performance',
    // ?capture keeps the frame buffer so headless browsers can screenshot the canvas.
    preserveDrawingBuffer: new URLSearchParams(location.search).has('capture'),
  });
  // Phones report DPR 3+; capping at 2 keeps fill-rate sane with little visible loss.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14171b);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);

  // Cool sky fill + warm low-ish sun for long, readable shadows; a weak cool rim from the opposite side.
  scene.add(new THREE.HemisphereLight(0xc4d6f5, 0x3b3328, 1.35));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
  sun.position.set(10, 22, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x8fb0ff, 0.45);
  rim.position.set(-12, 10, -9);
  scene.add(rim);

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

  /** True when WebGL runs on a CPU rasterizer (llvmpipe, SwiftShader): pick Low graphics by default. */
  function softwareGL() {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    return /llvmpipe|swiftshader|software|softpipe/i.test(name);
  }

  /**
   * 'high': up to 2× pixel ratio, soft shadows. 'low': 1× pixels, no shadows — most of the
   * cost on weak GPUs is fill rate.
   */
  function setQuality(q) {
    const high = q !== 'low';
    renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio, 2) : 1);
    if (renderer.shadowMap.enabled !== high) {
      renderer.shadowMap.enabled = high;
      // Shadow support is compiled into the shaders.
      scene.traverse((o) => {
        for (const m of [].concat(o.material ?? [])) m.needsUpdate = true;
      });
    }
    resize();
  }

  return {
    renderer,
    scene,
    camera,
    softwareGL,
    setQuality,
    onResize(fn) {
      resizeHandlers.push(fn);
      resize();
    },
    setShadowBounds,
    render: () => noDraw || renderer.render(scene, camera),
  };
}
