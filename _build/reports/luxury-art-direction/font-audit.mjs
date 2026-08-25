/* Empirical audit of the three provisioned families. Nothing is asserted from
   the manifest alone: every axis, every glyph and every metric below is read
   out of a real Chromium layout of the actual woff2 files in assets/fonts/. */
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const here = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(pathToFileURL(`${here}font-audit.html`).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);

const out = await page.evaluate(() => {
  const el = document.getElementById('p');
  const set = (o) => Object.assign(el.style, {
    fontFamily: "'Archivo'", fontSize: '100px', fontWeight: '400',
    fontStretch: '100%', fontStyle: 'normal', letterSpacing: 'normal',
  }, o);
  const w = (o, text) => { set(o); el.textContent = text; return Math.round(el.getBoundingClientRect().width * 100) / 100; };

  const res = { loaded: [...document.fonts].map(f => `${f.family} ${f.style} ${f.weight} ${f.stretch} ${f.status}`) };

  const S = 'Magasságot';
  res.archivo_wdth_axis = Object.fromEntries(
    ['62%', '75%', '87.5%', '100%', '112.5%', '125%'].map(v => [v, w({ fontStretch: v }, S)]));
  res.archivo_wght_axis = Object.fromEntries(
    ['100', '200', '300', '400', '500', '600', '700', '900'].map(v => [v, w({ fontWeight: v }, S)]));
  res.archivo_italic_is_real = {
    normal: w({ fontStyle: 'normal' }, 'görbületet'),
    italic: w({ fontStyle: 'italic' }, 'görbületet'),
  };

  /* Glyph coverage. A family that lacks a codepoint falls back to the next
     family in the stack, so each glyph is measured twice — once with the
     family first and a deliberately mismatched fallback behind it, once with
     the fallback alone. Equal widths mean the glyph was NOT drawn by the
     family under test. Latin-1 'A' is the control: it must differ. */
  const HUN = [...'ÁÉÍÓÖŐÚÜŰáéíóöőúüűAaß äÄ'].filter(c => c !== ' ');
  const fams = { Archivo: "'Archivo'", Aboreto: "'Aboreto'", 'JetBrains Mono': "'JetBrains Mono'" };
  res.glyph_coverage = {};
  for (const [name, fam] of Object.entries(fams)) {
    const missing = [], present = [];
    for (const g of HUN) {
      const a = w({ fontFamily: `${fam}, 'Times New Roman'` }, g);
      const b = w({ fontFamily: `'Times New Roman'` }, g);
      (Math.abs(a - b) > 0.05 ? present : missing).push(g);
    }
    res.glyph_coverage[name] = { present: present.join(''), missing: missing.join('') || '—' };
  }

  /* Does Aboreto have a real lowercase, or is it a unicase display face?
     Same-height 'M' and 'm' means unicase — which decides whether it can ever
     set a sentence-case monument. */
  const c = document.createElement('canvas').getContext('2d');
  const cap = (font, ch) => { c.font = font; const m = c.measureText(ch); return { w: Math.round(m.width * 100) / 100, asc: Math.round(m.actualBoundingBoxAscent * 100) / 100, desc: Math.round(m.actualBoundingBoxDescent * 100) / 100 }; };
  res.aboreto_case = { M: cap("400 100px 'Aboreto'", 'M'), m: cap("400 100px 'Aboreto'", 'm'), g: cap("400 100px 'Aboreto'", 'g') };
  res.archivo_case = { M: cap("400 100px 'Archivo'", 'M'), m: cap("400 100px 'Archivo'", 'm'), g: cap("400 100px 'Archivo'", 'g') };

  /* Vertical metrics at monument scale — what actually decides how tight the
     leading may be set before Hungarian accents collide with the line above. */
  const probe = (font) => {
    const O = cap(font, 'O'), Od = cap(font, 'Ő'), Oa = cap(font, 'Ó'), x = cap(font, 'x'), g = cap(font, 'g'), y = cap(font, 'gy');
    c.font = font; const fm = c.measureText('H');
    return {
      capHeight: O.asc, xHeight: x.asc, descender: g.desc,
      doubleAcuteTop: Od.asc, acuteTop: Oa.asc,
      accentOverCap: Math.round((Od.asc - O.asc) * 100) / 100,
      fontAscent: Math.round(fm.fontBoundingBoxAscent * 100) / 100,
      fontDescent: Math.round(fm.fontBoundingBoxDescent * 100) / 100,
      /* minimum line-height, in em, at which the double acute of an uppercase
         Ő on line n+1 just touches the descender of a 'gy' on line n */
      minLeadingEm: Math.round(((Od.asc + y.desc) / 100) * 1000) / 1000,
    };
  };
  res.metrics_100px = {
    'Archivo 400 wdth100': probe("400 100px 'Archivo'"),
    'Aboreto 400': probe("400 100px 'Aboreto'"),
    'JetBrains Mono 400': probe("400 100px 'JetBrains Mono'"),
  };

  /* Locale set-width. The same statement in three languages, at one size —
     this is the number that decides whether one monument scale can serve all
     three locales or whether each needs its own line breaks. */
  const line = (t) => w({ fontSize: '100px', letterSpacing: '-0.03em' }, t);
  res.locale_setwidth_100px = {
    hu_hero: line('Magasságot építünk.'), en_hero: line('Altitude is what we build.'), de_hero: line('Höhe bauen wir.'),
    hu_alt: line('látni a görbületet.'), en_alt: line('see the curvature.'), de_alt: line('die Krümmung zu sehen.'),
    hu_sys: line('Hat terület,'), en_sys: line('Six areas,'), de_sys: line('Sechs Bereiche,'),
  };
  return res;
});

writeFileSync(`${here}font-audit.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
