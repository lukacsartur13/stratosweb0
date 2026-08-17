#!/usr/bin/env node
/**
 * The one authoritative repository-wide gate run.
 *
 * WHY THIS EXISTS
 * ---------------
 * Three separate failures of the previous passes were failures of *bookkeeping*
 * rather than of the product:
 *
 *   1. A verdict was written from `tail -6` of terminal output, and the half of
 *      the output that named the failures scrolled past.
 *   2. A population of `ESTALE` and "navigation-shaped" timeouts was analysed
 *      for days before it emerged that another process had been rebuilding
 *      `dist/` while the suite ran. The numbers were not wrong; they were
 *      meaningless, and nothing in the harness could say so.
 *   3. A test server was left running for seventeen hours after the run that
 *      started it, still holding a port and still serving a tree.
 *
 * None of those is fixed by discipline, because discipline is what failed. Each
 * is fixed here, by a program that refuses to emit a verdict it cannot justify:
 *
 *   1. Every gate's complete stdout and stderr goes to a file, and the pass/fail
 *      arithmetic is reconciled by `scripts/gate-report.mjs`, which exits 2 if
 *      the collected count does not equal the accounted count.
 *   2. The subject is content-hashed before and after, and watched *during*.
 *      A run whose subject moved is classified `INVALID` and may not be counted
 *      as either a pass or a failure.
 *   3. Every process this script starts is tracked by PID and confirmed dead
 *      before the run is allowed to finish.
 *
 * THE MUTATION WINDOW, STATED RATHER THAN HIDDEN
 * ----------------------------------------------
 * §51 requires the production build to be one of the gates, and §7 requires the
 * served artefact to be immutable. Those pull in opposite directions, and the
 * resolution is not to drop either: the build runs inside a declared window at
 * the start of the run, and the artefact it produces is then required to hash
 * IDENTICALLY to the frozen reference passed in with `--expect-dist`.
 *
 * That is strictly stronger than skipping the build. Skipping it proves the
 * artefact did not change because nothing touched it; running it proves the
 * artefact is reproducible from the frozen source AND is the same artefact. The
 * canaries arm when the window closes, and any write to `dist/` after that
 * point invalidates the run.
 *
 * USAGE
 * -----
 *   node scripts/hermetic/gate-run.mjs --run-id r1 [--root <dir>]
 *        [--expect-dist <sha>] [--server node|python] [--gates a,b,c]
 *        [--skip-build] [--out <dir>]
 *
 * Exit codes:
 *   0  VALID and every required gate passed
 *   1  VALID and at least one gate failed  (a real, countable result)
 *   3  INVALID — subject mutated, arithmetic did not reconcile, or the
 *      harness could not guarantee what it measured. Not a pass, not a fail.
 */

import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync, readFileSync, existsSync, watch } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const has = (n) => argv.includes(`--${n}`);

const ROOT = resolve(flag('root', process.cwd()));
const RUN_ID = flag('run-id', `run-${Date.now()}`);
const SERVER_KIND = flag('server', 'node');
const EXPECT_DIST = flag('expect-dist');
const OUT_DIR = resolve(flag('out', join(ROOT, '_build/reports/hermetic-gate/runs', RUN_ID)));
const MAIN_PORT = Number(flag('main-port', 4322));
const FULL_PORT = Number(flag('full-port', 4327));

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(join(OUT_DIR, 'logs'), { recursive: true });
mkdirSync(join(ROOT, '_build/reports/hermetic-gate/manifests'), { recursive: true });

const log = (...m) => console.log(`[${new Date().toISOString()}] ${m.join(' ')}`);

// ---------------------------------------------------------------------------
// Process ownership. Everything this script starts is registered here, and §45
// is enforced against this list at the end rather than against a memory of what
// was started.
// ---------------------------------------------------------------------------
const owned = new Map(); // pid -> { what, startedAt, exitCode, exitedAt }

function register(child, what) {
  owned.set(child.pid, { what, pid: child.pid, startedAt: new Date().toISOString(), exitCode: null, exitedAt: null });
  child.on('exit', (code, signal) => {
    const rec = owned.get(child.pid);
    if (rec) {
      rec.exitCode = code;
      rec.signal = signal ?? null;
      rec.exitedAt = new Date().toISOString();
    }
  });
}

/**
 * Run a command, capture EVERYTHING.
 *
 * §31 forbids deriving a verdict from truncated output, so nothing is piped
 * through `tail` and nothing is held only in memory: both streams go to a file
 * on disk that outlives the run, and the returned object carries only the
 * bookkeeping. The last 40 lines are kept in memory purely so a failure can be
 * echoed to the console without opening the file — the file remains the record.
 */
function run(id, cmd, args, opts = {}) {
  return new Promise((done) => {
    const logPath = join(OUT_DIR, 'logs', `${id}.log`);
    const stream = createWriteStream(logPath);
    const startedAt = Date.now();
    stream.write(`$ ${cmd} ${args.join(' ')}\n(cwd: ${opts.cwd ?? ROOT})\n\n`);

    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? ROOT,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    register(child, `gate:${id}`);

    const tail = [];
    const feed = (buf) => {
      stream.write(buf);
      for (const line of buf.toString().split('\n')) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 40) tail.shift();
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);

    child.on('error', (err) => {
      stream.end(`\n[spawn error] ${err.message}\n`);
      done({ id, exitCode: -1, durationMs: Date.now() - startedAt, logPath, tail: [err.message] });
    });
    child.on('close', (code) => {
      stream.end(`\n[exit ${code}] ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
      done({ id, exitCode: code, durationMs: Date.now() - startedAt, logPath, tail: [...tail] });
    });
  });
}

// ---------------------------------------------------------------------------
// Mutation canaries.
//
// §43 is explicit that a final hash comparison is not enough on its own: a file
// that is written and then written back to its original contents hashes the
// same at both ends and was nonetheless a mutation of the served tree in the
// middle of the run. `fs.watch` sees the write; the hash cannot.
//
// The two mechanisms are therefore kept and neither is treated as redundant:
// the hashes say WHETHER the subject differs, the watchers say WHETHER it was
// ever touched. A run needs both answers to be clean.
// ---------------------------------------------------------------------------
const canaryEvents = [];
const watchers = [];

function armCanaries() {
  const targets = [
    ['dist', join(ROOT, 'dist')],
    ['tests', join(ROOT, 'tests')],
    ['assets', join(ROOT, 'assets')],
    ['portal-src', join(ROOT, 'portal/src')],
    ['experiments-src', join(ROOT, 'experiments/src')],
    ['scripts', join(ROOT, 'scripts')],
  ];
  for (const [name, dir] of targets) {
    if (!existsSync(dir)) continue;
    try {
      const w = watch(dir, { recursive: true }, (event, filename) => {
        const f = String(filename ?? '');
        // Playwright's own scratch and the gate's reports are not the subject.
        if (f.includes('.playwright') || f.includes('test-results') || f.startsWith('reports/')) return;
        // macOS writes these under directories being read; they are not writes
        // to the subject and a run must not die of a Finder window.
        if (f.endsWith('.DS_Store') || f.includes('/._') || f.startsWith('._')) return;
        canaryEvents.push({ at: new Date().toISOString(), target: name, event, file: f });
      });
      watchers.push(w);
    } catch (err) {
      canaryEvents.push({ at: new Date().toISOString(), target: name, event: 'WATCH_FAILED', file: err.message });
    }
  }
  log(`canaries armed on ${watchers.length} tree(s)`);
}

const disarmCanaries = () => {
  for (const w of watchers) { try { w.close(); } catch { /* already closed */ } }
};

// ---------------------------------------------------------------------------
// System contamination monitor.
//
// §12: high load does NOT invalidate a run — subject mutation does. Load is
// recorded anyway, because a failure that only ever happens above a load of 40
// is a different finding from one that happens at rest, and that distinction is
// unrecoverable after the fact if nobody wrote the number down.
// ---------------------------------------------------------------------------
const samples = [];
let sampler = null;

function startSampler() {
  const tick = () => {
    try {
      const la = execFileSync('sysctl', ['-n', 'vm.loadavg'], { encoding: 'utf8' }).trim();
      const [, l1, l5, l15] = la.match(/\{ ([\d.]+) ([\d.]+) ([\d.]+) \}/) ?? [];
      const swap = execFileSync('sysctl', ['-n', 'vm.swapusage'], { encoding: 'utf8' }).trim();
      const used = Number((swap.match(/used = ([\d.]+)M/) ?? [])[1] ?? 0);
      const ps = execFileSync('ps', ['-Ao', 'comm'], { encoding: 'utf8' });
      const count = (re) => ps.split('\n').filter((l) => re.test(l)).length;
      samples.push({
        at: new Date().toISOString(),
        load1: Number(l1), load5: Number(l5), load15: Number(l15),
        swapUsedMB: used,
        nodeProcs: count(/node$/),
        browserProcs: count(/Chromium|com\.apple\.WebKit|Playwright|headless_shell/i),
        pythonProcs: count(/[Pp]ython/),
        canaryEvents: canaryEvents.length,
      });
    } catch { /* a sample we could not take is not a reason to stop the gate */ }
  };
  tick();
  sampler = setInterval(tick, 5_000);
}

const stopSampler = () => { if (sampler) clearInterval(sampler); };

function loadStats() {
  if (!samples.length) return null;
  const l = samples.map((s) => s.load1).filter(Number.isFinite);
  return {
    count: samples.length,
    meanLoad1: +(l.reduce((a, b) => a + b, 0) / l.length).toFixed(2),
    peakLoad1: +Math.max(...l).toFixed(2),
    minLoad1: +Math.min(...l).toFixed(2),
    peakBrowserProcs: Math.max(...samples.map((s) => s.browserProcs)),
    peakSwapUsedMB: Math.max(...samples.map((s) => s.swapUsedMB)),
  };
}

// ---------------------------------------------------------------------------
// Owned servers.
//
// §8 and §9. The gate starts the server, so the gate knows its PID, its port,
// when it became ready and how it died. Playwright is told to start none of its
// own (see the `STRATOS_GATE_SERVER` branch in both configs), which removes
// `reuseExistingServer` from the picture entirely rather than setting it to
// false and hoping: a run cannot attach to a stale server it never asked for.
// ---------------------------------------------------------------------------
const servers = [];

async function startServer(name, port, kind) {
  const logPath = join(OUT_DIR, 'logs', `server-${name}.log`);
  const stream = createWriteStream(logPath);
  const cmd = kind === 'python'
    ? ['python3', ['-m', 'http.server', String(port), '--directory', 'dist']]
    : ['node', ['scripts/test-server.mjs', String(port), 'dist']];

  const startedAt = new Date().toISOString();
  const child = spawn(cmd[0], cmd[1], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  register(child, `server:${name}`);
  child.stdout.on('data', (b) => stream.write(b));
  child.stderr.on('data', (b) => stream.write(b));

  // Ready is defined by the socket answering, not by a sleep.
  let ready = null;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/index.html`, { method: 'HEAD' });
      if (res.status < 500) { ready = new Date().toISOString(); break; }
    } catch { /* not up yet */ }
    await sleep(200);
  }
  if (!ready) throw new Error(`server ${name} on :${port} never became ready`);

  const identity = {
    name, kind, port, pid: child.pid, root: join(ROOT, 'dist'),
    startedAt, readyAt: ready, logPath,
    commit: gitCommit(), stoppedAt: null, exitCode: null,
  };
  stream.write(`\n[gate identity] ${JSON.stringify(identity)}\n`);
  servers.push({ identity, child });
  log(`server ${name} (${kind}) pid=${child.pid} :${port} ready`);
  return identity;
}

async function stopServers() {
  for (const { identity, child } of servers) {
    identity.stoppedAt = new Date().toISOString();
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  // Give them a moment, then insist.
  for (let i = 0; i < 25; i++) {
    if (servers.every(({ child }) => child.exitCode !== null || child.killed)) break;
    await sleep(200);
  }
  for (const { identity, child } of servers) {
    if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch { /* raced */ } }
    identity.exitCode = child.exitCode;
  }
}

const gitCommit = () => {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch { return null; }
};

const manifest = (label, out) =>
  run(`manifest-${label}`, 'node', ['scripts/hermetic/manifest.mjs', 'capture', '--root', ROOT, '--label', label, '--out', out]);

const readManifest = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

// ---------------------------------------------------------------------------
// The gate list.
//
// §51: the repository-wide gate is the whole list, and a reduced subset may not
// be called repository-wide. `needsServer` is recorded so a report can say
// which gates a server fault could possibly have affected.
// ---------------------------------------------------------------------------
const MAIN_JSON = join(OUT_DIR, 'playwright-main.json');
const FULL_JSON = join(OUT_DIR, 'playwright-full.json');

const GATES = [
  { id: 'typecheck', cmd: 'npm', args: ['run', 'typecheck'], server: false },
  { id: 'fingerprint-check', cmd: 'npm', args: ['run', 'fingerprint:check'], server: false },
  { id: 'draco-check', cmd: 'npm', args: ['run', 'draco:check'], server: false },
  { id: 'secret-scan', cmd: 'npm', args: ['run', 'scan:secrets'], server: false },
  { id: 'seo-audit', cmd: 'npm', args: ['run', 'audit:seo:check'], server: false },
  { id: 'conversion-audit', cmd: 'npm', args: ['run', 'audit:conversion:check'], server: false },
  { id: 'route-audit', cmd: 'node', args: ['scripts/route-audit.mjs'], server: false },
  {
    id: 'playwright-main',
    cmd: 'npx', args: ['playwright', 'test'],
    server: true,
    env: { PLAYWRIGHT_JSON_OUTPUT_NAME: MAIN_JSON, STRATOS_GATE_SERVER: '1' },
    json: MAIN_JSON,
  },
  {
    id: 'playwright-full',
    cmd: 'npx', args: ['playwright', 'test', '--config', 'playwright.full.config.ts'],
    server: true,
    env: { PLAYWRIGHT_JSON_OUTPUT_NAME: FULL_JSON, STRATOS_GATE_SERVER: '1' },
    json: FULL_JSON,
  },
];

// ---------------------------------------------------------------------------

async function main() {
  const runStarted = new Date().toISOString();
  const t0 = Date.now();
  log(`gate run ${RUN_ID} — root ${ROOT}`);

  const result = {
    runId: RUN_ID,
    startedAt: runStarted,
    root: ROOT,
    commit: gitCommit(),
    serverKind: SERVER_KIND,
    valid: null,
    invalidReasons: [],
    gates: [],
    build: null,
    subject: {},
    servers: [],
    ownedProcesses: [],
    canaryEvents: [],
    load: null,
    environment: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      cpus: Number(execFileSync('sysctl', ['-n', 'hw.ncpu'], { encoding: 'utf8' }).trim()),
      memoryGB: +(Number(execFileSync('sysctl', ['-n', 'hw.memsize'], { encoding: 'utf8' }).trim()) / 1e9).toFixed(1),
    },
  };

  startSampler();

  // -- PHASE 1: the declared build window -----------------------------------
  if (!has('skip-build')) {
    log('phase 1: build (declared mutation window)');
    const b1 = await run('build', 'npm', ['run', 'build']);
    const b2 = await run('build-full', 'npm', ['run', 'build:full']);
    result.build = {
      site: { exitCode: b1.exitCode, durationMs: b1.durationMs, log: b1.logPath },
      experiments: { exitCode: b2.exitCode, durationMs: b2.durationMs, log: b2.logPath },
    };
    if (b1.exitCode !== 0 || b2.exitCode !== 0) {
      result.invalidReasons.push('BUILD_FAILED');
    }
  } else {
    log('phase 1: build skipped (--skip-build)');
    result.build = { skipped: true };
  }

  // -- PHASE 2: freeze ------------------------------------------------------
  log('phase 2: freeze — capturing BEFORE manifest');
  const beforePath = join(ROOT, '_build/reports/hermetic-gate/manifests', `${RUN_ID}-before.json`);
  const afterPath = join(ROOT, '_build/reports/hermetic-gate/manifests', `${RUN_ID}-after.json`);
  await manifest(`${RUN_ID}-before`, beforePath);
  const before = readManifest(beforePath);
  result.subject.before = before && {
    combined: before.combinedHash,
    product: before.groups.product.hash,
    test: before.groups.test.hash,
    config: before.groups.config.hash,
    dist: before.groups.dist.hash,
    distFiles: before.groups.dist.fileCount,
  };

  // §7: the artefact must be the frozen one, not merely *an* artefact.
  if (EXPECT_DIST && before && before.groups.dist.hash !== EXPECT_DIST) {
    result.invalidReasons.push(`DIST_NOT_FROZEN_REFERENCE expected=${EXPECT_DIST} got=${before.groups.dist.hash}`);
  }

  armCanaries();

  // -- PHASE 3: owned servers ----------------------------------------------
  log('phase 3: starting owned servers');
  try {
    result.servers.push(await startServer('main', MAIN_PORT, SERVER_KIND));
    result.servers.push(await startServer('full', FULL_PORT, SERVER_KIND));
  } catch (err) {
    result.invalidReasons.push(`SERVER_START_FAILED ${err.message}`);
  }

  // -- PHASE 4: the gates ---------------------------------------------------
  const only = flag('gates');
  const selected = only ? GATES.filter((g) => only.split(',').includes(g.id)) : GATES;
  log(`phase 4: running ${selected.length} gate(s)`);

  for (const g of selected) {
    // A server that died is not a slow server; a gate that needs one must not
    // be run against nothing and reported as a failure of the product.
    if (g.server) {
      const dead = servers.filter(({ child }) => child.exitCode !== null);
      if (dead.length) {
        result.invalidReasons.push(`SERVER_DIED_BEFORE_${g.id}`);
      }
    }
    log(`  gate ${g.id}`);
    const r = await run(g.id, g.cmd, g.args, { env: g.env });
    const entry = { id: g.id, exitCode: r.exitCode, durationMs: r.durationMs, log: r.logPath, needsServer: !!g.server };

    // Playwright gates get their arithmetic reconciled by the existing
    // gate-report.mjs, which is the only thing allowed to say how many tests
    // there were. §30: a mismatch invalidates the report, it does not round.
    if (g.json && existsSync(g.json)) {
      const rep = await run(`${g.id}-report`, 'node', [
        'scripts/gate-report.mjs', g.json,
        '--out', join(OUT_DIR, `${g.id}-gate.json`),
        '--label', `${RUN_ID}:${g.id}`,
      ]);
      entry.reportExitCode = rep.exitCode;
      const gj = join(OUT_DIR, `${g.id}-gate.json`);
      if (existsSync(gj)) {
        const parsed = JSON.parse(readFileSync(gj, 'utf8'));
        entry.collected = parsed.collected;
        entry.passed = parsed.passed;
        entry.failed = parsed.failed;
        entry.flaky = parsed.flaky;
        entry.skipped = parsed.skipped;
        entry.arithmeticReconciles = parsed.arithmeticReconciles;
        entry.failingTests = parsed.failingTests;
        if (!parsed.arithmeticReconciles) result.invalidReasons.push(`ARITHMETIC_MISMATCH_${g.id}`);
      } else {
        result.invalidReasons.push(`NO_GATE_REPORT_${g.id}`);
      }
    } else if (g.json) {
      result.invalidReasons.push(`NO_PLAYWRIGHT_JSON_${g.id}`);
    }

    result.gates.push(entry);
  }

  // -- PHASE 5: shut down ---------------------------------------------------
  log('phase 5: stopping owned servers');
  await stopServers();
  disarmCanaries();
  stopSampler();

  // -- PHASE 6: after manifest ---------------------------------------------
  log('phase 6: capturing AFTER manifest');
  await manifest(`${RUN_ID}-after`, afterPath);
  const after = readManifest(afterPath);
  result.subject.after = after && {
    combined: after.combinedHash,
    product: after.groups.product.hash,
    test: after.groups.test.hash,
    config: after.groups.config.hash,
    dist: after.groups.dist.hash,
    distFiles: after.groups.dist.fileCount,
  };

  const cmp = await run('manifest-compare', 'node', ['scripts/hermetic/manifest.mjs', 'compare', beforePath, afterPath]);
  result.subject.identical = cmp.exitCode === 0;
  if (cmp.exitCode !== 0) result.invalidReasons.push('SUBJECT_MUTATED_DURING_RUN');

  // §43: a write that was later reverted hashes clean and is still a mutation.
  result.canaryEvents = canaryEvents.slice(0, 500);
  result.canaryEventCount = canaryEvents.length;
  if (canaryEvents.length) result.invalidReasons.push(`CANARY_WRITES_DURING_RUN=${canaryEvents.length}`);

  // -- PHASE 7: cleanup verification ---------------------------------------
  log('phase 7: verifying cleanup');
  const stillAlive = [];
  for (const rec of owned.values()) {
    try { process.kill(rec.pid, 0); stillAlive.push(rec); } catch { /* dead, which is what we want */ }
  }
  result.ownedProcesses = [...owned.values()];
  result.orphanedProcesses = stillAlive;
  if (stillAlive.length) result.invalidReasons.push(`ORPHANED_PROCESSES=${stillAlive.length}`);

  const portsHeld = [];
  for (const p of [MAIN_PORT, FULL_PORT]) {
    try {
      const out = execFileSync('lsof', ['-nP', `-iTCP:${p}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim();
      if (out) portsHeld.push({ port: p, holder: out.split('\n').slice(1).join('\n') });
    } catch { /* lsof exits non-zero when nothing holds the port, which is the pass */ }
  }
  result.portsStillHeld = portsHeld;
  if (portsHeld.length) result.invalidReasons.push(`PORTS_STILL_HELD=${portsHeld.map((p) => p.port).join(',')}`);

  // -- verdict --------------------------------------------------------------
  result.load = loadStats();
  result.loadSamples = samples;
  result.durationMs = Date.now() - t0;
  result.finishedAt = new Date().toISOString();
  result.valid = result.invalidReasons.length === 0;

  const failedGates = result.gates.filter((g) => g.exitCode !== 0);
  result.failedGates = failedGates.map((g) => g.id);
  result.allFailingTests = result.gates.flatMap((g) => (g.failingTests ?? []).map((t) => ({ gate: g.id, ...t })));
  result.green = result.valid && failedGates.length === 0;

  const gatePath = join(OUT_DIR, 'gate.json');
  writeFileSync(gatePath, `${JSON.stringify(result, null, 2)}\n`);

  console.log('\n' + '='.repeat(70));
  console.log(`RUN ${RUN_ID}   ${result.valid ? 'VALID' : 'INVALID'}   ${result.green ? 'GREEN' : 'NOT GREEN'}`);
  console.log(`commit  ${result.commit}`);
  console.log(`subject ${result.subject.before?.combined?.slice(0, 16)} -> ${result.subject.after?.combined?.slice(0, 16)}  ${result.subject.identical ? 'IDENTICAL' : 'CHANGED'}`);
  console.log(`dist    ${result.subject.before?.dist?.slice(0, 16)}`);
  console.log(`canary  ${result.canaryEventCount} write event(s) during the run`);
  console.log(`load    mean ${result.load?.meanLoad1} peak ${result.load?.peakLoad1}`);
  console.log(`elapsed ${(result.durationMs / 1000).toFixed(1)}s`);
  for (const g of result.gates) {
    const counts = g.collected != null ? `  ${g.passed}/${g.collected} passed, ${g.failed} failed, ${g.skipped} skipped` : '';
    console.log(`  ${g.exitCode === 0 ? 'PASS' : 'FAIL'}  ${g.id}${counts}`);
  }
  for (const t of result.allFailingTests) console.log(`    ! [${t.project}] ${t.file}:${t.line} ${t.title}`);
  for (const r of result.invalidReasons) console.log(`  INVALID: ${r}`);
  console.log(`written: ${gatePath}`);
  console.log('='.repeat(70));

  process.exit(result.valid ? (result.green ? 0 : 1) : 3);
}

// A crash must still tear down what it started, or the next run inherits a
// server it did not ask for — which is the exact §45 failure this replaces.
const bail = async (why) => {
  console.error(`\ngate-run aborting: ${why}`);
  try { await stopServers(); } catch { /* best effort */ }
  disarmCanaries();
  stopSampler();
  process.exit(3);
};
process.on('SIGINT', () => bail('SIGINT'));
process.on('SIGTERM', () => bail('SIGTERM'));

main().catch((err) => bail(err.stack ?? String(err)));
