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
 *
 * WHY TWO TESTS AND NOT SEVEN
 * ---------------------------
 * Because the shape of a suite has a measured cost here and it is not small.
 * Written as one assertion per test, these two files added 36 tests to `npm
 * test` and took the run from 8.8 minutes / 4 failures to 19.9 minutes / 64
 * failures — the extra failures almost all timeouts in OTHER suites, starved of
 * a core by long-running tests holding workers while a ~1 MB WebGL homepage
 * rendered at ~10 fps under a software rasteriser. The product fixes themselves
 * cost nothing; the same suite without these two files ran in 9.1 minutes with
 * 5 failures.
 *
 * Each test below is therefore one page load walking one contract end to end,
 * which is also how a visitor meets it. The trade is real and worth naming: an
 * early failure hides the assertions after it. The messages are written to be
 * specific enough that the first failure identifies itself without the rest.
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

/* Sixteen key presses at 0.7–1.3 s each on the 1920x1080 project — measured
   serially, see the note on SWEEP below — so the budget matches what the work
   costs rather than the tests being cut until they fit it. Scoped to this file;
   no other suite's budget changes, and this is not a remedy for the
   load-dependent failures documented in
   _build/reports/mobile-test-reconciliation/. */
test.describe.configure({ timeout: 60_000 });

test.describe('the full-screen navigation is a modal layer', () => {
  test('while it is open the page behind it cannot be reached, and afterwards it can', async ({
    page,
  }) => {
    /* The newsletter field is brought on screen BEFORE the layer opens, and the
       scroll lock then holds the viewport exactly where it is — so the
       coordinates recorded here are still over the field when the click lands,
       and nothing has to be forced.

       It is the field and not `.nav__cta` because the header CTA is
       `display: none` at the portrait viewports in this matrix and has no box
       to aim at there. It is also the control §18 names. */
    await page.locator('#nl').scrollIntoViewIfNeeded();
    const box = await page.locator('#nl').boundingBox();
    expect(box, 'the newsletter field is not on screen to test against').not.toBeNull();

    const inertness = () =>
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

    expect((await inertness()).main, 'the page is inert before the menu was even opened').toBe(false);

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

    /* Stronger than a Tab test and independent of the engine's tab order: this
       asks each element to focus itself and checks that it could not. An inert
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
    expect(refused['.nav__cta'], 'the header CTA took focus behind the open menu').toBe('refused');
    expect(refused['.foot a'], 'a footer link took focus behind the open menu').toBe('refused');
    // `#main a` is null on the desktop composition before its links exist; a
    // present link must refuse, an absent one asserts nothing.
    if (refused['#main a'] !== null) {
      expect(refused['#main a'], 'a link in <main> took focus behind the open menu').toBe('refused');
    }

    /* And the same field, through the pointer.
     *
     * The load-bearing assertion is the hit test: at the field's own
     * coordinates the topmost element is the layer, which is what "cannot
     * receive pointer interaction" actually means.
     *
     * The click that follows confirms it end to end. It is deliberately not
     * asserted to leave the URL alone: the layer covers the whole viewport, so
     * those coordinates can be over one of the layer's *own* destinations, and
     * following it is correct. A navigation there is more proof that the click
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
    /* Settle first, whether or not that click navigated. Without this the
       `evaluate` below races the commit of a document the click may have
       started loading, and Playwright reports "Execution context was destroyed"
       — which is this test being wrong about timing, not the page being wrong
       about anything. `waitForLoadState` resolves immediately when nothing
       navigated. */
    await page.waitForLoadState('domcontentloaded');
    expect(
      await page.evaluate(() => document.activeElement?.id ?? ''),
      'the newsletter field took a click through the layer',
    ).not.toBe('nl');
  });

  test('keyboard focus stays in the layer, Escape closes it, and the page comes back', async ({
    page,
  }) => {
    /**
     * Record every focus change in the page, rather than sampling after each
     * key. `focusin` sees every element focus passes *through*, including any
     * the browser visits between two samples.
     */
    const recordFocus = () =>
      page.evaluate(() => {
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
        document.addEventListener('focusin', () => w.__trail.push(where()), { once: false });
      });

    const trailOf = () => page.evaluate(() => (window as unknown as { __trail: string[] }).__trail);

    /**
     * Put focus on one end of the layer, so the very first key press is the one
     * that crosses the boundary.
     *
     * This is what makes a short sweep a *stronger* test than a long one rather
     * than only a cheaper one. Walking forward from wherever `open()` left
     * focus reaches the end of an eighteen-stop layer only after seventeen
     * presses, and every press before that asserts nothing: the interesting
     * moment is the transition out of the last element, which is where a trap
     * either wraps or lets go. Starting at the end puts that moment first.
     */
    const focusEdge = (edge: 'first' | 'last') =>
      page.evaluate((which) => {
        const links = [...document.querySelectorAll<HTMLElement>('#menu a[href]')];
        (which === 'last' ? links[links.length - 1] : links[0])?.focus();
      }, edge);

    /* Eight presses each way.
     *
     * A key press on this page at 1920x1080 costs 0.7–1.3 s, measured with the
     * machine entirely to itself — that is what moving focus costs on a
     * document compositing a ~1 MB WebGL scene through a software rasteriser,
     * and it is a property of the page rather than of this change. Eight from
     * the edge crosses the boundary on the first press and walks seven more. */
    const SWEEP = 8;

    await openMenu(page);

    await focusEdge('last');
    await recordFocus();
    for (let i = 0; i < SWEEP; i++) await page.keyboard.press('Tab');
    let trail = await trailOf();
    let escaped = trail.filter((t) => t.startsWith('ESCAPED'));
    expect(trail[0], 'focus did not enter the layer on open').toBe('menu');
    expect(escaped, `Tab reached page content behind the layer: ${escaped.join(', ')}`).toEqual([]);

    await focusEdge('first');
    await recordFocus();
    for (let i = 0; i < SWEEP; i++) await page.keyboard.press('Shift+Tab');
    trail = await trailOf();
    escaped = trail.filter((t) => t.startsWith('ESCAPED'));
    expect(escaped, `Shift+Tab reached page content behind the layer: ${escaped.join(', ')}`).toEqual(
      [],
    );

    /* Deliberately NOT `trail.length > SWEEP`.
     *
     * On WebKit with the background inert the document's sequential focus order
     * is genuinely empty — links are not in it by default and nothing else is
     * left — so focus correctly does not move at all, and the shipped keydown
     * trap has nothing to wrap. Requiring movement here would be requiring one
     * engine to behave like the other. What every engine must do is never
     * leave; that the layer is not simply empty is asserted by the inert and
     * focus-refusal test above, and the cycling behaviour by
     * homepage-chrome.spec.ts, which skips the engines that do not have it. */

    /* Escape, focus restoration, and the background given back — then the whole
       cycle again, because the release path only clears the elements it set and
       a bookkeeping error there is invisible on the first close. */
    for (let cycle = 0; cycle < 2; cycle++) {
      if (cycle > 0) {
        await burger(page).focus();
        await burger(page).press('Enter');
        await expect(menu(page)).toBeVisible();
        expect(
          await page.evaluate(() => document.querySelector('#main')!.hasAttribute('inert')),
          'the background was not made inert on the second open',
        ).toBe(true);
      }

      await page.keyboard.press('Escape');
      await expect(burger(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(burger(page)).toBeFocused();

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
      expect(after.footer, `the footer was left inert after close ${cycle + 1}`).toBe(false);
      expect(after.navLinks, `the header navigation was left inert after close ${cycle + 1}`).toBe(false);
      expect(
        after.newsletterFocusable,
        `the newsletter never became focusable again after close ${cycle + 1}`,
      ).toBe(true);
    }
  });

  test('reopening within the close transition does not hide the layer', async ({ page }) => {
    /**
     * The regression this exists for.
     *
     * `close()` cannot hide the layer at once — it has a 420 ms transition to
     * play — so it hides it on a timer. That timer used to be armed without a
     * handle, and nothing took it back: a visitor who closed the navigation and
     * opened it again inside 420 ms got `hidden = true` applied to a layer that
     * was now open. `aria-expanded` said "true", `.is-open` was on the element,
     * focus had been moved into it, and there was nothing on screen.
     *
     * Reproduced on both engines at every gap below 420 ms before the fix, and
     * on neither after it.
     *
     * ## Why the cycle is driven from inside the page
     *
     * The bug is a race against a 420 ms timer, so the gap between close and
     * reopen has to be the quantity under test rather than whatever a protocol
     * round trip happened to cost that run. Two `page.click()` calls through
     * the driver measure the machine; `setTimeout` in the page measures the
     * contract. This is also why the assertion survives a slow machine: at
     * 4 fps a driven reopen takes seconds and lands *outside* the window, which
     * is exactly how this defect stayed invisible on a loaded run and surfaced
     * on the fastest project in the matrix.
     *
     * ## Why `hidden` and not a screenshot
     *
     * `hidden` is the property that was wrong. A visibility assertion would
     * also catch it, and would additionally fail for every unrelated reason a
     * transition can be mid-flight — this names the defect.
     */
    await page.goto('/index.html');
    await homepageReady(page);
    await openMenu(page);

    const state = await page.evaluate(async () => {
      const burger = document.querySelector<HTMLElement>('.burger')!;
      const menu = document.querySelector<HTMLElement>('#menu')!;
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(100); // well inside the 420 ms hide timer
      burger.click();
      await wait(600); // outlive the timer the close armed

      return {
        expanded: burger.getAttribute('aria-expanded'),
        hidden: menu.hidden,
        open: menu.classList.contains('is-open'),
      };
    });

    expect(state.expanded, 'the trigger did not report the layer as open').toBe('true');
    expect(state.open, 'the layer did not take its open class').toBe(true);
    expect(
      state.hidden,
      'the previous close’s hide timer hid a layer that had been reopened — ' +
        'aria-expanded says open, .is-open is set, focus is inside it, and the ' +
        'visitor is looking at nothing',
    ).toBe(false);
  });
});
