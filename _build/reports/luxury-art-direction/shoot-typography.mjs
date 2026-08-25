/**
 * Phase 1.5 — photographs the nine typography frames and the four sheets.
 *
 * Before it shoots anything it MEASURES the page, because a study whose
 * frames silently overflow is worse than no study: every element in every
 * frame is checked against the 104px margin and against every other element
 * in the same frame, and the run fails loudly rather than producing nine
 * pretty pictures with a collision in one of them. (§10, §23)
 */
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

const here = fileURLToPath(new URL('.', import.meta.url));
const OUT = `${here}typography/`;
mkdirSync(OUT, { recursive: true });
const FRAMES = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3'];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(`${here}typography.html`).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);

/* ---------------------------------------------------------------- MEASURE */
const audit = await page.evaluate((ids) => {
  const M = 104, W = 1440, H = 900;
  const report = {};
  for (const id of ids) {
    const frame = document.getElementById(id);
    const fb = frame.getBoundingClientRect();
    const rel = (r) => ({ l: Math.round(r.left - fb.left), t: Math.round(r.top - fb.top), r: Math.round(r.right - fb.left), b: Math.round(r.bottom - fb.top) });
    /* One box per composed object. A monument and the two spans inside it are
       ONE object, not three — collapsing them is what makes the overlap test
       below mean "two things collide" rather than "a box contains its own
       text". Groups (.areas, .areas-col) collapse the same way. */
    const nodes = [...frame.querySelectorAll('.monument,.premise,.body,.editorial,.whisper,.micro,.stamp,.action,.areas,.areas-col,.areas-rule,.wordmark')]
      .filter(e => !e.parentElement.closest('.monument,.action,.areas,.areas-col'))
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const items = nodes.map(e => ({ sel: (e.className || e.tagName).toString().trim(), ...rel(e.getBoundingClientRect()) }));

    const problems = [];
    for (const it of items) {
      if (it.l < M - 1) problems.push(`${it.sel} breaks the left margin (${it.l} < ${M})`);
      if (it.r > W - M + 1) problems.push(`${it.sel} breaks the right margin (${it.r} > ${W - M})`);
      if (it.t < 0 || it.b > H) problems.push(`${it.sel} leaves the frame vertically (${it.t}…${it.b})`);
    }
    /* Authored breaks only. Every monument line is measured as TEXT — a
       Range, not the block box, because a block-level span fills its column
       and its box width says nothing about whether the type fits. A line
       wider than the 1232px measure has been re-broken by the browser or has
       run out of the frame; either way the art direction no longer holds. */
    for (const line of frame.querySelectorAll('.monument span, .premise span')) {
      const rg = document.createRange(); rg.selectNodeContents(line);
      const tw = Math.round(rg.getBoundingClientRect().width);
      if (tw > W - 2 * M) problems.push(`"${line.textContent}" sets ${tw}px against a ${W - 2 * M}px measure (+${tw - (W - 2 * M)})`);
      if (line.getClientRects().length > 1) problems.push(`"${line.textContent}" was re-broken by the browser into ${line.getClientRects().length} lines`);
    }
    /* pairwise overlap between text objects — the failure the eye forgives
       least and the screenshot hides best */
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (ox > 2 && oy > 2) problems.push(`${a.sel} ⨯ ${b.sel} overlap by ${ox}×${oy}px`);
    }

    /* HUNGARIAN ACCENT CLEARANCE, measured as PAINTED INK, COLUMN BY COLUMN.
       
       A bounding-box test — deepest descender of line n against tallest
       accent of line n+1 — is the wrong test, and it is the one that made an
       earlier pass of this study report the hero pair as almost touching. It
       is wrong because it compares the two extremes wherever they occur:
       in "Magasságot" over "építünk." the descenders are the two g's, at the
       middle of the line, and the tallest accent below is the é at the very
       start. They are nowhere near each other horizontally and cannot
       collide.
       
       So both lines are rasterised at the frame's real font-size, width axis,
       tracking and leading, and the gap is taken PER PIXEL COLUMN: for every
       x where both lines have ink, the distance from the lowest ink of line n
       to the highest ink of line n+1. The reported figure is the minimum
       across the columns that actually share an x — which is the number a
       typesetter would look for. (§10, §23) */
    const mon = frame.querySelector('.monument');
    let clearance = null;
    if (mon) {
      const cs = getComputedStyle(mon);
      const lines = [...mon.querySelectorAll('span')].map(s2 => s2.textContent);
      const px = parseFloat(cs.fontSize);
      const lh = parseFloat(cs.lineHeight);
      const W2 = 3000, H2 = Math.ceil(px * 3);
      const ink = (text) => {
        const cv = document.createElement('canvas');
        cv.width = W2; cv.height = H2;
        const x = cv.getContext('2d');
        x.clearRect(0, 0, W2, H2);
        /* Every axis of the real setting is reproduced on the context: the
           weight, the width axis (fontStretch is a context PROPERTY — it is
           only invalid inside the font shorthand string), the tracking, and
           the size. */
        x.font = `${cs.fontStyle} ${cs.fontWeight} ${px}px 'Archivo'`;
        x.fontStretch = cs.fontStretch;
        x.letterSpacing = cs.letterSpacing;
        x.textBaseline = 'alphabetic';
        x.fillStyle = '#fff';
        x.fillText(text, 10, px * 1.5);           // baseline at px*1.5
        const d = x.getImageData(0, 0, W2, H2).data;
        const top = new Int32Array(W2).fill(-1), bot = new Int32Array(W2).fill(-1);
        for (let yy = 0; yy < H2; yy++) {
          const row = yy * W2 * 4;
          for (let xx = 0; xx < W2; xx++) {
            if (d[row + xx * 4 + 3] > 40) { if (top[xx] < 0) top[xx] = yy; bot[xx] = yy; }
          }
        }
        return { top, bot, baseline: px * 1.5, fontOk: /Archivo/.test(x.font) };
      };
      const pairs = [];
      for (let i = 0; i + 1 < lines.length; i++) {
        const A = ink(lines[i]), B = ink(lines[i + 1]);
        if (!A.fontOk) problems.push('clearance probe could not set the font — measurement not trustworthy');
        let min = Infinity, atX = null, cols = 0;
        for (let xx = 0; xx < W2; xx++) {
          if (A.bot[xx] < 0 || B.top[xx] < 0) continue;   // no shared ink column
          cols++;
          /* line n+1's baseline sits `lh` below line n's */
          const gap = (B.top[xx] - B.baseline + lh) - (A.bot[xx] - A.baseline);
          if (gap < min) { min = gap; atX = xx - 10; }
        }
        pairs.push({
          above: lines[i], below: lines[i + 1],
          sharedColumns: cols,
          minGapPx: cols ? Math.round(min * 10) / 10 : null,
          minGapEm: cols ? Math.round((min / px) * 1000) / 1000 : null,
          atX: atX,
        });
      }
      clearance = { fontSizePx: px, lineHeightEm: Math.round((lh / px) * 1000) / 1000, stretch: cs.fontStretch, tracking: cs.letterSpacing, pairs };
      for (const pr of pairs) {
        if (pr.minGapPx !== null && pr.minGapPx < 0) problems.push(`ACCENT COLLISION "${pr.above}" / "${pr.below}" — ink overlaps by ${-pr.minGapPx}px at x=${pr.atX}`);
        else if (pr.minGapEm !== null && pr.minGapEm < 0.04) problems.push(`accents nearly touch in "${pr.above}" / "${pr.below}" — ${pr.minGapPx}px (${pr.minGapEm}em) at x=${pr.atX}`);
      }
    }

    /* Ink coverage — the squint test, as a number. Share of the frame's area
       taken by the bounding boxes of type. (§27) */
    const ink = items.reduce((s, it) => s + Math.max(0, it.r - it.l) * Math.max(0, it.b - it.t), 0);
    report[id] = { problems, clearance, occupied: Math.round((ink / (W * H)) * 1000) / 10, objects: items.length, items };
  }
  return report;
}, FRAMES);

writeFileSync(`${OUT}measurements.json`, JSON.stringify(audit, null, 2));
let failed = false;
for (const [id, r] of Object.entries(audit)) {
  const tag = r.problems.length ? 'FAIL' : ' ok ';
  if (r.problems.length) failed = true;
  console.log(`[${tag}] ${id}  objects ${String(r.objects).padStart(2)}  ink ${String(r.occupied).padStart(4)}%`);
  r.problems.forEach(p => console.log(`         · ${p}`));
}

/* ------------------------------------------------------------------ SHOOT */
if (!failed || process.argv.includes('--force')) {
  for (const id of FRAMES) {
    await page.locator(`#${id}`).screenshot({ path: `${OUT}${id}.png` });
  }
  console.log('nine frames shot →', OUT);
} else {
  console.log('\nnot shooting: fix the frames above, or re-run with --force to inspect.');
}
await browser.close();
process.exit(failed && !process.argv.includes('--force') ? 1 : 0);
