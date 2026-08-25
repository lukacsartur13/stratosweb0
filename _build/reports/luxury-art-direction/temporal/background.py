#!/usr/bin/env python3
"""
§20 — DOES THE ATMOSPHERE EVOLVE, OR DOES IT STEP?

Read off the recorded frames rather than off the shader, because what §20 asks
about is what the eye sees: a gradient that changes state at a chapter boundary
announces the chapter, and a horizon that appears in one frame is a cut.

Three bands are sampled per frame — the top eighth, the middle and the bottom
eighth — because a sky can be continuous at the zenith and step at the horizon,
and one average over the whole frame hides exactly that. Type is excluded by
sampling only the outer thirds of the width on the top and bottom bands, where
this design puts no copy at either margin simultaneously... which is not true of
every frame, so the measure is the MEDIAN of the band, not the mean: a headline
crossing a band moves the mean and leaves the median alone.
"""
import json, sys, os, statistics
from PIL import Image

film = sys.argv[1]
d = json.load(open(film)); meta, frames = d['meta'], d['frames']
fdir = os.path.join(os.path.dirname(film), f"frames-{meta['tag']}")
W, H = meta['width'], meta['height']

rows = []
for f in frames:
    path = os.path.join(fdir, f"f{f['i']:04d}.jpg")
    if not os.path.exists(path): continue
    im = Image.open(path).convert('RGB').resize((64, 40))
    px = im.load()
    def band(y0, y1):
        vals = [px[x, y] for y in range(y0, y1) for x in range(64)]
        return tuple(statistics.median(v[c] for v in vals) for c in range(3))
    rows.append({'i': f['i'], 'p': f['p'], 'screens': f['screens'],
                 'top': band(0, 5), 'mid': band(17, 23), 'low': band(35, 40)})

def dist(a, b):
    return max(abs(a[c] - b[c]) for c in range(3))

print(f"# {meta['tag']}  {len(rows)} frames\n")
print("## LARGEST FRAME-TO-FRAME CHANGE IN THE PAINTED SKY")
print("   (0–255 per channel, worst channel; the frames are ~33 ms apart)")
worst = []
for k in range(1, len(rows)):
    a, b = rows[k-1], rows[k]
    if b['p'] < a['p'] - 0.001: continue          # the hold at the end
    worst.append((max(dist(a['top'], b['top']), dist(a['mid'], b['mid']), dist(a['low'], b['low'])),
                  a['screens'], b['screens'], a, b))
worst.sort(reverse=True, key=lambda x: x[0])
for step, s0, s1, a, b in worst[:10]:
    which = max((('top', dist(a['top'], b['top'])), ('mid', dist(a['mid'], b['mid'])),
                 ('low', dist(a['low'], b['low']))), key=lambda x: x[1])[0]
    print(f"   {step:>4}  at {s0:6.2f} → {s1:6.2f} screens   band={which}  "
          f"{a[which]} → {b[which]}")
vals = [w[0] for w in worst]
vals.sort()
print(f"\n   median step {vals[len(vals)//2]}   p95 {vals[int(len(vals)*0.95)]}   max {vals[-1]}")
print("\n   A step is a SNAP when it is many times the median and does not")
print("   correspond to something that should visibly change — a cloud deck")
print("   being entered, a horizon rising. Everything at or near the median is")
print("   the atmosphere evolving, which is what §20 asks for.")

print("\n## THE SKY ACROSS THE JOURNEY (every 8th frame, top band)")
for k in range(0, len(rows), max(1, len(rows)//28)):
    r = rows[k]
    t, m, l = r['top'], r['mid'], r['low']
    bar = lambda c: f"{int(c[0]):3},{int(c[1]):3},{int(c[2]):3}"
    print(f"   {r['screens']:6.2f} sc   top {bar(t)}   mid {bar(m)}   low {bar(l)}")
