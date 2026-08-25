/**
 * DIRECTION D — THE SCALE SOLVE.
 *
 * §18 forbids defining luxury as `font-size: 168px`, and the previous study
 * proved why: a fixed monument size is a promise the system cannot keep in
 * three languages. §19 requires locale-aware typography and §20 requires a
 * principled solution rather than a reduction of everything to the German
 * worst case.
 *
 * This file is that solution, and it is two rules and nothing else.
 *
 *   RULE 1 · THE HUNGARIAN SIZE IS SET BY COLUMN FILL, NOT BY TASTE.
 *     Each scene declares what fraction of the 1 200px type field its longest
 *     Hungarian line should occupy. Hero 0.64, system 0.74, high altitude
 *     0.98. That single number is the art direction; the pixel value that
 *     comes out of it is arithmetic. It is also why the hero is NOT the
 *     largest frame in the direction (§23): its fill is deliberately the
 *     smallest, and its authority comes from the empty field around it.
 *
 *   RULE 2 · EVERY OTHER LOCALE MATCHES ON INK AREA, NOT ON SIZE.
 *     A statement's presence in a frame is roughly its total ink run — the
 *     sum of its line widths — times its size. Both terms move when a
 *     language changes, and matching only ONE of them fails in a way you can
 *     see: match the size and German overflows, match the width and English
 *     goes visibly small while getting wider. So D holds the PRODUCT
 *     constant:
 *
 *         K = (Σ line advances at 1px) × size²        [constant per scene]
 *
 *     English, with a longer statement, solves to a smaller size on a wider
 *     block. German, with a shorter hero, solves to a larger one on a
 *     narrower block. Same perceived weight, different geometry — which is
 *     the sentence §20 ends on.
 *
 *   Two clamps, both hard: no line may exceed 0.98 of the field, and no
 *   monument may exceed 185px. Where a clamp binds, the solve says so in the
 *   output rather than quietly shipping a compromise.
 *
 * LEADING is solved here too, and it is NOT one token (§21). The gap between
 * two lines, measured in ems, is `leading + D` where D is a constant of the
 * two strings — it does not move with size. So D is measured once per
 * statement per locale, as PAINTED INK, COLUMN BY COLUMN, and the leading
 * that buys 0.10em of real clearance falls out of it. A bounding-box test
 * would compare the deepest descender anywhere against the tallest accent
 * anywhere and report collisions between glyphs that are 400px apart.
 *
 * Output: direction-d-scale.css (generated, committed, human-readable) and
 * direction-d/scale.json (everything measured, including the rejected breaks).
 */
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fontsReady } from './fonts-ready.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(`${here}direction-d/`, { recursive: true });

const FIELD = 1200;          // the type field, x = 120 … 1320
const MAXLINE = 0.98;        // no monument line may exceed this fraction of it
const SIZE_CAP = 210;        // and none may exceed this, in any locale
const CLEARANCE = 0.12;      // em of real ink between monument lines

/* --------------------------------------------------------------- THE SCENES
   `fill` is the art direction. `foot` is the architectural line the LAST
   BASELINE of the monument lands on — monuments grow upward from it, so a
   137px German block and a 157px Hungarian one share a foot and the
   composition does not move when the language does. */
const SCENES = {
  d1: { fill: 0.64, foot: 548 },
  d2: { fill: 0.74, foot: 662 },
  d3: { fill: 0.88, foot: 748 },
};

/* ------------------------------------------------------- THE BREAK STUDIES
   §22: every statement is set several ways and chosen optically, not
   mechanically. `chosen` is a decision; the alternatives are measured
   alongside it so the report can print what was given up rather than assert
   that the right one was picked. Every word is verbatim from
   experiments/src/full/locales/messages.ts. */
const BREAKS = {
  d1: {
    hu: { chosen: ['Magasságot', 'építünk.'],
          alts: { 'one line': ['Magasságot építünk.'] } },
    /* English does NOT use the split that messages.ts already carries
       (`Altitude` / `is what we build.`). Both breaks solve to 145px and to
       the same presence, so the type is indifferent — but the composition is
       not: the messages.ts split puts a 921px line under the statement, which
       leaves 58px between the end of the monument and the start of the
       instrument and destroys the isolation D1 is built on. The even pair
       sets 807px and restores 172px of air. This is a break chosen on the
       frame rather than on the sentence, and it means D1 needs one authored
       English break added to the content layer. */
    en: { chosen: ['Altitude is', 'what we build.'],
          alts: { 'messages.ts split': ['Altitude', 'is what we build.'],
                  'one line':          ['Altitude is what we build.'] } },
    de: { chosen: ['Höhe', 'bauen wir.'],
          alts: { 'one line': ['Höhe bauen wir.'] } },
  },
  d2: {
    hu: { chosen: ['Hat terület,', 'egy rendszer.'],
          alts: { 'one line': ['Hat terület, egy rendszer.'] } },
    en: { chosen: ['Six areas,', 'one system.'],
          alts: { 'one line': ['Six areas, one system.'] } },
    de: { chosen: ['Sechs Bereiche,', 'ein System.'],
          alts: { 'one line': ['Sechs Bereiche, ein System.'] } },
  },
  d3: {
    hu: { chosen: ['Innen már látni', 'a görbületet.'],
          alts: { 'held breath': ['Innen már', 'látni a görbületet.'] } },
    /* English is the case where presence does NOT decide, and it is worth
       being exact about why the third line still wins. Both settings reach
       the same ink area: two lines solve to 150px at 100.1%, three to 151px
       at 100.2%. What separates them is where they stop. The two-line break
       runs to 96.9% of the field — the cramped right edge that D3 rejected
       in HUNGARIAN when the scene's fill came down from 0.96 to 0.88,
       because a statement that stops 37px short of the margin reads as
       constrained by the frame rather than placed in it. Rejecting it in one
       locale and accepting it in another would make that principle a
       preference. Three lines stop at 71.5% and the frame breathes.

       So the decision rule for every high-altitude break, in every language:
       take the setting with the most presence, and where two are within a
       point of each other, take the one that does not run to the edge. */
    en: { chosen: ['From here', 'you can see', 'the curvature.'],
          alts: { 'messages.ts split': ['From here you can', 'see the curvature.'],
                  'held breath':       ['From here', 'you can see the curvature.'],
                  'three, tapering':   ['From here you', 'can see the', 'curvature.'] } },
    /* German at high altitude is the binding case of the whole system. On two
       lines it is column-bound long before it is area-matched — the clamp
       fires and the statement gives up a quarter of its presence. The third
       line is not a concession, it is the locale's own geometry: it buys back
       the size, holds the ink area, and is the reason §20 asks for a
       principled solution instead of a global reduction. Both are measured. */
    de: { chosen: ['Von hier aus ist', 'die Krümmung', 'zu sehen.'],
          alts: { 'two lines':      ['Von hier aus ist die', 'Krümmung zu sehen.'],
                  'two, own break': ['Von hier aus', 'ist die Krümmung zu sehen.'] } },
  },
};

/* ------------------------------------------- THE ALTERNATIVES WORTH SEEING
   §22 asks for break studies rather than a break assertion. Most of the
   rejected settings above are rejected by a number that speaks for itself —
   a one-line monument at 99px is not a judgement call. These three are not:
   each one is a break a reasonable person would have chosen, and each is
   rejected for a reason that only becomes obvious in the frame. They are
   solved and positioned exactly like the nine, and photographed beside them.

   The report's §I argues each of these three. The sheet is the evidence. */
const RENDER_ALTS = [
  { id: 'x1', scene: 'd1', loc: 'en', alt: 'messages.ts split' },
  { id: 'x2', scene: 'd3', loc: 'hu', alt: 'held breath' },
  { id: 'x3', scene: 'd3', loc: 'de', alt: 'two lines' },
  { id: 'x4', scene: 'd3', loc: 'en', alt: 'messages.ts split' },
];

/* ------------------------------------------------------------------- MEASURE */
/* --allow-file-access-from-files: the dial measurement below draws a local
   PNG onto a canvas and reads it back, which a file:// page is otherwise not
   permitted to do. Nothing else in the run needs it. */
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(`${here}probe-d.html`).href, { waitUntil: 'networkidle' });
await fontsReady(page);

const measured = await page.evaluate(async ({ BREAKS, CLEARANCE }) => {
  const host = document.getElementById('probe');

  /* Advance of one line, at 1px of font-size, with the monument's real
     tracking and width axis applied. Measured with a Range over the text
     rather than the block box, because a block-level span fills its column
     and its box width says nothing about how wide the type sets. */
  const advance = (text, px = 200) => {
    host.innerHTML = '';
    const h = document.createElement('h1'); h.className = 'monument';
    h.style.cssText = `position:static;font-size:${px}px;line-height:1;`;
    const s = document.createElement('span'); s.textContent = text;
    h.appendChild(s); host.appendChild(h);
    const rg = document.createRange(); rg.selectNodeContents(s);
    return rg.getBoundingClientRect().width / px;
  };

  /* PAINTED-INK CLEARANCE, PER PIXEL COLUMN.
     Returns D — the scale-invariant constant such that, at leading L em, the
     real gap between two lines is (L + D) em. Negative, always: it is how
     far the descenders of the upper line reach past the ascenders of the
     lower one, counted only at the x positions where both actually have ink. */
  const gapConstant = (above, below) => {
    const px = 200, W = 6000, H = px * 3;
    const ink = (text) => {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const x = cv.getContext('2d');
      x.clearRect(0, 0, W, H);
      x.font = `400 ${px}px 'Archivo'`;
      x.fontStretch = '100%';
      x.letterSpacing = '-0.028em';
      /* If the context silently ignored the tracking, every clearance below
         would be measured on glyph positions the frames never use. Chromium
         reports the property back only when it took it. */
      if (!/-0\.028em/.test(String(x.letterSpacing))) throw new Error('canvas ignored letter-spacing — clearance would be measured on the wrong setting');
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
    return { D: cols ? min / px : null, sharedColumns: cols, atX, fontOk: A.ok && B.ok };
  };

  const study = (lines) => {
    const adv = lines.map(t => ({ text: t, advPerPx: advance(t) }));
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i++) pairs.push({ above: lines[i], below: lines[i + 1], ...gapConstant(lines[i], lines[i + 1]) });
    const Ds = pairs.map(p => p.D).filter(v => v !== null);
    const D = Ds.length ? Math.min(...Ds) : null;
    return {
      text: lines,
      lines: adv,
      sumAdvPerPx: adv.reduce((s, a) => s + a.advPerPx, 0),
      maxAdvPerPx: Math.max(...adv.map(a => a.advPerPx)),
      pairs,
      gapConstantEm: D,
      minLeadingEm: D === null ? null : Math.ceil((CLEARANCE - D) * 100) / 100,
    };
  };

  const out = {};
  for (const [scene, locales] of Object.entries(BREAKS)) {
    out[scene] = {};
    for (const [loc, spec] of Object.entries(locales)) {
      out[scene][loc] = { chosen: study(spec.chosen), chosenLines: spec.chosen, alts: {} };
      for (const [name, lines] of Object.entries(spec.alts)) out[scene][loc].alts[name] = { lines, ...study(lines) };
    }
  }

  /* The instrument's real ink, so §8's "reduce its projected size" can be a
     number rather than an adjective. The render is 2400 × 2400 with the dial
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
    img.src = 'assets/instrument-hero.png';
  });

  return { measured: out, dial };
}, { BREAKS, CLEARANCE });

/* --------------------------------------------------------------------- SOLVE */
const solved = {};
for (const [scene, cfg] of Object.entries(SCENES)) {
  const hu = measured.measured[scene].hu.chosen;
  /* Rule 1 — Hungarian is set by column fill, then clamped like everyone
     else. K is taken from the size Hungarian ACTUALLY got, never from the
     size it asked for: if the reference is clamped and K is not, every other
     locale is solved against a target the reference itself does not meet,
     and they all come out too large. */
  const huSize = Math.round(Math.min((cfg.fill * FIELD) / hu.maxAdvPerPx, (MAXLINE * FIELD) / hu.maxAdvPerPx, SIZE_CAP));
  /* Rule 2 — K is the invariant every other locale is solved against. */
  const K = hu.sumAdvPerPx * huSize * huSize;
  solved[scene] = { fill: cfg.fill, foot: cfg.foot, huSize, K: Math.round(K), locales: {} };

  for (const loc of ['hu', 'en', 'de']) {
    const m = measured.measured[scene][loc].chosen;
    const ideal = Math.sqrt(K / m.sumAdvPerPx);
    const byLine = (MAXLINE * FIELD) / m.maxAdvPerPx;
    const size = Math.round(Math.min(ideal, byLine, SIZE_CAP));
    const clamp = ideal <= Math.min(byLine, SIZE_CAP) ? 'none' : (byLine < SIZE_CAP ? 'column' : 'cap');
    const leading = Math.max(0.94, m.minLeadingEm ?? 0.94);
    solved[scene].locales[loc] = {
      lines: measured.measured[scene][loc].chosenLines,
      idealSize: Math.round(ideal * 10) / 10,
      size, clampedBy: clamp,
      leading: Math.round(leading * 100) / 100,
      gapConstantEm: m.gapConstantEm === null ? null : Math.round(m.gapConstantEm * 1000) / 1000,
      clearanceEm: m.gapConstantEm === null ? null : Math.round((leading + m.gapConstantEm) * 1000) / 1000,
      lineWidthsPx: m.lines.map(l => Math.round(l.advPerPx * size)),
      longestLinePx: Math.round(m.maxAdvPerPx * size),
      fillOfField: Math.round((m.maxAdvPerPx * size / FIELD) * 1000) / 10,
      inkRunPx: Math.round(m.sumAdvPerPx * size),
      areaIndex: Math.round(m.sumAdvPerPx * size * size),
      areaVsHungarian: null,
    };
  }
  const huArea = solved[scene].locales.hu.areaIndex;
  for (const loc of ['hu', 'en', 'de']) {
    solved[scene].locales[loc].areaVsHungarian = Math.round((solved[scene].locales[loc].areaIndex / huArea) * 1000) / 10;
  }
}

/* The three rejected settings are solved by the same two rules, so the sheet
   compares like with like: what changes between a chosen frame and its
   alternative is the break and nothing else. */
const alts = {};
for (const a of RENDER_ALTS) {
  const cfg = SCENES[a.scene], m = measured.measured[a.scene][a.loc].alts[a.alt];
  const K = solved[a.scene].K;
  const ideal = Math.sqrt(K / m.sumAdvPerPx);
  const byLine = (MAXLINE * FIELD) / m.maxAdvPerPx;
  const size = Math.round(Math.min(ideal, byLine, SIZE_CAP));
  const leading = Math.max(0.94, m.minLeadingEm ?? 0.94);
  alts[a.id] = {
    ...a, foot: cfg.foot, lines: m.text, size, leading: Math.round(leading * 100) / 100,
    clampedBy: ideal <= Math.min(byLine, SIZE_CAP) ? 'none' : (byLine < SIZE_CAP ? 'column' : 'cap'),
    longestLinePx: Math.round(m.maxAdvPerPx * size),
    lineWidthsPx: m.lines.map(l => Math.round(l.advPerPx * size)),
    fillOfField: Math.round((m.maxAdvPerPx * size / FIELD) * 1000) / 10,
    areaVsChosen: Math.round((m.sumAdvPerPx * size * size / solved[a.scene].locales[a.loc].areaIndex) * 1000) / 10,
  };
}

/* ---------------------------------------------- BASELINE-ANCHORED PLACEMENT
   The solved `top` is not arithmetic on font metrics — it is measured. The
   monument is rendered at its solved size and leading, the zero-size
   inline-block on the last line reports where the last baseline actually
   landed, and `top` is the offset that puts it on the scene's foot line.
   Whatever Archivo's ascent happens to be, the foot lines up. */
const tops = await page.evaluate(async (plan) => {
  const host = document.getElementById('probe');
  const out = {};
  for (const [key, s] of Object.entries(plan)) {
    host.innerHTML = '';
    const h = document.createElement('h1'); h.className = 'monument';
    h.style.cssText = `position:absolute;left:0;top:0;font-size:${s.size}px;line-height:${s.leading};`;
    s.lines.forEach((t, i) => {
      const sp = document.createElement('span'); sp.textContent = t;
      if (i === s.lines.length - 1) { const b = document.createElement('i'); sp.appendChild(b); }
      h.appendChild(sp);
    });
    host.appendChild(h);
    const hb = host.getBoundingClientRect();
    const bl = h.querySelector('i').getBoundingClientRect();
    const box = h.getBoundingClientRect();
    out[key] = {
      lastBaselineFromTop: Math.round((bl.bottom - hb.top) * 10) / 10,
      blockHeight: Math.round(box.height),
    };
  }
  return out;
}, {
  ...Object.fromEntries(Object.entries(solved).flatMap(([scene, s]) =>
    Object.entries(s.locales).map(([loc, l]) => [`${scene}-${loc}`, { size: l.size, leading: l.leading, lines: l.lines }]))),
  ...Object.fromEntries(Object.entries(alts).map(([id, a]) => [id, { size: a.size, leading: a.leading, lines: a.lines }])),
});

for (const [scene, s] of Object.entries(solved)) {
  for (const [loc, l] of Object.entries(s.locales)) {
    const t = tops[`${scene}-${loc}`];
    l.blockHeightPx = t.blockHeight;
    l.top = Math.round(s.foot - t.lastBaselineFromTop);
  }
}
for (const [id, a] of Object.entries(alts)) {
  a.blockHeightPx = tops[id].blockHeight;
  a.top = Math.round(a.foot - tops[id].lastBaselineFromTop);
}

await browser.close();

/* -------------------------------------------------------------------- EMIT */
const pad = (v, n) => String(v).padStart(n);
let css = `/* ==========================================================================
   GENERATED BY solve-d.mjs — DO NOT EDIT BY HAND.
   Re-run:  node _build/reports/luxury-art-direction/solve-d.mjs

   Every number below was solved from a measurement of real glyphs, not
   chosen. The two rules that produced them are documented at the top of
   solve-d.mjs; the audit trail is direction-d/scale.json.

     size     equal-ink-area across locales, clamped at ${Math.round(MAXLINE * 100)}% of the
              ${FIELD}px field per line and at ${SIZE_CAP}px overall
     leading  the measured ink floor for THIS statement in THIS language,
              plus ${CLEARANCE}em of clearance
     top      whatever puts the LAST BASELINE on the scene's foot line
   ========================================================================== */\n\n`;

for (const [scene, s] of Object.entries(solved)) {
  css += `/* --- ${scene.toUpperCase()} · foot baseline y = ${s.foot} · Hungarian fill ${s.fill} of the 1 200px field --- */\n`;
  for (const [loc, l] of Object.entries(s.locales)) {
    css += `#${scene}-${loc} .monument{font-size:${pad(l.size, 3)}px;line-height:${l.leading};top:${pad(l.top, 3)}px;}`
        +  `  /* ${l.lines.length} lines · longest ${l.longestLinePx}px (${l.fillOfField}% of field) · clearance ${l.clearanceEm}em · presence ${l.areaVsHungarian}% of HU */\n`;
  }
  css += '\n';
}
css += `/* --- THE THREE REJECTED BREAKS, solved by the same two rules so the sheet
       compares like with like. Rendered by breaks-d.html only. --- */\n`;
for (const [id, a] of Object.entries(alts)) {
  css += `#${id} .monument{font-size:${pad(a.size, 3)}px;line-height:${a.leading};top:${pad(a.top, 3)}px;}`
      +  `  /* ${a.scene} ${a.loc} "${a.alt}" · longest ${a.longestLinePx}px (${a.fillOfField}%) · presence ${a.areaVsChosen}% of the chosen break */\n`;
}
writeFileSync(`${here}direction-d-scale.css`, css);
writeFileSync(`${here}direction-d/scale.json`, JSON.stringify({ rules: { FIELD, MAXLINE, SIZE_CAP, CLEARANCE }, scenes: SCENES, solved, alts, measured: measured.measured, dial: measured.dial }, null, 2));

/* ------------------------------------------------------------------ REPORT */
console.log('\nDIAL — the instrument render, as ink rather than as a box');
if (measured.dial.error) console.log(`  not measured: ${measured.dial.error}`);
else {
  console.log(`  source ${measured.dial.source}, drawn circle occupies ${(measured.dial.inkWidthFraction * 100).toFixed(1)}% of its width`);
  console.log(`  ink box within the source: l ${(measured.dial.inkFractionOfBox.l * 100).toFixed(1)}%  t ${(measured.dial.inkFractionOfBox.t * 100).toFixed(1)}%  r ${(measured.dial.inkFractionOfBox.r * 100).toFixed(1)}%  b ${(measured.dial.inkFractionOfBox.b * 100).toFixed(1)}%`);
}

for (const [scene, s] of Object.entries(solved)) {
  console.log(`\n${scene.toUpperCase()}  fill ${s.fill} → Hungarian ${s.huSize}px   foot y=${s.foot}`);
  console.log('  loc  size  ideal  clamp   lead  clear   longest  fill%   presence  top   lines');
  for (const [loc, l] of Object.entries(s.locales)) {
    console.log(`  ${loc}   ${pad(l.size, 4)}  ${pad(l.idealSize, 5)}  ${pad(l.clampedBy, 6)}  ${l.leading.toFixed(2)}  ${l.clearanceEm === null ? '  n/a' : l.clearanceEm.toFixed(2)}   ${pad(l.longestLinePx, 5)}px  ${pad(l.fillOfField, 5)}  ${pad(l.areaVsHungarian, 7)}%  ${pad(l.top, 4)}  ${l.lines.join(' / ')}`);
  }
  console.log('  rejected breaks:');
  for (const loc of ['hu', 'en', 'de']) {
    for (const [name, a] of Object.entries(measured.measured[scene][loc].alts)) {
      const ideal = Math.sqrt(s.K / a.sumAdvPerPx);
      const byLine = (MAXLINE * FIELD) / a.maxAdvPerPx;
      const size = Math.round(Math.min(ideal, byLine, SIZE_CAP));
      console.log(`    ${loc} "${name}"  → ${pad(size, 3)}px  longest ${pad(Math.round(a.maxAdvPerPx * size), 4)}px  presence ${pad(Math.round((a.sumAdvPerPx * size * size / s.locales.hu.areaIndex) * 1000) / 10, 5)}%   ${a.text.join(' / ')}`);
    }
  }
}
console.log('\nTHE THREE REJECTED BREAKS THAT GET PHOTOGRAPHED');
for (const [id, a] of Object.entries(alts)) {
  console.log(`  ${id}  ${a.scene}-${a.loc} "${a.alt}"  ${a.size}px  longest ${a.longestLinePx}px (${a.fillOfField}%)  presence ${a.areaVsChosen}% of chosen  top ${a.top}`);
  console.log(`      ${a.lines.join(' / ')}`);
}
console.log('\nwrote direction-d-scale.css and direction-d/scale.json');
