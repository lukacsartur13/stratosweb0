import { test, expect, type Page } from '@playwright/test';
import { homepageReady } from './helpers/homepage';

/**
 * The homepage before the journey, and the moment it becomes the journey.
 *
 * ## What is under test
 *
 * `experiments/src/full/main.tsx` does not mount the journey on load. React,
 * both compositions and three.js are imported on the visitor's first move —
 * the change that took Total Blocking Time from 1 470 ms to under 100 on the
 * device Lighthouse emulates, and moved the largest contentful paint off the
 * footer's headline and onto the page's own.
 *
 * What is NOT deferred any more is what the journey says. The shell ships the
 * opening frame (headline, lead sentence, primary action) and, under it, the
 * other ten stages set plainly — every heading and paragraph, the six client
 * marks as images with alt text, the featured case and its links — generated
 * at build time from the same tables both compositions render. The contract
 * this file used to state was "nothing of the journey before the first move",
 * and that contract is what kept the journey out of search: a crawler never
 * moves, and Googlebot's smartphone render of the Hungarian homepage had 881
 * words, no "Hat terület" stage, no marks, and no link to the Rapidkert case.
 * The contract now is: the words before the first move, the composition
 * after it.
 *
 * ## Why this file does not use `bootJourneyOnLoad`
 *
 * Every other homepage suite arms that helper in a `beforeEach`, because those
 * tests are about a page a visitor is reading. This one is about the two
 * states either side of the first move, so it has to see both — and it makes
 * the move itself, with a real pointer, through the same listener a finger
 * reaches.
 */

/** The one composition-agnostic signal that React has taken the host. */
const mountedCount = (page: Page) =>
  page.locator('[data-testid="mobile-home"], [data-testid="journey-track"]').count();

/** What each locale's static narrative must carry, as a reader sees it. */
const LOCALES = [
  { path: '/', stage: 'Hat terület', caseHref: '/munka-rapidkert', quoteHref: '/arajanlat' },
  { path: '/en/', stage: 'Six areas', caseHref: '/en/work-rapidkert', quoteHref: '/en/quote' },
  { path: '/de/', stage: 'Sechs Bereiche', caseHref: '/de/projekt-rapidkert', quoteHref: '/de/angebot' },
] as const;

/** The six collaboration marks, by the alt text both compositions give them. */
const MARKS = [
  'Kontyos.hu',
  'Grantool Kft.',
  'Synergy Digital Hungary Kft.',
  'Duna Hajók',
  'Duna Enterior',
  'Barbershop Győr',
];

test.describe('the homepage says something before the journey exists', () => {
  test('the opening frame is in the document, and nothing has mounted behind it', async ({
    page,
  }) => {
    const models: string[] = [];
    page.on('request', (r) => {
      if (/\.glb($|\?)/i.test(r.url())) models.push(r.url());
    });

    await page.goto('/index.html');
    await page.waitForLoadState('load');

    const frame = page.locator('main#main [data-journey-opening]');
    await expect(frame, 'the shell shipped no opening frame').toBeVisible();

    // A headline, a sentence and a way out. Below any of those it is a
    // placeholder rather than an opening.
    await expect(frame.locator('h1')).toHaveText(/\S/);
    await expect(frame.locator('.jboot__lede')).toHaveText(/\S/);
    // The canonical, extensionless URL — not the `.html` form production
    // redirects away from.
    await expect(frame.locator('.jboot__act a')).toHaveAttribute('href', '/arajanlat');

    // And it is the page's only h1 while it is the page.
    await expect(page.locator('h1')).toHaveCount(1);

    expect(await mountedCount(page), 'the journey mounted without being asked').toBe(0);
    expect(await page.locator('canvas').count(), 'a renderer started on load').toBe(0);
    expect(models, 'a 3D model was fetched before the visitor did anything').toEqual([]);
  });

  test('the frame clears the fold, so what arrives underneath it arrives off screen', async ({
    page,
  }) => {
    await page.goto('/index.html');
    await page.waitForLoadState('load');

    /* This is the layout-shift fix stated as a geometry claim rather than as a
       metric. The Arrival used to open *inside* the first viewport and be
       pushed thirteen screens down when the journey mounted — one displacement,
       measured at a Cumulative Layout Shift of 1.000 against a 0.1 budget. It
       cannot be, as long as it starts below the fold. The static narrative is
       held to the same rule: the first screen is the opening frame and only
       the opening frame, exactly as it was before the narrative shipped. */
    const viewport = page.viewportSize()?.height ?? 0;
    for (const selector of ['[data-journey-static]', '.arrival']) {
      const top = await page
        .locator(selector)
        .first()
        .evaluate((el) => el.getBoundingClientRect().top);
      // One pixel of slack: `100svh` and the viewport agree to within rounding
      // on a desktop engine, and the claim is "below the fold", not "at it".
      expect(top, `${selector} opens inside the first viewport`).toBeGreaterThanOrEqual(viewport - 1);
    }
  });

  test('the first move starts the journey, and the static text gets out of its way', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForLoadState('load');
    expect(await mountedCount(page)).toBe(0);

    // A real event on the real listener, and `move` rather than `wheel`
    // because `mouse.wheel` is not available on every engine this suite runs
    // on. A pointer crossing the document is the first of the seven types
    // `main.tsx` arms, and on a laptop it is genuinely what happens first.
    await page.mouse.move(40, 40);
    await page.mouse.move(200, 300);

    await homepageReady(page);
    expect(await mountedCount(page), 'the first move did not start the journey').toBeGreaterThan(0);
    await expect(
      page.locator('[data-journey-opening]'),
      'the opening frame outlived the composition that replaced it',
    ).toHaveCount(0);
    await expect(
      page.locator('[data-journey-static]'),
      'the static narrative outlived the composition that replaced it',
    ).toHaveCount(0);
    // One copy of every stage id, now the composition's.
    await expect(page.locator('#stage-selected-work')).toHaveCount(1);

    // The renderer is decoration: whatever canvas the composition draws on is
    // hidden from assistive technology on the element itself.
    const canvases = page.locator('canvas');
    await canvases.first().waitFor({ state: 'attached', timeout: 20_000 });
    expect(
      await canvases.evaluateAll((all) => all.map((c) => c.getAttribute('aria-hidden'))),
      'a journey canvas is exposed to assistive technology',
    ).toEqual(Array(await canvases.count()).fill('true'));
  });
});

test.describe('the journey’s words are in the document before the journey is', () => {
  for (const { path, stage, caseHref, quoteHref } of LOCALES) {
    test(`${path}: in the HTML as served, and visible with no interaction`, async ({ page, request }) => {
      /* The raw document first: what a crawler that does not run scripts, or
         runs them and never moves, receives. */
      const html = await (await request.get(path)).text();
      expect(html, 'the stage headline is not in the served HTML').toContain(stage);
      expect(html, 'the Rapidkert case link is not in the served HTML').toContain(`href="${caseHref}"`);
      for (const name of MARKS) {
        expect(html, `the ${name} mark is not in the served HTML`).toContain(`alt="${name}"`);
      }

      // The parsed document is the claim, so there is nothing to wait for past
      // DOMContentLoaded — the lazy images and fonts do not change it.
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      expect(await mountedCount(page), 'the journey mounted without being asked').toBe(0);

      const text = page.locator('main#main [data-journey-static]');
      // Ten stages: the eleven of the journey less the opening, which is the
      // frame above. Under ids of their own (`jtext-…`), never the
      // composition's `stage-…` — a shared id is a selector the browser's
      // Back-button restore can match in the wrong document; see `STATIC_ID`
      // in experiments/src/full/readerPlace.ts.
      await expect(text.locator('section[id^="jtext-"]')).toHaveCount(10);
      await expect(page.locator('[id^="stage-"]')).toHaveCount(0);
      await expect(text.locator('h2')).toHaveCount(10);

      /* Rendered, not merely present: a real box, not display:none, not
         visibility:hidden, not faded out, not clipped into a visually-hidden
         pixel. No text on this page exists for crawlers only. Read where it
         is rather than scrolled to — a scroll is a first move, and would start
         the journey this test is asserting the absence of. */
      const heading = text.locator('h2', { hasText: stage });
      await expect(heading).toBeVisible();
      expect(await heading.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
      const box = await heading.boundingBox();
      expect(box && box.width > 100 && box.height > 10, 'the stage headline has no real box').toBe(true);

      const marks = text.locator('.jtext__marks img');
      await expect(marks).toHaveCount(MARKS.length);
      expect(await marks.evaluateAll((all) => all.map((i) => i.getAttribute('alt')))).toEqual(MARKS);

      await expect(text.locator(`a[href="${caseHref}"]`)).toHaveCount(1);
      await expect(text.locator(`a[href="${quoteHref}"]`).first()).toBeAttached();

      // Every in-page link in the static text lands on something that exists.
      const dangling = await text.evaluate((root) =>
        [...root.querySelectorAll('a[href^="#"]')]
          .map((a) => a.getAttribute('href')!)
          .filter((href) => !document.getElementById(href.slice(1))),
      );
      expect(dangling, 'a static stage link points at nothing').toEqual([]);

      // And the statement is inside the landmark now, after the journey.
      await expect(page.locator('main#main > .ground')).toHaveCount(1);
    });
  }
});

test.describe('a link into the page below the journey keeps its place', () => {
  test('/#ground-h: the target does not move when the journey mounts above it', async ({ page }) => {
    /* The defect: a fragment link into the statement under the journey landed
       on its target, and then the journey mounted above it — ten to nineteen
       thousand pixels of it — and carried the reader away. Measured on the
       build before the fix: the target 18 676 px below the viewport on a
       1440×900 Chromium, CLS 1.0.

       The journey's chunk is held at the network until the target's position
       on the static page has been read, so the two readings are either side of
       the mount and nothing else. */
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/assets\/home\/boot-[^/]*\.js/, async (route) => {
      await gate;
      await route.continue();
    });

    await page.goto('/#ground-h');
    await page.waitForLoadState('load');
    const target = page.locator('#ground-h');
    const before = await target.evaluate((el) => el.getBoundingClientRect().top);
    const viewport = page.viewportSize()?.height ?? 0;
    expect(before, 'the fragment did not land on its target').toBeGreaterThanOrEqual(0);
    expect(before).toBeLessThan(viewport / 2);
    expect(await mountedCount(page)).toBe(0);

    release();
    await homepageReady(page);
    // Let the composition settle: its own effects resize the track after the
    // first commit, and each of those is a chance to move the reader.
    await page.waitForTimeout(1_500);
    expect(await mountedCount(page)).toBeGreaterThan(0);

    const after = await target.evaluate((el) => el.getBoundingClientRect().top);
    // A band, not a pixel: an engine that re-scrolls to the fragment itself
    // applies its own scroll padding, which the portrait composition sets a
    // few pixels differently. What must not happen is the reader leaving the
    // screen they arrived on.
    expect(Math.abs(after - before), `the target moved from ${before} to ${after}`).toBeLessThan(40);
  });

  test('/#stage-selected-work: the link lands on that stage once the journey exists', async ({ page }) => {
    /* A link into the journey itself names the composition's id, which has no
       element until the mount. It used to be left at the top of the page; the
       mount now takes the reader to the stage the link names. */
    await page.goto('/#stage-selected-work');
    await homepageReady(page);
    await page.waitForTimeout(1_500);
    const top = await page.locator('#stage-selected-work').evaluate((el) => el.getBoundingClientRect().top);
    const viewport = page.viewportSize()?.height ?? 0;
    expect(top, 'the stage the link names is not on screen').toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(viewport / 2);
  });
});
