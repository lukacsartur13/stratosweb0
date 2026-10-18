#!/usr/bin/env python3
# =============================================================================
# The profile picture for the social accounts (Facebook, Instagram, LinkedIn,
# Google Business Profile) — the plane over the wordmark, on the home page's
# cloud deck:
#
#   assets/brand/stratos-profile-2048.png
#   assets/brand/stratos-profile-1080.png
#   assets/brand/stratos-profile.gif        the same, the clouds drifting
#
#     python3 scripts/brand-avatar.py
#
# Made only of what the site already is: the plane is assets/img/logo.png,
# the word is Aboreto from assets/fonts (as the header's wordmark: capitals,
# 0.22em apart, --c-ink), the ground is assets/img/home-clouds.webp under
# --c-bg, the deck the home page scrolls over.
#
# Every platform crops the square to its inscribed circle, so the plane and
# the word sit inside a smaller circle, SAFE of the radius, with room to
# spare. The word is as large as that circle allows, because the picture is
# mostly seen at 40–170 px.
#
# The only plane on file is 512 px (the mark itself 364 × 250), so at 2048 it
# is enlarged about 2.7×. Its surfaces are smooth chrome and hold up; at
# full size its edges are a little softer than the word's. A larger render of
# the plane, dropped in as logo.png, sharpens it with no other change.
#
# The GIF moves the deck as the menu's sky moves (system.css, .sheet__sky):
# straight towards the top-left, one tile in 45 s, as on a phone. A tile is
# 45 s and a GIF that long would be tens of megabytes, so it loops every
# LOOP seconds instead, the last FADE seconds dissolving into the first —
# soft cloud into soft cloud, which the eye takes for the deck changing
# shape. None of the platforms above animates a profile picture; the GIF is
# for the places that do.
#
# Needs Pillow (its FreeType reads the woff2 directly).
# Deterministic: same files in, same pictures out.
# =============================================================================
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/brand"

N = 2048                  # the master; the 1080 copy is drawn down from it
SAFE = 0.80               # radius of the circle everything stays inside
DECK = 2.0                # clouds drawn twice the desktop page's scale
PLANE_W = 0.48            # the plane's width, as a share of the picture
WORD_TRACK = 0.22         # .brand__wm letter-spacing, in em
GAP = 0.055               # plane to word, as a share of the picture

GIF = 400                 # the GIF's size: shown at 40–170 px (340 on a
                          # Retina screen), and every pixel more is file size
                          # on every frame — about 4 MB in all at 400
WIND = 45                 # seconds per tile, the menu's pace on a phone
LOOP = 6                  # seconds before the GIF starts again
FADE = 1.5                # seconds of LOOP spent dissolving into the start
FRAME = 100               # ms per frame: the drift is under 2 px a frame

BG = (0xF3, 0xF2, 0xEE)   # --c-bg
INK = (0x14, 0x14, 0x13)  # --c-ink


@lru_cache
def sky(n):
    """The home page's cloud tile at a picture n wide, repeated over n plus a
    tile each way; returns it and the tile's width."""
    tile = Image.open(ROOT / "assets/img/home-clouds.webp").convert("RGB")
    t = round(1600 * DECK * n / N)   # the tile's width on the page, whatever its pixels
    tile = tile.resize((t, t), Image.LANCZOS)
    out = Image.new("RGB", (n + t, n + t), BG)
    for y in range(0, n + t, t):
        for x in range(0, n + t, t):
            out.paste(tile, (x, y))
    return out, t


def deck(n=N, shift=0.0):
    """The deck at a picture n wide, a tile centred; `shift` carries it that
    many pixels towards the top-left, the way the menu's wind does."""
    big, t = sky(n)
    s = (-((n - t) // 2) + shift) % t
    if s == int(s):
        return big.crop((int(s), int(s), int(s) + n, int(s) + n))
    return big.transform((n, n), Image.AFFINE, (1, 0, s, 0, 1, s), Image.BICUBIC)


def plane():
    mark = Image.open(ROOT / "assets/img/logo.png").convert("RGBA")
    mark = mark.crop(mark.getbbox())
    w = round(N * PLANE_W)
    return mark.resize((w, round(mark.height * w / mark.width)), Image.LANCZOS)


def word(size):
    """STRATOS set with the wordmark's tracking; returns (image, ink box)."""
    font = ImageFont.truetype(str(ROOT / "assets/fonts/aboreto/aboreto-normal-latin.woff2"), size)
    text = "STRATOS"
    # Advance of each letter including the pair kerning into the next one.
    adv = [font.getlength(a + b) - font.getlength(b) for a, b in zip(text, text[1:])]
    track = WORD_TRACK * size
    width = sum(adv) + track * (len(text) - 1) + font.getlength(text[-1])
    img = Image.new("L", (int(width) + 2 * size, 2 * size), 0)
    d = ImageDraw.Draw(img)
    x = size
    for i, ch in enumerate(text):
        d.text((x, size // 2), ch, font=font, fill=255)
        x += (adv[i] + track) if i < len(adv) else 0
    box = img.getbbox()
    return img.crop(box)


def fits(box, c, r):
    """Every corner of box within r of c."""
    x0, y0, x1, y1 = box
    return all((x - c) ** 2 + (y - c) ** 2 <= r * r for x in (x0, x1) for y in (y0, y1))


def marks():
    """The plane over the word, on nothing."""
    pic = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    p = plane()
    c, r = N / 2, N / 2 * SAFE

    # The largest word whose box, under the plane, stays inside the circle.
    for size in range(N // 4, 20, -2):
        w = word(size)
        h = p.height + GAP * N + w.height
        top = c - h / 2
        if fits((c - w.width / 2, top + p.height + GAP * N, c + w.width / 2, top + h), c, r):
            break
    py = round(top)
    px = round(c - p.width / 2)
    wy = round(top + p.height + GAP * N)
    wx = round(c - w.width / 2)

    pic.alpha_composite(p, (px, py))
    ink = Image.new("RGBA", w.size, INK + (255,))
    ink.putalpha(w)
    pic.alpha_composite(ink, (wx, wy))
    assert fits((px, py, px + p.width, py + p.height), c, r), "plane leaves the circle"
    print(f"word {size}px, {w.width}×{w.height}; plane {p.width}×{p.height} at y {py}")
    return pic


def compose():
    pic = deck().convert("RGBA")
    pic.alpha_composite(marks())
    return pic.convert("RGB")


def drift():
    """The GIF's frames: the deck moving under the marks, the last FADE
    seconds dissolving into the first frames' clouds, so the loop is seamless."""
    top = marks().resize((GIF, GIF), Image.LANCZOS)
    v = sky(GIF)[1] / WIND                         # pixels per second
    frames = []
    for i in range(round(LOOP * 1000 / FRAME)):
        s = i * FRAME / 1000
        f = deck(GIF, v * s)
        a = (s - (LOOP - FADE)) / FADE
        if a > 0:
            a = a * a * (3 - 2 * a)                    # smoothstep
            f = Image.blend(f, deck(GIF, v * (s - LOOP)), a)
        f = f.convert("RGBA")
        f.alpha_composite(top)
        frames.append(f.convert("RGB"))
    # One palette for every frame, so nothing flickers from frame to frame.
    pal = frames[0].quantize(256, method=Image.Quantize.MEDIANCUT)
    return [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]


def main():
    OUT.mkdir(exist_ok=True)
    pic = compose()
    for n in (2048, 1080):
        path = OUT / f"stratos-profile-{n}.png"
        (pic if n == N else pic.resize((n, n), Image.LANCZOS)).save(path, optimize=True)
        print(f"{path.relative_to(ROOT)}  {n}px  {path.stat().st_size // 1024} kB")
    frames = drift()
    path = OUT / "stratos-profile.gif"
    # Not `optimize`: every pixel changes every frame, and Pillow's frame-by-
    # frame optimising only makes this one larger (5.7 MB against 5.5 at 480).
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=FRAME, loop=0, optimize=False)
    print(f"{path.relative_to(ROOT)}  {GIF}px  {len(frames)} frames  {path.stat().st_size // 1024} kB")


if __name__ == "__main__":
    main()
