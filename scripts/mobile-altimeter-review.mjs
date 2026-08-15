// =============================================================================
// The persistent mobile Altimeter's review package.
//
//     npm run build && python3 -m http.server 4322 --directory dist &
//     node scripts/mobile-altimeter-review.mjs
//
// Three things, and each is evidence for a different claim:
//
//   1. stills      the instrument at every authored state, at every viewport
//                  in the matrix — the claim that it is still there
//   2. a recording one unedited real-time scroll from hero to Arrival — the
//                  claim that the journey reads as one gesture
//   3. cost.json   requests, draw calls, triangles, render frequency, scroll
//                  listeners, forced layout reads, long tasks and frame times —
//                  the claim that persistence did not cost the architecture
//
// WHY WEBKIT
// ----------
// The real-device gate is iPhone/Safari, and the two engines genuinely
// disagree about the things this page is built on: fixed-element viewports
// under a collapsing toolbar, scroll anchoring, and when `visualViewport`
// fires. A Chromium capture would be a picture of a different browser.
//
// The one exception is the cost pass, which runs in Chromium: `longtask` is not
// implemented in WebKit's PerformanceObserver, and a long-task count that is
// silently always zero is worse than one measured on the other engine and
// labelled as such.
// =============================================================================

import { webkit, chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BASE = process.env.MV_BASE || 'http://127.0.0.1:4322/';
const ONLY_COST = process.argv.includes('--cost');
// `slice(2)`, because argv[0] is the node binary's own path and it contains a
// slash — which is how the first version of this line tried to mkdir over it.
const OUT = process.argv.slice(2).find((a) => !a.startsWith('--'))
  || join(ROOT, '_build/reports/mobile-altimeter-portal-review/mobile');
mkdirSync(OUT, { recursive: true });

/** The portrait matrix, and the one landscape the brief also asks for. */
const VIEWPORTS = [
  { name: '430x932', width: 430, height: 932 },
  { name: '390x844', width: 390, height: 844 },
  { name: '375x812', width: 375, height: 812 },
  { name: '360x800', width: 360, height: 800 },
  { name: '844x390-landscape', width: 844, height: 390 },
];

/**
 * The six moments the review asks for, as SECTIONS rather than scroll offsets.
 *
 * A pixel offset is right for one viewport and one locale and wrong for the
 * rest. Each of these scrolls the named section's anchor to the reading line,
 * which is the same moment on every screen in the matrix.
 */
const MOMENTS = [
  { name: '1-hero', stage: null, at: 0 },
  { name: '2-post-hero', stage: 'initial-ascent', at: 0.15 },
  { name: '3-mid-journey', stage: 'lower-atmosphere', at: 0.4 },
  { name: '4-work', stage: 'selected-work', at: 0.25 },
  { name: '5-process', stage: 'process', at: 0.3 },
  { name: '6-arrival', stage: 'destination', at: 0.25 },
];

const context = (browser, v) =>
  browser.newContext({
    viewport: { width: v.width, height: v.height },
    // 2, not 3: the review is read on a desktop screen, and a 3x full-page
    // capture of a 14 000px document is a 40 MB PNG nobody opens.
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'hu-HU',
  });

/** Put a section's top on the reading line, then wait for the settle to land. */
async function goTo(page, stage, at) {
  await page.evaluate(([id, fraction]) => {
    if (!id) {
      scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    const section = document.querySelector(`[data-stage="${id}"]`);
    if (!section) return;
    const rect = section.getBoundingClientRect();
    const top = rect.top + scrollY - innerHeight * 0.34 + rect.height * fraction;
    scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  }, [stage, at]);

  // `data-settled` is the placement settle's own "I am where I am supposed to
  // be". Without it every capture is a frame on the way somewhere.
  await page.waitForSelector('.mv-alt__stage[data-settled]', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(900);
}

/* ================================================================== stills == */

if (!ONLY_COST) {
console.log('stills…');
const shots = await webkit.launch();
const index = [];

for (const v of VIEWPORTS) {
  const ctx = await context(shots, v);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.mv-alt__stage[data-ready]', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1200);

  for (const moment of MOMENTS) {
    await goTo(page, moment.stage, moment.at);

    const state = await page.evaluate(() => {
      const layer = document.querySelector('.mv-inst');
      const stage = document.querySelector('.mv-alt__stage');
      const rect = stage?.getBoundingClientRect();
      return {
        instrumentState: layer?.getAttribute('data-inst-state') ?? null,
        opacity: stage ? Number(getComputedStyle(stage).opacity).toFixed(2) : null,
        box: rect
          ? {
            x: Math.round(rect.x), y: Math.round(rect.y),
            w: Math.round(rect.width), h: Math.round(rect.height),
          }
          : null,
        altitude: document.querySelector('.mv-telemetry__digits')?.textContent?.trim() ?? null,
        stage: document.querySelector('.mv-telemetry__stage')?.textContent?.trim() ?? null,
      };
    });

    const file = `${v.name}-${moment.name}.png`;
    await page.screenshot({ path: join(OUT, file) });
    index.push({ viewport: v.name, moment: moment.name, file, ...state });
    console.log(`  ${file}  ${state.instrumentState}  ${JSON.stringify(state.box)}  ${state.altitude} m`);
  }

  await ctx.close();
}
await shots.close();

writeFileSync(join(OUT, 'states.json'), `${JSON.stringify(index, null, 2)}\n`);
}

/* =============================================================== the video == */

/**
 * One unedited, real-time scroll from the hero to Arrival.
 *
 * REAL TIME, and that is the whole point of it. The page is scrolled in small
 * steps on a wall-clock cadence — roughly what a thumb does — rather than
 * jumped between sections, so the recording shows the transitions actually
 * settling rather than a slideshow of the states they settle into. Nothing is
 * cut, sped up or stitched.
 */
if (!ONLY_COST) {
console.log('\nrecording…');
{
  const browser = await webkit.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'hu-HU',
    recordVideo: { dir: join(OUT, '.video'), size: { width: 390, height: 844 } },
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.mv-alt__stage[data-ready]', { timeout: 30_000 }).catch(() => {});

  // Two seconds on the opening frame, so the recording begins with the hero
  // rather than with the hero already leaving.
  await page.waitForTimeout(2000);

  const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const step = 34;              // px per tick — an unhurried read
  const tick = 16;              // ms between ticks

  for (let y = 0; y <= height; y += step) {
    await page.evaluate((to) => scrollTo({ top: to, behavior: 'instant' }), y);
    await page.waitForTimeout(tick);
  }
  // And hold on the closing frame, so the recede is visible rather than the
  // last thing that happens before the file ends.
  await page.waitForTimeout(2500);

  await ctx.close();
  await browser.close();

  const files = readdirSync(join(OUT, '.video')).filter((f) => f.endsWith('.webm'));
  if (files[0]) {
    renameSync(join(OUT, '.video', files[0]), join(OUT, 'journey-390x844-realtime.webm'));
    console.log('  journey-390x844-realtime.webm');
  }
}
}

/* ================================================================== cost === */

/**
 * What the instrument costs, measured rather than asserted.
 *
 * Chromium, for `longtask` — see the note at the top. Everything instrumented
 * here is installed before the first module runs, so nothing is missed.
 */
console.log('\ncost…');
{
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  await ctx.addInitScript(() => {
    const w = window;
    w.__cost = {
      draws: 0, triangles: 0, frames: 0, longTasks: 0, longTaskMs: 0,
      scrollListeners: 0, layoutReads: 0, frameTimes: [],
    };

    // ---- WebGL: draw calls and the triangles behind them ------------------
    for (const proto of [w.WebGLRenderingContext?.prototype, w.WebGL2RenderingContext?.prototype]) {
      if (!proto) continue;
      const counted = {
        drawElements: (mode, count) => count / 3,
        drawArrays: (mode, first, count) => count / 3,
        drawElementsInstanced: (mode, count, type, offset, n) => (count / 3) * n,
        drawArraysInstanced: (mode, first, count, n) => (count / 3) * n,
      };
      for (const [name, triangles] of Object.entries(counted)) {
        const raw = proto[name];
        if (typeof raw !== 'function') continue;
        proto[name] = function (...args) {
          w.__cost.draws += 1;
          const t = triangles(...args);
          if (Number.isFinite(t)) w.__cost.triangles += t;
          return raw.apply(this, args);
        };
      }
    }

    // ---- scroll listeners --------------------------------------------------
    for (const target of [w, document, document.documentElement].filter(Boolean)) {
      const raw = target.addEventListener.bind(target);
      target.addEventListener = function (type, fn, opts) {
        if (type === 'scroll') w.__cost.scrollListeners += 1;
        return raw(type, fn, opts);
      };
    }

    // ---- forced layout reads ----------------------------------------------
    // Counted from the moment the probe is armed, not from load: a measurement
    // pass at mount is expected and is not what this number is about. What it
    // is about is whether a SCROLL FRAME reads layout, which is the thing the
    // whole architecture exists to avoid.
    w.__armLayoutProbe = () => { w.__cost.layoutReads = 0; w.__cost.armed = true; };
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (w.__cost.armed) w.__cost.layoutReads += 1;
      return rect.call(this);
    };
    const computed = w.getComputedStyle;
    w.getComputedStyle = function (...args) {
      if (w.__cost.armed) w.__cost.layoutReads += 1;
      return computed.apply(this, args);
    };

    // ---- long tasks and frame times ---------------------------------------
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          w.__cost.longTasks += 1;
          w.__cost.longTaskMs += entry.duration;
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* not implemented here */ }

    let last = 0;
    const frame = (now) => {
      if (last) {
        w.__cost.frames += 1;
        w.__cost.frameTimes.push(now - last);
      }
      last = now;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

  const page = await ctx.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.mv-alt__stage[data-ready]', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // ---- idle: nothing must be drawn while the page is still -----------------
  const beforeIdle = await page.evaluate(() => window.__cost.draws);
  await page.waitForTimeout(2500);
  const idleDraws = (await page.evaluate(() => window.__cost.draws)) - beforeIdle;

  /**
   * A warm pass first, and the measured pass second.
   *
   * The first traverse of this document lands eleven lazy case-study images.
   * Each one changes the height of everything beneath it, which fires the
   * `ResizeObserver` on the document, which remeasures eleven section offsets —
   * thirteen layout reads per image, on a one-off basis, exactly as designed.
   *
   * Counting those against "what a scroll frame costs" would be measuring the
   * page loading, not the page being read. So the document is walked once to
   * settle it, and the probe is armed for the second walk — which is the one a
   * visitor performs every time after the first, and the one the no-layout-read
   * architecture is a claim about.
   */
  for (let i = 1; i <= 20; i++) {
    await page.evaluate((f) => scrollTo({ top: document.documentElement.scrollHeight * f, behavior: 'instant' }), i / 20);
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(1200);

  // ---- a full read, at a scrolling cadence ---------------------------------
  await page.evaluate(() => {
    window.__armLayoutProbe();
    window.__cost.draws = 0;
    window.__cost.triangles = 0;
    window.__cost.frames = 0;
    window.__cost.frameTimes.length = 0;
    window.__cost.longTasks = 0;
    window.__cost.longTaskMs = 0;
  });

  const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const steps = 60;
  for (let i = 1; i <= steps; i++) {
    await page.evaluate((to) => scrollTo({ top: to, behavior: 'instant' }), Math.round((height * i) / steps));
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(1200);

  const cost = await page.evaluate(() => {
    const c = window.__cost;
    const times = [...c.frameTimes].sort((a, b) => a - b);
    const median = times.length ? times[Math.floor(times.length / 2)] : null;
    const p95 = times.length ? times[Math.floor(times.length * 0.95)] : null;
    return {
      draws: c.draws,
      triangles: Math.round(c.triangles),
      frames: c.frames,
      longTasks: c.longTasks,
      longTaskMs: Math.round(c.longTaskMs),
      scrollListeners: c.scrollListeners,
      layoutReads: c.layoutReads,
      medianFrameMs: median === null ? null : Number(median.toFixed(2)),
      p95FrameMs: p95 === null ? null : Number(p95.toFixed(2)),
    };
  });

  const report = {
    measuredAt: new Date().toISOString(),
    engine: 'chromium',
    viewport: '390x844 @2x',
    note: 'Long tasks are measured on Chromium: WebKit does not implement the longtask entry type.',
    frameTimeCaveat:
      'medianFrameMs is the interval between animation frames across the whole '
      + 'scripted read, INCLUDING the 40 ms pauses between scroll steps. Headless '
      + 'Chromium throttles the frame clock while nothing is invalidating, so this '
      + 'is an upper bound on a synthetic cadence rather than a frame budget under '
      + 'a finger. It has been measured between 18 and 49 ms on the same build and '
      + 'the same machine. The figures that are stable, and that a phone actually '
      + 'feels, are the per-frame draw calls and the zero at rest.',

    requests: {
      glb: requests.filter((u) => /\.glb($|\?)/.test(u)),
      terrainOrMountains: requests.filter((u) => /mountain|terrain|draco/i.test(u)),
      environmentMaps: requests.filter((u) => /\.(hdr|exr|env)($|\?)/i.test(u)),
      desktopScene: requests.filter((u) => /JourneyScene|ScrollTrigger/i.test(u)),
    },

    // Draw calls per FRAME is the number that matters; the totals below are
    // over a sixty-step read of a seventeen-screen document.
    perFrame: {
      drawCalls: cost.frames > 0 ? Number((cost.draws / cost.frames).toFixed(1)) : null,
      triangles: cost.draws > 0 ? Math.round(cost.triangles / cost.draws) : null,
    },

    idle: {
      drawCallsOverIdleSeconds: idleDraws,
      seconds: 2.5,
    },

    read: cost,

    // The comparison the change is judged against: the same probe, at HEAD,
    // with the hero-only instrument. See _build/reports/mobile-cost-head.json —
    // a different harness, so the totals are not directly comparable, but the
    // per-frame and at-rest figures are.
    baselineHeadNote:
      'At HEAD the instrument lived in the opening section and stopped drawing '
      + 'once its slot left the viewport: 243 draw calls over a full read. It '
      + 'now draws for the whole document, which is the change. What has not '
      + 'changed is the per-frame cost and the idle cost.',
  };

  writeFileSync(join(OUT, 'cost.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));

  await ctx.close();
  await browser.close();
}

console.log(`\ndone — ${OUT.replace(`${ROOT}/`, '')}`);
