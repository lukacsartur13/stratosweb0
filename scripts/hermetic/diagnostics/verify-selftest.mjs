#!/usr/bin/env node
/**
 * The verdict on the instrumentation — §37.
 *
 * Each self-test arm names, in its own title, the state it must stop at. This
 * reads the bundles the fixture wrote and checks the two things that make the
 * recorder worth trusting:
 *
 *   1. every arm reached EXACTLY the state its title claims — not a state
 *      after it, which would mean the recorder invents progress, and not a
 *      state before it, which would mean it loses evidence;
 *   2. the six arms produced SIX DIFFERENT answers. A recorder that always
 *      says the same thing passes check 1 on one arm and is useless.
 *
 * It also asserts that `page.goto:` still prefixes the errors, because the
 * whole apparatus hangs off a wrapper around that method and
 * `failure-records.mjs` classifies by that string.
 *
 * The `page.goto:` check reads the PLAYWRIGHT REPORT, not the bundle. On a
 * timeout Playwright appends the `page.goto: Test timeout ...` error AFTER
 * fixture teardown has run, so `testInfo.errors` inside the bundle holds only
 * the bare "Test timeout of Nms exceeded". The report is also what
 * `failure-records.mjs` ultimately consumes, so checking it is checking the
 * artefact that actually matters.
 *
 * Usage:
 *   node scripts/hermetic/diagnostics/verify-selftest.mjs <bundles-dir> [<report.json>]
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
const reportPath = process.argv[3] ?? null;
if (!root || !existsSync(root)) { console.error(`usage: verify-selftest.mjs <bundles-dir> [<report.json>]  (got ${root})`); process.exit(2); }

/** title -> joined error text, from the Playwright JSON report. */
function reportErrors(p) {
  const byTitle = new Map();
  if (!p || !existsSync(p)) return byTitle;
  const j = JSON.parse(readFileSync(p, 'utf8'));
  const specs = [];
  const walk = (s) => { for (const x of s.suites ?? []) walk(x); for (const x of s.specs ?? []) specs.push(x); };
  for (const s of j.suites ?? []) walk(s);
  for (const s of specs)
    for (const t of s.tests ?? [])
      for (const r of t.results ?? [])
        byTitle.set(s.title, `${byTitle.get(s.title) ?? ''}\n${(r.errors ?? []).map((e) => e.message ?? '').join('\n')}`);
  return byTitle;
}
const errs = reportErrors(reportPath);

/** The arms, and the boundary each is built to stop at. */
const EXPECTED = {
  A: 'REQUEST_STARTED',
  B: 'SERVER_RECEIVED',
  C: 'RESPONSE_COMPLETE',
  D: 'NAV_COMMITTED',
  D2: 'DOMCONTENTLOADED',
  E: 'DESTINATION_READY',
};

const rows = [];
for (const d of readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())) {
  const meta = join(root, d.name, 'meta.json');
  if (!existsSync(meta)) continue;
  const m = JSON.parse(readFileSync(meta, 'utf8'));
  const arm = (m.test.title.match(/^(D2|[A-E])\b/) ?? [])[1] ?? '?';
  rows.push({
    arm,
    title: m.test.title,
    got: m.lastConfirmedState,
    want: EXPECTED[arm] ?? '<unknown arm>',
    states: m.statesReached,
    gotoPrefixed: /page\.goto:/.test(errs.get(m.test.title) ?? (m.error ?? []).join('\n')),
    checkedAgainstReport: errs.has(m.test.title),
    hasServer: existsSync(join(root, d.name, 'server.json')),
    hasTimeline: existsSync(join(root, d.name, 'timeline.json')),
    hasNetwork: existsSync(join(root, d.name, 'network.json')),
    hasPageState: existsSync(join(root, d.name, 'page-state.json')),
  });
}
rows.sort((a, b) => a.arm.localeCompare(b.arm));

const problems = [];
for (const arm of Object.keys(EXPECTED)) if (!rows.some((r) => r.arm === arm)) problems.push(`arm ${arm}: no bundle written`);
for (const r of rows) {
  if (r.got !== r.want) problems.push(`arm ${r.arm}: lastConfirmedState=${r.got}, expected ${r.want}`);
  for (const [k, v] of Object.entries({ timeline: r.hasTimeline, server: r.hasServer, network: r.hasNetwork, 'page-state': r.hasPageState }))
    if (!v) problems.push(`arm ${r.arm}: ${k}.json missing`);
  // Arm E times out AFTER a resolved goto, so its error is a waitForSelector.
  if (r.arm !== 'E' && !r.checkedAgainstReport) problems.push(`arm ${r.arm}: not found in the Playwright report — cannot check the API prefix`);
  else if (r.arm !== 'E' && !r.gotoPrefixed) problems.push(`arm ${r.arm}: error no longer says "page.goto:" — the wrapper has renamed the API and failure-records.mjs will stop classifying navigations`);
}
const distinct = new Set(rows.map((r) => r.got));
if (rows.length && distinct.size !== rows.length) problems.push(`only ${distinct.size} distinct states across ${rows.length} arms — the recorder does not discriminate`);

console.log('\narm  expected              got                   verdict');
console.log('---  --------------------  --------------------  -------');
for (const r of rows) console.log(`${r.arm.padEnd(3)}  ${r.want.padEnd(20)}  ${r.got.padEnd(20)}  ${r.got === r.want ? 'ok' : 'MISMATCH'}`);
console.log(`\ndistinct states: ${distinct.size} / ${rows.length}`);

if (problems.length) { console.error('\nSELF-TEST FAILED:'); for (const p of problems) console.error(`  - ${p}`); process.exit(1); }
console.log('\nSELF-TEST PASSED — the recorder distinguishes every injected boundary.');
