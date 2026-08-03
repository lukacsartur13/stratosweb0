import { expect, type Page } from '@playwright/test';

// =============================================================================
// Reduced motion, activated *and verified*.
//
// Why this file exists
// --------------------
// Playwright's declarative `reducedMotion: 'reduce'` — set in a project's `use`
// block or via `test.use()` — does not reliably reach `matchMedia()` in this
// project on Playwright 1.62.1. A page belonging to a project that declares it
// still reports:
//
//     matchMedia('(prefers-reduced-motion: reduce)').matches === false
//
// while `page.emulateMedia({ reducedMotion: 'reduce' })` on that same page
// reports `true`. That failure mode is silent and it is the worst kind: the
// test still passes, the suite still reports a reduced-motion project, and the
// assertions inside it were made against the ordinary animated page the whole
// time. A green reduced-motion test that never enabled reduced motion is worse
// than no test, because it is cited as evidence.
//
// So every reduced-motion test calls `enableReducedMotion(page)` instead, which
// does two things and refuses to do only the first:
//
//   1. emulates the media state at runtime, on the page, before navigation;
//   2. proves — from inside the page, after navigation — that the media query
//      actually flipped, failing loudly if it did not.
//
// Step 2 is the entire point. Without it this helper is just a longer way to
// write the declarative option and inherits exactly the same silent failure.
//
// Ordering
// --------
// `emulateMedia` is called before `page.goto()` because the application reads
// `prefers-reduced-motion` once, during its capability probe, on first mount.
// Emulating after navigation would flip the media query underneath an app that
// had already decided to run the animated path — the query would report `true`
// and the page would still be animating, which is the same lie in a new shape.
// =============================================================================

const QUERY = '(prefers-reduced-motion: reduce)';

/** Read the media state from inside the page. The only source of truth. */
export function matchesReducedMotion(page: Page): Promise<boolean> {
  return page.evaluate((q) => matchMedia(q).matches, QUERY);
}

/**
 * Turn reduced motion on for this page and prove it took effect.
 *
 * Call before navigating. Because `matchMedia` needs a document to evaluate
 * against, the verification cannot happen on `about:blank`; it is deferred to
 * `assertReducedMotionActive`, which every caller must run after `goto`. The
 * returned function is that assertion, bound to the page, so the two halves are
 * hard to separate by accident:
 *
 *     const verify = await enableReducedMotion(page);
 *     await page.goto('/');
 *     await verify();
 */
export async function enableReducedMotion(page: Page): Promise<() => Promise<void>> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  return () => assertReducedMotionActive(page);
}

/**
 * Fail immediately, and legibly, if the emulation did not reach the page.
 *
 * Every subsequent assertion in a reduced-motion test is meaningless when this
 * is false, so it runs first and it throws rather than skipping: a skipped test
 * disappears into the summary, a failing one gets fixed.
 */
export async function assertReducedMotionActive(page: Page): Promise<void> {
  const active = await matchesReducedMotion(page);
  expect(
    active,
    `matchMedia('${QUERY}').matches is false — reduced motion was not actually ` +
      `emulated on this page, so every reduced-motion assertion after this point ` +
      `would be testing the ordinary animated path. Call enableReducedMotion(page) ` +
      `before page.goto(); do not rely on the declarative project option.`,
  ).toBe(true);
}

/**
 * The inverse guard, for tests that claim to exercise the *animated* path.
 *
 * A motion test that silently ran with reduced motion on would fail for the
 * wrong reason, or worse, pass while asserting the fallback. Cheap to check.
 */
export async function assertReducedMotionInactive(page: Page): Promise<void> {
  const active = await matchesReducedMotion(page);
  expect(active, `expected the animated path, but '${QUERY}' matches`).toBe(false);
}
