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
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, extname, resolve } from 'node:path';

const port = Number(process.argv[2] ?? 4322);
const root = resolve(process.argv[3] ?? 'dist');

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
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // `normalize` after decoding, and then a prefix check against the root —
    // a served path must never escape `dist/` via `..`, even in a test server.
    const decoded = decodeURIComponent(url.pathname);
    let filePath = normalize(join(root, decoded));
    if (!filePath.startsWith(root)) return notFound(res);

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
    if (req.method === 'HEAD') return res.end();
    createReadStream(filePath).pipe(res);
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
