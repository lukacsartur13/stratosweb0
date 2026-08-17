#!/usr/bin/env node
/**
 * Joins a stress run's client-side records to the server's NDJSON log.
 *
 * Kept out of `stress.mjs` on purpose: the driver's job is to produce evidence
 * without interpreting it, and anything that reads the whole server log while
 * the run is in progress would be competing for the same disk the run is
 * measuring. This is the post-pass. It answers three questions the driver
 * cannot:
 *
 *   §8   for every failed navigation, what did the *server* see — and does its
 *        view agree with the client's about where the exchange stopped;
 *   §27  did failed and successful attempts receive the same artefact (status,
 *        content-length) for the main document;
 *   §14  did failures land on reused keep-alive connections more often than
 *        chance would predict.
 *
 * Usage: node scripts/webkit-nav/correlate.mjs <label> [--out <dir>]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import os from 'node:os';

const label = process.argv[2];
if (!label) { console.error('usage: correlate.mjs <label>'); process.exit(2); }
const outIdx = process.argv.indexOf('--out');
const OUT = resolve(outIdx === -1 ? '_build/reports/webkit-navigation' : process.argv[outIdx + 1]);
const SCRATCH = process.env.STRATOS_NAV_SCRATCH ?? join(os.tmpdir(), 'stratos-webkit-nav');

const runDir = join(OUT, 'runs', label);
const records = JSON.parse(await readFile(join(runDir, 'records.json'), 'utf8'));
const summary = JSON.parse(await readFile(join(runDir, 'summary.json'), 'utf8'));

const logIdx = process.argv.indexOf('--server-log');
const serverLogPath = logIdx === -1
  ? join(SCRATCH, `${label}-server.ndjson`)
  : process.argv[logIdx + 1];
let events = [];
if (existsSync(serverLogPath)) {
  events = (await readFile(serverLogPath, 'utf8')).trim().split('\n')
    .filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

const byNav = new Map();
for (const e of events) {
  if (!e.navId) continue;
  if (!byNav.has(e.navId)) byNav.set(e.navId, []);
  byNav.get(e.navId).push(e);
}

// ---------------------------------------------------------------------------
// §27 — response consistency for the main document.
// ---------------------------------------------------------------------------
const mainDocPaths = new Set(summary.config.paths);
const docResponses = events.filter(
  (e) => e.event === 'response.finish' && mainDocPaths.has(String(e.path).split('?')[0]),
);
const contentLengths = new Map();
for (const r of docResponses) {
  const p = String(r.path).split('?')[0];
  const key = `${p}|${r.status}|${r.contentLength}`;
  contentLengths.set(key, (contentLengths.get(key) ?? 0) + 1);
}
const shortResponses = events.filter((e) => e.event === 'response.finish' && e.short);
const truncated = events.filter((e) => e.event === 'response.close-before-finish');

// ---------------------------------------------------------------------------
// §14 — keep-alive reuse, overall and among failures.
// ---------------------------------------------------------------------------
const failures = records.filter((r) => r.boundary !== 'SUCCESS');
const allDocRequests = events.filter(
  (e) => e.event === 'request' && mainDocPaths.has(String(e.path).split('?')[0]),
);
const reusedAll = allDocRequests.filter((e) => e.reused).length;
const failedNavIds = new Set(failures.map((f) => f.navId));
const failedDocRequests = allDocRequests.filter((e) => failedNavIds.has(e.navId));
const reusedFailed = failedDocRequests.filter((e) => e.reused).length;

// ---------------------------------------------------------------------------
// Slow tail on the server side. Not the same question as the client's latency:
// this is how long the *server* took, which is what separates "the server was
// slow" from "the bytes never reached the browser".
// ---------------------------------------------------------------------------
const finishes = events.filter((e) => e.event === 'response.finish');
const pct = (values, q) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const totals = finishes.map((e) => e.totalMs);
const stats = finishes.map((e) => e.statMs).filter((v) => v !== null);
const firstBytes = finishes.map((e) => e.firstByteMs).filter((v) => v !== null && v !== undefined);

const slowest = [...finishes].sort((a, b) => b.totalMs - a.totalMs).slice(0, 20)
  .map((e) => ({ path: e.path, navId: e.navId, totalMs: e.totalMs, statMs: e.statMs, firstByteMs: e.firstByteMs, bytes: e.bytes }));

// ---------------------------------------------------------------------------
// §29 — write the server's side of every failure into its bundle.
// ---------------------------------------------------------------------------
for (const f of failures) {
  const dir = join(OUT, 'failures', `${label}-${f.navId}`);
  await mkdir(dir, { recursive: true });
  const own = byNav.get(f.navId) ?? [];
  // Everything the server did in the same window, not only this navigation's
  // own requests: a socket reset belonging to the *previous* attempt is exactly
  // the kind of thing a navId filter would hide.
  const t0 = own.length ? own[0].t - 2_000 : 0;
  const t1 = own.length ? own[own.length - 1].t + 35_000 : 0;
  const window = events.filter((e) => e.t >= t0 && e.t <= t1);
  await writeFile(join(dir, 'server.log'),
    window.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await writeFile(join(dir, 'server-summary.json'), JSON.stringify({
    navId: f.navId,
    requestsSeenByServer: own.filter((e) => e.event === 'request').length,
    responsesFinished: own.filter((e) => e.event === 'response.finish').length,
    responsesTruncated: own.filter((e) => e.event === 'response.close-before-finish').length,
    inflightHeartbeats: window.filter((e) => e.event === 'inflight').length,
    socketErrors: window.filter((e) => e.event === 'socket.error').length,
    // The client's list of requests the server never answered.
    unanswered: own.filter((e) => e.event === 'request')
      .filter((req) => !own.some((f2) => f2.event === 'response.finish' && f2.id === req.id))
      .map((req) => ({ path: req.path, id: req.id, socketId: req.socketId, reused: req.reused })),
  }, null, 2));
}

const report = {
  label,
  attempts: summary.attempts,
  failures: failures.length,
  serverEventsSeen: events.length,
  serverSawRequestForEveryNav: records.every((r) => byNav.has(r.navId)),
  responseConsistency: {
    distinctMainDocumentArtefacts: [...contentLengths.entries()].map(([k, n]) => ({ key: k, count: n })),
    shortResponses: shortResponses.length,
    truncatedResponses: truncated.length,
  },
  keepAlive: {
    mainDocumentRequests: allDocRequests.length,
    onReusedConnection: reusedAll,
    reuseRate: allDocRequests.length ? +(reusedAll / allDocRequests.length).toFixed(4) : null,
    failedMainDocumentRequests: failedDocRequests.length,
    failedOnReusedConnection: reusedFailed,
  },
  serverLatency: {
    responses: finishes.length,
    totalMs: { p50: pct(totals, 0.5), p95: pct(totals, 0.95), p99: pct(totals, 0.99), max: totals.length ? Math.max(...totals) : null },
    statMs: { p50: pct(stats, 0.5), p95: pct(stats, 0.95), p99: pct(stats, 0.99), max: stats.length ? Math.max(...stats) : null },
    firstByteMs: { p50: pct(firstBytes, 0.5), p95: pct(firstBytes, 0.95), p99: pct(firstBytes, 0.99), max: firstBytes.length ? Math.max(...firstBytes) : null },
    slowestResponses: slowest,
  },
  sockets: {
    opened: events.filter((e) => e.event === 'socket.open').length,
    closed: events.filter((e) => e.event === 'socket.close').length,
    closedWithError: events.filter((e) => e.event === 'socket.close' && e.hadError).length,
    errors: events.filter((e) => e.event === 'socket.error').map((e) => e.code),
    timeouts: events.filter((e) => e.event === 'socket.timeout').length,
    clientErrors: events.filter((e) => e.event === 'clientError').map((e) => e.code),
    requestsAborted: events.filter((e) => e.event === 'request.aborted').length,
    fileErrors: events.filter((e) => e.event === 'file.error').map((e) => ({ path: e.path, code: e.code })),
  },
  inflightHeartbeats: events.filter((e) => e.event === 'inflight').length,
};

await writeFile(join(runDir, 'correlation.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
