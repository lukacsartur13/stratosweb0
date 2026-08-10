/**
 * What actually happens to `scrollY` on a back navigation to the homepage.
 *
 * §8 of the final hardening brief forbids guessing the cause, so this probe
 * does not test a hypothesis — it records the whole lifecycle and lets the
 * timeline say what moved the page.
 *
 * ## What is recorded, and why each entry earns its place
 *
 *   scrollRestoration   read at document-script time and again at `load`, so a
 *                       later assignment to `manual` would show up as a change
 *                       rather than as a single reading nobody can date.
 *   programmatic scroll every `scrollTo` / `scroll` / `scrollBy` /
 *                       `scrollIntoView` / `scrollTop=` call, with the stack
 *                       that made it. This is the difference between "the
 *                       application scrolled the page" and "the browser did",
 *                       and no amount of sampling can tell those apart.
 *   samples             `scrollY` and `scrollHeight` on every frame in which
 *                       either changed. A restore that lands and is then undone
 *                       looks completely different from one that never lands,
 *                       and both were candidates before this ran.
 *   events              DOMContentLoaded, load, pageshow (+`persisted`),
 *                       pagehide, popstate, and the first React paint, dated on
 *                       the same clock as the samples.
 *
 * The instrumentation is installed with `addInitScript`, so it is in place
 * before any page script on the *restored* document runs — which is the only
 * window in which the interesting things happen.
 *
 *   node experiments/probe-history-restoration.mjs
 *
 * Writes _build/reports/homepage-history-restoration.json, which
 * _build/reports/homepage-history-restoration-investigation.md reads.
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
const TRIALS = Number(arg('trials', '3'));
const LABEL = arg('label', 'head');

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

const ARMS = [
  { name: 'home-portrait', url: '/index.html', viewport: PHONE },
  { name: 'home-desktop', url: '/index.html', viewport: DESKTOP },
  { name: 'static-portrait', url: '/rolunk.html', viewport: PHONE },
];

const TARGET = 6400;

/** Runs in the page, before anything else, in every document. */
const INSTRUMENT = () => {
  const log = { t0: Date.now(), scrollRestoration: [], calls: [], samples: [], events: [] };
  window.__hist = log;
  const at = () => Math.round(performance.now());

  const note = (name, extra) => log.events.push({ t: at(), name, ...extra });

  log.scrollRestoration.push({ t: at(), when: 'script', value: history.scrollRestoration });

  // Programmatic scrolls, with the stack that made them. A frame sample can say
  // the page moved; only this can say who moved it.
  const record = (api, detail) => {
    const stack = (new Error().stack || '').split('\n').slice(2, 7).join(' | ');
    log.calls.push({ t: at(), api, detail, from: Math.round(window.scrollY), stack });
  };

  for (const api of ['scrollTo', 'scroll', 'scrollBy']) {
    const original = window[api];
    if (typeof original !== 'function') continue;
    window[api] = function (...a) {
      record(api, JSON.stringify(a[0] && typeof a[0] === 'object' ? a[0] : a));
      return original.apply(this, a);
    };
  }

  const intoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (...a) {
    record('scrollIntoView', this.tagName + (this.id ? '#' + this.id : '') + (this.className && typeof this.className === 'string' ? '.' + this.className.split(' ')[0] : ''));
    return intoView.apply(this, a);
  };

  const topDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  if (topDescriptor && topDescriptor.set) {
    Object.defineProperty(Element.prototype, 'scrollTop', {
      ...topDescriptor,
      set(v) {
        if (this === document.documentElement || this === document.body) record('scrollTop=', String(v));
        return topDescriptor.set.call(this, v);
      },
    });
  }

  // One sample per frame, kept only when something changed. 900 frames is
  // fifteen seconds at 60Hz — longer than any arm waits.
  let lastY = -1;
  let lastH = -1;
  let frames = 0;
  const sample = () => {
    const y = Math.round(window.scrollY);
    const h = document.documentElement.scrollHeight;
    if (y !== lastY || h !== lastH) {
      lastY = y;
      lastH = h;
      log.samples.push({ t: at(), y, h, vh: window.innerHeight });
    }
    if (++frames < 900) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);

  addEventListener('DOMContentLoaded', () => note('DOMContentLoaded'));
  addEventListener('load', () => {
    note('load');
    log.scrollRestoration.push({ t: at(), when: 'load', value: history.scrollRestoration });
  });
  addEventListener('pageshow', (e) => note('pageshow', { persisted: e.persisted }));
  addEventListener('pagehide', (e) => note('pagehide', { persisted: e.persisted }));
  addEventListener('popstate', () => note('popstate'));
  addEventListener('stratos:menu', (e) => note('stratos:menu', { open: !!e.detail?.open }));

  // The composition's own arrival, on the same clock. `.mv-on` is the portrait
  // mount; `[data-testid="journey-track"]` is the desktop one.
  const seen = new MutationObserver(() => {
    if (!log.mounted && document.querySelector('[data-testid="mobile-home"],[data-testid="journey-track"]')) {
      log.mounted = at();
      note('composition-mounted');
      seen.disconnect();
    }
  });
  if (document.documentElement) seen.observe(document.documentElement, { childList: true, subtree: true });
};

async function trial(context, arm) {
  const page = await context.newPage();
  try {
    await page.goto(ORIGIN + arm.url, { waitUntil: 'load' });
    await page.waitForTimeout(2500);

    const travel = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    if (travel < TARGET) return { skipped: `document only ${travel}px tall` };

    await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), TARGET);
    await page.waitForTimeout(400);
    const left = await page.evaluate(() => Math.round(scrollY));

    await page.goto(ORIGIN + '/impresszum.html', { waitUntil: 'load' });
    await page.waitForTimeout(600);

    await page.goBack({ waitUntil: 'load' });
    await page.waitForTimeout(3000);

    const landed = await page.evaluate(() => Math.round(scrollY));
    const log = await page.evaluate(() => window.__hist);
    const travelAfter = await page.evaluate(
      () => document.documentElement.scrollHeight - innerHeight,
    );

    return {
      left,
      landed,
      travelAfter,
      error: Math.abs(landed - left),
      verdict:
        Math.abs(landed - left) <= 150
          ? 'restored'
          : landed <= 150
            ? 'landed at the top'
            : travelAfter - landed <= 150
              ? 'landed at the bottom'
              : 'landed elsewhere',
      log,
    };
  } finally {
    await page.close();
  }
}

const report = { origin: ORIGIN, label: LABEL, at: new Date().toISOString(), trials: TRIALS, engines: [] };

for (const [engineName, launcher] of [
  ['chromium', chromium],
  ['webkit', webkit],
]) {
  const browser = await launcher.launch();
  const engine = { engine: engineName, arms: [] };

  for (const arm of ARMS) {
    const context = await browser.newContext({
      viewport: arm.viewport,
      hasTouch: arm.viewport === PHONE,
      isMobile: arm.viewport === PHONE && engineName === 'chromium',
    });
    await context.addInitScript(INSTRUMENT);

    const runs = [];
    for (let i = 0; i < TRIALS; i++) runs.push(await trial(context, arm));
    await context.close();

    const verdicts = {};
    for (const r of runs) verdicts[r.verdict ?? r.skipped] = (verdicts[r.verdict ?? r.skipped] ?? 0) + 1;
    engine.arms.push({ name: arm.name, url: arm.url, viewport: arm.viewport, runs, verdicts });
  }

  await browser.close();
  report.engines.push(engine);
}

const dir = resolve(ROOT, '_build/reports');
mkdirSync(dir, { recursive: true });
const path = resolve(dir, `homepage-history-restoration-${LABEL}.json`);
writeFileSync(path, JSON.stringify(report, null, 2));

for (const engine of report.engines) {
  console.log(`\n  ${engine.engine}`);
  for (const arm of engine.arms) {
    const summary = Object.entries(arm.verdicts).map(([k, v]) => `${v}x ${k}`).join(', ');
    console.log(`    ${arm.name.padEnd(16)} ${arm.viewport.width}x${arm.viewport.height}  ${summary}`);
    const first = arm.runs[0];
    if (!first?.log) continue;
    console.log(`      scrollRestoration: ${first.log.scrollRestoration.map((s) => `${s.when}=${s.value}`).join(' ')}`);
    console.log(`      events: ${first.log.events.map((e) => `${e.name}@${e.t}${e.persisted ? '(persisted)' : ''}`).join(' ')}`);
    console.log(`      programmatic scrolls: ${first.log.calls.length}`);
    for (const c of first.log.calls.slice(0, 6)) console.log(`        ${c.t}ms ${c.api}(${c.detail}) from ${c.from}`);
    const s = first.log.samples;
    console.log(`      samples: ${s.length}; first ${s[0] ? `${s[0].t}ms y=${s[0].y} h=${s[0].h}` : '-'}; last ${s.at(-1) ? `${s.at(-1).t}ms y=${s.at(-1).y} h=${s.at(-1).h}` : '-'}`);
  }
}
console.log(`\n  written: ${path}\n`);
