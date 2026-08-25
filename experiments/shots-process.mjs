// =============================================================================
// §46 · THE PROCESS REVIEW ASSETS, AND ONLY THOSE.
//
// §45 forbids another art-direction exploration and §46 lists exactly five
// pictures the compression has to be approved against. This makes them and
// nothing else.
//
//   process-desktop.png              the settled composition at 1440 x 900
//   process-mobile.png               the 390 sequence, in order
//   process-locales.png              HU / EN / DE at the same two states
//   process-before-after.png         the long passage against the compressed one
//   journey-after-process-compression.png   the whole track, as thumbnails
//
// The chapter's own scroll is walked in SCREENS from its top, so the same run
// works before and after even though the chapter's length changes — which is
// the whole point of the before/after sheet.
//
// Usage:  npm run dev:home                              # :5177
//         node experiments/shots-process.mjs --tag before   # on the old tree
//         node experiments/shots-process.mjs --tag after    # on the new one
//         node experiments/shots-process.mjs --sheets       # once both exist
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(`--${n}`);
const TAG = arg('tag', 'after');
const ROOT = '_build/reports/luxury-art-direction/process';
const OUT = `${ROOT}/${TAG}`;
const url = (locale) => process.env.URL ?? `http://localhost:5177/home/${locale}.html`;

/**
 * Where to stand inside the process chapter, in screens from its own top.
 *
 * Eight, because the long version is 5.6 screens and a fair before/after has to
 * show what the extra four screens contained rather than only its first frame.
 * On the compressed chapter the positions past its end clamp to the foot, which
 * is the honest picture: there is nothing there any more.
 */
const WALK = [0.0, 0.5, 1.1, 1.7, 2.6, 3.5, 4.4, 5.2];

const browser = await chromium.launch();

async function open({ width, height, mobile, locale }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    ...(mobile ? { hasTouch: true, isMobile: true } : null),
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    let v;
    Object.defineProperty(globalThis, '__stratos', {
      configurable: true,
      get: () => v,
      set: (x) => { v = x; if (x?.journey?.debug) x.journey.debug.ringRotation = 0; },
    });
  });
  await page.goto(url(locale), { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: 'vite-error-overlay, .debug, .debug__toggle { display: none !important; }' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.panel[data-stage="process"], .mv-sec[data-stage="process"]', { timeout: 30_000 });
  await page.waitForTimeout(2800);
  return page;
}

/** Scroll to `at` screens into the process chapter and shoot it. */
async function walk(page, { at, path }) {
  const clamped = await page.evaluate((screens) => {
    // `.panel` / `.mv-sec` and not a bare `[data-stage]`: the HUD publishes the
    // ACTIVE stage on an element of its own, earlier in the document, so a bare
    // attribute selector answers with a 42px readout as soon as the visitor is
    // inside the chapter — and the walk silently scrolls to the top of the page.
    const el = document.querySelector('.panel[data-stage="process"], .mv-sec[data-stage="process"]');
    // Summed up the offset chain rather than read off a bounding box, because
    // the desktop panels live inside a sticky track: a rect read mid-scroll
    // answers about where the panel is being PAINTED, not where it starts.
    let top = 0;
    for (let n = el; n; n = n.offsetParent) top += n.offsetTop;
    const want = top + screens * innerHeight;
    // Never past the chapter's own foot: a frame of the NEXT chapter in a sheet
    // about this one is a picture of the wrong thing.
    const cap = top + el.offsetHeight - innerHeight;
    const y = Math.max(top, Math.min(want, cap));
    scrollTo({ top: y, behavior: 'instant' });
    return Number(((y - top) / innerHeight).toFixed(2));
  }, at);
  await page.waitForTimeout(2000);
  await page.screenshot({ path });
  return clamped;
}

async function capture() {
  mkdirSync(OUT, { recursive: true });
  const manifest = { tag: TAG, desktop: [], mobile: [], locales: [] };

  // --- desktop, Hungarian: the walk, and the settled frame out of it ---------
  {
    const page = await open({ width: 1440, height: 900, locale: 'hu' });
    for (const [i, at] of WALK.entries()) {
      const path = `${OUT}/desktop-hu-${String(i).padStart(2, '0')}.png`;
      const clamped = await walk(page, { at, path });
      manifest.desktop.push({ at, clamped, path });
      process.stdout.write(`desktop hu  ${String(at).padStart(4)} -> ${String(clamped).padStart(4)} screens\n`);
    }
    // §46's `process-desktop.png`: the settled state, which for a passage is the
    // frame held still — 0.3 of a screen in, after the reveal and before it
    // releases.
    await walk(page, { at: 0.3, path: `${ROOT}/process-desktop.png` });
    await page.context().close();
  }

  // --- the phone ------------------------------------------------------------
  {
    const page = await open({ width: 390, height: 844, mobile: true, locale: 'hu' });
    const shots = [];
    for (const [i, at] of WALK.entries()) {
      const path = `${OUT}/mobile-hu-${String(i).padStart(2, '0')}.png`;
      const clamped = await walk(page, { at, path });
      if (i === 0 || clamped > (shots.at(-1)?.clamped ?? -1)) shots.push({ at, clamped, path });
      process.stdout.write(`mobile  hu  ${String(at).padStart(4)} -> ${String(clamped).padStart(4)} screens\n`);
    }
    manifest.mobile = shots;
    await page.context().close();
  }

  // --- the three locales, at the two states that matter ---------------------
  for (const locale of ['hu', 'en', 'de']) {
    const page = await open({ width: 1440, height: 900, locale });
    for (const [name, at] of [['frame', 0.3], ['body', 1.4]]) {
      const path = `${OUT}/locale-${locale}-${name}.png`;
      const clamped = await walk(page, { at, path });
      manifest.locales.push({ locale, name, at, clamped, path });
    }
    await page.context().close();
    process.stdout.write(`locale ${locale} captured\n`);
  }

  writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
  console.log(`\nwrote ${OUT}/manifest.json`);
}

// -------------------------------------------------------------------- sheets
const img = (path, w) =>
  `<img src="data:image/png;base64,${readFileSync(path).toString('base64')}" style="display:block;width:${w}px;height:auto;border:1px solid #1b2027">`;

const cap = (text) =>
  `<figcaption style="padding:6px 2px 0;font:10px/1.4 ui-monospace,monospace;color:#6d7681">${text}</figcaption>`;

async function render(html, width, path) {
  const p = await (await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })).newPage();
  await p.setContent(
    `<body style="margin:0;padding:22px;background:#07090d;color:#aeb7c1;font:12px/1.5 ui-monospace,monospace">${html}</body>`,
  );
  await p.screenshot({ path, fullPage: true });
  await p.context().close();
  console.log(`wrote ${path}`);
}

async function sheets() {
  const load = (tag) => JSON.parse(readFileSync(`${ROOT}/${tag}/manifest.json`, 'utf8'));

  // --- before / after -------------------------------------------------------
  //
  // THE "BEFORE" IS NOT RE-SHOT, AND IT MUST NOT BE. It is the previous phase's
  // OWN capture of the accepted long passage —
  // `continuity/after/journey/{15,16,17}-hu.png`, states named
  // `passage — seven checkpoints`, `passage body — a checkpoint` and
  // `passage body — the last checkpoint`, taken at 0.2, 1.9 and 4.6 screens into
  // a chapter that was 5.71 screens long.
  //
  // Reproducing it would mean reverting the working tree to photograph it, and
  // the tree carries accepted work from other passes that has not been committed
  // yet: the "before" would then be a picture of a page that never existed. The
  // accepted phase's own review asset is the honest one.
  {
    const BEFORE = '_build/reports/luxury-art-direction/continuity/after/journey';
    const before = [
      { path: `${BEFORE}/15-hu.png`, at: '0.2 screens in · the statement' },
      { path: `${BEFORE}/16-hu.png`, at: '1.9 screens in · one checkpoint' },
      { path: `${BEFORE}/17-hu.png`, at: '4.6 screens in · the last checkpoint' },
    ].filter((f) => existsSync(f.path));
    const after = load('after').desktop;
    const pick = [
      { s: after[0], at: '0.0 screens in · the statement' },
      { s: after[2], at: '1.1 screens in · the three principles and the route' },
      { s: after[3], at: '1.23 screens in · the foot of the chapter' },
    ].filter((f) => f.s && existsSync(f.s.path));

    const row = (cards, label) =>
      `<div style="margin-bottom:26px"><b style="color:#e7ecf1">${label}</b>
       <div style="display:flex;gap:12px;margin-top:8px">` +
      cards.map((c) => `<figure style="margin:0">${img(c.path ?? c.s.path, 400)}${cap(c.at)}</figure>`).join('') +
      `</div></div>`;

    if (before.length) {
      await render(
        `<h1 style="font:600 15px/1.4 ui-monospace,monospace;color:#e7ecf1;margin:0 0 18px">
           The process passage, before and after — 1440 × 900, Hungarian
         </h1>` +
        row(before, 'BEFORE · seven checkpoints, twenty-eight sentences · 5.71 screens · 87 nodes · 19.1% of the journey') +
        row(pick, 'AFTER · seven names, three principles, one route · 2.23 screens · 22 nodes · 8.5% of the journey') +
        `<p style="color:#6d7681;font:10px/1.6 ui-monospace,monospace;margin:6px 0 0;max-width:1240px">
           The BEFORE row is the previous phase's own capture of the accepted passage
           (continuity/after/journey/15–17), not a re-shoot: reverting the tree to
           photograph it would have pictured a page that never shipped.
         </p>`,
        3 * 414 + 60,
        `${ROOT}/process-before-after.png`,
      );
    } else {
      console.log('no accepted before frames — skipping process-before-after.png');
    }
  }

  const after = load('after');

  // --- the phone sequence ---------------------------------------------------
  await render(
    `<h1 style="font:600 15px/1.4 ui-monospace,monospace;color:#e7ecf1;margin:0 0 18px">
       The compressed process at 390 × 844, in order</h1>
     <div style="display:flex;gap:12px">` +
    after.mobile.map((s) => `<figure style="margin:0">${img(s.path, 230)}${cap(`${s.clamped} screens in`)}</figure>`).join('') +
    `</div>`,
    after.mobile.length * 244 + 60,
    `${ROOT}/process-mobile.png`,
  );

  // --- the three locales ----------------------------------------------------
  await render(
    `<h1 style="font:600 15px/1.4 ui-monospace,monospace;color:#e7ecf1;margin:0 0 18px">
       HU · EN · DE — the statement frame and the three principles</h1>
     <div style="display:grid;grid-template-columns:repeat(2,420px);gap:16px">` +
    after.locales.map((s) => `<figure style="margin:0">${img(s.path, 420)}${cap(`${s.locale.toUpperCase()} · ${s.name}`)}</figure>`).join('') +
    `</div>`,
    2 * 436 + 60,
    `${ROOT}/process-locales.png`,
  );
}

if (has('sheets')) await sheets();
else await capture();

await browser.close();
