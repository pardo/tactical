import { initPhysics } from './sim/physics.js';
import { createWorld, step, hashWorld } from './sim/world.js';
import { spawnDemoBoxes } from './sim/demo.js';
import { TURN_TICKS } from './sim/constants.js';
import { createScene } from './render/scene.js';
import { createEntityView } from './render/entities.js';
import { createCameraRig } from './render/cameraRig.js';
import { createTapMarker } from './render/marker.js';
import { attachGestures } from './ui/gestures.js';
import { createKeyboard } from './ui/keyboard.js';
import { startLoop } from './loop.js';

await initPhysics();

const world = createWorld(1234);
spawnDemoBoxes(world);

const app = document.getElementById('app');
const view = createScene(app);
const rig = createCameraRig(view.camera);
view.onResize((w, h) => rig.setViewport(w, h));
const entities = createEntityView(view.scene);
const marker = createTapMarker(view.scene);
const keyboard = createKeyboard();
const hud = document.getElementById('hud');
entities.sync(world);

let lastAction = '';
attachGestures(app, {
  onPan: (dx, dy) => rig.pan(dx, dy),
  onOrbit: (dx, dy) => rig.orbit(dx, dy),
  onPinch: (scale, cx, cy) => rig.zoom(scale, cx, cy),
  onTwist: (da) => rig.rotate(da),
  onWheel: (deltaY, x, y) => rig.zoom(Math.exp(-deltaY * 0.0015), x, y),
  onTap: ({ x, y, pointerType }) => {
    const p = rig.groundAt(x, y);
    if (!p) return;
    marker.show(p);
    lastAction = `${pointerType} tap @ ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`;
  },
  onLongPress: ({ x, y, pointerType }) => {
    const p = rig.groundAt(x, y);
    if (!p) return;
    marker.show(p, 0xffb347);
    navigator.vibrate?.(15);
    lastAction = `${pointerType} long-press @ ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`;
  },
});

document.getElementById('btn-reset').addEventListener('click', () => rig.reset());
const fsButton = document.getElementById('btn-fullscreen');
if (!document.fullscreenEnabled) fsButton.hidden = true; // iPhone Safari: use "Add to Home Screen" instead
fsButton.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
});

const coarse = matchMedia('(pointer: coarse)').matches;
document.getElementById('help').textContent = coarse
  ? 'Drag: pan · Pinch: zoom · Twist: rotate · Tap / hold: select'
  : 'Drag / WASD: pan · Wheel / +−: zoom · Right-drag / Q E: rotate · Click / hold: select';

let lastFrame = performance.now();
let finalHash = '';
startLoop({
  update() {
    if (world.tick >= TURN_TICKS) return; // one 5 s "turn", then freeze
    step(world);
    entities.sync(world);
    if (world.tick === TURN_TICKS) finalHash = hashWorld(world);
  },
  render(alpha) {
    const now = performance.now();
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    keyboard.update(rig, dt);
    marker.update(dt);
    entities.draw(world.tick >= TURN_TICKS ? 1 : alpha);
    view.render();
    hud.textContent = `tick ${world.tick}/${TURN_TICKS}${finalHash ? `\nhash ${finalHash}` : ''}${lastAction ? `\n${lastAction}` : ''}`;
  },
});
