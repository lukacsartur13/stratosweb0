// =============================================================================
// Phase 8 — the automated route audit (§16).
//
// The route matrix reads markup. This drives a real browser at real viewports
// and asks the questions markup cannot answer: does the document actually load,
// does anything fail to fetch, does the console stay clean, and does the layout
// stay inside the viewport on a 360 px phone and at 200% zoom.
//
//   node scripts/route-audit.mjs                 # every route, every viewport
//   node scripts/route-audit.mjs --quick         # desktop + portrait phone only
//
// Serves dist/ on its own port so it never collides with the Playwright run,
// and writes _build/reports/phase8-route-audit.json.
//
// Exit code is 1 if any route fails a hard check, so this is usable as a gate.
// =============================================================================

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_build', 'reports', 'phase8-route-audit.json');
// 4322 is playwright.config.ts, 4324 the experiments config, 4327 the FULL
// config and 4328 the review package. Picking one of those means this audit
// and a test run cannot be in flight at the same time — and worse, cleaning
// up 'my' port kills someone else's server mid-suite, which is exactly how
// a green harness turned into 60 phantom failures once.
// ... and picking a fixed one means assuming it is free, which it is not
// always. On 2026-08-19 an unrelated session on this host left a server of its
// own on 4331. `serve()` below spawned python, python could not bind, python
// wrote "Address already in use" to a discarded stderr and exited, and this
// audit then ran all 792 of its checks against ANOTHER PROJECT'S WEBSITE and
// reported 792 confident failures of this one. Not a single line of it was
// true, and nothing in the output said so.
//
// So the port is a starting point rather than a decision, and — because a free
// port can still be taken in the microseconds between the check and the bind —
// the server that answers is required to PROVE it is serving this dist before
// a single route is audited.
const PORT_FROM = 4331;
let PORT = PORT_FROM;
let BASE = `http://127.0.0.1:${PORT}`;
const QUICK = process.argv.includes('--quick');

// §14's list. The full set runs by default; --quick keeps the authoring loop
// short without pretending it covered the rest.
const VIEWPORTS = QUICK
  ? [{ name: '1440x900', width: 1440, height: 900 }, { name: '390x844', width: 390, height: 844 }]
  : [
      { name: '1920x1080', width: 1920, height: 1080 },
      { name: '1440x900', width: 1440, height: 900 },
      { name: '1366x768', width: 1366, height: 768 },
      { name: '1280x800', width: 1280, height: 800 },
      { name: '1024x768', width: 1024, height: 768 },
      { name: '820x1180', width: 820, height: 1180 },
      { name: '430x932', width: 430, height: 932 },
      { name: '390x844', width: 390, height: 844 },
      { name: '375x812', width: 375, height: 812 },
      { name: '360x800', width: 360, height: 800 },
      { name: '844x390', width: 844, height: 390 },
      // 200% zoom is not a device: it is a 1280-wide window whose CSS pixels
      // are twice as big, which is what a 640 px viewport at dpr 2 models.
      { name: '1280@200%', width: 640, height: 400, zoom: true },
    ];

const LANGS = ['hu', 'en', 'de'];

async function routes() {
  const { slugs } = JSON.parse(await readFile(join(ROOT, '_build', 'routes.json'), 'utf8'));
  const out = [];
  for (const [key, byLang] of Object.entries(slugs)) {
    // The three homepages are a Vite bundle with their own regression tests;
    // this audit is about the generated routes.
    if (key === 'index') continue;
    for (const lang of LANGS) out.push({ key, lang, url: `/${lang === 'hu' ? '' : lang + '/'}${byLang[lang]}` });
  }
  return out;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Bindable right now, by the server this is about to start.
 *
 * Probes the wildcard AND the loopback binding, because on macOS the two can
 * coexist on one port and each probe is blind to what the other catches. A
 * `python3 -m http.server` holds `*:PORT` and is invisible to a loopback probe;
 * `scripts/test-server.mjs` holds `127.0.0.1:PORT` and is invisible to a
 * wildcard one. Either will happily answer the fetch below.
 *
 * Not hypothetical: it is what this check found the first time it ran in this
 * workstream, with a stale `http.server` from an unrelated checkout holding
 * `*:4331`. `proveItIsOurs` caught it and aborted — the guard working exactly as
 * designed — but a gate that aborts because a stranger is on the port it happened
 * to pick is a gate that cannot be repeated, and repeatability is the whole
 * point of the sequence. Asking the right question moves on to 4332 instead.
 *
 * Still advisory: `proveItIsOurs` is what actually decides.
 */
const bindOne = (port, host) =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    if (host) probe.listen(port, host); else probe.listen(port);
  });

const bindable = async (port) => (await bindOne(port)) && (await bindOne(port, '127.0.0.1'));

async function freePort(from, span = 40) {
  for (let p = from; p < from + span; p += 1) if (await bindable(p)) return p;
  throw new Error(`no free port in ${from}..${from + span}`);
}

function serve() {
  return spawn('python3', ['-m', 'http.server', String(PORT), '--directory', join(ROOT, 'dist')],
    { stdio: 'ignore' });
}

/**
 * The check that would have turned 792 false failures into one true error.
 *
 * Readiness is not identity. Something answering on the port says only that
 * something is answering; this compares what it serves against the bytes on
 * disk, so a foreign server is a loud abort rather than a silent audit of
 * somebody else's site.
 */
async function proveItIsOurs() {
  const onDisk = await readFile(join(ROOT, 'dist', 'index.html'), 'utf8');
  const deadline = Date.now() + 20_000;
  let last = 'never answered';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/index.html`);
      const body = await res.text();
      if (body === onDisk) return;
      last = `serves a DIFFERENT /index.html (${body.length} bytes, ours is ${onDisk.length})`;
    } catch (e) {
      last = String(e.message ?? e);
    }
    await wait(250);
  }
  throw new Error(
    `route-audit: the server on :${PORT} is not this checkout's — ${last}.\n` +
    'Refusing to audit it. Nothing below this line would have been about this project.',
  );
}

async function main() {
  PORT = await freePort(PORT_FROM);
  BASE = `http://127.0.0.1:${PORT}`;
  const server = serve();
  try {
    await proveItIsOurs();
  } catch (e) {
    server.kill();
    throw e;
  }
  console.log(`route-audit: serving dist/ on :${PORT}`);

  const browser = await chromium.launch();
  const all = await routes();
  const results = [];
  let hardFailures = 0;

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.zoom ? 2 : 1,
    });

    for (const route of all) {
      const page = await context.newPage();
      const consoleErrors = [];
      const failedRequests = [];

      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('requestfailed', (r) => {
        const u = r.url();
        if (u.startsWith(BASE)) failedRequests.push(`${u} — ${r.failure()?.errorText ?? 'failed'}`);
      });

      const response = await page.goto(BASE + route.url, { waitUntil: 'load' });
      // The reveal animations and the altimeter settle on the next frames; a
      // measurement taken before that reports a layout nobody ever sees.
      await page.waitForTimeout(250);

      const facts = await page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        // Which element is actually sticking out — a number alone is not
        // actionable at eleven viewports across sixty-six routes.
        let widest = null;
        if (overflow > 1) {
          const limit = document.documentElement.clientWidth;
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.right > limit + 1 && r.width > 0) {
              widest = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} +${Math.round(r.right - limit)}px`;
              break;
            }
          }
        }
        const imgs = [...document.querySelectorAll('img')];
        return {
          lang: document.documentElement.lang,
          title: document.title,
          description: q('meta[name="description"]')?.content ?? null,
          canonical: q('link[rel="canonical"]')?.href ?? null,
          ogTitle: q('meta[property="og:title"]')?.content ?? null,
          ogImage: q('meta[property="og:image"]')?.content ?? null,
          hreflang: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].length,
          h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
          hasMain: !!q('main'),
          hasNav: !!q('header.nav nav'),
          hasFooter: !!q('footer') || document.body.dataset.noFooter === 'true',
          skipLink: !!q('a.skip'),
          primaryCta: !!q('main a.btn:not(.btn--ghost), main button.btn:not(.btn--ghost)'),
          internalLinks: [...document.querySelectorAll('main a[href]')]
            .map((a) => a.getAttribute('href'))
            .filter((h) => h && !/^(https?:|mailto:|tel:|#)/.test(h)),
          images: imgs.length,
          imagesWithoutDims: imgs.filter((i) => !i.getAttribute('width') || !i.getAttribute('height')).length,
          imagesWithoutAlt: imgs.filter((i) => i.getAttribute('alt') === null).length,
          brokenImages: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
          // The other half of `imagesWithoutDims`, and the reason it is here.
          //
          // Requiring width and height on every <img> made build.py stamp the
          // file's intrinsic size onto all of them. A stamped dimension is a
          // presentational hint, so a CSS rule that constrains ONE axis no
          // longer gets the other from the aspect ratio — it gets the stamped
          // pixel value. Three rules did exactly that, and the logo shipped to
          // production 26×96 instead of 26×26 for the life of Phase 8.
          //
          // Measured, not read off the markup: this compares the box the
          // browser actually laid out against the file's real proportions, so
          // it catches the defect whatever caused it. 5% tolerance absorbs
          // sub-pixel rounding; the failures it is looking for are 3× and up.
          //
          // Only `object-fit: fill` counts, and that restriction is the whole
          // difference between a useful check and a noisy one. Every card photo
          // on the site sits in a box of a deliberately different shape under
          // `object-fit: cover` — cropped, not squashed, and correct. `fill` is
          // the default, so it is exactly the images nobody gave a fit rule to
          // that get stretched, which is the defect.
          distortedImages: imgs
            .filter((i) => i.naturalWidth > 0 && i.naturalHeight > 0)
            .filter((i) => getComputedStyle(i).objectFit === 'fill')
            .map((i) => {
              const r = i.getBoundingClientRect();
              if (r.width < 1 || r.height < 1) return null;
              const natural = i.naturalWidth / i.naturalHeight;
              const rendered = r.width / r.height;
              if (Math.abs(natural - rendered) / natural <= 0.05) return null;
              return `${i.currentSrc.split('/').pop()} ${Math.round(r.width)}x${Math.round(r.height)}`
                + ` (natural ${i.naturalWidth}x${i.naturalHeight})`;
            })
            .filter(Boolean),
          overflow,
          widest,
        };
      });

      const problems = [];
      if (!response || !response.ok()) problems.push(`HTTP ${response?.status() ?? 'no response'}`);
      if (facts.lang !== route.lang) problems.push(`lang="${facts.lang}" expected "${route.lang}"`);
      if (!facts.title) problems.push('no title');
      if (!facts.description) problems.push('no meta description');
      if (!facts.canonical) problems.push('no canonical');
      if (!facts.ogTitle || !facts.ogImage) problems.push('incomplete Open Graph');
      if (facts.hreflang < 4) problems.push(`${facts.hreflang} hreflang links, expected 4`);
      if (facts.h1.length !== 1) problems.push(`${facts.h1.length} h1 elements`);
      if (!facts.hasMain) problems.push('no <main>');
      if (!facts.hasNav) problems.push('no navigation');
      if (!facts.skipLink) problems.push('no skip link');
      if (facts.overflow > 1) problems.push(`horizontal overflow ${facts.overflow}px (${facts.widest ?? 'source unknown'})`);
      if (facts.imagesWithoutAlt) problems.push(`${facts.imagesWithoutAlt} images with no alt attribute`);
      if (facts.imagesWithoutDims) problems.push(`${facts.imagesWithoutDims} images with no width/height`);
      if (facts.brokenImages) problems.push(`${facts.brokenImages} images failed to load`);
      if (facts.distortedImages.length) problems.push(`distorted images: ${facts.distortedImages.slice(0, 3).join('; ')}`);
      if (consoleErrors.length) problems.push(`console errors: ${consoleErrors.slice(0, 2).join(' | ')}`);
      if (failedRequests.length) problems.push(`failed first-party requests: ${failedRequests.slice(0, 2).join(' | ')}`);

      if (problems.length) hardFailures += 1;
      results.push({ viewport: vp.name, route: route.url, key: route.key, lang: route.lang, facts, problems });
      await page.close();
    }
    await context.close();
    process.stdout.write(`  ${vp.name} done\n`);
  }

  await browser.close();
  server.kill();

  // Internal links are viewport-independent, so they are resolved once against
  // the route set rather than sixty-six times per viewport.
  const known = new Set(all.map((r) => r.url.replace(/^\/(en|de)\//, '').replace(/^\//, '')));
  known.add('index.html');
  const brokenLinks = [];
  for (const r of results.filter((x) => x.viewport === VIEWPORTS[0].name)) {
    for (const href of new Set(r.facts.internalLinks)) {
      const target = href.split(/[#?]/)[0].replace(/^\.\.\//, '');
      if (target && !known.has(target)) brokenLinks.push(`${r.route} -> ${href}`);
    }
  }

  const failing = results.filter((r) => r.problems.length);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    viewports: VIEWPORTS.map((v) => v.name),
    routesAudited: all.length,
    checksRun: results.length,
    failing: failing.length,
    brokenInternalLinks: brokenLinks,
    results,
  }, null, 2) + '\n', 'utf8');

  console.log(`\nroute-audit: ${all.length} routes x ${VIEWPORTS.length} viewports = ${results.length} checks`);
  console.log(`  failing checks: ${failing.length}`);
  console.log(`  broken internal links: ${brokenLinks.length}`);
  for (const f of failing.slice(0, 25)) console.log(`  ${f.viewport} ${f.route}: ${f.problems.join('; ')}`);
  if (failing.length > 25) console.log(`  … and ${failing.length - 25} more, see ${OUT}`);
  for (const b of brokenLinks.slice(0, 10)) console.log(`  broken link ${b}`);

  process.exit(failing.length || brokenLinks.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
