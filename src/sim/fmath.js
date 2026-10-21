/**
 * Deterministic math for the sim.
 *
 * Math.sin/cos/atan2/hypot/exp/pow are NOT guaranteed bit-identical across JS
 * engines, which would desync lockstep multiplayer. These use only + - * / and
 * Math.sqrt/round/floor, which IEEE 754 makes exact everywhere.
 */
export const PI = Math.PI;
export const TAU = 2 * PI;
export const HALF_PI = PI / 2;

const S3 = -1 / 6;
const S5 = 1 / 120;
const S7 = -1 / 5040;
const S9 = 1 / 362880;
const S11 = -1 / 39916800;
const S13 = 1 / 6227020800;

/** Taylor series to x^13 after folding into [-π/2, π/2]; max error ≈ 6e-10. */
export function sin(x) {
  x -= TAU * Math.round(x / TAU);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return x * (1 + x2 * (S3 + x2 * (S5 + x2 * (S7 + x2 * (S9 + x2 * (S11 + x2 * S13))))));
}

export function cos(x) {
  return sin(x + HALF_PI);
}

/** atan for |x| <= 1 via one half-angle reduction (|r| <= tan(π/8)) and a series. */
function atanUnit(x) {
  const r = x / (1 + Math.sqrt(1 + x * x));
  const r2 = r * r;
  let term = r;
  let sum = r;
  for (let n = 3; n <= 19; n += 2) {
    term *= -r2;
    sum += term / n;
  }
  return 2 * sum;
}

export function atan(x) {
  if (x > 1) return HALF_PI - atanUnit(1 / x);
  if (x < -1) return -HALF_PI - atanUnit(1 / x);
  return atanUnit(x);
}

export function atan2(y, x) {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

export function length(x, z) {
  return Math.sqrt(x * x + z * z);
}

/** Wrap an angle into (-π, π]. */
export function wrapAngle(a) {
  a -= TAU * Math.round(a / TAU);
  return a <= -PI ? a + TAU : a;
}

/** Heading convention: 0 faces +z, increasing toward +x. */
export function headingTo(dx, dz) {
  return atan2(dx, dz);
}
