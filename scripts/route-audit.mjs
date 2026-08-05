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
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_build', 'reports', 'phase8-route-audit.json');
const PORT = 4327;
const BASE = `http://127.0.0.1:${PORT}`;
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

function serve() {
  const p = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', join(ROOT, 'dist')],
    { stdio: 'ignore' });
  return p;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const server = serve();
  await wait(900);

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
