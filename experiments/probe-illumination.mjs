// =============================================================================
// PHASE 5.2 · §37 · THE ILLUMINATION PROOF SHEET.
//
// One monument at five positions of the light front, so the effect can be
// judged as a sequence rather than inferred from a single frame. The front is
// pinned rather than scrolled to: `--read` is one number, and pinning it is the
// only way to photograph the same composition at five states without also
// moving the frame, the atmosphere and the instrument between shots.
//
// It also MEASURES each state — the ink's own luminance against the field it
// sits on — because §14 asks for values to be visually derived and §19 asks for
// the active state to reach proper readable contrast. Both are numbers.
//
//   node experiments/probe-illumination.mjs --stage stratosphere-transition
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { luminance } from './png-luma.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const STAGE = arg('stage', 'calibration');
const LOCALE = arg('locale', 'hu');
const TAG = arg('tag', 'after');
const BASE = process.env.URL ?? `http://localhost:5177/home/${LOCALE}.html`;
const OUT = '_build/reports/luxury-art-direction/depth';

const STATES = [0, 0.25, 0.5, 0.75, 1];

mkdirSync(`${OUT}/${TAG}`, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'vite-error-overlay, .debug, .debug__toggle { display: none !important; }' });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => !!globalThis.__stratos, { timeout: 30_000 });
await page.waitForTimeout(2500);

// Settle on the act's own hold, where the frame is composed and still.
await page.evaluate((s) => {
  const el = document.querySelector(`.panel[data-stage="${s}"]`);
  scrollTo({ top: el.offsetTop + 0.4 * innerHeight, behavior: 'instant' });
}, STAGE);
await page.waitForTimeout(2400);

// EVERY LINE'S OWN RECT, not the block's.
//
// A peak measurement over the whole statement saturates the moment the front's
// leading edge is inside the block — at `--read` 0.5 the top fifth is already
// at full ink, so the 98th percentile reads 244 and the sheet reports the
// effect as finished when half of it has not happened. What the front actually
// does is only visible PER LINE, which is also the quantity §15 is about: the
// statement's lines activate in reading order, and this is what says whether
// they do.
const lines = await page.evaluate(() => {
  const vis = [...document.querySelectorAll('.act__monument, .passage__statement')]
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.top < innerHeight && r.bottom > 0 && r.width > 0)
    .sort((a, b) => b.r.width - a.r.width)[0];
  if (!vis) return [];
  return [...vis.e.querySelectorAll('span')].map((s, i) => {
    const r = s.getBoundingClientRect();
    return {
      i,
      text: (s.textContent ?? '').trim().slice(0, 18),
      x: r.x / innerWidth, y: r.y / innerHeight, w: r.width / innerWidth, h: r.height / innerHeight,
    };
  });
});

const measured = [];
for (const read of STATES) {
  // Pin the front. `!important` on the panel, so it beats the ramp without
  // touching it — the ramp is what ships and this sheet must not edit it.
  await page.addStyleTag({ content: `.panel--act, .panel--passage { --read: ${read} !important; }` });
  await page.waitForTimeout(260);
  const path = `${OUT}/${TAG}/illum-${STAGE}-${String(read).replace('.', '')}-${LOCALE}.png`;
  await page.screenshot({ path });

  const { lum, width, height } = luminance(path);
  const band = (rect) => {
    const vals = [];
    for (let y = Math.round(rect.y * height); y < Math.round((rect.y + rect.h) * height); y++)
      for (let x = Math.round(rect.x * width); x < Math.round((rect.x + rect.w) * width); x++)
        vals.push(lum[y * width + x]);
    vals.sort((a, b) => a - b);
    const q = (p) => vals[Math.min(vals.length - 1, Math.round(p * (vals.length - 1)))];
    // Light ink on a dark field, so the INK is the bright tail and the FIELD
    // the dark one — the inverse of the reference film, which is black on light.
    const ink = q(0.98), field = q(0.05);
    return { ink: Math.round(ink), field: Math.round(field), contrast: +((ink - field) / 255).toFixed(3) };
  };
  const perLine = lines.map((l) => ({ line: l.text, ...band(l) }));
  measured.push({ read, lines: perLine, path });
  console.log(
    `read ${String(read).padEnd(5)} ` +
    perLine.map((l) => `${l.line}: ${l.contrast.toFixed(3)}`).join('   '),
  );
}

writeFileSync(`${OUT}/${TAG}/illum-${STAGE}-${LOCALE}.json`, JSON.stringify(measured, null, 2));

// The sheet.
const sheet = await (await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 })).newPage();
const cell = (m) => `<figure style="margin:0">
  <img src="data:image/png;base64,${readFileSync(m.path).toString('base64')}" style="display:block;width:1400px;border:1px solid #1b2027">
  <figcaption style="margin:6px 0 22px;font:11px/1.5 ui-monospace,monospace;color:#6d7681">
    <b style="color:#e8e8e8">--read ${m.read}</b>${m.lines.map((l) => ` &nbsp;·&nbsp; <span style="color:#aeb7c1">${l.line}</span> ink ${l.ink}, contrast ${l.contrast}`).join('')}
  </figcaption></figure>`;
await sheet.setContent(`<body style="margin:0;padding:24px;background:#07090d">
  <h1 style="font:13px/1.4 ui-monospace,monospace;color:#aeb7c1;margin:0 0 18px">
    PHASE 5.2 · §37 · ONE STATEMENT, FIVE POSITIONS OF THE LIGHT FRONT — ${STAGE} · ${LOCALE}
  </h1>${measured.map(cell).join('')}</body>`);
await sheet.screenshot({ path: `${OUT}/illumination-5-states.png`, fullPage: true });
console.log(`\nwrote ${OUT}/illumination-5-states.png`);
await browser.close();
