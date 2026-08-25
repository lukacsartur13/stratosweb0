/**
 * §11 — how the three candidate clauses actually set, in the element they would
 * live in, at both surfaces and in all three locales.
 *
 * The line count is the only thing at stake: this is body copy in a flowing
 * column, so nothing can overflow — but a principle that grows from two lines
 * to three changes the passage's height and the beat it sits in.
 */
import { chromium } from '@playwright/test';
const CANDS = {
  hu: {
    current: 'Minden szakasznak két oldala van, és menet közben látod, nem a végén.',
    '1': 'Minden szakaszban van dolgod, és menet közben látod, nem a végén.',
    '2': 'Minden szakasznak van egy oldala, ami rád tartozik — és menet közben látod, nem a végén.',
    '3': 'Minden szakaszt együtt csinálunk végig, és menet közben látod, nem a végén.',
  },
  en: {
    current: 'Every stage has two sides, and you see it as it goes, not at the end.',
    '1': 'You have a part in every stage, and you see it as it goes, not at the end.',
    '2': 'Every stage has a side that is yours — and you see it as it goes, not at the end.',
    '3': 'We go through every stage together, and you see it as it goes, not at the end.',
  },
  de: {
    current: 'Jede Phase hat zwei Seiten, und Sie sehen es währenddessen, nicht erst am Ende.',
    '1': 'In jeder Phase brauchen wir auch etwas von Ihnen, und Sie sehen es währenddessen, nicht erst am Ende.',
    '2': 'Jede Phase hat eine Seite, die Ihnen gehört — und Sie sehen es währenddessen, nicht erst am Ende.',
    '3': 'Wir gehen jede Phase gemeinsam durch, und Sie sehen es währenddessen, nicht erst am Ende.',
  },
};
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] });
for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'portrait'], [360, 800, 'portrait-360']]) {
  for (const loc of ['hu', 'en', 'de']) {
    const c = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 768, hasTouch: w < 768 });
    const p = await c.newPage();
    await p.goto(`http://localhost:4322/${loc === 'hu' ? '' : loc + '/'}index.html`, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(1200);
    const out = await p.evaluate((texts) => {
      // The element the clause lives in: the second principle's line.
      const el = document.querySelectorAll('.passage__principle p')[1]
        ?? document.querySelectorAll('[data-stage="process"] .mv-passage__note, [data-stage="process"] p')[1];
      if (!el) return null;
      const original = el.textContent;
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      const r = {};
      for (const [k, t] of Object.entries(texts)) {
        el.textContent = t;
        r[k] = { lines: Math.round(el.getBoundingClientRect().height / lh), h: Math.round(el.getBoundingClientRect().height) };
      }
      el.textContent = original;
      return r;
    }, CANDS[loc]);
    console.log(`${label.padEnd(13)} ${loc}  ` + (out ? Object.entries(out).map(([k, v]) => `${k}:${v.lines}L`).join('  ') : 'element not found'));
    await c.close();
  }
}
await b.close();
