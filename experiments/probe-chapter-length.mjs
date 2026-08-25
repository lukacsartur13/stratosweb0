// =============================================================================
// HOW LONG IS EVERY CHAPTER, AND WHAT IS IN IT. §16, §31, §38, §41.
//
// The process editorialisation phase has to answer four questions with numbers
// rather than with adjectives:
//
//   * how tall is the process passage, in screens, before and after;
//   * what share of the whole journey it occupies;
//   * how many DOM objects it carries;
//   * whether the compressed passage still clears the two bounds the previous
//     phase solved for — the accessibility walk's step from below and the
//     empty-spacer ceiling from above.
//
// It measures the running page rather than the source, because a panel's height
// is `--share` plus whatever its body actually needs, and only the browser
// knows the second number.
//
// Usage:  npm run dev:home                              # :5177
//         node experiments/probe-chapter-length.mjs --tag before
//         node experiments/probe-chapter-length.mjs --tag after --locale de
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(`--${n}`);
const TAG = arg('tag', 'before');
const LOCALE = arg('locale', 'hu');
/**
 * The phone gets the OTHER homepage, and asking for it needs more than a narrow
 * viewport. `mobile/device.ts` requires a coarse pointer and a short screen
 * edge, deliberately, so that a narrowed desktop window keeps the desktop
 * composition — which means a probe that only sets `--width 390` measures the
 * desktop DOM at phone width and reports a number about nothing.
 */
const MOBILE = has('mobile');
const WIDTH = Number(arg('width', MOBILE ? 390 : 1440));
const HEIGHT = Number(arg('height', MOBILE ? 844 : 900));
const BASE = process.env.URL ?? `http://localhost:5177/home/${LOCALE}.html`;
const OUT = arg('out', '_build/reports/luxury-art-direction/process');

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
  ...(MOBILE ? { hasTouch: true, isMobile: true } : null),
});
const page = await context.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
// `--instrument` is the desktop composition publisher's first pass. The phone
// composition does not publish it, so the phone waits on its own root instead.
if (MOBILE) {
  await page.waitForSelector('[data-testid="mobile-home"]', { timeout: 30_000 });
} else {
  await page.waitForFunction(
    () => getComputedStyle(document.documentElement).getPropertyValue('--instrument').trim() !== '',
    { timeout: 30_000 },
  );
}
await page.waitForTimeout(2000);

const report = await page.evaluate(({ height }) => {
  // The desktop composition is `.panel`; the phone's is `.mv-sec`. One
  // selector each, because the two homepages are two components.
  const panels = [...document.querySelectorAll('.panel, .mv-sec')];
  const track = document.querySelector('[data-testid="journey-track"]');

  const chapters = panels.map((p) => {
    const box = p.getBoundingClientRect();
    // Everything a visitor can be handed inside the chapter: text leaves plus
    // the images and figures. The same leaf set `scan-journey.mjs` reads, so
    // the two numbers are about the same population.
    const leaves = [...p.querySelectorAll(':is(p, h1, h2, h3, h4, li, dt, dd, figcaption, a, img)')];
    const words = leaves.reduce((n, el) => n + (el.textContent || '').trim().split(/\s+/).filter(Boolean).length, 0);
    return {
      stage: p.dataset.stage,
      level: p.dataset.level ?? 'act',
      screens: Number((box.height / height).toFixed(2)),
      px: Math.round(box.height),
      nodes: p.querySelectorAll('*').length,
      leaves: leaves.length,
      words,
    };
  });

  const total = chapters.reduce((n, c) => n + c.screens, 0);
  for (const c of chapters) c.shareOfJourney = Number(((c.screens / total) * 100).toFixed(1));

  return {
    viewport: { width: innerWidth, height: innerHeight },
    trackScreens: track ? Number((track.offsetHeight / height).toFixed(2)) : null,
    documentScreens: Number((document.documentElement.scrollHeight / height).toFixed(2)),
    chapterScreens: Number(total.toFixed(2)),
    chapters,
  };
}, { height: HEIGHT });

report.tag = TAG;
report.locale = LOCALE;
report.composition = MOBILE ? 'mobile' : 'desktop';

mkdirSync(OUT, { recursive: true });
const file = `${OUT}/chapter-length-${TAG}-${LOCALE}-${MOBILE ? 'mobile-' : ''}${WIDTH}x${HEIGHT}.json`;
writeFileSync(file, JSON.stringify(report, null, 2));

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${LOCALE} · ${WIDTH}×${HEIGHT}${MOBILE ? ' · phone' : ''} · ${TAG}`);
console.log(`${pad('chapter', 26)}${pad('level', 10)}${pad('screens', 9)}${pad('share', 8)}${pad('nodes', 8)}words`);
for (const c of report.chapters) {
  console.log(
    `${pad(c.stage, 26)}${pad(c.level, 10)}${pad(c.screens.toFixed(2), 9)}${pad(`${c.shareOfJourney}%`, 8)}${pad(c.nodes, 8)}${c.words}`,
  );
}
console.log(`\ntrack ${report.trackScreens} screens · document ${report.documentScreens} screens`);
console.log(`written ${file}\n`);

await browser.close();
