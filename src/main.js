import { initPhysics } from './sim/physics.js';
import { createWorld, step, hashWorld } from './sim/world.js';
import { spawnDemoBoxes } from './sim/demo.js';
import { TURN_TICKS } from './sim/constants.js';
import { createScene } from './render/scene.js';
import { createEntityView } from './render/entities.js';
import { startLoop } from './loop.js';

await initPhysics();

const world = createWorld(1234);
spawnDemoBoxes(world);

const view = createScene(document.getElementById('app'));
const entities = createEntityView(view.scene);
const hud = document.getElementById('hud');
entities.sync(world);

startLoop({
  update() {
    if (world.tick >= TURN_TICKS) return; // one 5 s "turn", then freeze
    step(world);
    entities.sync(world);
    if (world.tick === TURN_TICKS) hud.textContent += `\nfinal hash ${hashWorld(world)}`;
  },
  render(alpha) {
    entities.draw(world.tick >= TURN_TICKS ? 1 : alpha);
    view.render();
    hud.firstChild ? (hud.firstChild.textContent = `tick ${world.tick}/${TURN_TICKS}`) : (hud.textContent = `tick ${world.tick}`);
  },
});
