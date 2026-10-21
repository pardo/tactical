import { DT } from './sim/constants.js';

/**
 * Fixed-timestep driver. Wall-clock time lives here, never in the sim.
 * update() runs at exactly TICK_RATE; render(alpha) gets the interpolation factor.
 */
export function startLoop({ update, render }) {
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    acc += Math.min((now - last) / 1000, 0.25);
    last = now;
    while (acc >= DT) {
      update();
      acc -= DT;
    }
    render(acc / DT);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
