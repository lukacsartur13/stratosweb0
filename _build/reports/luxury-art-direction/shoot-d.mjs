/**
 * DIRECTION D — measures the nine frames, then photographs them.
 *
 * It refuses to photograph a frame that fails, because a study whose frames
 * silently overflow is worse than no study. What it checks:
 *
 *   · every object against the 120px frame on all four sides
 *   · every monument line against the 1 200px field, AND against the browser
 *     having re-broken it — an authored break that wrapped silently would
 *     pass a width test while the browser rewrote the art direction
 *   · every pair of objects against each other. The instrument is compared as
 *     its DRAWN CIRCLE, not as its transparent 420px box, because the box is
 *     not what the eye sees and a box test would report air as a collision
 *   · Hungarian accent clearance, re-measured as painted ink on the frames as
 *     they actually render rather than trusted from the solve
 *   · the isolation §8 asks for, as the actual pixel gap between the end of
 *     the monument and the start of the dial
 *   · ink coverage and object count — §32's squint test, as numbers
 */
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fontsReady } from './fonts-ready.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const OUT = `${here}direction-d/`;
mkdirSync(OUT, { recursive: true });
const FRAMES = ['d1-hu', 'd1-en', 'd1-de', 'd2-hu', 'd2-en', 'd2-de', 'd3-hu', 'd3-en', 'd3-de'];
const scale = JSON.parse(readFileSync(`${OUT}scale.json`, 'utf8'));
const DIAL = scale.dial.inkFractionOfBox;

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(`${here}direction-d.html`).href, { waitUntil: 'networkidle' });
await fontsReady(page);

const audit = await page.evaluate(({ ids, DIAL, CLEARANCE, PREDICTED }) => {
  const M = 120, W = 1440, H = 900, FIELD = 1200;
  const report = {};

  for (const id of ids) {
    const frame = document.getElementById(id);
    const fb = frame.getBoundingClientRect();
    const rel = (r) => ({ l: Math.round(r.left - fb.left), t: Math.round(r.top - fb.top), r: Math.round(r.right - fb.left), b: Math.round(r.bottom - fb.top) });

    const items = [...frame.querySelectorAll('.monument,.editorial,.micro,.act,.index,.wordmark')]
      .map(e => ({ sel: (e.className || e.tagName).toString().trim(), ...rel(e.getBoundingClientRect()) }));

    /* The instrument enters the geometry as its drawn circle. */
    const img = frame.querySelector('.instrument');
    let dial = null;
    if (img) {
      const b = rel(img.getBoundingClientRect());
      const w = b.r - b.l, h = b.b - b.t;
      dial = { sel: 'instrument (drawn circle)', l: Math.round(b.l + DIAL.l * w), t: Math.round(b.t + DIAL.t * h), r: Math.round(b.l + DIAL.r * w), b: Math.round(b.t + DIAL.b * h) };
      items.push(dial);
    }

    const problems = [];
    for (const it of items) {
      if (it.l < M - 1) problems.push(`${it.sel} breaks the left frame (${it.l} < ${M})`);
      if (it.r > W - M + 1) problems.push(`${it.sel} breaks the right frame (${it.r} > ${W - M})`);
      if (it.t < M - 1) problems.push(`${it.sel} breaks the top frame (${it.t} < ${M})`);
      /* Descenders are allowed below the foot line — a baseline is the
         alignment line, not the bottom of the ink — but nothing may leave
         the picture. */
      if (it.b > H) problems.push(`${it.sel} leaves the frame (${it.t}…${it.b})`);
    }

    /* Authored breaks, and — just as important — the solve's own arithmetic.
       PREDICTED is what solve-d.mjs said this line would measure. If the two
       ever disagree the solve was computed against something other than what
       the browser is drawing, and every size in direction-d-scale.css is
       fiction. This check exists because that is exactly what happened once:
       the solve ran on a page where Archivo had not finished loading and the
       whole system was sized on the macOS system fallback. */
    const rendered = [];
    for (const line of frame.querySelectorAll('.monument span')) {
      const rg = document.createRange(); rg.selectNodeContents(line);
      const tw = Math.round(rg.getBoundingClientRect().width);
      rendered.push(tw);
      if (tw > FIELD) problems.push(`"${line.textContent}" sets ${tw}px against a ${FIELD}px field (+${tw - FIELD})`);
      if (line.getClientRects().length > 1) problems.push(`"${line.textContent}" was re-broken by the browser into ${line.getClientRects().length} lines`);
    }
    const predicted = PREDICTED[id] || [];
    rendered.forEach((tw, i) => {
      if (predicted[i] === undefined) return;
      if (Math.abs(tw - predicted[i]) > 3) problems.push(`line ${i + 1} renders ${tw}px but the solve predicted ${predicted[i]}px — direction-d-scale.css was computed against a different setting`);
    });

    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (ox > 2 && oy > 2) problems.push(`${a.sel} ⨯ ${b.sel} overlap by ${ox}×${oy}px`);
    }

    /* §8 — isolation, as a measurement. The horizontal air between where the
       statement stops and where the instrument starts. */
    let isolation = null;
    const mon = frame.querySelector('.monument');
    if (dial && mon) isolation = dial.l - Math.round(mon.getBoundingClientRect().right - fb.left);

    /* Accent clearance on the frame as it renders, not as it was solved. */
    let clearance = null;
    if (mon) {
      const cs = getComputedStyle(mon);
      const px = parseFloat(cs.fontSize), lh = parseFloat(cs.lineHeight);
      const lines = [...mon.querySelectorAll('span')].map(s => s.textContent);
      const W2 = 4000, H2 = Math.ceil(px * 3);
      const ink = (text) => {
        const cv = document.createElement('canvas'); cv.width = W2; cv.height = H2;
        const x = cv.getContext('2d'); x.clearRect(0, 0, W2, H2);
        x.font = `${cs.fontStyle} ${cs.fontWeight} ${px}px 'Archivo'`;
        x.fontStretch = cs.fontStretch; x.letterSpacing = cs.letterSpacing;
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
        if (!A.ok) problems.push('clearance probe could not set the font — measurement not trustworthy');
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
        else if (em !== null && em < CLEARANCE - 0.005) problems.push(`clearance below target in "${lines[i]}" / "${lines[i + 1]}" — ${em}em at x=${atX}`);
      }
      clearance = { fontSizePx: px, leadingEm: Math.round((lh / px) * 1000) / 1000, tracking: cs.letterSpacing, stretch: cs.fontStretch, pairs };
    }

    const inkArea = items.reduce((s, it) => s + Math.max(0, it.r - it.l) * Math.max(0, it.b - it.t), 0);
    report[id] = { problems, objects: items.length, occupied: Math.round((inkArea / (W * H)) * 1000) / 10, isolationPx: isolation, clearance, items };
  }
  return report;
}, {
  ids: FRAMES, DIAL, CLEARANCE: scale.rules.CLEARANCE,
  PREDICTED: Object.fromEntries(Object.entries(scale.solved).flatMap(([sc, v]) =>
    Object.entries(v.locales).map(([loc, l]) => [`${sc}-${loc}`, l.lineWidthsPx]))),
});

writeFileSync(`${OUT}measurements.json`, JSON.stringify(audit, null, 2));
let failed = false;
for (const [id, r] of Object.entries(audit)) {
  if (r.problems.length) failed = true;
  const iso = r.isolationPx === null ? '' : `  isolation ${String(r.isolationPx).padStart(3)}px`;
  console.log(`[${r.problems.length ? 'FAIL' : ' ok '}] ${id}  objects ${r.objects}  ink ${String(r.occupied).padStart(4)}%${iso}`);
  r.problems.forEach(p => console.log(`         · ${p}`));
}

if (!failed || process.argv.includes('--force')) {
  for (const id of FRAMES) await page.locator(`#${id}`).screenshot({ path: `${OUT}${id}.png` });
  console.log('\nnine frames shot →', OUT);
} else {
  console.log('\nnot shooting: fix the frames above, or re-run with --force to inspect.');
}
await browser.close();
process.exit(failed && !process.argv.includes('--force') ? 1 : 0);
