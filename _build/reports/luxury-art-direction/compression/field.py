#!/usr/bin/env python3
"""
§14 — DOES THE FIELD EVOLVE ENOUGH TO BE SEEN?

Three band medians per settled shot (zenith eighth, middle sixth, foot eighth),
plus the blue contribution `B − R` of the middle band, which is the one number
that separates "near-black" from "high-altitude blue" independently of exposure.

The question is not whether consecutive frames differ — `background.py` already
showed they do, continuously. It is whether two frames a visitor STOPS on, one
chapter apart, differ by enough to read as a different altitude.
"""
import json, sys, os, statistics
from PIL import Image

man = json.load(open(sys.argv[1]))
meta, rows = man['meta'], man['rows']
d = os.path.join(os.path.dirname(sys.argv[1]), meta['dir'])

def bands(path):
    im = Image.open(path).convert('RGB').resize((96, 60))
    px = im.load()
    def band(y0, y1):
        v = [px[x, y] for y in range(y0, y1) for x in range(96)]
        return tuple(int(statistics.median(p[c] for p in v)) for c in range(3))
    return band(0, 8), band(25, 35), band(52, 60)

out = []
for r in rows:
    t, m, l = bands(os.path.join(d, f"f{r['i']:03d}.png"))
    out.append({**r, 'top': t, 'mid': m, 'low': l, 'blue': m[2] - m[0], 'lum': sum(m) / 3})

fmt = lambda c: f"{c[0]:3},{c[1]:3},{c[2]:3}"
print(f"# {meta['tag']}  {meta['width']}x{meta['height']}  {len(out)} settled shots\n")
print(f"{'screens':>8}{'metres':>8}{'instr':>7}  {'stage':<24}{'top':>13}{'mid':>14}{'low':>14}{'B-R':>6}{'lum':>7}")
for r in out:
    print(f"{r['screens']:8.2f}{r['metres']:8d}{r['instrument']:7.2f}  {str(r['stage'] or '-'):<24}"
          f"{fmt(r['top']):>13}{fmt(r['mid']):>14}{fmt(r['low']):>14}{r['blue']:6d}{r['lum']:7.1f}")

print("\n## CHAPTER-TO-CHAPTER READ (mid band at each chapter's own centre)")
by = {}
for r in out:
    by.setdefault(r['stage'], []).append(r)
prev = None
for st, rs in by.items():
    if not st: continue
    c = rs[len(rs) // 2]
    delta = '' if prev is None else f"   Δ worst-channel {max(abs(c['mid'][k] - prev['mid'][k]) for k in range(3)):3d}   ΔB-R {c['blue'] - prev['blue']:+4d}"
    print(f"  {st:<24}{c['screens']:7.2f} sc   mid {fmt(c['mid'])}   B-R {c['blue']:4d}{delta}")
    prev = c

json.dump(out, open(sys.argv[1].replace('.json', '-bands.json'), 'w'), indent=1)
