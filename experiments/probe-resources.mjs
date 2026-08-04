// =============================================================================
// Renderer resources and transferred assets, at a set of altitudes.
//
// §1 asks the baseline to record "homepage renderer resources" and "homepage
// transferred assets"; §33 asks for the same numbers before and after the cloud
// work so the delta is a measurement rather than an assertion. One script, run
// twice, writes both.
//
// The counts come from `renderer.info` — the renderer's own bookkeeping, not an
// inference from the scene graph — plus a walk of the scene for the object and
// program counts three.js does not total for us.
//
// Usage (repo root, with `npm run dev:full` running on :5176):
//   OUT=_build/reports/phase7-resources-before.json node experiments/probe-resources.mjs
// =============================================================================
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5176/experiments/stratos-ascent-full/full.html';
const OUT = process.env.OUT ?? '_build/reports/phase7-resources.json';
const STOPS = (process.env.STOPS ?? '0,7000,9500,11000,11800,12000,12500,18000,30000')
  .split(',')
  .map(Number);

const VIEWS = [
  { id: '1440x900', width: 1440, height: 900, dsf: 1, mobile: false },
  { id: '390x844', width: 390, height: 844, dsf: 3, mobile: true },
];

const browser = await chromium.launch();
const report = { url: URL, capturedAt: new Date().toISOString(), views: {} };

for (const view of VIEWS) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: view.dsf,
    isMobile: view.mobile,
    hasTouch: view.mobile,
  });
  const page = await context.newPage();

  // Transfer is measured off the network, not off the bundle listing: a chunk
  // that is emitted but never requested costs nothing, and the whole point of
  // the lazy renderer chunk is that some paths never ask for it.
  const transfer = [];
  page.on('response', async (res) => {
    try {
      const headers = await res.allHeaders();
      transfer.push({
        url: new URL(res.url()).pathname,
        type: (headers['content-type'] ?? '').split(';')[0],
        bytes: Number(headers['content-length'] ?? 0),
      });
    } catch {
      /* a response that vanished with its context is not worth failing over */
    }
  });

  await page.addInitScript(() => {
    Object.defineProperty(globalThis, '__stratos', {
      configurable: true,
      get: () => globalThis.__s,
      set: (v) => {
        globalThis.__s = v;
        if (v?.journey?.debug) {
          v.journey.debug.ringRotation = 0;
          v.journey.debug.cloudFreeze = true;
        }
      },
    });
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas');
  await page.waitForFunction(() => !!globalThis.__stratos?.gl, { timeout: 20_000 });
  await page.waitForTimeout(3000);

  const samples = [];
  for (const metres of STOPS) {
    await page.evaluate((m) => {
      globalThis.__stratos.journey.debug.altitude = m;
    }, metres);
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      scrollTo({ top: max * globalThis.__stratos.journey.current, behavior: 'instant' });
    });
    await page.waitForTimeout(1800);

    samples.push(
      await page.evaluate((m) => {
        const h = globalThis.__stratos;
        const info = h.gl.info;
        let children = 0;
        let meshes = 0;
        h.scene.traverse((o) => {
          children++;
          if (o.isMesh || o.isInstancedMesh || o.isPoints) meshes++;
        });
        return {
          altitude: m,
          drawCalls: info.render.calls,
          triangles: info.render.triangles,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          programs: info.programs?.length ?? 0,
          renderTargets: h.gl.properties?.renderTargets ?? null,
          sceneChildren: children,
          meshes,
          effectiveDpr: h.gl.getPixelRatio(),
          samples: h.gl.getContext().getParameter(h.gl.getContext().SAMPLES),
          cloud: h.cloud
            ? {
                visible: h.cloud.visible,
                coverage: +h.cloud.coverage.toFixed(4),
                opacity: +h.cloud.opacity.toFixed(4),
                layerCount: h.cloud.layerCount,
                layers: h.cloud.layers,
                sampling: h.cloud.sampling,
                art: h.cloud.art,
                meridianContrast: +h.cloud.meridianContrast.toFixed(4),
                mountainFade: +h.cloud.mountainFade.toFixed(4),
              }
            : null,
        };
      }, metres),
    );
  }

  // De-duplicate: a response logged twice is a redirect chain, not two downloads.
  const seen = new Map();
  for (const t of transfer) if (!seen.has(t.url)) seen.set(t.url, t);
  const assets = [...seen.values()];
  const total = (pred) => assets.filter(pred).reduce((n, a) => n + a.bytes, 0);

  report.views[view.id] = {
    samples,
    transfer: {
      requests: assets.length,
      totalBytes: total(() => true),
      jsBytes: total((a) => a.url.endsWith('.js')),
      cssBytes: total((a) => a.url.endsWith('.css')),
      modelBytes: total((a) => a.url.endsWith('.glb')),
      fontBytes: total((a) => a.url.endsWith('.woff2')),
      imageBytes: total((a) => /\.(png|jpe?g|webp|svg)$/.test(a.url)),
    },
  };

  const last = samples[samples.length - 1];
  console.log(
    `${view.id}  dpr ${last.effectiveDpr}  msaa ${last.samples}x  ` +
      `geo ${last.geometries} tex ${last.textures} prog ${last.programs}  ` +
      `${report.views[view.id].transfer.requests} requests / ` +
      `${(report.views[view.id].transfer.totalBytes / 1024).toFixed(0)} KB`,
  );
  for (const s of samples) {
    console.log(
      `  ${String(s.altitude).padStart(5)} m  calls ${String(s.drawCalls).padStart(3)}  ` +
        `tris ${String(s.triangles).padStart(7)}  children ${String(s.sceneChildren).padStart(3)}  ` +
        (s.cloud ? `cloud ${s.cloud.layerCount} layers @${s.cloud.sampling} (${s.cloud.art})` : 'cloud n/a'),
    );
  }

  await context.close();
}

await browser.close();
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`\nwritten: ${OUT}`);
