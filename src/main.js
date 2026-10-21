import { initPhysics } from './sim/physics.js';
import { createWorld, spawnSquads, step } from './sim/world.js';
import { parseMap } from './sim/map.js';
import { commandMove } from './sim/commands.js';
import { TICK_RATE } from './sim/constants.js';
import killhouse from './maps/killhouse.js';
import { createScene } from './render/scene.js';
import { createMapView } from './render/mapView.js';
import { createSoldierView } from './render/soldierView.js';
import { createCameraRig } from './render/cameraRig.js';
import { createTapMarker } from './render/marker.js';
import { attachGestures } from './ui/gestures.js';
import { createKeyboard } from './ui/keyboard.js';
import { startLoop } from './loop.js';

await initPhysics();

const map = parseMap(killhouse);
const world = createWorld(1234, map);
spawnSquads(world);

const app = document.getElementById('app');
const view = createScene(app);
const half = Math.max(map.width, map.height) / 2;
view.setShadowBounds(half + 2);
const rig = createCameraRig(view.camera, { bounds: half, distance: map.width * 0.75 });
let viewW = 1;
let viewH = 1;
view.onResize((w, h) => {
  viewW = w;
  viewH = h;
  rig.setViewport(w, h);
});
createMapView(view.scene, map);
const soldiers = createSoldierView(view.scene);
const marker = createTapMarker(view.scene);
const keyboard = createKeyboard();
const hud = document.getElementById('hud');
soldiers.sync(world);

let selectedId = null;
let lastAction = '';

/** Shared by tap (walk) and long-press (run). */
function orderSelectedTo(x, y, mode) {
  const p = rig.groundAt(x, y);
  if (!p || selectedId === null) return;
  const ok = commandMove(world, selectedId, p.x, p.z, mode);
  marker.show(p, ok ? (mode === 'run' ? 0xffb347 : 0x5ad1ff) : 0xff4d4d);
  lastAction = ok ? `#${selectedId} ${mode} → ${p.x.toFixed(1)}, ${p.z.toFixed(1)}` : 'no path';
}

attachGestures(app, {
  onPan: (dx, dy) => rig.pan(dx, dy),
  onOrbit: (dx, dy) => rig.orbit(dx, dy),
  onPinch: (scale, cx, cy) => rig.zoom(scale, cx, cy),
  onTwist: (da) => rig.rotate(da),
  onWheel: (deltaY, x, y) => rig.zoom(Math.exp(-deltaY * 0.0015), x, y),
  onTap: ({ x, y }) => {
    const hit = soldiers.pick(view.camera, x, y, viewW, viewH);
    if (hit !== null) {
      selectedId = hit === selectedId ? null : hit;
      lastAction = selectedId === null ? '' : `selected #${selectedId}`;
      return;
    }
    orderSelectedTo(x, y, 'walk');
  },
  onLongPress: ({ x, y }) => {
    navigator.vibrate?.(15);
    orderSelectedTo(x, y, 'run');
  },
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') selectedId = null;
  const n = Number(e.key);
  if (n >= 1 && n <= 8) selectedId = world.soldiers[n - 1]?.id ?? selectedId;
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
  ? 'Tap soldier: select · Tap ground: walk · Hold: run · Drag/pinch/twist: camera'
  : 'Click soldier / 1–8: select · Click: walk · Hold: run · WASD, wheel, right-drag / QE: camera';

let lastFrame = performance.now();
startLoop({
  update() {
    step(world);
    soldiers.sync(world);
  },
  render(alpha) {
    const now = performance.now();
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    keyboard.update(rig, dt);
    marker.update(dt);
    soldiers.draw(alpha, selectedId);
    view.render();
    const sel = world.soldiers.find((s) => s.id === selectedId);
    hud.textContent =
      `${map.name} · t ${(world.tick / TICK_RATE).toFixed(1)}s` +
      (sel ? `\n#${sel.id} team ${sel.team} · ${sel.path.length ? sel.moveMode : 'idle'}` : '\nselect a soldier') +
      (lastAction ? `\n${lastAction}` : '');
  },
});
