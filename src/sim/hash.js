/** FNV-1a over raw float64 bytes, so any bit-level difference changes the hash. */
const buf = new DataView(new ArrayBuffer(8));

export function createHasher() {
  let h = 0x811c9dc5;
  const byte = (b) => {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  return {
    num(n) {
      buf.setFloat64(0, n);
      for (let i = 0; i < 8; i++) byte(buf.getUint8(i));
      return this;
    },
    str(str) {
      for (let i = 0; i < str.length; i++) byte(str.charCodeAt(i) & 0xff);
      return this;
    },
    digest() {
      return h.toString(16).padStart(8, '0');
    },
  };
}
