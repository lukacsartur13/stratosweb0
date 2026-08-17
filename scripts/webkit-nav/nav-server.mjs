#!/usr/bin/env node
/**
 * The instrumented twin of `scripts/test-server.mjs`.
 *
 * WHY A TWIN AND NOT A FLAG
 * -------------------------
 * `scripts/test-server.mjs` is what the repository-wide suite runs against, and
 * §13 asks for connection-level diagnostics *without* leaving noisy logging in
 * normal test output. Threading a `--verbose` through the real server would put
 * a branch on the hot path of every gate run for the sake of one investigation.
 * This file instead copies the serving logic verbatim — same root resolution,
 * same index fallback, same content types, same `cache-control: no-store`, same
 * `keepAliveTimeout`/`headersTimeout`/backlog — and adds only observation.
 *
 * The serving half MUST stay identical. If it drifts, this harness stops being
 * evidence about the suite's server and becomes evidence about a different one.
 * The differences are exactly two, and both are additive:
 *
 *   1. every socket and request lifecycle transition is appended to an NDJSON
 *      log (§7, §13);
 *   2. the file read is timed separately from the response write, so that a
 *      stall *inside the filesystem* is distinguishable from a stall on the
 *      wire (§8).
 *
 * CORRELATION (§6)
 * ----------------
 * Requests are correlated to navigation attempts by an `x-nav-id` request
 * header, which the driver sets on the browser context before each attempt.
 * A header rather than a query parameter on purpose: §6 forbids anything that
 * could change routing or caching, and `/index.html?nav=17` is a different
 * cache key and a different path through any rewrite rule. A request header is
 * genuinely out of band — the static server does not read it for anything but
 * the log, and no rewrite, redirect or fallback in this project inspects it.
 *
 * WHERE THE LOG GOES
 * ------------------
 * Deliberately not into the repository. `dist/` sits on an iCloud-backed
 * volume, and the whole point of the read timing is to observe that volume's
 * behaviour; writing a log line per event onto the same provider would be the
 * harness measuring itself. The log path is a required argument and the driver
 * points it at local scratch.
 *
 * Usage:  node scripts/webkit-nav/nav-server.mjs <port> <root> <logfile>
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, normalize, extname, resolve } from 'node:path';

const port = Number(process.argv[2] ?? 4322);
const root = resolve(process.argv[3] ?? 'dist');
const logPath = process.argv[4];
if (!logPath) {
  console.error('usage: nav-server.mjs <port> <root> <logfile>');
  process.exit(2);
}

// High-resolution wall clock, comparable across processes on this host: the
// driver computes its timestamps the same way, so client and server events land
// on one timeline without either side having to send the other a clock.
const now = () => performance.timeOrigin + performance.now();

const log = createWriteStream(logPath, { flags: 'a' });
const emit = (event, fields) => {
  log.write(`${JSON.stringify({ t: now(), event, ...fields })}\n`);
};

// ---------------------------------------------------------------------------
// Serving logic below this line is a verbatim copy of scripts/test-server.mjs.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Observation state.
// ---------------------------------------------------------------------------
let socketSeq = 0;
let requestSeq = 0;
/** Requests that have been received and whose response has not finished. */
const inFlight = new Map();

const server = createServer(async (req, res) => {
  const id = ++requestSeq;
  const sock = req.socket;
  const socketId = sock.__navSocketId ?? -1;
  // How many requests this socket has already served. Non-zero means keep-alive
  // reuse, which §14 asks to be able to correlate against.
  const ordinal = (sock.__navRequests = (sock.__navRequests ?? 0) + 1);
  const navId = req.headers['x-nav-id'] ?? null;
  const started = now();

  const record = {
    id, socketId, ordinal, navId, path: req.url, method: req.method,
    started, statMs: null, firstByteAt: null, bytes: 0, contentLength: null,
    status: null, outcome: null,
  };
  inFlight.set(id, record);

  emit('request', {
    id, socketId, ordinal, navId, method: req.method, path: req.url,
    // Present when the browser reused a connection it had parked.
    reused: ordinal > 1,
  });

  req.on('aborted', () => emit('request.aborted', { id, navId, path: req.url }));

  res.on('finish', () => {
    record.outcome = 'finish';
    inFlight.delete(id);
    emit('response.finish', {
      id, navId, path: req.url, status: record.status,
      bytes: record.bytes, contentLength: record.contentLength,
      totalMs: +(now() - started).toFixed(3),
      statMs: record.statMs,
      firstByteMs: record.firstByteAt === null ? null : +(record.firstByteAt - started).toFixed(3),
      // The signature of a truncated body: the client is still waiting for
      // bytes that will never come, and `load` can never fire. `HEAD` is
      // excluded because a bodiless response to it is correct, and a readiness
      // probe that reports itself as a truncation is a false positive in every
      // report downstream.
      short: req.method !== 'HEAD'
        && record.contentLength !== null && record.bytes !== record.contentLength,
    });
  });

  res.on('close', () => {
    if (record.outcome) return; // already finished cleanly
    record.outcome = 'close-before-finish';
    inFlight.delete(id);
    emit('response.close-before-finish', {
      id, navId, path: req.url, status: record.status,
      bytes: record.bytes, contentLength: record.contentLength,
      totalMs: +(now() - started).toFixed(3),
      writableFinished: res.writableFinished,
    });
  });

  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const decoded = decodeURIComponent(url.pathname);
    let filePath = normalize(join(root, decoded));
    if (!filePath.startsWith(root)) {
      record.status = 404;
      return notFound(res);
    }

    const statStart = now();
    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = join(filePath, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    record.statMs = +(now() - statStart).toFixed(3);
    if (!info?.isFile()) {
      record.status = 404;
      return notFound(res);
    }

    record.status = 200;
    record.contentLength = info.size;
    res.writeHead(200, {
      'content-type': TYPES.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-store',
    });
    if (req.method === 'HEAD') return res.end();

    // Timed explicitly rather than piped blind. `createReadStream` does its
    // `open` and every `read` on the libuv threadpool — four threads by
    // default — so a single file whose bytes are not locally resident blocks a
    // quarter of the server's file I/O capacity for as long as the filesystem
    // takes to produce them, with no error and no timeout. That is exactly the
    // shape of stall this workstream is looking for, and it is invisible
    // unless the read is measured apart from the write.
    const stream = createReadStream(filePath);
    stream.on('open', () => {
      emit('file.open', { id, navId, path: req.url, openMs: +(now() - statStart).toFixed(3) });
    });
    stream.on('data', (chunk) => {
      if (record.firstByteAt === null) {
        record.firstByteAt = now();
        emit('file.firstByte', {
          id, navId, path: req.url,
          firstByteMs: +(record.firstByteAt - started).toFixed(3),
        });
      }
      record.bytes += chunk.length;
    });
    stream.on('error', (err) => {
      emit('file.error', { id, navId, path: req.url, code: err.code, message: err.message });
      res.destroy(err);
    });
    stream.pipe(res);
  } catch (err) {
    emit('handler.error', { id, navId, path: req.url, message: String(err) });
    notFound(res);
  }
});

server.on('connection', (socket) => {
  const socketId = ++socketSeq;
  socket.__navSocketId = socketId;
  socket.__navRequests = 0;
  const opened = now();
  emit('socket.open', { socketId, remotePort: socket.remotePort });

  socket.on('error', (err) => emit('socket.error', { socketId, code: err.code, message: err.message }));
  socket.on('timeout', () => emit('socket.timeout', { socketId }));
  socket.on('close', (hadError) => emit('socket.close', {
    socketId, hadError, requests: socket.__navRequests,
    lifetimeMs: +(now() - opened).toFixed(3),
    bytesRead: socket.bytesRead, bytesWritten: socket.bytesWritten,
  }));
});

server.on('clientError', (err, socket) => {
  emit('clientError', { socketId: socket.__navSocketId ?? -1, code: err.code, message: err.message });
  socket.destroy();
});

server.keepAliveTimeout = 60_000;
server.headersTimeout = 65_000;

// A heartbeat carrying whatever is still unanswered. On a healthy server this
// is an empty array forever; the one line where it is not is the line that says
// which request the browser is waiting on.
const heartbeat = setInterval(() => {
  const stuck = [...inFlight.values()]
    .filter((r) => now() - r.started > 1_000)
    .map((r) => ({
      id: r.id, navId: r.navId, path: r.path, status: r.status,
      ageMs: +(now() - r.started).toFixed(0), bytes: r.bytes,
      contentLength: r.contentLength, statMs: r.statMs,
      firstByte: r.firstByteAt !== null,
    }));
  if (stuck.length) emit('inflight', { stuck });
}, 500);
heartbeat.unref();

const shutdown = () => {
  emit('shutdown', { sockets: socketSeq, requests: requestSeq });
  log.end(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(port, '127.0.0.1', 511, () => {
  emit('listen', { port, root });
  console.log(`nav-server: ${root} on http://127.0.0.1:${port} (log: ${logPath})`);
});
