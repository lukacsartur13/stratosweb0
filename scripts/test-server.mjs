#!/usr/bin/env node
/**
 * The static server the test suite runs against.
 *
 * WHY NOT `python3 -m http.server`
 * -------------------------------
 * Because it was losing requests. In the stabilization gate, two full-suite
 * runs out of five failed on `page.goto` for a *plain static HTML page* —
 * `/arajanlat.html` and `/nagyvallalat.html` — each timing out after 30 s
 * waiting for `load`, on a file that is 15 KB on disk and served correctly a
 * thousand times in the same run.
 *
 * The cause is the server, not the page. Python 3.9's `http.server` answers
 * HTTP/1.0 with `Connection: close` and has no keep-alive — the `--protocol`
 * flag that would change that arrived in 3.11, and this host has 3.9.6. So
 * every asset is a fresh TCP connection: five browser workers pulling a 1.4 MB
 * bundle, a `.glb`, and dozens of stylesheets and scripts each open and tear
 * down hundreds of sockets a second against one GIL-bound Python process
 * reading from an iCloud-backed volume. Under that, a connection occasionally
 * waits behind the accept queue for longer than the test's whole budget.
 *
 * A test suite cannot be trustworthy when its own web server drops a request
 * every few hundred page loads, and no amount of work on the *tests* would have
 * fixed it — which is exactly why it is fixed here instead.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * It is not an improvement on the old server's semantics, only on its
 * reliability. Same directory, same index resolution, same 404s, no caching
 * headers, no compression, no directory listings — anything that changed how
 * the artefact is *served* would change what the suite is testing, and the
 * point of this file is that nothing about the tests should have to change.
 *
 * No dependency. `node:http` speaks HTTP/1.1 with keep-alive by default, which
 * is the entire fix.
 */

import { createServer } from 'node:http';
import { createReadStream, openSync, writeSync, mkdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, extname, resolve, dirname } from 'node:path';

const port = Number(process.argv[2] ?? 4322);
const root = resolve(process.argv[3] ?? 'dist');

// ---------------------------------------------------------------------------
// The server half of the navigation-boundary recorder — §9.
//
// A Playwright timeout can say `page.goto` was pending. It cannot say whether
// this process ever saw the request, and no amount of work on the test side can
// answer that, because the answer lives here. So when STRATOS_NAV_DIAG_DIR is
// set, every request that carries a correlation id gets its server-side
// lifecycle appended to `server-<port>.jsonl` in that directory, and the test
// that owns the id reads those lines back when it builds a failure bundle.
//
// CORRELATION IS A HEADER, NOT A QUERY PARAMETER — §10. `?navId=` would change
// the URL, and with it the cache key, the canonical question and the path the
// browser takes. `x-stratos-nav` changes none of those: it is read, recorded
// and then ignored. Nothing below branches on it, so the bytes on the wire for
// an instrumented request are the bytes for an uninstrumented one.
//
// WHAT IT COSTS. Two synchronous appends for a document, one for a subresource,
// of ~200 bytes each. Synchronous rather than buffered on purpose: the reader
// is a different process that shows up precisely when this one is suspected of
// having stalled, and a line still sitting in a flush timer is the one line
// that would have settled it. Requests with no correlation id are not recorded
// at all, so an uninstrumented suite pays one header lookup per request.
// ---------------------------------------------------------------------------
const DIAG_DIR = process.env.STRATOS_NAV_DIAG_DIR ?? null;
let diagFd = null;
if (DIAG_DIR) {
  mkdirSync(DIAG_DIR, { recursive: true });
  diagFd = openSync(join(DIAG_DIR, `server-${port}.jsonl`), 'a');
}
/** Monotonic, and paired once with a wall clock so the test can align to it. */
const diagWrite = (o) => {
  if (diagFd === null) return;
  try { writeSync(diagFd, `${JSON.stringify(o)}\n`); } catch { /* never fail a request for a log */ }
};
if (diagFd !== null) {
  diagWrite({ kind: 'epoch', port, wallMs: Date.now(), hrMs: Number(process.hrtime.bigint() / 1000n) / 1000 });
}
const hr = () => Number(process.hrtime.bigint() / 1000n) / 1000;

/**
 * Content types, and why the list is explicit.
 *
 * A wrong type is not a 404 — it is a page that loads and then behaves oddly,
 * which is far more expensive to diagnose. `.glb` and `.wasm` matter most:
 * served as `text/plain` the model decoder fails inside the scene, and the
 * failure surfaces as a homepage that never finishes initialising.
 */
const TYPES = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.hdr': 'application/octet-stream',
  '.ktx2': 'application/octet-stream',
  '.csv': 'text/csv; charset=utf-8',
}));

const notFound = (res) => {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('404');
};

const server = createServer(async (req, res) => {
  const navId = diagFd === null ? null : (req.headers['x-stratos-nav'] ?? null);
  let seq = 0;
  let declaredBytes = null;
  const ev = (phase, extra) =>
    diagWrite({ kind: 'req', navId, seq: seq++, phase, hrMs: hr(), method: req.method, url: req.url, ...extra });

  if (navId) {
    ev('received', {
      remotePort: req.socket.remotePort ?? null,
      reusedSocket: req.socket.__stratosUsed === true,
      httpVersion: req.httpVersion,
    });
    req.socket.__stratosUsed = true;
    // Terminal states, all of them. A response that is never written is exactly
    // the case this exists to catch, so `close` is recorded whether or not
    // `finish` preceded it — the pair distinguishes a completed response from
    // an abandoned one.
    res.on('finish', () => ev('finish', { status: res.statusCode, bytes: declaredBytes }));
    res.on('close', () => ev('close', { status: res.statusCode, writableEnded: res.writableEnded }));
    req.on('aborted', () => ev('aborted', {}));
    req.socket.on('error', (e) => ev('socket-error', { message: String(e && e.message) }));
  }

  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // `normalize` after decoding, and then a prefix check against the root —
    // a served path must never escape `dist/` via `..`, even in a test server.
    const decoded = decodeURIComponent(url.pathname);
    let filePath = normalize(join(root, decoded));
    if (!filePath.startsWith(root)) return notFound(res);

    if (navId) ev('resolved', { path: filePath.slice(root.length) });
    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = join(filePath, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    if (!info?.isFile()) return notFound(res);

    res.writeHead(200, {
      'content-type': TYPES.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream',
      'content-length': info.size,
      // The suite asserts against a freshly built artefact every time, and a
      // cached response from a previous build is a whole class of confusing
      // failure that costs nothing to rule out here.
      'cache-control': 'no-store',
    });
    if (navId) { declaredBytes = info.size; ev('head-sent', { status: 200, bytes: info.size, type: res.getHeader('content-type') }); }
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(filePath);
    if (navId) {
      let first = true;
      stream.on('data', () => { if (first) { first = false; ev('first-write', {}); } });
      stream.on('error', (e) => ev('read-error', { message: String(e && e.message) }));
    }
    stream.pipe(res);
  } catch {
    notFound(res);
  }
});

// The default of 5 s closes idle sockets between a page's asset bursts, which
// puts the connection churn straight back. Playwright's own default timeouts
// sit well inside this.
server.keepAliveTimeout = 60_000;
server.headersTimeout = 65_000;
// Node's default backlog is 511; the failures above were connections waiting to
// be accepted, so this is the number that matters most.
server.listen(port, '127.0.0.1', 511, () => {
  console.log(`test-server: ${root} on http://127.0.0.1:${port}`);
});
