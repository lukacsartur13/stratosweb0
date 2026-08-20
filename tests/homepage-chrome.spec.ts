import { test, expect, type Page } from '@playwright/test';
import { enableReducedMotion, matchesReducedMotion } from './helpers/reduced-motion';
import { altitudeMetres, homepageReady, stageReadout } from './helpers/homepage';

/**
 * The homepage's site chrome: the flight deck, the full-screen navigation, the
 * Arrival convergence and the ground-control footer.
 *
 * WHY THIS FILE IS SEPARATE FROM public-site.spec.ts
 * --------------------------------------------------
 * That file asks whether the *journey* works — the track, the stages, the
 * altitude clock, the closing CTA. This one asks whether the homepage is part
 * of the website: whether you can navigate away from it, whether the header
 * says where you are, and whether the footer under it is the same footer the
 * other 66 routes carry. Those are different questions with different failure
 * modes, and mixing them makes both harder to read.
 *
 * WHY IT ASSERTS AGAINST dist/
 * ----------------------------
 * The chrome is not written in the React bundle and it is not written in the
 * locale shells. `_build/build.py` renders it into `_build/home-chrome.json`
 * and `experiments/vite.home.config.ts` substitutes it into the three shells at
 * build time. A test against the dev server would exercise a different
 * substitution path from the one that ships; a test against the sources would
 * not exercise the substitution at all. The built page is the only artefact
 * where "the homepage has a header" is a fact rather than an intention.
 *
 * THE ONE THING THAT IS NOT ASSERTED HERE
 * ---------------------------------------
 * Visual weight. Whether the opening header is restrained enough over the
 * valley, and whether the destination state resolves rather than appears, are
 * judgements — they belong in the review package, not in an assertion that
 * would pass on any header of the right size.
 */

/**
 * Console noise that is not the site's fault.
 *
 * The first three are the list `public-site.spec.ts` uses: the font CDN and the
 * favicon 404 that python's `http.server` produces.
 *
 * The fourth is this file's own doing. Two tests here navigate away from the
 * homepage deliberately, and one of them does it while the journey's scene is
 * still fetching `stratos-altimeter.glb`. The browser reports that in-flight
 * request, cancelled by the navigation, as a console error — on a page that no
 * longer exists, about an asset nothing is waiting for. Suppressed by asset
 * extension rather than by message text so that a *real* failure to load the
 * model on a page that stays put is still an error: this pattern only matches
 * the fetch itself, and an exception thrown because the model was missing would
 * arrive through `pageerror` below and be reported.
 */
function collectErrors(page: Page) {
  const errors: string[] = [];

  /* The cancelled-asset filter applies to thrown errors as well as to logged
     ones, because that is the channel this actually arrives on: the scene's
     model loader rejects when its fetch is cancelled, nothing is left to catch
     the rejection on a document being torn down, and it surfaces as a page
     error naming the `.glb`. It is also delivered asynchronously, so it can
     land after the test has moved on — which is why it is filtered by shape
     rather than by when it arrived.

     Narrow on purpose: it matches only a message naming a model or texture
     asset. A scene bug — an undefined property, a failed shader compile — reads
     nothing like this and is still reported. */
  const cancelledAsset = (text: string) => /\.(glb|hdr|ktx2|bin)\b/i.test(text);

  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/favicon|fonts\.(googleapis|gstatic)|net::ERR_/i.test(text)) return;
    if (cancelledAsset(text)) return;
    errors.push(text);
  });
  page.on('pageerror', (e) => {
    if (cancelledAsset(e.message)) return;
    errors.push(e.message);
  });
  return errors;
}

const deck = (page: Page) => page.locator('header.nav');
const burger = (page: Page) => page.locator('.burger');
const menu = (page: Page) => page.locator('#menu');

/**
 * The header controller is BOUND, not merely painted.
 *
 * `header.nav` and `.burger` are both in the server-rendered shell, so they are
 * visible, stable and clickable the instant the document parses — and
 * Playwright's actionability check asks for exactly those properties. None of
 * them is "has a JavaScript listener". A click delivered before
 * `assets/js/header.js` has run is a real click on a real button that nothing
 * is listening to, and the layer then correctly stays `hidden` for the whole of
 * the following assertion's budget.
 *
 * `window.Stratos.header` is published at the END of that file (header.js:419),
 * after every listener in it is bound — including
 * `burger.addEventListener('click', …)` at :371. So it is an exact readiness
 * marker rather than an approximate one, and waiting on it is a state wait
 * rather than a duration.
 *
 * Measured over 100 instrumented executions of the subpage contract: the
 * document was still `loading` or `interactive` at click time in 15 of them,
 * and `Stratos.header` was absent in one. `defer` closes most of the window —
 * deferred scripts run before `DOMContentLoaded` — but not all of it.
 */
const headerInstalled = (page: Page) =>
  page.waitForFunction(
    () => typeof (window as unknown as { Stratos?: { header?: unknown } }).Stratos?.header === 'object',
    null,
    { timeout: 15_000 },
  );

/** The header's own state word, as the state machine wrote it. */
const headerState = (page: Page) => deck(page).getAttribute('data-state');

/**
 * Wait until the document has stopped growing.
 *
 * The homepage keeps getting taller for a second or so after load — fonts
 * settle, the case-study images arrive, the eleven panels take their final
 * heights, and under reduced motion the whole track un-sticks into a very long
 * ordinary document. Every scroll-derived measurement below is meaningless
 * until that stops: a position computed from a stale `scrollHeight` is short of
 * where it was meant to land, and "short of the bottom" is the difference
 * between the destination state and the journey state.
 *
 * This is why the first run of this file looked like a header bug and was not
 * one. Polled rather than slept, so it costs a few frames on a fast page.
 */
async function settle(page: Page) {
  await atRest(page, () => page.evaluate(() => document.documentElement.scrollHeight), 'scrollHeight');
}

/**
 * Read a number until it stops changing, and fail loudly if it never does.
 *
 * Replaces three near-identical loops that each returned on the FIRST pair of
 * equal samples and each gave up silently. Both halves of that were wrong, and
 * the second only became visible once the suite stopped being starved:
 *
 *   * **One repeat is not rest.** These quantities are eased per frame. Two
 *     samples 120 ms apart can agree while an easing has not started, has
 *     paused on a rounded value, or is between two equal frames. On a 4 fps
 *     page the sampling was slow enough that the motion had always finished
 *     first; on a 58 fps page it has not. `homepage-chrome:259` measured the
 *     header at 55.39px against a 54px bound, and `:531` measured a scroll
 *     position 25px from where it came to rest — both mid-transition, both
 *     against a product that settles correctly. Measured: the header eases from
 *     ~58.8px to 52.48px over ~300ms after a scroll.
 *   * **Giving up silently is worse than timing out.** The old loops returned
 *     the last value they happened to see when the iteration bound ran out, so
 *     a starved page produced a plausible number and the failure surfaced later,
 *     somewhere else, as a wrong assertion rather than as "this never settled".
 *
 * So: three consecutive agreeing samples, and an explicit throw naming the
 * quantity if the budget is spent. Costs three samples on a page that is
 * already still, which is the common case.
 */
async function atRest(
  page: Page,
  read: () => Promise<number>,
  what: string,
  { agree = 3, interval = 100, timeout = 15_000 } = {},
): Promise<number> {
  const deadline = Date.now() + timeout;
  let last = Number.NaN;
  let streak = 0;
  let seen: number[] = [];

  while (Date.now() < deadline) {
    const value = await read();
    seen = [...seen.slice(-5), value];
    if (value === last) {
      streak += 1;
      if (streak >= agree - 1) return value;
    } else {
      streak = 0;
      last = value;
    }
    await page.waitForTimeout(interval);
  }

  throw new Error(
    `${what} never came to rest within ${timeout}ms — last samples: ${seen.join(', ')}. ` +
      'Either the page is genuinely still animating, or this project is not ' +
      'getting enough frames to finish one (see tests/harness.spec.ts).',
  );
}

/**
 * Scroll to a fraction of the document, after it has settled.
 *
 * A fraction of 1 means *the bottom*, asked for as a number larger than any
 * document and left to the browser to clamp — not as `h * 1` from a height this
 * side of the process might already be wrong about.
 */
async function scrollToFraction(page: Page, f: number) {
  await settle(page);
  await page.evaluate((fraction) => {
    const h = document.documentElement.scrollHeight - innerHeight;
    window.scrollTo(0, fraction >= 1 ? 1e7 : h * fraction);
  }, f);
  await page.waitForTimeout(120);
}

/**
 * The scroll position, once it has stopped moving.
 *
 * Landing somewhere is not the same as coming to rest there: the page continues
 * to adjust for a moment after a programmatic scroll, by a few tens of pixels.
 * Any test that compares a position taken *before* an interaction against one
 * taken *after* has to take the first one at rest, or it is measuring the
 * settling and blaming the interaction. That is not a hypothetical — it is what
 * made the scroll-lock assertion below look like a 15px restore bug when the
 * lock was in fact restoring its captured position exactly.
 */
async function restingScrollY(page: Page): Promise<number> {
  // The header compacts over ~300ms after a scroll, and that is a layout change
  // in a sticky element on a pinned journey — so the position is not at rest
  // until the chrome above it is. Waiting for both is what makes the
  // before/after comparison in the scroll-lock test a measurement of the lock
  // rather than of the settling.
  await atRest(page, () => deck(page).evaluate((el) => el.getBoundingClientRect().height), 'header height');
  return atRest(page, () => page.evaluate(() => Math.round(scrollY)), 'scrollY');
}

/**
 * Wait for the header to settle on `want`.
 *
 * Polled rather than timed. The journey's progress is scrubbed and its altitude
 * is damped, so the header arrives at a state a variable number of frames after
 * the scroll — a fixed `waitForTimeout` here would either be flaky or be long
 * enough to hide a header that never moved at all.
 */
async function expectState(page: Page, want: string) {
  await expect
    .poll(() => headerState(page), { timeout: 12_000, message: `header never reached "${want}"` })
    .toBe(want);
}

/*
 * Both readouts are read with `textContent`, never `innerText`.
 *
 * `innerText` is the *rendered* text, so it is `''` for anything the layout is
 * not painting — and `.menu-open .hud { visibility: hidden }` is exactly that
 * while the navigation layer is up. Reading the instrument through `innerText`
 * behind the open menu returns an empty string, `Number('')` is 0, and the
 * result is a test that reports the journey has fallen to sea level when the
 * altitude is in fact being held perfectly. That false positive is the whole
 * reason this comment exists.
 */

/** The altitude the header is printing, in metres. */
const headerAltitude = (page: Page) =>
  page.locator('.nav__alt-v').textContent().then((t) => Number((t ?? '').replace(/[^\d]/g, '')));

/**
 * The altitude the page's own instrument is printing, in metres.
 *
 * `altitudeMetres` resolves to whichever readout the composition on screen
 * mounted — the desktop HUD's digits or the mobile telemetry strip's. The
 * assertion below it is the same either way: the header must print what the
 * page prints, on the one page where both are on screen at once.
 */
const hudAltitude = (page: Page) => altitudeMetres(page);

/**
 * The instrument's reading once the clock has caught up with the scroll.
 *
 * Never `waitForTimeout`. The altitude is damped *per frame*, not per
 * millisecond — it is advanced from `requestAnimationFrame` inside `JourneyHUD`
 * — so how long it takes to arrive is a function of how many frames the machine
 * is giving this tab. A fixed 1 800 ms is comfortable at 60 fps and far too
 * short at the 10 fps a laptop produces when five WebGL homepages are on screen
 * at once, which is exactly what this suite does to itself. Waiting for the
 * number to stop moving asks the real question and costs nothing on a fast run.
 */
async function restingAltitude(page: Page): Promise<number> {
  let last = -1;
  for (let i = 0; i < 60; i++) {
    const a = await hudAltitude(page);
    if (a === last) return a;
    last = a;
    await page.waitForTimeout(200);
  }
  return last;
}

// =============================================================================
// The three header states.
// =============================================================================
test.describe('the homepage flight deck', () => {
  test('the opening state is the full wordmark over a transparent header', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    if (testInfo.project.name === 'reduced-motion') await enableReducedMotion(page);
    await page.goto('/index.html');

    await expect(deck(page)).toBeVisible();
    expect(await headerState(page)).toBe('opening');

    // The wordmark, not the compact mark. Both are in the markup — the state
    // change is a CSS swap, not a DOM rewrite — so "the opening state shows the
    // full wordmark" is an assertion about which one is painted.
    await expect(page.locator('.brand__full')).toBeVisible();

    // Transparent: the header is not carrying a background plate at the top of
    // the page. `is-solid` is the class that would add one.
    await expect(deck(page)).not.toHaveClass(/is-solid/);

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('desktop navigation is visible at the top and collapses into the trigger', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'no desktop link row on a phone, by design');
    if (testInfo.project.name === 'reduced-motion') await enableReducedMotion(page);
    await page.goto('/index.html');

    // Opening: the destinations are on screen and reachable without opening
    // anything. This is the assertion that separates a real header from a
    // permanent hamburger.
    const links = page.locator('.nav__links a');
    await expect(links.first()).toBeVisible();
    const opening = await links.count();
    expect(opening, 'the opening header has no destinations').toBeGreaterThanOrEqual(4);

    // Journey: the row collapses and the trigger takes over. The trigger is
    // present in every state — that is the "navigation stays continuously
    // accessible" promise — so what changes is the row, not the button.
    await scrollToFraction(page, 0.45);
    await expectState(page, 'journey');
    await expect(links.first()).toBeHidden();
    await expect(burger(page)).toBeVisible();
  });

  test('the journey state compacts the wordmark and keeps the header short', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'reduced-motion', 'that path is a plain document with no journey to compact into');
    await page.goto('/index.html');
    await homepageReady(page);

    const opening = (await deck(page).boundingBox())!.height;

    await scrollToFraction(page, 0.45);
    await expectState(page, 'journey');

    // The compact mark replaces the full wordmark.
    //
    // Asserted as painted opacity, not as `toBeHidden()`. The two marks are
    // stacked in one grid cell and cross-faded, so both are laid out in both
    // states and neither is ever `display: none` — which is what keeps the
    // header from reflowing around the swap. `toBeHidden()` would be asking
    // for a different implementation, not for the behaviour.
    const opacity = (sel: string) =>
      page.locator(sel).evaluate((el) => Number(getComputedStyle(el).opacity));
    await expect.poll(() => opacity('.brand__mark'), { timeout: 4_000 }).toBeGreaterThan(0.9);
    await expect.poll(() => opacity('.brand__full'), { timeout: 4_000 }).toBeLessThan(0.1);

    // 40–52 px was the brief's range. Asserted as a range and not as a number
    // because the exact value is a design decision that may move inside it.
    //
    // Measured once the height has stopped moving, not once the crossfade has.
    // The two marks finish their opacity swap before the header finishes
    // compacting — the height eases from ~58.8px to 52.48px over ~300ms — so
    // the opacity polls above are a proxy that resolves early. Reading the
    // height immediately after them caught it at 55.39px against this 54px
    // bound, which is a true reading of a frame the design passes through.
    const journey = await atRest(
      page,
      () => deck(page).evaluate((el) => el.getBoundingClientRect().height),
      'journey header height',
    );
    expect(journey, `journey header is ${journey}px`).toBeGreaterThanOrEqual(38);
    expect(journey, `journey header is ${journey}px`).toBeLessThanOrEqual(54);
    expect(journey, 'the header did not compress at all').toBeLessThan(opening);
  });

  test('the destination state resolves near the end and reveals the CTA', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'reduced-motion') await enableReducedMotion(page);
    await page.goto('/index.html');

    await scrollToFraction(page, 1);
    await expectState(page, 'destination');

    // The project-start CTA is the point of the destination state — on a
    // viewport wide enough to hold one. Below 640px the header is `STRATOS
    // MENU` and the CTA is deliberately not in it; the Arrival's own primary
    // action, a screen further down, is the phone's project-start route.
    const width = page.viewportSize()!.width;
    if (width > 640) {
      await expect(page.locator('.nav__cta')).toBeVisible();
    } else {
      await expect(page.locator('.nav__cta')).toBeHidden();
      await expect(page.locator('.arrival__cta a').first()).toBeAttached();
    }
  });

  test('the states are reversible and the top of the page is always the opening state', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'reduced-motion') await enableReducedMotion(page);
    await page.goto('/index.html');

    await scrollToFraction(page, 0.5);
    await expectState(page, 'journey');
    await scrollToFraction(page, 1);
    await expectState(page, 'destination');

    // All the way back. No stale destination class may survive the return —
    // that is the specific bug the brief names.
    await scrollToFraction(page, 0);
    await expectState(page, 'opening');
    await expect(page.locator('.brand__full')).toBeVisible();
    await expect(deck(page)).not.toHaveClass(/is-solid/);
  });

  test('a single jump lands on the right state, not one short of it', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'reduced-motion') await enableReducedMotion(page);
    await page.goto('/index.html');

    // One jump from the top of the document to the bottom, with no intermediate
    // scroll events at all — which is what Return to 0 m in reverse, a restored
    // bfcache position and a fragment link all look like to the header.
    //
    // The state machine used to advance one state per paint, so this arrived in
    // `journey` and stayed there over the page's own footer, because the gate
    // that triggers a repaint is "the progress moved" and after a jump it never
    // moves again. Asserted here because it is invisible in ordinary scrolling
    // and only ever showed up under reduced motion.
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, 1e7));
    await expectState(page, 'destination');

    // And back the other way, in one jump, for the same reason.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectState(page, 'opening');
  });

  test('the header does not chatter when the visitor hovers on a boundary', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'reduced-motion', 'no scroll-driven state machine on that path');
    await page.goto('/index.html');
    await homepageReady(page);

    // Park on the opening→journey boundary and jitter across it the way a
    // trackpad does. Hysteresis means the state may change once; what it must
    // not do is toggle on every sample.
    await scrollToFraction(page, 0.5);
    await expectState(page, 'journey');

    const seen: string[] = [];
    for (let i = 0; i < 14; i++) {
      await page.evaluate((dy) => window.scrollBy(0, dy), i % 2 ? -6 : 6);
      await page.waitForTimeout(90);
      seen.push((await headerState(page))!);
    }

    const flips = seen.filter((s, i) => i > 0 && s !== seen[i - 1]).length;
    expect(flips, `header state flipped ${flips} times across a 6px jitter: ${seen.join(',')}`).toBe(0);
  });

  test('the header prints the journey altitude, not an altitude of its own', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'reduced-motion', 'no clock on that path, so nothing is being published');
    await page.goto('/index.html');
    await homepageReady(page);

    await scrollToFraction(page, 0.55);
    await expectState(page, 'journey');

    // Both readouts damp towards the position; wait for the instrument to stop
    // moving rather than for a clock this process does not control.
    const hud = await restingAltitude(page);
    const header = await headerAltitude(page);

    // This is the assertion that makes the header's number real rather than
    // decorative. The HUD rounds to 10 m and the header does not, so they are
    // compared with that tolerance and no more: a header deriving its own
    // `floor + p * (ceiling - floor)` would be out by thousands here, because
    // the altitude curve is piecewise in scroll.
    expect(Math.abs(header - hud), `header ${header} m vs instrument ${hud} m`).toBeLessThanOrEqual(60);
    expect(header, 'the header is still on the ground half way up').toBeGreaterThan(1_000);
    expect(header).toBeLessThanOrEqual(30_000);
  });

  test('the readout names the stage the journey reports', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'reduced-motion', 'no clock on that path');
    await page.goto('/index.html');
    await homepageReady(page);

    await scrollToFraction(page, 0.6);
    await expectState(page, 'journey');
    await restingAltitude(page); // the stage label changes with the altitude

    // The label the header shows is the stage label the HUD's live region is
    // announcing — one source, two surfaces.
    const key = (await page.locator('.nav__alt-k').textContent())!.trim();
    const stage = (await (await stageReadout(page)).textContent())!.trim();
    expect(key.length, 'the header stage label is empty').toBeGreaterThan(0);
    expect(key.toLowerCase()).toBe(stage.toLowerCase());
  });

  /**
   * The deck prints what it is pushed, and a still page does not exempt it.
   *
   * ## Why this exists, and why the test above is not enough
   *
   * The test above is the page-level statement and it is the one that failed in
   * `final-closure-01` — `"munkáink"` in the deck beside `"rendszer"` in the
   * instrument. The defect behind it was real and is fixed. But that test only
   * *witnesses* it when the journey happens to come to rest inside a ~9 px band
   * above a stage boundary, and where that band falls depends on where
   * `calibrate()` put the boundary on the run. Measured: with the defect
   * deliberately restored, the test above passed 10 of 10. It caught the defect
   * once, by luck, and cannot be relied on to catch it again.
   *
   * ## What is actually being protected
   *
   * `Stratos.header.push()` is the interface the homepage drives the shared deck
   * through, and it is the whole of the homepage's half of the flight deck —
   * `siteHeader.ts` on the desktop journey and `MobileTelemetry.tsx` on the
   * portrait page are its only two callers. Its contract is: the altitude and
   * the stage label are values the CALLER owns, and the deck prints them.
   *
   * Progress is not the whole state on this route, and that is the point. The
   * journey's clock settles onto its target in steps that fall below any scroll
   * gate, and `calibrate()` moves the stage boundaries when a late image decodes
   * — so the stage the visitor is in can change while `scrollY` does not move at
   * all. A deck that repaints only when progress moves keeps the previous stage
   * name, and keeps it for as long as the visitor stays there.
   *
   * So: the same progress, twice, with a different stage. If the second one is
   * not on screen, the deck is deriving rather than printing, and the page has
   * two readouts that can disagree. Measured, deterministic, and it does not
   * depend on where a boundary landed.
   */
  test('the deck prints a new stage pushed at an unchanged scroll position', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'reduced-motion', 'no clock on that path, so nothing is being pushed');
    await page.goto('/index.html');
    await homepageReady(page);
    await headerInstalled(page);

    const printed = await page.evaluate(() => {
      const deck = (window as unknown as {
        Stratos: { header: { push(p: number, meta?: { alt?: number; key?: string }): void; release(): void } };
      }).Stratos.header;
      const read = () => ({
        key: (document.querySelector('.nav__alt-k')?.textContent ?? '').trim(),
        alt: (document.querySelector('.nav__alt-v')?.textContent ?? '').replace(/\D/g, ''),
      });

      // A position, and the stage the journey reports there.
      deck.push(0.5, { alt: 12_000, key: 'ALFA' });
      const first = read();

      // The same position. A different stage — which is what a boundary crossed
      // inside the clock's final approach looks like, and what a recalibration
      // looks like. Nothing scrolled.
      deck.push(0.5, { alt: 17_000, key: 'BRAVO' });
      const second = read();

      // Hand the deck back rather than leaving the rest of the file's tests on
      // a header this one hijacked. The page's own driver re-takes it on its
      // next frame.
      deck.release();
      return { first, second };
    });

    expect(printed.first.key, 'the deck did not print the first pushed stage at all').toBe('ALFA');
    expect(printed.first.alt).toBe('12000');
    expect(
      printed.second.key,
      'the deck kept the previous stage name when the journey changed stage without scrolling',
    ).toBe('BRAVO');
    expect(printed.second.alt, 'the deck kept the previous altitude too').toBe('17000');
  });

  test('the altitude readout is hidden from assistive technology', async ({ page }) => {
    await page.goto('/index.html');
    // Decorative: the same number is already announced by the HUD's live
    // region, and a second copy would double every announcement.
    await expect(page.locator('.nav__alt')).toHaveAttribute('aria-hidden', 'true');
  });
});

// =============================================================================
// The full-screen navigation layer — the same one the subpages use.
// =============================================================================
test.describe('the full-screen menu on the homepage', () => {
  test('opens from every header state', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'reduced-motion') await enableReducedMotion(page);
    await page.goto('/index.html');

    for (const [fraction, state] of [[0, 'opening'], [0.5, 'journey'], [1, 'destination']] as const) {
      await scrollToFraction(page, fraction);
      await expectState(page, state);

      await burger(page).click();
      await expect(menu(page)).toBeVisible();
      await expect(burger(page)).toHaveAttribute('aria-expanded', 'true');

      await page.keyboard.press('Escape');
      await expect(burger(page)).toHaveAttribute('aria-expanded', 'false');
    }
  });

  test('the trigger names itself and points at the layer it controls', async ({ page }) => {
    await page.goto('/index.html');

    await expect(burger(page)).toHaveAttribute('aria-controls', 'menu');
    await expect(burger(page)).toHaveAttribute('aria-expanded', 'false');
    const closed = await burger(page).getAttribute('aria-label');
    expect(closed?.trim().length, 'the menu trigger has no accessible name').toBeGreaterThan(0);

    await burger(page).click();
    await expect(menu(page)).toBeVisible();
    // The trigger is also the close control, so its name has to change with it.
    const open = await burger(page).getAttribute('aria-label');
    expect(open).not.toBe(closed);
  });

  test('ESC closes it and focus goes back to the trigger', async ({ page }) => {
    await page.goto('/index.html');

    await burger(page).focus();
    await burger(page).press('Enter');
    await expect(menu(page)).toBeVisible();

    // Focus opens on the first destination, not on the control just pressed.
    const landed = await page.evaluate(() => document.activeElement?.tagName);
    expect(landed).toBe('A');

    await page.keyboard.press('Escape');
    await expect(burger(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(burger(page)).toBeFocused();
  });

  test('focus is trapped inside the layer while it is open', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Tab is not a phone interaction');
    await page.goto('/index.html');

    await burger(page).click();
    // `aria-expanded` is written inside `open()`, in the same synchronous block
    // that moves focus — so waiting for it is waiting for focus to have been
    // placed, rather than for a transition that says nothing about focus.
    await expect(burger(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(menu(page)).toBeVisible();

    /**
     * Record every focus change in the page, rather than asking after each Tab.
     *
     * Two reasons, and the second is the important one. It is far cheaper —
     * thirty round trips instead of ninety — and thirty `evaluate` calls
     * interleaved with thirty key presses was enough to time this test out on a
     * loaded machine. And it is stricter: `focusin` sees every element focus
     * passes *through*, including any the browser visits between two samples,
     * which a poll after each press would miss.
     */
    await page.evaluate(() => {
      const w = window as unknown as { __trail: string[] };
      w.__trail = [];
      const where = () => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return 'nothing';
        if (el.closest('#menu')) return 'menu';
        if (el.classList.contains('burger')) return 'burger';
        return `ESCAPED:${el.tagName}.${String(el.className).slice(0, 24)}`;
      };
      w.__trail.push(where());
      document.addEventListener('focusin', () => w.__trail.push(where()));
    });

    // All the way round, twice the length of the layer.
    for (let i = 0; i < 30; i++) await page.keyboard.press('Tab');

    const trail: string[] = await page.evaluate(
      () => (window as unknown as { __trail: string[] }).__trail,
    );
    const escaped = trail.filter((t) => t.startsWith('ESCAPED') || t === 'nothing');

    // Where focus opened, and every stop after it.
    expect(trail[0], 'focus did not enter the layer on open').toBe('menu');
    expect(escaped, `focus escaped the layer: ${escaped.join(', ')}`).toEqual([]);
    // And it really did move — a trap that never advanced would also be empty.
    expect(trail.length, `focus never moved: ${trail.join(' ')}`).toBeGreaterThan(20);
  });

  test('the close control closes it', async ({ page }) => {
    await page.goto('/index.html');
    await burger(page).click();
    await expect(menu(page)).toBeVisible();

    // The trigger is the close control in the open state.
    await burger(page).click();
    await expect(burger(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(menu(page)).toBeHidden();
  });

  test('body scroll is locked while open and fully released after', async ({ page }) => {
    await page.goto('/index.html');
    await scrollToFraction(page, 0.4);
    const before = await restingScrollY(page);

    await burger(page).click();
    await expect(menu(page)).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/menu-open/);
    expect(await page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed');

    await page.keyboard.press('Escape');
    await expect(page.locator('html')).not.toHaveClass(/menu-open/);

    // Fully released: no residual inline style, and the scroll position back
    // where the visitor left it.
    const after = await page.evaluate(() => ({
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      y: scrollY,
    }));
    expect(after.position, 'stale scroll lock').toBe('');
    expect(after.top).toBe('');
    expect(after.width).toBe('');
    expect(Math.abs(after.y - before), 'the page moved while the menu was open').toBeLessThanOrEqual(2);
  });

  test('opening the menu does not walk the journey back down the mountain', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'reduced-motion', 'no journey clock on that path');
    await page.goto('/index.html');
    await homepageReady(page);

    await scrollToFraction(page, 0.6);
    await expectState(page, 'journey');
    const before = await restingAltitude(page);
    expect(before, 'the journey never left the ground').toBeGreaterThan(1_000);

    await burger(page).click();
    await expect(burger(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(menu(page)).toBeVisible();

    // Long enough for a runaway clock to fall a long way. A damped descent from
    // 18 000 m covers most of the distance in the first second, so a reader that
    // is still listening shows up here as thousands of metres, not tens — which
    // is why the tolerance below can be tight without being brittle.
    await page.waitForTimeout(1_200);

    // The scroll lock puts scrollY at 0. If either scroll reader is still
    // listening, the ascent eases back to the valley behind the layer — which
    // is exactly the regression this asserts against.
    const during = await hudAltitude(page);
    expect(Math.abs(during - before), `altitude moved ${before} → ${during} behind the menu`)
      .toBeLessThanOrEqual(400);

    await page.keyboard.press('Escape');
    await expect(burger(page)).toHaveAttribute('aria-expanded', 'false');

    const after = await restingAltitude(page);
    expect(Math.abs(after - before), `altitude did not return: ${before} → ${after}`)
      .toBeLessThanOrEqual(400);
    await expectState(page, 'journey');
  });

  test('the destinations are ordinary links and they navigate', async ({ page }) => {
    await page.goto('/index.html');
    await burger(page).click();
    await expect(menu(page)).toBeVisible();

    // No router and no interception: every destination is an <a href> that a
    // middle click, a ctrl-click and the browser's own history all understand.
    const first = menu(page).locator('.menu__panel a[href]').first();
    const href = await first.getAttribute('href');
    expect(href, 'a menu destination with no href').toBeTruthy();
    expect(href!.startsWith('#'), `menu destination is a fragment: ${href}`).toBe(false);

    await first.click();
    await expect(page).toHaveURL(new RegExp(href!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
  });
});

// =============================================================================
// Return to 0 m.
// =============================================================================
test.describe('return to 0 m', () => {
  test('is a real control with an accessible name, and it returns the page', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'reduced-motion') await enableReducedMotion(page);
    await page.goto('/index.html');

    const toTop = page.locator('[data-to-top]');
    // A button and not an <a href="#top">: an anchor would push a history entry
    // and the back button would then undo a scroll rather than leave the page.
    expect(await toTop.evaluate((el) => el.tagName)).toBe('BUTTON');
    expect((await toTop.innerText()).trim().length).toBeGreaterThan(0);

    await scrollToFraction(page, 1);
    await expectState(page, 'destination');
    const entriesBefore = await page.evaluate(() => history.length);

    await toTop.click();
    await expect.poll(() => page.evaluate(() => scrollY), { timeout: 10_000 }).toBeLessThanOrEqual(2);

    // No history entry, and the header restored to its opening state rather
    // than holding a stale destination class.
    expect(await page.evaluate(() => history.length), 'return to 0 m pushed a history entry')
      .toBe(entriesBefore);
    await expectState(page, 'opening');
    await expect(deck(page)).not.toHaveClass(/is-solid/);
  });

  test('focus is not lost on the way up', async ({ page }) => {
    await page.goto('/index.html');
    await scrollToFraction(page, 1);
    await page.locator('[data-to-top]').click();
    await expect.poll(() => page.evaluate(() => scrollY), { timeout: 10_000 }).toBeLessThanOrEqual(2);

    // A keyboard user returned visually and left at the bottom logically is the
    // bug. Focus goes to the top of the document.
    const landed = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return { tag: el?.tagName ?? null, cls: el?.className ?? '' };
    });
    expect(landed.tag, 'focus fell to the body').not.toBe('BODY');
    expect(/skip|brand/.test(String(landed.cls)), `focus landed on ${landed.cls}`).toBe(true);
  });

  test('under reduced motion it arrives immediately', async ({ page }) => {
    const verify = await enableReducedMotion(page);
    await page.goto('/index.html');
    await verify();

    await scrollToFraction(page, 1);
    await page.locator('[data-to-top]').click();
    // No animation to wait out: one frame, not a smooth scroll.
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => scrollY)).toBeLessThanOrEqual(2);
  });
});

// =============================================================================
// The shared footer, and whether it really is shared.
// =============================================================================
test.describe('the Arrival sequence and the ground-control footer', () => {
  test('Arrival closes the journey with the real ceiling and both actions', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'reduced-motion') await enableReducedMotion(page);
    await page.goto('/index.html');

    const arrival = page.locator('.arrival');
    await arrival.scrollIntoViewIfNeeded();
    await expect(arrival).toBeVisible();

    // The homepage's convergence reports the ascent, not the calibration the
    // other routes report — and the altitude is the ceiling the journey
    // actually declares, read from the document rather than hardcoded here.
    const ceiling = await page.evaluate(() => Number(document.body.dataset.ceiling));
    expect(ceiling).toBe(30_000);
    const state = (await arrival.locator('.arrival__state').innerText()).replace(/\s+/g, ' ');
    expect(state).toContain('30 000');

    // Both actions, in the visitor's language, pointing at real routes.
    const primary = arrival.locator('.arrival__cta a').first();
    const secondary = arrival.locator('.arrival__cta a').nth(1);
    await expect(primary).toBeVisible();
    await expect(secondary).toBeVisible();
    expect(await primary.getAttribute('href')).toMatch(/arajanlat\.html$/);
    expect(await secondary.getAttribute('href')).toMatch(/munkaink\.html$/);

    // The Trace is decoration and must not be announced.
    await expect(arrival.locator('[data-trace]')).toHaveAttribute('aria-hidden', 'true');
  });

  test('the footer is a landmark with headed groups, contact and legal links', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'reduced-motion') await enableReducedMotion(page);
    await page.goto('/index.html');

    const foot = page.locator('footer.foot');
    await foot.scrollIntoViewIfNeeded();
    await expect(foot).toBeVisible();
    // The groups are headed. `h4` is the level the shared footer uses on all 67
    // routes; this asserts that the groups have headings at all, which is the
    // accessibility promise, and deliberately does not assert a level — the
    // level is a document-outline question for the whole site, not something
    // the homepage gets to answer differently from the other 66 pages.
    expect(await foot.locator('h2, h3, h4').count(), 'the footer groups have no headings')
      .toBeGreaterThanOrEqual(3);

    // Verified contact only — the addresses that are already in the menu.
    await expect(foot.locator('a[href^="mailto:"]')).toHaveCount(1);
    await expect(foot.locator('a[href^="tel:"]')).toHaveCount(1);

    // Legal group and the locale switch.
    await expect(foot.locator('a[href*="impresszum"]')).toHaveCount(1);
    await expect(foot.locator('a[href*="adatkezelesi"]')).toHaveCount(1);
    await expect(foot.locator('[data-to-top]')).toHaveCount(1);

    /* Social links must be profiles, not the platforms.
       The footer shipped for a while with `https://www.linkedin.com` and its two
       siblings — the platforms' own front pages, standing in for accounts. That
       is a placeholder that looks exactly like a finished link in a screenshot,
       on 67 routes, and the only thing that distinguishes the two is whether
       there is a path after the origin. So that is what is asserted. */
    const social = await foot.evaluate((el) =>
      [...el.querySelectorAll('a[href^="http"]')].map((a) => (a as HTMLAnchorElement).href),
    );
    expect(social.length, 'no social links in the footer').toBeGreaterThanOrEqual(3);
    for (const href of social) {
      const url = new URL(href);
      expect(
        url.pathname.replace(/\/+$/, '').length + url.search.length,
        `${href} is a platform front page, not a profile`,
      ).toBeGreaterThan(0);
    }
  });

  /**
   * The set of *destinations* a region links to, comparable across routes.
   *
   * Two normalisations, and both of them are the point rather than a fudge:
   *
   *   the locale switch is excluded — it is the one group whose targets are
   *   *supposed* to differ per route, because it keeps the reader on the page
   *   they are on. From `/rolunk.html` it points at `en/about.html`; from the
   *   homepage it points at `/en/`. Those are the same control doing its job.
   *   It carries `hreflang`, which is what makes it identifiable rather than
   *   guessed at.
   *
   *   the home link is folded to one spelling — the homepage calls itself `/`
   *   and a generated route calls it `index.html`, and `root_href` in build.py
   *   exists precisely to make that distinction. Same destination.
   */
  const destinations = (page: Page, region: string) =>
    page.evaluate(
      (sel) =>
        [...document.querySelectorAll(`${sel} a[href]:not([hreflang])`)]
          .map((a) => (a as HTMLAnchorElement).getAttribute('href')!)
          .filter((h) => h && !/^(#|mailto:|tel:|https?:)/.test(h))
          .map((h) =>
            /(^\/$|^index\.html$|\/index\.html$)/.test(h) ? 'index.html' : h.replace(/^.*\//, ''),
          )
          .sort(),
      region,
    );

  test('it is the same footer the subpages carry, not a homepage copy', async ({ page }) => {
    // The information architecture, as the set of destinations each footer
    // links to. If the homepage grew a footer of its own these sets would drift
    // on the first route that was renamed — which is the failure this prevents.
    await page.goto('/index.html');
    const home = await destinations(page, 'footer.foot');
    await page.goto('/rolunk.html');
    const sub = await destinations(page, 'footer.foot');

    expect(home.length, 'the homepage footer has almost no links').toBeGreaterThan(12);
    expect(home).toEqual(sub);
  });

  test('the homepage menu leads where the subpage menu leads', async ({ page }) => {
    await page.goto('/index.html');
    const home = await destinations(page, '#menu .menu__panel');
    await page.goto('/rolunk.html');
    const sub = await destinations(page, '#menu .menu__panel');

    expect(home.length, 'the homepage menu has almost no destinations').toBeGreaterThan(8);
    expect(home).toEqual(sub);
  });

  test('the homepage header row leads where the subpage header row leads', async ({ page }) => {
    await page.goto('/index.html');
    const home = await destinations(page, 'header.nav');
    await page.goto('/rolunk.html');
    const sub = await destinations(page, 'header.nav');

    expect(home.length, 'the homepage header row has no destinations').toBeGreaterThan(4);
    expect(home).toEqual(sub);
  });

  test('the homepage introduces no duplicate ids', async ({ page }) => {
    await page.goto('/index.html');
    // The chrome is substituted into a shell that already had a document of its
    // own, and React mounts a third tree between them. A collision here would
    // break `aria-controls`, the skip link, or both.
    const dupes = await page.evaluate(() => {
      const seen = new Map<string, number>();
      for (const el of document.querySelectorAll('[id]')) {
        seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
      }
      return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    });
    expect(dupes, `duplicate ids: ${dupes.join(', ')}`).toEqual([]);
  });

  test('every chrome link on the homepage resolves', async ({ page, request }) => {
    await page.goto('/index.html');
    const hrefs: string[] = await page.evaluate(() =>
      [...document.querySelectorAll('header.nav a[href], #menu a[href], .arrival a[href], footer.foot a[href]')]
        .map((a) => (a as HTMLAnchorElement).getAttribute('href')!)
        .filter((h) => h && !/^(#|mailto:|tel:|https?:)/.test(h)),
    );
    expect(hrefs.length, 'no internal chrome links found at all').toBeGreaterThan(15);

    for (const href of [...new Set(hrefs)]) {
      const res = await request.get(new URL(href, page.url()).toString());
      expect(res.status(), `${href} -> ${res.status()}`).toBeLessThan(400);
    }
  });
});

// =============================================================================
// Locales.
// =============================================================================
test.describe('the chrome speaks the page’s language', () => {
  for (const [locale, path, quote, work, state] of [
    ['hu', '/index.html', 'arajanlat.html', 'munkaink.html', 'EMELKEDÉS BEFEJEZVE'],
    ['en', '/en/index.html', 'quote.html', 'work.html', 'ASCENT COMPLETE'],
    ['de', '/de/index.html', 'angebot.html', 'projekte.html', 'AUFSTIEG ABGESCHLOSSEN'],
  ] as const) {
    test(`${locale}: header, menu, Arrival and footer are all in ${locale}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);

      // Header CTA and menu CTA both reach that locale's quote route.
      expect(await page.locator('.nav__cta').getAttribute('href')).toMatch(new RegExp(`${quote}$`));
      expect(await page.locator('.menu__cta').getAttribute('href')).toMatch(new RegExp(`${quote}$`));

      // Arrival, in that locale, with that locale's two destinations.
      const arrival = page.locator('.arrival');
      expect((await arrival.locator('.arrival__state').innerText()).replace(/\s+/g, ' ')).toContain(state);
      expect(await arrival.locator('.arrival__cta a').first().getAttribute('href')).toMatch(new RegExp(`${quote}$`));
      expect(await arrival.locator('.arrival__cta a').nth(1).getAttribute('href')).toMatch(new RegExp(`${work}$`));

      // The locale switch is present in the layer and reaches the other two.
      const langs = await page.evaluate(() =>
        [...document.querySelectorAll('#menu [class*="lang"] a[href], footer.foot [class*="lang"] a[href]')]
          .map((a) => (a as HTMLAnchorElement).getAttribute('href')!),
      );
      expect(langs.length, 'no locale switch in the homepage chrome').toBeGreaterThanOrEqual(2);
    });
  }
});

// =============================================================================
// Reduced motion, and lifecycle.
// =============================================================================
test.describe('reduced motion', () => {
  test('the chrome is complete and immediately usable without animation', async ({ page }) => {
    const verify = await enableReducedMotion(page);
    await page.goto('/index.html');
    await verify();

    // No content hidden behind an animation state, and no blank pinned space.
    await expect(deck(page)).toBeVisible();
    const arrival = page.locator('.arrival');
    await arrival.scrollIntoViewIfNeeded();
    await expect(arrival).toBeVisible();
    await expect(arrival.locator('.arrival__h')).toBeVisible();
    await expect(arrival.locator('.arrival__cta a').first()).toBeVisible();
    await expect(page.locator('footer.foot')).toBeVisible();
  });

  test('the menu opens directly, with no spatial delay', async ({ page }) => {
    const verify = await enableReducedMotion(page);
    await page.goto('/index.html');
    await verify();

    await burger(page).click();
    // No `setTimeout` to wait out: the layer is up on the next frame.
    await page.waitForTimeout(60);
    await expect(menu(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
    await expect(menu(page)).toBeHidden();
  });
});

test.describe('lifecycle', () => {
  test('navigating away and back leaves nothing behind', async ({ page }, testInfo) => {
    if (testInfo.project.name === 'reduced-motion') await enableReducedMotion(page);
    const errors = collectErrors(page);
    await page.goto('/index.html');

    await scrollToFraction(page, 0.5);
    await burger(page).click();
    await expect(menu(page)).toBeVisible();

    // Leave with the layer open. `pagehide` has to close it, or the restored
    // page comes back with a fixed body and a scroll position nobody can undo.
    await menu(page).locator('.menu__panel a[href]').first().click();
    await expect(page).not.toHaveURL(/index\.html$/);

    // Everything the abandoned page said on its way out is not this test's
    // subject, and one of the things it says is real: leaving mid-flight
    // cancels the journey scene's model fetch, and the loader reports that
    // cancellation as an error on a document that no longer exists. The
    // question here is whether the page we come *back* to is clean, so the
    // window starts now.
    errors.length = 0;

    await page.goBack();
    await expect(page).toHaveURL(/index\.html$|\/$/);

    const restored = await page.evaluate(() => ({
      menuOpen: document.documentElement.classList.contains('menu-open'),
      position: document.body.style.position,
      expanded: document.querySelector('.burger')?.getAttribute('aria-expanded'),
      hidden: (document.getElementById('menu') as HTMLElement | null)?.hidden,
    }));
    expect(restored.menuOpen, 'stale menu-open class after back').toBe(false);
    expect(restored.position, 'stale scroll lock after back').toBe('');
    expect(restored.expanded, 'the trigger still says it is open').toBe('false');
    expect(restored.hidden, 'the layer is still in the tree').toBe(true);

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('a subpage reached from the homepage carries the same working header', async ({ page }) => {
    await page.goto('/index.html');
    await headerInstalled(page);
    await burger(page).click();
    await menu(page).locator('.menu__panel a[href]').first().click();

    // Same state machine, same trigger, same layer — on the other side of a
    // full document navigation.
    //
    // `toBeVisible()` on the deck says the shell has painted; it does not say
    // the script that makes the trigger work has run. Both are waited for, and
    // the second is the one this contract was losing a race to.
    await expect(deck(page)).toBeVisible();
    await headerInstalled(page);
    await burger(page).click();
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(burger(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('the header binds exactly one scroll listener and no permanent loop', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'reduced-motion', 'the driven path is the one with a loop to avoid');
    await page.goto('/index.html');
    await homepageReady(page);

    // The header rides the journey's clock rather than starting one. Counting
    // `requestAnimationFrame` callers is not possible from here, so this asserts
    // the observable consequence: while the page is being driven, the header's
    // own scroll handler must not be the thing painting it.
    const driven = await page.evaluate(() => {
      const s = (window as unknown as { Stratos?: { header?: { state: string } } }).Stratos;
      return typeof s?.header?.state === 'string';
    });
    expect(driven, 'the shared header never installed itself').toBe(true);

    await scrollToFraction(page, 0.5);
    await expectState(page, 'journey');
  });
});

// =============================================================================
// The viewports the brief named that the project matrix does not already cover.
//
// Run inside one project rather than added as five more: the chrome is CSS and
// a resize is the same measurement a new browser would make, and five extra
// projects would multiply the whole file's cost for one assertion each.
// =============================================================================
test.describe('responsive smoke', () => {
  const SIZES = [
    { name: '1024x768', width: 1024, height: 768 },
    { name: '375x812', width: 375, height: 812 },
    { name: '360x800', width: 360, height: 800 },
    { name: '844x390 landscape', width: 844, height: 390 },
  ];

  for (const size of SIZES) {
    test(`the chrome fits and never scrolls sideways at ${size.name}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop-1440', 'one project is enough for a resize');
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/index.html');

      await expect(deck(page)).toBeVisible();
      await expect(burger(page)).toBeVisible();

      // The trigger is a touch target at every size the brief named.
      const box = (await burger(page).boundingBox())!;
      expect(Math.min(box.width, box.height), `trigger is ${box.width}x${box.height}`).toBeGreaterThanOrEqual(24);

      // No sideways scroll, measured as scrollability rather than content width.
      await page.evaluate(() => window.scrollTo(9999, 0));
      expect(await page.evaluate(() => scrollX), `${size.name} scrolls sideways`).toBe(0);

      // And the footer at the bottom is still inside the glass.
      await page.locator('footer.foot').scrollIntoViewIfNeeded();
      const overflow = await page.evaluate(() => {
        const el = document.querySelector('footer.foot') as HTMLElement;
        return el.getBoundingClientRect().right - document.documentElement.clientWidth;
      });
      expect(overflow, `footer overflows by ${overflow}px`).toBeLessThanOrEqual(1);
    });
  }

  test('the chrome survives 200% zoom and increased text spacing', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'one project is enough');
    // 200% zoom, as a viewport half the size at the same CSS pixel ratio — which
    // is what a browser zoom actually does to a layout.
    await page.setViewportSize({ width: 720, height: 450 });
    await page.goto('/index.html');

    // WCAG 1.4.12 text spacing, applied as the success criterion states it.
    await page.addStyleTag({
      content: `* { line-height: 1.5 !important; letter-spacing: 0.12em !important;
                    word-spacing: 0.16em !important; }
                p { margin-bottom: 2em !important; }`,
    });

    await expect(deck(page)).toBeVisible();
    await expect(burger(page)).toBeVisible();
    await page.evaluate(() => window.scrollTo(9999, 0));
    expect(await page.evaluate(() => scrollX), 'sideways scroll under text spacing').toBe(0);

    await page.locator('.arrival__cta a').first().scrollIntoViewIfNeeded();
    await expect(page.locator('.arrival__cta a').first()).toBeVisible();
    await expect(page.locator('footer.foot')).toBeVisible();
  });
});
