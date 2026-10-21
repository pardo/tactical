import { describe, expect, it, vi } from 'vitest';
import { GestureTracker, LONG_PRESS_MS } from '../src/ui/gestures.js';

function setup() {
  const h = {
    onTap: vi.fn(),
    onLongPress: vi.fn(),
    onPan: vi.fn(),
    onOrbit: vi.fn(),
    onPinch: vi.fn(),
    onTwist: vi.fn(),
  };
  return { h, g: new GestureTracker(h) };
}
const touch = (id, x, y, t = 0) => ({ id, x, y, t, button: 0, pointerType: 'touch' });

describe('GestureTracker', () => {
  it('tap: press and release in place', () => {
    const { h, g } = setup();
    g.down(touch(1, 100, 100));
    g.move(touch(1, 103, 102));
    g.up(touch(1, 103, 102));
    expect(h.onTap).toHaveBeenCalledOnce();
    expect(h.onPan).not.toHaveBeenCalled();
  });

  it('drag beyond slop pans and suppresses tap', () => {
    const { h, g } = setup();
    g.down(touch(1, 100, 100));
    g.move(touch(1, 130, 100));
    g.move(touch(1, 140, 110));
    g.up(touch(1, 140, 110));
    expect(h.onTap).not.toHaveBeenCalled();
    expect(h.onPan).toHaveBeenLastCalledWith(10, 10);
  });

  it('long press fires once and suppresses tap', () => {
    const { h, g } = setup();
    g.down(touch(1, 50, 50, 0));
    g.checkLongPress(LONG_PRESS_MS - 1);
    expect(h.onLongPress).not.toHaveBeenCalled();
    g.checkLongPress(LONG_PRESS_MS);
    g.checkLongPress(LONG_PRESS_MS + 100);
    g.up(touch(1, 50, 50));
    expect(h.onLongPress).toHaveBeenCalledOnce();
    expect(h.onTap).not.toHaveBeenCalled();
  });

  it('two fingers spreading pinches in, no tap', () => {
    const { h, g } = setup();
    g.down(touch(1, 100, 100));
    g.down(touch(2, 200, 100));
    g.move(touch(2, 300, 100));
    g.up(touch(1, 100, 100));
    g.up(touch(2, 300, 100));
    const [scale] = h.onPinch.mock.calls[0];
    expect(scale).toBeCloseTo(2);
    expect(h.onTap).not.toHaveBeenCalled();
  });

  it('two fingers rotating clockwise on screen gives positive twist', () => {
    const { h, g } = setup();
    g.down(touch(1, 100, 100));
    g.down(touch(2, 200, 100));
    g.move(touch(2, 200, 150)); // second finger moves down → clockwise (y is down)
    expect(h.onTwist.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it('right mouse drag orbits instead of panning', () => {
    const { h, g } = setup();
    g.down({ id: 1, x: 0, y: 0, t: 0, button: 2, pointerType: 'mouse' });
    g.move({ id: 1, x: 20, y: 0 });
    g.move({ id: 1, x: 25, y: 0 });
    expect(h.onOrbit).toHaveBeenLastCalledWith(5, 0);
    expect(h.onPan).not.toHaveBeenCalled();
  });

  it('lifting one of two fingers keeps panning with the other', () => {
    const { h, g } = setup();
    g.down(touch(1, 100, 100));
    g.down(touch(2, 200, 100));
    g.up(touch(2, 200, 100));
    g.move(touch(1, 110, 100));
    g.up(touch(1, 110, 100));
    expect(h.onPan).toHaveBeenLastCalledWith(10, 0);
    expect(h.onTap).not.toHaveBeenCalled();
  });
});
