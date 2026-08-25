#!/usr/bin/env python3
"""
Turn a scan trace into §5's temporal journey map.

Everything is reported in SCREENS OF SCROLL, which is the unit the page is
authored in and the only one that is the same for every visitor. Seconds are
derived at the bottom, at three nominal paces, per §28.
"""
import json, sys, math
from collections import OrderedDict

path = sys.argv[1]
d = json.load(open(path))
meta, S = d['meta'], d['samples']
H = meta['height']
TOTAL = meta['screensTotal']
per = TOTAL / (len(S) - 1)          # screens per sample step

# --------------------------------------------------------------- stage extents
# The panel that OWNS the frame at a given scroll position is the one whose
# field is on screen and closest to composed. `data-stage` on the panel is the
# authority; the HUD label is a translation of it and lags by a damper.
def owner(s):
    best, bo = None, -1
    for p in s['panels']:
        if p['fieldO'] is None: continue
        # a field that is off the top or bottom is not the frame you are in
        if p['fieldTop'] is None: continue
        centred = 1 - min(1, abs(p['fieldTop']) / H)
        score = p['fieldO'] * (0.35 + 0.65 * centred)
        if score > bo: bo, best = score, p
    return best

rows = []
for s in S:
    o = owner(s)
    rows.append({'i': s['i'], 'screens': s['screens'], 'metres': s['metres'],
                 'stage': o['stage'] if o else None, 'level': o['level'] if o else None,
                 'fieldTop': o['fieldTop'] if o else None, 'ink': s['inkFrac'],
                 'instr': s['instrument'], 'biggest': s['biggest'],
                 'nDisplay': len(s['legibleDisplay'])})

# contiguous runs of the same owning stage
runs = []
for r in rows:
    if runs and runs[-1]['stage'] == r['stage']:
        runs[-1]['to'] = r['screens']; runs[-1]['toM'] = r['metres']; runs[-1]['n'] += 1
    else:
        runs.append({'stage': r['stage'], 'level': r['level'], 'from': r['screens'],
                     'to': r['screens'], 'fromM': r['metres'], 'toM': r['metres'], 'n': 1})

print(f"# {meta['tag']}  {meta['width']}x{meta['height']}  {TOTAL:.2f} screens  "
      f"({meta['track']['height']}px track)\n")
print("## CHAPTER EXTENTS (owning frame)")
print(f"{'stage':<26}{'level':<9}{'screens':>9}{'from→to (screens)':>22}{'altitude':>18}")
for r in runs:
    rng = "%.2f\u2192%.2f" % (r['from'], r['to'])
    alt = "%d\u2192%dm" % (r['fromM'], r['toM'])
    if r['stage'] is None:
        print(f"{'(no frame)':<26}{'':<9}{r['to']-r['from']+per:>9.2f}{rng:>22}")
        continue
    print(f"{r['stage']:<26}{r['level']:<9}{r['to']-r['from']+per:>9.2f}{rng:>22}{alt:>18}")

# ------------------------------------------------------- statement lifecycles
print("\n## STATEMENT LIFECYCLE (screens of scroll)")
print(f"{'statement':<34}{'arrive':>8}{'full':>8}{'depart':>8}{'gone':>8}{'HOLD':>8}{'life':>8}{'px':>6}")
ids = list(S[0]['statements'].keys())
life = {}
for sid in ids:
    o = [s['statements'][sid]['o'] for s in S]
    sc = [s['screens'] for s in S]
    size = max(s['statements'][sid]['size'] for s in S)
    idx = [i for i, v in enumerate(o) if v >= 0.05]
    if not idx: continue
    a, g = idx[0], idx[-1]
    fidx = [i for i, v in enumerate(o) if v >= 0.90]
    f, dpt = (fidx[0], fidx[-1]) if fidx else (a, a)
    life[sid] = dict(arrive=sc[a], full=sc[f], depart=sc[dpt], gone=sc[g],
                     hold=sc[dpt]-sc[f], span=sc[g]-sc[a], size=size,
                     ai=a, fi=f, di=dpt, gi=g)
    print(f"{sid:<34}{sc[a]:>8.2f}{sc[f]:>8.2f}{sc[dpt]:>8.2f}{sc[g]:>8.2f}"
          f"{sc[dpt]-sc[f]:>8.2f}{sc[g]-sc[a]:>8.2f}{size:>6}")

# ------------------------------------------------------------- simultaneity
print("\n## TWO DISPLAY OBJECTS LEGIBLE AT ONCE  (>=0.35 opacity, >=40px)")
overlaps = []
for s in S:
    live = [(k, v) for k, v in s['statements'].items() if v['o'] >= 0.35]
    if len(live) >= 2:
        overlaps.append((s['screens'], [f"{k}@{v['o']:.2f}" for k, v in live]))
if overlaps:
    grp = []
    for sc, l in overlaps:
        key = tuple(sorted(x.split('@')[0] for x in l))
        if grp and grp[-1][0] == key: grp[-1][2] = sc
        else: grp.append([key, sc, sc])
    for key, a, b in grp:
        print(f"  {a:6.2f} → {b:6.2f}  ({b-a+per:.2f} screens)  {' + '.join(key)}")
else:
    print("  none")

# ------------------------------------------------------------- dead holds
# A dead hold is scroll that buys no perceptual change: the frame does not
# move, no statement's opacity moves, the ink does not move, and the
# instrument does not move. The altitude always moves, so the ATMOSPHERE is
# excluded from this test on purpose — a stretch where the sky is the only
# thing changing is exactly what §8 calls good silence, and it is measured
# separately below.
print("\n## PERCEPTUAL STILLNESS (frame, type and instrument all static)")
still = []
for i in range(1, len(S)):
    a, b = S[i-1], S[i]
    dstate = sum(abs(b['statements'][k]['o'] - a['statements'][k]['o']) for k in ids)
    dink = abs(b['inkFrac'] - a['inkFrac'])
    oa, ob = owner(a), owner(b)
    dfield = abs((ob['fieldTop'] or 0) - (oa['fieldTop'] or 0)) / H if oa and ob and oa['stage'] == ob['stage'] else 1
    dinstr = abs(b['instrument'] - a['instrument'])
    quiet = dstate < 0.02 and dink < 0.0006 and dfield < 0.004 and dinstr < 0.006
    still.append(quiet)
runsq = []
i = 0
while i < len(still):
    if still[i]:
        j = i
        while j < len(still) and still[j]: j += 1
        runsq.append((S[i]['screens'], S[j]['screens'] if j < len(S) else S[-1]['screens']))
        i = j
    else: i += 1
for a, b in runsq:
    if b - a < 0.12: continue
    st = [r['stage'] for r in rows if a <= r['screens'] <= b]
    print(f"  {a:6.2f} → {b:6.2f}   {b-a:5.2f} screens   {sorted(set(x for x in st if x))}")
if not [1 for a,b in runsq if b-a >= 0.12]: print("  none over 0.12 screens")

# ------------------------------------------------------------- empty frames
print("\n## LOW-INK FRAMES (<0.4% of the viewport in legible type)")
EMPTY = 0.004
emp = [s['inkFrac'] < EMPTY for s in S]
i = 0
while i < len(emp):
    if emp[i]:
        j = i
        while j < len(emp) and emp[j]: j += 1
        a, b = S[i]['screens'], S[min(j, len(S)-1)]['screens']
        if b - a >= 0.10:
            st = sorted(set(r['stage'] for r in rows[i:j] if r['stage']))
            print(f"  {a:6.2f} → {b:6.2f}   {b-a:5.2f} screens   {st}   metres {S[i]['metres']}→{S[min(j,len(S)-1)]['metres']}")
        i = j
    else: i += 1

# ------------------------------------------------------------- instrument
print("\n## INSTRUMENT PRESENCE")
ins = [(s['screens'], s['instrument'], s['metres']) for s in S]
on = [x for x in ins if x[1] > 0.02]
print(f"  present from {on[0][0]:.2f} to {on[-1][0]:.2f} screens" if on else "  never present")
seg, cur = [], None
for sc, v, m_ in ins:
    st = 'on' if v > 0.02 else 'off'
    if cur and cur[0] == st: cur[2] = sc; cur[4] = max(cur[4], v)
    else:
        cur = [st, sc, sc, m_, v]; seg.append(cur)
for st, a, b, m_, peak in seg:
    if b - a < 0.05: continue
    print(f"  {st:<4} {a:6.2f} → {b:6.2f}  ({b-a:5.2f} screens)  peak {peak:.2f}")

# ------------------------------------------------------------- shares
print("\n## JOURNEY SHARE")
tot = {}
for r in runs:
    if not r['stage']: continue
    tot.setdefault(r['level'], 0.0)
    tot[r['level']] += r['to'] - r['from'] + per
for k, v in sorted(tot.items()):
    print(f"  {k:<9}{v:7.2f} screens   {100*v/TOTAL:5.1f}%")
proc = sum(r['to']-r['from']+per for r in runs if r['stage'] == 'process')
print(f"  {'process':<9}{proc:7.2f} screens   {100*proc/TOTAL:5.1f}%   (of which passages)")

# ------------------------------------------------------------- pace table
print("\n## THE SAME NUMBERS IN SECONDS (§28)")
print("  A screen of scroll, at three realistic paces on this viewport:")
for name, pxs in (('unhurried', 520), ('typical', 950), ('impatient', 1800)):
    print(f"    {name:<11}{pxs:>5} px/s → {H/pxs:5.2f} s per screen → whole journey {TOTAL*H/pxs:6.1f} s")
