// =============================================================================
// Phase 9, Workstream I — the not-found page.
//
// Three of them, one per locale, because Netlify serves `<dir>/404.html` for
// paths under that directory and `/404.html` for everything else.
//
// WHAT THIS FILE CAN AND CANNOT PROVE
//
// It cannot prove the HTTP status. The suite runs against `python3 -m
// http.server`, which answers a missing path with its own built-in 404 body and
// has never heard of `404.html`; the 404 status is Netlify's convention and is
// verifiable only on a deploy. That is recorded as a live-validation dependency
// in _build/reports/phase9-redirect-map.md rather than papered over with an
// assertion that would pass for the wrong reason.
//
// What it does prove is everything about the document itself — that it exists in
// all three languages, that it says nothing to a crawler that would be a claim
// about a page that does not exist, that it does not send anyone anywhere on
// its own, and that the four ways out of it are real.
// =============================================================================
import { test, expect } from '@playwright/test';

const LOCALES = [
  { path: '/404.html', lang: 'hu', home: '/', heading: /nincs meg/i },
  { path: '/en/404.html', lang: 'en', home: '/en/', heading: /isn’t here|is not here/i },
  { path: '/de/404.html', lang: 'de', home: '/de/', heading: /gibt es nicht/i },
];

for (const locale of LOCALES) {
  test.describe(`404 (${locale.lang})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(locale.path);
    });

    test('is in the right language and says what happened', async ({ page }) => {
      await expect(page.locator('html')).toHaveAttribute('lang', locale.lang);
      const h1 = page.locator('h1');
      await expect(h1).toHaveCount(1);
      await expect(h1).toHaveText(locale.heading);
    });

    test('offers Home, Services, Work and Contact, and they resolve', async ({ page, request }) => {
      const links = page.locator('nav.related a');
      await expect(links).toHaveCount(4);

      for (const href of await links.evaluateAll((els) =>
        els.map((el) => (el as HTMLAnchorElement).getAttribute('href')))) {
        expect(href, 'no dead ends off a dead end').toBeTruthy();
        const target = new URL(href!, new URL(locale.path, 'http://127.0.0.1').href);
        const res = await request.get(target.pathname);
        expect(res.status(), `${href} from ${locale.path}`).toBe(200);
      }
      // The first of the four is home, in this locale.
      const first = await links.first().getAttribute('href');
      expect(new URL(first!, new URL(locale.path, 'http://x').href).pathname).toBe(locale.home);
    });

    test('sends nobody anywhere on its own', async ({ page }) => {
      // No meta refresh, no scripted navigation. A visitor who mistyped an
      // address is owed an explanation, not a silent relocation.
      await expect(page.locator('meta[http-equiv="refresh" i]')).toHaveCount(0);
      const landed = page.url();
      await page.waitForTimeout(1500);
      expect(page.url(), 'the page must still be the 404 a moment later').toBe(landed);
    });

    test('offers no search field it cannot honour', async ({ page }) => {
      // The site has no search. A box that does nothing when you type in it is
      // worse than no box, because it costs the visitor an attempt first.
      await expect(page.locator('input[type="search"], form[role="search"], [role="searchbox"]'))
        .toHaveCount(0);
    });

    test('is noindex, and claims nothing about a page that does not exist', async ({ page }) => {
      await expect(page.locator('meta[name="robots"]'))
        .toHaveAttribute('content', /noindex/);
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
      await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);
      await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
    });

    test('loads no homepage WebGL and stays inside the viewport', async ({ page }) => {
      const requested: string[] = [];
      page.on('request', (r) => requested.push(r.url()));
      await page.reload();
      await page.waitForLoadState('networkidle');

      // The journey is the homepage's. Neither its bundle nor its geometry
      // belongs on the page you land on when something is missing.
      for (const url of requested) {
        expect(url, 'no model').not.toMatch(/\.glb($|\?)/i);
        expect(url, 'no journey bundle').not.toMatch(/\/assets\/home\//);
      }
      // Not "no canvas": every generated page carries `.contrail`, a 2D
      // decorative canvas that is part of the site chrome. What must not be
      // here is a 3D context.
      const webgl = await page.evaluate(() =>
        [...document.querySelectorAll('canvas')].filter((c) => {
          try {
            return Boolean(c.getContext('webgl2', { failIfMajorPerformanceCaveat: false })
              && (c as any).__three);
          } catch { return false; }
        }).length);
      expect(webgl, 'no 3D context on a 404').toBe(0);
      expect(await page.evaluate(() =>
        [...document.querySelectorAll('canvas')].map((c) => c.className)))
        .toEqual(['contrail']);

      expect(await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth))
        .toBeLessThanOrEqual(0);
    });
  });
}
