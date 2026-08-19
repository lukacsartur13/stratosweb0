#!/usr/bin/env node
/**
 * Assemble the canonical merge verdict — §49.
 *
 * `six-run.mjs` writes a raw matrix and OVERWRITES it each sequence. §49
 * forbids losing the earlier ones: the canonical file must preserve historical
 * sequences and must say, unambiguously, WHICH sequence determines the current
 * verdict. So the raw matrix is folded in here rather than published directly,
 * and whatever was canonical before is pushed down into `historical` instead of
 * being replaced.
 *
 * The verdict itself is NOT computed from a green count. §45 requires six valid
 * runs, six green, identical collected, identical skip set, zero subject
 * mutation, zero canary writes, zero orphaned processes and a stable renderer
 * canary — and §46 adds one this workstream owns: if the mobile-390 navigation
 * failed again, the run must carry a `lastConfirmedState`. A sequence that is
 * green but produced an unclassifiable navigation timeout has not met the bar,
 * and this file is where that is enforced rather than remembered.
 *
 * Usage:
 *   node scripts/hermetic/curate-final-gate.mjs \
 *     --raw   <subject>/_build/reports/hermetic-gate/final-gate.json \
 *     --prev  <main>/_build/reports/hermetic-gate/final-gate.json \
 *     --manifest <subject>/_build/reports/hermetic-gate/manifests/frozen-g4.json \
 *     --runs  <subject>/_build/reports/hermetic-gate/runs \
 *     --bundles <subject>/_build/reports/final-navigation-boundary/failures \
 *     --workstream "final mobile-390 navigation boundary" \
 *     --out   <main>/_build/reports/hermetic-gate/final-gate.json
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const readJson = (p, d = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };

const raw = readJson(arg('raw'));
if (!raw) { console.error(`cannot read --raw ${arg('raw')}`); process.exit(2); }
const prev = readJson(arg('prev'));
const man = readJson(arg('manifest'));
const RUNS_DIR = arg('runs');
const BUNDLES = arg('bundles');
const OUT = arg('out');

/**
 * §45 asks for an identical skip set **by identity**, and `gate.json` records
 * only a count. Two runs can each skip 155 tests and skip 155 DIFFERENT tests;
 * that is a real nondeterminism and a count comparison passes it without
 * noticing. So the set is reconstructed from the Playwright reports, sorted,
 * and hashed — the hash is what the runs are required to agree on.
 */
function skipSet(runDir) {
  const ids = [];
  for (const f of ['playwright-main.json', 'playwright-full.json']) {
    const j = readJson(join(runDir, f));
    if (!j) continue;
    const specs = [];
    const walk = (x) => { for (const y of x.suites ?? []) walk(y); for (const y of x.specs ?? []) specs.push(y); };
    for (const x of j.suites ?? []) walk(x);
    for (const sp of specs)
      for (const t of sp.tests ?? [])
        for (const r of t.results ?? [])
          if (r.status === 'skipped') ids.push(`[${t.projectName}] ${sp.file}:${sp.line} ${sp.title}`);
  }
  ids.sort();
  return { count: ids.length, sha: createHash('sha256').update(ids.join('\n')).digest('hex'), ids };
}

/** Per-run detail from each gate.json, which the raw matrix summarises away. */
const rows = (raw.rows ?? []).map((r) => {
  // `six-run.mjs` names it `id`; an already-curated file names it `runId`.
  // Accept both so this can be dry-run against a previous sequence.
  const runId = r.id ?? r.runId;
  const g = readJson(join(RUNS_DIR, runId, 'gate.json'), {});
  const skips = skipSet(join(RUNS_DIR, runId));
  const gate = (id) => (g.gates ?? []).find((x) => x.id === id) ?? {};
  const main = gate('playwright-main');
  const full = gate('playwright-full');
  const suite = (s) => ({
    collected: s.collected ?? null, passed: s.passed ?? null, failed: s.failed ?? null,
    skipped: s.skipped ?? null,
    reconciles: s.collected == null ? null : (s.passed ?? 0) + (s.failed ?? 0) + (s.skipped ?? 0) === s.collected,
  });
  return {
    run: r.run, runId, valid: r.valid, green: r.green, commit: g.commit ?? null,
    hashes: {
      product: g.subject?.before?.product ?? null, test: g.subject?.before?.test ?? null,
      config: g.subject?.before?.config ?? null,
      distBefore: g.subject?.before?.dist ?? null, distAfter: g.subject?.after?.dist ?? null,
    },
    subjectIdentical: g.subject?.identical ?? null,
    canaryEvents: g.canaryEventCount ?? 0,
    // `gate.json` reports these as counts at the top level, not as a
    // `cleanup` object. Read from the artefact rather than from memory of it —
    // the first version of this file invented `g.cleanup.orphans`, which is
    // `undefined`, and `undefined.length` would have been 0 for every run and
    // silently turned §45's orphan check into a rubber stamp.
    // ARRAYS in `gate.json`, not counts, and at the top level rather than
    // under a `cleanup` object. The first version of this file read
    // `g.cleanup.orphans` — `undefined` — and the second read them as numbers,
    // where `Number([])` is a helpful-looking 0 and `Number([pid])` is NaN.
    // Both would have turned §45's orphan check into a rubber stamp. Read from
    // the artefact, not from memory of it.
    orphanedProcesses: (g.orphanedProcesses ?? []).length,
    portsStillHeld: (g.portsStillHeld ?? []).length,
    gatesRun: (g.gates ?? []).map((x) => x.id),
    buildRan: !!g.build,
    suites: { main: suite(main), webgl: suite(full) },
    collected: r.collected, passed: r.passed, failed: r.failed, skipped: r.skipped,
    durationMs: r.durationMs, meanLoad: r.meanLoad, peakLoad: r.peakLoad,
    skipSetSha: skips.sha, skipSetCount: skips.count,
    failureSet: r.failures ?? [],
  };
});

/** §46 — every navigation-shaped failure in this sequence must carry a boundary. */
const navBoundaries = [];
if (BUNDLES && existsSync(BUNDLES)) {
  for (const runDir of readdirSync(BUNDLES, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    for (const b of readdirSync(join(BUNDLES, runDir.name), { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const m = readJson(join(BUNDLES, runDir.name, b.name, 'meta.json'));
      if (!m) continue;
      navBoundaries.push({
        runId: m.runId, project: m.test?.project, test: `${m.test?.file}:${m.test?.line} ${m.test?.title}`,
        lastConfirmedState: m.lastConfirmedState, statesReached: m.statesReached,
        bundle: join(runDir.name, b.name),
      });
    }
  }
}

const uniq = (xs) => [...new Set(xs)];
const allValid = rows.length === (raw.requestedRuns ?? 6) && rows.every((r) => r.valid);
const allGreen = rows.length > 0 && rows.every((r) => r.green);
const zeroCanary = rows.every((r) => r.canaryEvents === 0);
const zeroMutation = rows.every((r) => r.subjectIdentical === true);
const zeroOrphans = rows.every((r) => r.orphanedProcesses === 0 && r.portsStillHeld === 0);
const identicalCollected = uniq(rows.map((r) => r.collected)).length === 1;
const identicalSkipped = uniq(rows.map((r) => r.skipped)).length === 1;
/** The one §45 actually asks for: the same tests, not merely the same number. */
const identicalSkipSet = rows.length > 0
  && uniq(rows.map((r) => r.skipSetSha)).length === 1
  && rows.every((r) => r.skipSetCount > 0);
const arithmetic = rows.every((r) => r.suites.main.reconciles !== false && r.suites.webgl.reconciles !== false);
/** §46: a navigation-shaped failure with no boundary means THIS workstream failed. */
const unclassifiedNavigation = navBoundaries.filter((b) => !b.lastConfirmedState);

const accepted = allValid && allGreen && zeroCanary && zeroMutation && zeroOrphans
  && identicalCollected && identicalSkipped && identicalSkipSet && arithmetic
  && unclassifiedNavigation.length === 0;

const reasons = [
  ...(allValid ? [] : [`only ${rows.filter((r) => r.valid).length}/${raw.requestedRuns ?? 6} runs were VALID`]),
  ...(allGreen ? [] : [`${rows.filter((r) => !r.green).length} run(s) were not green: ${JSON.stringify(raw.everFailed ?? [])}`]),
  ...(zeroCanary ? [] : ['canary write events occurred during a run']),
  ...(zeroMutation ? [] : ['the subject changed during a run']),
  ...(zeroOrphans ? [] : ['a server process or port survived a run']),
  ...(identicalCollected ? [] : ['collected counts differ across runs']),
  ...(identicalSkipped ? [] : ['skip COUNTS differ across runs']),
  ...(identicalSkipSet ? [] : ['skip SETS differ across runs by identity (same count, different tests)']),
  ...(arithmetic ? [] : ['a suite total does not reconcile']),
  ...(unclassifiedNavigation.length ? [`${unclassifiedNavigation.length} navigation failure(s) carry no lastConfirmedState — §46`] : []),
];

const out = {
  workstream: arg('workstream', 'final mobile-390 navigation boundary'),
  generatedAt: new Date().toISOString(),
  determinesCurrentVerdict: true,
  sequencePrefix: rows[0]?.runId?.split('-')[0] ?? null,
  frozenSubject: {
    commit: raw.commit ?? rows[0]?.commit ?? null,
    product: man?.groups?.product?.hash ?? null,
    test: man?.groups?.test?.hash ?? null,
    config: man?.groups?.config?.hash ?? null,
    dist: man?.groups?.dist?.hash ?? null,
    combined: man?.combinedHash ?? null,
  },
  subjectRoot: raw.root ?? null,
  validRunIds: rows.map((r) => r.runId),
  validRuns: rows.length,
  requestedRuns: raw.requestedRuns ?? 6,
  attempts: raw.attempts ?? null,
  discarded: raw.discarded ?? [],
  subjectMutationCount: rows.filter((r) => r.subjectIdentical !== true).length,
  totalCanaryEvents: rows.reduce((a, r) => a + r.canaryEvents, 0),
  totalOrphanedProcesses: rows.reduce((a, r) => a + r.orphanedProcesses, 0),
  totalPortsHeld: rows.reduce((a, r) => a + r.portsStillHeld, 0),
  hashesIdenticalAcrossRuns: {
    product: uniq(rows.map((r) => r.hashes.product)).length === 1,
    test: uniq(rows.map((r) => r.hashes.test)).length === 1,
    config: uniq(rows.map((r) => r.hashes.config)).length === 1,
    dist: uniq(rows.map((r) => r.hashes.distBefore)).length === 1,
  },
  aggregateIdentity: {
    collected: identicalCollected, skipped: identicalSkipped,
    passed: uniq(rows.map((r) => r.passed)).length === 1,
    failed: uniq(rows.map((r) => r.failed)).length === 1,
  },
  skipSetIdentical: identicalSkipSet,
  skipSetShas: uniq(rows.map((r) => r.skipSetSha)),
  skipSetSha: identicalSkipSet ? rows[0]?.skipSetSha ?? null : null,
  failureSetIdentical: uniq(rows.map((r) => JSON.stringify(r.failureSet))).length === 1,
  allArithmeticReconciles: arithmetic,
  everFailed: raw.everFailed ?? [],
  wanderingFailures: raw.wanderingFailures ?? [],
  greenRuns: rows.filter((r) => r.green).length,
  allValid,
  deterministic: raw.deterministic ?? null,
  navigationBoundaries: navBoundaries,
  unclassifiedNavigationFailures: unclassifiedNavigation,
  verdict: accepted ? 'HERMETIC REGRESSION GATE ACCEPTED' : 'HERMETIC REGRESSION GATE NOT ACCEPTED',
  mergeGate: accepted ? 'GREEN' : 'NOT GREEN',
  verdictReason: accepted
    ? 'Six valid runs, six green, identical collected and skip sets, zero subject mutation, zero canary writes, zero orphaned processes, and no navigation failure left without a proven boundary.'
    : reasons.join('; '),
  rows,
  historical: prev
    ? { previousSequence: { ...prev, determinesCurrentVerdict: false, note: 'superseded — retained per §49' } }
    : null,
};

writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`${out.verdict}   merge gate ${out.mergeGate}`);
console.log(`  valid ${rows.length}/${out.requestedRuns}  green ${out.greenRuns}  canary ${out.totalCanaryEvents}  mutation ${out.subjectMutationCount}`);
if (!accepted) for (const r of reasons) console.log(`  - ${r}`);
console.log(`written: ${OUT}`);
