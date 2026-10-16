import { test, expect, type Page } from './helpers/navigation-boundary';
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
// Since 2026-10-16 the homepage is a generated static document on the v2 shell
// (_build/pages/index.html), not the React/WebGL ascent these tests used to
// drive. The questions they asked mostly survive — does it load cleanly, does
// the primary action reach the questionnaire, is every locale its own entry
// point — and they are asked of the new page. The questions that were about
// the instrument (altitude, stages, live regions) went with it.
//
// Two are new, and they are the redesign's own non-negotiables, so they are
// asserted rather than trusted: nothing on the page asks for WebGL, and every
// scene is in the HTML before a single script has run.
// =============================================================================
/**
 * Scroll the page to its end in reading-sized steps, the way a visitor does, so
 * anything that waits to be seen has been seen. By script rather than the
 * wheel: mobile WebKit has no wheel to emulate.
 */
async function readToTheEnd(page: Page) {
  await page.evaluate(async () => {
    const step = Math.round(innerHeight * 0.6);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
  });
  await page.waitForTimeout(500);
}

const SCENES = ['.hero', '.take', '.still', '.gdf', '.caps', '.ways', '.marks', '.close'];

test.describe('homepage', () => {
  test('loads as a static document: no errors, no canvas, no WebGL, no bundle', async ({ page }) => {
    const errors = collectErrors(page);
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.addInitScript(() => {
      const w = window as unknown as { __gl: number };
      w.__gl = 0;
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/i.test(type)) w.__gl += 1;
        return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    await page.goto('/index.html');
    // Read it the way a visitor does, to the end, so anything lazy has asked.
    await readToTheEnd(page);

    expect(errors).toEqual([]);
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __gl: number }).__gl)).toBe(0);
    await expect(page.locator('script[type="module"]')).toHaveCount(0);
    expect(requests.filter((u) => /\.glb(\?|$)|\/draco\/|\/models\/|\/assets\/home\//.test(u))).toEqual([]);
  });

  test('the page never scrolls sideways', async ({ page }) => {
    await page.goto('/index.html');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('has one h1 and a skip link', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('a.skip[href="#main"]')).toHaveCount(1);
  });

  test('the hero call to action reaches the questionnaire', async ({ page }) => {
    await page.goto('/index.html');
    const cta = page.locator('.hero a.btn');
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', '/arajanlat.html');
    await cta.click();
    await expect(page).toHaveURL(/\/arajanlat(\.html)?$/);
  });

  test('the GoDataFusion screen follows the mode that is chosen', async ({ page }) => {
    await page.goto('/index.html');
    const modes = page.locator('.gdf [data-mode]');
    await expect(modes).toHaveCount(3);
    await modes.nth(1).scrollIntoViewIfNeeded();
    await modes.nth(1).click();
    await expect(modes.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(modes.nth(0)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.gdf [data-mode-panel="1"]')).toHaveClass(/is-active/);
    await expect(page.locator('.gdf [data-mode-panel="0"]')).toHaveAttribute('aria-hidden', 'true');
  });

  for (const [locale, path, quote, work] of [
    ['hu', '/index.html', '/arajanlat.html', '/munkaink.html'],
    ['en', '/en/index.html', '/en/quote.html', '/en/work.html'],
    ['de', '/de/index.html', '/de/angebot.html', '/de/projekte.html'],
  ] as const) {
    test(`the ${locale} homepage is its own entry point with its own links`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status(), path).toBeLessThan(400);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('.hero a.btn')).toHaveAttribute('href', quote);
      await expect(page.locator(`.hdr a[href="${work}"]`).first()).toHaveCount(1);
      // Every in-site link on the page points into this language's tree (or at
      // a shared asset), never back into Hungarian by accident.
      if (locale !== 'hu') {
        const stray = await page.evaluate((lang) =>
          Array.from(document.querySelectorAll<HTMLAnchorElement>('main a[href^="/"]'))
            .map((a) => a.getAttribute('href') as string)
            .filter((h) => !h.startsWith(`/${lang}/`)), locale);
        expect(stray, 'Hungarian links on a translated homepage').toEqual([]);
      }
    });
  }
});

test.describe('homepage, without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('every scene, every word and every link is in the HTML', async ({ page }) => {
    await page.goto('/index.html');
    for (const scene of SCENES) await expect(page.locator(`main ${scene}`), scene).toHaveCount(1);
    await expect(page.locator('main h2')).toHaveCount(7);
    // The proof, as the case study states it.
    await expect(page.locator('.take')).toContainText('~110M Ft');
    await expect(page.locator('.take')).toContainText('Ajánlatkérési érték organikus keresésből');
    // Both projects, and every service page, linked from the homepage.
    for (const href of ['/munka-rapidkert.html', '/munka-godatafusion.html', '/szolgaltatasok.html',
      '/kkv.html', '/nagyvallalat.html', '/webshop-keszites.html', '/branding.html',
      '/keresooptimalizalas.html', '/hirdeteskezeles.html', '/arajanlat.html']) {
      await expect(page.locator(`main a[href="${href}"]`).first(), href).toHaveCount(1);
    }
    // Nothing is waiting for a script to become visible.
    const hidden = await page.evaluate(() =>
      Array.from(document.querySelectorAll('main *'))
        .filter((el) => el.matches('.is-pre, .is-dim')).length);
    expect(hidden).toBe(0);
  });

  test('the SME pricing argument is not on the homepage', async ({ page }) => {
    // It lives on /kkv, which the homepage links to; the homepage argues for
    // the conversation, not for a fee model.
    await page.goto('/index.html');
    const text = (await page.locator('main').innerText()).toLowerCase();
    for (const phrase of ['projektdíj', 'mennyibe kerül', 'havidíj', 'havi díj']) {
      expect(text, phrase).not.toContain(phrase);
    }
  });
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
  test('the homepage is complete and lit without motion', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'reduced-motion', 'reduced-motion project only');

    // Activated at runtime and verified inside the page — see
    // tests/helpers/reduced-motion.ts for why the declarative option is not
    // trusted here.
    const verify = await enableReducedMotion(page);
    await page.goto('/index.html');
    await verify();

    // Reduced motion is not a degraded mode: the static state is the design.
    // Nothing is ever put into its pre-state, so nothing waits to be revealed
    // or lit, wherever the reader is on the page.
    await readToTheEnd(page);
    const waiting = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-reveal], [data-light]'))
        .filter((el) => el.matches('.is-pre, .is-dim') || Number(getComputedStyle(el).opacity) < 0.99).length);
    expect(waiting).toBe(0);
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
  test('robots.txt lets crawlers read the portal noindex, and the header is there', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    // A Disallow would hide the X-Robots-Tag that keeps /portal out of the
    // index, and leave the bare URL indexable from links.
    expect(body).not.toContain('Disallow: /portal');
    expect(body).toContain('Disallow: /api/');
    expect(body).toContain('Sitemap:');
    const toml = fs.readFileSync(path.resolve(process.cwd(), 'netlify.toml'), 'utf8');
    expect(toml).toMatch(/for = "\/portal\/\*"[\s\S]*?X-Robots-Tag = "noindex/);
  });

  test('sitemap.xml lists all three languages', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('<urlset');
    // The three homepages are `/`, `/en/` and `/de/`, NOT `/index.html`. This
    // assertion used to name the filenames, which is how the sitemap came to
    // offer three URLs that each carried a canonical pointing somewhere else —
    // the test agreed with the generator and both were wrong about the site.
    // See `absolute()` in _build/build.py.
    expect(body).toMatch(/<loc>https?:\/\/[^/]+\/en\/<\/loc>/);
    expect(body).toMatch(/<loc>https?:\/\/[^/]+\/de\/<\/loc>/);
    expect(body).not.toContain('index.html');
    expect(body).toContain('hreflang="x-default"');
  });

  /**
   * Every URL offered to a crawler must be the URL that page claims for itself.
   *
   * A sitemap entry whose page canonicalises elsewhere is not an error anyone
   * sees: the page is fine, the sitemap is well-formed, and the only symptom is
   * crawl budget spent proving two URLs are the same page. It is exactly the
   * kind of thing that stays wrong for a year, so it is asserted rather than
   * reviewed.
   *
   * Also the one place `<lastmod>` is checked — see the note in
   * scripts/assemble.mjs. A build-clock lastmod tells every crawler that all 60
   * pages changed on every deploy, and a signal that always says "everything
   * changed" carries the same information as one that never changes. Since
   * 2026-10-10 only the Hungarian blog posts carry one, and it must be the
   * date the post itself states (front matter, from git), never today's.
   */
  test('every sitemap URL is the canonical of the page it points at', async ({ request }) => {
    const body = await (await request.get('/sitemap.xml')).text();
    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(50);
    const manifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '_build', 'routes.json'), 'utf8'));
    for (const m of body.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) {
      const name = new URL(m[1]).pathname.replace(/^\//, '') + '.html';
      const key = Object.keys(manifest.slugs).find((k) => manifest.slugs[k].hu === name);
      expect(key && key.startsWith('post-'), `${m[1]}: lastmod on a page that is not a Hungarian post`).toBe(true);
      expect(m[2], `${m[1]} lastmod`).toBe(manifest.updated[key!]);
    }
    expect([...body.matchAll(/<lastmod>/g)].length, 'one lastmod per Hungarian post').toBe(Object.keys(manifest.updated).length);

    for (const loc of locs) {
      const path = new URL(loc).pathname;
      const res = await request.get(path);
      expect(res.status(), `${path} must be served`).toBe(200);

      const html = await res.text();
      const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
      expect(canonical, `${path} must declare a canonical`).toBeTruthy();
      expect(new URL(canonical!).pathname, `${path} canonical`).toBe(path);

      // And nothing in the sitemap may be noindex — the two statements
      // contradict each other and the crawler has to resolve it.
      expect(html, `${path} must not be noindex`).not.toMatch(/name="robots"[^>]*noindex/);
    }
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
