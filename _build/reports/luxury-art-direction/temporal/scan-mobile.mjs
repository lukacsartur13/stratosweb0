/**
 * THE PORTRAIT TEMPORAL SCAN — §23, and it is a different measurement from the
 * desktop one on purpose.
 *
 * The desktop journey is SCRUBBED: every state is a pure function of scroll
 * position, so its temporal map is a scroll-domain map and seconds are the
 * visitor's to choose. The portrait journey is not. It is ordinary block flow
 * with one `IntersectionObserver`, and its motion is a set of CSS transitions
 * with real durations — 1.05 s for a headline line, 0.8 s for a general rise,
 * 0.52 s for body copy, plus up to 0.55 s of stagger. Those are wall-clock
 * seconds and they do not scale with how fast the visitor moves.
 *
 * That difference is the whole reason §23 says mobile is not a secondary
 * check. On desktop, scrolling faster compresses everything uniformly. On
 * mobile, scrolling faster compresses the SCROLL and leaves the TRANSITIONS
 * where they are — so past some velocity the visitor outruns the reveal and
 * meets copy that is still assembling, or has already left the section before
 * its statement finished arriving. This measures exactly that.
 *
 * Three passes:
 *   geometry   section extents, in screens, at three real phone shapes
 *   settled    what each section looks like once it has composed
 *   flick      a fast touch-like scroll, sampling what was still mid-transition
 *
 * Usage:
 *   node .../temporal/scan-mobile.mjs --width 390 --height 844 --tag m-before
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const W = Number(arg('width', 390));
const H = Number(arg('height', 844));
const TAG = arg('tag', `m-${W}x${H}`);
const LOCALE = arg('locale', 'hu');
const REDUCED = process.argv.includes('--reduced');
const OUT = arg('out', '_build/reports/luxury-art-direction/temporal');
const BASE = arg('base', 'http://localhost:4322');
const URL = LOCALE === 'hu' ? `${BASE}/index.html` : `${BASE}/${LOCALE}/index.html`;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true,
  reducedMotion: REDUCED ? 'reduce' : 'no-preference',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(2000);

// ---------------------------------------------------------------- geometry
const geom = await page.evaluate(() => {
  const doc = document.documentElement.scrollHeight;
  const secs = [...document.querySelectorAll('.mv-sec')].map((s) => ({
    stage: s.dataset.stage, level: s.dataset.level, act: s.dataset.act,
    role: s.dataset.actRole, tier: s.dataset.monument,
    top: Math.round(s.offsetTop + (s.offsetParent?.offsetTop ?? 0)),
    height: Math.round(s.getBoundingClientRect().height),
  }));
  const flow = document.querySelector('.mv-flow');
  const alt = document.querySelector('[data-testid="mobile-altimeter"] .mv-alt__stage');
  return { doc, secs, flowTop: flow ? Math.round(flow.getBoundingClientRect().top + scrollY) : 0,
           altimeter: alt ? { box: Math.round(alt.getBoundingClientRect().width) } : null };
});

// -------------------------------------------------------- settled sampling
// Step down the document, letting every reveal complete, and record what is
// legible. This is the readability pass: at this pace nothing is outrun.
const STEPS = Number(arg('steps', 240));
const scrollable = geom.doc - H;
const settled = [];
for (let i = 0; i <= STEPS; i++) {
  const y = (scrollable * i) / STEPS;
  await page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), y);
  await page.waitForTimeout(60);
  settled.push({ i, y: Math.round(y), screens: +(y / H).toFixed(4), ...(await page.evaluate(PROBE_SRC())) });
}

function PROBE_SRC() {
  return () => {
    const vh = innerHeight, vw = innerWidth;
    const on = (r) => r.bottom > 0 && r.top < vh && r.width > 2 && r.height > 2;
    const eff = (el) => {
      let o = 1;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.visibility === 'hidden' || cs.display === 'none') return 0;
        const v = parseFloat(cs.opacity); if (Number.isFinite(v)) o *= v;
        if (o < 0.004) return 0;
      }
      return o;
    };
    let ink = 0, biggest = 0, biggestText = '';
    const nodes = [...document.querySelectorAll(':is(.mv-flow, .mv-sec, footer, .arrival, [data-testid="arrival"]) :is(p,h1,h2,h3,li,a,span.mv-lines__in,figcaption)')]
      .filter((e) => (e.textContent || '').trim().length > 1);
    const leaves = nodes.filter((e) => !nodes.some((o) => o !== e && e.contains(o)));
    for (const el of leaves) {
      const r = el.getBoundingClientRect(); if (!on(r)) continue;
      const o = eff(el); if (o < 0.14) continue;
      ink += r.width * (Math.min(r.bottom, vh) - Math.max(r.top, 0)) * o;
      const s = parseFloat(getComputedStyle(el).fontSize);
      if (s > biggest) { biggest = s; biggestText = (el.textContent || '').trim().slice(0, 40); }
    }
    // EVERY chapter statement, by identity, whether or not on screen.
    //
    // The four passages wrap theirs in `.mv-head` (the high reveal line); the
    // seven master acts set theirs as a bare `.mv-lines` on the shared line.
    // Both are the chapter's statement and both have to be in this table, or
    // the measurement silently reports only the passages — which is what the
    // first version of this scan did.
    const heads = {};
    for (const sec of document.querySelectorAll('.mv-sec')) {
      const head = sec.querySelector('.mv-head');
      const lines = sec.querySelector('.mv-lines');
      const el = head || lines;
      if (!el) continue;
      const inner = (lines || el).querySelector?.('.mv-lines__in') || sec.querySelector('.mv-lines__in');
      const r = (lines || el).getBoundingClientRect();
      let travel = 0;
      if (inner) {
        const t = getComputedStyle(inner).transform;
        const m2 = t && t.match(/matrix\(([^)]+)\)/);
        if (m2) travel = Math.abs(parseFloat(m2[1].split(',')[5])) / Math.max(1, r.height || 1);
      }
      heads[sec.dataset.stage] = {
        on: on(r) ? 1 : 0, top: Math.round(r.top), h: Math.round(r.height),
        o: +eff(el).toFixed(3),
        line: head ? 'head' : 'shared',
        isIn: (lines || el).classList.contains('is-in') ? 1 : 0,
        travel: +travel.toFixed(3),
      };
    }
    // Which sections the viewport is over.
    const secs = [];
    for (const s of document.querySelectorAll('.mv-sec')) {
      const r = s.getBoundingClientRect(); if (r.bottom < 0 || r.top > vh) continue;
      secs.push({ stage: s.dataset.stage, level: s.dataset.level, top: Math.round(r.top), h: Math.round(r.height) });
    }
    // The real instrument: a fixed overlay whose box carries an inline
    // transform and opacity written by the chase in `MobileAltimeter`. Its
    // OPACITY is the only honest measure of presence — the element is always
    // in the DOM and always intersects the viewport, so "is it on screen" is
    // meaningless here and was what the first version of this scan measured.
    const stageEl = document.querySelector('[data-testid="mobile-altimeter"] .mv-alt__stage');
    const ar = stageEl ? stageEl.getBoundingClientRect() : null;
    let instO = 0, instScale = 0;
    if (stageEl) {
      instO = parseFloat(stageEl.style.opacity || getComputedStyle(stageEl).opacity) || 0;
      const t = stageEl.style.transform || '';
      const m3 = t.match(/scale\(([-0-9.]+)\)/);
      instScale = m3 ? parseFloat(m3[1]) : 0;
    }
    const cs = getComputedStyle(document.documentElement);
    return {
      ink: Math.round(ink), inkFrac: +(ink / (vw * vh)).toFixed(5), biggest: Math.round(biggest), biggestText,
      heads, secs,
      alt: cs.getPropertyValue('--mv-alt').trim(), lift: cs.getPropertyValue('--mv-lift').trim(),
      instO: +instO.toFixed(3), instScale: +instScale.toFixed(3),
      instTop: ar ? Math.round(ar.top) : null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  };
}

// -------------------------------------------------------------- flick pass
// §24. A touch flick on a phone covers a lot of document in very little time.
// Reload so every reveal is armed again, then travel the whole page at a
// realistic flick velocity, sampling as fast as the harness can — what this
// records is how much of each statement had actually arrived by the time the
// visitor had already scrolled past it.
async function flick(pxPerSecond) {
  // TOP FIRST, THEN RELOAD — and the order is the whole validity of this pass.
  //
  // A reload restores the scroll position. The settled pass leaves the page at
  // the foot of the document, so reloading from there registers the reveal
  // observers at the bottom: `passedObserver`'s sweep then resolves every
  // chapter marker still pending — they are all above the frame — and the four
  // passages start the flick already composed. The first run of this scan
  // reported them landing perfectly at 3 200 px/s for exactly that reason, and
  // the acts, which have no sweep net, reported honestly beside them. A
  // measurement whose two halves are not in the same state is not a comparison.
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(120);
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1600);
  const trace = await page.evaluate(async (v) => {
    const out = [];
    const H = innerHeight;
    const end = document.documentElement.scrollHeight - H;
    const t0 = performance.now();
    let last = t0;
    return await new Promise((res) => {
      const step = () => {
        const now = performance.now();
        const y = Math.min(end, ((now - t0) / 1000) * v);
        scrollTo({ top: y, behavior: 'instant' });
        if (now - last >= 40) {
          last = now;
          const stageEl = document.querySelector('[data-testid="mobile-altimeter"] .mv-alt__stage');
          const row = {
            t: Math.round(now - t0), y: Math.round(y), heads: {},
            instO: stageEl ? +(parseFloat(stageEl.style.opacity || 0) || 0).toFixed(3) : 0,
          };
          for (const sec of document.querySelectorAll('.mv-sec')) {
            const lines = sec.querySelector('.mv-lines');
            if (!lines) continue;
            const r = lines.getBoundingClientRect();
            if (r.bottom < -80 || r.top > H + 80) continue;
            const inner = lines.querySelector('.mv-lines__in');
            let travel = 0;
            if (inner) { const t = getComputedStyle(inner).transform; const m2 = t && t.match(/matrix\(([^)]+)\)/); if (m2) travel = Math.abs(parseFloat(m2[1].split(',')[5])) / Math.max(1, r.height || 1); }
            row.heads[sec.dataset.stage] = { top: Math.round(r.top), travel: +travel.toFixed(3), isIn: lines.classList.contains('is-in') ? 1 : 0 };
          }
          out.push(row);
        }
        if (y >= end) { res(out); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, pxPerSecond);
  return trace;
}

const flicks = {};
for (const v of [900, 1800, 3200]) flicks[v] = await flick(v);

writeFileSync(`${OUT}/scan-${TAG}.json`, JSON.stringify({
  meta: { tag: TAG, width: W, height: H, locale: LOCALE, reduced: REDUCED, url: URL,
          doc: geom.doc, screensTotal: +(geom.doc / H).toFixed(3), steps: STEPS },
  geom, settled, flicks,
}, null, 1));
console.log(`scan-${TAG}.json — ${geom.secs.length} sections, ${(geom.doc / H).toFixed(2)} screens`);
await browser.close();
