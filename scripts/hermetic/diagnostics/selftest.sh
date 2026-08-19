#!/bin/bash
# The §37 self-test, end to end: servers up, six arms, verdict, servers down.
#
# Every arm is EXPECTED to fail — that is how the fixture gets a failure to
# write a bundle for. The exit code of this script comes from
# verify-selftest.mjs, not from Playwright.
#
#   scripts/hermetic/diagnostics/selftest.sh [<work-dir>] [<dist-dir>]
set -u
WORK="${1:-$(mktemp -d)}"
DIST="${2:-dist}"
PORT=4322
STALL=4399

mkdir -p "$WORK/diag"
rm -rf "$WORK/failures" "$WORK/diag"/*.jsonl 2>/dev/null

STRATOS_NAV_DIAG_DIR="$WORK/diag" node scripts/test-server.mjs "$PORT" "$DIST" > "$WORK/server.log" 2>&1 &
MAIN=$!
STRATOS_NAV_DIAG_DIR="$WORK/diag" node scripts/hermetic/diagnostics/stall-server.mjs "$STALL" > "$WORK/stall.log" 2>&1 &
STALLPID=$!
trap 'kill $MAIN $STALLPID 2>/dev/null' EXIT

for _ in $(seq 1 40); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/kkv.html" && break
  sleep 0.25
done

STRATOS_DIAG_PORT="$PORT" \
STRATOS_NAV_DIAG_DIR="$WORK/diag" \
STRATOS_NAV_DIAG_STALL_PORT="$STALL" \
STRATOS_NAV_DIAG_RUN=selftest \
STRATOS_NAV_DIAG_OUT="$WORK/failures" \
PLAYWRIGHT_JSON_OUTPUT_NAME="$WORK/selftest.json" \
  npx playwright test --config scripts/hermetic/diagnostics/playwright.diagnostics.config.ts \
    nav-boundary-selftest.spec.ts --project=mobile-390 --workers=1 \
    > "$WORK/playwright.log" 2>&1

echo "work dir: $WORK"
node scripts/hermetic/diagnostics/verify-selftest.mjs "$WORK/failures/selftest" "$WORK/selftest.json"
