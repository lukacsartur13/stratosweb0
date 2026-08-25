/**
 * THE TEMPORAL SCAN — §5's journey map, measured off the shipped page.
 *
 * ## Why this is a scroll-domain measurement and not a stopwatch
 *
 * Every state on this homepage is a function of scroll position. There is no
 * authored timeline: the altitude, the atmosphere, the instrument's recede and
 * every statement's opacity are read off `journey.current`, which is the
 * damped scroll progress. So the honest unit for "how long does this state
 * last" is SCREENS OF SCROLL, not seconds — a state that occupies 1.4 screens
 * lasts 1.4 screens for every visitor, while the seconds it takes are theirs
 * to choose.
 *
 * Seconds still matter, because §28 asks whether a defect survives a range of
 * realistic paces. They are derived at the end, at three nominal velocities,
 * rather than measured once at whichever speed an automated scroll happened to
 * use. A defect that is a defect at all three is a design defect; one that
 * only appears at the slowest is a pace, not a fault.
 *
 * The one genuinely time-domain thing on the page is the damper
 * (`JOURNEY_SMOOTHING`) and the handful of CSS transitions. Those are measured
 * separately by `motion.mjs`, in the moving frame, where they are visible.
 *
 * Usage:
 *   python3 -m http.server 4322 --directory dist
 *   node _build/reports/luxury-art-direction/temporal/scan.mjs \
 *     --width 1440 --height 900 --steps 600 --tag desktop-before
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const W = Number(arg('width', 1440));
const H = Number(arg('height', 900));
const STEPS = Number(arg('steps', 600));
const TAG = arg('tag', `${W}x${H}`);
const LOCALE = arg('locale', 'hu');
const REDUCED = process.argv.includes('--reduced');
const OUT = arg('out', '_build/reports/luxury-art-direction/temporal');
const BASE = arg('base', 'http://localhost:4322');
const URL = LOCALE === 'hu' ? `${BASE}/index.html` : `${BASE}/${LOCALE}/index.html`;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  reducedMotion: REDUCED ? 'reduce' : 'no-preference',
  hasTouch: W < 768,
  isMobile: W < 768,
});
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(
  () => getComputedStyle(document.documentElement).getPropertyValue('--instrument').trim() !== '',
  { timeout: 60_000 },
).catch(() => {});
await page.waitForTimeout(2500);

const track = await page.evaluate(() => {
  const t = document.querySelector('[data-testid="journey-track"]');
  if (!t) return null;
  return { top: t.offsetTop, height: t.offsetHeight, doc: document.documentElement.scrollHeight };
});

/**
 * The per-sample probe.
 *
 * Everything it returns is a fact about the rendered frame — a rect, a
 * computed opacity, a custom property the page itself publishes. Nothing is
 * read back out of the source constants, because the whole question this phase
 * asks is whether the constants produce what they claim to.
 */
const PROBE = () => {
  const effective = (el) => {
    let o = 1;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const v = parseFloat(cs.opacity);
      if (Number.isFinite(v)) o *= v;
      if (cs.visibility === 'hidden' || cs.display === 'none') return 0;
      if (o < 0.004) return 0;
    }
    return o;
  };
  const vh = innerHeight, vw = innerWidth;
  const onScreen = (r) => r.bottom > 0 && r.top < vh && r.width > 2 && r.height > 2;

  // --- the statements, by name -------------------------------------------
  // One row per authored display object on the page, whether or not it is on
  // screen right now. Tracking them by identity across the whole scan is what
  // makes arrival / hold / departure measurable rather than inferred.
  const statements = {};
  for (const el of document.querySelectorAll('.act__monument, .passage__statement')) {
    const panel = el.closest('.panel');
    const id = `${panel?.dataset.stage ?? '?'}:${el.classList.contains('act__monument') ? 'monument' : 'statement'}`;
    const r = el.getBoundingClientRect();
    const o = onScreen(r) ? effective(el) : 0;
    statements[id] = {
      o: +o.toFixed(3),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      size: Math.round(parseFloat(getComputedStyle(el).fontSize)),
      on: onScreen(r) ? 1 : 0,
    };
  }

  // --- the supports -------------------------------------------------------
  const supports = {};
  for (const el of document.querySelectorAll('.passage__support, .act__editorial, .act__lead, .act__routes, .act__micro')) {
    const panel = el.closest('.panel');
    if (!panel) continue;
    const key = panel.dataset.stage;
    const r = el.getBoundingClientRect();
    const o = onScreen(r) ? effective(el) : 0;
    if (!supports[key] || o > supports[key].o) supports[key] = { o: +o.toFixed(3) };
  }

  // --- ink, and the biggest legible thing ---------------------------------
  const all = [...document.querySelectorAll('.panel :is(p, h1, h2, h3, h4, li, dt, dd, figcaption, a, span)')]
    .filter((el) => (el.textContent || '').trim().length > 1);
  const leaves = all.filter((el) => !all.some((o) => o !== el && el.contains(o)));
  let ink = 0, biggest = 0, biggestText = '', legibleDisplay = [];
  for (const el of leaves) {
    const r = el.getBoundingClientRect();
    if (!onScreen(r)) continue;
    const o = effective(el);
    if (o < 0.14) continue;
    const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    ink += r.width * visible * o;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size > biggest) { biggest = size; biggestText = (el.textContent || '').trim().slice(0, 44); }
    if (size >= 40) legibleDisplay.push({ t: (el.textContent || '').trim().slice(0, 28), s: Math.round(size), o: +o.toFixed(2) });
  }

  // --- which panels are on screen, and is their frame pinned --------------
  const panels = [];
  for (const p of document.querySelectorAll('.panel')) {
    const pr = p.getBoundingClientRect();
    if (pr.bottom < 0 || pr.top > vh) continue;
    const field = p.querySelector('.act__field, .passage__field');
    const fr = field ? field.getBoundingClientRect() : null;
    // The ramp variables the panel itself publishes. Reading them back is the
    // only way to check that the authored arrival and departure are the ones
    // the page performs: `--act-hold`, `--screens` and `--pass` are three
    // separate measurements and the ramp is a function of all three, so a hold
    // that is correct in `acts.ts` can still produce a window that is not.
    const ps = getComputedStyle(p);
    const num = (n) => { const v = parseFloat(ps.getPropertyValue(n)); return Number.isFinite(v) ? +v.toFixed(4) : null; };
    panels.push({
      stage: p.dataset.stage,
      level: p.dataset.level,
      panelTop: Math.round(pr.top),
      panelH: Math.round(pr.height),
      fieldTop: fr ? Math.round(fr.top) : null,
      fieldO: field ? +effective(field).toFixed(3) : null,
      pass: num('--pass'), screens: num('--screens'), actHold: num('--act-hold'),
      actIn: num('--act-in'), actOut: num('--act-out'), presence: num('--act-presence'),
    });
  }

  // --- the instrument -----------------------------------------------------
  const cs = getComputedStyle(document.documentElement);
  const canvas = document.querySelector('.stage canvas, canvas');
  const cr = canvas ? canvas.getBoundingClientRect() : null;

  // --- the header CTA (§27) ----------------------------------------------
  const headerCta = document.querySelector('.site-header a[data-cta], .site-header .btn, header a.btn');
  const hc = headerCta ? getComputedStyle(headerCta) : null;

  return {
    metres: Math.round(Number(cs.getPropertyValue('--alt')) * 30000),
    instrument: +(Number(cs.getPropertyValue('--instrument')) || 0).toFixed(3),
    stage: (document.querySelector('[data-testid="altitude-stage"]')?.textContent ?? '').trim(),
    ink: Math.round(ink),
    inkFrac: +(ink / (vw * vh)).toFixed(5),
    biggest: Math.round(biggest),
    biggestText,
    legibleDisplay,
    statements,
    supports,
    panels,
    canvasOn: !!cr,
    headerCtaBg: hc ? hc.backgroundColor : null,
    headerCtaColor: hc ? hc.color : null,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

const samples = [];
const scrollable = track ? track.height - H : (await page.evaluate(() => document.documentElement.scrollHeight - innerHeight));
const base = track ? track.top : 0;

for (let i = 0; i <= STEPS; i++) {
  const y = base + (scrollable * i) / STEPS;
  await page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), y);
  // Long enough for the damper to land (see SETTLE_EPSILON) and for one CSS
  // transition to complete, so this measures the SETTLED state at each scroll
  // position. The moving state is `motion.mjs`'s job, deliberately kept apart.
  await page.waitForTimeout(70);
  const s = await page.evaluate(PROBE);
  samples.push({ i, p: +(i / STEPS).toFixed(5), y: Math.round(y), screens: +((y - base) / H).toFixed(4), ...s });
}

const meta = {
  tag: TAG, width: W, height: H, steps: STEPS, locale: LOCALE, reduced: REDUCED,
  track, scrollable, screensTotal: +(scrollable / H).toFixed(3),
  url: URL,
};
writeFileSync(`${OUT}/scan-${TAG}.json`, JSON.stringify({ meta, samples }, null, 1));
console.log(`scan-${TAG}.json — ${samples.length} samples over ${meta.screensTotal} screens`);
await browser.close();
