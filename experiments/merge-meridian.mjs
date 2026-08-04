// Join the sharded visibility runs into the one report the Phase 6 gate reads.
//
//     node experiments/merge-meridian.mjs _build/reports/shards/*.json
//
// Shards are produced by running `validate-meridian.mjs` with `OUT`, `LOCALES`
// and `VIEWPORTS` set. The merge is a concatenation of their `results` arrays
// plus a recount, and it refuses to write a report that is missing a
// locale/viewport pair it was told to expect — a sweep that silently covered
// two thirds of the matrix is the failure mode this whole exercise exists to
// stop repeating.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, process.env.OUT ?? '_build/reports/meridian-visibility.json');
const EXPECT_LOCALES = (process.env.LOCALES ?? 'hu,en,de').split(',');
const EXPECT_VIEWPORTS = (
  process.env.VIEWPORTS ?? '1440x900,1366x768,1024x768,768x1024,430x932,390x844,360x800,320x568,844x390'
).split(',');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node experiments/merge-meridian.mjs <shard.json> …');
  process.exit(2);
}

const results = [];
let altitudes = [];
for (const file of files) {
  const shard = JSON.parse(await readFile(file, 'utf8'));
  results.push(...shard.results);
  if (shard.altitudes.length > altitudes.length) altitudes = shard.altitudes;
}

const seen = new Set(results.map((r) => `${r.locale} ${r.viewport.w}x${r.viewport.h}`));
const missing = EXPECT_LOCALES.flatMap((l) => EXPECT_VIEWPORTS.map((v) => `${l} ${v}`)).filter((k) => !seen.has(k));

let samples = 0;
let problems = 0;
const worst = { centre: 0, margin: Infinity };
for (const r of results) {
  samples += r.rows.length;
  problems += r.rows.filter((row) => row.problems.length).length;
  worst.centre = Math.max(worst.centre, r.worstCentre);
  if (Number.isFinite(r.worstMargin)) worst.margin = Math.min(worst.margin, r.worstMargin);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  JSON.stringify({ generatedAt: new Date().toISOString(), altitudes, results }, null, 1),
);

console.log(`merged ${files.length} shard(s): ${results.length} runs, ${samples} samples`);
console.log(`  problem samples : ${problems}`);
console.log(`  worst centre    : ${(worst.centre * 100).toFixed(2)}%`);
console.log(`  worst margin    : ${worst.margin.toFixed(0)}px`);
if (missing.length) {
  console.error(`\nMISSING ${missing.length} locale/viewport pair(s): ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`\n${problems === 0 ? 'PASS' : 'FAIL'} — report: ${OUT}`);
process.exit(problems === 0 ? 0 : 1);
