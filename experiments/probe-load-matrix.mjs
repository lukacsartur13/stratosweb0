/**
 * The same eight tests, at four levels of parallelism, on one commit.
 *
 * §11 of the reconciliation brief: the eight `npm test` failures behave
 * differently under saturation, so the difference has to be measured under
 * control rather than inferred. Same commit, same `dist/`, same browser binary;
 * the only variable is how many workers are competing for the machine.
 *
 * ## What this is NOT for
 *
 * The brief is explicit and this comment repeats it so nobody reads the output
 * the other way: the purpose is **diagnosis, not finding the worker count at
 * which red becomes green**. A number here that makes the suite pass is not a
 * fix and must not be adopted as one. What the arms are for is to establish
 * whether the failures track *contention for the machine* — which is a claim
 * about the harness — or occur independently of it, which would make them a
 * claim about the product and would send this back to §10.
 *
 * ## The arms
 *
 *   isolated    the eight tests only, one worker. No competition at all.
 *   serial      the whole file, one worker. The tests' own neighbours compete
 *               for the machine, but nothing runs concurrently.
 *   moderate    the whole file, two workers.
 *   normal      the whole file, five workers — Playwright's local default on
 *               this machine, and how `npm test` actually runs.
 *
 * ## What is recorded
 *
 * Per test: pass/fail, duration, and the error's first line, which is where the
 * "which call was in flight" information lives. Per arm: wall-clock duration and
 * a load average sampled every two seconds for the length of the run, because
 * "under saturated parallel load" is a claim that should be a number.
 *
 *   node experiments/probe-load-matrix.mjs
 *
 * Writes _build/reports/mobile-test-reconciliation/load-matrix.json.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadavg, cpus } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = resolve(ROOT, '_build/reports/mobile-test-reconciliation');
const CORES = cpus().length;

/** The eight, by the grep that selects exactly them and nothing else. */
const EIGHT = [
  'the journey state compacts the wordmark and keeps the header short',
  'a single jump lands on the right state, not one short of it',
  'the full-screen menu opens from every header state',
  'focus is trapped inside the layer while it is open',
  'opening the menu does not walk the journey back down the mountain',
  'a subpage reached from the homepage carries the same working header',
];

const ARMS = [
  { name: 'isolated', workers: 1, grep: EIGHT },
  { name: 'serial', workers: 1, grep: null },
  { name: 'moderate', workers: 2, grep: null },
  { name: 'normal', workers: 5, grep: null },
];

const PROJECTS = ['desktop-1920', 'reduced-motion'];

/** Escape for a JS regex alternation Playwright will accept via --grep. */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function run(arm) {
  return new Promise((done) => {
    const report = resolve(OUT, `load-matrix-${arm.name}.json`);
    rmSync(report, { force: true });

    const argv = [
      'playwright',
      'test',
      'tests/homepage-chrome.spec.ts',
      ...PROJECTS.flatMap((p) => ['--project', p]),
      '--workers',
      String(arm.workers),
      '--reporter',
      'json',
      '--retries',
      '0',
    ];
    if (arm.grep) argv.push('--grep', arm.grep.map(escape).join('|'));

    const started = Date.now();
    const samples = [];
    const sampler = setInterval(() => samples.push(Math.round(loadavg()[0] * 100) / 100), 2000);

    const child = spawn('npx', argv, {
      cwd: ROOT,
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: report },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // The JSON reporter writes the file; stdout is swallowed so the arms do not
    // bury each other in the terminal.
    child.stdout.on('data', () => {});
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));

    child.on('close', (code) => {
      clearInterval(sampler);
      const wallMs = Date.now() - started;

      let tests = [];
      try {
        const json = JSON.parse(readFileSync(report, 'utf8'));
        const walk = (suite, path = []) => {
          for (const spec of suite.specs ?? []) {
            for (const t of spec.tests ?? []) {
              const r = t.results?.[t.results.length - 1];
              tests.push({
                title: spec.title,
                project: t.projectName,
                ok: spec.ok,
                status: r?.status,
                ms: r?.duration,
                error: r?.error?.message?.split('\n')[0]?.replace(/\[[0-9;]*m/g, '').slice(0, 200),
              });
            }
          }
          for (const child of suite.suites ?? []) walk(child, path);
        };
        for (const suite of json.suites ?? []) walk(suite);
      } catch (error) {
        stderr += `\n[matrix] could not read ${report}: ${error}`;
      }

      done({
        arm: arm.name,
        workers: arm.workers,
        scope: arm.grep ? 'the eight only' : 'the whole file',
        exitCode: code,
        wallMs,
        load: {
          samples,
          peak: samples.length ? Math.max(...samples) : null,
          median: samples.length ? [...samples].sort((a, b) => a - b)[samples.length >> 1] : null,
          cores: CORES,
        },
        tests,
        stderr: stderr.slice(-1200),
      });
    });
  });
}

mkdirSync(OUT, { recursive: true });
const report = { at: new Date().toISOString(), cores: CORES, projects: PROJECTS, arms: [] };

for (const arm of ARMS) {
  process.stdout.write(`  ${arm.name} (workers=${arm.workers}, ${arm.grep ? 'the eight' : 'whole file'}) ... `);
  const result = await run(arm);
  report.arms.push(result);

  const failed = result.tests.filter((t) => !t.ok);
  console.log(
    `${result.tests.length} tests, ${failed.length} failed, ${Math.round(result.wallMs / 1000)}s, ` +
      `load peak ${result.load.peak}/${CORES}`,
  );
  for (const t of failed) console.log(`      ✘ [${t.project}] ${t.title} (${Math.round((t.ms ?? 0) / 1000)}s)`);
}

const path = resolve(OUT, 'load-matrix.json');
writeFileSync(path, JSON.stringify(report, null, 2));
console.log(`\n  written: ${path}\n`);
