#!/bin/sh
# §36 and §44 — the matched pairs, in one run, at one pacing.
#
# `before` is reconstructed by `before.py revert`, which inverts this phase's
# edits and nothing else, and the reconstruction is verified against
# `scan-desktop-before.json` — a scan taken on the real page before any edit was
# made — before any recording is kept. See before.py.
set -e
root=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$root"
T=_build/reports/luxury-art-direction/temporal
V=950                 # px/s, the middle of the three paces used throughout

step () { printf '\n=== %s ===\n' "$1"; }

step "BEFORE — reconstructing"
python3 $T/before.py revert
npm run build:home >/dev/null 2>&1
node $T/scan.mjs --width 1440 --height 900 --steps 600 --tag desktop-verify >/dev/null
python3 $T/before.py check   # aborts if the reconstruction is not the original

step "BEFORE — recording"
node $T/film.mjs --tag desktop-natural-before --profile natural    --width 1440 --height 900 --velocity $V --frames
node $T/film.mjs --tag mobile-natural-before  --profile natural    --width 390  --height 844 --velocity $V --frames

step "AFTER — restoring"
python3 $T/before.py restore
npm run build:home >/dev/null 2>&1
npm run build:full >/dev/null 2>&1

step "AFTER — recording"
node $T/film.mjs --tag desktop-natural-after     --profile natural    --width 1440 --height 900 --velocity $V --frames
node $T/film.mjs --tag desktop-continuous-after  --profile continuous --width 1440 --height 900 --velocity $V --frames
node $T/film.mjs --tag mobile-natural-after      --profile natural    --width 390  --height 844 --velocity $V --frames
node $T/film.mjs --tag mobile-continuous-after   --profile continuous --width 390  --height 844 --velocity $V --frames

step "AFTER — final scans"
node $T/scan.mjs        --width 1440 --height 900 --steps 600 --tag desktop-after
node $T/scan-mobile.mjs --width 390  --height 844             --tag mobile-after

