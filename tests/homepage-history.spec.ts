import { test, expect, type Page } from '@playwright/test';
import { bootJourneyOnLoad, homepageReady, stageReadout } from './helpers/homepage';

// The homepage waits for a first move before it mounts the journey — see
// `bootJourneyOnLoad`. Every navigation in this file gets one, on every
// document it loads, so what these tests assert about is a page a visitor is
// reading rather than one they have only landed on.
test.beforeEach(async ({ page }) => {
  await bootJourneyOnLoad(page);
});


/**
 * Where the homepage lands when the visitor presses Back.
 *
 * THE DEFECT THIS EXISTS FOR
 * --------------------------
 * A generated static route restored its scroll position on Back every time, on
 * both engines. The homepage did not, on both engines, at both compositions.
 * Measured before the fix, `experiments/probe-history-restoration.mjs`:
 *
 *     chromium  portrait   2 of 3 landed at the bottom (error 6 884 px)
 *     chromium  desktop    1 of 3 landed at the bottom (error 14 169 px)
 *     webkit    portrait   3 of 3 landed at the bottom (error 6 949 px)
 *     webkit    desktop    3 of 3 landed a screen from the top (error 5 606 px)
 *     both      static     9 of 9 restored, error 0
 *
 * The cause was not scroll restoration being disabled, and not the application
 * scrolling after it: `history.scrollRestoration` read `auto` at script time
 * and at `load` in every arm, and the portrait arm made no programmatic scroll
 * calls at all. The first instrumented frame of the restored document read
 * `y=1528 h=2372` on portrait and `y=794 h=1694` on desktop — in both cases
 * exactly `scrollHeight − innerHeight`, which is the browser clamping a correct
 * restore into a document that is still only the parsed shell. `<main>` is a
 * React container; the fourteen thousand pixels the offset was saved against
 * did not exist yet.
 *
 * WHY THE TOLERANCE IS A BAND AND NOT A NUMBER
 * --------------------------------------------
 * §9: sub-pixel identity is not the contract and asking for it would make this
 * a test of layout stability rather than of history semantics. What the visitor
 * must not get is the top, the bottom, or a different chapter — so all three are
 * asserted by name, alongside a position tolerance a quarter of a phone screen
 * wide. The measured error after the fix is 0–69 px.
 */

/**
 * Where the test scrolls to: the midpoint between two consecutive stages.
 *
 * Both ends are real sections, present under these ids on both compositions,
 * and deep enough into the document to have somewhere to fail to.
 *
 * The MIDPOINT, and not the top of either, and this is not fussiness — it is
 * the difference between a test of history semantics and a test of arithmetic.
 * A stage's anchor *is* a chapter boundary by construction, so a reading taken
 * there is a reading taken at the one position where a few pixels either way
 * changes the answer. Sampling at the top of `stage-selected-work` produced
 * before/after chapter pairs that disagreed by exactly one stage, in both
 * directions, on a restore whose measured position error was under 70 px on a
 * 20 000 px track. The midpoint is the furthest point from either boundary
 * available, so the chapter assertion says what it means: not "the number is
 * within a stage's width" but "the visitor came back to the same chapter".
 */
const ANCHORS = ['stage-selected-work', 'stage-system'] as const;

/**
 * Wait for the restored homepage to reach a settled state, without a sleep.
 *
 * Three conditions, each an event rather than a duration: the document has
 * finished loading, the composition has mounted and is reporting an altitude,
 * and the height reservation `assets/js/home-history.js` puts up for the
 * browser's restore has been released — which is precisely the moment the real
 * content has grown past it and nothing further will resize underneath us.
 */
async function settled(page: Page) {
  await page.waitForLoadState('load');
  await homepageReady(page);
  await page.waitForFunction(
    () => !document.documentElement.style.getPropertyValue('--home-reserve'),
    null,
    { timeout: 20_000 },
  );
  await settleReadout(page);
}

/**
 * Wait for the altitude clock to stop moving.
 *
 * The desktop journey's altitude is a *damped* value easing toward the one the
 * scroll position implies, so the readout and the stage label it drives are
 * both live for a few hundred milliseconds after any position change — a fresh
 * load, a restore, or a `scrollTo` in this file. Reading them before they
 * converge does not measure the page; it measures how fast the machine is.
 *
 * That is not a hypothetical. Sampling immediately produced a "chapter" that
 * disagreed with itself between two runs at the *same* scroll position — the
 * before-reading in one run and the after-reading in another, both mid-ease,
 * in both directions.
 *
 * So the settle is on the number itself: ten consecutive animation frames
 * reporting the same metres. Ten frames is a sixth of a second of a clock that
 * moves on every frame while it is easing, and the assertion that follows is
 * about a value that has stopped changing rather than one caught in flight.
 */
async function settleReadout(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __settle: { last: string | null; n: number } }).__settle = {
      last: null,
      n: 0,
    };
  });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="altitude-value"],[data-testid="mobile-altitude"]');
      if (!el) return false;
      const now = (el.textContent ?? '').replace(/\D/g, '');
      const s = (window as unknown as { __settle: { last: string | null; n: number } }).__settle;
      if (now && now === s.last) s.n += 1;
      else {
        s.last = now;
        s.n = 0;
      }
      return s.n >= 10;
    },
    null,
    { timeout: 20_000 },
  );
}

/** Everything that has to come back, read in one round trip. */
async function place(page: Page) {
  const stage = await stageReadout(page);
  return {
    ...(await page.evaluate(() => ({
      y: Math.round(scrollY),
      travel: document.documentElement.scrollHeight - innerHeight,
      headerState: document.querySelector('.nav')?.getAttribute('data-state') ?? null,
    }))),
    chapter: ((await stage.textContent()) ?? '').trim(),
  };
}

/** Leave for another route the way a visitor does — by activating a link. */
async function followInternalLink(page: Page): Promise<string> {
  const href = await page.evaluate(() => {
    const a = document.querySelector<HTMLAnchorElement>('.foot a[href$=".html"]');
    return a ? a.getAttribute('href') : null;
  });
  expect(href, 'the homepage footer has no internal link to leave by').not.toBeNull();

  /* Clicked from inside the page rather than with `page.click()`, and that is
     not a shortcut. Playwright scrolls an element into view before clicking it,
     which would move the very scroll position this test is about — and a
     script-initiated activation is still a page-initiated navigation, so it
     goes down the same `pageswap` / View Transition path a real click does
     (assets/js/transitions.js), which `page.goto()` would bypass entirely. */
  await Promise.all([
    page.waitForURL((url) => url.pathname.endsWith(href!.split('/').pop()!)),
    page.evaluate(() => document.querySelector<HTMLAnchorElement>('.foot a[href$=".html"]')!.click()),
  ]);
  return href!;
}

/** A quarter of a phone screen. See the note at the top of this file. */
const TOLERANCE = 200;

function expectRestored(after: Awaited<ReturnType<typeof place>>, before: Awaited<ReturnType<typeof place>>) {
  expect(after.y, `returned to the top of the document instead of ${before.y}`).toBeGreaterThan(TOLERANCE);
  expect(
    after.travel - after.y,
    `returned to the bottom of the document instead of ${before.y}`,
  ).toBeGreaterThan(TOLERANCE);
  expect(
    Math.abs(after.y - before.y),
    `left at ${before.y}, came back to ${after.y}`,
  ).toBeLessThanOrEqual(TOLERANCE);
  expect(after.chapter, 'came back to a different chapter').toBe(before.chapter);
}

/**
 * Scroll to the anchor section and wait for the page to describe itself again.
 *
 * The scroll position is polled rather than assumed because `scrollTo` on the
 * desktop composition lands inside a sticky track, and the readout is settled
 * because everything downstream of the position — the header state, the stage
 * label, the metres — is driven by a damped clock. Both are events, not sleeps.
 */
async function scrollToAnchor(page: Page) {
  const target = await page.evaluate((ids) => {
    const tops = ids.map((id) => {
      const el = document.getElementById(id);
      return el ? el.getBoundingClientRect().top + scrollY : null;
    });
    if (tops.some((t) => t === null)) return null;
    const travel = document.documentElement.scrollHeight - innerHeight;
    return Math.min(Math.round(((tops[0] as number) + (tops[1] as number)) / 2), travel);
  }, ANCHORS as unknown as string[]);
  expect(target, `#${ANCHORS.join(' / #')} are not both in this composition`).not.toBeNull();
  expect(target!, 'the document is too short to have somewhere to fail to').toBeGreaterThan(1000);

  await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), target!);
  await expect
    .poll(() => page.evaluate(() => Math.round(scrollY)), { timeout: 10_000 })
    .toBeGreaterThan(target! - 50);
  await settleReadout(page);
  return place(page);
}

/* ONE test per journey, and the reason is measured rather than stylistic.
 *
 * Written as an assertion per test, this file and homepage-modality.spec.ts
 * together added 36 tests to `npm test` and took the run from 8.8 minutes and
 * 4 failures to 19.9 minutes and 64 failures. The extra failures were almost
 * all timeouts in OTHER suites: every test here loads a ~1 MB WebGL homepage
 * two to four times, that page renders at roughly 10 fps under a software
 * rasteriser, and a worker held for half a minute is a worker the rest of the
 * suite does not have. The product fixes cost nothing — the same suite without
 * these two files ran in 9.1 minutes with 5 failures.
 *
 * So a back navigation is exercised once, and everything that has to be true
 * about it is asserted on that one journey. The trade is that an early failure
 * hides the assertions after it; the messages are written to be specific enough
 * that the first one identifies itself.
 *
 * The budget is raised to match what four homepage loads actually cost — 19 s
 * to 27 s on the 1920x1080 project with the machine to itself. Scoped to this
 * file, and not a remedy for the load-dependent failures documented in
 * _build/reports/mobile-test-reconciliation/. */
test.describe.configure({ timeout: 120_000 });

test.describe('the homepage keeps the visitor’s place across history navigation', () => {
  test('back and forward restore the position, the chapter and the chrome', async ({
    page,
  }, testInfo) => {
    /* §11 and §17 — three claims kept apart, and recorded from the first byte
     * of every document so the last one can be reported honestly:
     *
     *   1. the lifecycle HANDLERS exist and run          asserted below
     *   2. observable back-navigation behaviour          asserted below
     *   3. a genuine BFCache HIT                         recorded, not asserted
     *
     * `event.persisted` is the only honest way to tell (3) from (2), and under
     * Playwright it is routinely false: a fresh context, a `python -m
     * http.server` origin and an automation-driven traverse are between them
     * enough to keep the page out of the cache. Asserting it would either be
     * flaky or be a claim of coverage that does not exist. */
    await page.addInitScript(() => {
      const w = window as unknown as { __life: { name: string; persisted?: boolean }[] };
      w.__life = [];
      addEventListener('pageshow', (e) => w.__life.push({ name: 'pageshow', persisted: e.persisted }));
      addEventListener('pagehide', (e) => w.__life.push({ name: 'pagehide', persisted: e.persisted }));
    });

    await page.goto('/index.html');
    await settled(page);

    /* A first visit reserves nothing. The reserve is read from the history
       entry, so an entry that has never been measured must produce none at all
       — otherwise a first visitor pays for a mechanism that exists for a
       returning one. */
    const fresh = await page.evaluate(() => ({
      y: Math.round(scrollY),
      reserve: document.documentElement.style.getPropertyValue('--home-reserve'),
    }));
    expect(fresh.y, 'a fresh load did not start at the top').toBeLessThanOrEqual(4);
    expect(fresh.reserve, 'a fresh load left a height reservation up').toBe('');

    const before = await scrollToAnchor(page);
    // §14: restoring the scroll position and leaving the chrome describing a
    // different altitude would be the same defect wearing a different coat.
    expect(before.headerState, 'the header never left its opening state to begin with').not.toBe(
      'opening',
    );

    // ---- back ---------------------------------------------------------------
    const href = await followInternalLink(page);
    await page.goBack();
    await settled(page);

    const after = await place(page);
    expectRestored(after, before);
    expect(after.headerState, 'the header came back describing a different part of the page').toBe(
      before.headerState,
    );

    /* And no second jump. This one genuinely needs two readings separated by
       time — "did it stay put" is not a state any single sample can report — so
       the wait below is a stability window and not a settle wait. Everything
       this test waits *for* is in `settled()`. */
    await page.waitForTimeout(500);
    const stillY = await page.evaluate(() => Math.round(scrollY));
    expect(Math.abs(stillY - after.y), 'the page moved again after it had settled').toBeLessThanOrEqual(4);

    // ---- forward, then back again -------------------------------------------
    // The fix writes to `history.state`, so the entry has to survive being
    // traversed in both directions rather than only backwards once.
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`${href.split('/').pop()!.replace('.', '\\.')}$`));

    await page.goBack();
    await settled(page);
    expectRestored(await place(page), before);

    // ---- what the lifecycle actually did ------------------------------------
    const life = await page.evaluate(
      () => (window as unknown as { __life: { name: string; persisted?: boolean }[] }).__life,
    );
    const shows = life.filter((e) => e.name === 'pageshow');
    expect(shows.length, 'no pageshow on the restored document').toBeGreaterThanOrEqual(1);

    const bfcache = shows.some((e) => e.persisted);
    testInfo.annotations.push({
      type: 'bfcache',
      description: bfcache
        ? 'genuine BFCache hit observed (pageshow.persisted === true)'
        : 'no BFCache hit in this environment; lifecycle handlers and observable back-navigation behaviour tested, BFCache-hit verification NOT claimed',
    });

    // ---- and it came back settled -------------------------------------------
    const state = await page.evaluate(() => ({
      expanded: document.querySelector('.burger')?.getAttribute('aria-expanded') ?? null,
      menuOpen: document.documentElement.classList.contains('menu-open'),
      bodyPosition: document.body.style.position,
      veils: document.querySelectorAll('.stratos-veil').length,
    }));
    expect(state.expanded, 'the navigation came back open').toBe('false');
    expect(state.menuOpen, 'the scroll lock came back with the page').toBe(false);
    expect(state.bodyPosition, 'the body came back position-fixed').toBe('');
    expect(state.veils, 'a transition veil outlived the navigation').toBe(0);
  });
});
