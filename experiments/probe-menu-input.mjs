/**
 * Why a non-forced click on the homepage menu trigger hangs at 1920×1080.
 *
 * The reconciliation brief §10 asks for the actual browser/input path rather
 * than a `force: true` that makes the symptom go away. This probe answers it by
 * measuring, on the built homepage, in the same browser Playwright drives:
 *
 *   * the trigger's geometry, and whether it is still moving
 *   * what `elementFromPoint` returns at its centre
 *   * computed `pointer-events`, `opacity`, `visibility`, `z-index`
 *   * running animations anywhere in the subtree
 *   * whether a synthetic `hover()` and a real `click()` are delivered at all,
 *     and how long each takes from request to the application's own handler
 *   * how many frames the tab is actually producing while that is happening
 *
 * ## The variable it exists to isolate
 *
 * Playwright's Chromium runs headless with SwiftShader — a CPU rasteriser — and
 * the desktop homepage is a full-viewport WebGL journey. At 1920×1080 that is
 * 2.07M pixels per frame on the main thread, against 1.30M at 1440×900: 60%
 * more of the one resource the input path also needs. So every measurement is
 * taken twice, on the same commit and the same build, with the only difference
 * being the rasteriser:
 *
 *   node experiments/probe-menu-input.mjs            # SwiftShader, as `npm test` runs
 *   node experiments/probe-menu-input.mjs --gpu      # ANGLE onto the platform backend
 *
 * and at both viewports, because 1440 passes and 1920 does not.
 *
 * Writes _build/reports/mobile-test-reconciliation/menu-input-<backend>.json.
 */
import { chromium } from '@playwright/test';
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
const GPU = args.includes('--gpu');
/** ANGLE onto the platform's own backend, rather than Chromium's CPU fallback. */
const GPU_ARGS = ['--use-gl=angle', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'];

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
];

/** The three header states the failing test walks, as scroll fractions. */
const STATES = [
  ['opening', 0],
  ['journey', 0.5],
  ['destination', 1],
];

/**
 * Everything about the trigger that an actionability check looks at, read in
 * one round trip so the answers describe one moment rather than five.
 */
const inspect = () => {
  const el = document.querySelector('.burger');
  if (!el) return { present: false };
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  const stack = [];
  for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.zIndex !== 'auto' || s.position !== 'static' || s.transform !== 'none') {
      stack.push(`${p.tagName.toLowerCase()}.${String(p.className).trim().split(/\s+/)[0]}: z=${s.zIndex} pos=${s.position} tf=${s.transform === 'none' ? 'none' : 'yes'}`);
    }
  }
  return {
    present: true,
    box: [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 1000) / 1000),
    pointerEvents: cs.pointerEvents,
    opacity: cs.opacity,
    visibility: cs.visibility,
    display: cs.display,
    zIndex: cs.zIndex,
    stackingContexts: stack,
    topmostAtCentre: hit
      ? `${hit.tagName.toLowerCase()}.${String(hit.className).trim().slice(0, 40)}`
      : null,
    topmostIsSelfOrChild: !!hit && (hit === el || el.contains(hit)),
    animations: document.getAnimations
      ? document.getAnimations().filter((a) => a.playState === 'running').length
      : -1,
    ariaExpanded: el.getAttribute('aria-expanded'),
  };
};

/** Is the box byte-identical over N consecutive frames? Playwright's "stable". */
const stability = (frames) =>
  new Promise((done) => {
    const el = document.querySelector('.burger');
    if (!el) return done({ stable: false, reason: 'absent' });
    const seen = new Set();
    let n = 0;
    const tick = () => {
      const r = el.getBoundingClientRect();
      seen.add([r.x, r.y, r.width, r.height].join(','));
      if (++n < frames) return requestAnimationFrame(tick);
      done({ stable: seen.size === 1, distinctBoxes: seen.size, frames });
    };
    requestAnimationFrame(tick);
  });

/** Frames per second the tab is actually producing, over ~1s. */
const frameRate = () =>
  new Promise((done) => {
    let frames = 0;
    const started = performance.now();
    const tick = () => {
      frames++;
      if (performance.now() - started < 1000) return requestAnimationFrame(tick);
      done(Math.round((frames * 1000) / (performance.now() - started)));
    };
    requestAnimationFrame(tick);
  });

/** Time a call, and report a timeout as a duration rather than as a throw. */
async function timed(label, fn, budget) {
  const started = Date.now();
  try {
    await fn();
    return { label, ok: true, ms: Date.now() - started };
  } catch (error) {
    return {
      label,
      ok: false,
      ms: Date.now() - started,
      budget,
      error: String(error).split('\n')[0].slice(0, 160),
    };
  }
}

async function measure(page, viewport) {
  const out = { viewport: viewport.name, states: [] };

  await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'load' });
  await page.waitForSelector('[data-testid="altitude-hud"], [data-testid="mobile-telemetry"]', {
    state: 'visible',
    timeout: 30_000,
  });
  await page.waitForTimeout(1500);

  out.fps = await page.evaluate(frameRate);

  for (const [state, fraction] of STATES) {
    await page.evaluate((f) => {
      const h = document.documentElement.scrollHeight - innerHeight;
      window.scrollTo({ top: h * f, behavior: 'instant' });
    }, fraction);
    await page.waitForTimeout(2500);

    // The application's own receipt, recorded in the page so it cannot be
    // confused with Playwright's view of whether the call returned.
    await page.evaluate(() => {
      const w = window;
      w.__menuEvents = [];
      const el = document.querySelector('.burger');
      if (!el || el.dataset.probed) return;
      el.dataset.probed = '1';
      for (const type of ['pointerover', 'pointermove', 'pointerdown', 'mousedown', 'mouseup', 'click']) {
        el.addEventListener(type, () => w.__menuEvents.push([type, Math.round(performance.now())]), true);
      }
    });

    const before = await page.evaluate(inspect);
    const stable = await page.evaluate(stability, 90);
    const headerState = await page.evaluate(
      () => document.querySelector('header.nav')?.getAttribute('data-state') ?? null,
    );

    const hover = await timed('hover', () => page.locator('.burger').hover({ timeout: 8_000 }), 8_000);
    const trial = await timed('click{trial}', () => page.locator('.burger').click({ trial: true, timeout: 8_000 }), 8_000);
    const click = await timed('click', () => page.locator('.burger').click({ timeout: 8_000 }), 8_000);

    const events = await page.evaluate(() => window.__menuEvents ?? []);
    const after = await page.evaluate(inspect);

    // Leave the layer closed for the next state, whichever way it got opened.
    if (after.ariaExpanded === 'true') {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
    }

    out.states.push({ state, headerState, before, stable, hover, trial, click, events, afterAriaExpanded: after.ariaExpanded });
  }

  // The forced path, for the record: the brief forbids it as a fix and wants it
  // reported as evidence.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(1200);
  const forced = await timed('click{force}', () => page.locator('.burger').click({ force: true, timeout: 8_000 }), 8_000);
  out.forced = {
    ...forced,
    ariaExpanded: await page.locator('.burger').getAttribute('aria-expanded'),
  };

  return out;
}

const browser = await chromium.launch({ args: GPU ? GPU_ARGS : [] });
const report = { origin: ORIGIN, backend: GPU ? 'angle' : 'swiftshader', runs: [] };

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  report.runs.push(await measure(page, viewport));
  await context.close();
}

// What the renderer actually resolved to, so a report can never compare one
// backend against the other by accident.
{
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('data:text/html,<canvas id=c>');
  report.renderer = await page.evaluate(() => {
    const gl = document.getElementById('c').getContext('webgl2') || document.getElementById('c').getContext('webgl');
    if (!gl) return 'none';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  await context.close();
}

await browser.close();

const dir = resolve(ROOT, '_build/reports/mobile-test-reconciliation');
mkdirSync(dir, { recursive: true });
const path = resolve(dir, `menu-input-${report.backend}.json`);
writeFileSync(path, JSON.stringify(report, null, 2));

console.log(`\n  backend: ${report.backend}  (${report.renderer})`);
for (const run of report.runs) {
  console.log(`\n  ${run.viewport} — ${run.fps} fps`);
  for (const s of run.states) {
    const g = s.before.box ? s.before.box.join(',') : 'absent';
    console.log(
      `    ${s.state.padEnd(12)} box=${g}  stable=${s.stable.stable}  anim=${s.before.animations}  ` +
        `pe=${s.before.pointerEvents}  hit=${s.before.topmostIsSelfOrChild ? 'self' : s.before.topmostAtCentre}`,
    );
    console.log(
      `      hover ${s.hover.ok ? 'ok' : 'TIMEOUT'} ${s.hover.ms}ms   trial ${s.trial.ok ? 'ok' : 'TIMEOUT'} ${s.trial.ms}ms   ` +
        `click ${s.click.ok ? 'ok' : 'TIMEOUT'} ${s.click.ms}ms   handler=${s.events.map((e) => e[0]).join('>') || 'none'}   aria=${s.afterAriaExpanded}`,
    );
  }
  console.log(`    forced click ${run.forced?.ok ? 'ok' : 'TIMEOUT'} ${run.forced?.ms}ms  aria=${run.forced?.ariaExpanded}`);
}
console.log(`\n  written: ${path}\n`);
