#!/usr/bin/env bash
# Repeated repository-wide runs against the INSTRUMENTED server.
#
# The synthetic harness could not reproduce the failure: 6 500 WebKit
# navigations of the exact failing route, serial and five-abreast, produced zero
# stalls. So the reproduction has to come from the suite itself — but the suite's
# own server keeps no record, which is why the previous pass could see a timeout
# and not what the server did during it.
#
# `playwright.config.ts` sets `reuseExistingServer: !CI`, so starting
# `nav-server.mjs` on the suite's own port 4322 first means Playwright adopts it
# instead of launching `test-server.mjs`. The suite is otherwise completely
# unmodified: same projects, same five workers, same tests, same timeouts, no
# retries. The only additions are the server's NDJSON log and Playwright traces
# on failure (§30 — failures only, never thousands of successful ones).
#
# Usage: scripts/webkit-nav/suite-loop.sh <runs> <logdir>
set -u

RUNS="${1:-6}"
LOGDIR="${2:?usage: suite-loop.sh <runs> <logdir>}"
OUT="_build/reports/webkit-navigation/suite"

mkdir -p "$LOGDIR" "$OUT"

SERVER_LOG="$LOGDIR/suite-server.ndjson"
: > "$SERVER_LOG"

node scripts/webkit-nav/nav-server.mjs 4322 dist "$SERVER_LOG" &
SRV=$!
trap 'kill "$SRV" 2>/dev/null' EXIT

# Wait for it rather than guessing.
for _ in $(seq 1 100); do
  curl -sf -o /dev/null "http://127.0.0.1:4322/index.html" && break
  sleep 0.1
done

echo "suite-loop: server pid $SRV, $RUNS runs, log $SERVER_LOG"

for i in $(seq 1 "$RUNS"); do
  START_LOAD=$(uptime | sed -E 's/.*load averages?: ([0-9.]+).*/\1/')
  echo "=== RUN $i start $(date -u +%FT%TZ) load1=$START_LOAD"
  PLAYWRIGHT_JSON_OUTPUT_NAME="$OUT/run-$i.json" \
    npx playwright test --trace retain-on-failure --output "$OUT/artifacts-$i" \
    > "$LOGDIR/suite-run-$i.log" 2>&1
  CODE=$?
  END_LOAD=$(uptime | sed -E 's/.*load averages?: ([0-9.]+).*/\1/')
  echo "=== RUN $i exit=$CODE end $(date -u +%FT%TZ) load1=$END_LOAD"
  # One line per run so the monitor sees a result even when everything passed.
  grep -E "^\s+[0-9]+ (passed|failed|skipped|flaky)|^\s+[0-9]+ (passed|failed)" "$LOGDIR/suite-run-$i.log" | tail -5
  grep -E "^\s+[0-9]+\) " "$LOGDIR/suite-run-$i.log" | head -20
done

echo "suite-loop: complete"
