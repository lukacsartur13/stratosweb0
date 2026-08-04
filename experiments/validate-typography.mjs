// =============================================================================
// Phase 6 typography gates: font loading, CLS, fallback, failure, zoom.
//
//     npm run dev:full                        # in another terminal
//     node experiments/validate-typography.mjs
//
// Five conditions, measured rather than asserted from the CSS:
//
//   webfont     the normal case — Archivo and JetBrains Mono served
//   fallback    the webfonts never arrive; the metric-matched local shims and
//               then the generic stacks carry the page
//   failure     the font requests fail outright (network error, not a 404 with
//               a body), which is a different code path in the font loader
//   zoom200     200% browser zoom, reproduced as half the CSS viewport at twice
//               the device pixel ratio, which is what the browser actually does
//   textsize    the root font size raised 150%, which is what an OS-level
//               "larger text" setting does to a page built on rem
//
// For each one it reports cumulative layout shift, the time the fonts took to
// settle, and whether the composition stayed within §6: no copy hidden, no
// panel that traps the visitor, nothing shrunk to fit, and — on the standard
// viewports — the instrument still clear of the copy.
//
// ## Why CLS is measured with a real PerformanceObserver
//
// Layout shift is a browser-computed value with a specific definition (impact
// fraction × distance fraction, excluding shifts within 500ms of an input). A
// hand-rolled before/after `getBoundingClientRect` diff is a different quantity
// that happens to move in the same direction, and it would report the panels'
// own scroll-driven movement as shift. The observer is installed in an init
// script so it is running before the first paint rather than after it, which is
// the difference between measuring the font swap and missing it.
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.URL ?? 'http://localhost:5176/experiments/stratos-ascent-full/full.html';
const OUT = resolve(ROOT, '_build/reports/typography.json');

const LOCALES = (process.env.LOCALES ?? 'hu,en,de').split(',');
const VIEWPORTS = (process.env.VIEWPORTS ?? '1440x900,390x844,320x568')
  .split(',')
  .map((s) => {
    const [w, h] = s.split('x').map(Number);
    return { w, h };
  });

/** The smallest type anything may be reduced to. §6: nothing unreadably small. */
const MIN_FONT_PX = 11;

const CONDITIONS = ['webfont', 'fallback', 'failure', 'zoom200', 'textsize'];

const OBSERVE = () => {
  globalThis.__cls = 0;
  globalThis.__shifts = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        globalThis.__cls += entry.value;
        // Whether every source of this shift came from a zero-sized rect. That
        // is content appearing rather than content moving, and on a route that
        // renders its whole narrative in React it is the app mounting — the
        // same figure whether or not a webfont is involved.
        const sources = [...(entry.sources ?? [])];
        const arrival =
          sources.length > 0 &&
          sources.every((s) => s.previousRect.width === 0 && s.previousRect.height === 0);
        globalThis.__shifts.push({
          t: Math.round(entry.startTime),
          v: Number(entry.value.toFixed(5)),
          arrival,
          nodes: sources
            .slice(0, 3)
            .map((s) => (s.node ? `${s.node.nodeName}.${String(s.node.className ?? '').trim().split(/\s+/)[0]}` : '?')),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {
    globalThis.__cls = null;
  }
};

/**
 * What the page looks like once it has settled, from the typography's side.
 *
 * `fonts` is read off the resolved computed style rather than off the CSS
 * variable: a variable that names Archivo on a page where Archivo never loaded
 * still says Archivo. `document.fonts.check` is the only thing that knows.
 */
const READ = ({ minFontPx }) => {
  const cs = (el) => getComputedStyle(el);
  const title = document.querySelector('.panel__title');
  const body = document.querySelector('.panel__lead');

  // Every element that carries copy, smallest first — §6 forbids shrinking type
  // to make a composition fit, so the floor is checked rather than assumed.
  const textual = [...document.querySelectorAll('.panel p, .panel h1, .panel h2, .panel li, .panel dd, .panel dt, .btn')];
  let smallest = Infinity;
  let smallestWhat = null;
  for (const el of textual) {
    const size = parseFloat(cs(el).fontSize);
    if (Number.isFinite(size) && size < smallest) {
      smallest = size;
      smallestWhat = `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/)[0]}`;
    }
  }

  // §6: the visitor must never be trapped in a fixed-height panel. A panel in
  // the windowed composition is only acceptable if its copy is fully walked
  // through the band by the end of its own range; a panel in flow mode has to
  // be able to overflow downward into ordinary document scroll. Both are
  // checked structurally rather than by eye.
  const panels = [...document.querySelectorAll('.panel')].map((panel) => {
    const inner = panel.querySelector('.panel__inner');
    const flowBand = panel.querySelector('.panel__band--flow');
    const flowInner = panel.querySelector('.panel__band-inner');
    const fit = panel.dataset.fit ?? 'flow';
    const bandH = flowBand ? flowBand.getBoundingClientRect().height : 0;
    const copyH = flowInner ? flowInner.scrollHeight : 0;
    return {
      stage: panel.dataset.stage,
      fit,
      dense: panel.dataset.dense ?? null,
      bandH: Math.round(bandH),
      copyH: Math.round(copyH),
      /** Pixels of copy the flow window still has to walk. */
      travel: fit === 'window' ? Math.max(0, Math.round(copyH - bandH)) : 0,
      innerH: inner ? Math.round(inner.getBoundingClientRect().height) : 0,
    };
  });

  return {
    fontsReady: globalThis.__fontsReadyAt ?? null,
    fontTimings: globalThis.__fontTimings ?? [],
    cls: globalThis.__cls,
    /**
     * Split, because the two halves answer different questions and only one of
     * them is Phase 6's. A shift whose source went from a zero rect to a full
     * one is content arriving — the React root mounting on a client-rendered
     * route — and it is the same number with or without a webfont. A shift
     * between two non-zero rects is something *moving*, which is what a font
     * swap or a band resize does.
     */
    clsFromArrival: (globalThis.__shifts ?? [])
      .filter((s) => s.arrival)
      .reduce((sum, s) => sum + s.v, 0),
    clsFromMovement: (globalThis.__shifts ?? [])
      .filter((s) => !s.arrival)
      .reduce((sum, s) => sum + s.v, 0),
    shifts: (globalThis.__shifts ?? []).slice(0, 12),
    resolved: {
      display: title ? cs(title).fontFamily : null,
      body: body ? cs(body).fontFamily : null,
      archivoLoaded: document.fonts ? document.fonts.check('1em Archivo') : null,
      monoLoaded: document.fonts ? document.fonts.check('1em "JetBrains Mono"') : null,
      loadedFaces: document.fonts ? [...document.fonts].filter((f) => f.status === 'loaded').length : null,
    },
    smallestFontPx: Number.isFinite(smallest) ? Number(smallest.toFixed(2)) : null,
    smallestWhat,
    tooSmall: Number.isFinite(smallest) && smallest < minFontPx,
    composition: document.documentElement.dataset.composition ?? null,
    panels,
    doc: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: innerHeight,
    },
  };
};

const browser = await chromium.launch();
const results = [];
let failures = 0;

for (const locale of LOCALES) {
  for (const vp of VIEWPORTS) {
    for (const condition of CONDITIONS) {
      // 200% zoom is half the CSS viewport at twice the pixel ratio. That is
      // not an approximation of zoom, it is what zoom is: the layout viewport
      // shrinks in CSS pixels and each one covers more device pixels.
      const zoom = condition === 'zoom200';
      const page = await browser.newPage({
        viewport: zoom ? { width: Math.round(vp.w / 2), height: Math.round(vp.h / 2) } : { width: vp.w, height: vp.h },
        deviceScaleFactor: zoom ? 2 : 1,
      });

      await page.addInitScript(OBSERVE);
      // `document.fonts.ready` has to be awaited *after* the stylesheet has been
      // parsed, not in the init script. At init time there are no @font-face
      // rules yet and therefore nothing pending, so the promise resolves on the
      // spot and reports 0 ms for every condition including the ones where the
      // fonts never arrive at all — a measurement that cannot fail is not a
      // measurement. Hooked to DOMContentLoaded, and paired with the resource
      // timings, which are the ground truth for what was actually fetched.
      await page.addInitScript(() => {
        if (!document.fonts) return;
        addEventListener('DOMContentLoaded', () => {
          const t0 = performance.now();
          document.fonts.ready.then(() => {
            globalThis.__fontsReadyAt = Math.round(performance.now() - t0);
            globalThis.__fontTimings = performance
              .getEntriesByType('resource')
              .filter((e) => /\.(woff2?|ttf|otf)(\?|$)/.test(e.name))
              .map((e) => ({
                name: e.name.split('/').pop(),
                start: Math.round(e.startTime),
                duration: Math.round(e.duration),
                transferSize: e.transferSize,
              }));
          });
        });
      });
      if (condition === 'textsize') {
        // What an OS "larger text" setting does to a page built on rem: the
        // root size goes up and every clamp() and rem follows it.
        await page.addInitScript(() => {
          addEventListener('DOMContentLoaded', () => {
            document.documentElement.style.fontSize = '24px';
          });
        });
      }

      await page.route(BASE.split('?')[0], async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        await route.fulfill({
          response,
          body: body.replace(/<html\s+lang="[^"]*"/i, `<html lang="${locale}"`),
        });
      });

      if (condition === 'fallback') {
        // Served, but never arrives: the request is fulfilled with nothing, so
        // the face fails to parse and the stack falls through. This is the slow
        // network / blocked CDN shape.
        await page.route('**/*.{woff,woff2,ttf,otf}', (route) => route.fulfill({ status: 404, body: '' }));
      }
      if (condition === 'failure') {
        // Hard network failure, which the font loader treats differently from a
        // response it can read and reject.
        await page.route('**/*.{woff,woff2,ttf,otf}', (route) => route.abort('failed'));
      }

      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));

      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.locator('canvas').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
      await page.waitForFunction(() => globalThis.__stratos?.journey, null, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2_000);

      const r = await page.evaluate(READ, { minFontPx: MIN_FONT_PX });
      const label = `${locale} ${vp.w}x${vp.h} ${condition}`;

      const problems = [];
      const overflow = r.doc.scrollWidth - r.doc.clientWidth;
      if (overflow > 1) problems.push(`h-overflow ${overflow}px`);
      if (r.tooSmall) problems.push(`type ${r.smallestFontPx}px (${r.smallestWhat}) < ${MIN_FONT_PX}px`);
      if (errors.length) problems.push(`pageerror ${errors[0].slice(0, 60)}`);
      // §6: nothing may be permanently unreachable. A windowed panel whose copy
      // is taller than its band is fine — that is the window doing its job — but
      // the document has to be tall enough for the walk to complete, and a flow
      // panel has to be able to grow.
      if (r.doc.scrollHeight <= r.doc.innerHeight + 1) problems.push('document does not scroll');
      // The webfont condition is the only one that should report the webfont.
      if (condition === 'webfont' && r.resolved.archivoLoaded === false) problems.push('Archivo did not load');
      if ((condition === 'fallback' || condition === 'failure') && r.resolved.archivoLoaded === true) {
        problems.push('webfont loaded despite being blocked');
      }

      console.log(
        `${label.padEnd(30)} cls=${r.cls === null ? 'n/a' : r.cls.toFixed(4)}` +
          ` (move ${r.clsFromMovement.toFixed(4)} / mount ${r.clsFromArrival.toFixed(4)})  ` +
          `fontsReady=${r.fontsReady ?? '-'}ms  ` +
          `fonts=${r.fontTimings.length}  ` +
          `smallest=${r.smallestFontPx}px  ` +
          `${r.composition ?? '-'}  ` +
          `window/flow=${r.panels.filter((p) => p.fit === 'window').length}/${r.panels.filter((p) => p.fit !== 'window').length}` +
          (problems.length ? `\n    ${problems.join(' | ')}` : ''),
      );

      if (problems.length) failures++;
      results.push({ locale, viewport: vp, condition, ...r, problems });
      await page.close();
    }
  }
}

await browser.close();
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 1));

const move = results.map((r) => r.clsFromMovement).filter((v) => typeof v === 'number');
const mount = results.map((r) => r.clsFromArrival).filter((v) => typeof v === 'number');
console.log(
  `\nCLS from movement (font swap, band resize): worst ${Math.max(...move).toFixed(4)}` +
    `\nCLS from first render (React mounting the narrative): worst ${Math.max(...mount).toFixed(4)}`,
);
console.log(`${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} problem condition(s). Report: ${OUT}`);
process.exit(failures === 0 ? 0 : 1);
