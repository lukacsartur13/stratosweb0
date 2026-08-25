#!/usr/bin/env python3
"""
THE BEFORE/AFTER SHEETS — §25 and §26.

Both are built from SETTLED captures rather than from a recording, and that is
a deliberate difference from `temporal/sheets.py`. Phase 5 was measuring
duration, where a settled capture is the wrong instrument because it shows a
state the moving visitor never sees. Phase 5.1 is measuring COMPOSITION and
FIELD across two builds, and there the settled capture is the right one: it is
reproducible to the pixel, and it is the only sampling under which two builds
of different lengths can be put beside each other honestly.

The recordings answer the motion question separately — see `film/`.

  python3 sheet.py journey   24 equal-journey-progress pairs, whole homepage
  python3 sheet.py system    16 equal-chapter-progress pairs, the system chapter
"""
import json, sys, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
BG = (12, 14, 18)
INK = (150, 160, 175)
HEAD = (232, 234, 238)


def font(sz):
    for p in ('/System/Library/Fonts/Supplemental/Arial.ttf',
              '/System/Library/Fonts/Helvetica.ttc'):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


def pick(rows, dirname, n, key):
    """The frame closest to each of n equal points on `key`, with its row."""
    out = []
    for i in range(n):
        t = i / (n - 1)
        r = min(rows, key=lambda r: abs(r[key] - t))
        out.append((t, r, os.path.join(HERE, dirname, r['file'])))
    return out


def build(pairs_a, pairs_b, label_a, label_b, cols, tw, out, title, sub):
    n = len(pairs_a)
    first = Image.open(pairs_a[0][2])
    th = round(tw * first.size[1] / first.size[0])
    PAD, LBL, TOP = 14, 16, 78
    cellh = 2 * (LBL + th) + 6
    rows = (n + cols - 1) // cols
    W = cols * (tw + PAD) + PAD
    H = TOP + rows * (cellh + PAD) + PAD
    sheet = Image.new('RGB', (W, H), BG)
    dr = ImageDraw.Draw(sheet)
    dr.text((PAD, 14), title, fill=HEAD, font=font(24))
    dr.text((PAD, 48), sub, fill=INK, font=font(13))
    f = font(12)
    for k in range(n):
        _, ra, pa = pairs_a[k]
        _, rb, pb = pairs_b[k]
        x = PAD + (k % cols) * (tw + PAD)
        y = TOP + (k // cols) * (cellh + PAD)
        dr.text((x, y + 2), f"{k + 1:02d}  {label_a}  {ra['caption']}", fill=INK, font=f)
        sheet.paste(Image.open(pa).convert('RGB').resize((tw, th)), (x, y + LBL))
        y2 = y + LBL + th + 6
        dr.text((x, y2 + 2), f"    {label_b}  {rb['caption']}", fill=HEAD, font=f)
        sheet.paste(Image.open(pb).convert('RGB').resize((tw, th)), (x, y2 + LBL))
        # A hairline under the pair, so twenty-four stacked pairs read as pairs.
        dr.line([(x, y2 + LBL + th + 3), (x + tw, y2 + LBL + th + 3)], fill=(38, 42, 50))
    sheet.save(out)
    print(out, sheet.size)


def journey():
    a = json.load(open(os.path.join(HERE, 'field-p5-sheet.json'), encoding='utf-8'))
    b = json.load(open(os.path.join(HERE, 'field-p51-sheet.json'), encoding='utf-8'))
    for m in (a, b):
        total = m['rows'][-1]['screens']
        for r in m['rows']:
            r['file'] = f"f{r['i']:03d}.png"
            r['p'] = r['screens'] / total
            r['caption'] = f"{r['screens']:5.2f} sc  {r['metres']:>6} m"
    build(pick(a['rows'], a['meta']['dir'], 24, 'p'),
          pick(b['rows'], b['meta']['dir'], 24, 'p'),
          'P5 ', 'P5.1', 6, 340,
          os.path.join(HERE, 'filmstrip-p5-vs-p51.png'),
          'THE WHOLE HOMEPAGE — PHASE 5 (upper) against PHASE 5.1 (lower)',
          '24 settled captures at equal journey progress, 1440x900, hu.   '
          f"P5 track {a['rows'][-1]['screens']:.2f} screens · P5.1 track {b['rows'][-1]['screens']:.2f} screens.")


def system():
    a = json.load(open(os.path.join(HERE, 'chapter-system-p5.json'), encoding='utf-8'))
    b = json.load(open(os.path.join(HERE, 'chapter-system-p51.json'), encoding='utf-8'))
    for m in (a, b):
        for r in m['rows']:
            r['file'] = f"c{r['i']:02d}.png"
            r['caption'] = f"{r['screens']:4.2f} sc  {r['metres']:>6} m"
    build(pick(a['rows'], a['meta']['dir'], 16, 'k'),
          pick(b['rows'], b['meta']['dir'], 16, 'k'),
          'P5 ', 'P5.1', 4, 430,
          os.path.join(HERE, 'system-p5-vs-p51.png'),
          'THE SYSTEM CHAPTER — PHASE 5 (upper) against PHASE 5.1 (lower)',
          '16 settled captures at equal CHAPTER progress, 1440x900, hu.   '
          f"P5 {a['meta']['screens']:.2f} screens · P5.1 {b['meta']['screens']:.2f} screens. "
          'Both sequences run from the chapter\'s first frame to its last, so column n is the same '
          'fraction of each.')


{'journey': journey, 'system': system}[sys.argv[1] if len(sys.argv) > 1 else 'journey']()
