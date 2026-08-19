#!/usr/bin/env node
/**
 * Targeted reproduction of ONE navigation contract, under the hermetic rules —
 * §16, §17, §18.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE PREVIOUS SEARCH
 * --------------------------------------------------
 * The last WebKit navigation investigation executed 24 010 targeted navigations
 * across 33 diagnostic arms and reproduced nothing. §2 forbids repeating it with
 * the same instrumentation, and the reason is not the volume — it is that
 * volume without a recorder produces the same empty artefact 24 010 times.
 *
 * So this runner does not chase a number. It runs the exact contract until a
 * failure appears and then STOPS, because one failure with a complete bundle is
 * the entire deliverable and every execution after it is waste (§16).
 *
 * THE ARMS
 * --------
 *   real     `public-site.spec.ts` on `mobile-390`, whole file. §17: the
 *            failing contract is reproduced by running the file that contains
 *            it, at the same worker count, so the two sibling navigations that
 *            preceded it in the same worker precede it here too.
 *   routes   the ten parametrised route tests only. The same neighbours, an
 *            order of magnitude cheaper per execution of the target.
 *   control  `nav-boundary-stress.spec.ts`, a bare `page.goto('/kkv.html')`
 *            with no assertions. §18: if this never fails while `real` does,
 *            the preceding state is the subject rather than the transport.
 *
 * HERMETIC RULES IT KEEPS (§5, §15)
 * ---------------------------------
 * Owned server, never a reused one; dist hashed before and after and required
 * to be identical; `fs.watch` canaries on the served tree with zero tolerance;
 * every started PID confirmed dead and every port confirmed released. A stage
 * whose subject moved is INVALID and its numbers are not reported as evidence.
 *
 * Usage:
 *   node scripts/hermetic/nav-stress.mjs --arm routes --repeat 500 [--workers 5]
 *        [--root <dir>] [--stage A] [--out <dir>]
 */

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, watch } from 'node:fs';
import { join, resolve } from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };

const ROOT = resolve(arg('root', process.cwd()));
const ARM = arg('arm', 'routes');
const REPEAT = Number(arg('repeat', 100));
const WORKERS = Number(arg('workers', 5));
const STAGE = arg('stage', 'A');
const PORT = Number(arg('port', 4322));
const OUT = resolve(arg('out', join(ROOT, '_build/reports/final-navigation-boundary')));
const RUN_ID = `stress-${STAGE}-${ARM}-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;

/** The contract under investigation. Matched by title, so a rename is loud. */
const TARGET_TITLE = '/kkv.html responds and has a title and description';
const TARGET_PROJECT = 'mobile-390';

const ARMS = {
  real: { config: null, args: ['public-site.spec.ts'], grep: null, targets: [TARGET_TITLE] },
  routes: { config: null, args: ['public-site.spec.ts'], grep: 'responds and has a title and description', targets: [TARGET_TITLE] },
  control: { config: 'scripts/hermetic/diagnostics/playwright.diagnostics.config.ts', args: ['nav-boundary-stress.spec.ts'], grep: 'bare goto', targets: ['bare goto /kkv.html'] },
};
if (!ARMS[ARM]) { console.error(`unknown arm ${ARM}; known: ${Object.keys(ARMS).join(', ')}`); process.exit(2); }

mkdirSync(OUT, { recursive: true });
const workDir = join(OUT, 'stress', RUN_ID);
mkdirSync(join(workDir, 'diag'), { recursive: true });

const log = (m) => console.log(`[nav-stress ${RUN_ID}] ${m}`);
const nowIso = () => new Date().toISOString();

// -- subject manifest --------------------------------------------------------
function manifest(label) {
  const out = join(workDir, `manifest-${label}.json`);
  const r = spawnSync('node', ['scripts/hermetic/manifest.mjs', 'capture', '--root', ROOT, '--label', label, '--out', out], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr); throw new Error(`manifest ${label} failed`); }
  return { path: out, data: JSON.parse(readFileSync(out, 'utf8')) };
}

// -- canaries (§15) ----------------------------------------------------------
const canaryEvents = [];
const watchers = [];
for (const [name, dir] of [['dist', join(ROOT, 'dist')], ['tests', join(ROOT, 'tests')], ['scripts', join(ROOT, 'scripts')]]) {
  if (!existsSync(dir)) continue;
  try {
    watchers.push(watch(dir, { recursive: true }, (event, filename) => {
      const f = String(filename ?? '');
      if (f.includes('.playwright') || f.includes('test-results') || f.startsWith('reports/')) return;
      if (f.endsWith('.DS_Store') || f.includes('/._') || f.startsWith('._')) return;
      canaryEvents.push({ at: nowIso(), target: name, event, file: f });
    }));
  } catch (e) { canaryEvents.push({ at: nowIso(), target: name, event: 'WATCH_FAILED', file: e.message }); }
}

// -- owned server (§5) -------------------------------------------------------
const started = [];
function startServer() {
  const p = spawn('node', ['scripts/test-server.mjs', String(PORT), 'dist'], {
    cwd: ROOT, env: { ...process.env, STRATOS_NAV_DIAG_DIR: join(workDir, 'diag') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  started.push({ name: 'main', port: PORT, pid: p.pid, proc: p, startedAt: nowIso() });
  return p;
}
const portFree = () => spawnSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout.trim() === '';
async function waitReady(ms = 30000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/kkv.html`); if (r.ok) { await r.arrayBuffer(); return true; } } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// -- load sampling (§31) -----------------------------------------------------
const loads = [];
const loadTimer = setInterval(() => loads.push(os.loadavg()[0]), 5000);

// -- the run -----------------------------------------------------------------
const before = manifest('before');
log(`subject dist ${before.data.groups.dist.hash.slice(0, 16)}  tests ${before.data.groups.test.hash.slice(0, 16)}`);
if (!portFree()) { console.error(`port ${PORT} is not free — refusing to reuse a server (§5)`); process.exit(4); }

const server = startServer();
const ready = await waitReady();
if (!ready) { console.error('server never answered'); server.kill('SIGKILL'); process.exit(4); }
log(`server pid ${server.pid} ready on ${PORT}`);

const spec = ARMS[ARM];
const reportPath = join(workDir, 'report.json');
const pwArgs = ['playwright', 'test', ...spec.args, `--project=${TARGET_PROJECT}`, `--repeat-each=${REPEAT}`, `--workers=${WORKERS}`];
if (spec.config) pwArgs.splice(2, 0, '--config', spec.config);
if (spec.grep) pwArgs.push('-g', spec.grep);

log(`arm=${ARM} repeat=${REPEAT} workers=${WORKERS}`);
const startedAt = nowIso();
const t0 = Date.now();
const pw = spawnSync('npx', pwArgs, {
  cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'], encoding: 'utf8',
  env: {
    ...process.env,
    STRATOS_GATE_SERVER: '1',
    STRATOS_DIAG_PORT: String(PORT),
    STRATOS_NAV_DIAG_DIR: join(workDir, 'diag'),
    STRATOS_NAV_DIAG_RUN: RUN_ID,
    STRATOS_NAV_DIAG_OUT: join(OUT, 'failures'),
    PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
  },
});
const durationMs = Date.now() - t0;
clearInterval(loadTimer);

// -- shutdown ----------------------------------------------------------------
for (const s of started) {
  try { process.kill(s.pid, 'SIGTERM'); } catch { /* already gone */ }
}
await new Promise((r) => setTimeout(r, 1500));
for (const s of started) {
  let alive = true;
  try { process.kill(s.pid, 0); } catch { alive = false; }
  if (alive) { try { process.kill(s.pid, 'SIGKILL'); } catch { /* raced */ } }
  s.stoppedAt = nowIso();
  try { process.kill(s.pid, 0); s.confirmedDead = false; } catch { s.confirmedDead = true; }
}
for (const w of watchers) { try { w.close(); } catch { /* closed */ } }
const after = manifest('after');

// -- arithmetic (§16) --------------------------------------------------------
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
const specs = [];
if (report) { const walk = (s) => { for (const x of s.suites ?? []) walk(x); for (const x of s.specs ?? []) specs.push(x); }; for (const s of report.suites ?? []) walk(s); }

let targetExecutions = 0; let targetFailures = 0; let otherFailures = 0; let allExecutions = 0;
const failures = [];
for (const s of specs) {
  const isTarget = spec.targets.includes(s.title);
  for (const t of s.tests ?? []) {
    for (const r of t.results ?? []) {
      allExecutions += 1;
      if (isTarget) targetExecutions += 1;
      const bad = r.status !== 'passed' && r.status !== 'skipped';
      if (!bad) continue;
      if (isTarget) targetFailures += 1; else otherFailures += 1;
      failures.push({ title: s.title, project: t.projectName, status: r.status, durationMs: r.duration, workerIndex: r.workerIndex, errors: (r.errors ?? []).map((e) => (e.message ?? '').slice(0, 800)) });
    }
  }
}

const subjectIdentical = before.data.combinedHash === after.data.combinedHash;
const valid = subjectIdentical && canaryEvents.length === 0 && started.every((s) => s.confirmedDead) && portFree();

const result = {
  runId: RUN_ID, stage: STAGE, arm: ARM, startedAt, durationMs,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
  repeatEach: REPEAT, workers: WORKERS,
  playwrightExit: pw.status,
  targetTitle: spec.targets, targetProject: TARGET_PROJECT,
  executions: { target: targetExecutions, all: allExecutions },
  failures: { target: targetFailures, other: otherFailures, detail: failures.slice(0, 50) },
  subject: {
    identical: subjectIdentical,
    distBefore: before.data.groups.dist.hash, distAfter: after.data.groups.dist.hash,
    testBefore: before.data.groups.test.hash, testAfter: after.data.groups.test.hash,
    canaryEvents: canaryEvents.length, canaryDetail: canaryEvents.slice(0, 50),
  },
  servers: started.map((s) => ({ name: s.name, port: s.port, pid: s.pid, startedAt: s.startedAt, stoppedAt: s.stoppedAt, confirmedDead: s.confirmedDead })),
  portReleased: portFree(),
  load: loads.length ? { samples: loads.length, mean: +(loads.reduce((a, b) => a + b, 0) / loads.length).toFixed(2), peak: +Math.max(...loads).toFixed(2), min: +Math.min(...loads).toFixed(2) } : null,
  valid,
  invalidReasons: [
    ...(subjectIdentical ? [] : ['SUBJECT_CHANGED_DURING_RUN']),
    ...(canaryEvents.length ? [`CANARY_WRITES=${canaryEvents.length}`] : []),
    ...(started.every((s) => s.confirmedDead) ? [] : ['ORPHANED_SERVER_PROCESS']),
    ...(portFree() ? [] : ['PORT_NOT_RELEASED']),
  ],
};
writeFileSync(join(workDir, 'stress.json'), `${JSON.stringify(result, null, 2)}\n`);

log(`executions of the contract: ${targetExecutions}   failures: ${targetFailures}  (other failures: ${otherFailures})`);
log(`subject ${subjectIdentical ? 'IDENTICAL' : 'CHANGED'}   canary ${canaryEvents.length}   valid ${valid}`);
log(`report ${join(workDir, 'stress.json')}`);
if (targetFailures) log('CONTRACT REPRODUCED — stop here and read the bundle before running more (§16)');
process.exit(valid ? 0 : 5);
