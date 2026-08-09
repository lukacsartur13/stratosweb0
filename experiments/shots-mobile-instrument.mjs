/**
 * The review package for the real 3D Altimeter on portrait mobile.
 *
 * §24 of the brief asks for a specific set of frames across a specific set of
 * viewports, and this produces exactly that set rather than "some screenshots":
 *
 *   opening      the frame the visitor lands on
 *   mid          the instrument composed, part-way through its travel
 *   late         the instrument's intentional exit — §14
 *   detail       a 2x crop of the dial: hands, numerals, ticks, ceiling arc
 *   glass        a 2x crop of the crystal's upper limb and the bezel highlight
 *   fallback     the same slot with WebGL denied the way a blocklist denies it
 *   svg          the previous portrait instrument, for the A/B §24 closes on
 *
 * WHY THE FRAMES ARE CHOSEN FROM THE SLOT AND NOT FROM A SCROLL FRACTION
 * ----------------------------------------------------------------------
 * "Mid-journey" is a property of the instrument, not of the document. The slot
 * is one element in the opening section, so a fixed fraction of the page picks
 * a different moment of the instrument's travel on every viewport and in every
 * locale — and three of the four would be frames the instrument is not in.
 * Each shot below scrolls to the position at which the slot's own crossing is
 * the fraction being asked for, which is the same frame on every device.
 *
 *   node experiments/shots-mobile-instrument.mjs
 *   node experiments/shots-mobile-instrument.mjs --only 390x844   (tuning)
 *
 * Writes _build/reports/mobile-3d-altimeter-review/.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = resolve(ROOT, '_build/reports/mobile-3d-altimeter-review');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const ORIGIN = arg('origin', 'http://localhost:4326');
const LOCALE = arg('locale', 'hu');
const ONLY = arg('only', null);
const PATHS = { hu: '/', en: '/en/', de: '/de/' };

/** §24's matrix, plus the landscape case §23 puts on this composition. */
const VIEWPORTS = [
  { name: '430x932', width: 430, height: 932 },
  { name: '390x844', width: 390, height: 844 },
  { name: '375x812', width: 375, height: 812 },
  { name: '360x800', width: 360, height: 800 },
  { name: '844x390', width: 844, height: 390 },
].filter((v) => !ONLY || v.name === ONLY);

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** Deny WebGL the way a blocklisted driver does: the constructor stays, creation fails. */
const DENY_WEBGL = () => {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (typeof type === 'string' && type.includes('webgl')) return null;
    return original.call(this, type, ...rest);
  };
};

async function open(browser, viewport, { denyWebGL = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  });
  if (denyWebGL) await context.addInitScript(DENY_WEBGL);
  const page = await context.newPage();
  await page.goto(ORIGIN + PATHS[LOCALE], { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="mobile-home"]', { timeout: 20_000 });
  return { context, page };
}

/**
 * Scroll so that the slot's crossing of the viewport is `crossed`.
 *
 * The same quantity `MobileInstrument` drives its pose from — 0 as the slot's
 * top edge reaches the bottom of the screen, 1 once its bottom edge has passed
 * the top. Inverted here to a scroll position, so a shot named "mid" is the
 * middle of the instrument's travel on every viewport rather than the middle of
 * a document whose height differs by locale.
 */
async function crossTo(page, crossed) {
  await page.evaluate((c) => {
    const box = document.querySelector('.mv-alt__stage');
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const top = rect.top + scrollY;
    const span = innerHeight + rect.height;
    scrollTo({ top: Math.max(0, c * span + top - innerHeight), behavior: 'instant' });
  }, crossed);
  // One settle. The instrument chases its target and stops; 700 ms is well past
  // the longest retain constant (0.26 s) and the crossfade (0.7 s).
  await page.waitForTimeout(750);
}

/** Wait for the first frame on which the instrument is correct, not merely present. */
const settled = (page) =>
  page.waitForSelector('.mv-alt__stage[data-ready]', { timeout: 25_000 });

/** A crop of the stage, in CSS pixels, expanded by `pad`. */
async function stageBox(page, pad = 0) {
  return page.evaluate((p) => {
    const box = document.querySelector('.mv-alt__stage');
    if (!box) return null;
    const r = box.getBoundingClientRect();
    return {
      x: Math.max(0, r.left - p),
      y: Math.max(0, r.top - p),
      width: Math.min(innerWidth, r.width + p * 2),
      height: Math.min(innerHeight, r.height + p * 2),
    };
  }, pad);
}

const shot = (page, name, options = {}) =>
  page.screenshot({ path: resolve(OUT, `${name}.png`), animations: 'disabled', ...options });

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const notes = [];

for (const viewport of VIEWPORTS) {
  const { context, page } = await open(browser, viewport);
  await settled(page);

  // ---- the three journey states -------------------------------------------
  // 0.18 is the frame the page opens on at every viewport in the matrix: the
  // slot starts part-way up the first screen, so its crossing is already past
  // zero before a finger has touched the glass.
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(900);
  await shot(page, `opening-${viewport.name}`);

  await crossTo(page, 0.48);
  await shot(page, `mid-${viewport.name}`);

  await crossTo(page, 0.82);
  await shot(page, `late-${viewport.name}`);

  // ---- the two crops ------------------------------------------------------
  // Taken at the composed pose, which is the frame the instrument is designed
  // to be looked at in.
  await crossTo(page, 0.48);
  const dial = await stageBox(page, 6);
  if (dial) await shot(page, `detail-${viewport.name}`, { clip: dial });

  // The upper third: the crystal's limb, the bezel highlight and the reflection
  // that separates glass from dial — the §10 evidence.
  if (dial) {
    await shot(page, `glass-${viewport.name}`, {
      clip: { ...dial, height: Math.round(dial.height * 0.42) },
    });
  }

  const measured = await page.evaluate(() => {
    const box = document.querySelector('.mv-alt__stage');
    const canvas = document.querySelector('canvas');
    const r = box?.getBoundingClientRect();
    return {
      stageCss: r ? [Math.round(r.width), Math.round(r.height)] : null,
      stageOfViewportHeight: r ? Number((r.height / innerHeight).toFixed(3)) : null,
      drawingBuffer: canvas ? [canvas.width, canvas.height] : null,
      canvases: document.querySelectorAll('canvas').length,
    };
  });
  notes.push({ viewport: viewport.name, ...measured });
  console.log(
    `${viewport.name.padEnd(8)} stage=${measured.stageCss?.join('x')} ` +
      `(${measured.stageOfViewportHeight} of vh) buffer=${measured.drawingBuffer?.join('x')} ` +
      `canvases=${measured.canvases}`,
  );

  await context.close();
}

// ---- the fallback, and the drawing it replaced ------------------------------
{
  const reference = VIEWPORTS.find((v) => v.name === '390x844') ?? VIEWPORTS[0];

  const { context, page } = await open(browser, reference, { denyWebGL: true });
  await page.waitForSelector('[data-testid="mobile-altimeter-svg"]', { timeout: 20_000 });
  await page.waitForTimeout(700);
  await shot(page, `fallback-${reference.name}`);
  const svgBox = await stageBox(page, 6);
  if (svgBox) await shot(page, `svg-${reference.name}`, { clip: svgBox });
  const mode = await page.getAttribute('[data-testid="mobile-altimeter"]', 'data-mode');
  notes.push({ viewport: `${reference.name} (no webgl)`, mode });
  console.log(`fallback  mode=${mode}`);
  await context.close();

  // The same crop with the renderer allowed, so the A/B is two files that differ
  // in one thing.
  const live = await open(browser, reference);
  await settled(live.page);
  await crossTo(live.page, 0.48);
  const glbBox = await stageBox(live.page, 6);
  if (glbBox) await shot(live.page, `glb-${reference.name}`, { clip: glbBox });
  await live.context.close();
}

await browser.close();

writeFileSync(
  resolve(OUT, 'stills.json'),
  JSON.stringify({ origin: ORIGIN, locale: LOCALE, at: new Date().toISOString(), notes }, null, 2),
);
console.log(`\nwrote ${OUT}`);
