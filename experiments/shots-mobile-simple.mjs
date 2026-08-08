/**
 * The review package for the simplified portrait homepage — §29.
 *
 * Writes `_build/reports/mobile-homepage-simple-review/`:
 *
 *   <viewport>-full.png            the whole document, one image
 *   <viewport>-<section>.png       each section, framed at the top of the screen
 *
 * Every still is taken with the reveals already resolved. A screenshot caught
 * mid-transition is a picture of the transition, not of the composition, and a
 * review set full of them says nothing about either.
 *
 *   node experiments/shots-mobile-simple.mjs [--origin http://localhost:4322]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = resolve(ROOT, '_build/reports/mobile-homepage-simple-review');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const ORIGIN = arg('origin', 'http://localhost:4322');
const LOCALE = arg('locale', 'hu');
const PATHS = { hu: '/', en: '/en/', de: '/de/' };

const VIEWPORTS = [
  { name: '430x932', width: 430, height: 932 },
  { name: '390x844', width: 390, height: 844 },
  { name: '375x812', width: 375, height: 812 },
  { name: '360x800', width: 360, height: 800 },
  { name: '844x390', width: 844, height: 390 },
];

/** The beats §29 asks for, by stage id. */
const SECTIONS = [
  'calibration',
  'initial-ascent',
  'lower-atmosphere',
  'cloud-breakthrough',
  'selected-work',
  'system',
  'process',
  'destination',
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    isMobile: viewport.width < 500,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(ORIGIN + PATHS[LOCALE], { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // Walk the whole document once so every IntersectionObserver has fired, then
  // wait out the longest transition on the page (the 1.05s masked headline)
  // before taking anything.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = Math.round(viewport.height * 0.8);
  for (let y = 0; y < height; y += step) {
    await page.evaluate((to) => scrollTo({ top: to, behavior: 'instant' }), y);
    await page.waitForTimeout(90);
  }
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(1400);

  await page.screenshot({ path: resolve(OUT, `${viewport.name}-full.png`), fullPage: true });

  for (const id of SECTIONS) {
    const found = await page.evaluate((stage) => {
      const el = document.getElementById(`stage-${stage}`);
      if (!el) return false;
      // Framed BELOW the shared header, not at the top of the viewport.
      //
      // The header is fixed and about 90px tall, so a still framed at y=24 puts
      // every section's eyebrow behind it — which made the first review set look
      // as though the labels had been lost, when what had actually happened was
      // that the harness had scrolled somewhere no visitor ever lands. This is
      // the same offset `scroll-padding-top` gives an anchor link.
      const deck = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--deck-content')) || 64;
      scrollTo({ top: el.getBoundingClientRect().top + scrollY - deck - 16, behavior: 'instant' });
      return true;
    }, id);
    if (!found) continue;
    await page.waitForTimeout(320);
    await page.screenshot({ path: resolve(OUT, `${viewport.name}-${id}.png`) });
  }

  console.log(`${viewport.name}  document ${height}px  ${(height / viewport.height).toFixed(1)} screens`);
  await context.close();
}

await browser.close();
console.log(`\nwrote ${OUT}`);
