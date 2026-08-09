/**
 * Mutation check: do the two repaired assertions still fail on the defects they
 * exist to catch?
 *
 * `the first meaningful line of every chapter is near its own top` and `no
 * chapter contains a tall run of nothing` both failed on landscape 844x390 and
 * both were repaired. §24 of the reconciliation brief refuses a suite made green
 * by assertion weakening, so "it passes now" is not evidence — this is. Each arm
 * injects one defect into a loaded page and re-runs the *exact* measurement
 * logic and thresholds from `experiments/tests/portrait-journey.spec.ts`.
 *
 *   node experiments/probe-gap-mutation.mjs      # needs `npm run serve:dist`
 *
 * ## What it found, which is why it exists rather than being a formality
 *
 * On the first run the 300 px empty-spacer arm came back GREEN at both
 * viewports — the defect the second test is *named after* was not being caught,
 * and had not been before the repair either. Every element's box was counted as
 * content, and an empty `<div>` has a box, so it filled its own gap; the walk
 * could only see space made by margins and padding. Restricting the walk to
 * boxes that actually draw something (a replaced element, or an element with a
 * direct non-whitespace text node) is what makes the arm go red.
 *
 * Expected output: `control` green at both viewports, all four defect arms RED.
 */
import { webkit } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:4322';
const ROUTE = '/experiments/stratos-ascent-full/';

/** The measurement from `the first meaningful line of every chapter…`. */
const measureLeads = () => {
  const out = [];
  for (const section of document.querySelectorAll('[data-stage]')) {
    const first = section.querySelector('.mv-eyebrow, .mv-title');
    if (!first) continue;
    const gap = first.getBoundingClientRect().top - section.getBoundingClientRect().top;
    out.push({
      stage: section.dataset.stage,
      svh: (gap / innerHeight) * 100,
      px: gap,
      padPx: parseFloat(getComputedStyle(section).paddingBlockStart) || 0,
      viewport: innerHeight,
    });
  }
  return out;
};

/** The measurement from `no chapter contains a tall run of nothing`. */
const measureGaps = () => {
  const out = [];
  for (const section of document.querySelectorAll('[data-stage]')) {
    const REPLACED = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'PICTURE', 'HR']);
    const draws = (el) => {
      if (REPLACED.has(el.tagName)) return true;
      for (const node of el.childNodes) {
        if (node.nodeType === 3 && node.textContent.trim()) return true;
      }
      return false;
    };
    const boxes = [...section.querySelectorAll('*')]
      .filter(draws)
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.height > 0 && r.width > 0)
      .sort((a, b) => a.top - b.top);
    if (boxes.length === 0) continue;
    let reach = boxes[0].top;
    let largest = 0;
    let where = 'interior';
    for (const box of boxes) {
      if (box.top > reach && box.top - reach > largest) largest = box.top - reach;
      reach = Math.max(reach, box.bottom);
    }
    const trailing = section.getBoundingClientRect().bottom - reach;
    if (trailing > largest) {
      largest = trailing;
      where = 'trailing';
    }
    const gapSvh = (largest / innerHeight) * 100;
    if (gapSvh > 34) out.push({ stage: section.dataset.stage, gapSvh, where });
  }
  return out;
};

/** Apply the spec's assertions and report which ones would fail. */
function judge(leads, gaps) {
  const failures = [];
  for (const lead of leads) {
    if (lead.px - lead.padPx > 2)
      failures.push(`lead: ${lead.stage} has ${(lead.px - lead.padPx).toFixed(1)}px beyond its own padding`);
    if (lead.stage === 'calibration') {
      if (lead.px >= lead.viewport) failures.push(`lead: opening line below the fold (${lead.px.toFixed(0)}px)`);
    } else if (lead.svh > 16) {
      failures.push(`lead: ${lead.stage} opens ${lead.svh.toFixed(1)} svh in`);
    }
  }
  for (const g of gaps) failures.push(`gap: ${g.stage} ${g.gapSvh.toFixed(1)} svh (${g.where})`);
  return failures;
}

const ARMS = [
  ['control (untouched)', () => {}],
  [
    'a 300px empty spacer between two content blocks',
    () => {
      const section = document.querySelector('[data-stage="initial-ascent"]');
      const title = section.querySelector('.mv-title');
      const spacer = document.createElement('div');
      spacer.style.cssText = 'height:300px';
      title.after(spacer);
    },
  ],
  [
    'extra margin pushed above a chapter\'s first line',
    () => {
      const section = document.querySelector('[data-stage="initial-ascent"]');
      section.querySelector('.mv-eyebrow, .mv-title').style.marginTop = '260px';
    },
  ],
  [
    'the opening line pushed below the fold',
    () => {
      const section = document.querySelector('[data-stage="calibration"]');
      section.style.paddingBlockStart = '1200px';
    },
  ],
  [
    'a tall trailing blank at the end of a chapter',
    () => {
      const section = document.querySelector('[data-stage="initial-ascent"]');
      section.style.paddingBottom = '600px';
    },
  ],
];

for (const [width, height] of [
  [390, 844],
  [844, 390],
]) {
  const browser = await webkit.launch();
  console.log(`\n=== ${width}x${height} ===`);
  for (const [name, mutate] of ARMS) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true });
    const page = await context.newPage();
    await page.goto(ORIGIN + ROUTE, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.classList.contains('mv-on'), null, {
      timeout: 30_000,
    });
    // Fire every reveal, so nothing is measured mid-transition.
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    const step = await page.evaluate(() => Math.round(innerHeight * 0.8));
    for (let y = 0; y < h; y += step) {
      await page.evaluate((to) => scrollTo({ top: to, behavior: 'instant' }), y);
      await page.waitForTimeout(60);
    }
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(1200);

    await page.evaluate(mutate);
    await page.waitForTimeout(300);

    const failures = judge(await page.evaluate(measureLeads), await page.evaluate(measureGaps));
    const verdict = failures.length ? `RED   (${failures.length})` : 'green';
    console.log(`  ${verdict}  ${name}`);
    for (const f of failures.slice(0, 3)) console.log(`          ${f}`);
    await context.close();
  }
  await browser.close();
}
