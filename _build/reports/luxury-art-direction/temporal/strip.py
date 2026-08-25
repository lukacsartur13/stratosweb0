#!/usr/bin/env python3
"""A dense strip over a progress window, for reading one stretch of the journey closely."""
import json, sys, os
from PIL import Image, ImageDraw
film, p0, p1 = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
n    = int(sys.argv[4]) if len(sys.argv) > 4 else 12
cols = int(sys.argv[5]) if len(sys.argv) > 5 else 4
out  = sys.argv[6]
d = json.load(open(film)); frames = d['frames']; tag = d['meta']['tag']
fdir = os.path.join(os.path.dirname(film), f"frames-{tag}")
pick = [min(frames, key=lambda f: abs(f['p'] - (p0 + (p1 - p0) * i / (n - 1)))) for i in range(n)]
TW = 420
im0 = Image.open(os.path.join(fdir, f"f{pick[0]['i']:04d}.jpg")); TH = round(TW * im0.size[1] / im0.size[0])
rows = (n + cols - 1) // cols
PAD, LBL = 5, 15
sheet = Image.new('RGB', (cols*(TW+PAD)+PAD, rows*(TH+LBL+PAD)+PAD), (14,16,20)); dr = ImageDraw.Draw(sheet)
for k, f in enumerate(pick):
    im = Image.open(os.path.join(fdir, f"f{f['i']:04d}.jpg")).convert('RGB').resize((TW, TH))
    x = PAD + (k % cols)*(TW+PAD); y = PAD + (k//cols)*(TH+LBL+PAD)
    sheet.paste(im, (x, y))
    dr.text((x+2, y+TH+2), f"p={f['p']:.3f}  {f['screens']:.2f} sc", fill=(150,160,175))
sheet.save(out); print(out, sheet.size)
