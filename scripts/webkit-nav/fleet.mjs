#!/usr/bin/env node
/**
 * Several stress drivers against one server, which is the shape the suite
 * actually runs in.
 *
 * `stress.mjs` on its own answers "does this navigation stall when nothing else
 * is happening". The answer turned out to be no — 1 500 consecutive
 * `page.goto('/kkv.html')` attempts on WebKit completed with a p99 of 85 ms and
 * zero failures. That is a real result and it eliminates a whole family of
 * hypotheses, but it is not the environment the failure was reported in:
 * `playwright.config.ts` runs `workers: 5` with `fullyParallel: true`, so five
 * browsers share one Node server, one GPU and ten cores.
 *
 * This runs K drivers concurrently against a single `nav-server`, so that every
 * request from every driver lands in one log and one connection pool. Each
 * driver keeps its own artefacts; navigation identities are label-prefixed so
 * they never collide.
 *
 * Usage:
 *   node scripts/webkit-nav/fleet.mjs --label B1 --workers 5 --n 1000 \
 *     --path /kkv.html [--wait load] [--mode new-context] [--batch 1]
 */

import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const passthrough = ['wait', 'mode', 'batch', 'action', 'rate', 'settle', 'timeout'];

const LABEL = arg('label');
if (!LABEL) { console.error('--label is required'); process.exit(2); }
const WORKERS = Number(arg('workers', 5));
const N = Number(arg('n', 1000));
const PATHS = arg('path', '/kkv.html');
const PORT = Number(arg('port', 4452));
const OUT = resolve(arg('out', '_build/reports/webkit-navigation'));
const SCRATCH = process.env.STRATOS_NAV_SCRATCH ?? join(os.tmpdir(), 'stratos-webkit-nav');
const SERVER_LOG = join(SCRATCH, `${LABEL}-server.ndjson`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * WHICH SERVER THE FLEET RUNS AGAINST.
 *
 * This used to be `nav-server.mjs` and nothing else, which is why the previous
 * pass finished with the concurrent-Python arm recorded as NOT RUN — the only
 * harness that produced concurrency could not point at Python, and the only
 * harness that could point at Python (`stress.mjs --server python`) ran serially.
 *
 * That gap is the whole reason Python's exoneration was provisional.
 * `server-comparison.md` measured it at 1 000/1 000 with a p50 of 33 ms and
 * called the result narrow on purpose: Python 3.9's documented failure mode is
 * connection churn under CONCURRENCY, and a serial arm opens ~20 sockets per
 * page rather than hundreds a second. Measuring the tail of a mechanism the
 * sample never engages is not evidence about that mechanism.
 *
 *   nav     the instrumented Node twin — per-request server-side log, so a
 *           navigation can be correlated across client and server
 *   node    scripts/test-server.mjs verbatim — what the suite actually uses
 *   python  python3 -m http.server — HTTP/1.0, no keep-alive, GIL-bound
 *
 * Only `nav` writes the server-side log, so the correlation arm is unavailable
 * for the other two. That is a property of those servers, not a shortcut: a
 * stock server cannot be asked to log what it never recorded.
 */
const SERVER_KIND = arg('server', 'nav');
const SERVERS = {
  nav: ['node', ['scripts/webkit-nav/nav-server.mjs', String(PORT), 'dist', SERVER_LOG]],
  node: ['node', ['scripts/test-server.mjs', String(PORT), 'dist']],
  python: ['python3', ['-m', 'http.server', String(PORT), '--directory', 'dist']],
};
if (!SERVERS[SERVER_KIND]) {
  console.error(`--server must be one of ${Object.keys(SERVERS).join(' | ')}`);
  process.exit(2);
}

await mkdir(SCRATCH, { recursive: true });
await rm(SERVER_LOG, { force: true });

const [serverCmd, serverArgs] = SERVERS[SERVER_KIND];
const server = spawn(serverCmd, serverArgs, { stdio: ['ignore', 'ignore', 'inherit'] });

for (let i = 0; i < 100; i++) {
  try { await fetch(`http://127.0.0.1:${PORT}/index.html`, { method: 'HEAD' }); break; }
  catch { await sleep(100); }
}

const startLoad = os.loadavg()[0];
const startedAt = new Date().toISOString();
console.log(`fleet ${LABEL}: ${WORKERS} workers x ${N} navigations on ${PATHS} (port ${PORT}, load ${startLoad.toFixed(2)})`);

const extra = passthrough.flatMap((k) => {
  const v = arg(k);
  return v === undefined ? [] : [`--${k}`, v];
});

const children = Array.from({ length: WORKERS }, (_, k) => {
  const child = spawn('node', [
    'scripts/webkit-nav/stress.mjs',
    '--label', `${LABEL}w${k + 1}`,
    '--n', String(N),
    '--path', PATHS,
    '--port', String(PORT),
    '--server', 'none',
    // Only the instrumented twin writes one; pointing the drivers at a log that
    // will stay empty would produce an arm whose correlation column is silently
    // blank rather than declared absent.
    ...(SERVER_KIND === 'nav' ? ['--server-log', SERVER_LOG] : []),
    '--out', OUT,
    ...extra,
  ], { stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
  return new Promise((res) => child.once('exit', (code) => res({ worker: k + 1, code })));
});

const results = await Promise.all(children);
const endLoad = os.loadavg()[0];

const done = new Promise((r) => server.once('exit', r));
server.kill('SIGTERM');
await Promise.race([done, sleep(5_000)]);

await mkdir(join(OUT, 'runs', LABEL), { recursive: true });
await writeFile(join(OUT, 'runs', LABEL, 'fleet.json'), JSON.stringify({
  label: LABEL, workers: WORKERS, nPerWorker: N, paths: PATHS, port: PORT,
  server: SERVER_KIND,
  serverCommand: `${serverCmd} ${serverArgs.join(' ')}`,
  startedAt, endedAt: new Date().toISOString(),
  load1Start: +startLoad.toFixed(2), load1End: +endLoad.toFixed(2),
  // Start load only — see the note in stress.mjs. A fleet run is *supposed* to
  // load the machine.
  classification: startLoad >= 4.0 ? 'CONTAMINATED' : 'CONTROLLED',
  serverLog: SERVER_LOG,
  workerLabels: results.map((r) => `${LABEL}w${r.worker}`),
  exitCodes: results,
}, null, 2));

console.log(`fleet ${LABEL} done. exit codes: ${results.map((r) => r.code).join(',')}  load ${startLoad.toFixed(2)} -> ${endLoad.toFixed(2)}`);
