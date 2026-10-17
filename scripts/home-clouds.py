#!/usr/bin/env python3
# =============================================================================
# The homepage's cloud deck — two seamless 1600 px tiles:
#
#   assets/img/home-clouds.webp        the page: the paper's own colour, a
#                                      breath of blue in the crevices
#   assets/img/home-clouds-trail.webp  the same deck at full strength, white
#                                      tops and sky-blue crevices — what the
#                                      paper plane reveals where it flies
#
#     python3 scripts/home-clouds.py [N] [seed]        # default 1600, 5
#
# The owner's brief, in order (2026-10-17): a cloud texture in the colour the
# page is now, connected clouds; stronger texture and contour; a little blue;
# and, with a reference image, a carpet of packed cumulus puffs.
#
# How it is made: a height field of spheres on spheres — large puffs covering
# the plane at heights that swell and sink, medium and small puffs grown out
# of the surface where it already is (the cauliflower) — every sphere wrapping
# at the edges, so the tile repeats with no seam. It is lit from the upper
# left with a half-Lambert term (soft, as cloud is, never hard like plaster);
# crevices fall into their own colour through two scales of occlusion; the
# highest tops catch a little more light.
#
# The page tile's darkest crevice is checked against the text: ink-2 stays
# above 5.4 : 1, and the recessive tone, set one step darker on this page in
# home.css, at 3.0 : 1. Change a colour below, check those two numbers again.
#
# Needs numpy and Pillow. Deterministic: same arguments, same tiles.
# =============================================================================
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
N = int(sys.argv[1]) if len(sys.argv) > 1 else 1600
seed = int(sys.argv[2]) if len(sys.argv) > 2 else 5
rng = np.random.default_rng(seed)

fy = np.fft.fftfreq(N)[:, None]
fx = np.fft.fftfreq(N)[None, :]
f2 = fx * fx + fy * fy


def blur(a, s):
    """Gaussian blur in the frequency domain — wraps, so it keeps the seam."""
    return np.real(np.fft.ifft2(np.fft.fft2(a) * np.exp(-2 * np.pi ** 2 * s * s * f2)))


H = np.full((N, N), -1e9)


def sphere(cx, cy, r, cz):
    """Raise the height field to a sphere's cap, wrapping at the tile's edges."""
    R = int(np.ceil(r))
    ys = np.arange(-R, R + 1); xs = np.arange(-R, R + 1)
    d2 = (ys[:, None] + (cy % 1)) ** 2 + (xs[None, :] + (cx % 1)) ** 2
    z = np.where(d2 < r * r, cz + np.sqrt(np.maximum(r * r - d2, 0)), -1e9)
    rows = (int(cy) + ys) % N; cols = (int(cx) + xs) % N
    H[np.ix_(rows, cols)] = np.maximum(H[np.ix_(rows, cols)], z)


# Large puffs, covering the plane; the deck swells and sinks over ~160 px.
swell = blur(rng.standard_normal((N, N)), 160)
swell /= swell.std()
for _ in range(int(N * N / (np.pi * 56 ** 2) * 2.7)):
    r = rng.uniform(40, 76); x, y = rng.uniform(0, N, 2)
    sphere(x, y, r, swell[int(y), int(x)] * 18 - 0.2 * r)
# Medium, then small puffs, grown out of the surface where it already is.
for count, (r0, r1), sink in ((int(N * N / (np.pi * 25 ** 2) * 1.35), (17, 34), 0.6),
                              (int(N * N / (np.pi * 12 ** 2) * 0.75), (8, 15), 0.64)):
    for _ in range(count):
        r = rng.uniform(r0, r1); x, y = rng.uniform(0, N, 2)
        sphere(x, y, r, H[int(y), int(x)] - sink * r)
H = np.where(H < -1e8, np.nanmin(np.where(H < -1e8, np.nan, H)), H)
H = blur(H, 1.9)

# Light from the upper left, half-Lambert; occlusion at two scales; tops.
gx = (np.roll(H, -1, 1) - np.roll(H, 1, 1)) * 0.5
gy = (np.roll(H, -1, 0) - np.roll(H, 1, 0)) * 0.5
inv = 1 / np.sqrt(gx * gx + gy * gy + 1)
L = np.array([-0.45, -0.6, 0.66]); L /= np.linalg.norm(L)
diff = np.clip(((-gx * L[0] - gy * L[1] + L[2]) * inv) * 0.5 + 0.5, 0, 1) ** 1.5
occ = np.clip((blur(H, 9) - H) / 10, 0, 1) * 0.6 + np.clip((blur(H, 26) - H) / 26, 0, 1) * 0.7
occ = np.clip(occ, 0, 1) ** 0.9
top = H - blur(H, 60)
top = np.clip(top / (3 * top.std()) + 0.5, 0, 1)


def paint(light, mid, shade, crev):
    light, mid, shade, crev = (np.array(c, float) / 255 for c in (light, mid, shade, crev))
    k = diff[..., None]
    c = np.where(k > 0.55, mid + (light - mid) * ((k - 0.55) / 0.45), shade + (mid - shade) * (k / 0.55))
    c = c + (light - c) * (0.25 * top[..., None])
    return c + (crev - c) * occ[..., None]


def lum(c):
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def save(c, name):
    path = ROOT / "assets/img" / name
    Image.fromarray((np.clip(c, 0, 1) * 255).round().astype(np.uint8)).save(path, "WEBP", quality=74, method=6)
    print(f"{path.relative_to(ROOT)}  {N}px  seed {seed}  {path.stat().st_size // 1024} kB")


#                    lit top          paper            shade            crevice
page = paint((251, 250, 247), (243, 242, 238), (232, 234, 235), (223, 228, 235))
trail = paint((255, 255, 255), (234, 239, 245), (200, 213, 228), (154, 178, 205))
save(page, "home-clouds.webp")
save(trail, "home-clouds-trail.webp")

lo = lum(page).min()
for tok, c in (("ink-2", (0x5A, 0x59, 0x54)), ("ink-3 (home)", (0x83, 0x82, 0x7C))):
    print(f"{tok} on the darkest crevice: {(lo + 0.05) / (lum(np.array(c) / 255) + 0.05):.2f} : 1")
