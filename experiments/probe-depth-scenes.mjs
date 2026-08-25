// =============================================================================
// PHASE 5.2 · THE THREE PROOF SCENES, PHOTOGRAPHED AND MEASURED.
//
// §35 names Hero / System / High Altitude as the three frames the new system
// has to work on before anything else may change, because they are the three
// compositional problems on the page: product-led, structural, and extreme
// whitespace. This captures them — the picture, and the boxes underneath it in
// the study's own reference-frame coordinates — so the before and the after are
// comparable as geometry rather than only as pixels.
//
//   node experiments/probe-depth-scenes.mjs --tag before
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const TAG = arg('tag', 'before');
const LOCALE = arg('locale', 'hu');
const BASE = process.env.URL ?? `http://localhost:5177/home/${LOCALE}.html`;
const OUT = '_build/reports/luxury-art-direction/depth';

/** §35's three, plus the four that complete the journey sheet. */
const SCENES = [
  ['i', 'calibration', 'hero'],
  ['ii', 'initial-ascent', 'noise'],
  ['iii', 'lower-atmosphere', 'system'],
  ['iv', 'selected-work', 'proof'],
  ['v', 'stratosphere-transition', 'high'],
  ['vi', 'full-stratosphere', 'arrival'],
  ['action', 'destination', 'action'],
];

const PASSAGES = [
  ['cloud-entry', 'p1'],
  ['cloud-breakthrough', 'p2'],
  ['system', 'p3'],
  ['process', 'p4'],
];

mkdirSync(`${OUT}/${TAG}`, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'vite-error-overlay, .debug, .debug__toggle { display: none !important; }' });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => !!globalThis.__stratos, { timeout: 30_000 });
await page.waitForTimeout(3000);

const measured = {};

const settle = async (stage) => {
  await page.evaluate((s) => {
    const el = document.querySelector(`.panel[data-stage="${s}"]`);
    scrollTo({ top: el.offsetTop + 0.4 * innerHeight, behavior: 'instant' });
  }, stage);
  await page.waitForTimeout(2400);
};

for (const [act, stage, name] of SCENES) {
  await settle(stage);
  measured[name] = await page.evaluate((act) => {
    const field = document.querySelector(`[data-act="${act}"] .act__field`);
    const root = getComputedStyle(document.documentElement);
    if (!field) return { note: 'no field', instrument: +root.getPropertyValue('--instrument') };
    const f = field.getBoundingClientRect();
    const u = f.width / 1440;
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return [+((r.x - f.x) / u).toFixed(1), +((r.y - f.y) / u).toFixed(1), +(r.width / u).toFixed(1), +(r.height / u).toFixed(1)];
    };
    const objects = {};
    for (const el of field.querySelectorAll('[class*="act__"]')) {
      const key = [...el.classList].find((c) => c.startsWith('act__') && c !== 'act__field');
      if (key && !objects[key]) objects[key] = box(el);
    }
    const mon = field.querySelector('.act__monument');
    const cs = mon && getComputedStyle(mon);

    // §45's contract, as geometry: the housing's published ellipse against every
    // object in the frame, so "support copy stays in clear air" is a number in
    // the record rather than an assurance in a report.
    const n = (k) => Number(root.getPropertyValue(k));
    const occl = { on: n('--occl'), x: n('--occl-x'), y: n('--occl-y'), rx: n('--occl-rx'), ry: n('--occl-ry') };
    const hits = {};
    if (occl.on > 0) {
      for (const [key, b] of Object.entries(objects)) {
        let inside = 0, total = 0;
        for (let y = b[1]; y < b[1] + b[3]; y += 2) {
          for (let x = b[0]; x < b[0] + b[2]; x += 2) {
            total++;
            const dx = (x - occl.x) / occl.rx, dy = (y - occl.y) / occl.ry;
            if (dx * dx + dy * dy <= 1) inside++;
          }
        }
        if (inside) hits[key] = +(inside / Math.max(total, 1)).toFixed(3);
      }
    }
    // §47's readability contract, PER GLYPH.
    //
    // The line's box is the wrong unit and it flatters the answer in both
    // directions: the spans are blocks, so a short line's box runs the whole
    // width of the statement and reports coverage over air it does not occupy.
    // What a reader loses is LETTERS, so the letters are what is measured — one
    // `Range` per character, its own rect, and the fraction of that rect the
    // housing's ellipse stands in front of.
    //
    // `visible` is then the phrase as a reader meets it, with a covered letter
    // written as a full stop, which is the record §47 asks a human to review
    // rather than a percentage to trust.
    const glyphCover = (node, from, to) => {
      const rr = document.createRange();
      rr.setStart(node, from);
      rr.setEnd(node, to);
      const r = rr.getBoundingClientRect();
      if (!r.width || !r.height) return 0;
      const b = [(r.x - f.x) / u, (r.y - f.y) / u, r.width / u, r.height / u];
      let inside = 0, total = 0;
      for (let y = b[1]; y < b[1] + b[3]; y += 2) {
        for (let x = b[0]; x < b[0] + b[2]; x += 2) {
          total++;
          const dx = (x - occl.x) / occl.rx, dy = (y - occl.y) / occl.ry;
          if (dx * dx + dy * dy <= 1) inside++;
        }
      }
      return inside / Math.max(total, 1);
    };
    const lines = [];
    if (mon && occl.on > 0) {
      for (const sp of mon.querySelectorAll('span')) {
        const node = sp.firstChild;
        if (!node || node.nodeType !== 3) continue;
        const text = node.textContent;
        let hidden = 0;
        let visible = '';
        for (let i = 0; i < text.length; i++) {
          const c = glyphCover(node, i, i + 1);
          if (c > 0.5) { hidden++; visible += '\u00b7'; } else visible += text[i];
        }
        lines.push({ text, hidden, glyphs: text.length, visible });
      }
    }
    return {
      lines,
      objects,
      monumentPx: mon ? +(parseFloat(cs.fontSize) / u).toFixed(1) : 0,
      monumentColor: cs ? cs.color : null,
      monumentOpacity: cs ? cs.opacity : null,
      instrument: +Number(root.getPropertyValue('--instrument')).toFixed(3),
      alt: +Number(root.getPropertyValue('--alt')).toFixed(3),
      occlusion: document.querySelector(`.panel[data-act="${act}"]`)?.dataset.occlusion ?? 'none',
      // The authored dial the object is actually composed at, straight off the
      // one solved state, so the sheets caption the number the page used rather
      // than one re-derived from the mask.
      dial: +(globalThis.__stratos?.composition?.instrumentStateAt?.(globalThis.__stratos.journey.current)?.dial ?? 0).toFixed(0),
      occl,
      hits,
    };
  }, act);
  await page.screenshot({ path: `${OUT}/${TAG}/${name}-${LOCALE}.png` });
  const m = measured[name];
  const collide = Object.entries(m.hits ?? {}).map(([k, v]) => `${k.replace('act__', '')} ${(v * 100).toFixed(0)}%`).join(' ');
  const lines = (m.lines ?? []).map((l) => `"${l.visible}" ${l.hidden}/${l.glyphs}`).join('  ');
  process.stdout.write(`${name.padEnd(8)} monument ${String(m.monumentPx).padStart(6)}u  instrument ${m.instrument}  occl ${String(m.occlusion).padEnd(8)} ${collide}   ${lines}\n`);
}

for (const [stage, name] of PASSAGES) {
  await settle(stage);
  measured[name] = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const st = document.querySelector('.pass__statement, [class*="pass__"]');
    return {
      instrument: +Number(root.getPropertyValue('--instrument')).toFixed(3),
      alt: +Number(root.getPropertyValue('--alt')).toFixed(3),
      statement: st ? st.textContent.trim().slice(0, 40) : null,
    };
  });
  await page.screenshot({ path: `${OUT}/${TAG}/${name}-${LOCALE}.png` });
  process.stdout.write(`${name.padEnd(8)} passage  instrument ${measured[name].instrument}\n`);
}

writeFileSync(`${OUT}/${TAG}-${LOCALE}.json`, JSON.stringify(measured, null, 2));
console.log(`\nwrote ${OUT}/${TAG}-${LOCALE}.json and ${SCENES.length + PASSAGES.length} stills`);
await browser.close();
