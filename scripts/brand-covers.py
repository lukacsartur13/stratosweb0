#!/usr/bin/env python3
# =============================================================================
# The cover images for the Facebook page and the LinkedIn company page — the
# home page's opening, laid flat: its headline on the cloud deck, the paper
# plane flying past it.
#
#   assets/brand/stratos-cover-facebook.png   1640 × 624  (820 × 312 at 2×)
#   assets/brand/stratos-cover-linkedin.png   2256 × 382  (1128 × 191 at 2×)
#
#     python3 scripts/brand-covers.py
#
# Made only of what the site already is: the headline and its kicker are
# index.html's, set as .t-monument (Aboreto, capitals, --c-ink) and .t-micro
# (Archivo 520, --c-ink-2); the plane is assets/img/logo.png; the ground is
# assets/img/home-clouds.webp under --c-bg.
#
# The plane's cloud strip from the home page was tried and left out: still,
# it reads as a patch of bluer cloud, not as a trail.
#
# Where each platform puts its own things on the picture:
#   Facebook  phones show the middle 16:9 of the 820 × 312 picture, so the
#             words and the plane keep to the middle 555 px; the page's
#             profile picture sits on the bottom-left corner.
#   LinkedIn  the company logo sits on the bottom-left and phones crop the
#             sides, so the words and the plane stand together in the
#             middle, as on Facebook, and the sky is left open. The kicker
#             is left off: at LinkedIn's size it would be a few pixels tall,
#             and the page prints what Stratos does right under the picture.
# Every position below is in 1× units — the platform's own pixels.
#
# Needs Pillow (its FreeType reads the woff2 directly).
# Deterministic: same files in, same pictures out.
# =============================================================================
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/brand"
X = 2                     # every picture is drawn at twice the platform's size
DECK = 0.75               # clouds a little smaller than the desktop page's

BG = (0xF3, 0xF2, 0xEE)     # --c-bg
INK = (0x14, 0x14, 0x13)    # --c-ink
INK_2 = (0x5A, 0x59, 0x54)  # --c-ink-2

KICKER = "Stratos — weboldal készítés és digitális rendszerek"
HEADLINE = ("Olyat építünk,", "amit nem lehet", "összetéveszteni.")

FORMATS = {
    # size; the headline's lines, size and left edge (None: centred); whether
    # the kicker goes above it; the plane's centre and width.
    "facebook": dict(
        size=(820, 312),
        lines=HEADLINE, em=36, left=150, kicker=True,
        plane=(602, 92, 116),
    ),
    "linkedin": dict(
        size=(1128, 191),
        lines=HEADLINE, em=28, left=349, kicker=False,
        plane=(725, 72, 116),
    ),
}


def deck(w, h):
    """The page's cloud tile, repeated from the top-left as the page does."""
    tile = Image.open(ROOT / "assets/img/home-clouds.webp").convert("RGB")
    t = round(tile.width * DECK * X)
    tile = tile.resize((t, t), Image.LANCZOS)
    im = Image.new("RGB", (w, h), BG)
    for y in range(0, h, t):
        for x in range(0, w, t):
            im.paste(tile, (x, y))
    return im


def plane(width):
    mark = Image.open(ROOT / "assets/img/logo.png").convert("RGBA")
    mark = mark.crop(mark.getbbox())
    w = round(width * X)
    return mark.resize((w, round(mark.height * w / mark.width)), Image.LANCZOS)


def text(draw, xy, s, font, fill, track):
    """Draw s from its left edge, letter by letter, with tracking in em."""
    x, y = xy
    for a, b in zip(s, s[1:] + " "):
        draw.text((x, y), a, font=font, fill=fill)
        x += font.getlength(a + b) - font.getlength(b) + track * font.size


def compose(name, f):
    w, h = f["size"][0] * X, f["size"][1] * X
    pic = deck(w, h).convert("RGBA")

    px, py, pw = f["plane"]
    p = plane(pw)
    pic.alpha_composite(p, (round(px * X - p.width / 2), round(py * X - p.height / 2)))

    d = ImageDraw.Draw(pic)
    mono = ImageFont.truetype(str(ROOT / "assets/fonts/aboreto/aboreto-normal-latin.woff2"), f["em"] * X)
    micro = ImageFont.truetype(str(ROOT / "assets/fonts/archivo/archivo-normal-latin.woff2"), round(f["em"] * X * 0.36))
    micro.set_variation_by_axes([520, 100])        # --w-ui, normal width
    lines = [s.upper() for s in f["lines"]]
    lead = f["em"] * X * 1.04                      # .t-monument line-height
    cap_top, cap_bottom = mono.getbbox("H")[1], mono.getbbox("H")[3]
    k_top, k_bottom = micro.getbbox("Sk")[1], micro.getbbox("Sk")[3]
    k_h = (k_bottom - k_top + f["em"] * X * 0.55) if f["kicker"] else 0
    block_h = k_h + lead * (len(lines) - 1) + cap_bottom - cap_top
    widest = max(mono.getlength(s) + 0.005 * mono.size * (len(s) - 1) for s in lines)
    left = f["left"] * X if f["left"] is not None else (w - widest) / 2
    top = (h - block_h) / 2

    if f["kicker"]:
        text(d, (left, top - k_top), KICKER, micro, INK_2, 0.01)
    y = top + k_h - cap_top
    for s in lines:
        text(d, (left, y), s, mono, INK, 0.005)
        y += lead
    print(f"{name}: headline {f['em']}px at 1×, block {round(widest / X)} × {round(block_h / X)} "
          f"at x {round(left / X)}, y {round(top / X)}")
    return pic.convert("RGB")


def main():
    OUT.mkdir(exist_ok=True)
    for name, f in FORMATS.items():
        path = OUT / f"stratos-cover-{name}.png"
        compose(name, f).save(path, optimize=True)
        print(f"{path.relative_to(ROOT)}  {f['size'][0] * X}×{f['size'][1] * X}  {path.stat().st_size // 1024} kB")


if __name__ == "__main__":
    main()
