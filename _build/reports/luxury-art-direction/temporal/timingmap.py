#!/usr/bin/env python3
"""
§44 — `timing-map.png`. The whole journey as one horizontal band, before over
after, so the shape of the change is a picture rather than a table.

Everything drawn is a measurement from `scan.mjs`: chapter extents, the window
in which each statement is composed, where the instrument is in the picture,
and where the frame carries less than 0.4% of its area in legible type.
"""
import json, sys
from PIL import Image, ImageDraw, ImageFont

def load(path):
    d = json.load(open(path)); return d['meta'], d['samples']

def rows(meta, S):
    H = meta['height']
    def owner(s):
        best, bo = None, -1
        for p in s['panels']:
            if p['fieldO'] is None or p['fieldTop'] is None: continue
            sc = p['fieldO'] * (0.35 + 0.65 * (1 - min(1, abs(p['fieldTop']) / H)))
            if sc > bo: bo, best = sc, p
        return best
    runs = []
    for s in S:
        o = owner(s)
        st = o['stage'] if o else None
        lv = o['level'] if o else None
        if runs and runs[-1][0] == st: runs[-1][2] = s['screens']
        else: runs.append([st, s['screens'], s['screens'], lv])
    ids = list(S[0]['statements'].keys())
    comp = []
    for sid in ids:
        o = [s['statements'][sid]['o'] for s in S]
        idx = [i for i, v in enumerate(o) if v >= 0.90]
        if len(idx) > 1: comp.append((sid, S[idx[0]]['screens'], S[idx[-1]]['screens']))
    inst = []
    cur = None
    for s in S:
        on = s['instrument'] > 0.02
        if cur and cur[0] == on: cur[2] = s['screens']
        else: cur = [on, s['screens'], s['screens']]; inst.append(cur)
    empt = []
    cur = None
    for s in S:
        e = s['inkFrac'] < 0.004
        if cur and cur[0] == e: cur[2] = s['screens']
        else: cur = [e, s['screens'], s['screens']]; empt.append(cur)
    return runs, comp, [x for x in inst if x[0]], [x for x in empt if x[0] and x[2] - x[1] >= 0.12]

PANELS = [(sys.argv[i], sys.argv[i + 1]) for i in range(1, len(sys.argv) - 1, 2)]
OUT = sys.argv[-1]

W, PAD = 1900, 70
LANE, GAP = 26, 8
BLOCK = 4 * (LANE + GAP) + 78
Him = PAD * 2 + BLOCK * len(PANELS)
im = Image.new('RGB', (W, Him), (11, 13, 17)); dr = ImageDraw.Draw(im)
try:
    f = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 12)
    fb = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 14)
except Exception:
    f = fb = ImageFont.load_default()

MASTER, PASSAGE = (198, 214, 232), (92, 106, 124)
SIGNAL, INSTR, EMPTY = (255, 238, 37), (120, 160, 205), (40, 26, 26)

scale_max = 0
loaded = []
for path, label in PANELS:
    meta, S = load(path)
    loaded.append((meta, S, label))
    scale_max = max(scale_max, meta['screensTotal'])

x0, x1 = PAD, W - PAD
def X(sc): return x0 + (x1 - x0) * sc / scale_max

for k, (meta, S, label) in enumerate(loaded):
    top = PAD + k * BLOCK
    runs, comp, inst, empt = rows(meta, S)
    dr.text((x0, top - 22), f"{label}   {meta['width']}x{meta['height']}   "
                            f"{meta['screensTotal']:.2f} screens", font=fb, fill=(226, 232, 240))
    # lane 1 — chapters
    y = top
    for st, a, b, lv in runs:
        if not st: continue
        c = MASTER if lv == 'master' else PASSAGE
        dr.rectangle([X(a), y, X(b), y + LANE], fill=c)
        w = X(b) - X(a)
        name = st if w > 108 else (st[:3] + '…' if w > 34 else '')
        if name:
            dr.text((X(a) + 4, y + 6), name, font=f, fill=(11, 13, 17))
    dr.text((x0 - 60, y + 6), 'chapter', font=f, fill=(120, 132, 148))
    # lane 2 — composed statements
    y += LANE + GAP
    dr.rectangle([x0, y, x1, y + LANE], fill=(20, 23, 29))
    for sid, a, b in comp:
        master = sid.endswith('monument')
        dr.rectangle([X(a), y + (2 if master else 7), X(b), y + LANE - (2 if master else 7)],
                     fill=(244, 244, 244) if master else SIGNAL)
    dr.text((x0 - 60, y + 6), 'composed', font=f, fill=(120, 132, 148))
    # lane 3 — instrument
    y += LANE + GAP
    dr.rectangle([x0, y, x1, y + LANE], fill=(20, 23, 29))
    for _, a, b in inst:
        dr.rectangle([X(a), y + 5, X(b), y + LANE - 5], fill=INSTR)
    dr.text((x0 - 62, y + 6), 'instrument', font=f, fill=(120, 132, 148))
    # lane 4 — low ink
    y += LANE + GAP
    dr.rectangle([x0, y, x1, y + LANE], fill=(20, 23, 29))
    for _, a, b in empt:
        dr.rectangle([X(a), y + 5, X(b), y + LANE - 5], fill=(150, 70, 70))
        if X(b) - X(a) > 32:
            dr.text((X(a) + 3, y + 5), f"{b - a:.2f}", font=f, fill=(22, 14, 14))
    dr.text((x0 - 56, y + 6), 'low ink', font=f, fill=(120, 132, 148))
    # scale
    y += LANE + 6
    for s in range(0, int(scale_max) + 1, 2):
        dr.line([X(s), y, X(s), y + 5], fill=(80, 90, 104))
        dr.text((X(s) - 4, y + 7), str(s), font=f, fill=(100, 112, 128))
    dr.text((x1 - 54, y + 7), 'screens', font=f, fill=(100, 112, 128))

dr.text((PAD, Him - 34),
        'white = master statement composed    yellow = passage statement composed    '
        'blue = instrument in the picture    red = under 0.4% of the frame in legible type',
        font=f, fill=(120, 132, 148))
im.save(OUT); print(OUT, im.size)
