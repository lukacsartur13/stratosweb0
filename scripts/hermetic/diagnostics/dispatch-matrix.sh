#!/bin/bash
# The controlled matrix — §18 stage B, §19 lifetime models, §21 routes, §22 about:blank.
#
# Sequential, never concurrent: two arms sharing this host would contend for CPU
# and for the same port, and the comparison §20 asks for is only readable if the
# arms differ in the ONE variable they are named for.
set -u
cd "$(dirname "$0")/../../.."
R() { echo; echo "### $* ###"; node scripts/hermetic/nav-dispatch.mjs "$@" || true; }

# §18 stage B — to 2000 total on the exact contract.
R --stage B  --model fresh-context --attempts 1500 --parallel 5 --neighbours --id-offset 1000 --keep-success 0

# §19 — four lifetime models, same route, same everything else.
R --stage L-A --model reused-page   --attempts 300 --parallel 5 --neighbours --id-offset 10000 --keep-success 0
R --stage L-B --model fresh-page    --attempts 300 --parallel 5 --neighbours --id-offset 11000 --keep-success 0
R --stage L-D --model fresh-browser --attempts 300 --parallel 5 --neighbours --id-offset 13000 --keep-success 0

# §21 — route control, browser/context conditions identical.
R --stage R-kkv   --model fresh-context --route /kkv.html        --attempts 300 --parallel 5 --neighbours --id-offset 20000 --keep-success 0
R --stage R-light --model fresh-context --route /impresszum.html --attempts 300 --parallel 5 --neighbours --id-offset 21000 --keep-success 0

# §22 — the about:blank control: same contract, page warmed on a trivial local
# page first. If only an initial navigation can stall, this arm is where it stops.
R --stage W-warm --model fresh-context --attempts 300 --parallel 5 --neighbours --warmup --id-offset 30000 --keep-success 0
