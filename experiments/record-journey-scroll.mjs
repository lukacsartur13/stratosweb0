// =============================================================================
// §49 · THE FULL-SCROLL REVIEW.
//
// "Capture the full homepage scroll at 1440×900 at a natural human scroll pace.
// Do not only use automated jump-to-altitude screenshots." — because the things
// §49 asks to be reviewed are properties of MOTION and a still cannot carry
// them: rhythm, continuity, motion personality, dead space, temporary overlaps,
// master/passage hierarchy.
//
// So this scrolls the whole track the way a thumb does — a wheel-sized step on
// a frame cadence, not a jump — and records the viewport to WebM.
//
// A NATURAL PACE, DEFINED. A comfortable reading scroll is roughly one viewport
// every 1.2–1.6 seconds. At 25 fps that is ~24px a frame on a 900px screen, and
// the step below is derived from the viewport rather than hardcoded so the
// phone gets the same pace in its own units.
//
// Usage:  npm run dev:home
//         node experiments/record-journey-scroll.mjs [--mobile] [--locale hu]
// =============================================================================
import { chromium, devices } from '@playwright/test';
import { mkdirSync, renameSync, readdirSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const MOBILE = process.argv.includes('--mobile');
const LOCALE = arg('locale', 'hu');
const BASE = process.env.URL ?? `http://localhost:5177/home/${LOCALE}.html`;
const OUT = '_build/reports/luxury-art-direction/continuity/scroll';
const VIEW = MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const NAME = MOBILE ? `mobile-390-${LOCALE}` : `desktop-1440-${LOCALE}`;

/** One viewport every 1.4 seconds, at 25 frames a second. */
const SECONDS_PER_SCREEN = 1.4;
const FPS = 25;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  ...(MOBILE ? devices['iPhone 13'] : {}),
  viewport: VIEW,
  deviceScaleFactor: 1,
  recordVideo: { dir: `${OUT}/_raw`, size: VIEW },
});
const page = await context.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'vite-error-overlay, .debug, .debug__toggle { display: none !important; }' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(4000);

const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
const step = Math.max(4, Math.round(VIEW.height / (SECONDS_PER_SCREEN * FPS)));
const frames = Math.ceil(total / step);
console.log(`${NAME}: ${(total / VIEW.height).toFixed(1)} screens · ${step}px/frame · ~${(frames / FPS).toFixed(0)}s`);

// Two seconds on the opening frame before the journey starts, which is what a
// visitor does and what makes the recording readable as a journey rather than
// as a scrub.
await page.waitForTimeout(2000);

for (let y = 0; y <= total; y += step) {
  await page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), y);
  await page.waitForTimeout(1000 / FPS);
}
// And a hold at the foot, on the closing invitation.
await page.waitForTimeout(2500);

await context.close();
await browser.close();

// Playwright names the file by the page's GUID; give it the name of the run.
const raw = readdirSync(`${OUT}/_raw`).filter((f) => f.endsWith('.webm'));
const newest = raw.map((f) => ({ f, t: readdirSync(`${OUT}/_raw`).indexOf(f) })).at(-1);
renameSync(`${OUT}/_raw/${newest.f}`, `${OUT}/${NAME}.webm`);
console.log(`wrote ${OUT}/${NAME}.webm`);
