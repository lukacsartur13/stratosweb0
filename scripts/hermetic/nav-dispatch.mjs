#!/usr/bin/env node
/**
 * The targeted reproduction of the G6 dispatch stall — §15, §16, §18, §35, §36.
 *
 * WHAT THIS RUNNER IS FOR, AND WHAT THE LAST ONE COULD NOT DO
 * -----------------------------------------------------------
 * `nav-stress.mjs` reproduced the contract and recorded everything a test
 * process can see. That was the right instrument for the previous boundary and
 * it is the wrong one for this boundary, because everything a test process can
 * see is already known: `page.goto` was called, no request event arrived, the
 * page stayed on `about:blank`. The unknown is one layer down — whether
 * Playwright ever put a navigation command on the wire, and what the browser
 * said back — and that layer is only visible in the protocol stream.
 *
 * So this runner spawns workers with `DEBUG=pw:protocol` and TAPS that stream.
 *
 * THE TAP, AND WHY IT IS A RING BUFFER
 * ------------------------------------
 * A single navigation of the target route produces a few hundred protocol
 * frames. Five thousand of them would produce something in the region of a
 * gigabyte of log, and §15 says not to keep that: "keep logs only for targeted
 * diagnosis, do not permanently flood". But the frames that matter cannot be
 * known in advance to be discardable, because the whole point is to see what is
 * ABSENT.
 *
 * The resolution is to keep everything for the current attempt and nothing for
 * the ones that already succeeded. The tap holds a bounded window; the window
 * is cleared at each `goto-begin` marker and flushed to disk only when the
 * attempt ends in a stall. A passing attempt costs one buffer reset.
 *
 * CORRELATION IS BY STREAM POSITION, NOT BY CLOCK — §16
 * -----------------------------------------------------
 * The worker writes `@@NAVDISPATCH` markers to the same stderr the protocol
 * frames go to. One file descriptor, one writer, so the order between a marker
 * and a frame is the kernel's rather than the agreement of two clocks. §16 also
 * forbids putting the attempt id in the URL, and it is not: the id lives in the
 * marker line, and the URL is byte-identical to the contract's.
 *
 * HERMETIC RULES — §5-equivalent, inherited from nav-stress.mjs
 * -------------------------------------------------------------
 * Owned server on its own port, never a reused one; the subject hashed before
 * and after and required to be identical; every PID confirmed dead and the port
 * confirmed released. A stage whose subject moved is INVALID and its numbers
 * are not reported as evidence.
 *
 * Usage:
 *   node scripts/hermetic/nav-dispatch.mjs --stage A --model fresh-context \
 *        --attempts 500 --parallel 5 [--route /nagyvallalat.html] [--warmup] [--neighbours]
 */

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync, watch } from 'node:fs';
import { join, resolve } from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const has = (n) => argv.includes(`--${n}`);

const ROOT = resolve(arg('root', process.cwd()));
const STAGE = arg('stage', 'A');
const MODEL = arg('model', 'fresh-context');
const ROUTE = arg('route', '/nagyvallalat.html');
const TOTAL = Number(arg('attempts', 500));
const PARALLEL = Number(arg('parallel', 5));
const PORT = Number(arg('port', 4344));
const LABEL = arg('label', `${STAGE}-${MODEL}-${ROUTE.replace(/[^\w]+/g, '')}`);
const OUT = resolve(arg('out', join(ROOT, '_build/reports/navigation-dispatch')));
const WARMUP = has('warmup');
const NEIGHBOURS = has('neighbours');
const KEEP_SUCCESS = Number(arg('keep-success', 3)); // §36

const RUN = `${LABEL}-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
const workDir = join(OUT, 'runs', RUN);
mkdirSync(join(workDir), { recursive: true });
mkdirSync(join(OUT, 'failures'), { recursive: true });
mkdirSync(join(OUT, 'success'), { recursive: true });

const log = (m) => console.log(`[nav-dispatch ${RUN}] ${m}`);
const BASE = `http://127.0.0.1:${PORT}`;

// -- subject manifest (hermetic rule) ---------------------------------------
function manifest(label) {
  const out = join(workDir, `manifest-${label}.json`);
  const r = spawnSync('node', ['scripts/hermetic/manifest.mjs', 'capture', '--root', ROOT, '--label', label, '--out', out],
    { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr); throw new Error(`manifest ${label} failed`); }
  return JSON.parse(readFileSync(out, 'utf8'));
}

// -- owned server ------------------------------------------------------------
function portFree(port) {
  const r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  return !r.stdout || !r.stdout.trim();
}
let server = null;
async function startServer() {
  if (!portFree(PORT)) throw new Error(`PORT_HELD_BY_STRANGER ${PORT} — refusing to reuse a server this run does not own`);
  server = spawn('node', ['scripts/test-server.mjs', String(PORT), 'dist'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > 20_000) throw new Error('SERVER_START_TIMEOUT');
    const r = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `${BASE}${ROUTE}`], { encoding: 'utf8' });
    if (r.stdout === '200') return;
    await new Promise((r2) => setTimeout(r2, 200));
  }
}
function stopServer() {
  if (!server) return;
  try { process.kill(server.pid, 'SIGTERM'); } catch { /* already gone */ }
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) { if (portFree(PORT)) return; spawnSync('sleep', ['0.1']); }
  try { process.kill(server.pid, 'SIGKILL'); } catch { /* ditto */ }
}

// -- dist canary (hermetic rule) --------------------------------------------
const canaryHits = [];
let watcher = null;
function armCanary() {
  try {
    watcher = watch(join(ROOT, 'dist'), { recursive: true }, (ev, f) => {
      if (f && !/\.DS_Store|\.icloud$/.test(f)) canaryHits.push({ at: new Date().toISOString(), ev, f });
    });
  } catch { /* a host without recursive watch still has the manifests */ }
}

/**
 * §11 — the protocol frames that carry the answer, and nothing else.
 *
 * Named from a captured healthy navigation on webkit 26.5 rev 2336, not from
 * documentation. `Playwright.navigate` is the command WebKit's Playwright build
 * uses for `page.goto` — NOT `Page.navigate`, and NOT over the page's own
 * session: it goes to the browser-level pageProxy connection, while everything
 * a page does (`evaluate`, `title`, `screenshot`) is tunnelled separately
 * through `Target.sendMessageToTarget`. Those are two different paths, which is
 * the single most important fact this instrument exists to exploit.
 */
// `"result":{"loaderId"` is the ACKNOWLEDGEMENT of the navigate command, and it
// was missing from the first version of this filter. That was not cosmetic:
// `PROTOCOL_COMMAND_ACKNOWLEDGED` is one of the states §17 requires, and without
// this alternative the tap could observe the command going out and the policy
// check coming back but never the reply that carries the loaderId — so the one
// distinction that separates "Playwright never got an answer" from "Playwright
// got an answer and the navigation died afterwards" was unobservable. Caught by
// reading a captured healthy trace back through the filter and finding the frame
// absent from a log that plainly contained it upstream.
const FRAME_RE = /Playwright\.navigate|willCheckNavigationPolicy|didCheckNavigationPolicy|"result":\{"loaderId"|requestWillBeSent|frameNavigated|frameStoppedLoading|loadEventFired|Target\.targetDestroyed|Target\.targetCreated|pageProxyDestroyed|"error"/;

// -- results -----------------------------------------------------------------
const results = { attempts: 0, resolved: 0, failed: 0, stalls: 0, byOutcome: {}, durations: [] };
const stalls = [];
const successSamples = [];

function bundleStall(rec, protoWindow) {
  const dir = join(OUT, 'failures', rec.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state-machine.json'), `${JSON.stringify(rec, null, 2)}\n`);
  writeFileSync(join(dir, 'protocol.log'), protoWindow.join('\n') + '\n');
  writeFileSync(join(dir, 'subject.json'), `${JSON.stringify(subjectBefore ? {
    combined: subjectBefore.combinedHash, dist: subjectBefore.groups.dist.hash,
    test: subjectBefore.groups.test.hash, config: subjectBefore.groups.config.hash,
    commit: subjectBefore.commit,
  } : null, null, 2)}\n`);
  writeFileSync(join(dir, 'host.json'), `${JSON.stringify({
    platform: `${os.platform()} ${os.release()}`, arch: os.arch(), cpus: os.cpus().length,
    freememMB: Math.round(os.freemem() / 1048576), loadavg: os.loadavg(),
    run: RUN, stage: STAGE, model: MODEL, route: ROUTE, parallel: PARALLEL,
  }, null, 2)}\n`);
  log(`STALL BUNDLE ${rec.id} -> ${dir}`);
}

function bundleSuccess(rec, protoWindow) {
  if (successSamples.length >= KEEP_SUCCESS) return;
  successSamples.push(rec.id);
  const dir = join(OUT, 'success', rec.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state-machine.json'), `${JSON.stringify(rec, null, 2)}\n`);
  writeFileSync(join(dir, 'protocol.log'), protoWindow.join('\n') + '\n');
}

/** One worker child, with its stderr tapped. */
function runWorker(index, attempts, idStart) {
  return new Promise((resolveP) => {
    const args = [
      'scripts/hermetic/diagnostics/dispatch-worker.mjs',
      '--model', MODEL, '--attempts', String(attempts), '--base', BASE,
      '--route', ROUTE, '--id-prefix', 'nav-dispatch', '--id-start', String(idStart),
    ];
    if (WARMUP) args.push('--warmup');
    if (NEIGHBOURS) args.push('--neighbours');
    const child = spawn('node', args, {
      cwd: ROOT,
      env: { ...process.env, DEBUG: 'pw:protocol' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // -- the tap ------------------------------------------------------------
    let window = [];          // frames since the current goto-begin
    let currentId = null;
    let errBuf = '';
    child.stderr.on('data', (chunk) => {
      errBuf += chunk;
      const lines = errBuf.split('\n');
      errBuf = lines.pop();
      for (const line of lines) {
        if (line.startsWith('@@NAVDISPATCH ')) {
          let m;
          try { m = JSON.parse(line.slice('@@NAVDISPATCH '.length)); } catch { continue; }
          if (m.kind === 'goto-begin') { currentId = m.id; window = [`--- marker ${line}`]; }
          else { window.push(`--- marker ${line}`); }
          continue;
        }
        if (currentId && FRAME_RE.test(line)) window.push(line.slice(0, 2000));
      }
    });

    let outBuf = '';
    child.stdout.on('data', (chunk) => {
      outBuf += chunk;
      const lines = outBuf.split('\n');
      outBuf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let rec;
        try { rec = JSON.parse(line); } catch { continue; }
        appendFileSync(join(workDir, `worker-${index}.jsonl`), `${line}\n`);
        if (rec.kind === 'attempt' || rec.kind === 'stall') {
          results.attempts += 1;
          results.durations.push(rec.durationUs);
          const key = rec.outcome ?? rec.kind;
          results.byOutcome[key] = (results.byOutcome[key] ?? 0) + 1;
          if (rec.kind === 'stall') {
            results.stalls += 1;
            stalls.push(rec.id);
            bundleStall(rec, window);
          } else if (rec.outcome === 'resolved') {
            results.resolved += 1;
            bundleSuccess(rec, window);
          } else {
            results.failed += 1;
          }
          if (results.attempts % 50 === 0) log(`${results.attempts}/${TOTAL} attempts · ${results.stalls} stalls`);
        }
        if (rec.kind === 'worker-start') writeFileSync(join(workDir, `worker-${index}-start.json`), `${JSON.stringify(rec, null, 2)}\n`);
        if (rec.kind === 'worker-error') log(`worker ${index} ERROR: ${rec.error}`);
      }
    });

    child.on('exit', (code) => resolveP({ index, code }));
  });
}

let subjectBefore = null;

async function main() {
  log(`stage ${STAGE} · model ${MODEL} · route ${ROUTE} · ${TOTAL} attempts across ${PARALLEL} workers`);
  subjectBefore = manifest('before');
  log(`subject ${subjectBefore.combinedHash.slice(0, 12)} dist=${subjectBefore.groups.dist.hash.slice(0, 8)} test=${subjectBefore.groups.test.hash.slice(0, 8)}`);

  await startServer();
  armCanary();
  log(`server owned on ${BASE}`);

  const per = Math.ceil(TOTAL / PARALLEL);
  const t0 = Date.now();
  const jobs = [];
  for (let i = 0; i < PARALLEL; i++) jobs.push(runWorker(i, per, 1 + i * per + STAGE_OFFSET()));
  const codes = await Promise.all(jobs);
  const elapsed = Date.now() - t0;

  if (watcher) watcher.close();
  stopServer();

  const subjectAfter = manifest('after');
  const identical = subjectBefore.combinedHash === subjectAfter.combinedHash;
  const invalid = [];
  if (!identical) invalid.push('SUBJECT_CHANGED_DURING_RUN');
  if (canaryHits.length) invalid.push(`DIST_CANARY_FIRED x${canaryHits.length}`);
  if (!portFree(PORT)) invalid.push('PORT_NOT_RELEASED');

  const durations = results.durations.slice().sort((a, b) => a - b);
  const pct = (p) => durations.length ? Math.round(durations[Math.floor(durations.length * p)] / 1000) : null;

  const summary = {
    run: RUN, stage: STAGE, model: MODEL, route: ROUTE, warmup: WARMUP, neighbours: NEIGHBOURS,
    parallel: PARALLEL, requested: TOTAL, executed: results.attempts,
    resolved: results.resolved, failed: results.failed, stalls: results.stalls,
    stallIds: stalls, byOutcome: results.byOutcome,
    durationsMs: { p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: durations.length ? Math.round(durations[durations.length - 1] / 1000) : null },
    elapsedMs: elapsed,
    workerExitCodes: codes,
    subject: { before: subjectBefore.combinedHash, after: subjectAfter.combinedHash, identical,
               dist: subjectBefore.groups.dist.hash, test: subjectBefore.groups.test.hash },
    canaryHits, valid: invalid.length === 0, invalidReasons: invalid,
    host: { platform: `${os.platform()} ${os.release()}`, cpus: os.cpus().length,
            freememMB: Math.round(os.freemem() / 1048576), loadavg: os.loadavg() },
    successSamples,
  };
  writeFileSync(join(workDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  appendFileSync(join(OUT, 'runs', 'index.jsonl'), `${JSON.stringify(summary)}\n`);

  log(`VALID=${summary.valid} executed=${summary.executed} stalls=${summary.stalls} p50=${summary.durationsMs.p50}ms p99=${summary.durationsMs.p99}ms max=${summary.durationsMs.max}ms elapsed=${Math.round(elapsed / 1000)}s`);
  if (!summary.valid) log(`INVALID: ${invalid.join(', ')}`);
  process.exit(summary.valid ? (summary.stalls ? 3 : 0) : 2);
}

/** Attempt ids never collide across stages. */
function STAGE_OFFSET() {
  const n = Number(arg('id-offset', 0));
  return Number.isFinite(n) ? n : 0;
}

process.on('SIGINT', () => { stopServer(); process.exit(130); });
main().catch((e) => { stopServer(); console.error(e); process.exit(2); });
