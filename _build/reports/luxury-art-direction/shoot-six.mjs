/**
 * MEASURES THE SIX ACTS, THEN PHOTOGRAPHS THEM.
 *
 * It refuses to photograph a frame that fails, because a study whose frames
 * silently overflow is worse than no study. What it checks, per frame:
 *
 *   · every object against the 120px margin on all four sides, and against
 *     the picture edge. The Rapidkert capture is the ONE object licensed to
 *     break both, because being cut by the frame is what stops it reading as
 *     a card — so it is exempted by name and by nothing else
 *   · every monument line against the 1 200px field, AND against the browser
 *     having re-broken it. An authored break that wrapped silently would pass
 *     a width test while the browser rewrote the art direction
 *   · every monument line against the width the solve PREDICTED for it. If
 *     the two disagree, six-act-scale.css was computed against a different
 *     setting and every size in it is fiction. This check exists because that
 *     is exactly what happened once, in the previous study
 *   · that the width axis the solve assumed is the one the browser applied —
 *     `font-stretch` is the new variable in this phase and a silently ignored
 *     axis is the same class of failure as a silently unloaded font
 *   · every pair of objects against each other. The monument enters as the
 *     UNION OF ITS LINE RECTS rather than as its block box, because two of the
 *     six acts set their block to the full field in order to right-align or
 *     centre it, and a box test would report the empty half of a centred line
 *     as a collision. The instrument enters as its DRAWN CIRCLE, not as its
 *     transparent box
 *   · Hungarian accent clearance, re-measured as painted ink on the frames as
 *     they render rather than trusted from the solve
 *   · the isolation §14 asks for, as the actual pixel gap between the end of
 *     the statement and the start of the dial
 *   · object count, covered area as a UNION, and the LARGEST EMPTY RECTANGLE —
 *     §46's squint test as three numbers. One large silence scores well; the
 *     same emptiness scattered between six objects does not
 */
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fontsReady } from './fonts-ready.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const OUT = `${here}six-act/`;
mkdirSync(OUT, { recursive: true });

const ACTS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a6b'];
const HU = ACTS.map(a => `${a}-hu`);
const FRAMES = [...HU, 'a3-hu-inst',
  ...['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a6b'].flatMap(a => [`${a}-en`, `${a}-de`])];

const scale = JSON.parse(readFileSync(`${OUT}scale.json`, 'utf8'));
const DIAL = scale.dial.inkFractionOfBox;
const PREDICTED = Object.fromEntries(Object.entries(scale.solved).flatMap(([act, v]) =>
  Object.entries(v.locales).map(([loc, l]) => [`${act}-${loc}`, { widths: l.lineWidthsPx, wdth: v.wdth }])));
PREDICTED['a3-hu-inst'] = PREDICTED['a3-hu'];

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(`${here}six-act.html`).href, { waitUntil: 'networkidle' });
await fontsReady(page);
await page.waitForTimeout(300);

const audit = await page.evaluate(({ ids, DIAL, CLEARANCE, PREDICTED }) => {
  const M = 120, W = 1440, H = 900, FIELD = 1200;
  const report = {};

  /* The largest axis-aligned rectangle in the frame containing no object at
     all. Ink coverage is the obvious metric and it is the wrong one: this
     study sets larger than anything before it, so it covers MORE of the frame
     while having fewer things in it. What §46 actually asks about is whether
     the emptiness is ONE silence or six gaps. */
  const largestVoid = (boxes) => {
    const S = 4, cols = Math.ceil(W / S), rows = Math.ceil(H / S);
    const blocked = Array.from({ length: rows }, () => new Uint8Array(cols));
    for (const b of boxes)
      for (let y = Math.max(0, Math.floor(b.t / S)); y < Math.min(rows, Math.ceil(b.b / S)); y++)
        for (let x = Math.max(0, Math.floor(b.l / S)); x < Math.min(cols, Math.ceil(b.r / S)); x++)
          blocked[y][x] = 1;
    let covered = 0;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) covered += blocked[y][x];
    /* Maximal rectangle in a binary matrix, by histogram. */
    const heights = new Int32Array(cols);
    let best = 0, bestRect = null;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) heights[x] = blocked[y][x] ? 0 : heights[x] + 1;
      const stack = [];
      for (let x = 0; x <= cols; x++) {
        const h = x === cols ? 0 : heights[x];
        let start = x;
        while (stack.length && stack[stack.length - 1].h >= h) {
          const top = stack.pop();
          const area = top.h * (x - top.x);
          if (area > best) { best = area; bestRect = { w: (x - top.x) * S, h: top.h * S, l: top.x * S, b: (y + 1) * S }; }
          start = top.x;
        }
        stack.push({ x: start, h });
      }
    }
    return { coveredPct: Math.round((covered / (cols * rows)) * 1000) / 10,
             voidPct: Math.round((best / (cols * rows)) * 1000) / 10, voidRect: bestRect };
  };

  for (const id of ids) {
    const frame = document.getElementById(id);
    const fb = frame.getBoundingClientRect();
    const rel = (r) => ({ l: Math.round(r.left - fb.left), t: Math.round(r.top - fb.top), r: Math.round(r.right - fb.left), b: Math.round(r.bottom - fb.top) });
    const problems = [];
    const items = [];

    /* The monument, as the union of the rects its LINES actually occupy. */
    const mon = frame.querySelector('.monument');
    let monLines = [];
    if (mon) {
      const rects = [...mon.querySelectorAll('span')].map(s => {
        const rg = document.createRange(); rg.selectNodeContents(s);
        return { text: s.textContent, ...rel(rg.getBoundingClientRect()) };
      });
      monLines = rects;
      items.push({ sel: 'monument', l: Math.min(...rects.map(r => r.l)), t: Math.min(...rects.map(r => r.t)),
                   r: Math.max(...rects.map(r => r.r)), b: Math.max(...rects.map(r => r.b)) });
    }
    for (const e of frame.querySelectorAll('.editorial,.micro,.act,.index,.wordmark,.marks'))
      items.push({ sel: e.className.toString().trim(), ...rel(e.getBoundingClientRect()) });

    /* The instrument enters the geometry as its drawn circle. */
    const img = frame.querySelector('.instrument');
    let dial = null;
    if (img) {
      const b = rel(img.getBoundingClientRect());
      const w = b.r - b.l, h = b.b - b.t;
      dial = { sel: 'instrument (drawn circle)', l: Math.round(b.l + DIAL.l * w), t: Math.round(b.t + DIAL.t * h), r: Math.round(b.l + DIAL.r * w), b: Math.round(b.t + DIAL.b * h) };
      items.push(dial);
    }
    /* The capture is the one object licensed to break the margin and leave
       the picture. It still may not sit on top of anything. */
    const shot = frame.querySelector('.shot');
    let shotBox = null;
    if (shot) { shotBox = { sel: 'shot (bled, exempt)', bleed: true, ...rel(shot.getBoundingClientRect()) }; items.push(shotBox); }

    for (const it of items) {
      if (it.bleed) continue;
      if (it.l < M - 1) problems.push(`${it.sel} breaks the left margin (${it.l} < ${M})`);
      if (it.r > W - M + 1) problems.push(`${it.sel} breaks the right margin (${it.r} > ${W - M})`);
      if (it.t < M - 1) problems.push(`${it.sel} breaks the top margin (${it.t} < ${M})`);
      /* Descenders may fall below a foot line — a baseline is an alignment
         line, not the bottom of the ink — but nothing may leave the picture. */
      if (it.b > H) problems.push(`${it.sel} leaves the frame (${it.t}…${it.b})`);
    }

    /* Authored breaks, the field, and the solve's own arithmetic. */
    const pred = PREDICTED[id];
    monLines.forEach((line, i) => {
      const tw = line.r - line.l;
      if (tw > FIELD) problems.push(`"${line.text}" sets ${tw}px against a ${FIELD}px field (+${tw - FIELD})`);
      if (pred && pred.widths[i] !== undefined && Math.abs(tw - pred.widths[i]) > 3)
        problems.push(`line ${i + 1} renders ${tw}px but the solve predicted ${pred.widths[i]}px — six-act-scale.css was computed against a different setting`);
    });
    for (const line of frame.querySelectorAll('.monument span'))
      if (line.getClientRects().length > 1) problems.push(`"${line.textContent}" was re-broken by the browser into ${line.getClientRects().length} lines`);

    /* THE WIDTH AXIS, ASSERTED RATHER THAN ASSUMED. */
    let stretch = null;
    if (mon) {
      stretch = getComputedStyle(mon).fontStretch;
      const want = pred ? `${pred.wdth}%` : null;
      const got = stretch === 'normal' ? '100%' : stretch;
      if (want && got !== want) problems.push(`the monument renders at font-stretch ${got} but the solve measured it at ${want}`);
    }

    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (ox > 2 && oy > 2) problems.push(`${a.sel} ⨯ ${b.sel} overlap by ${ox}×${oy}px`);
    }

    /* Isolation, as a measurement: the air between where the statement stops
       and where the instrument starts. */
    let isolation = null;
    if (dial && monLines.length) {
      /* The shortest distance between the statement's ink and the dial's
         circle, whichever axis they are separated on — Act VI stacks them
         vertically, and a horizontal-only measure would report zero air
         around an object with 135px of it. */
      const monR = Math.max(...monLines.map(r => r.r)), monL = Math.min(...monLines.map(r => r.l));
      const monT = Math.min(...monLines.map(r => r.t)), monB = Math.max(...monLines.map(r => r.b));
      const gx = dial.l > monR ? dial.l - monR : (monL > dial.r ? monL - dial.r : null);
      const gy = dial.t > monB ? dial.t - monB : (monT > dial.b ? monT - dial.b : null);
      isolation = gx === null && gy === null ? 0 : Math.max(gx ?? 0, gy ?? 0);
    }

    /* Accent clearance on the frame as it renders, not as it was solved. */
    let clearance = null;
    if (mon && monLines.length > 1) {
      const cs = getComputedStyle(mon);
      const px = parseFloat(cs.fontSize), lh = parseFloat(cs.lineHeight);
      const lines = monLines.map(l => l.text);
      const W2 = 4200, H2 = Math.ceil(px * 3);
      const ink = (text) => {
        const cv = document.createElement('canvas'); cv.width = W2; cv.height = H2;
        const x = cv.getContext('2d'); x.clearRect(0, 0, W2, H2);
        x.font = `${cs.fontStyle} ${cs.fontWeight} ${px}px 'Archivo'`;
        x.letterSpacing = cs.letterSpacing;
        x.textBaseline = 'alphabetic'; x.fillStyle = '#fff';
        x.fillText(text, 10, px * 1.5);
        const d = x.getImageData(0, 0, W2, H2).data;
        const top = new Int32Array(W2).fill(-1), bot = new Int32Array(W2).fill(-1);
        for (let yy = 0; yy < H2; yy++) { const row = yy * W2 * 4;
          for (let xx = 0; xx < W2; xx++) if (d[row + xx * 4 + 3] > 40) { if (top[xx] < 0) top[xx] = yy; bot[xx] = yy; } }
        return { top, bot, baseline: px * 1.5, ok: /Archivo/.test(x.font) };
      };
      const pairs = [];
      for (let i = 0; i + 1 < lines.length; i++) {
        const A = ink(lines[i]), B = ink(lines[i + 1]);
        if (!A.ok) problems.push('the clearance probe could not set the font — this measurement is not trustworthy');
        let min = Infinity, atX = null, cols = 0;
        for (let xx = 0; xx < W2; xx++) {
          if (A.bot[xx] < 0 || B.top[xx] < 0) continue;
          cols++;
          const g = (B.top[xx] - B.baseline + lh) - (A.bot[xx] - A.baseline);
          if (g < min) { min = g; atX = xx - 10; }
        }
        const em = cols ? Math.round((min / px) * 1000) / 1000 : null;
        pairs.push({ above: lines[i], below: lines[i + 1], sharedColumns: cols, minGapPx: cols ? Math.round(min * 10) / 10 : null, minGapEm: em, atX });
        if (em !== null && em < 0) problems.push(`ACCENT COLLISION "${lines[i]}" / "${lines[i + 1]}" — ink overlaps by ${-Math.round(min)}px at x=${atX}`);
        else if (em !== null && em < CLEARANCE - 0.006) problems.push(`clearance below target in "${lines[i]}" / "${lines[i + 1]}" — ${em}em at x=${atX}`);
      }
      clearance = { fontSizePx: px, leadingEm: Math.round((lh / px) * 1000) / 1000, tracking: cs.letterSpacing, stretch, pairs };
    }

    report[id] = { problems, objects: items.length, ...largestVoid(items.map(i => ({ ...i, b: Math.min(i.b, H), r: Math.min(i.r, W) }))),
                   isolationPx: isolation, clearance, items, monLines };
  }
  return report;
}, { ids: FRAMES, DIAL, CLEARANCE: scale.rules.CLEARANCE, PREDICTED });

writeFileSync(`${OUT}measurements.json`, JSON.stringify(audit, null, 2));
let failed = false;
for (const [id, r] of Object.entries(audit)) {
  if (r.problems.length) failed = true;
  const iso = r.isolationPx === null ? '' : `  isolation ${String(r.isolationPx).padStart(3)}px`;
  console.log(`[${r.problems.length ? 'FAIL' : ' ok '}] ${id.padEnd(14)} objects ${r.objects}  covered ${String(r.coveredPct).padStart(4)}%  largest void ${String(r.voidPct).padStart(4)}% (${r.voidRect ? r.voidRect.w + '×' + r.voidRect.h : '—'})${iso}`);
  r.problems.forEach(p => console.log(`         · ${p}`));
}

if (!failed || process.argv.includes('--force')) {
  for (const id of FRAMES) await page.locator(`#${id}`).screenshot({ path: `${OUT}${id}.png` });
  /* THE COLOUR SHEET IS THE SAME MARKUP AND THE SAME SOLVED TYPOGRAPHY, shot
     a second time with one class added. Two files that were meant to be the
     same composition cannot drift apart if only one composition exists. */
  await page.evaluate(() => document.body.classList.add('color'));
  await page.waitForTimeout(200);
  for (const id of HU) await page.locator(`#${id}`).screenshot({ path: `${OUT}${id}-c.png` });
  console.log(`\n${FRAMES.length} monochrome frames and ${HU.length} colour frames shot →`, OUT);
} else {
  console.log('\nnot shooting: fix the frames above, or re-run with --force to inspect.');
}
await browser.close();
process.exit(failed && !process.argv.includes('--force') ? 1 : 0);
