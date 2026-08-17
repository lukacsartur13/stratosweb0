#!/usr/bin/env bash
# The diagnostic matrix, run as one unattended batch.
#
# Every arm holds all variables but one against the A1 reference (WebKit,
# devices['iPhone 13'], /kkv.html, page.goto, waitUntil: 'load', a fresh context
# per navigation, the nav-server, serial). Results accumulate into
# `_build/reports/webkit-navigation/stress-summary.csv`, one line per arm.
#
# The arms, and the question each answers:
#
#   M1/M2   §9   does a weaker lifecycle condition succeed where `load` fails —
#                i.e. is the boundary at commit, at DOMContentLoaded, or later
#   M3-M5   §16  does stall probability track page, context or browser lifetime
#   M6      §22  is the tail generic to WebKit navigation, or site-specific
#   M7      §21  does the 3D homepage behave differently from a static page
#   M8/M9   §23  goto vs reload vs a real in-page link (the transitions.js path)
#   M10     §12  the same sample against the suite's own test-server.mjs
#   M11     §12  the same sample against python3 -m http.server, the server the
#                previous pass replaced — re-tested rather than assumed
#   M12     §20  the documented reduced-motion capability path, as the control
#                for "does the expensive visual component matter"
#
# Ports differ per arm so a lingering socket from one never serves another.
set -u
cd "$(dirname "$0")/../.."

export STRATOS_NAV_SCRATCH="${STRATOS_NAV_SCRATCH:?set STRATOS_NAV_SCRATCH}"
S="node scripts/webkit-nav/stress.mjs"

run() { echo "--- $* ---"; $S "$@" || echo "ARM FAILED: $*"; }

# §9 — the waitUntil matrix. Diagnostic only: the production tests are not
# changed to a weaker condition because it reduces failures.
run --label M1-commit  --n 1000 --path /kkv.html --wait commit           --port 4461
run --label M2-dcl     --n 1000 --path /kkv.html --wait domcontentloaded --port 4462

# §16 — page / context / browser lifetime.
run --label M3-samepage   --n 1000 --path /kkv.html --mode same-page              --port 4463
run --label M4-newpage    --n 1000 --path /kkv.html --mode new-page               --port 4464
run --label M5-newbrowser --n 600  --path /kkv.html --mode new-browser --batch 50 --port 4465

# §22 — the minimal static control page, same server, same browser.
run --label M6-control --n 1000 --path /__navctl/control.html --port 4466

# §21 — the 3D homepage. Fewer iterations because each one boots a WebGL scene.
run --label M7-homepage --n 300 --path /index.html --port 4467

# §23 — the three browser paths, kept as separate categories.
run --label M8-reload --n 1000 --path /kkv.html --action reload --port 4468
run --label M9-link   --n 500  --path /kkv.html --action link   --port 4469

# §12 — server comparison. Same sample, same everything else.
run --label M10-node-server   --n 1000 --path /kkv.html --server node   --port 4470
run --label M11-python-server --n 1000 --path /kkv.html --server python --port 4471

# §20 — the Altimeter control, through the documented reduced-motion path only.
run --label M12-reduced-motion --n 300 --path /index.html --reduced-motion --port 4472

echo "matrix: complete"
