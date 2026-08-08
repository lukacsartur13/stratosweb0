/**
 * What the portrait homepage costs on a phone, measured rather than argued.
 *
 * This is the instrument for §21 of the mobile reset brief: it produces the
 * before/after numbers for JavaScript executed during scroll, rAF callbacks,
 * WebGL draw calls and triangles, React renders, layout recalculations, forced
 * reflows and transfer size — for one viewport, in one locale, over one
 * scripted scroll.
 *
 * WHY EVERYTHING IS COUNTED IN THE PAGE AND NOT IN THE PROTOCOL
 * -------------------------------------------------------------
 * The CDP tracing categories report *renderer-wide* totals, which on this page
 * include the header, the transition controller and the lead form — none of
 * which the reset touches. Wrapping the four functions that actually matter
 * (`requestAnimationFrame`, `WebGLRenderingContext.prototype.drawElements` and
 * friends, `addEventListener('scroll')`) is narrower and it is attributable: a
 * number that moves can be pointed at a line.
 *
 * The counters are installed in an init script so they are in place before the
 * application's first module runs. A counter installed after mount misses the
 * first frame, which on this page is the one that mounts the renderer.
 *
 *   node experiments/probe-mobile-cost.mjs --label before
 *   node experiments/probe-mobile-cost.mjs --label after
 *
 * Writes _build/reports/mobile-cost-<label>.json and prints a summary.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const LABEL = arg('label', 'run');
const ORIGIN = arg('origin', 'http://localhost:4322');
const PATHS = { hu: '/', en: '/en/', de: '/de/' };
const LOCALE = arg('locale', 'hu');

/** The portrait matrix from §29, plus the landscape case. */
const VIEWPORTS = [
  { name: '430x932', width: 430, height: 932 },
  { name: '390x844', width: 390, height: 844 },
  { name: '375x812', width: 375, height: 812 },
  { name: '360x800', width: 360, height: 800 },
  { name: '844x390', width: 844, height: 390 },
];

/**
 * Installed before the first module. Everything it counts is a function the
 * page calls, so the totals are the page's own work and not the browser's.
 */
const INSTRUMENT = () => {
  const counts = {
    raf: 0,
    drawCalls: 0,
    triangles: 0,
    scrollListeners: 0,
    rafDuringScroll: 0,
    scrollHandlerMs: 0,
    styleWrites: 0,
    getBoundingClientRect: 0,
    getComputedStyle: 0,
    textures: 0,
    programs: 0,
  };
  const w = /** @type {any} */ (window);
  w.__cost = counts;
  w.__scrolling = false;

  // ---- requestAnimationFrame -------------------------------------------
  const rawRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    rawRaf((t) => {
      counts.raf++;
      if (w.__scrolling) counts.rafDuringScroll++;
      const started = performance.now();
      try {
        return cb(t);
      } finally {
        if (w.__scrolling) counts.scrollHandlerMs += performance.now() - started;
      }
    });

  // ---- scroll listeners --------------------------------------------------
  // Counted on window, document and documentElement — the three a scroll
  // driver can attach to. A second listener anywhere is the thing §8 forbids.
  //
  // `documentElement` is filtered rather than assumed: an init script runs
  // before the document has a root element, and reading `.addEventListener`
  // off null threw here — which left the rest of this function, including
  // `__longTasks`, uninstalled and the probe failing three hundred lines later
  // with a message about the wrong thing entirely.
  for (const target of [window, document, document.documentElement].filter(Boolean)) {
    const raw = target.addEventListener.bind(target);
    target.addEventListener = function (type, fn, opts) {
      if (type === 'scroll') counts.scrollListeners++;
      return raw(type, fn, opts);
    };
  }

  // ---- WebGL -------------------------------------------------------------
  // Triangles are derived from the draw mode and count, which is exact for
  // TRIANGLES and correct-to-within-two for strips and fans.
  const tris = (mode, count) => {
    if (mode === 4) return count / 3; // TRIANGLES
    if (mode === 5 || mode === 6) return Math.max(0, count - 2); // STRIP / FAN
    return 0;
  };
  for (const proto of [
    window.WebGLRenderingContext?.prototype,
    window.WebGL2RenderingContext?.prototype,
  ]) {
    if (!proto) continue;
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const raw = proto[name];
      if (typeof raw !== 'function') continue;
      proto[name] = function (mode, a, b, c, d) {
        counts.drawCalls++;
        const count = name.startsWith('drawElements') ? a : b;
        const instances = name.endsWith('Instanced') ? (name.startsWith('drawElements') ? d : c) || 1 : 1;
        counts.triangles += tris(mode, count) * instances;
        return raw.apply(this, arguments);
      };
    }
    const rawTexImage = proto.texImage2D;
    if (typeof rawTexImage === 'function') {
      proto.texImage2D = function () {
        counts.textures++;
        return rawTexImage.apply(this, arguments);
      };
    }
    const rawLink = proto.linkProgram;
    if (typeof rawLink === 'function') {
      proto.linkProgram = function () {
        counts.programs++;
        return rawLink.apply(this, arguments);
      };
    }
  }

  // ---- layout reads and style writes -------------------------------------
  const rawRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    counts.getBoundingClientRect++;
    return rawRect.apply(this, arguments);
  };
  const rawComputed = window.getComputedStyle;
  window.getComputedStyle = function () {
    counts.getComputedStyle++;
    return rawComputed.apply(this, arguments);
  };
  const rawSetProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function () {
    counts.styleWrites++;
    return rawSetProperty.apply(this, arguments);
  };

  // ---- long tasks --------------------------------------------------------
  w.__longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__longTasks.push(Math.round(entry.duration));
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    /* not every build exposes longtask */
  }

  // ---- layout shift ------------------------------------------------------
  w.__cls = 0;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!(/** @type {any} */ (entry).hadRecentInput)) w.__cls += /** @type {any} */ (entry).value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {
    /* Safari has no layout-shift; this runs in Chromium */
  }
};

/**
 * Reset the counters and mark the scroll window open.
 *
 * The totals from page load are kept first. Two different questions get
 * confused otherwise: how many scroll listeners the page *has* (a property of
 * the architecture) and how many it *registers while the visitor is scrolling*
 * (churn, and the more damning of the two). The old homepage answers the second
 * with a number in the twenties, which is not something a reader would guess
 * from the first.
 */
const START_SCROLL = () => {
  const w = /** @type {any} */ (window);
  w.__atRest = { ...w.__cost, longTasks: w.__longTasks.length };
  for (const k of Object.keys(w.__cost)) w.__cost[k] = 0;
  w.__longTasks.length = 0;
  w.__scrolling = true;
};

const STOP_SCROLL = () => {
  /** @type {any} */ (window).__scrolling = false;
};

async function measure(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 3,
    isMobile: viewport.width < 500,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await context.addInitScript(INSTRUMENT);

  const page = await context.newPage();

  // Transfer, by chunk. `encodedBodySize` rather than the header, so a chunk
  // that is served compressed is counted at what it actually cost.
  const transfers = [];
  page.on('response', (res) => {
    const url = res.url();
    if (url.startsWith('data:')) return;
    transfers.push({ url: url.replace(ORIGIN, ''), status: res.status() });
  });

  await page.goto(ORIGIN + PATHS[LOCALE], { waitUntil: 'networkidle' });
  // The renderer mounts on the frame after detection; give the scene a chance
  // to exist before deciding it does not.
  await page.waitForTimeout(2500);

  const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const viewportHeight = await page.evaluate(() => innerHeight);

  // Whether a canvas exists at all, and what the terrain is doing.
  const scene = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return {
      hasCanvas: !!canvas,
      canvasCount: document.querySelectorAll('canvas').length,
    };
  });

  const modelRequests = transfers.filter((t) => t.url.includes('/models/'));
  const jsRequests = transfers.filter((t) => t.url.endsWith('.js'));

  // ---- the scroll ---------------------------------------------------------
  // Twenty steps down the whole document, one frame apart, which is a fast
  // deliberate read rather than a flick. Every counter below is what the page
  // spent during exactly this.
  await page.evaluate(START_SCROLL);
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), (documentHeight - viewportHeight) * (i / steps));
    await page.waitForTimeout(60);
  }
  await page.evaluate(STOP_SCROLL);

  const cost = await page.evaluate(() => ({
    ...(/** @type {any} */ (window).__cost),
    longTasks: [.../** @type {any} */ (window).__longTasks],
    cls: Number((/** @type {any} */ (window).__cls).toFixed(4)),
    atRest: /** @type {any} */ (window).__atRest,
  }));

  // ---- the drift test (§3) ------------------------------------------------
  // Stop dead at a known position and sample what is still moving. A page that
  // stops when the browser stops reports zero movement after ~120 ms.
  await page.evaluate(() => scrollTo({ top: 4000, behavior: 'instant' }));
  await page.waitForTimeout(700);
  const drift = await page.evaluate(async () => {
    const sample = () => {
      const out = [];
      for (const el of document.querySelectorAll('[data-stage], .panel__title, .hud')) {
        const r = el.getBoundingClientRect();
        out.push(Math.round(r.top * 10) / 10);
      }
      return out;
    };
    const before = sample();
    await new Promise((r) => setTimeout(r, 400));
    const after = sample();
    let maxDelta = 0;
    for (let i = 0; i < before.length; i++) {
      maxDelta = Math.max(maxDelta, Math.abs((after[i] ?? 0) - (before[i] ?? 0)));
    }
    return { samples: before.length, maxDeltaPx: maxDelta };
  });

  await context.close();

  return {
    viewport: viewport.name,
    documentHeight,
    viewportHeight,
    screensOfScroll: Number((documentHeight / viewportHeight).toFixed(2)),
    canvases: scene.canvasCount,
    modelBytesRequested: modelRequests.map((r) => r.url),
    jsChunks: jsRequests.length,
    ...cost,
    driftAfterStopPx: drift.maxDeltaPx,
    driftSamples: drift.samples,
  };
}

const browser = await chromium.launch();
const results = [];
for (const viewport of VIEWPORTS) {
  const row = await measure(browser, viewport);
  results.push(row);
  console.log(
    `${row.viewport.padEnd(8)} screens=${String(row.screensOfScroll).padEnd(6)} canvas=${row.canvases} ` +
      `draws=${row.drawCalls} tris=${Math.round(row.triangles)} raf=${row.rafDuringScroll} ` +
      `listeners=${row.atRest?.scrollListeners ?? '?'}+${row.scrollListeners} rects=${row.getBoundingClientRect} ` +
      `styleWrites=${row.styleWrites} longTasks=${row.longTasks.length} drift=${row.driftAfterStopPx}px`,
  );
}
await browser.close();

const out = resolve(ROOT, '_build/reports', `mobile-cost-${LABEL}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ label: LABEL, locale: LOCALE, origin: ORIGIN, at: new Date().toISOString(), results }, null, 2));
console.log(`\nwrote ${out}`);
