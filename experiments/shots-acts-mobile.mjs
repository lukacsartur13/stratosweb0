// =============================================================================
// The same seven frames and four crossings, on the phone. §48.
//
// The portrait composition is native document scroll with no sticky scene, so
// a "settled state" is a section brought to the top of the viewport rather than
// a pinned frame. It also has to be given a moment for the reveals to resolve:
// `reveal.ts` is an IntersectionObserver plus CSS transitions, and a capture
// taken before they finish is a picture of the page's loading state.
//
// Usage:  npm run dev:home
//         node experiments/shots-acts-mobile.mjs --tag after
// =============================================================================
import { chromium, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const TAG = arg('tag', 'after');
const LOCALE = arg('locale', 'hu');
const OUT = `_build/reports/luxury-art-direction/production/${TAG}`;

const STAGES = [
  'calibration', 'initial-ascent', 'lower-atmosphere', 'cloud-entry', 'cloud-breakthrough',
  'selected-work', 'system', 'process', 'stratosphere-transition', 'full-stratosphere', 'destination',
];

const VIEWS = [
  { id: 'm390', width: 390, height: 844 },
  { id: 'm430', width: 430, height: 932 },
];

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });

for (const view of VIEWS) {
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:5177/home/${LOCALE}.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('[data-testid="mobile-home"]', { timeout: 20_000 });
  await page.waitForTimeout(2000);

  const report = [];
  for (const stage of STAGES) {
    await page.evaluate((s) => {
      const el = document.querySelector(`[data-testid="stage-${s}"]`);
      // The MARGIN box's top, not the border box's. Chapter spacing on this
      // route is a margin — it has to be, or a top margin on the first flow
      // child moves the whole document — so `offsetTop` is where the chapter's
      // first line is rather than where the chapter begins. Scrolling to it
      // captures the statement flush against the viewport's top edge with the
      // previous chapter still above it, which is a frame no reader ever sees.
      const gap = parseFloat(getComputedStyle(el).marginBlockStart) || 0;
      scrollTo({ top: Math.max(0, el.offsetTop - gap - 8), behavior: 'instant' });
    }, stage);
    await page.waitForTimeout(1400);
    const state = await page.evaluate(() => {
      // `.mv-inst__box` is what the overlay writes the transform and the
      // opacity to; `.mv-inst` is its fixed layer and never changes.
      const box = document.querySelector('.mv-inst .mv-alt__stage') ?? document.querySelector('[data-testid="mobile-altimeter"] > *');
      const layer = document.querySelector('[data-testid="mobile-altimeter"]');
      const o = box ? parseFloat(getComputedStyle(box).opacity) : null;
      const r = box ? box.getBoundingClientRect() : null;
      const onScreen = r ? r.bottom > 0 && r.top < innerHeight && r.width > 2 : false;
      return {
        instrumentOpacity: Number.isFinite(o) ? +o.toFixed(3) : null,
        instrumentOnScreen: onScreen,
        instrumentSize: r ? Math.round(r.width) : null,
        layerFound: !!layer,
        // Display type that wraps is the one fault a monument may not have.
        // The lines are authored, so a line that the browser has broken again
        // is the art direction being rewritten silently.
        //
        // Counted with a Range rather than with a width comparison: a Range
        // over the text returns one client rect per LINE BOX, which is the
        // question being asked, and it is immune to padding, to
        // `overflow: hidden` on the reveal mask and to the inline-block the
        // stagger uses.
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        // Scoped to the ACT frames. A crossing's heading is prose at prose
        // scale and is meant to wrap; a monument is authored and is not.
        wrapped: [...document.querySelectorAll("[data-act-role='peak'] .mv-title .mv-lines__in")]
          .filter((n) => {
            const range = document.createRange();
            range.selectNodeContents(n);
            return range.getClientRects().length > 1;
          })
          .map((n) => (n.textContent || '').trim().slice(0, 28)),
      };
    });
    await page.screenshot({ path: `${OUT}/${view.id}-${stage}-${LOCALE}.png` });
    report.push({ stage, ...state });
    process.stdout.write(`${TAG} ${view.id} ${stage.padEnd(24)} instrument opacity ${String(state.instrumentOpacity).padEnd(5)} size ${String(state.instrumentSize).padStart(4)} onScreen ${state.instrumentOnScreen}  overflow ${state.overflow} ${state.wrapped.length ? 'WRAPPED: ' + state.wrapped.join(' | ') : ''}\n`);
  }
  writeFileSync(`${OUT}/mobile-${view.id}-${LOCALE}.json`, JSON.stringify(report, null, 2));
  if (errors.length) console.error(`errors: ${errors.join(' | ')}`);
  await context.close();
}
await browser.close();
