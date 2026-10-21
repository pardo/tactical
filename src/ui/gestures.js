/**
 * Unified mouse + touch + pen gestures on top of Pointer Events.
 *
 * GestureTracker is DOM-free (fed plain objects) so it can be unit tested;
 * attachGestures() wires it to an element.
 *
 * Emitted handlers (all optional):
 *   onTap({x, y, pointerType})        short press without moving
 *   onLongPress({x, y, pointerType})  press held still for LONG_PRESS_MS
 *   onPan(dx, dy)                     1 finger / left or middle mouse drag; 2-finger midpoint drag
 *   onOrbit(dx, dy)                   right mouse drag
 *   onPinch(scale, cx, cy)            2 fingers, scale > 1 = fingers spreading
 *   onTwist(dAngle)                   2 fingers rotating, radians, clockwise on screen > 0
 *   onWheel(deltaY, x, y)
 *   onDragStart({x, y}) → boolean   one-pointer drag began at (x, y); return true to claim it
 *                                   (e.g. it started on a waypoint) instead of panning
 *   onDrag({x, y}), onDragEnd({x, y})
 */
export const TAP_SLOP_PX = 10;
export const LONG_PRESS_MS = 450;

export class GestureTracker {
  constructor(handlers) {
    this.h = handlers;
    this.pointers = new Map();
    this.primary = null;
    this.pair = null;
  }

  down({ id, x, y, t, button = 0, pointerType = 'mouse' }) {
    this.pointers.set(id, { x, y });
    if (this.pointers.size === 1) {
      this.primary = { id, x0: x, y0: y, t0: t, button, pointerType, moved: false, tapEligible: true };
    } else {
      // A second finger turns this into a pinch/twist; the first finger can no longer tap or drag.
      if (this.primary) {
        this.primary.tapEligible = false;
        if (this.primary.dragging) {
          this.primary.dragging = false;
          const p = this.pointers.get(this.primary.id);
          this.h.onDragEnd?.({ x: p.x, y: p.y });
        }
      }
      this.pair = this.#pairState();
    }
  }

  move({ id, x, y }) {
    const p = this.pointers.get(id);
    if (!p) return;
    const dx = x - p.x;
    const dy = y - p.y;
    p.x = x;
    p.y = y;

    if (this.pointers.size >= 2) {
      const next = this.#pairState();
      const prev = this.pair;
      this.pair = next;
      if (!prev || !next) return;
      this.h.onPan?.(next.cx - prev.cx, next.cy - prev.cy);
      if (prev.dist > 0) this.h.onPinch?.(next.dist / prev.dist, next.cx, next.cy);
      this.h.onTwist?.(wrapAngle(next.angle - prev.angle));
      return;
    }

    const pr = this.primary;
    if (!pr || pr.id !== id) return;
    if (!pr.moved && Math.hypot(x - pr.x0, y - pr.y0) > TAP_SLOP_PX) {
      pr.moved = true;
      pr.tapEligible = false;
      if (pr.button !== 2 && !pr.longPressed) pr.dragging = !!this.h.onDragStart?.({ x: pr.x0, y: pr.y0 });
    }
    if (!pr.moved || pr.longPressed) return;
    if (pr.dragging) this.h.onDrag?.({ x, y });
    else if (pr.button === 2) this.h.onOrbit?.(dx, dy);
    else this.h.onPan?.(dx, dy);
  }

  up({ id, x, y }) {
    if (!this.pointers.has(id)) return;
    const pr = this.primary;
    if (this.pointers.size === 1 && pr?.id === id && pr.tapEligible && !pr.longPressed) {
      this.h.onTap?.({ x, y, pointerType: pr.pointerType });
    }
    if (pr?.id === id && pr.dragging) this.h.onDragEnd?.({ x, y });
    this.pointers.delete(id);

    if (this.pointers.size === 1) {
      // Lifting one of two fingers: keep panning with the remaining one, no tap.
      const [rid, rp] = [...this.pointers][0];
      this.primary = { id: rid, x0: rp.x, y0: rp.y, t0: 0, button: 0, pointerType: 'touch', moved: true, tapEligible: false };
      this.pair = null;
    } else if (this.pointers.size === 0) {
      this.primary = null;
      this.pair = null;
    } else {
      this.pair = this.#pairState();
    }
  }

  cancel({ id }) {
    if (this.primary?.id === id) this.primary.tapEligible = false;
    this.up({ id, x: 0, y: 0 });
  }

  /** Call periodically (or from a timer) with the current time in ms. */
  checkLongPress(t) {
    const pr = this.primary;
    if (!pr || !pr.tapEligible || pr.longPressed || this.pointers.size !== 1) return;
    if (t - pr.t0 < LONG_PRESS_MS) return;
    pr.longPressed = true;
    pr.tapEligible = false;
    const p = this.pointers.get(pr.id);
    this.h.onLongPress?.({ x: p.x, y: p.y, pointerType: pr.pointerType });
  }

  #pairState() {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return null;
    return {
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }
}

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function attachGestures(el, handlers) {
  const tracker = new GestureTracker(handlers);
  const local = (e) => {
    const r = el.getBoundingClientRect();
    return { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp, button: e.button, pointerType: e.pointerType };
  };
  let timer = 0;

  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    tracker.down(local(e));
    clearTimeout(timer);
    timer = setTimeout(() => tracker.checkLongPress(performance.now()), LONG_PRESS_MS + 10);
  });
  el.addEventListener('pointermove', (e) => tracker.move(local(e)));
  el.addEventListener('pointerup', (e) => tracker.up(local(e)));
  el.addEventListener('pointercancel', (e) => tracker.cancel(local(e)));
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = local(e);
      handlers.onWheel?.(e.deltaY, p.x, p.y);
    },
    { passive: false },
  );
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  // iOS Safari still fires its own pinch-zoom gestures despite the viewport meta.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault());
  }
  return tracker;
}
