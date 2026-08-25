import { test, expect, type Page } from '@playwright/test';
import { homepageReady } from './helpers/homepage';

/**
 * The homepage before the journey, and the moment it becomes the journey.
 *
 * ## What is under test
 *
 * `experiments/src/full/main.tsx` no longer mounts on load. The document ships
 * its own opening frame — the headline, the lead sentence and the primary
 * action, generated into the shell at build time from the same `MESSAGES`
 * entries both compositions read — and the React application is imported on the
 * visitor's first move.
 *
 * That is the change that took Total Blocking Time from 1 470 ms to under 100
 * on the device Lighthouse emulates, and moved the largest contentful paint off
 * the footer's headline and onto the page's own. It is also a real behavioural
 * difference, which is why it has a test of its own rather than being implied
 * by the suites that assert what the mounted page does.
 *
 * ## Why this file does not use `bootJourneyOnLoad`
 *
 * Every other homepage suite arms that helper in a `beforeEach`, because those
 * tests are about a page a visitor is reading. This one is about the two
 * states either side of the first move, so it has to see both — and it makes
 * the move itself, with a real pointer, through the same listener a finger
 * reaches.
 */

/** The one composition-agnostic signal that React has taken the landmark. */
const mountedCount = (page: Page) =>
  page.locator('[data-testid="mobile-home"], [data-testid="journey-track"]').count();

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
    await expect(frame.locator('.jboot__act a')).toHaveAttribute('href', /\.html$/);

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
       cannot be, as long as it starts below the fold. */
    const arrivalTop = await page
      .locator('.arrival')
      .first()
      .evaluate((el) => el.getBoundingClientRect().top);
    const viewport = page.viewportSize()?.height ?? 0;

    // One pixel of slack: `100svh` and the viewport agree to within rounding on
    // a desktop engine, and the claim is "below the fold", not "at exactly it".
    expect(arrivalTop, 'the Arrival opens inside the first viewport again').toBeGreaterThanOrEqual(
      viewport - 1,
    );
  });

  test('the first move starts the journey, and the frame gets out of its way', async ({ page }) => {
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
  });
});
