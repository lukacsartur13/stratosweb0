import { test, expect, type Page } from '@playwright/test';
import { homepageReady } from './helpers/homepage';

/**
 * The full-screen navigation as a MODAL layer.
 *
 * WHY THIS IS NOT IN homepage-chrome.spec.ts
 * ------------------------------------------
 * That file already asserts that focus is trapped inside the layer — and it
 * passed on every project it ran on while the defect this file exists for was
 * live, because it skips itself on every WebKit project in the matrix with
 * "Tab is not a phone interaction". The two suites therefore have to be able to
 * fail independently: one asks whether the trap wraps, this one asks whether
 * there is anything behind the layer left to wrap away from.
 *
 * WHAT WAS ACTUALLY WRONG, AND WHY THE ASSERTIONS ARE SHAPED LIKE THIS
 * --------------------------------------------------------------------
 * Measured in experiments/probe-menu-modality.mjs, on the built artefact:
 *
 *     chromium   0 escapes forward, 0 backward, all three compositions
 *     webkit    15 escapes forward, 15 backward on the homepage
 *               27 / 27 on the generated routes
 *
 * and the first escape was the *first* Tab, landing directly on the newsletter
 * field in the footer. The cause is a platform difference rather than a bug in
 * either engine: WebKit does not place links in the sequential focus order
 * unless the visitor turns "press Tab to highlight each item on a webpage" on.
 * The layer is seventeen links and nothing else, so on WebKit the trap's own
 * list was never the tab order, and Tab went to the next thing that IS in it —
 * a form control, three thousand pixels down the document.
 *
 * That has a direct consequence for how this suite is written. **A tab-trail
 * assertion is necessary but not sufficient**, because on WebKit with the
 * background gone the tab order is legitimately empty: focus does not move at
 * all, and a test that only checked "focus never escaped" would pass on a page
 * with no navigation on it whatsoever. So the trail is asserted *and* the state
 * that makes it true is asserted directly — the background carries `inert`, the
 * newsletter refuses focus even when it is asked for it by name, and both are
 * given back on close.
 */

const burger = (page: Page) => page.locator('.burger');
const menu = (page: Page) => page.locator('#menu');

/** Open the layer and wait for the state that says focus has been placed. */
async function openMenu(page: Page) {
  await burger(page).click();
  // `aria-expanded` is written in the same synchronous block that moves focus,
  // so waiting on it waits for focus rather than for a transition.
  await expect(burger(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(menu(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  // The header is in the parsed shell on every composition, so the deck's
  // behaviour does not wait for React — but the tests below drive the keyboard,
  // and driving it *through* the mount is what makes them expensive rather than
  // what makes them realistic.
  //
  // Measured on `desktop-1920` with the machine to itself, eight presses each
  // way: 8.8 s / 15.3 s driving through the mount, 7.6 s / 13.3 s after waiting
  // for it. A modest saving and not the main cost — that is the ~100 ms frame
  // time of a WebGL journey on a software rasteriser, which no arrangement of
  // this test can avoid — but it is free, and a visitor who has reached the
  // navigation has a page that has arrived. So does this suite.
  await expect(burger(page)).toBeVisible();
  await homepageReady(page);
});

/* The keyboard sweeps below cost 0.7–1.3 s per press on the 1920x1080 project
   — measured serially, see the note on SWEEP — so the budget is raised to match
   what the work costs rather than the tests being cut until they fit it. Scoped
   to this file; no other suite's budget changes, and this is not a remedy for
   the load-dependent failures documented elsewhere. */
test.describe.configure({ timeout: 60_000 });

test.describe('the full-screen navigation is a modal layer', () => {
  test('the background is inert while it is open, and only the background', async ({ page }) => {
    const inertness = async () =>
      page.evaluate(() => {
        const has = (sel: string) => {
          const el = document.querySelector(sel);
          return el ? el.hasAttribute('inert') : null;
        };
        return {
          main: has('#main'),
          footer: has('.foot'),
          arrivalOrShell: has('.arrival') ?? has('.shell'),
          skip: has('body > a.skip'),
          navLinks: has('.nav__links'),
          navCta: has('.nav__cta'),
          // These three are the layer and what stays visible above it.
          menu: has('#menu'),
          burger: has('.burger'),
          brand: has('.nav .brand'),
          // No ancestor of the focused element may be hidden from the
          // accessibility tree — the failure mode the brief rules out by name.
          ariaHiddenAncestorOfFocus: (() => {
            let el: Element | null = document.activeElement;
            while (el) {
              if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
              el = el.parentElement;
            }
            return false;
          })(),
        };
      });

    const closed = await inertness();
    expect(closed.main, 'the page is inert before the menu was even opened').toBe(false);

    await openMenu(page);
    const open = await inertness();

    expect(open.main, '<main> is still in the focus order behind the layer').toBe(true);
    expect(open.footer, 'the footer is still in the focus order behind the layer').toBe(true);
    expect(open.arrivalOrShell, 'the content shell is still reachable behind the layer').toBe(true);
    expect(open.skip, 'the skip link is still reachable behind the layer').toBe(true);
    expect(open.navLinks, 'the faded header navigation is still focusable').toBe(true);
    expect(open.navCta, 'the faded header CTA is still focusable').toBe(true);

    expect(open.menu, 'the layer made itself inert').toBe(false);
    expect(open.burger, 'the close control made itself inert').toBe(false);
    expect(open.brand, 'the wordmark is visible above the layer but not interactive').toBe(false);
    expect(open.ariaHiddenAncestorOfFocus, 'focus is inside an aria-hidden subtree').toBe(false);
  });

  test('no control behind the layer can be reached, by focus or by pointer', async ({ page }) => {
    /* The newsletter field is brought on screen BEFORE the layer opens, and the
       scroll lock then holds the viewport exactly where it is — so the
       coordinates recorded here are still over the field when the click lands
       at the end of this test, and nothing has to be forced.

       It is the field and not `.nav__cta` because the header CTA is
       `display: none` at the portrait viewports in this matrix and has no box
       to aim at there. It is also the control §18 names. */
    await page.locator('#nl').scrollIntoViewIfNeeded();
    const box = await page.locator('#nl').boundingBox();
    expect(box, 'the newsletter field is not on screen to test against').not.toBeNull();

    await openMenu(page);

    /* Stronger than a Tab test and independent of the engine's tab order: this
       asks the element to focus itself and checks that it could not. An inert
       subtree refuses; `tabindex` juggling and a keydown trap do not. */
    const refused = await page.evaluate(() => {
      const targets = ['#nl', '.nav__cta', '.foot a', '#main a'];
      const out: Record<string, string | null> = {};
      for (const sel of targets) {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) {
          out[sel] = null;
          continue;
        }
        el.focus();
        out[sel] = document.activeElement === el ? 'TOOK FOCUS' : 'refused';
      }
      return out;
    });

    expect(refused['#nl'], 'the newsletter field took focus behind the open menu').toBe('refused');
    expect(refused['.nav__cta']).toBe('refused');
    expect(refused['.foot a']).toBe('refused');
    // `#main a` is null on the desktop composition before its links exist; a
    // present link must refuse, an absent one asserts nothing.
    if (refused['#main a'] !== null) expect(refused['#main a']).toBe('refused');

    /* And the same field, through the pointer.
     *
     * The load-bearing assertion is the hit test: at the field's own
     * coordinates the topmost element is the layer, which is what `inert` and
     * the layer's own stacking together guarantee and what "cannot receive
     * pointer interaction" actually means.
     *
     * The click that follows confirms it end to end. It is not asserted to
     * leave the URL alone, and that was a real mistake in an earlier draft of
     * this test: the layer covers the whole viewport, so those coordinates can
     * be over one of the layer's *own* destinations, and following it is
     * correct behaviour. A navigation there is more proof that the click
     * reached the layer, not less — what neither outcome may include is the
     * field behind it taking the click. */
    const point: [number, number] = [box!.x + box!.width / 2, box!.y + box!.height / 2];
    const landedOn = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el ? (el.closest('#menu') ? 'the layer' : `${el.tagName}#${el.id}`) : 'nothing';
    }, point);
    expect(landedOn, 'a pointer aimed at the newsletter field reaches it through the layer').toBe(
      'the layer',
    );

    await page.mouse.click(point[0], point[1]);
    expect(
      await page.evaluate(() => document.activeElement?.id ?? ''),
      'the newsletter field took a click through the layer',
    ).not.toBe('nl');
  });

  /**
   * Record every focus change in the page, rather than sampling after each key.
   *
   * `focusin` sees every element focus passes *through*, including any the
   * browser visits between two samples, so it is both cheaper and stricter than
   * asking `document.activeElement` thirty times.
   */
  async function recordFocus(page: Page) {
    await page.evaluate(() => {
      const w = window as unknown as { __trail: string[] };
      w.__trail = [];
      const where = () => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body || el === document.documentElement) return 'document';
        if (el.closest('#menu')) return 'menu';
        if (el.classList.contains('burger') || el.classList.contains('brand')) return 'deck';
        return `ESCAPED:${el.tagName}#${el.id}.${String(el.className).slice(0, 24)}`;
      };
      w.__trail.push(where());
      document.addEventListener('focusin', () => w.__trail.push(where()));
    });
  }

  async function trailOf(page: Page) {
    return page.evaluate(() => (window as unknown as { __trail: string[] }).__trail);
  }

  /**
   * Put focus on one end of the layer, so the very first key press is the one
   * that crosses the boundary.
   *
   * This is what makes a short sweep a *stronger* test than a long one rather
   * than a cheaper one. Walking forward from wherever `open()` left focus
   * reaches the end of an eighteen-stop layer only after seventeen presses, and
   * every press before that asserts nothing: the interesting moment is the
   * transition out of the last element, which is where a trap either wraps or
   * lets go. Starting at the end puts that moment first and leaves the rest of
   * the sweep to catch anything downstream of it.
   */
  async function focusEdge(page: Page, edge: 'first' | 'last') {
    await page.evaluate((which) => {
      const links = [...document.querySelectorAll<HTMLElement>('#menu a[href]')];
      (which === 'last' ? links[links.length - 1] : links[0])?.focus();
    }, edge);
  }

  /* Eight presses, from the edge, in each direction.
   *
   * The number is a harness-cost decision and it is worth being explicit about
   * why, because the honest alternative would have been to raise a timeout
   * until any number fit.
   *
   * A key press on this page at 1920x1080 costs 0.7–1.3 s. That is measured
   * with the machine entirely to itself — `--workers=1`, nothing else running —
   * so it is not contention: it is what moving focus costs on a document
   * compositing a ~1 MB WebGL scene through a software rasteriser, and it is a
   * property of the page rather than of this change (the thirty-press trap test
   * in homepage-chrome.spec.ts is one of the seven load-dependent failures
   * already documented in _build/reports/mobile-test-reconciliation/). At that
   * rate twelve presses in each direction ran past the 30 s budget on
   * `desktop-1920` while asserting nothing the first press had not.
   *
   * What compensates for the short sweep is `focusEdge` above plus the state
   * assertions in this file: with the background inert, escaping is not
   * something a trap has to prevent press by press — it is not reachable at
   * all, and that is asserted directly rather than sampled. */
  const SWEEP = 8;

  test('Tab never reaches page content behind the layer', async ({ page }) => {
    await openMenu(page);
    await focusEdge(page, 'last');
    await recordFocus(page);

    for (let i = 0; i < SWEEP; i++) await page.keyboard.press('Tab');

    const trail = await trailOf(page);
    const escaped = trail.filter((t) => t.startsWith('ESCAPED'));
    expect(trail[0], 'focus did not enter the layer on open').toBe('menu');
    expect(escaped, `focus reached page content behind the layer: ${escaped.join(', ')}`).toEqual([]);

    /* Deliberately NOT `trail.length > SWEEP`.
     *
     * On WebKit with the background inert the document's sequential focus order
     * is genuinely empty — links are not in it by default and nothing else is
     * left — so focus correctly does not move at all, and the shipped keydown
     * trap has nothing to wrap. Requiring movement here would be requiring one
     * engine to behave like the other. What every engine must do is never
     * leave, which is the assertion above; that the layer is not simply empty
     * is asserted by the inert and focus tests in this file, and the cycling
     * behaviour by homepage-chrome.spec.ts. */
  });

  test('Shift+Tab never reaches page content behind the layer', async ({ page }) => {
    await openMenu(page);
    await focusEdge(page, 'first');
    await recordFocus(page);

    for (let i = 0; i < SWEEP; i++) await page.keyboard.press('Shift+Tab');

    const trail = await trailOf(page);
    const escaped = trail.filter((t) => t.startsWith('ESCAPED'));
    expect(trail[0], 'focus did not enter the layer on open').toBe('menu');
    expect(escaped, `focus reached page content behind the layer: ${escaped.join(', ')}`).toEqual([]);
  });


  test('Escape closes it, focus returns to the trigger, and the page comes back', async ({ page }) => {
    /* Two cycles in one page load, and the second one is the assertion that
       matters: the release path only clears the elements it set, so a
       bookkeeping error there is invisible on the first open and shows up on
       the second. Merged into this test rather than given its own, because a
       separate test is another load of a ~1 MB WebGL homepage for two
       attribute reads — see the note on SWEEP above. */
    for (let cycle = 0; cycle < 2; cycle++) {
      await burger(page).focus();
      await burger(page).press('Enter');
      await expect(menu(page)).toBeVisible();
      expect(
        await page.evaluate(() => document.querySelector('#main')!.hasAttribute('inert')),
        `the background was not made inert on open ${cycle + 1}`,
      ).toBe(true);

      await page.keyboard.press('Escape');
      await expect(burger(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(burger(page)).toBeFocused();

      // The background is given back — not left inert, which would be the same
      // defect with the opposite sign.
      const after = await page.evaluate(() => {
        const nl = document.querySelector<HTMLElement>('#nl');
        nl?.focus();
        return {
          main: document.querySelector('#main')?.hasAttribute('inert') ?? null,
          footer: document.querySelector('.foot')?.hasAttribute('inert') ?? null,
          navLinks: document.querySelector('.nav__links')?.hasAttribute('inert') ?? null,
          newsletterFocusable: nl ? document.activeElement === nl : null,
        };
      });

      expect(after.main, `the page was left inert after close ${cycle + 1}`).toBe(false);
      expect(after.footer).toBe(false);
      expect(after.navLinks).toBe(false);
      expect(after.newsletterFocusable, 'the newsletter never became focusable again').toBe(true);
    }
  });
});
