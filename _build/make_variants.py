#!/usr/bin/env python3
"""Pre-render responsive WebP variants of the site's raster images.

    python3 _build/make_variants.py            # (re)build what is missing or stale
    python3 _build/make_variants.py --check    # exit 1 if a variant is missing

Writes assets/img/resp/<stem>-<width>.webp for every JPEG/PNG under assets/img
that a page shows. The build (stamp_srcset in build.py) only READS these files —
it needs no imaging library, so the Netlify build stays dependency-free. Run
this locally, with Pillow, whenever an image is added or replaced, and commit
the output. A source image without variants still ships as before, without a
srcset, so forgetting this degrades to the old behaviour rather than breaking.

Why: until 2026-10-10 every page shipped one JPEG/PNG per image at its full
export size — 1800px photos to 400px phones, 600-1800px logos into a 176px
slot — and no WebP anywhere (PageSpeed: "properly size images", "serve images
in next-gen formats").
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "assets" / "img"
OUT = IMG / "resp"

PHOTO_WIDTHS = (400, 800, 1200, 1800)
LOGO_WIDTHS = (180, 360, 540)          # the rail slot is 176px wide
SKIP = {"favicon.png", "favicon-192.png", "apple-touch-icon.png", "logo-square.png",
        "plane-cursor.png", "gdpr.png", "logo.png"}


def widths_for(path, width):
    base = LOGO_WIDTHS if path.name.startswith(("logo-", "client-")) else PHOTO_WIDTHS
    ws = [w for w in base if w < width]
    return ws + [width] if width not in ws else ws


def sources():
    for p in sorted(IMG.iterdir()):
        if p.suffix.lower() not in (".jpg", ".jpeg", ".png") or p.name in SKIP:
            continue
        if re.search(r" \d+\.\w+$", p.name):        # iCloud duplicates
            continue
        yield p


def main():
    check = "--check" in sys.argv
    if not check:
        from PIL import Image, ImageOps
    OUT.mkdir(exist_ok=True)
    missing = []
    made = 0
    for src in sources():
        if check:
            if not list(OUT.glob(f"{src.stem}-*.webp")):
                missing.append(src.name)
            continue
        im = ImageOps.exif_transpose(Image.open(src))
        has_alpha = im.mode in ("RGBA", "LA") or "transparency" in im.info
        im = im.convert("RGBA" if has_alpha else "RGB")
        for w in widths_for(src, im.width):
            dst = OUT / f"{src.stem}-{w}.webp"
            if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
                continue
            h = round(im.height * w / im.width)
            out = im if w == im.width else im.resize((w, h), Image.LANCZOS)
            out.save(dst, "WEBP", quality=90 if has_alpha else 80, method=6)
            made += 1
    if check:
        if missing:
            print("no responsive variants for:", *missing, sep="\n  ")
            sys.exit(1)
        return
    print(f"variants: {made} written to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
