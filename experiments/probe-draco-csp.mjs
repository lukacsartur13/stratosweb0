// =============================================================================
// Does the production CSP let the self-hosted DRACO decoder run?
//
//     node experiments/probe-draco-csp.mjs
//
// WHY THIS EXISTS AS A SEPARATE PROBE
// -----------------------------------
// The two mountain GLBs declare `KHR_draco_mesh_compression` in
// `extensionsRequired`, so the page cannot draw a single triangle of them
// without a decoder. Three's `DRACOLoader` prefers a WebAssembly decoder, and
// WebAssembly compilation is governed by `script-src`. The deployed policy in
// netlify.toml is `script-src 'self'` with no `wasm-unsafe-eval`.
//
// That *reads* like it should block WASM. Whether it actually does is a
// question about a browser, not about a specification, and the answer decides
// which decoder ships — so it is measured here rather than assumed, before any
// header is changed. The probe serves the real files with the real header and
// reports what the browser did.
//
// WHAT IS MEASURED
// ----------------
// Three policies × two decoder configurations, each decoding both real GLBs:
//
//   * `production`      the exact CSP from netlify.toml, unchanged
//   * `wasm-allowed`    the same policy plus `wasm-unsafe-eval` on script-src
//   * `none`            no CSP at all, as an upper bound on decode speed
//
//   * `wasm`            DRACOLoader's default preference
//   * `js`              setDecoderConfig({ type: 'js' }) — the fallback
//
// For each cell: whether it decoded, the decode wall time, the triangle count
// that came out, and any CSP violation the browser reported. A cell that fails
// records the browser's own message verbatim — the point of the exercise is to
// have the exact error rather than a paraphrase of it.
//
// The server is a plain Node one rather than the Vite preview because the
// preview does not send netlify.toml's headers, and the header is the thing
// under test.
// =============================================================================

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 4331);

/** The deployed policy, copied from netlify.toml and collapsed to one line. */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

/**
 * The policies under test, in the order the investigation went.
 *
 * `production` and `wasm-allowed` were the first pass, on the assumption that
 * WebAssembly compilation was what a strict `script-src` would block. Both hung
 * for twenty seconds and then reported the same violation, and it was not about
 * WASM at all: `DRACOLoader` builds its decoder Worker from a `blob:` URL, no
 * `worker-src` is set, so the fallback to `script-src 'self'` refuses `blob:`.
 * Adding `wasm-unsafe-eval` changes nothing, because the worker never starts.
 *
 * `worker-blob` is therefore the actual minimum candidate, and
 * `worker-blob+wasm` exists to answer the follow-up: once the worker does
 * start, does compiling the .wasm inside it need `wasm-unsafe-eval` as well, or
 * does a Worker created from a blob get a policy that already permits it?
 */
const withScript = (extra) => PRODUCTION_CSP.replace("script-src 'self'", `script-src 'self' ${extra}`);
const withWorker = (csp) => csp + "; worker-src 'self' blob:";

const POLICIES = {
  production: PRODUCTION_CSP,
  'wasm-allowed': withScript("'wasm-unsafe-eval'"),
  'worker-blob': withWorker(PRODUCTION_CSP),
  'worker-blob+wasm': withWorker(withScript("'wasm-unsafe-eval'")),
  none: null,
};

const MODELS = {
  desktop: '/models/stratos-mountains-desktop.glb',
  mobile: '/models/stratos-mountains-mobile.glb',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json',
};

/**
 * The probe page.
 *
 * The script is a separate same-origin file, not an inline block, because the
 * policy under test is `script-src 'self'` — an inline module is blocked by it,
 * and a probe that trips that rule measures its own markup rather than the
 * decoder. (The first version of this file did exactly that and reported a
 * false failure in every CSP cell.) The production page has no inline scripts
 * either, so a separate file is also the faithful shape.
 */
const PAGE = `<!doctype html><meta charset="utf-8"><title>draco csp probe</title>
<script type="module" src="/probe.js"></script>`;

const PROBE_JS = `
import { GLTFLoader } from '/vendor/loaders/GLTFLoader.js';
import { DRACOLoader } from '/vendor/loaders/DRACOLoader.js';

const violations = [];
document.addEventListener('securitypolicyviolation', (e) => {
  violations.push({
    directive: e.effectiveDirective || e.violatedDirective,
    blockedURI: e.blockedURI,
    sample: e.sample || '',
  });
});

window.probe = async ({ url, type, workerLimit, timeoutMs = 20000 }) => {
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  // 'js' forces the asm.js decoder; 'wasm' is the loader's own default and is
  // set explicitly so the two runs differ only in this value.
  draco.setDecoderConfig({ type });
  // 0 makes DRACOLoader decode on the main thread instead of in a Worker.
  // The worker is created from a blob: URL, which a policy without blob: in
  // worker-src blocks — and the block does not reject, it simply never
  // answers. That distinction is the main thing this probe exists to find, so
  // it is a parameter rather than a constant.
  if (typeof workerLimit === 'number') draco.setWorkerLimit(workerLimit);

  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  const t0 = performance.now();
  try {
    // A blocked worker leaves loadAsync pending forever. Without this race the
    // probe hangs rather than reporting, which is exactly what happened the
    // first time it was run against the production policy.
    const gltf = await Promise.race([
      loader.loadAsync(url),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timed out after ' + timeoutMs + ' ms with no error and no result')), timeoutMs)
      ),
    ]);
    const t1 = performance.now();
    let triangles = 0;
    let meshes = 0;
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      const g = o.geometry;
      triangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    });
    draco.dispose();
    return { ok: true, ms: +(t1 - t0).toFixed(1), triangles, meshes, violations };
  } catch (err) {
    draco.dispose();
    return { ok: false, error: String(err && err.message || err).slice(0, 300), violations };
  }
};
window.probeReady = true;
`;

async function serve() {
  // Three's ES modules are served straight out of node_modules so the probe
  // exercises the same loader the application will. Mounted at `examples/jsm`
  // rather than at `loaders/` because GLTFLoader reaches sideways for
  // `../utils/BufferGeometryUtils.js`, which a deeper mount turns into a 404.
  const VENDOR = join(ROOT, 'experiments', 'node_modules', 'three', 'examples', 'jsm');

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = decodeURIComponent(url.pathname);
    const csp = POLICIES[url.searchParams.get('csp') ?? 'none'];

    const send = (code, body, type, extra = {}) => {
      const headers = { 'Content-Type': type, ...extra };
      if (csp) headers['Content-Security-Policy'] = csp;
      res.writeHead(code, headers);
      res.end(body);
    };

    if (path === '/' || path === '/probe') return send(200, PAGE, MIME['.html']);
    if (path === '/probe.js') return send(200, PROBE_JS, MIME['.js']);

    // three's loaders import bare-ish relative specifiers ('three'), so the
    // import map is avoided by rewriting to a served copy of the module.
    let file = null;
    if (path.startsWith('/vendor/')) file = join(VENDOR, path.slice('/vendor/'.length));
    else if (path.startsWith('/three/')) file = join(ROOT, 'experiments', 'node_modules', 'three', path.slice('/three/'.length));
    else file = join(ROOT, 'public', normalize(path).replace(/^(\.\.[/\\])+/, ''));

    if (!file || !existsSync(file)) return send(404, 'not found', 'text/plain');
    let body = await readFile(file);
    // Rewrite three's bare specifier to a URL the browser can fetch.
    if (path.startsWith('/vendor/')) {
      body = Buffer.from(
        body.toString('utf8').replace(/from ['"]three['"]/g, "from '/three/build/three.module.js'")
      );
    }
    send(200, body, MIME[extname(file)] ?? 'application/octet-stream');
  });

  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  return server;
}

async function main() {
  const server = await serve();
  const browser = await chromium.launch();
  const rows = [];

  /*
   * Only the Worker path is swept.
   *
   * `setWorkerLimit(0)` was measured as a possible escape from the blob: block
   * — decode on the main thread, no worker, no CSP question — and it is not
   * one. In three 0.171 it throws `Cannot read properties of undefined
   * (reading '_taskCosts')` under *every* policy including no policy at all, so
   * it is a broken call rather than a constrained one. That result is recorded
   * here rather than re-measured on every run.
   */
  const RUNNERS = [{ runner: 'worker', workerLimit: undefined }];

  try {
    for (const policy of Object.keys(POLICIES)) {
      for (const { runner, workerLimit } of RUNNERS) {
        for (const type of ['wasm', 'js']) {
          for (const [device, url] of Object.entries(MODELS)) {
          const page = await browser.newPage();
          const consoleErrors = [];
          page.on('console', (m) => {
            if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
          });
          page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e.message).slice(0, 300)));

          await page.goto(`http://127.0.0.1:${PORT}/probe?csp=${policy}`, { waitUntil: 'load' });
          await page.waitForFunction(() => window.probeReady === true, { timeout: 15_000 }).catch(() => {});

          const result = await page
            .evaluate(
              ([u, t, wl]) => window.probe({ url: u, type: t, workerLimit: wl ?? undefined }),
              [url, type, workerLimit ?? null]
            )
            .catch((e) => ({ ok: false, error: 'probe threw: ' + String(e.message).slice(0, 200), violations: [] }));

          rows.push({ policy, runner, type, device, ...result, consoleErrors });
          await page.close();
          }
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  // --- report -------------------------------------------------------------
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\nDRACO decode under the production CSP — Chromium ' + (await chromiumVersion()));
  console.log('='.repeat(78));
  console.log(pad('policy', 19) + pad('decoder', 9) + pad('asset', 9) + pad('ok', 5) + pad('ms', 9) + 'triangles');
  console.log('-'.repeat(78));
  for (const r of rows) {
    console.log(
      pad(r.policy, 19) + pad(r.type, 9) + pad(r.device, 9) + pad(r.ok ? 'yes' : 'NO', 5) +
        pad(r.ok ? r.ms : '—', 9) + (r.ok ? r.triangles.toLocaleString('en-GB') : '')
    );
  }

  const failures = rows.filter((r) => !r.ok);
  if (failures.length) {
    console.log('\nFailures, with the browser\'s own message:');
    for (const f of failures) {
      console.log(`\n  ${f.policy} / runs-on-${f.runner} / ${f.type}`);
      console.log(`    error: ${f.error}`);
      for (const v of f.violations) {
        console.log(`    violation: ${v.directive} blocked=${v.blockedURI} sample=${v.sample}`);
      }
      for (const c of f.consoleErrors.slice(0, 3)) console.log(`    console: ${c}`);
    }
  }

  const anyViolation = rows.flatMap((r) => r.violations ?? []);
  console.log(`\nCSP violations reported across all runs: ${anyViolation.length}`);
  for (const v of anyViolation.slice(0, 6)) {
    console.log(`  ${v.directive} blocked=${v.blockedURI} sample=${v.sample}`);
  }

  console.log(JSON.stringify({ rows }, null, 1).slice(0, 0)); // keep rows referenced
  process.exitCode = 0;
}

async function chromiumVersion() {
  const b = await chromium.launch();
  const v = b.version();
  await b.close();
  return v;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
