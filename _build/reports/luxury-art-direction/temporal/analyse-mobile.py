#!/usr/bin/env python3
"""§23 / §24 — the portrait temporal map, and what a flick does to it."""
import json, sys
d = json.load(open(sys.argv[1]))
meta, geom, settled, flicks = d['meta'], d['geom'], d['settled'], d['flicks']
H = meta['height']
TOTAL = meta['screensTotal']
print(f"# {meta['tag']}  {meta['width']}x{H}  {TOTAL:.2f} screens  ({meta['doc']}px document)\n")

print("## CHAPTER EXTENTS")
print(f"{'stage':<26}{'level':<9}{'tier':<10}{'px':>7}{'screens':>9}{'from→to':>16}")
for s in geom['secs']:
    a = s['top'] / H
    print(f"{s['stage']:<26}{s['level']:<9}{str(s['tier']):<10}{s['height']:>7}{s['height']/H:>9.2f}"
          f"{'%.2f→%.2f' % (a, a + s['height']/H):>16}")
tot = {}
for s in geom['secs']:
    tot[s['level']] = tot.get(s['level'], 0) + s['height'] / H
print()
for k, v in sorted(tot.items()):
    print(f"  {k:<9}{v:7.2f} screens   {100*v/TOTAL:5.1f}%")
proc = sum(s['height']/H for s in geom['secs'] if s['stage'] == 'process')
print(f"  {'process':<9}{proc:7.2f} screens   {100*proc/TOTAL:5.1f}%")
flow_end = max(s['top'] + s['height'] for s in geom['secs'])
print(f"  after the last chapter: {(meta['doc']-flow_end)/H:.2f} screens "
      f"(the site Arrival panel + footer)")

print("\n## LOW-INK STRETCHES (<0.4% of the frame in legible type)")
per = TOTAL / (len(settled) - 1)
emp = [s['inkFrac'] < 0.004 for s in settled]
i = 0
any_ = False
while i < len(emp):
    if emp[i]:
        j = i
        while j < len(emp) and emp[j]: j += 1
        a, b = settled[i]['screens'], settled[min(j, len(settled)-1)]['screens']
        if b - a >= 0.10:
            any_ = True
            st = sorted({x['stage'] for k in range(i, j) for x in settled[k]['secs']})
            print(f"  {a:6.2f} → {b:6.2f}   {b-a:5.2f} screens   {st}")
        i = j
    else: i += 1
if not any_: print("  none over 0.10 screens")

print("\n## ALTIMETER (opacity of the fixed overlay, settled at each position)")
runs, cur = [], None
for s in settled:
    st = 'on' if s['instO'] > 0.02 else 'off'
    if cur and cur[0] == st:
        cur[2] = s['screens']; cur[3] = max(cur[3], s['instO']); cur[4] = max(cur[4], s['instScale'])
    else:
        cur = [st, s['screens'], s['screens'], s['instO'], s['instScale']]; runs.append(cur)
for st, a, b, peak, sc in runs:
    if b - a < 0.04 and st == 'off': continue
    print(f"  {st:<4} {a:6.2f} → {b:6.2f}  ({b-a:5.2f} screens)  peak opacity {peak:.2f}  peak scale {sc:.2f}")
tot_on = sum(b-a for st,a,b,_,_ in runs if st=='on')
print(f"  present for {tot_on:.2f} of {TOTAL:.2f} screens ({100*tot_on/TOTAL:.0f}%)")

print("\n## STATEMENT REVEAL LINE, BY CHAPTER")
print(f"{'stage':<26}{'line':<9}{'size':>6}   statement")
for s in geom['secs']:
    h = settled[0]['heads'].get(s['stage'])
    line = h['line'] if h else '?'
    print(f"{s['stage']:<26}{line:<9}{h['h'] if h else 0:>6}")

print("\n## §24 — WHAT A FLICK OUTRUNS")
print("  `travel` is how far a chapter statement still is from home, as a")
print("  fraction of its own line height, at the moment it leaves the frame.")
print("  1.00 = never started. 0.00 = fully arrived.\n")
for v, trace in sorted(flicks.items(), key=lambda kv: int(kv[0])):
    print(f"  --- {v} px/s  ({meta['doc']/int(v):.1f} s for the whole page, "
          f"{H/int(v)*1000:.0f} ms per screen) ---")
    # for each head, the travel remaining at the last frame in which its box
    # was still meaningfully on screen (top < 70% of viewport = still readable)
    # The reading position: sample each statement at the frame where its box
    # is closest to a third of the way down the screen — where a reader
    # actually looks — rather than at the last frame it was technically on
    # screen, which is after they have scrolled past it.
    READ = H * 0.33
    best = {}
    for row in trace:
        for stage, h in row['heads'].items():
            d = abs(h['top'] - READ)
            if stage not in best or d < best[stage][0]:
                best[stage] = (d, h)
    # And: did it ever finish arriving while still comfortably on screen?
    finished = {}
    for row in trace:
        for stage, h in row['heads'].items():
            if 0 <= h['top'] <= H * 0.8 and h['travel'] <= 0.05:
                finished[stage] = True
    for s in geom['secs']:
        stage = s['stage']
        e = best.get(stage)
        if not e:
            print(f"    {stage:<26} not sampled")
            continue
        h = e[1]
        flag = ''
        if h['travel'] > 0.5: flag = '  <-- more than half still out'
        elif h['travel'] > 0.15: flag = '  <-- still arriving'
        fin = 'yes' if finished.get(stage) else 'NO '
        print(f"    {stage:<26} travel-at-reading-line {h['travel']:.2f}  landed-on-screen {fin}{flag}")
    io = [r['instO'] for r in trace]
    print(f"    instrument peak opacity over the whole flick: {max(io):.2f}")
    print()
