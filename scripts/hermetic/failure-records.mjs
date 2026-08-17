#!/usr/bin/env node
/**
 * One machine-readable record per surviving failure — §22.
 *
 * WHY
 * ---
 * `Timeout 30000ms exceeded` is not a failure report. It says a budget ran out
 * and nothing about which of the eight things that had to happen did not. The
 * previous investigation spent a great deal of effort on a population of
 * failures described that way, and the correction it eventually produced —
 * that they were not `page.goto` stalls at all — was only possible because
 * someone went back and instrumented the boundary by hand.
 *
 * §21 makes that permanent: a generic timeout may NOT be classified as a
 * navigation stall unless surviving artefacts prove the lifecycle boundary, and
 * every navigation-shaped failure must report its LAST CONFIRMED EVENT. This
 * script derives that from the error text and the surrounding run state, and
 * where the text does not support a classification it says so rather than
 * guessing — `UNCLASSIFIED — insufficient artefact` is a valid and useful
 * answer, and it is the honest one for a bare timeout.
 *
 * WHAT IT JOINS
 * -------------
 * Per-failure detail lives in the Playwright report; the state it happened in
 * lives in the run's `gate.json`. Neither is interpretable alone. A record here
 * carries both: the test, and the subject hash / server identity / load profile
 * that were true while it ran.
 *
 * Usage:
 *   node scripts/hermetic/failure-records.mjs <gate.json> [<gate.json> ...]
 *        [--out _build/reports/hermetic-gate/failures]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const OUT = flag('out', '_build/reports/hermetic-gate/failures');
const inputs = argv.filter((a) => !a.startsWith('--') && a.endsWith('.json') && existsSync(a));

if (!inputs.length) {
  console.error('usage: failure-records.mjs <gate.json> [...] [--out <dir>]');
  process.exit(2);
}

/**
 * The boundary a failure actually reached, read from what the error SAYS
 * happened rather than from the test's name.
 *
 * Ordered most-specific first. Anything that falls through is explicitly
 * unclassified — §21 forbids inferring a navigation boundary from a bare
 * timeout, so this returns the refusal rather than a plausible guess.
 */
function lastConfirmedEvent(errors) {
  const text = (errors ?? []).join('\n');
  const at = (re, label) => (re.test(text) ? label : null);
  return (
    at(/Execution context was destroyed/i, 'navigation occurred — context destroyed mid-evaluate') ??
    at(/net::ERR_|NS_ERROR_|Connection (refused|closed)/i, 'transport error before response') ??
    at(/page\.goto.*Timeout|Timeout.*page\.goto/i, 'page.goto did not resolve — boundary NOT proven (see §21)') ??
    at(/waiting for locator\(.*\) to be visible/i, 'element never became visible') ??
    at(/locator\.click.*Timeout|element is not (stable|enabled|visible)/i, 'actionability wait expired — input never delivered') ??
    at(/toHaveAttribute|toHaveText|toHaveURL|toEqual|toBe\b/i, 'assertion reached and evaluated — value was wrong') ??
    at(/waitForFunction|expect\.poll/i, 'polled predicate never became true') ??
    at(/strict mode violation/i, 'locator matched multiple elements — test defect, not a stall') ??
    'UNCLASSIFIED — insufficient artefact to name a boundary'
  );
}

/** A timeout is navigation-shaped only if the artefact says so. §21. */
const navigationShaped = (errors) =>
  /page\.goto|waitForURL|goBack|goForward|waitForNavigation/i.test((errors ?? []).join('\n'));

mkdirSync(OUT, { recursive: true });

const index = [];
for (const input of inputs) {
  const g = JSON.parse(readFileSync(input, 'utf8'));
  const failures = g.allFailingTests ?? [];

  for (const [i, t] of failures.entries()) {
    const record = {
      // identity
      test: `${t.file?.split('/').pop() ?? '?'}:${t.line ?? '?'} ${t.title ?? ''}`.trim(),
      file: t.file,
      line: t.line,
      title: t.title,
      project: t.project,
      gate: t.gate,

      // run
      runId: g.runId,
      commit: g.commit,
      startedAt: g.startedAt,
      durationMs: t.duration,
      status: t.status,
      retries: t.retries ?? 0,

      // §21 — the boundary, and whether it may be called a navigation failure
      lastConfirmedEvent: lastConfirmedEvent(t.errors),
      navigationShaped: navigationShaped(t.errors),
      mayBeCalledNavigationStall: false,
      errors: t.errors,

      // §22 — the state it happened in
      subjectHashStatus: {
        identical: g.subject?.identical ?? null,
        distBefore: g.subject?.before?.dist ?? null,
        distAfter: g.subject?.after?.dist ?? null,
        canaryEvents: g.canaryEventCount ?? 0,
      },
      runValidity: { valid: g.valid, invalidReasons: g.invalidReasons ?? [] },
      serverState: (g.servers ?? []).map((s) => ({
        name: s.name, kind: s.kind, port: s.port, pid: s.pid,
        readyAt: s.readyAt, stoppedAt: s.stoppedAt, exitCode: s.exitCode,
      })),
      environmentLoad: g.load ?? null,
    };

    /* The one claim this file refuses to make on its own. A navigation-shaped
       timeout is only a NAVIGATION STALL if an artefact proves the lifecycle
       boundary was crossed, and a Playwright error message does not. Left false
       here and set by hand, in a report, with the evidence beside it. */
    record.mayBeCalledNavigationStall = false;

    const name = `${g.runId}-${String(i + 1).padStart(2, '0')}-${(t.project ?? 'x').replace(/\W+/g, '')}.json`;
    writeFileSync(join(OUT, name), `${JSON.stringify(record, null, 2)}\n`);
    index.push({ file: name, test: record.test, project: record.project, runId: g.runId, lastConfirmedEvent: record.lastConfirmedEvent });
  }
}

writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`${index.length} failure record(s) written to ${OUT}`);
for (const r of index) console.log(`  [${r.runId}] [${r.project}] ${r.test}\n      -> ${r.lastConfirmedEvent}`);
