import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { enableReducedMotion, matchesReducedMotion } from './helpers/reduced-motion';

/**
 * Console noise that is not the site's fault and must not fail a run:
 * font CDN hiccups and the favicon 404 that python's http.server produces.
 */
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/favicon|fonts\.(googleapis|gstatic)|net::ERR_/i.test(text)) return;
    errors.push(text);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

// =============================================================================
// The homepage.
//
// Three of the tests below were written against the *previous* homepage — a
// generated static document whose altitude readout was `<b class="rail__alt">`
// inside a decorative rail, seeded at 420 m, with the hero call to action
// inside a `.st--valley` section. None of that markup exists any more: the
// homepage is the React Meridian ascent, client-rendered into `#root`, and it
// publishes `data-testid` hooks precisely so tests do not have to name its
// class structure.
//
// They are rewritten here rather than deleted or re-pointed one selector at a
// time. Each one existed to answer a question about the product, and the
// question survived the rewrite even though the markup did not:
//
//   * "loads with the hero, the altimeter and no console errors" asked whether
//     the homepage boots and shows an altitude instrument at all, rather than
//     silently degrading to a plain document. Still the right question. The
//     readout is now `data-testid="altitude-value"` inside
//     `data-testid="altitude-hud"`, and the reduced-motion path deliberately
//     has neither — the HUD owns the clock and there is nothing to advance when
//     nothing moves — so that path asserts the static instrument instead of
//     asserting nothing.
//
//   * "altitude climbs as the visitor scrolls" asked whether the readout is
//     driven by the scroll rather than being a decorative number. Still the
//     right question, with two changed facts: the journey now starts at 0 m
//     rather than 420 m, and its ceiling is 30 000 m. The old assertion
//     `atTop >= 420` was a *seed value* assertion — it described the previous
//     page's decorative starting number and nothing about behaviour — so it is
//     replaced by the range check that does carry meaning.
//
//   * "the hero call to action reaches the questionnaire" asked whether the
//     primary CTA is reachable and lands on the quote page. Still the right
//     question. The `.boot` preloader it waited on no longer exists; waiting
//     for the hero CTA itself to become visible is the same wait with one fewer
//     assumption about how the page starts up.
//
// The remaining assertion that is genuinely gone is the `.rail__alt` markup
// itself. It is not recreated: a decorative rail on the previous homepage is
// not a product requirement, and a test that exists to keep dead markup alive
// is a test that prevents the work it was written to protect.
// =============================================================================
test.describe('homepage', () => {
  /** The live readout, and the two ways the page is allowed not to have one. */
  const readout = (page: Page) => page.getByTestId('altitude-value');

  test('loads with the hero, the altimeter and no console errors', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    if (testInfo.project.name === 'reduced-motion') await enableReducedMotion(page);
    await page.goto('/index.html');

    await expect(page).toHaveTitle(/Stratos/);
    await expect(page.locator('h1')).toBeVisible();

    if (await matchesReducedMotion(page)) {
      // No clock, by design — so the promise here is the static instrument and
      // the readable document, not a live number. Asserting the readout under
      // reduced motion would be asserting a thing the page is deliberately not
      // building.
      await expect(page.getByTestId('journey-fallback')).toBeVisible();
      await expect(readout(page)).toHaveCount(0);
    } else {
      // The altitude readout is the spine of the whole page; if it is missing,
      // the ascent has silently degraded to a plain document.
      await expect(page.getByTestId('altitude-hud')).toBeVisible();
      await expect(readout(page)).toHaveText(/\d/);
    }

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('altitude climbs as the visitor scrolls', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'reduced-motion', 'no scroll-driven clock on that path');
    await page.goto('/index.html');
    await expect(readout(page)).toBeVisible();

    const read = async () => Number((await readout(page).innerText()).replace(/[^\d]/g, ''));

    // The journey begins on the ground. The previous homepage seeded its
    // decorative readout at 420 m; this one starts the ascent at zero and says
    // so, and the damped clock needs a moment to settle onto it after boot.
    await expect(readout(page)).toHaveText('0', { timeout: 10_000 });
    const atTop = await read();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.6));
    await page.waitForTimeout(1_700); // the clock damps towards the scroll position
    const later = await read();

    expect(later, 'the readout did not respond to the scroll').toBeGreaterThan(atTop);
    // The journey is declared as 0 m to 30 000 m. Nothing should read outside it.
    expect(later).toBeLessThanOrEqual(30_000);
    expect(atTop).toBeGreaterThanOrEqual(0);
  });

  test('the page never scrolls sideways', async ({ page }) => {
    await page.goto('/index.html');
    // Measure scrollability, not content width: a decorative layer wider than
    // the glass is fine as long as the visitor cannot drag the page off-centre.
    await page.evaluate(() => window.scrollTo(9999, 0));
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });

  test('has one h1 and a skip link', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('a[href="#main"], a.skip, a[href^="#"]').first()).toBeAttached();
  });

  test('the hero call to action reaches the questionnaire', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'reduced-motion') await enableReducedMotion(page);
    await page.goto('/index.html');

    // The hero's own CTA, by its published hook rather than by its position in
    // the document. Scoping still matters for the same reason it did before —
    // the closing panel carries a second link to the same page — but the reason
    // to prefer the hook is that it survives a layout change and a class rename
    // and still means "the primary call to action in the opening panel".
    const quote = page.getByTestId('cta-primary-hero');
    await expect(quote).toBeVisible({ timeout: 10_000 });
    await expect(quote).toHaveAttribute('href', /arajanlat\.html$/);

    await quote.click();
    await expect(page).toHaveURL(/arajanlat/);
    await expect(page.locator('h1, .quiz').first()).toBeVisible();
  });

  test('the journey initialises: track, stages and the closing call to action', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'reduced-motion') await enableReducedMotion(page);
    await page.goto('/index.html');

    // What "the homepage booted" means, as behaviour rather than as markup: the
    // scroll track exists, every narrative stage rendered into it, and the
    // journey ends on a call to action. This is the assertion the old
    // "the altimeter is present" test was reaching for, made against the thing
    // the page is actually promising.
    await expect(page.getByTestId('journey-track')).toBeAttached();
    await expect(page.locator('[data-testid^="stage-"]')).toHaveCount(11);
    await expect(page.getByTestId('stage-destination')).toBeAttached();
    await expect(page.getByTestId('cta-primary')).toHaveAttribute('href', /arajanlat\.html$/);
    await expect(page.getByTestId('cta-contact')).toHaveAttribute('href', /ugyfelszolgalat\.html$/);
  });

  test('the stage the visitor is in is exposed to assistive technology', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'reduced-motion', 'that path announces its own discrete states');
    await page.goto('/index.html');
    await expect(page.getByTestId('altitude-hud')).toBeVisible();

    // Two live regions and they say different things: where the *page* is, and
    // what the *instrument* has done. Both are announced, both start at the
    // ground state, and both change as the journey progresses — which is the
    // accessible equivalent of the altitude readout the old test watched.
    const stage = page.getByTestId('altitude-stage');
    const instrument = page.getByTestId('meridian-description');
    await expect(stage).toHaveText(/\S/);
    await expect(instrument).toHaveText(/\d/);
    await expect(page.locator('.hud__stage')).toHaveAttribute('aria-live', 'polite');

    const before = { stage: await stage.innerText(), instrument: await instrument.innerText() };
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.75));
    await page.waitForTimeout(2_200);

    expect(
      (await stage.innerText()) !== before.stage || (await instrument.innerText()) !== before.instrument,
      'neither live region changed after three quarters of the journey',
    ).toBe(true);
  });

  for (const [locale, path, quote] of [
    ['hu', '/index.html', 'arajanlat.html'],
    ['en', '/en/index.html', 'quote.html'],
    ['de', '/de/index.html', 'angebot.html'],
  ] as const) {
    test(`the ${locale} homepage is its own entry point with its own links`, async ({ page }) => {
      // Direct entry, not a language switch: each locale is a real page at a
      // real URL, declares its own language, and links into that language's
      // page tree rather than into Hungarian. The previous homepage's tests
      // checked only that /en/ and /de/ returned a document.
      const res = await page.goto(path);
      expect(res?.status(), path).toBeLessThan(400);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('cta-primary-hero')).toHaveAttribute('href', new RegExp(`${quote}$`));
      await expect(page.getByTestId('altitude-value')).toHaveText(/\d/);
    });
  }
});

test.describe('structure and content', () => {
  const pages = [
    '/index.html', '/rolunk.html', '/kkv.html', '/nagyvallalat.html',
    '/branding.html', '/hirdeteskezeles.html', '/impact-program.html',
    '/blog.html', '/ugyfelszolgalat.html', '/arajanlat.html',
  ];

  for (const path of pages) {
    test(`${path} responds and has a title and description`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status(), `${path} status`).toBeLessThan(400);
      await expect(page).toHaveTitle(/.{10,}/);
      const desc = page.locator('meta[name="description"]');
      await expect(desc).toHaveAttribute('content', /.{20,}/);
    });
  }

  test('every image declares alt text', async ({ page }) => {
    await page.goto('/index.html');
    const missing = await page.evaluate(
      () => Array.from(document.images).filter((i) => !i.hasAttribute('alt')).length,
    );
    expect(missing).toBe(0);
  });

  test('the three languages are cross-linked with hreflang', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveCount(1);
    await expect(page.locator('link[rel="alternate"][hreflang="de"]')).toHaveCount(1);
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(1);
  });

  test('English and German homepages render', async ({ page }) => {
    for (const path of ['/en/index.html', '/de/index.html']) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBeLessThan(400);
      await expect(page.locator('h1')).toBeVisible();
    }
  });
});

test.describe('reduced motion', () => {
  test('the ascent degrades to a readable document', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'reduced-motion', 'reduced-motion project only');

    // Activated at runtime and verified inside the page — see
    // tests/helpers/reduced-motion.ts for why the declarative project option is
    // not trusted here.
    const verify = await enableReducedMotion(page);
    await page.goto('/index.html');
    await verify();

    // Every stage must be readable, not just the one currently pinned.
    const hidden = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.st__stage > *'))
        .filter((el) => Number(getComputedStyle(el).opacity) < 0.9).length,
    );
    expect(hidden).toBe(0);

    await expect(page.locator('h1')).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // The test that tests the tests.
  //
  // Everything above depends on the emulation having actually happened. This
  // asserts the mechanism itself, in both directions, so that a Playwright
  // upgrade which changes the behaviour of either `emulateMedia` or the
  // declarative option is caught here — as one obvious failure — rather than by
  // every reduced-motion assertion in the suite quietly becoming a no-op.
  // ---------------------------------------------------------------------------
  test('the reduced-motion test environment is genuinely active', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'reduced-motion', 'reduced-motion project only');

    // 1. Before emulation the page must report the ordinary, animated state.
    //    If this is already true, the assertion below proves nothing.
    await page.goto('/index.html');
    expect(
      await matchesReducedMotion(page),
      'baseline: an un-emulated page in the reduced-motion project should still ' +
        'report false — this is exactly the gap the helper exists to close, and ' +
        'if it now reports true the declarative option has started working and ' +
        'this suite should be re-evaluated',
    ).toBe(false);

    // 2. After emulation it must report the reduced state.
    const verify = await enableReducedMotion(page);
    await page.goto('/index.html');
    await verify();

    // 3. And the media query must be observable by page code the way the
    //    application observes it, not only through Playwright's own view.
    const seenByApp = await page.evaluate(() => ({
      matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      noPreference: matchMedia('(prefers-reduced-motion: no-preference)').matches,
    }));
    expect(seenByApp.matches).toBe(true);
    expect(seenByApp.noPreference).toBe(false);
  });
});

test.describe('deploy artefacts', () => {
  test('robots.txt keeps the portal out of the index', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('Disallow: /portal');
    expect(body).toContain('Sitemap:');
  });

  test('sitemap.xml lists all three languages', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('<urlset');
    expect(body).toContain('/en/index.html');
    expect(body).toContain('/de/index.html');
    expect(body).toContain('hreflang="x-default"');
  });

  /**
   * The site is served under `script-src 'self'` with no 'unsafe-inline'. An
   * inline <script> is therefore refused by the browser — and a CSP refusal is
   * not a JavaScript error, so nothing throws and the console stays clean. The
   * quote wizard shipped inline in all three languages and rendered an empty
   * page in production for exactly that reason; `externalise_js` in
   * _build/build.py now writes it out as a real file.
   *
   * This walks the built output rather than one URL, because the failure is
   * silent and the next page to grow an inline script would fail the same way.
   */
  test('no built page carries an executable inline script', () => {
    // Same folder the webServer in playwright.config.ts serves.
    const dist = path.join(process.cwd(), 'dist');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'portal') walk(full);   // the SPA ships its own bundle
        } else if (entry.name.endsWith('.html')) {
          const html = fs.readFileSync(full, 'utf8');
          // A <script> with a `type` is a data block (the i18n JSON), not code.
          const inline = [...html.matchAll(
            /<script(?![^>]*\bsrc=)(?![^>]*\btype=)[^>]*>([\s\S]*?)<\/script>/g)];
          if (inline.some((m) => m[1].trim().length > 0)) {
            offenders.push(path.relative(dist, full));
          }
        }
      }
    };

    walk(dist);
    expect(offenders, `inline <script> is blocked by script-src 'self'`).toEqual([]);
  });
});
