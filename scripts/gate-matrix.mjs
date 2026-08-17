#!/usr/bin/env node
/**
 * Compare N Playwright JSON reports of the SAME commit and answer the one
 * question a regression gate lives or dies on:
 *
 *   does the same source produce the same behavioural result?
 *
 * WHY A SCRIPT AND NOT AN EYEBALL
 * -------------------------------
 * "The suite is flaky" is a conclusion, and it was being reached from memory of
 * a handful of runs. This computes it instead. A test that fails in every run is
 * a STABLE FAILURE and is almost certainly a real defect. A test that fails in
 * some runs and passes in others is a WANDERING FAILURE, and a gate containing
 * any of those cannot distinguish a regression from the weather.
 *
 * It also refuses to compare runs it should not compare: differing commits or
 * differing collected counts mean the runs are not of the same thing, and §52 of
 * the stabilization brief forbids merging them into one apparent result.
 *
 * USAGE
 *   node scripts/gate-matrix.mjs run1.json run2.json ... [--csv out.csv] [--md out.md]
 *
 * Exit codes:
 *   0  every run agreed — no wandering failures
 *   1  wandering failures found (the failure set is not reproducible)
 *   2  the runs are not comparable
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const inputs = args.filter((a) => !a.startsWith('--') && a.endsWith('.json') && existsSync(a));

if (inputs.length < 2) {
  console.error('usage: node scripts/gate-matrix.mjs <run1.json> <run2.json> [...] [--csv f] [--md f]');
  process.exit(2);
}

function collect(suites, out = [], file = null) {
  for (const suite of suites ?? []) {
    const here = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const last = t.results?.[t.results.length - 1];
        out.push({
          key: `${t.projectName ?? '-'}|${here ?? '-'}:${spec.line ?? 0}|${spec.title}`,
          project: t.projectName ?? '-',
          file: here ?? '-',
          line: spec.line ?? 0,
          title: spec.title,
          status: t.status ?? 'unknown',
          // A test that ran out of its own timeout is a materially different
          // event from one whose assertion was false, and the two must not be
          // averaged into "failed" — a timeout points at the machine, a failed
          // assertion points at the product.
          timedOut: (last?.status ?? '') === 'timedOut',
          duration: last?.duration ?? 0,
          startTime: last?.startTime ? Date.parse(last.startTime) : null,
          worker: last?.workerIndex ?? null,
        });
      }
    }
    collect(suite.suites, out, here);
  }
  return out;
}

const runs = inputs.map((f) => {
  const r = JSON.parse(readFileSync(f, 'utf8'));
  const tests = collect(r.suites);
  return {
    file: f,
    stats: r.stats ?? {},
    duration: r.stats?.duration ?? 0,
    startTime: r.stats?.startTime ?? null,
    tests,
    byKey: new Map(tests.map((t) => [t.key, t])),
    collected: tests.length,
    passed: tests.filter((t) => t.status === 'expected').length,
    failed: tests.filter((t) => t.status === 'unexpected').length,
    flaky: tests.filter((t) => t.status === 'flaky').length,
    skipped: tests.filter((t) => t.status === 'skipped').length,
  };
});

// --- comparability -----------------------------------------------------------
const collectedCounts = [...new Set(runs.map((r) => r.collected))];
if (collectedCounts.length > 1) {
  console.error(`NOT COMPARABLE: runs collected differing totals: ${collectedCounts.join(', ')}`);
  process.exit(2);
}

// --- the matrix --------------------------------------------------------------
const keys = new Set();
for (const r of runs) for (const t of r.tests) keys.add(t.key);

const statusOf = (r, k) => {
  const t = r.byKey.get(k);
  if (!t) return 'ABSENT';
  if (t.status === 'skipped') return 'SKIP';
  if (t.status === 'expected') return 'PASS';
  if (t.status === 'flaky') return 'FLAKY';
  return t.timedOut ? 'TIMEOUT' : 'FAIL';
};

const rows = [];
for (const k of keys) {
  const statuses = runs.map((r) => statusOf(r, k));
  const bad = statuses.filter((s) => s === 'FAIL' || s === 'TIMEOUT' || s === 'FLAKY').length;
  if (bad === 0) continue; // only rows that ever went wrong are interesting
  const [project, loc, title] = k.split('|');
  rows.push({
    project,
    loc,
    title,
    statuses,
    failures: bad,
    timeouts: statuses.filter((s) => s === 'TIMEOUT').length,
    stability: bad === runs.length ? 'STABLE FAILURE' : 'WANDERING',
    durations: runs.map((r) => r.byKey.get(k)?.duration ?? 0),
  });
}
rows.sort((a, b) => b.failures - a.failures || a.loc.localeCompare(b.loc));

const stable = rows.filter((r) => r.stability === 'STABLE FAILURE');
const wandering = rows.filter((r) => r.stability === 'WANDERING');

// --- output ------------------------------------------------------------------
const csv = flag('csv');
if (csv) {
  const lines = ['run,file,collected,passed,failed,flaky,skipped,duration_s,start'];
  runs.forEach((r, i) => {
    lines.push(
      [i + 1, r.file.split('/').pop(), r.collected, r.passed, r.failed, r.flaky, r.skipped,
       (r.duration / 1000).toFixed(1), r.startTime ?? ''].join(','),
    );
  });
  lines.push('');
  lines.push(`test_matrix,${runs.map((_, i) => `run${i + 1}`).join(',')},failures,timeouts,stability`);
  for (const r of rows) {
    lines.push(
      [`"[${r.project}] ${r.loc} ${r.title.replace(/"/g, "'")}"`, ...r.statuses, r.failures, r.timeouts, r.stability].join(','),
    );
  }
  writeFileSync(csv, `${lines.join('\n')}\n`);
  console.log(`written: ${csv}`);
}

const md = flag('md');
if (md) {
  const head = `| Test | ${runs.map((_, i) => `Run ${i + 1}`).join(' | ')} | Failures | Timeouts | Classification |`;
  const rule = `| --- |${runs.map(() => ' --- |').join('')} --- | --- | --- |`;
  const body = rows.map(
    (r) =>
      `| \`[${r.project}]\` ${r.loc.split('/').pop()} — ${r.title} | ${r.statuses.join(' | ')} | ${r.failures}/${runs.length} | ${r.timeouts} | **${r.stability}** |`,
  );
  const runTable = [
    '| Run | Collected | Passed | Failed | Skipped | Duration |',
    '| --- | --- | --- | --- | --- | --- |',
    ...runs.map(
      (r, i) => `| ${i + 1} | ${r.collected} | ${r.passed} | ${r.failed} | ${r.skipped} | ${(r.duration / 1000 / 60).toFixed(1)} min |`,
    ),
  ];
  writeFileSync(
    md,
    [
      '# Failure stability matrix',
      '',
      `${runs.length} runs of the same commit, same machine, same configuration.`,
      '',
      ...runTable,
      '',
      `**Stable failures (failed in every run): ${stable.length}**`,
      `**Wandering failures (failed in some runs, passed in others): ${wandering.length}**`,
      '',
      head,
      rule,
      ...body,
      '',
    ].join('\n'),
  );
  console.log(`written: ${md}`);
}

console.log(`\nruns: ${runs.length}  collected: ${runs[0].collected} (identical across runs)`);
runs.forEach((r, i) =>
  console.log(`  run${i + 1}: ${r.passed} passed / ${r.failed} failed / ${r.skipped} skipped in ${(r.duration / 60000).toFixed(1)} min`),
);
console.log(`\nstable failures:    ${stable.length}`);
console.log(`wandering failures: ${wandering.length}`);
for (const r of wandering) console.log(`  WANDERING [${r.project}] ${r.loc} ${r.title} → ${r.statuses.join(',')}`);
for (const r of stable) console.log(`  STABLE    [${r.project}] ${r.loc} ${r.title}`);

process.exit(wandering.length ? 1 : 0);
