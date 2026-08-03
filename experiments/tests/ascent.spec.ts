import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  assertReducedMotionActive,
  assertReducedMotionInactive,
  enableReducedMotion,
  matchesReducedMotion,
} from '../../tests/helpers/reduced-motion';

// =============================================================================
// The 3D prototype. These tests answer the questions that decide whether the
// approach is viable at all — does it hold up without WebGL, does it respect a
// reduced-motion request, what does it actually cost to load — rather than
// asserting that a canvas element exists.
// =============================================================================

const SHOTS = resolve(process.cwd(), 'experiments/screenshots');
const shot = (page: Page, name: string) =>
  page.screenshot({ path: resolve(SHOTS, `${name}.png`), animations: 'disabled' });

test.beforeAll(async () => {
  await mkdir(SHOTS, { recursive: true });
});

/**
 * Reduced motion is emulated at runtime, never declared and trusted — see
 * tests/helpers/reduced-motion.ts for the full reasoning.
 *
 * Emulating in `beforeEach` gets the state in place before any `page.goto()` in
 * a test body, which matters because the app reads the media query once, during
 * its capability probe. Activation alone is not enough, though: each test in the
 * reduced-motion project also verifies the query *after* navigating, via
 * `assertReducedMotionActive`. Without that second half this hook is exactly as
 * silent a failure as the declarative option it replaces.
 */
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'reduced-motion') {
    await enableReducedMotion(page);
  }
});

/** Projects that should be running the WebGL path. */
const isMotionProject = (name: string) => name !== 'reduced-motion';

/**
 * Scroll to a fraction of *the track*, not of the document.
 *
 * They are not the same thing: the footer sits below the track, so scrolling to
 * the bottom of the document lands past the end of the ascent, with the sticky
 * stage already gone. Fraction 1.0 here means "the last chapter, centred",
 * which is what every assertion about the 8 000 m ceiling actually means.
 */
async function scrollTo(page: Page, fraction: number) {
  await page.evaluate((f) => {
    const track = document.querySelector('[data-testid="ascent-track"]') as HTMLElement | null;
    const travel = track ? track.offsetHeight - innerHeight : document.documentElement.scrollHeight - innerHeight;
    scrollTo({ top: (track?.offsetTop ?? 0) + travel * f, behavior: 'instant' as ScrollBehavior });
  }, fraction);
  // The readout damps toward the scroll position rather than snapping to it.
  await page.waitForTimeout(1400);
}

const readAltitude = async (page: Page) => {
  const text = await page.getByTestId('altitude-value').textContent();
  return Number((text ?? '0').replace(/[^\d]/g, ''));
};

// -----------------------------------------------------------------------------
test.describe('the prototype renders', () => {
  // Deliberately not restricted to Chromium. The mobile project is an iPhone 13,
  // which Playwright drives with WebKit — the harshest WebGL environment the
  // prototype would ever meet in production, and therefore the one worth
  // asserting against rather than skipping.
  test.beforeEach(({}, info) => {
    test.skip(!isMotionProject(info.project.name), 'there is no canvas under reduced motion');
  });

  test('loads the scene and the instrument with no console errors', async ({ page }, info) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    // Armed before navigating: the model is preloaded as soon as the scene
    // chunk evaluates, which can be before the canvas is painted. Waiting for
    // it afterwards is a race that loses on a warm cache.
    const model = page.waitForResponse(
      (r) => r.url().includes('stratos-altimeter.glb') && r.status() === 200,
      { timeout: 20_000 },
    );

    await page.goto('./');

    // The mirror image of the reduced-motion guard: this test asserts the
    // animated path, so it should fail loudly if it ever finds itself running
    // with reduced motion on rather than quietly asserting the fallback.
    await assertReducedMotionInactive(page);

    await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });

    // The GLB is genuinely fetched — a canvas rendering an empty scene would
    // pass a weaker assertion than this one.
    const response = await model;
    expect(Number(response.headers()['content-length'] ?? 0)).toBeGreaterThan(1000);

    expect(errors, `console errors on ${info.project.name}`).toEqual([]);
  });

  test('the altitude readout climbs from 0 to the 8 000 m ceiling', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });

    await scrollTo(page, 0);
    expect(await readAltitude(page)).toBeLessThan(200);

    await scrollTo(page, 0.5);
    const middle = await readAltitude(page);
    expect(middle).toBeGreaterThan(2500);
    expect(middle).toBeLessThan(6000);

    await scrollTo(page, 1);
    const top = await readAltitude(page);
    expect(top).toBeGreaterThan(7000);
    expect(top).toBeLessThanOrEqual(8000);
  });

  test('the rendered scene actually changes as the ascent progresses', async ({ page }) => {
    await page.goto('./');
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    await scrollTo(page, 0.02);
    const ground = await canvas.screenshot();
    await scrollTo(page, 0.95);
    const cloud = await canvas.screenshot();

    // Needle, camera, fog and cloud layer all move; if the buffers match, none
    // of them did, and the scroll wiring is dead however good the stills look.
    expect(Buffer.compare(ground, cloud)).not.toBe(0);
  });

  test('never scrolls sideways', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });
    for (const f of [0, 0.5, 1]) {
      await scrollTo(page, f);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at ${f}`).toBeLessThanOrEqual(1);
    }
  });
});

// -----------------------------------------------------------------------------
test.describe('the content survives without the canvas', () => {
  test('has exactly one h1, a skip link, and real calls to action', async ({ page }) => {
    await page.goto('./');

    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('a.skip')).toHaveAttribute('href', '#ascent-content');

    // The CTA is a real anchor with a real href, not a canvas hit region.
    const cta = page.locator('a.btn', { hasText: 'Váltsuk valóra' });
    await expect(cta).toHaveAttribute('href', '/arajanlat.html');
    await expect(page.locator('a.btn', { hasText: 'Jelenlegi főoldal' })).toHaveAttribute(
      'href',
      '/index.html',
    );

    // Every chapter's prose is in the document, canvas or no canvas.
    await expect(page.locator('section.chapter')).toHaveCount(5);
    for (const section of await page.locator('section.chapter').all()) {
      expect((await section.innerText()).trim().length).toBeGreaterThan(60);
    }
  });
});

// -----------------------------------------------------------------------------
test.describe('reduced motion', () => {
  test('swaps to the static instrument and never downloads three.js', async ({ page }, info) => {
    test.skip(isMotionProject(info.project.name), 'asserted in the reduced-motion project');

    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));

    await page.goto('./');

    // Before anything else: prove the environment is what this test claims it
    // is. Every assertion below describes the reduced-motion path, and all of
    // them would be describing the ordinary path if this were false.
    await assertReducedMotionActive(page);

    await expect(page.getByTestId('prototype-fallback')).toBeVisible();
    await expect(page.getByTestId('prototype-fallback')).toHaveAttribute(
      'data-reason',
      'reduced-motion',
    );
    await expect(page.locator('canvas')).toHaveCount(0);

    // The whole point of the lazy boundary: refusing the animation must also
    // refuse its download.
    await page.waitForTimeout(1200);
    const heavy = requested.filter((u) => /three|r3f|gsap|ScrollTrigger|\.glb/.test(u));
    expect(heavy, 'reduced motion must not fetch the 3D payload').toEqual([]);

    // And the document still reads.
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('section.chapter')).toHaveCount(5);
  });
});

// -----------------------------------------------------------------------------
// Guards the test environment itself rather than the prototype. If the runtime
// emulation ever stops working, every assertion in the block above silently
// starts describing the animated page; this fails instead.
test.describe('reduced-motion test environment', () => {
  test('emulation reaches matchMedia, and the declarative option alone does not', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'reduced-motion', 'about the reduced-motion project');

    // `beforeEach` already emulated for this project, so drop it first to
    // observe the declarative option on its own.
    await page.emulateMedia({ reducedMotion: null });
    await page.goto('./');
    expect(
      await matchesReducedMotion(page),
      'the project declares reducedMotion: reduce — if this is now true the ' +
        'declarative option has started working and the helper can be revisited',
    ).toBe(false);

    // With the option on its own the prototype takes the animated path, which
    // is precisely the bug: a config-only reduced-motion project renders a
    // canvas.
    await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });

    // Now the runtime emulation, and the fallback it is supposed to produce.
    const verify = await enableReducedMotion(page);
    await page.goto('./');
    await verify();
    await expect(page.getByTestId('prototype-fallback')).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
  });
});

// -----------------------------------------------------------------------------
test.describe('no WebGL', () => {
  test('falls back to the static instrument when a context cannot be made', async ({ page }, info) => {
    test.skip(!isMotionProject(info.project.name), 'covered by the reduced-motion path');

    // Deny WebGL the way a blocklisted driver does: the constructor is still
    // there, context creation just fails.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
        if (typeof type === 'string' && type.includes('webgl')) return null;
        // @ts-expect-error — passing through to the original signature
        return original.call(this, type, ...rest);
      };
    });

    await page.goto('./');
    await expect(page.getByTestId('prototype-fallback')).toBeVisible();
    await expect(page.getByTestId('prototype-fallback')).toHaveAttribute('data-reason', 'no-webgl');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByTestId('altitude-hud')).toBeVisible();
  });
});

// -----------------------------------------------------------------------------
test.describe('cost', () => {
  test('records what the prototype transfers before and after the scene loads', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'measured once, on desktop');

    const bytes = new Map<string, number>();
    page.on('response', (r) => {
      const len = Number(r.headers()['content-length'] ?? 0);
      if (len) bytes.set(r.url(), len);
    });
    const model = page.waitForResponse((r) => r.url().includes('stratos-altimeter.glb'), {
      timeout: 20_000,
    });

    await page.goto('./');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });
    await model;
    await page.waitForTimeout(800);

    const total = [...bytes.values()].reduce((a, b) => a + b, 0);
    const shell = [...bytes.entries()]
      .filter(([u]) => !/three-|r3f-|gsap-|ScrollTrigger-|AscentScene-|\.glb/.test(u))
      .reduce((a, [, b]) => a + b, 0);

    // Recorded, not gated: the number is the finding. A hard budget here would
    // only ever be a number invented in this file.
    console.log(
      `\n  prototype transfer (uncompressed):\n` +
        `    document + css + app shell : ${(shell / 1024).toFixed(1)} KB\n` +
        `    everything, scene included : ${(total / 1024).toFixed(1)} KB\n`,
    );
    expect(total).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
test.describe('evaluation stills', () => {
  test('captures the sequence for review', async ({ page }, info) => {
    const name = info.project.name;

    if (name === 'reduced-motion') {
      await page.goto('./');
      await assertReducedMotionActive(page);
      await expect(page.getByTestId('prototype-fallback')).toBeVisible();
      await shot(page, 'reduced-motion');
      return;
    }

    await page.goto('./');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1800); // let the environment map and model settle

    // The hero is captured at rest, not slightly scrolled: that is the frame a
    // visitor actually lands on.
    if (name === 'mobile') {
      await scrollTo(page, 0);
      await shot(page, 'mobile-hero');
      await scrollTo(page, 0.5);
      await shot(page, 'mobile-mid-ascent');
      await scrollTo(page, 1);
      await shot(page, 'mobile-cloud-layer');
      return;
    }

    await scrollTo(page, 0);
    await shot(page, 'desktop-hero');
    await scrollTo(page, 0.45);
    await shot(page, 'desktop-mid-ascent');
    await scrollTo(page, 1);
    await shot(page, 'desktop-cloud-layer');
  });
});
