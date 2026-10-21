/**
 * Seeded PRNG (mulberry32). The sim must never use Math.random().
 * State is a single uint32 so it can be serialized and hashed.
 */
export function createRng(seed) {
  let s = seed >>> 0;
  return {
    /** @returns {number} float in [0, 1) */
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(min, max) {
      return min + (max - min) * this.next();
    },
    int(min, maxExclusive) {
      return min + Math.floor(this.next() * (maxExclusive - min));
    },
    get state() {
      return s;
    },
    set state(v) {
      s = v >>> 0;
    },
  };
}
