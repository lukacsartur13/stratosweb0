#!/usr/bin/env node
/**
 * Turn `runs/index.jsonl` into the comparison tables §19-§22 ask for.
 *
 * Reads only what the runs already wrote. An arm whose subject moved is printed
 * as INVALID and its numbers are not offered for comparison — §18's rule that a
 * stage whose subject moved is not evidence.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(process.argv[2] ?? '_build/reports/navigation-dispatch/runs/index.jsonl');
const rows = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);

console.log(pad('stage', 10) + pad('model', 16) + pad('route', 18) + pad('warm', 6) +
  padl('runs', 6) + padl('stalls', 8) + padl('p50', 7) + padl('p99', 7) + padl('max', 8) +
  padl('freeMB', 8) + padl('load', 7) + '  valid');
console.log('-'.repeat(110));

let total = 0, totalStalls = 0;
for (const r of rows) {
  const stage = r.run.split('-')[0];
  total += r.executed; totalStalls += r.stalls;
  console.log(
    pad(r.stage ?? stage, 10) + pad(r.model, 16) + pad(r.route, 18) + pad(r.warmup ? 'yes' : 'no', 6) +
    padl(r.executed, 6) + padl(r.stalls, 8) + padl(r.durationsMs.p50 ?? '-', 7) +
    padl(r.durationsMs.p99 ?? '-', 7) + padl(r.durationsMs.max ?? '-', 8) +
    padl(r.host.freememMB, 8) + padl(r.host.loadavg[0].toFixed(1), 7) +
    '  ' + (r.valid ? 'yes' : `NO (${r.invalidReasons.join(',')})`),
  );
}
console.log('-'.repeat(110));
console.log(`TOTAL executed=${total}  stalls=${totalStalls}`);
