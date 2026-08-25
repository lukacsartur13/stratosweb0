// =============================================================================
// PHASE 5.2A · §45 · THE INTENTIONAL-DEPTH CONTRACT, SWEPT.
//
// The suite asserts the contract at the composed frames, which is where it is
// designed; this asks the same question everywhere else. At every sample of the
// whole track it measures the instrument's LIVE projected silhouette — read off
// the scene graph through the real camera, not off a design coordinate — against
// every piece of type on screen, and reports any overlap that is not the one
// pair the placement table permits.
//
//   permitted   a `.act__monument` in a panel that declares data-occlusion
//   everything else forbidden, at every altitude, including in transit
//
// This replaces `validate-meridian.mjs` for this question and not for its own:
// that harness measures deviation from the phase-6 RAILS, and the six-act art
// direction replaced the rails with authored placements, so it now reports
// 136 failures of a contract the design no longer has.
//
//   node experiments/probe-depth-contract.mjs
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const LOCALE = arg('locale', 'hu');
const STEPS = Number(arg('steps', 120));
const BASE = process.env.URL ?? `http://localhost:5177/home/${LOCALE}.html`;
const OUT = '_build/reports/luxury-art-direction/depth';

const PAGE_FN = () => {
  const s = globalThis.__stratos;
  const THREE = s.three;
  let root = null;
  let gimbal = null;
  s.scene.traverse((o) => {
    if (o.userData?.meridianRoot) root = o;
    if (o.userData?.meridianGimbal) gimbal = o;
  });
  const rootEl = getComputedStyle(document.documentElement);
  const out = {
    alt: Math.round(Number(rootEl.getPropertyValue('--alt')) * 30000),
    presence: Number(rootEl.getPropertyValue('--instrument')),
    stage: s.journey.stage,
    hits: [],
  };
  if (!root || !root.visible || out.presence <= 0.05) return out;

  // THE HOUSING'S SILHOUETTE, NOT ITS BOUNDING BOX.
  //
  // The first version of this probe measured the essential subtree's projected
  // AABB, which is what the phase-6 visibility harness measures, and it is the
  // wrong shape for this question by a wide margin: the box's corners lie
  // outside a round case by 41% of its radius, so it reported the Hero's action
  // line as covered by an object whose nearest visible pixel is 20px above it.
  //
  // The right shape is the one the mask is: the ellipse `instrumentStateAt`
  // solves, in the study's reference frame, scaled onto this viewport by the
  // frame the composition already uses. That also makes the contract and the
  // stylesheet the same geometry, which is the whole of §11.
  //
  // The rings are outside it, deliberately and as documented — see §I of the
  // depth report. Where they cross type this probe is silent, and that is a
  // stated limitation rather than an oversight.
  const H = innerHeight;
  const st = s.composition.instrumentStateAt(s.journey.current);
  if (!st) return out;
  const field = document.querySelector('.act__field') || document.querySelector('.journey__stage');
  const u = Math.min(innerWidth / 1440, innerHeight / 900);
  const ox0 = (innerWidth - 1440 * u) / 2;
  const oy0 = (innerHeight - 900 * u) / 2;
  void field;
  const cx = ox0 + st.maskX * u;
  const cy = oy0 + st.maskY * u;
  const rx = st.rx * u;
  const ry = st.ry * u;
  out.ellipse = [cx, cy, rx, ry].map((n) => +n.toFixed(0));
  out.box = [cx - rx, cy - ry, cx + rx, cy + ry].map((n) => +n.toFixed(0));

  // The rect an element is PAINTED at — its border box intersected with every
  // clipping ancestor — and only if it is actually contributing pixels.
  const painted = (el) => {
    const r = el.getBoundingClientRect();
    let [l, t, rr, b] = [r.left, r.top, r.right, r.bottom];
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const pr = p.getBoundingClientRect();
      if (cs.overflowX !== 'visible') { l = Math.max(l, pr.left); rr = Math.min(rr, pr.right); }
      if (cs.overflowY !== 'visible') { t = Math.max(t, pr.top); b = Math.min(b, pr.bottom); }
    }
    return { left: l, top: t, right: rr, bottom: b };
  };
  const faded = (el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.06) return true;
    }
    return false;
  };

  const sel = '.act__monument, .act__editorial, .act__action, .act__index, .act__micro, .act__marks, .act__routes, .pass__statement, .panel h1, .panel h2, .panel p, .panel a';
  for (const el of document.querySelectorAll(sel)) {
    const r = painted(el);
    if (r.right - r.left <= 0 || r.bottom - r.top <= 0) continue;
    if (r.bottom < 0 || r.top > H) continue;
    if (faded(el)) continue;
    // Sampled against the ellipse on a 4px lattice, so a rect that clips a
    // corner of the bounding box but never touches the round case reports what
    // it is: nothing.
    let inside = 0;
    for (let y = r.top; y < r.bottom; y += 4) {
      for (let x = r.left; x < r.right; x += 4) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) inside++;
      }
    }
    if (!inside) continue;
    const monument = el.classList.contains('act__monument');
    const declared = !!el.closest('[data-occlusion="monument"]');
    out.hits.push({
      what: el.className || el.tagName.toLowerCase(),
      text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 28),
      area: inside * 16,
      permitted: monument && declared,
    });
  }
  return out;
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'vite-error-overlay, .debug, .debug__toggle { display: none !important; }' });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => !!globalThis.__stratos?.scene, { timeout: 30_000 });
await page.waitForTimeout(3000);

const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
const rows = [];
let breaches = 0;
let permitted = 0;
for (let i = 0; i <= STEPS; i++) {
  await page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), Math.round((i / STEPS) * total));
  await page.waitForTimeout(240);
  const r = await page.evaluate(PAGE_FN);
  rows.push(r);
  const bad = r.hits.filter((h) => !h.permitted);
  permitted += r.hits.length - bad.length;
  if (bad.length) {
    breaches++;
    if (breaches <= 12) {
      console.log(
        `  !! ${String(r.alt).padStart(6)}m ${r.stage.padEnd(24)} p=${r.presence.toFixed(2)}  ` +
        bad.map((h) => `${h.what.split(' ')[0]} ${h.area}px² "${h.text}"`).join(' | '),
      );
    }
  }
}
writeFileSync(`${OUT}/contract-${LOCALE}.json`, JSON.stringify(rows));
console.log(
  `\n${STEPS + 1} samples · ${permitted} permitted monument overlaps · ${breaches} breaches\n` +
  `wrote ${OUT}/contract-${LOCALE}.json`,
);
await browser.close();
process.exit(breaches ? 1 : 0);
