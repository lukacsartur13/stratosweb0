/**
 * THE SIX-ACT SCALE SOLVE.
 *
 * The two rules are Direction D's, unchanged, because §1 says D is the basis
 * and §12 says the solver verifies the art direction rather than authoring it:
 *
 *   RULE 1 · THE HUNGARIAN SIZE IS SET BY COLUMN FILL, NOT BY TASTE.
 *     Each act declares what fraction of the 1 200px field its longest
 *     Hungarian line should occupy. That single number is the art direction;
 *     the pixel value is arithmetic.
 *
 *   RULE 2 · EVERY OTHER LOCALE MATCHES ON INK AREA, NOT ON SIZE.
 *     K = (Σ line advances at 1px) × size², held constant per act. Match the
 *     size instead and German overflows; match the width and English goes
 *     small on a wide block.
 *
 * WHAT PHASE 2 ADDS: the WIDTH AXIS is now an input, per act, and every
 * measurement below is taken AT THAT WIDTH. This matters more than it sounds.
 * Under Rule 1 a narrower setting does not make the statement smaller — it
 * makes it BIGGER, because the fill is a promise about the line's width and a
 * narrower face reaches that width at a larger size. Width therefore buys
 * height at constant footprint, which is exactly the effect §9 hypothesises
 * for the high-altitude frame, and the width study measures whether the eye
 * agrees that it is worth having.
 *
 * ORDER OF OPERATIONS, per §12: the composition, the breaks, the fills and
 * the placements were authored first, in six-act.css and six-act.html. This
 * file resolves them into pixels and then shoot-six.mjs re-measures the
 * rendered frames and refuses to photograph one that fails.
 *
 * Output: six-act-scale.css (generated, committed, readable) and
 * six-act/scale.json (every measurement, including the rejected breaks).
 */
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fontsReady } from './fonts-ready.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(`${here}six-act/`, { recursive: true });

const FIELD = 1200;
const MAXLINE = 0.98;
const SIZE_CAP = 210;
const CLEARANCE = 0.12;

/* --------------------------------------------------------------- THE ACTS
   `fill` is the art direction. `foot` is the architectural line the LAST
   BASELINE lands on. `wdth` is the Archivo width axis, in percent, and the
   value it carries is the one §D of the report argues for.

   The fills are not a ramp. Act I is deliberately the smallest in the study
   and Act V deliberately the largest, which is §23 and §28 enforced by
   arithmetic rather than by intention: the hero's authority comes from the
   field around it and the high-altitude frame is allowed to be the loudest
   thing on the page. */
const ACTS = {
  a1:  { fill: 0.64, foot: 548, wdth: 100, note: 'ground — the smallest fill in the study' },
  /* The noise act's fill is the lowest in the study and it is NOT a decision
     about size. The fill rule is a promise about the LONGEST LINE, and this
     act's longest line is a six-character word, so a fill anywhere near the
     others hands it the largest point size on the page — 198px at 0.52, above
     even the high-altitude frame, which is precisely the ranking §28 forbids.
     0.44 puts it at 167px: the second-largest statement in the study, in a
     column half the width of any other. */
  a2:  { fill: 0.44, foot: 600, wdth: 100, note: 'noise — three lines, right-aligned, hung from the top' },
  a3:  { fill: 0.74, foot: 662, wdth: 100, note: 'system' },
  a4:  { fill: 0.52, foot: 440, wdth: 100, note: 'proof — the monument is a figure, not a sentence' },
  a5:  { fill: 0.88, foot: 748, wdth: 100, note: 'high altitude — the benchmark, unchanged from D3' },
  /* The arrival act's foot line is set by an accent. At 376 the Hungarian
     block's BOX clears the top margin and its Ü does not — the umlaut is the
     tallest ink in the study and it reached y = 116. The audit measures the
     ink rather than the box, which is why this was a failed run rather than a
     frame that shipped 4px out of its own frame. */
  a6:  { fill: 0.86, foot: 386, wdth: 100, note: 'arrival — centred' },
  a6b: { fill: 0.66, foot: 548, wdth: 100, note: 'the action beat — not one of the six' },
};

/* ------------------------------------------------------- THE BREAK STUDIES
   Every word is verbatim from experiments/src/full/locales/messages.ts and
   content.ts, in all three languages. `chosen` is a decision; the
   alternatives are solved beside it so the report can print what was given up
   rather than assert that the right one was taken. */
const BREAKS = {
  /* calibration.title.em / .b — Direction D's hero, unchanged. */
  a1: {
    hu: { chosen: ['Magasságot', 'építünk.'], alts: { 'one line': ['Magasságot építünk.'] } },
    en: { chosen: ['Altitude is', 'what we build.'],
          alts: { 'messages.ts split': ['Altitude', 'is what we build.'] } },
    de: { chosen: ['Höhe', 'bauen wir.'], alts: { 'one line': ['Höhe bauen wir.'] } },
  },
  /* cloudEntry.title.a / .em. The three-line break is the act's whole idea:
     §18 asks for vertical tension and a different silhouette from the hero,
     and stacking a three-word sentence into a narrow right-hand column is the
     typographic version of the compression the act is about. The two-line
     break is measured beside it and is the one a cautious studio would pick. */
  a2: {
    hu: { chosen: ['Idelent', 'minden', 'zajos.'],
          alts: { 'two lines': ['Idelent', 'minden zajos.'], 'one line': ['Idelent minden zajos.'] } },
    en: { chosen: ['Down here', 'everything', 'is noisy.'],
          alts: { 'two lines': ['Down here', 'everything is noisy.'] } },
    de: { chosen: ['Hier unten', 'ist alles', 'laut.'],
          alts: { 'two lines': ['Hier unten', 'ist alles laut.'] } },
  },
  /* lowerAtmosphere.title.a / .em — Direction D's system frame, unchanged. */
  a3: {
    hu: { chosen: ['Hat terület,', 'egy rendszer.'], alts: { 'one line': ['Hat terület, egy rendszer.'] } },
    en: { chosen: ['Six areas,', 'one system.'], alts: { 'one line': ['Six areas, one system.'] } },
    de: { chosen: ['Sechs Bereiche,', 'ein System.'], alts: { 'one line': ['Sechs Bereiche, ein System.'] } },
  },
  /* content.ts WORK_HU[rapidkert].metric.value. The figure is NOT translated —
     it is the same seven glyphs in all three locales — so Act IV is the one
     act where Rule 2 has nothing to do and all three frames solve to the same
     size. That is a property of the content, not a failure of the rule. */
  a4: {
    hu: { chosen: ['~15M Ft'], alts: {} },
    en: { chosen: ['~15M Ft'], alts: {} },
    de: { chosen: ['~15M Ft'], alts: {} },
  },
  /* stratosphereTransition.title.a / .em — D3, the benchmark, unchanged. */
  a5: {
    hu: { chosen: ['Innen már látni', 'a görbületet.'], alts: { 'held breath': ['Innen már', 'látni a görbületet.'] } },
    en: { chosen: ['From here', 'you can see', 'the curvature.'],
          alts: { 'messages.ts split': ['From here you can', 'see the curvature.'] } },
    de: { chosen: ['Von hier aus ist', 'die Krümmung', 'zu sehen.'],
          alts: { 'two lines': ['Von hier aus ist die', 'Krümmung zu sehen.'] } },
  },
  /* fullStratosphere.title.a / .em. Hungarian's second line is a single
     seventeen-character word, which is why the arrival act's fill is the
     second-highest in the study and its solved size is nonetheless modest:
     the fill is a promise about the LINE, and one long word spends all of it. */
  a6: {
    hu: { chosen: ['Üdv a', 'sztratoszférában.'], alts: { 'one line': ['Üdv a sztratoszférában.'] } },
    en: { chosen: ['Welcome to the', 'stratosphere.'], alts: { 'one line': ['Welcome to the stratosphere.'] } },
    de: { chosen: ['Willkommen in der', 'Stratosphäre.'], alts: { 'one line': ['Willkommen in der Stratosphäre.'] } },
  },
  /* destination.title.a / .em. */
  a6b: {
    hu: { chosen: ['Készen állsz', 'felemelkedni?'], alts: { 'one line': ['Készen állsz felemelkedni?'] } },
    en: { chosen: ['Are you ready to', 'ascend?'], alts: { 'one line': ['Are you ready to ascend?'] } },
    de: { chosen: ['Sind Sie bereit', 'aufzusteigen?'], alts: { 'one line': ['Sind Sie bereit aufzusteigen?'] } },
  },
};

/* Rejected settings that get photographed rather than only tabulated. */
const RENDER_ALTS = [
  { id: 'y1', act: 'a2', loc: 'hu', alt: 'two lines' },
  { id: 'y2', act: 'a2', loc: 'de', alt: 'two lines' },
  { id: 'y3', act: 'a6', loc: 'hu', alt: 'one line' },
];

/* --------------------------------------------------- THE WIDTH-AXIS STUDY
   §48 asks for one concise proof sheet, for the MONUMENT ROLE ONLY, on three
   acts. Three states, and the outer two are deliberately close to neutral:
   §10 says the variation must be something a designer feels before a visitor
   identifies it, so 92% and 110% are not in the study — they are obviously
   condensed and obviously extended and testing them would answer a question
   nobody asked. Each is solved by the same two rules at the same fill, so the
   only thing that changes between the three frames of a row is the axis. */
const WIDTH_STATES = [96, 100, 104];
const WIDTH_ACTS = ['a1', 'a3', 'a5'];

/* --------------------------------------------------------------- MEASURE */
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(`${here}probe-six.html`).href, { waitUntil: 'networkidle' });
await fontsReady(page);

const measured = await page.evaluate(async ({ BREAKS, CLEARANCE, WIDTH_STATES, WIDTH_ACTS }) => {
  const host = document.getElementById('probe');

  /* Advance of one line at 1px of font-size, at the monument's real tracking
     and at the requested width axis. Measured with a Range over the text
     rather than the block box, because a block-level span fills its column
     and its box width says nothing about how wide the type sets. */
  const advance = (text, wdth, px = 200) => {
    host.innerHTML = '';
    const h = document.createElement('h1'); h.className = 'monument';
    h.style.cssText = `position:static;font-size:${px}px;line-height:1;font-stretch:${wdth}%;`;
    const s = document.createElement('span'); s.textContent = text;
    h.appendChild(s); host.appendChild(h);
    const rg = document.createRange(); rg.selectNodeContents(s);
    return rg.getBoundingClientRect().width / px;
  };

  /* PAINTED-INK CLEARANCE, PER PIXEL COLUMN. Returns D — the scale-invariant
     constant such that at leading L em the real gap between two lines is
     (L + D) em. Negative, always: how far the descenders of the upper line
     reach past the ascenders of the lower one, counted only at the x
     positions where both actually have ink. A bounding-box test would compare
     the deepest descender anywhere against the tallest accent anywhere and
     report collisions between glyphs 400px apart.

     A LIMIT WORTH RECORDING RATHER THAN HIDING. `CanvasRenderingContext2D`
     accepts only the CSS width KEYWORDS — it silently discards `96%` and
     leaves the context at `normal`, which is exactly the class of failure §J3
     of the previous study was written about. So this function takes a keyword,
     it asserts that the context kept it, and the three keywords it is called
     with are the three the platform can actually honour: semi-condensed
     (87.5%), normal (100%) and semi-expanded (112.5%).

     Everything the frames ship is therefore measured at `normal`, and the
     width study holds LEADING CONSTANT across its three states on purpose —
     which is the correct experiment anyway, because a row in which both the
     axis and the leading moved would not tell anyone which of the two did the
     work. The two flanking keywords are measured for the three study acts so
     the report can state how far D travels per point of width instead of
     assuming it does not travel at all. */
  const gapConstant = (above, below, kw = 'normal') => {
    const px = 200, W = 4200, H = px * 3;
    const ink = (text) => {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const x = cv.getContext('2d');
      x.clearRect(0, 0, W, H);
      x.font = `400 ${px}px 'Archivo'`;
      x.fontStretch = kw;
      x.letterSpacing = '-0.028em';
      if (!/-0\.028em/.test(String(x.letterSpacing))) throw new Error('canvas ignored letter-spacing — clearance would be measured on the wrong setting');
      if (String(x.fontStretch) !== kw) throw new Error(`canvas would not take font-stretch "${kw}" — it reports "${x.fontStretch}", so the width axis is not in the measurement`);
      x.textBaseline = 'alphabetic';
      x.fillStyle = '#fff';
      x.fillText(text, 10, px * 1.5);
      const d = x.getImageData(0, 0, W, H).data;
      const top = new Int32Array(W).fill(-1), bot = new Int32Array(W).fill(-1);
      for (let yy = 0; yy < H; yy++) {
        const row = yy * W * 4;
        for (let xx = 0; xx < W; xx++) {
          if (d[row + xx * 4 + 3] > 40) { if (top[xx] < 0) top[xx] = yy; bot[xx] = yy; }
        }
      }
      return { top, bot, baseline: px * 1.5, ok: /Archivo/.test(x.font) };
    };
    const A = ink(above), B = ink(below);
    let min = Infinity, atX = null, cols = 0;
    for (let xx = 0; xx < W; xx++) {
      if (A.bot[xx] < 0 || B.top[xx] < 0) continue;
      cols++;
      const g = (B.top[xx] - B.baseline) - (A.bot[xx] - A.baseline);
      if (g < min) { min = g; atX = xx - 10; }
    }
    return { D: cols ? min / px : null, sharedColumns: cols, atX, fontOk: A.ok && B.ok, keyword: kw };
  };

  /* Advances are measured at the REAL axis, per width state — the DOM honours
     `font-stretch: 96%` even where the canvas does not, and the advance is
     what every size in the study is solved from. Clearance is measured once,
     at `normal`, and the leading it produces is shared by every state of the
     same statement. */
  const study = (lines, wdth, clearanceAt = 'normal') => {
    const adv = lines.map(t => ({ text: t, advPerPx: advance(t, wdth) }));
    const pairs = [];
    if (clearanceAt) for (let i = 0; i + 1 < lines.length; i++) pairs.push({ above: lines[i], below: lines[i + 1], ...gapConstant(lines[i], lines[i + 1], clearanceAt) });
    const Ds = pairs.map(p => p.D).filter(v => v !== null);
    const D = Ds.length ? Math.min(...Ds) : null;
    return {
      text: lines, lines: adv, wdth,
      sumAdvPerPx: adv.reduce((s, a) => s + a.advPerPx, 0),
      maxAdvPerPx: Math.max(...adv.map(a => a.advPerPx)),
      pairs, gapConstantEm: D,
      minLeadingEm: D === null ? null : Math.ceil((CLEARANCE - D) * 100) / 100,
    };
  };

  /* Every act is measured at every width state, not only at the one it ships,
     so the width study and the frames come out of one measurement pass and
     cannot disagree with each other. */
  const out = {};
  for (const [act, locales] of Object.entries(BREAKS)) {
    out[act] = {};
    for (const [loc, spec] of Object.entries(locales)) {
      out[act][loc] = { chosenLines: spec.chosen, atWidth: {}, alts: {} };
      /* Clearance once, at 100; advances at every state. The leading that
         falls out of the 100 measurement is then carried across the row. */
      const base = study(spec.chosen, 100);
      for (const w of WIDTH_STATES) {
        out[act][loc].atWidth[w] = w === 100 ? base
          : { ...study(spec.chosen, w, null), pairs: base.pairs, gapConstantEm: base.gapConstantEm, minLeadingEm: base.minLeadingEm, clearanceMeasuredAt: 100 };
      }
      for (const [name, lines] of Object.entries(spec.alts)) {
        const ab = study(lines, 100);
        out[act][loc].alts[name] = { lines, atWidth: Object.fromEntries(WIDTH_STATES.map(w => [w, w === 100 ? ab
          : { ...study(lines, w, null), pairs: ab.pairs, gapConstantEm: ab.gapConstantEm, minLeadingEm: ab.minLeadingEm, clearanceMeasuredAt: 100 }])) };
      }
    }
  }

  /* HOW FAR THE CLEARANCE CONSTANT ACTUALLY TRAVELS WITH THE AXIS. Measured
     for the three width-study acts in Hungarian at the two flanking keywords
     the platform will honour, so §D can state a bound rather than assume one. */
  const widthDrift = {};
  for (const act of WIDTH_ACTS) {
    const lines = BREAKS[act].hu.chosen;
    if (lines.length < 2) continue;
    widthDrift[act] = {};
    for (const kw of ['semi-condensed', 'normal', 'semi-expanded']) {
      const ds = [];
      for (let i = 0; i + 1 < lines.length; i++) ds.push(gapConstant(lines[i], lines[i + 1], kw).D);
      widthDrift[act][kw] = Math.round(Math.min(...ds) * 1000) / 1000;
    }
  }

  /* The instrument's real ink, so "reduce its projected size" is a number
     rather than an adjective. The render is 2 400 × 2 400 with the dial
     floating inside it; what the eye reads as "the altimeter" is the drawn
     circle, not the transparent box around it. */
  const dial = await new Promise((res) => {
    const img = new Image();
    const give = (why) => res({ error: why });
    setTimeout(() => give('timed out'), 5000);
    img.onerror = () => give('the instrument render did not load');
    img.onload = () => {
     try {
      const N = 600, cv = document.createElement('canvas'); cv.width = N; cv.height = N;
      const x = cv.getContext('2d'); x.drawImage(img, 0, 0, N, N);
      const d = x.getImageData(0, 0, N, N).data;
      let l = N, r = -1, t = N, b = -1;
      for (let yy = 0; yy < N; yy++) for (let xx = 0; xx < N; xx++) {
        if (d[(yy * N + xx) * 4 + 3] > 24) { if (xx < l) l = xx; if (xx > r) r = xx; if (yy < t) t = yy; if (yy > b) b = yy; }
      }
      res({ source: `${img.naturalWidth}×${img.naturalHeight}`,
            inkFractionOfBox: { l: l / N, t: t / N, r: r / N, b: b / N },
            inkWidthFraction: (r - l) / N, inkHeightFraction: (b - t) / N });
     } catch (e) { give(`canvas refused the local render: ${e.message}`); }
    };
    img.src = 'assets/lux-hero.png';
  });

  return { measured: out, dial, widthDrift };
}, { BREAKS, CLEARANCE, WIDTH_STATES, WIDTH_ACTS });

/* ----------------------------------------------------------------- SOLVE */
const solveOne = (m, K, leadFloor = 0.94) => {
  const ideal = Math.sqrt(K / m.sumAdvPerPx);
  const byLine = (MAXLINE * FIELD) / m.maxAdvPerPx;
  const size = Math.round(Math.min(ideal, byLine, SIZE_CAP));
  const leading = Math.max(leadFloor, m.minLeadingEm ?? leadFloor);
  return {
    idealSize: Math.round(ideal * 10) / 10, size,
    clampedBy: ideal <= Math.min(byLine, SIZE_CAP) ? 'none' : (byLine < SIZE_CAP ? 'column' : 'cap'),
    leading: Math.round(leading * 100) / 100,
    gapConstantEm: m.gapConstantEm === null ? null : Math.round(m.gapConstantEm * 1000) / 1000,
    clearanceEm: m.gapConstantEm === null ? null : Math.round((leading + m.gapConstantEm) * 1000) / 1000,
    lineWidthsPx: m.lines.map(l => Math.round(l.advPerPx * size)),
    longestLinePx: Math.round(m.maxAdvPerPx * size),
    fillOfField: Math.round((m.maxAdvPerPx * size / FIELD) * 1000) / 10,
    areaIndex: Math.round(m.sumAdvPerPx * size * size),
  };
};

const solved = {};
for (const [act, cfg] of Object.entries(ACTS)) {
  const hu = measured.measured[act].hu.atWidth[cfg.wdth];
  /* Rule 1. K is taken from the size Hungarian ACTUALLY got, never from the
     size it asked for: if the reference is clamped and K is not, every other
     locale is solved against a target the reference itself does not meet. */
  const huSize = Math.round(Math.min((cfg.fill * FIELD) / hu.maxAdvPerPx, (MAXLINE * FIELD) / hu.maxAdvPerPx, SIZE_CAP));
  const K = hu.sumAdvPerPx * huSize * huSize;
  solved[act] = { ...cfg, huSize, K: Math.round(K), locales: {} };
  for (const loc of ['hu', 'en', 'de']) {
    solved[act].locales[loc] = {
      lines: measured.measured[act][loc].chosenLines,
      ...solveOne(measured.measured[act][loc].atWidth[cfg.wdth], K),
      areaVsHungarian: null,
    };
  }
  const huArea = solved[act].locales.hu.areaIndex;
  for (const loc of ['hu', 'en', 'de']) solved[act].locales[loc].areaVsHungarian = Math.round((solved[act].locales[loc].areaIndex / huArea) * 1000) / 10;
}

/* The rejected settings, solved by the same two rules at the same width, so
   what changes between a chosen frame and its alternative is the break. */
const alts = {};
for (const a of RENDER_ALTS) {
  const cfg = ACTS[a.act], m = measured.measured[a.act][a.loc].alts[a.alt].atWidth[cfg.wdth];
  const s = solveOne(m, solved[a.act].K);
  alts[a.id] = { ...a, foot: cfg.foot, wdth: cfg.wdth, lines: m.text, ...s,
    areaVsChosen: Math.round((s.areaIndex / solved[a.act].locales[a.loc].areaIndex) * 1000) / 10 };
}

/* ------------------------------------------------------- THE WIDTH STUDY
   Hungarian only, three acts, three states. The fill and the foot are the
   act's own, so the ONLY variable in a row is the axis. Two numbers matter:
   what the fill rule does to the size when the face narrows, and what happens
   to the ink area — i.e. whether a narrower setting is more present or merely
   taller. */
const widths = {};
for (const act of WIDTH_ACTS) {
  const cfg = ACTS[act];
  widths[act] = { fill: cfg.fill, foot: cfg.foot, ships: cfg.wdth, states: {} };
  for (const w of WIDTH_STATES) {
    const m = measured.measured[act].hu.atWidth[w];
    const size = Math.round(Math.min((cfg.fill * FIELD) / m.maxAdvPerPx, (MAXLINE * FIELD) / m.maxAdvPerPx, SIZE_CAP));
    /* LEADING IS HELD AT THE ACT'S OWN VALUE across all three states, so the
       single variable in a row is the axis. */
    const leading = solved[act].locales.hu.leading;
    widths[act].states[w] = {
      lines: m.text, size, leading: Math.round(leading * 100) / 100,
      longestLinePx: Math.round(m.maxAdvPerPx * size),
      fillOfField: Math.round((m.maxAdvPerPx * size / FIELD) * 1000) / 10,
      capHeightProxy: size, areaIndex: Math.round(m.sumAdvPerPx * size * size),
      /* The same statement at the act's SHIPPED size rather than at the fill —
         the other half of the comparison: what the axis costs in width when
         the height is held instead. */
      atFixedSize: { size: solved[act].locales.hu.size,
        longestLinePx: Math.round(m.maxAdvPerPx * solved[act].locales.hu.size) },
    };
  }
  const base = widths[act].states[100].areaIndex;
  for (const w of WIDTH_STATES) widths[act].states[w].areaVs100 = Math.round((widths[act].states[w].areaIndex / base) * 1000) / 10;
}

/* ---------------------------------------------- BASELINE-ANCHORED PLACEMENT
   The solved `top` is measured, not computed from font metrics: the monument
   is rendered at its solved size, leading and width, the zero-size
   inline-block on the last line reports where the last baseline actually
   landed, and `top` is the offset that puts it on the act's foot line. */
const plan = {
  ...Object.fromEntries(Object.entries(solved).flatMap(([act, s]) =>
    Object.entries(s.locales).map(([loc, l]) => [`${act}-${loc}`, { size: l.size, leading: l.leading, wdth: s.wdth, lines: l.lines }]))),
  ...Object.fromEntries(Object.entries(alts).map(([id, a]) => [id, { size: a.size, leading: a.leading, wdth: a.wdth, lines: a.lines }])),
  ...Object.fromEntries(Object.entries(widths).flatMap(([act, w]) => WIDTH_STATES.map(s =>
    [`w-${act}-${s}`, { size: w.states[s].size, leading: w.states[s].leading, wdth: s, lines: w.states[s].lines }]))),
};
const tops = await page.evaluate(async (plan) => {
  const host = document.getElementById('probe');
  const out = {};
  for (const [key, s] of Object.entries(plan)) {
    host.innerHTML = '';
    const h = document.createElement('h1'); h.className = 'monument';
    h.style.cssText = `position:absolute;left:0;top:0;font-size:${s.size}px;line-height:${s.leading};font-stretch:${s.wdth}%;`;
    s.lines.forEach((t, i) => {
      const sp = document.createElement('span'); sp.textContent = t;
      if (i === s.lines.length - 1) sp.appendChild(document.createElement('i'));
      h.appendChild(sp);
    });
    host.appendChild(h);
    const hb = host.getBoundingClientRect();
    out[key] = {
      lastBaselineFromTop: Math.round((h.querySelector('i').getBoundingClientRect().bottom - hb.top) * 10) / 10,
      blockHeight: Math.round(h.getBoundingClientRect().height),
    };
  }
  return out;
}, Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v])));

for (const [act, s] of Object.entries(solved))
  for (const [loc, l] of Object.entries(s.locales)) {
    l.blockHeightPx = tops[`${act}-${loc}`].blockHeight;
    l.top = Math.round(s.foot - tops[`${act}-${loc}`].lastBaselineFromTop);
  }
for (const [id, a] of Object.entries(alts)) { a.blockHeightPx = tops[id].blockHeight; a.top = Math.round(a.foot - tops[id].lastBaselineFromTop); }
for (const [act, w] of Object.entries(widths))
  for (const s of WIDTH_STATES) w.states[s].top = Math.round(w.foot - tops[`w-${act}-${s}`].lastBaselineFromTop);

await browser.close();

/* -------------------------------------------------------------------- EMIT
   Selectors are CLASSES, not ids, because every act is photographed twice —
   monochrome and colour — and two frames that are the same typography must be
   unable to drift apart. */
const pad = (v, n) => String(v).padStart(n);
let css = `/* ==========================================================================
   GENERATED BY solve-six.mjs — DO NOT EDIT BY HAND.
   Re-run:  node _build/reports/luxury-art-direction/solve-six.mjs

   Every number below was solved from a measurement of real glyphs at the
   act's own width axis, not chosen. The two rules that produced them are at
   the top of solve-six.mjs; the audit trail is six-act/scale.json.

     size     equal-ink-area across locales, clamped at ${Math.round(MAXLINE * 100)}% of the
              ${FIELD}px field per line and at ${SIZE_CAP}px overall
     leading  the measured ink floor for THIS statement in THIS language at
              THIS width, plus ${CLEARANCE}em of clearance
     stretch  the act's width axis — the art direction, not a solve
     top      whatever puts the LAST BASELINE on the act's foot line
   ========================================================================== */\n\n`;

for (const [act, s] of Object.entries(solved)) {
  css += `/* --- ${act.toUpperCase()} · ${s.note} · foot baseline y = ${s.foot} · wdth ${s.wdth}% · Hungarian fill ${s.fill} --- */\n`;
  for (const [loc, l] of Object.entries(s.locales)) {
    css += `.s-${act}-${loc} .monument{font-size:${pad(l.size, 3)}px;line-height:${l.leading};font-stretch:${s.wdth}%;top:${pad(l.top, 3)}px;}`
        +  `  /* ${l.lines.length} line${l.lines.length > 1 ? 's' : ''} · longest ${l.longestLinePx}px (${l.fillOfField}% of field) · clearance ${l.clearanceEm === null ? 'n/a' : l.clearanceEm + 'em'} · presence ${l.areaVsHungarian}% of HU */\n`;
  }
  css += '\n';
}
css += `/* --- THE REJECTED BREAKS, solved by the same rules at the same width so
       the sheet compares like with like. Rendered by breaks-six.html only. --- */\n`;
for (const [id, a] of Object.entries(alts)) {
  css += `.s-${id} .monument{font-size:${pad(a.size, 3)}px;line-height:${a.leading};font-stretch:${a.wdth}%;top:${pad(a.top, 3)}px;}`
      +  `  /* ${a.act} ${a.loc} "${a.alt}" · longest ${a.longestLinePx}px (${a.fillOfField}%) · presence ${a.areaVsChosen}% of the chosen break */\n`;
}
css += `\n/* --- THE WIDTH-AXIS STUDY. Hungarian, three acts, three states, one fill
       per row: the ONLY variable in a row is the axis. --- */\n`;
for (const [act, w] of Object.entries(widths))
  for (const s of WIDTH_STATES)
    css += `.s-w-${act}-${s} .monument{font-size:${pad(w.states[s].size, 3)}px;line-height:${w.states[s].leading};font-stretch:${s}%;top:${pad(w.states[s].top, 3)}px;}`
        +  `  /* longest ${w.states[s].longestLinePx}px (${w.states[s].fillOfField}%) · presence ${w.states[s].areaVs100}% of wdth 100 */\n`;

writeFileSync(`${here}six-act-scale.css`, css);
writeFileSync(`${here}six-act/scale.json`, JSON.stringify({ rules: { FIELD, MAXLINE, SIZE_CAP, CLEARANCE }, acts: ACTS, solved, alts, widths, widthDrift: measured.widthDrift, dial: measured.dial }, null, 2));

/* ------------------------------------------------------------------ REPORT */
console.log('\nDIAL — the instrument plate, as ink rather than as a box');
if (measured.dial.error) console.log(`  not measured: ${measured.dial.error}`);
else console.log(`  source ${measured.dial.source}, drawn circle occupies ${(measured.dial.inkWidthFraction * 100).toFixed(1)}% of its width · ink box l ${(measured.dial.inkFractionOfBox.l * 100).toFixed(1)}% t ${(measured.dial.inkFractionOfBox.t * 100).toFixed(1)}% r ${(measured.dial.inkFractionOfBox.r * 100).toFixed(1)}% b ${(measured.dial.inkFractionOfBox.b * 100).toFixed(1)}%`);

for (const [act, s] of Object.entries(solved)) {
  console.log(`\n${act.toUpperCase()}  fill ${s.fill} → HU ${s.huSize}px   wdth ${s.wdth}%   foot y=${s.foot}   (${s.note})`);
  console.log('  loc  size  ideal  clamp   lead  clear  longest   fill%  presence  top   lines');
  for (const [loc, l] of Object.entries(s.locales))
    console.log(`  ${loc}   ${pad(l.size, 4)}  ${pad(l.idealSize, 5)}  ${pad(l.clampedBy, 6)}  ${l.leading.toFixed(2)}  ${l.clearanceEm === null ? ' n/a' : l.clearanceEm.toFixed(2)}  ${pad(l.longestLinePx, 5)}px  ${pad(l.fillOfField, 5)}  ${pad(l.areaVsHungarian, 7)}%  ${pad(l.top, 4)}  ${l.lines.join(' / ')}`);
  for (const loc of ['hu', 'en', 'de'])
    for (const [name, a] of Object.entries(measured.measured[act][loc].alts)) {
      const m = a.atWidth[s.wdth], r = solveOne(m, s.K);
      console.log(`    rejected ${loc} "${name}" → ${pad(r.size, 3)}px  longest ${pad(r.longestLinePx, 4)}px (${pad(r.fillOfField, 5)}%)  presence ${pad(Math.round((r.areaIndex / s.locales[loc].areaIndex) * 1000) / 10, 5)}%   ${m.text.join(' / ')}`);
    }
}

console.log('\nWIDTH AXIS — Hungarian, same fill, same foot; only the axis moves');
for (const [act, w] of Object.entries(widths)) {
  console.log(`  ${act}  fill ${w.fill}   (ships at ${w.ships}%)`);
  for (const s of WIDTH_STATES) {
    const st = w.states[s];
    console.log(`    wdth ${pad(s, 3)}%  size ${pad(st.size, 3)}px  longest ${pad(st.longestLinePx, 4)}px (${pad(st.fillOfField, 5)}%)  presence ${pad(st.areaVs100, 5)}% of 100  ·  at a FIXED ${st.atFixedSize.size}px it would set ${st.atFixedSize.longestLinePx}px`);
  }
}
console.log('\nwrote six-act-scale.css and six-act/scale.json');
