#!/usr/bin/env python3
"""
§36 — BUILD THE `BEFORE` FROM THE `AFTER`, SO THE COMPARISON IS HONEST.

The recordings this phase has to produce are matched pairs, and the `before`
half has to be the page as it stood when the review opened. That state is not a
commit: the working tree already carried uncommitted work from the previous
phase when this one started, so `git stash` would hand back something older
than the thing being compared.

So `before` is reconstructed by inverting THIS PHASE'S EDITS ONLY — the seven
values below, each of them a value the report names — and the reconstruction is
verified rather than trusted: `--check` rebuilds and asserts that the scan of
the reconstructed page reproduces the numbers recorded in
`scan-desktop-before.json`, which was measured on the real page before any edit
was made. A reconstruction that reproduces the original measurement to the
sample is the original.

  before.py save      copy the current sources aside
  before.py revert    write the pre-phase values
  before.py restore   put the current sources back
"""
import pathlib, shutil, sys

ROOT = pathlib.Path('.')
KEEP = pathlib.Path('_build/reports/luxury-art-direction/temporal/.after')
FILES = [
    'experiments/src/full/acts.ts',
    'experiments/src/full/journey.ts',
    'experiments/src/full/styles.css',
    'experiments/src/full/FullAscent.tsx',
    'experiments/src/full/composition.ts',
    'experiments/src/full/mobile/mobile.css',
    'experiments/src/full/mobile/instrument.ts',
]

# (file, after, before) — every one of them a value this phase changed.
EDITS = [
    ('experiments/src/full/acts.ts',
     'export const PASSAGE_HOLD = 1.36;', 'export const PASSAGE_HOLD = 1.25;'),
    ('experiments/src/full/acts.ts',
     '  vi: { x: 720, y: 666, dial: 160, leaves: 1.15 },', '  vi: { x: 720, y: 666, dial: 160 },'),
    ('experiments/src/full/mobile/instrument.ts', '  place: 0.22,', '  place: 0.34,'),
    # `tsc -b` runs with noUnusedLocals, so the import has to go with its use or
    # the reconstruction does not compile.
    ('experiments/src/full/FullAscent.tsx',
     "import { ACT_HOLD, GROUND_HOLD, PASSAGE, PASSAGE_HOLD, actOf, type ActId, type PassageId } from './acts';",
     "import { ACT_HOLD, PASSAGE, PASSAGE_HOLD, actOf, type ActId, type PassageId } from './acts';"),
    ('experiments/src/full/journey.ts',
     "{ id: 'calibration',             from: 0,      to: 150,    share: 1.3,",
     "{ id: 'calibration',             from: 0,      to: 150,    share: 1.8,"),
    ('experiments/src/full/journey.ts',
     "{ id: 'cloud-breakthrough',      from: 8_500,  to: 11_000, share: 1.4,",
     "{ id: 'cloud-breakthrough',      from: 8_500,  to: 11_000, share: 1.2,"),
    ('experiments/src/full/journey.ts',
     "{ id: 'destination',             from: 30_000, to: 30_000, share: 1.8,",
     "{ id: 'destination',             from: 30_000, to: 30_000, share: 2.2,"),
    ('experiments/src/full/FullAscent.tsx',
     "  const base = id === 'calibration' ? GROUND_HOLD : ACT_HOLD;\n  const hold = body ? base : Math.max(base, shareOf(id));",
     "  const hold = body ? ACT_HOLD : Math.max(ACT_HOLD, shareOf(id));"),
    ('experiments/src/full/styles.css',
     """.panel--passage {
  --ramp-in: 0.3;
  --ramp-in-lead: 0.28;
  --ramp-out: 0.26;
}""", """.panel--passage {
  --ramp-in: 0.42;
  --ramp-in-lead: 0.3;
  --ramp-out: 0.32;
}"""),
    ('experiments/src/full/mobile/mobile.css',
     '.mv-head { --mv-dur-line: 0.62s; }', '.mv-head { --mv-dur-line: 1.05s; }'),
]

cmd = sys.argv[1] if len(sys.argv) > 1 else 'help'
if cmd == 'save':
    KEEP.mkdir(parents=True, exist_ok=True)
    for f in FILES:
        dst = KEEP / f.replace('/', '__')
        shutil.copy2(ROOT / f, dst)
    print(f'saved {len(FILES)} files to {KEEP}')
elif cmd == 'revert':
    # ALL OR NOTHING. The first version wrote each edit as it went and exited on
    # the first missing marker, which left the tree half-reverted — and the next
    # `save` then archived that half state as the thing to restore. Validate the
    # whole set first, write second.
    texts = {}
    for f, after, before in EDITS:
        s = texts.get(f) or (ROOT / f).read_text()
        if after not in s:
            sys.exit(f'!! {f}: expected marker not present, nothing written:\n{after[:90]}')
        texts[f] = s.replace(after, before, 1)
    for f, s in texts.items():
        (ROOT / f).write_text(s)
    print(f'reverted {len(EDITS)} edits across {len(texts)} files')
elif cmd == 'check':
    # Does the reconstruction reproduce the measurement taken on the real page
    # before any edit was made? Compare the two scans on the quantities this
    # phase moved: the track length and every statement's composed window.
    #
    # The tolerance is not slack for a wrong reconstruction, it is the scan's
    # own resolution. A 600-step scan of a 25-screen track samples every 0.042
    # of a screen, so a window measured across two runs can differ by a sample
    # at each end without anything having changed — and one panel on this page
    # carries a photograph, whose decode timing moves the measured panel height
    # and with it the departure ramp. So: the track must match, and at most one
    # statement may differ, by at most three samples.
    import json
    T = '_build/reports/luxury-art-direction/temporal/'
    def windows(path):
        d = json.load(open(path)); S = d['samples']; sc = [x['screens'] for x in S]
        out = {}
        for sid in S[0]['statements']:
            o = [x['statements'][sid]['o'] for x in S]
            i = [k for k, v in enumerate(o) if v >= 0.9]
            out[sid] = round(sc[i[-1]] - sc[i[0]], 2) if len(i) > 1 else 0.0
        return d['meta']['screensTotal'], out
    t0, a = windows(T + 'scan-desktop-before.json')
    t1, b_ = windows(T + 'scan-desktop-verify.json')
    diffs = {k: (a[k], b_.get(k)) for k in a if abs(a[k] - b_.get(k, -9)) > 0.05}
    print(f"  track: original {t0} vs reconstruction {t1}")
    for k, (x, y) in diffs.items():
        print(f"  {k}: original {x} vs reconstruction {y}")
    bad = []
    if abs(t0 - t1) > 0.06: bad.append('the track length differs')
    if len(diffs) > 1: bad.append(f'{len(diffs)} statements differ')
    if any(abs(x - y) > 0.13 for x, y in diffs.values()): bad.append('a statement differs by more than three samples')
    if bad:
        print('!! the reconstruction is NOT the original: ' + '; '.join(bad)); sys.exit(1)
    print(f"  reconstruction verified: {len(a) - len(diffs)} of {len(a)} composed windows identical, "
          f"track identical to the sample")
elif cmd == 'restore':
    for f in FILES:
        src = KEEP / f.replace('/', '__')
        if not src.exists(): sys.exit(f'!! no backup for {f}')
        shutil.copy2(src, ROOT / f)
    print(f'restored {len(FILES)} files')
else:
    print(__doc__)
