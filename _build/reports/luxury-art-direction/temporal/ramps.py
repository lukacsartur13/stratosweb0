#!/usr/bin/env python3
"""
THE COMPOSED WINDOW — the number §6, §7 and §40 are actually about.

Not the hold in `acts.ts`: the hold is an input, and what a visitor gets is the
hold minus both ramps. Measured off the statement's own effective opacity,
because that is what the eye reads — and reported at three thresholds, because
"legible" is not a step function and a single threshold is an argument waiting
to happen.

  >=0.90   composed. The frame is at full strength and still.
  >=0.60   substantially there. The thought is readable.
  >=0.30   present. Something is on screen; a fast reader may catch it.
"""
import json, sys
d = json.load(open(sys.argv[1]))
meta, S = d['meta'], d['samples']
TOTAL = meta['screensTotal']
ids = list(S[0]['statements'].keys())
sc = [s['screens'] for s in S]
print(f"# {meta['tag']}  {meta['width']}x{meta['height']}  {TOTAL:.2f} screens\n")
print(f"{'statement':<34}{'px':>5}{'>=.90':>8}{'>=.60':>8}{'>=.30':>8}"
      f"{'arrive':>8}{'gone':>8}   seconds at .90 (520/950/1800 px/s)")
rows = {}
for sid in ids:
    o = [s['statements'][sid]['o'] for s in S]
    size = max(s['statements'][sid]['size'] for s in S)
    def win(t):
        i = [k for k, v in enumerate(o) if v >= t]
        return (sc[i[-1]] - sc[i[0]]) if len(i) > 1 else 0.0
    i05 = [k for k, v in enumerate(o) if v >= 0.05]
    if not i05: continue
    w9, w6, w3 = win(0.90), win(0.60), win(0.30)
    H = meta['height']
    secs = "  ".join(f"{w9*H/v:.2f}s" for v in (520, 950, 1800))
    rows[sid] = (w9, w6, w3)
    print(f"{sid:<34}{size:>5}{w9:>8.2f}{w6:>8.2f}{w3:>8.2f}"
          f"{sc[i05[0]]:>8.2f}{sc[i05[-1]]:>8.2f}   {secs}")

acts = {k: v for k, v in rows.items() if k.endswith('monument')}
pas  = {k: v for k, v in rows.items() if k.endswith('statement')}
if acts and pas:
    am = sum(v[0] for v in acts.values()) / len(acts)
    pm = sum(v[0] for v in pas.values()) / len(pas)
    print(f"\n  mean composed window   master {am:.2f} screens   passage {pm:.2f} screens"
          f"   ratio 1 : {am/pm:.1f}" if pm else "")
    print(f"  master total {sum(v[0] for v in acts.values()):.2f}   "
          f"passage total {sum(v[0] for v in pas.values()):.2f}")
