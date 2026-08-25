/**
 * §11 (phase 5.1) — how the candidate replacements for the ambiguous process
 * clause actually set, in the element they would live in, on both surfaces and
 * in all three locales.
 *
 * The same instrument `temporal/clause.mjs` is, with the phase-5 shortlist kept
 * for reference and the phase-5.1 candidates added. The line count is the only
 * thing at stake: this is body copy in a flowing column, so nothing can
 * overflow, but a principle that grows a line grows the beat it sits in.
 */
import { chromium } from '@playwright/test';
const CANDS = {
  hu: {
    current: 'Minden szakasznak két oldala van, és menet közben látod, nem a végén.',
    'K1': 'Minden szakaszban van dolgod, és menet közben látod, nem a végén.',
    'K2': 'Minden szakasznak van egy oldala, ami rád tartozik — és menet közben látod, nem a végén.',
    'A': 'Minden szakaszt két oldalról nézünk, és menet közben látod, nem a végén.',
    'B': 'Minden szakaszt két oldalról nézünk — a miénkről és a tiédről —, és menet közben látod, nem a végén.',
    'C': 'Minden szakaszt két oldalról vizsgálunk, és menet közben látod, nem a végén.',
  },
  en: {
    current: 'Every stage has two sides, and you see it as it goes, not at the end.',
    'K1': 'You have a part in every stage, and you see it as it goes, not at the end.',
    'K2': 'Every stage has a side that is yours — and you see it as it goes, not at the end.',
    'A': 'We look at every stage from two sides, and you see it as it goes, not at the end.',
    'B': 'We look at every stage from two sides — ours and yours — and you see it as it goes, not at the end.',
    'C': 'We examine every stage from two sides, and you see it as it goes, not at the end.',
  },
  de: {
    current: 'Jede Phase hat zwei Seiten, und Sie sehen es währenddessen, nicht erst am Ende.',
    'K1': 'In jeder Phase brauchen wir auch etwas von Ihnen, und Sie sehen es währenddessen, nicht erst am Ende.',
    'K2': 'Jede Phase hat eine Seite, die Ihnen gehört — und Sie sehen es währenddessen, nicht erst am Ende.',
    'A': 'Wir betrachten jede Phase von zwei Seiten, und Sie sehen es währenddessen, nicht erst am Ende.',
    'B': 'Wir betrachten jede Phase von zwei Seiten — von unserer und von Ihrer —, und Sie sehen es währenddessen, nicht erst am Ende.',
    'C': 'Wir prüfen jede Phase von zwei Seiten, und Sie sehen es währenddessen, nicht erst am Ende.',
  },
};
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader'] });
for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'portrait'], [360, 800, 'portrait-360']]) {
  for (const loc of ['hu', 'en', 'de']) {
    const c = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 768, hasTouch: w < 768 });
    const p = await c.newPage();
    await p.goto(`http://localhost:4322/${loc === 'hu' ? '' : loc + '/'}index.html`, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(1400);
    const out = await p.evaluate((texts) => {
      const el = document.querySelectorAll('.passage__principle p')[1]
        ?? document.querySelectorAll('[data-testid="process-principle-2"] p')[0];
      if (!el) return null;
      const original = el.textContent;
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      const r = {};
      for (const [k, t] of Object.entries(texts)) {
        el.textContent = t;
        r[k] = Math.round(el.getBoundingClientRect().height / lh);
      }
      el.textContent = original;
      return r;
    }, CANDS[loc]);
    console.log(`${label.padEnd(13)} ${loc}  ` + (out ? Object.entries(out).map(([k, v]) => `${k}:${v}L`).join('  ') : 'element not found'));
    await c.close();
  }
}
await b.close();
