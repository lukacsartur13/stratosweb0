#!/usr/bin/env python3
"""
Contact sheets from a placed screencast — §37.

Sampled at equal JOURNEY PROGRESS, not equal time, which is the whole point of
the instruction: on a natural-pace recording equal time over-samples the places
the reader stopped, and those are exactly the places that already work.
"""
import json, sys, os, glob
from PIL import Image, ImageDraw

film = sys.argv[1]                      # .../film/<tag>.json
n    = int(sys.argv[2]) if len(sys.argv) > 2 else 24
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 6
out  = sys.argv[4] if len(sys.argv) > 4 else film.replace('.json', '-sheet.png')

d = json.load(open(film))
meta, frames = d['meta'], d['frames']
tag = meta['tag']
fdir = os.path.join(os.path.dirname(film), f"frames-{tag}")
if not frames:
    sys.exit(f"no frames for {tag}")

# For each equal-progress target, the frame whose scroll position is closest.
targets = [i / (n - 1) for i in range(n)]
pick = []
for t in targets:
    best = min(frames, key=lambda f: abs(f['p'] - t))
    pick.append((t, best))

TW = 360
first = Image.open(os.path.join(fdir, f"f{pick[0][1]['i']:04d}.jpg"))
TH = round(TW * first.size[1] / first.size[0])
rows = (n + cols - 1) // cols
PAD, LBL = 6, 16
sheet = Image.new('RGB', (cols * (TW + PAD) + PAD, rows * (TH + LBL + PAD) + PAD), (14, 16, 20))
dr = ImageDraw.Draw(sheet)
for k, (t, f) in enumerate(pick):
    path = os.path.join(fdir, f"f{f['i']:04d}.jpg")
    im = Image.open(path).convert('RGB').resize((TW, TH))
    x = PAD + (k % cols) * (TW + PAD)
    y = PAD + (k // cols) * (TH + LBL + PAD)
    sheet.paste(im, (x, y))
    dr.text((x + 2, y + TH + 3), f"{k+1:02d}  p={f['p']:.2f}  {f['screens']:.1f} sc  t={f['rel']/1000:.1f}s",
            fill=(150, 160, 175))
sheet.save(out)
print(out, sheet.size, f"{n} samples at equal journey progress")
