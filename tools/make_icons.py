"""Render the PNG app icons (no dependencies: writes PNGs with zlib).

Usage: python tools/make_icons.py
Writes icons/icon-192.png, icons/icon-512.png and icons/icon-maskable-512.png.
"""

import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"
SS = 3  # supersampling per axis

FELT_IN = (0x1B, 0x91, 0x63)
FELT_OUT = (0x0A, 0x4A, 0x31)
GOLD = (0xF5, 0xC5, 0x42)
WHITE = (0xFF, 0xFF, 0xFF)


def in_spade(x, y):
    """Spade in its own units: point at y=1, lobes down to about y=-1.2, stem below."""
    # Upside-down heart curve: (x^2 + y^2 - 1)^3 + x^2 y^3 <= 0
    hx, hy = x * 1.1, y
    if (hx * hx + hy * hy - 1) ** 3 + hx * hx * hy ** 3 <= 0:
        return True
    if -1.75 <= y <= -0.3:
        t = (-0.3 - y) / 1.45
        return abs(x) <= 0.07 + 0.55 * t * t
    return False


def in_rounded_rect(px, py, size, radius):
    cx = min(max(px, radius), size - radius)
    cy = min(max(py, radius), size - radius)
    return (px - cx) ** 2 + (py - cy) ** 2 <= radius * radius


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def render(size, maskable):
    radius = 0 if maskable else size * 0.22
    spade_h = size * (0.46 if maskable else 0.56)
    scale = spade_h / 2.75
    ring_r = size * (0.36 if maskable else 0.40)
    ring_w = size * 0.022
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            bg_cov = spade_cov = ring_cov = 0
            for sy in range(SS):
                for sx in range(SS):
                    fx = px + (sx + 0.5) / SS
                    fy = py + (sy + 0.5) / SS
                    if not in_rounded_rect(fx, fy, size, radius):
                        continue
                    bg_cov += 1
                    dx, dy = fx - size / 2, fy - size / 2
                    d = math.hypot(dx, dy)
                    # Dashed ring, like a poker chip edge.
                    ang = (math.atan2(dy, dx) + math.pi) / (2 * math.pi)
                    if abs(d - ring_r) <= ring_w / 2 and (ang * 24) % 1 < 0.6:
                        ring_cov += 1
                    x = dx / scale
                    y = -dy / scale - 0.37
                    if in_spade(x, y):
                        spade_cov += 1
            total = SS * SS
            if bg_cov == 0:
                row += bytes((0, 0, 0, 0))
                continue
            d = math.hypot(px - size / 2, py - size * 0.45) / (size * 0.65)
            color = mix(FELT_IN, FELT_OUT, min(1.0, d))
            color = mix(color, GOLD, ring_cov / bg_cov)
            color = mix(color, WHITE, spade_cov / bg_cov)
            row += bytes((*color, round(255 * bg_cov / total)))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    OUT.mkdir(exist_ok=True)
    for name, size, maskable in [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
    ]:
        write_png(OUT / name, size, render(size, maskable))
        print("wrote", OUT / name)


if __name__ == "__main__":
    main()
