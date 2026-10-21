"""Generate the PWA icons (no image libraries needed): a crosshair over a
blue-vs-red squad marker on the game's dark background.
Usage: python3 scripts/make-icons.py  (writes public/icon-192.png, public/icon-512.png)"""
import math, struct, zlib, os

def png(path, size, pixel):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x / size, y / size))
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    data += chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

BG, GOLD, BLUE, RED = (26, 29, 33), (255, 211, 77), (74, 144, 226), (226, 87, 74)

def icon(u, v):
    # Everything stays inside the central 80% "safe zone" so it also works as a maskable icon.
    dx, dy = u - 0.5, v - 0.5
    r = math.hypot(dx, dy)
    if abs(r - 0.27) < 0.022: return GOLD                           # crosshair ring
    if (abs(dx) < 0.014 and 0.1 < abs(dy) < 0.36) or (abs(dy) < 0.014 and 0.1 < abs(dx) < 0.36):
        return GOLD                                                 # crosshair ticks
    if math.hypot(dx + 0.12, dy - 0.12) < 0.07: return BLUE         # our squad
    if math.hypot(dx - 0.12, dy + 0.12) < 0.07: return RED          # their squad
    return BG

os.makedirs('public', exist_ok=True)
for size in (192, 512):
    png(f'public/icon-{size}.png', size, icon)
print('icons written')
