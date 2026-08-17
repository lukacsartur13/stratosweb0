#!/usr/bin/env node
/**
 * The authoritative repeated gate: N complete repository-wide runs over one
 * frozen subject, and the matrix that says whether they agreed.
 *
 * THE QUESTION THIS ANSWERS
 * -------------------------
 * Not "did the suite pass". Six runs where five are green and one fails
 * somewhere new is a WORSE result than six runs that all fail the same test,
 * because the second can be fixed and the first cannot be trusted. §37 is
 * explicit that "mostly green" is not an outcome. So the matrix below is built
 * around *identity* — same collected count, same skipped count, same failure
 * set — and the green rate is a secondary column.
 *
 * WHY THE BUILD IS NOT SKIPPED ON RUNS 2..N
 * -----------------------------------------
 * §51 lists the production build as one of the required gates and §33 requires
 * an identical dist hash across all six, which reads like a contradiction: a
 * rebuild is a write to the served tree.
 *
 * It is not one, because this project's build is byte-for-byte deterministic —
 * verified before the sequence starts, and re-verified by every run through
 * `--expect-dist`. Each run therefore builds the artefact from the frozen
 * source and is required to produce the SAME BYTES; a run that produces
 * different bytes is invalid, and a build that stopped being reproducible would
 * be caught immediately rather than quietly serving six subtly different
 * artefacts. That is strictly more information than skipping the build.
 *
 * WHAT IT REFUSES TO DO
 * ---------------------
 * Runs are never combined across commits (§36) — the commit is captured at the
 * start and every run's own commit is checked against it. An INVALID run is not
 * a failure and not a pass (§38): it is replaced, and the replacement is
 * recorded so the report shows how many attempts the six valid runs cost.
 *
 * Usage:
 *   node scripts/hermetic/six-run.mjs [--runs 6] [--root <dir>] [--max-attempts 9]
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };

const ROOT = resolve(arg('root', process.cwd()));
const RUNS = Number(arg('runs', 6));
const MAX_ATTEMPTS = Number(arg('max-attempts', RUNS + 3));
const PREFIX = arg('prefix', 'gate');
const REPORTS = join(ROOT, '_build/reports/hermetic-gate');
mkdirSync(REPORTS, { recursive: true });

const sh = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: 'inherit', ...opts });

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
console.log(`\nsix-run: ${RUNS} gates over ${commit} in ${ROOT}\n`);

// -- freeze ------------------------------------------------------------------
// One build, then one manifest, and the dist hash from it becomes the reference
// every run must reproduce.
console.log('freezing: build + reference manifest');
if (sh('npm', ['run', 'build']).status !== 0) { console.error('freeze build failed'); process.exit(3); }
if (sh('npm', ['run', 'build:full']).status !== 0) { console.error('freeze build:full failed'); process.exit(3); }

const refPath = join(REPORTS, 'manifests', 'frozen-reference.json');
mkdirSync(join(REPORTS, 'manifests'), { recursive: true });
if (sh('node', ['scripts/hermetic/manifest.mjs', 'capture', '--root', ROOT, '--label', 'frozen-reference', '--out', refPath]).status !== 0) {
  console.error('freeze manifest failed');
  process.exit(3);
}
const ref = JSON.parse(readFileSync(refPath, 'utf8'));
console.log(`frozen dist ${ref.groups.dist.hash}\n`);

// -- the runs ----------------------------------------------------------------
const runs = [];
const discarded = [];
let attempt = 0;

while (runs.length < RUNS && attempt < MAX_ATTEMPTS) {
  attempt += 1;
  const id = `${PREFIX}-${String(attempt).padStart(2, '0')}`;
  console.log(`\n${'#'.repeat(70)}\n# attempt ${attempt} -> ${id}  (${runs.length}/${RUNS} valid so far)\n${'#'.repeat(70)}`);

  sh('node', [
    'scripts/hermetic/gate-run.mjs',
    '--run-id', id,
    '--root', ROOT,
    '--expect-dist', ref.groups.dist.hash,
  ]);

  const gatePath = join(REPORTS, 'runs', id, 'gate.json');
  if (!existsSync(gatePath)) {
    discarded.push({ id, reason: 'NO_GATE_JSON' });
    continue;
  }
  const g = JSON.parse(readFileSync(gatePath, 'utf8'));

  // §36: a run from a different commit is not a member of this sequence.
  if (g.commit !== commit) {
    discarded.push({ id, reason: `COMMIT_DRIFT ${g.commit}` });
    continue;
  }
  if (!g.valid) {
    discarded.push({ id, reason: g.invalidReasons.join('; ') });
    continue;
  }
  runs.push(g);
}

// -- the matrix --------------------------------------------------------------
const idOf = (t) => `[${t.project}] ${t.file.replace(/^.*\/tests\//, '')}:${t.line} ${t.title}`;

const rows = runs.map((g, i) => {
  const main = g.gates.find((x) => x.id === 'playwright-main') ?? {};
  const full = g.gates.find((x) => x.id === 'playwright-full') ?? {};
  return {
    run: i + 1,
    id: g.runId,
    valid: g.valid,
    green: g.green,
    distHash: g.subject.before?.dist,
    subjectIdentical: g.subject.identical,
    canaryEvents: g.canaryEventCount,
    collected: (main.collected ?? 0) + (full.collected ?? 0),
    passed: (main.passed ?? 0) + (full.passed ?? 0),
    failed: (main.failed ?? 0) + (full.failed ?? 0),
    skipped: (main.skipped ?? 0) + (full.skipped ?? 0),
    failedGates: g.failedGates,
    failures: (g.allFailingTests ?? []).map(idOf).sort(),
    durationMs: g.durationMs,
    meanLoad: g.load?.meanLoad1 ?? null,
    peakLoad: g.load?.peakLoad1 ?? null,
  };
});

const uniq = (xs) => [...new Set(xs)];
const identical = {
  collected: uniq(rows.map((r) => r.collected)).length === 1,
  skipped: uniq(rows.map((r) => r.skipped)).length === 1,
  distHash: uniq(rows.map((r) => r.distHash)).length === 1,
  failureSet: uniq(rows.map((r) => JSON.stringify(r.failures))).length === 1,
};

// Every test that failed in at least one run, with the runs it failed in. This
// is the wandering-failure detector: a test that appears here with fewer than
// `runs.length` entries did not reproduce deterministically.
const everFailed = uniq(rows.flatMap((r) => r.failures)).sort();
const wandering = everFailed
  .map((f) => ({ test: f, inRuns: rows.filter((r) => r.failures.includes(f)).map((r) => r.run) }))
  .filter((x) => x.inRuns.length !== rows.length);

const summary = {
  commit,
  root: ROOT,
  requestedRuns: RUNS,
  validRuns: rows.length,
  attempts: attempt,
  discarded,
  frozenDistHash: ref.groups.dist.hash,
  frozenSubjectHash: ref.combinedHash,
  identical,
  greenRuns: rows.filter((r) => r.green).length,
  everFailed,
  wanderingFailures: wandering,
  deterministic: wandering.length === 0 && identical.failureSet && identical.collected,
  rows,
  generatedAt: new Date().toISOString(),
};

const outPath = join(REPORTS, 'final-gate.json');
writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log(`\n${'='.repeat(78)}`);
console.log(`SIX-RUN MATRIX — ${rows.length}/${RUNS} valid runs over ${commit.slice(0, 12)}`);
console.log('='.repeat(78));
console.log('run  valid  green  collected  passed  failed  skipped  canary  dur(s)  load(mean/peak)');
for (const r of rows) {
  console.log(
    `${String(r.run).padEnd(4)} ${String(r.valid).padEnd(6)} ${String(r.green).padEnd(6)} ` +
    `${String(r.collected).padEnd(10)} ${String(r.passed).padEnd(7)} ${String(r.failed).padEnd(7)} ` +
    `${String(r.skipped).padEnd(8)} ${String(r.canaryEvents).padEnd(7)} ` +
    `${(r.durationMs / 1000).toFixed(0).padEnd(7)} ${r.meanLoad}/${r.peakLoad}`,
  );
}
console.log(`\nidentical collected: ${identical.collected}   skipped: ${identical.skipped}   dist: ${identical.distHash}   failure set: ${identical.failureSet}`);
if (everFailed.length) {
  console.log(`\ntests that failed in at least one run:`);
  for (const f of everFailed) {
    const inRuns = rows.filter((r) => r.failures.includes(f)).map((r) => r.run);
    console.log(`  ${inRuns.length}/${rows.length}  ${f}   runs ${inRuns.join(',')}`);
  }
}
if (discarded.length) {
  console.log(`\ndiscarded (INVALID, not counted):`);
  for (const d of discarded) console.log(`  ${d.id}: ${d.reason}`);
}
console.log(`\nDETERMINISTIC: ${summary.deterministic}    GREEN: ${summary.greenRuns}/${rows.length}`);
console.log(`written: ${outPath}`);
console.log('='.repeat(78));

process.exit(rows.length === RUNS && summary.deterministic ? 0 : 1);
