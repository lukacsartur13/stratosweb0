/**
 * Where a back navigation actually lands, and whose fault it is.
 *
 * §14 of the reconciliation brief asks for the "mobile back-navigation lands at
 * the bottom of the document" report to be investigated far enough to classify
 * it — specifically, whether it is *caused by the current mobile architecture*.
 * That is a causal question, so this probe is built around controls rather than
 * around a single reading of the homepage.
 *
 * ## The arms, and what each one rules out
 *
 * Every arm does the same thing: load a page, scroll to a target, navigate away,
 * go back, and record where the scroll came to rest.
 *
 *   home        the portrait homepage — the composition under suspicion.
 *   home-desktop  the same URL at 1440x900, which mounts the *desktop*
 *               composition. If this restores and portrait does not, the
 *               difference is either the composition or the viewport.
 *   static      `/rolunk.html` at the same phone viewport — a generated static
 *               page, no React, no `main.tsx` fork, no ascent reader, and tall
 *               enough to have somewhere to fail to. This is the control that
 *               decides the brief's question: if a page with none of the mobile
 *               architecture in it lands in the same wrong place, the mobile
 *               architecture is not what puts it there.
 *   static-nojs the same static page with JavaScript disabled entirely, which
 *               removes `transitions.js`, `header.js` and `main.js` as well.
 *               What is left is the browser's own scroll restoration and
 *               nothing else.
 *
 * Run on both engines, because scroll restoration is one of the places they
 * genuinely differ and the phone the report is about runs WebKit:
 *
 *   node experiments/probe-back-navigation.mjs
 *
 * Writes _build/reports/mobile-test-reconciliation/back-navigation.json.
 *
 * ## Why the landing position is reported as a fraction as well as a pixel
 *
 * "Lands at the bottom" and "lands at the top" are the two failure shapes, and
 * they are indistinguishable in pixels alone without knowing how tall the
 * document turned out to be on that run. Both are recorded, plus the document
 * height at the moment of reading, so a landing can be attributed.
 */
import { chromium, webkit } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const ORIGIN = arg('origin', 'http://127.0.0.1:4322');
const TRIALS = Number(arg('trials', '5'));

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

const ARMS = [
  { name: 'home', url: '/index.html', viewport: PHONE, js: true },
  { name: 'home-desktop', url: '/index.html', viewport: DESKTOP, js: true },
  { name: 'static', url: '/rolunk.html', viewport: PHONE, js: true },
  { name: 'static-nojs', url: '/rolunk.html', viewport: PHONE, js: false },
];

/** Somewhere unambiguously down the page, and away from both ends. */
const TARGET = 6400;

async function trial(context, arm) {
  const page = await context.newPage();
  try {
    await page.goto(ORIGIN + arm.url, { waitUntil: 'load' });
    // Let the composition reach its full height before scrolling into it. A
    // target measured against a document that is still growing is a different
    // experiment on every run.
    await page.waitForTimeout(2500);

    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const travel = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    if (travel < TARGET) return { skipped: `document only ${travel}px tall` };

    await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), TARGET);
    await page.waitForTimeout(400);
    const left = await page.evaluate(() => Math.round(scrollY));

    await page.goto(ORIGIN + '/impresszum.html', { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await page.goBack({ waitUntil: 'load' });
    // Generous, and deliberately so: this is measuring where the page *settles*,
    // not how fast it gets there. A short wait here would turn a slow-but-correct
    // restore into a reported defect.
    await page.waitForTimeout(2500);

    const landed = await page.evaluate(() => Math.round(scrollY));
    const after = await page.evaluate(() => document.documentElement.scrollHeight);
    const travelAfter = await page.evaluate(
      () => document.documentElement.scrollHeight - innerHeight,
    );

    return {
      left,
      landed,
      docHeight: height,
      docHeightAfter: after,
      travelAfter,
      fractionOfDocument: travelAfter > 0 ? Math.round((landed / travelAfter) * 1000) / 1000 : null,
      error: Math.abs(landed - left),
      // The three outcomes worth naming, so the summary is readable without
      // arithmetic.
      verdict:
        Math.abs(landed - left) <= 150
          ? 'restored'
          : landed <= 150
            ? 'landed at the top'
            : travelAfter - landed <= 150
              ? 'landed at the bottom'
              : 'landed elsewhere',
    };
  } finally {
    await page.close();
  }
}

const report = { origin: ORIGIN, at: new Date().toISOString(), trials: TRIALS, engines: [] };

for (const [engineName, launcher] of [
  ['chromium', chromium],
  ['webkit', webkit],
]) {
  const browser = await launcher.launch();
  const engine = { engine: engineName, arms: [] };

  for (const arm of ARMS) {
    const context = await browser.newContext({
      viewport: arm.viewport,
      javaScriptEnabled: arm.js,
      hasTouch: arm.viewport === PHONE,
      isMobile: arm.viewport === PHONE && engineName === 'chromium',
    });
    const runs = [];
    for (let i = 0; i < TRIALS; i++) runs.push(await trial(context, arm));
    await context.close();

    const verdicts = {};
    for (const r of runs) verdicts[r.verdict ?? r.skipped] = (verdicts[r.verdict ?? r.skipped] ?? 0) + 1;
    engine.arms.push({ ...arm, runs, verdicts });
  }

  await browser.close();
  report.engines.push(engine);
}

const dir = resolve(ROOT, '_build/reports/mobile-test-reconciliation');
mkdirSync(dir, { recursive: true });
const path = resolve(dir, 'back-navigation.json');
writeFileSync(path, JSON.stringify(report, null, 2));

for (const engine of report.engines) {
  console.log(`\n  ${engine.engine}`);
  for (const arm of engine.arms) {
    const summary = Object.entries(arm.verdicts)
      .map(([k, v]) => `${v}x ${k}`)
      .join(', ');
    console.log(`    ${arm.name.padEnd(13)} ${arm.viewport.width}x${arm.viewport.height} js=${arm.js ? 'on ' : 'off'}  ${summary}`);
  }
}
console.log(`\n  written: ${path}\n`);
