/** Held-key state for desktop camera control (WASD/arrows pan, Q/E rotate, +/- zoom). */
export function createKeyboard() {
  const down = new Set();
  window.addEventListener('keydown', (e) => down.add(e.code));
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => down.clear());
  const has = (...codes) => codes.some((c) => down.has(c));

  /** Apply held keys to the camera rig; dt in seconds. */
  function update(rig, dt) {
    const px = 600 * dt;
    let dx = 0;
    let dy = 0;
    if (has('KeyA', 'ArrowLeft')) dx += px;
    if (has('KeyD', 'ArrowRight')) dx -= px;
    if (has('KeyW', 'ArrowUp')) dy += px;
    if (has('KeyS', 'ArrowDown')) dy -= px;
    if (dx || dy) rig.pan(dx, dy);
    if (has('KeyQ')) rig.rotate(-1.8 * dt);
    if (has('KeyE')) rig.rotate(1.8 * dt);
    if (has('Equal', 'NumpadAdd')) rig.zoom(1 + 1.5 * dt);
    if (has('Minus', 'NumpadSubtract')) rig.zoom(1 / (1 + 1.5 * dt));
  }

  return { update };
}
