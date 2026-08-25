/* Two questions the first pass could not answer:
   1. Is assets/fonts/archivo/archivo-italic-*.woff2 actually being selected,
      or is Chromium matching the upright face and drawing a synthetic slant?
      Canvas measureText cannot see font-style, so it is measured in layout.
   2. What is the real accent clearance in SENTENCE CASE, which is the case
      the study is proposing — lowercase ő over a lowercase descender, not the
      uppercase pair the first pass measured. */
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const here = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(pathToFileURL(`${here}font-audit.html`).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);

const out = await page.evaluate(async () => {
  const res = {};
  const el = document.getElementById('p');
  const w = (o, t) => { Object.assign(el.style, { fontFamily: "'Archivo'", fontSize: '200px', fontWeight: '400', fontStretch: '100%', fontStyle: 'normal', letterSpacing: 'normal' }, o); el.textContent = t; return Math.round(el.getBoundingClientRect().width * 100) / 100; };

  /* 1 — italic selection. Ask the font-loading API directly which face a
     given font shorthand resolves to, then confirm in layout with a string
     whose italic and upright set-widths differ in a real cut. */
  res.fontface_check = {
    'italic 400 Archivo': document.fonts.check("italic 400 200px 'Archivo'"),
    'normal 400 Archivo': document.fonts.check("400 200px 'Archivo'"),
  };
  const matches = await document.fonts.load("italic 400 200px 'Archivo'", 'agy görbület');
  res.italic_load_matched = matches.map(f => `${f.family}|${f.style}|${f.weight}|${f.status}`);

  const strings = ['görbületet', 'agya', 'Magasságot', 'ffi'];
  res.italic_vs_upright_setwidth = Object.fromEntries(strings.map(s => [s, {
    upright: w({ fontStyle: 'normal' }, s),
    italic: w({ fontStyle: 'italic' }, s),
  }]));

  /* Pixel test — render both and compare bitmaps. A real italic differs in
     letterform, not only in slant; a synthetic oblique is a pure shear. */
  const shot = (style) => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 300;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 900, 300);
    x.fillStyle = '#000'; x.font = `${style} 400 200px 'Archivo'`; x.textBaseline = 'alphabetic';
    x.fillText('agy', 20, 230);
    return x.getImageData(0, 0, 900, 300).data;
  };
  const a = shot('normal'), b = shot('italic');
  let diff = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 24) diff++;
  res.italic_canvas_pixels_differing = diff;

  /* 2 — sentence-case accent clearance at monument scale. Two stacked lines
     are laid out for real at a range of line-heights; the collision test is
     the actual painted ink of line 2's tallest accent against line 1's
     deepest descender, read out of a canvas, not computed from metrics. */
  const clearance = (family, upper) => {
    const c = document.createElement('canvas'); c.width = 1400; c.height = 700;
    const x = c.getContext('2d');
    const top = upper ? 'MAGASSÁGY' : 'magasságy';   // deepest descender line
    const bot = upper ? 'ŐRÜLTŰ' : 'őrültű';          // tallest accent line
    x.font = `400 200px ${family}`; x.textBaseline = 'alphabetic';
    const m1 = x.measureText(top), m2 = x.measureText(bot);
    // ink extent of line 1 below its baseline, and of line 2 above its own
    return Math.round(((m1.actualBoundingBoxDescent + m2.actualBoundingBoxAscent) / 200) * 1000) / 1000;
  };
  res.min_leading_em_before_collision = {
    'Archivo sentence case': clearance("'Archivo'", false),
    'Archivo all caps': clearance("'Archivo'", true),
    'Aboreto all caps': clearance("'Aboreto'", true),
  };
  return res;
});
writeFileSync(`${here}italic-probe.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
