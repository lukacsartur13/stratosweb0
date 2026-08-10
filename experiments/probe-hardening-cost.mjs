/**
 * What the two interaction-hardening fixes cost, measured against the same build.
 *
 * §20 asks for a before/after on scroll listeners, forced layouts, style writes,
 * long tasks and frame timing. Rebuilding the site twice to get a "before" would
 * compare two artefacts and attribute every difference between them to the fix,
 * so both arms here run the SAME `dist/` and switch the fix off from the page
 * instead:
 *
 *   menu       `delete HTMLElement.prototype.inert` in an init script makes
 *              `header.js`'s own feature test fail, so it takes the pre-fix
 *              path — the keydown trap alone, no inert — with every other byte
 *              of the page identical.
 *
 *   history    `history.replaceState` is stubbed to a no-op before anything
 *              runs, so `home-history.js` can never record a height and never
 *              has one to reserve. Same file, same parse cost, same observer,
 *              pre-fix behaviour.
 *
 * What is measured:
 *
 *   openMs        click to `aria-expanded="true"`, the whole open path
 *   perPressMs    median cost of a Tab while the layer is open
 *   layoutMs      `performance.measureUserAgentSpecificMemory` is not portable,
 *                 so this is the browser's own layout/style time from
 *                 `PerformanceObserver` on `long-animation-frame` where
 *                 available, and total long-task time elsewhere
 *   scrollFrames  frame intervals during a scripted scroll, worst and median
 *   listeners     scroll/resize listener count, counted by patching
 *                 addEventListener before any page script runs
 *
 *   node experiments/probe-hardening-cost.mjs
 *
 * Writes _build/reports/hardening-cost.json.
 */
import { chromium, webkit } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const args = process.argv.slice(2);
const arg = (n, d) => {
  const at = args.indexOf(`--${n}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : d;
};

const ORIGIN = arg('origin', 'http://127.0.0.1:4322');
const PRESSES = Number(arg('presses', '8'));

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

/** Count scroll/resize listeners and long tasks, in every arm. */
const COUNTERS = () => {
  const w = window;
  w.__cost = { listeners: {}, longTasks: 0, longTaskMs: 0 };
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (type === 'scroll' || type === 'resize') {
      w.__cost.listeners[type] = (w.__cost.listeners[type] ?? 0) + 1;
    }
    return add.call(this, type, ...rest);
  };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        w.__cost.longTasks += 1;
        w.__cost.longTaskMs += e.duration;
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) {
    /* WebKit has no longtask observer; the field stays at zero and the report
       says so rather than pretending it measured one. */
    w.__cost.longTaskUnsupported = true;
  }
};

/** Switch the menu fix off without changing the build. */
const NO_INERT = () => {
  delete HTMLElement.prototype.inert;
};

/** Switch the history fix off without changing the build. */
const NO_STATE = () => {
  // `home-history.js` reads its recorded height from `sessionStorage` and
  // reserves nothing without one, so a getter that always answers "nothing
  // recorded" is the pre-fix behaviour with the same file, the same parse cost
  // and the same observer still in place.
  const store = Storage.prototype;
  const get = store.getItem;
  store.getItem = function (key) {
    return key === 'stratos.home-height' ? null : get.call(this, key);
  };
};

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.floor(s.length / 2)] * 100) / 100;
};

async function measure(context, url, viewport) {
  const page = await context.newPage();
  try {
    await page.goto(ORIGIN + url, { waitUntil: 'load' });
    await page.waitForTimeout(2500);

    // --- the menu open path -------------------------------------------------
    const openMs = await page.evaluate(async () => {
      const burger = document.querySelector('.burger');
      const t0 = performance.now();
      burger.click();
      // The open path is synchronous apart from one rAF for the transition's
      // "from" frame, so one frame is the whole of the wait.
      await new Promise((r) => requestAnimationFrame(r));
      return Math.round((performance.now() - t0) * 100) / 100;
    });

    // --- what a Tab costs while it is open ----------------------------------
    const presses = [];
    for (let i = 0; i < PRESSES; i++) {
      const t0 = Date.now();
      await page.keyboard.press('Tab');
      presses.push(Date.now() - t0);
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // --- frame timing under a scripted scroll -------------------------------
    const scroll = await page.evaluate(async () => {
      const frames = [];
      let last = performance.now();
      let stop = false;
      const tick = () => {
        const now = performance.now();
        frames.push(now - last);
        last = now;
        if (!stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      const travel = document.documentElement.scrollHeight - innerHeight;
      for (let i = 0; i <= 40; i++) {
        scrollTo({ top: (travel * i) / 40, behavior: 'instant' });
        await new Promise((r) => requestAnimationFrame(r));
      }
      stop = true;
      // The first two frames include the observer's own startup.
      return frames.slice(2);
    });

    const cost = await page.evaluate(() => window.__cost);

    return {
      openMs,
      perPressMs: median(presses),
      worstPressMs: Math.max(...presses),
      scrollFrameMedianMs: median(scroll),
      scrollFrameWorstMs: Math.round(Math.max(...scroll) * 100) / 100,
      scrollListeners: cost.listeners.scroll ?? 0,
      resizeListeners: cost.listeners.resize ?? 0,
      longTasks: cost.longTaskUnsupported ? null : cost.longTasks,
      longTaskMs: cost.longTaskUnsupported ? null : Math.round(cost.longTaskMs),
    };
  } finally {
    await page.close();
  }
}

const ARMS = [
  { name: 'as shipped', init: [] },
  { name: 'menu fix off', init: [NO_INERT] },
  { name: 'history fix off', init: [NO_STATE] },
];

const report = { origin: ORIGIN, at: new Date().toISOString(), presses: PRESSES, engines: [] };

for (const [engineName, launcher] of [
  ['chromium', chromium],
  ['webkit', webkit],
]) {
  const browser = await launcher.launch();
  const engine = { engine: engineName, viewports: [] };

  for (const viewport of [DESKTOP, PHONE]) {
    const arms = [];
    for (const arm of ARMS) {
      const context = await browser.newContext({
        viewport,
        hasTouch: viewport === PHONE,
        isMobile: viewport === PHONE && engineName === 'chromium',
      });
      await context.addInitScript(COUNTERS);
      for (const script of arm.init) await context.addInitScript(script);
      arms.push({ arm: arm.name, ...(await measure(context, '/index.html', viewport)) });
      await context.close();
    }
    engine.viewports.push({ viewport, arms });
  }

  await browser.close();
  report.engines.push(engine);
}

const dir = resolve(ROOT, '_build/reports');
mkdirSync(dir, { recursive: true });
const path = resolve(dir, 'hardening-cost.json');
writeFileSync(path, JSON.stringify(report, null, 2));

for (const engine of report.engines) {
  console.log(`\n  ${engine.engine}`);
  for (const v of engine.viewports) {
    console.log(`    ${v.viewport.width}x${v.viewport.height}`);
    for (const a of v.arms) {
      console.log(
        `      ${a.arm.padEnd(16)} open ${String(a.openMs).padStart(7)}ms  tab ${String(a.perPressMs).padStart(5)}ms (worst ${String(a.worstPressMs).padStart(5)})  frame ${String(a.scrollFrameMedianMs).padStart(6)}ms (worst ${String(a.scrollFrameWorstMs).padStart(7)})  scroll/resize listeners ${a.scrollListeners}/${a.resizeListeners}  longtasks ${a.longTasks}/${a.longTaskMs}ms`,
      );
    }
  }
}
console.log(`\n  written: ${path}\n`);
