#!/usr/bin/env python3
"""
What a 24-sample equal-progress contact sheet contains, counted from the scan
rather than from the picture — so the before/after comparison is reproducible
and does not depend on which frame the screencast happened to hand back.
"""
import json, sys
def counts(path, n=24, t=0.9):
    d = json.load(open(path)); S = d['samples']
    picks = [min(S, key=lambda s: abs(s['p'] - i / (n - 1))) for i in range(n)]
    passage = sum(1 for s in picks if any(v['o'] >= t for k, v in s['statements'].items() if k.endswith('statement')))
    master  = sum(1 for s in picks if any(v['o'] >= t for k, v in s['statements'].items() if k.endswith('monument')))
    closing = sum(1 for s in picks if s['statements'].get('destination:monument', {}).get('o', 0) >= t)
    hero    = sum(1 for s in picks if s['statements'].get('calibration:monument', {}).get('o', 0) >= t)
    nodisp  = sum(1 for s in picks if s['biggest'] < 40)
    empty   = [s['inkFrac'] < 0.004 for s in picks]
    run = best = 0
    for e in empty:
        run = run + 1 if e else 0
        best = max(best, run)
    return dict(passage=passage, master=master, closing=closing, hero=hero,
                nodisplay=nodisp, emptySamples=sum(empty), worstEmptyRun=best)
T = '_build/reports/luxury-art-direction/temporal/'
for t in (0.9, 0.5):
    a = counts(T + 'scan-desktop-before.json', t=t)
    b = counts(T + 'scan-desktop-after.json', t=t)
    print(f"\n--- composed at >= {t} ---")
    print(f"{'':<44}{'before':>8}{'after':>8}")
    for k in a:
        print(f"{k:<44}{a[k]:>8}{b[k]:>8}")
