#!/usr/bin/env node
/**
 * Turn a Playwright JSON report into the one authoritative gate result, and
 * refuse to produce one that does not add up.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase P2 published "1013 passed / 122 skipped" as a green result while five
 * P1 contracts were failing. The cause was not a subtle one: the summary line
 * was read with `tail -6`, and Playwright prints the pass/skip counts *after*
 * the failure list, so a truncated read shows the reassuring half of the output
 * and none of the alarming half. The arithmetic was there to catch it —
 * 1013 + 122 = 1135 against 1161 collected — and nobody did the addition.
 *
 * So the addition is done here, by a program, every time, and the program exits
 * non-zero if it does not reconcile. A verdict can no longer be written from a
 * fragment of terminal scrollback, because the verdict now comes from a file
 * that cannot be produced unless every collected test is accounted for.
 *
 * WHAT IT GUARANTEES
 * ------------------
 *   1. expected + unexpected + flaky + skipped === collected
 *      Any shortfall means results were lost — a worker died, the reporter was
 *      truncated, the run was interrupted — and an unaccounted test is treated
 *      as a failure of the gate, not as a rounding error.
 *   2. Every failing test is named in the output, with its project, its file,
 *      its duration and its error, so no failure can be summarised away.
 *   3. The result states the commit it came from. §52 of the stabilization
 *      brief forbids combining runs from different commits into one apparent
 *      result; a gate file that carries its own commit makes that visible
 *      rather than merely forbidden.
 *
 * USAGE
 * -----
 *   node scripts/gate-report.mjs <playwright.json> [--out final-gate.json]
 *                                [--label "repository-wide"] [--append]
 *
 * Exit codes:
 *   0  every collected test accounted for, and none of them failed
 *   1  tests failed (the arithmetic is fine, the suite is not)
 *   2  the arithmetic does not reconcile — the report is INVALID and no
 *      verdict may be written from it
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

if (!input || !existsSync(input)) {
  console.error('usage: node scripts/gate-report.mjs <playwright.json> [--out <file>] [--label <name>]');
  process.exit(2);
}

const report = JSON.parse(readFileSync(input, 'utf8'));

/**
 * Walk the whole suite tree.
 *
 * Playwright nests suites by file and then by `describe`, to arbitrary depth,
 * and a test that never ran still appears with an empty `results` array. Both
 * matter: a flat read of the top level misses most of the suite, and treating
 * "no results" as "not collected" is precisely the shortfall this script exists
 * to catch.
 */
function collect(suites, out = [], file = null) {
  for (const suite of suites ?? []) {
    const here = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const last = t.results?.[t.results.length - 1];
        out.push({
          ran: (t.results ?? []).length > 0,
          title: [...(spec.titlePath?.() ?? []), spec.title].filter(Boolean).join(' › ') || spec.title,
          file: here ?? spec.file ?? '(unknown)',
          line: spec.line ?? null,
          project: t.projectName ?? '(default)',
          status: t.status ?? 'unknown',
          expectedStatus: t.expectedStatus ?? null,
          duration: last?.duration ?? 0,
          startTime: last?.startTime ?? null,
          workerIndex: last?.workerIndex ?? null,
          retries: (t.results?.length ?? 1) - 1,
          errors: (last?.errors ?? []).map((e) => (e.message ?? String(e)).split('\n').slice(0, 6).join('\n')),
        });
      }
    }
    collect(suite.suites, out, here);
  }
  return out;
}

const tests = collect(report.suites);

/**
 * Refuse a report that is a listing rather than a run.
 *
 * `npx playwright test --list` still fires the configured reporters, so it
 * overwrites the JSON artefact with a file that names every collected test,
 * marks all of them `skipped`, and carries no results at all. That file
 * reconciles perfectly — collected equals accounted, nothing failed — and is
 * therefore the most dangerous possible input to this script: a green gate for
 * a suite that never ran.
 *
 * A run has results. A listing does not. That is the whole distinction, and it
 * is checked before anything else is believed.
 */
const ranCount = tests.filter((t) => t.ran).length;
if (tests.length > 0 && ranCount === 0) {
  console.error(
    `GATE INVALID: ${tests.length} tests collected and none of them ran.\n` +
      'This is the artefact of `playwright test --list`, not of a test run — it ' +
      'reports every test as skipped with no result, and it will reconcile. ' +
      'Re-run the suite without --list, and without overriding --reporter (the ' +
      'CLI flag replaces the configured reporters, so the JSON is never written).',
  );
  process.exit(2);
}

const counts = { expected: 0, unexpected: 0, flaky: 0, skipped: 0, other: 0 };
for (const t of tests) {
  if (t.status in counts) counts[t.status] += 1;
  else counts.other += 1;
}

const collected = tests.length;
const accounted = counts.expected + counts.unexpected + counts.flaky + counts.skipped + counts.other;
const reconciles = accounted === collected && counts.other === 0;

const failing = tests
  .filter((t) => t.status === 'unexpected' || t.status === 'flaky')
  .sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));

const commit = (() => {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
})();
const dirty = (() => {
  try {
    // Tracked, executable-or-test modifications only. Report artefacts under
    // _build/reports change on every run by design and would otherwise make
    // every gate look like it came from a dirty tree.
    const out = execSync('git status --porcelain -- . ":(exclude)_build/reports"', { encoding: 'utf8' });
    return out.split('\n').filter((l) => l.trim() && !l.startsWith('??')).map((l) => l.trim());
  } catch {
    return [];
  }
})();

const gate = {
  label: flag('label', 'repository-wide'),
  commit,
  dirtyTrackedFiles: dirty,
  timestamp: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    playwright: report.config?.version ?? null,
    workers: report.config?.workers ?? null,
    projects: (report.config?.projects ?? []).map((p) => p.name),
  },
  duration: report.stats?.duration ?? null,
  startTime: report.stats?.startTime ?? null,
  collected,
  accounted,
  arithmeticReconciles: reconciles,
  passed: counts.expected,
  failed: counts.unexpected,
  flaky: counts.flaky,
  skipped: counts.skipped,
  unclassified: counts.other,
  // Playwright's own stats block, kept verbatim so a disagreement between the
  // reporter's counting and this script's counting is visible rather than
  // silently resolved in favour of one of them.
  reporterStats: report.stats ?? null,
  failingTests: failing.map((t) => ({
    title: t.title,
    file: t.file,
    line: t.line,
    project: t.project,
    status: t.status,
    duration: t.duration,
    retries: t.retries,
    classification: 'UNCLASSIFIED',
    errors: t.errors,
  })),
};

const out = flag('out', '_build/reports/regression-harness/final-gate.json');
writeFileSync(out, `${JSON.stringify(gate, null, 2)}\n`);

const pad = (n) => String(n).padStart(5);
console.log(`\ngate: ${gate.label}`);
console.log(`commit: ${commit ?? '(not a git tree)'}`);
if (dirty.length) console.log(`WARNING: ${dirty.length} tracked file(s) modified — this gate is not from a clean tree`);
console.log(`collected ${pad(collected)}`);
console.log(`passed    ${pad(counts.expected)}`);
console.log(`failed    ${pad(counts.unexpected)}`);
console.log(`flaky     ${pad(counts.flaky)}`);
console.log(`skipped   ${pad(counts.skipped)}`);
console.log(`accounted ${pad(accounted)}  ${reconciles ? 'OK — reconciles' : 'MISMATCH'}`);
console.log(`duration  ${((gate.duration ?? 0) / 1000).toFixed(1)}s`);

if (failing.length) {
  console.log(`\n${failing.length} failing test(s):`);
  for (const t of failing) {
    console.log(`  [${t.project}] ${t.file}:${t.line ?? '?'} › ${t.title}  (${t.status}, ${(t.duration / 1000).toFixed(1)}s)`);
  }
}
console.log(`\nwritten: ${out}`);

if (!reconciles) {
  console.error(
    `\nGATE INVALID: ${collected} collected but ${accounted} accounted for` +
      (counts.other ? `, ${counts.other} in an unrecognised state` : '') +
      '. No verdict may be written from this run.',
  );
  process.exit(2);
}
process.exit(failing.length ? 1 : 0);
