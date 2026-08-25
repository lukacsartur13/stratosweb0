import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Which homepage did this viewport get, and where is its readout?
 *
 * The homepage is now two compositions — the desktop cinematic journey and the
 * portrait-mobile editorial page — and they are separate on purpose (see
 * `experiments/src/full/main.tsx`). Several suites were written when there was
 * one, and reached for `data-testid="altitude-hud"` as their "the page is
 * running" precondition. On a phone that element no longer exists, and a
 * `toBeVisible()` on it fails for a reason that has nothing to do with what the
 * test is asking.
 *
 * The behaviours those suites assert — the header compacting into its journey
 * state, printing the page's altitude rather than one of its own, not
 * chattering on a boundary, surviving the menu — are true of BOTH
 * compositions, and both are worth testing. So the precondition becomes "the
 * homepage is running" and the readout becomes "whichever readout this
 * composition has", and the tests stay about what they were about.
 *
 * ## Why the fork is detected from the DOM and not from the viewport
 *
 * `main.tsx` decides from `screen`'s short edge and the pointer type. A test
 * that re-derived that from `page.viewportSize()` would be a second
 * implementation of the thing under test, and the two agreeing would prove only
 * that the same assumption was made twice. Asking what actually mounted is the
 * only reading that cannot drift.
 */

/** True when the simplified portrait composition is the one on screen. */
export const isMobileHomepage = (page: Page) =>
  page.locator('[data-testid="mobile-home"]').count().then((n) => n > 0);

/**
 * Wait until the homepage is running, whichever composition it chose.
 *
 * Not a duration. The desktop path is ready when its instrument strip is
 * visible; the mobile path is ready when `mv-on` is on the root, which
 * `MobileHome` adds after the first `measureAscent`. Both are the exact event.
 */
export async function homepageReady(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="altitude-hud"], [data-testid="mobile-telemetry"]', {
    state: 'visible',
    timeout: 20_000,
  });
  if (await isMobileHomepage(page)) {
    await page.waitForFunction(() => document.documentElement.classList.contains('mv-on'), null, {
      timeout: 20_000,
    });
  }
}

/** The live altitude readout of whichever composition mounted. */
export async function altitudeReadout(page: Page): Promise<Locator> {
  return (await isMobileHomepage(page))
    ? page.getByTestId('mobile-altitude')
    : page.getByTestId('altitude-value');
}

/** The live stage name of whichever composition mounted. */
export async function stageReadout(page: Page): Promise<Locator> {
  return (await isMobileHomepage(page))
    ? page.getByTestId('mobile-stage')
    : page.getByTestId('altitude-stage');
}

/** The metres the page is currently reporting. */
export async function altitudeMetres(page: Page): Promise<number> {
  const readout = await altitudeReadout(page);
  const text = (await readout.textContent()) ?? '';
  return Number(text.replace(/[^\d]/g, ''));
}

/**
 * Assert the homepage is showing a live, moving altitude.
 *
 * Used where a suite previously asserted the presence of the HUD as a proxy for
 * "the journey initialised". The proxy was always weaker than the thing: a HUD
 * can be present and frozen, which is the failure it was meant to catch.
 */
export async function expectLiveAltitude(page: Page): Promise<void> {
  await homepageReady(page);
  const readout = await altitudeReadout(page);
  await expect(readout).toHaveText(/\d/);
}

/**
 * Start the journey the way a visitor does.
 *
 * The production homepage does not mount on load any more. `src/full/main.tsx`
 * waits for the visitor to move a pointer, touch the screen, press a key or
 * scroll, because until then the document's own opening frame — headline, lead
 * and call to action, static in the shell — is the whole of what the page needs
 * to be. That deferral is what took Total Blocking Time from 1 470 ms to under
 * 100 and moved the largest contentful paint off the footer and onto the
 * headline; see the note at the top of that file.
 *
 * A test that navigates and asserts is a visitor who arrives and does nothing,
 * so it correctly gets a page with no journey on it. This gives it a first
 * move.
 *
 * ## Why an init script and not `page.mouse.move()`
 *
 * Because it has to be armed BEFORE the navigation it applies to, and because
 * several suites navigate more than once — a reload, a Back, a language switch
 * — and each of those documents needs its own first move. An init script runs
 * on every document this page loads, for the life of the page.
 *
 * ## Why it dispatches a real event rather than setting a flag
 *
 * There is no flag. The page has one way to start and this uses it: the same
 * `scroll` listener, on the same target, that a finger reaches. A test hook
 * that bypassed the trigger would be a test suite proving that a code path
 * nobody ships still works.
 *
 * `load`, not `DOMContentLoaded`: the entry is a module script, so it is
 * evaluated — and its listeners registered — after the DOM is ready and before
 * the load event. Dispatching any earlier is dispatching into no listener.
 */
export async function bootJourneyOnLoad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    addEventListener('load', () => dispatchEvent(new Event('scroll')), { once: true });
  });
}
