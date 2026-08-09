import { expect, test, type Page } from '@playwright/test';
import { enableReducedMotion } from '../../tests/helpers/reduced-motion';
import { STAGES } from '../src/full/journey';

/**
 * The portrait journey, as CURRENT HEAD actually builds it.
 *
 * ## What this file replaces, and why it had to be replaced rather than skipped
 *
 * `full-ascent.spec.ts` used to run on the portrait projects. It asserted a
 * WebGL journey there: a canvas, a sticky `journey__track` eleven panels deep,
 * a damped scroll-driven altitude clock, a `.hud` strip, a `data-meridian`
 * attribute announcing six structural instrument states, and a sticky handoff
 * into the closing CTA.
 *
 * None of that exists on a phone any more. `src/full/main.tsx` forks once, on
 * `screen`'s short edge and the pointer type, and a portrait device gets
 * `mobile/MobileHome.tsx`: eleven ordinary block-flow `<section>`s in the
 * document, an `IntersectionObserver` for the text reveals, one `scroll`
 * listener reading `scrollY` with no damping, and the Altimeter GLB in a
 * fixed CSS box that nothing downstream can resize. The desktop composition is
 * untouched and `full-ascent.spec.ts` still asserts every word of it — on the
 * projects that get it.
 *
 * Extending that file's existing `test.skip` to three more projects would have
 * turned an open question into a silent assumption, which is what the previous
 * audit refused to do. So the implementation assertions are gone and this file
 * is what stands in their place: the same *requirements*, asked of the surface
 * that now has to satisfy them.
 *
 * ## The four requirements carried over verbatim
 *
 * The previous audit identified four checks in the old portrait suite that were
 * not safely stale — properties a portrait page should satisfy whatever drives
 * it. Each has a test here, strengthened to observe what a visitor gets rather
 * than what the old architecture happened to be made of:
 *
 *   old `every stage, case study and process step is real HTML`
 *      → `every chapter is real HTML, present before any scrolling`
 *   old `the CTA arrives over the scene, with no gap and no footer collision`
 *      → `the closing action is reachable, tappable and last`
 *   old `scrolling to the very end is not trapped and does not jump`
 *      → `the document ends, and nothing takes the scroll back`
 *   old `the structural stages are announced in order`
 *      → `the chapters are announced in reading order, and unwound in reverse`
 *
 * ## What is deliberately not asserted
 *
 * No millisecond timings, no `--stage-flow`-style internal custom properties,
 * no canvas child counts, no React component names, no screenshot comparison.
 * The one number taken from the source is `STAGES`, and that is the narrative's
 * own table — the copy quotes it and the sections are annotated from it, so a
 * test that re-listed the eleven chapters here would be a second copy of it.
 *
 * ## Cost
 *
 * Five viewports, and not five times the suite. Everything tagged `@smoke`
 * runs on all five; the rest runs on the representative portrait size and on
 * landscape, which are the two shapes with genuinely different failure modes.
 * See the project table in `playwright.full.config.ts`.
 */

/** The composition that mounted. Asked of the DOM, never derived from the viewport. */
const mounted = (page: Page) =>
  page.locator('[data-testid="mobile-home"]').count().then((n) => n > 0);

/**
 * The page is ready to measure.
 *
 * `mv-on` lands on the root in `MobileHome`'s mount effect, after the first
 * `measureAscent()` — so it is the exact event "the sections have been
 * measured", not a duration that usually covers it.
 */
async function ready(page: Page) {
  await page.waitForFunction(() => document.documentElement.classList.contains('mv-on'), null, {
    timeout: 30_000,
  });
}

/**
 * Open the route and assert the fork went the way this file is about.
 *
 * A `test.skip` here would be the wrong instrument. On these projects the
 * portrait composition is not one possible outcome, it is the contract: if a
 * phone-shaped, coarse-pointer viewport is served the desktop cinematic page,
 * that is the regression this suite exists to catch, and it must be red rather
 * than quietly absent from the summary.
 */
async function open(page: Page) {
  await page.goto('./');
  expect(
    await mounted(page),
    'a coarse-pointer viewport with a short edge under 540px was served the desktop composition',
  ).toBe(true);
  await ready(page);
}

/** Walk the whole document once so every reveal has fired, then come back. */
async function revealed(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = await page.evaluate(() => Math.round(innerHeight * 0.8));
  for (let y = 0; y < height; y += step) {
    await page.evaluate((to) => scrollTo({ top: to, behavior: 'instant' as ScrollBehavior }), y);
    await page.waitForTimeout(70);
  }
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }));
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.mv-text:not(.is-in), .mv-copy:not(.is-in), .mv-lines:not(.is-in)')
        .length === 0,
    null,
    { timeout: 30_000 },
  );

  // `.is-in` is the *start* of the reveal, not the end of it: the class lands
  // on the node and a CSS transition of up to 1.05 s plus a staggered delay
  // carries the opacity to 1. Waiting for the class and then measuring opacity
  // reads a page mid-transition and reports composed content as hidden.
  //
  // Waited for as a condition rather than slept on. A `waitForTimeout(1500)`
  // here would be a statement about this machine, and the number would need
  // raising the first time the suite ran on a slower one.
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.mv-text, .mv-lines, .mv-copy, .mv-label, .mv-rule')].every(
        (el) => Number(getComputedStyle(el).opacity) >= 0.9,
      ),
    null,
    { timeout: 30_000 },
  );
}

/**
 * Deny WebGL the way a blocklisted driver does: the constructor is still there,
 * context creation just fails. Must be installed before the first module runs,
 * because the capability probe happens on mount.
 */
async function denyWebGL(page: Page) {
  await page.addInitScript(() => {
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext: (type: string, ...rest: unknown[]) => unknown;
    };
    const original = proto.getContext;
    proto.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (typeof type === 'string' && type.includes('webgl')) return null;
      return original.call(this, type, ...rest);
    };
  });
}

/** Scroll to a fraction of the document and let one frame land. */
async function scrollToFraction(page: Page, f: number) {
  await page.evaluate((fraction) => {
    const travel = document.documentElement.scrollHeight - innerHeight;
    scrollTo({ top: travel * fraction, behavior: 'instant' as ScrollBehavior });
  }, f);
  await page.waitForTimeout(140);
}

/** The scroll position, once it has stopped moving on its own. */
async function restingScrollY(page: Page): Promise<number> {
  let last = -1;
  for (let i = 0; i < 25; i++) {
    const y = await page.evaluate(() => Math.round(scrollY));
    if (y === last) return y;
    last = y;
    await page.waitForTimeout(120);
  }
  return last;
}

const STAGE_IDS = STAGES.map((s) => s.id);

// =============================================================================
// Native scrolling — §6 of the reconciliation brief.
//
// The whole architectural claim of the portrait rebuild is that the browser
// scrolls the document and nothing else participates. These are the assertions
// that hold it, and each names a specific thing the old composition did.
// =============================================================================
test.describe('portrait — the document does its own scrolling', () => {
  test('the document is the scroller, untransformed and unsnapped @smoke', async ({ page }) => {
    await open(page);

    const native = await page.evaluate(() => {
      const html = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      return {
        scroller: document.scrollingElement === document.documentElement,
        htmlTransform: html.transform,
        bodyTransform: body.transform,
        bodyPosition: body.position,
        snap: `${html.scrollSnapType}|${body.scrollSnapType}`,
        overflowY: body.overflowY,
      };
    });

    expect(native.scroller, 'scrolling was handed to a container').toBe(true);
    expect(['none', ''], 'the root is transformed').toContain(native.htmlTransform);
    expect(['none', ''], 'the body is transformed').toContain(native.bodyTransform);
    expect(native.bodyPosition).not.toBe('fixed');
    expect(native.snap).not.toContain('mandatory');
    expect(native.snap).not.toContain('proximity');
    expect(['visible', 'clip', 'auto']).toContain(native.overflowY);
  });

  test('no element stands in for the document as a full-page scroller @smoke', async ({ page }) => {
    await open(page);

    // A nested scroller is only a *substitute* for the document when it is both
    // scrollable and about as large as the viewport. Small scrollable regions —
    // a code block, an overflowing table — are not what this forbids.
    const impostors = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((el) => {
          const cs = getComputedStyle(el);
          if (!/(auto|scroll)/.test(cs.overflowY)) return false;
          if (el.scrollHeight <= el.clientHeight + 4) return false;
          const r = el.getBoundingClientRect();
          return r.height > innerHeight * 0.75 && r.width > innerWidth * 0.75;
        })
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`),
    );

    expect(impostors, 'a full-viewport nested scroller is standing in for the document').toEqual([]);
  });

  test('nothing moves the scroll position on the page\'s behalf', async ({ page }) => {
    await open(page);

    // The harness has to scroll too, so the wrappers ignore calls made while
    // `__harness` is set — otherwise this test would be watching itself.
    await page.evaluate(() => {
      const w = window as unknown as { __programmatic: string[]; __harness: boolean };
      w.__programmatic = [];
      w.__harness = false;
      for (const name of ['scrollTo', 'scrollBy', 'scroll'] as const) {
        const raw = (window[name] as (...a: unknown[]) => void).bind(window);
        (window as unknown as Record<string, unknown>)[name] = (...a: unknown[]) => {
          if (!w.__harness) w.__programmatic.push(name);
          return raw(...a);
        };
      }
      const rawInto = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (...a: unknown[]) {
        if (!w.__harness) w.__programmatic.push('scrollIntoView');
        return rawInto.apply(this, a as never);
      };
    });

    const move = (to: number) =>
      page.evaluate((y) => {
        const w = window as unknown as { __harness: boolean };
        w.__harness = true;
        scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
        w.__harness = false;
      }, to);

    await move(2600);
    await page.waitForTimeout(600);
    await move(1300);
    await page.waitForTimeout(800);

    expect(
      await page.evaluate(() => (window as unknown as { __programmatic: string[] }).__programmatic),
      'the page scrolled itself',
    ).toEqual([]);

    // The direct form of the same question, and the one that catches a
    // measurement feedback loop rather than a scroll handler: left alone, the
    // position must not change at all.
    const resting = await page.evaluate(() => scrollY);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => scrollY), 'the scroll position drifted while idle').toBe(resting);
  });

  test('the composition stops when the scroll stops', async ({ page }) => {
    await open(page);
    await revealed(page);

    await page.evaluate(() => scrollTo({ top: 3200, behavior: 'instant' as ScrollBehavior }));
    // Long enough that a damped continuation would have started, short enough
    // that one would not yet have finished.
    await page.waitForTimeout(140);

    const drift = await page.evaluate(async () => {
      const sample = () =>
        [...document.querySelectorAll('[data-stage], .mv-title, .mv-alt, .mv-telemetry')].map(
          (el) => Math.round(el.getBoundingClientRect().top * 10) / 10,
        );
      const before = sample();
      await new Promise((r) => setTimeout(r, 420));
      const after = sample();
      return Math.max(...before.map((v, i) => Math.abs((after[i] ?? 0) - v)));
    });

    // Zero, not "small". Nothing here is interpolated towards a scroll target,
    // so there is nothing that could still be arriving 420 ms later.
    expect(drift, 'the composition kept moving after the scroll stopped').toBe(0);
  });

  test('the document ends, and nothing takes the scroll back @smoke', async ({ page }) => {
    // Carried over from the old suite's `scrolling to the very end is not
    // trapped and does not jump`. The mechanism it watched — a sticky stage
    // releasing — is gone; the requirement is not.
    await open(page);
    await revealed(page);

    const end = await page.evaluate(() => {
      scrollTo({ top: 1e7, behavior: 'instant' as ScrollBehavior });
      return document.documentElement.scrollHeight - innerHeight;
    });
    await page.waitForTimeout(200);

    const landed = await restingScrollY(page);
    expect(Math.abs(end - landed), 'the bottom of the document is not reachable').toBeLessThanOrEqual(2);

    // And it stays there: a trap shows up as the position being taken back.
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => Math.round(scrollY)), 'the end of the document is a trap').toBe(
      landed,
    );

    // Coming back up is equally unobstructed, in one jump.
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }));
    await page.waitForTimeout(300);
    expect(await restingScrollY(page)).toBe(0);
  });
});

// =============================================================================
// Content progression — the four preserved requirements, and the chapter order.
// =============================================================================
test.describe('portrait — the content', () => {
  test('every chapter is real HTML, present before any scrolling @smoke', async ({ page }) => {
    // The old suite's `every stage, case study and process step is real HTML`,
    // retargeted. Same question, and a stricter one: nothing here may depend on
    // a scene mounting first, so it is asked before the page has been scrolled
    // at all.
    await open(page);

    await expect(page.locator('h1')).toHaveCount(1);

    for (const id of STAGE_IDS) {
      const section = page.getByTestId(`stage-${id}`);
      await expect(section, `chapter ${id} is missing`).toHaveCount(1);
      expect(
        (await section.innerText()).trim().length,
        `chapter ${id} is empty`,
      ).toBeGreaterThan(60);
    }

    // Three case studies, each carrying the portrait composition's three-part
    // structure — challenge, intervention, result — answered in prose.
    //
    // Three terms, not the desktop composition's five. `MobileHome` prints
    // challenge/intervention/result and drops `implementation` and `ongoing`;
    // the checkpoints below drop `youProvide` the same way. That is the
    // accepted portrait edit rather than a fault, and the number is asserted
    // exactly so that a *further* field going missing is a failure rather than
    // a shrug. The difference is recorded in the reconciliation report; it is a
    // content decision, and this file is not where it gets decided.
    for (const id of ['rapidkert', 'barbershop', 'mentaltrening']) {
      const c = page.getByTestId(`case-${id}`);
      await expect(c, `case ${id} is missing`).toHaveCount(1);
      await expect(c.locator('dt')).toHaveCount(3);
      for (const dd of await c.locator('dd').all()) {
        expect((await dd.innerText()).trim().length).toBeGreaterThan(20);
      }
    }
    await expect(
      page.locator('[data-testid^="case-"]'),
      'the homepage shows exactly three project summaries',
    ).toHaveCount(3);

    // Seven process checkpoints, each with its three columns answered.
    for (let i = 1; i <= 7; i++) {
      const cp = page.getByTestId(`checkpoint-${i}`);
      await expect(cp).toHaveCount(1);
      await expect(cp.locator('dt')).toHaveCount(3);
      for (const dd of await cp.locator('dd').all()) {
        expect((await dd.innerText()).trim().length).toBeGreaterThan(10);
      }
    }
  });

  test('no chapter waits for a renderer to exist @smoke', async ({ page }) => {
    // The specific stale assumption this replaces: the old suite asserted the
    // canvas first and read the content through it. Deny WebGL outright and the
    // whole document must still be there — which is also the honest statement
    // of what "the content survives without the canvas" means now.
    await denyWebGL(page);

    await open(page);

    for (const id of STAGE_IDS) {
      expect(
        (await page.getByTestId(`stage-${id}`).innerText()).trim().length,
        `chapter ${id} is empty without WebGL`,
      ).toBeGreaterThan(60);
    }
    await expect(page.locator('[data-testid^="case-"]')).toHaveCount(3);
  });

  test('the skip link lands on the content @smoke', async ({ page }) => {
    await open(page);

    const skip = page.locator('a.skip');
    await expect(skip).toHaveCount(1);
    const href = (await skip.getAttribute('href'))!;
    expect(href.startsWith('#'), `the skip link points at ${href}`).toBe(true);

    // It has to land somewhere, and the somewhere has to be the content — not
    // an empty anchor above it. The target must exist, must be focusable by the
    // fragment, and the first chapter must be inside it.
    const target = await page.evaluate((id) => {
      const el = document.querySelector(id);
      if (!el) return null;
      const first = document.querySelector('[data-stage]');
      return { contains: !!first && el.contains(first), height: el.getBoundingClientRect().height };
    }, href);

    expect(target, `the skip link points at ${href}, which is not in the document`).not.toBeNull();
    expect(target!.contains, 'the skip link lands somewhere the chapters are not').toBe(true);
    expect(target!.height).toBeGreaterThan(0);
  });

  test('the chapters are in reading order, and every in-page anchor resolves @smoke', async ({
    page,
  }) => {
    await open(page);

    const order = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-stage]')].map((el) => el.dataset.stage!),
    );
    expect(order, 'the chapters are not in the narrative order').toEqual(STAGE_IDS);

    // And their document positions agree with their DOM order — a chapter
    // ordered correctly in the markup and positioned above its predecessor
    // would read as a jump.
    const tops = await page.evaluate(() =>
      [...document.querySelectorAll('[data-stage]')].map((el) =>
        Math.round(el.getBoundingClientRect().top + scrollY),
      ),
    );
    for (let i = 1; i < tops.length; i++) {
      expect(tops[i], `chapter ${order[i]} is positioned above ${order[i - 1]}`).toBeGreaterThan(
        tops[i - 1],
      );
    }

    const dangling = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="#"]')]
        .map((a) => (a as HTMLAnchorElement).getAttribute('href')!)
        .filter((h) => h.length > 1 && !document.querySelector(h)),
    );
    expect(dangling, 'anchors pointing at nothing').toEqual([]);
  });

  test('the first meaningful line of every chapter is near its own top', async ({ page }) => {
    await open(page);
    await revealed(page);

    const leads = await page.evaluate(() => {
      const out: { stage: string; svh: number; px: number; padPx: number; viewport: number }[] = [];
      for (const section of document.querySelectorAll<HTMLElement>('[data-stage]')) {
        const first = section.querySelector('.mv-eyebrow, .mv-title');
        if (!first) continue;
        const gap = first.getBoundingClientRect().top - section.getBoundingClientRect().top;
        out.push({
          stage: section.dataset.stage!,
          svh: (gap / innerHeight) * 100,
          px: gap,
          // The section's own declared top padding. Everything above the first
          // line is supposed to be exactly this and nothing else.
          padPx: parseFloat(getComputedStyle(section).paddingBlockStart) || 0,
          viewport: innerHeight,
        });
      }
      return out;
    });

    expect(leads.length).toBe(STAGE_IDS.length);
    for (const lead of leads) {
      // 1. The invariant that holds for all eleven, and the one that actually
      //    catches a stray spacer: the space above a chapter's first line is
      //    its own declared padding, and nothing else has been inserted into
      //    it. This is stricter than any svh budget and it does not need one.
      expect(
        lead.px - lead.padPx,
        `${lead.stage} has ${(lead.px - lead.padPx).toFixed(1)}px above its first line beyond its own padding`,
      ).toBeLessThanOrEqual(2);

      if (lead.stage === 'calibration') {
        // 2. The opening chapter's padding is header clearance, not a gap —
        //    `mobile.css` declares it as `clamp(72px, 24vw, 104px) +
        //    --mv-gap-small` with the note that 104px is what clears the
        //    opening header with the navigation wrapped to two lines in German.
        //    It is width-driven, deliberately, and on this route there is no
        //    header under it: `experiments/full.html` is a bare mount host.
        //
        //    So an svh budget is the wrong denominator for it. Measured on this
        //    build it is 134.4 / 138.8 / 144.3 / 159.1 px at the four portrait
        //    widths — a flat 17.1 svh — and 168.0 px at 844 wide, where both
        //    clamps sit on their ceiling. That is 43.1 svh of a 390 px-tall
        //    landscape viewport, which failed a 34 svh budget while being the
        //    exact value the design asks for at its maximum, under a header
        //    that this route omits and production draws.
        //
        //    The requirement underneath the number is "first meaningful content
        //    appears" — §6's words. Asked as that: the opening line is on the
        //    first screen, without scrolling, at every viewport in the matrix.
        expect(
          lead.px,
          `the opening line is ${lead.px.toFixed(0)}px down a ${lead.viewport}px screen — below the fold`,
        ).toBeLessThan(lead.viewport);
      } else {
        // 3. Every other chapter opens within about an eighth of a screen of
        //    its own boundary. Unchanged.
        expect(lead.svh, `${lead.stage} opens ${lead.svh.toFixed(1)} svh in`).toBeLessThanOrEqual(16);
      }
    }
  });

  test('no chapter contains a tall run of nothing', async ({ page }) => {
    await open(page);
    await revealed(page);

    // A chapter may be tall because it holds a lot. What it may not have is a
    // synthetic blank band — which is exactly what the old composition's
    // scroll-budget spacers were, and the thing a reader experiences as the
    // page having stopped.
    //
    // "Band" means between the content, or after it. It does not mean the
    // section's own leading padding: this walk used to start `reach` at the
    // section's top, so a chapter's top padding counted as a run of nothing and
    // the opening chapter reported its header clearance — 168 px, 43.1 svh of a
    // 390 px landscape viewport — as a spacer. That padding is declared,
    // width-driven and sits under the production header; the test above now
    // holds it directly, against the section's own computed padding, which is a
    // stricter statement than this one could make.
    //
    // So the walk starts at the first box. An interior gap and a trailing gap
    // are both still caught, and those are the two shapes a scroll-budget
    // spacer actually takes.
    const gaps = await page.evaluate(() => {
      // Only boxes that DRAW something count as content.
      //
      // Verified by mutation rather than assumed: with every element's box
      // counted, a 300 px empty `<div>` inserted between two content blocks —
      // the exact shape of the old scroll-budget spacer — was **not** caught,
      // at either viewport, because an empty div has a box and a box fills its
      // own gap. The test could only ever see space made by margins and
      // padding, which is not how the defect it is named after was built.
      //
      // A replaced element, or an element with a direct non-whitespace text
      // node. Wrappers whose children carry the text are excluded and cost
      // nothing, because their children are measured; an empty div is excluded
      // and its height becomes the gap it actually is.
      const REPLACED = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'PICTURE', 'HR']);
      const draws = (el: Element) => {
        if (REPLACED.has(el.tagName)) return true;
        for (const node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return true;
        }
        return false;
      };

      const out: { stage: string; gapSvh: number; where: string }[] = [];
      for (const section of document.querySelectorAll<HTMLElement>('[data-stage]')) {
        const boxes = [...section.querySelectorAll<HTMLElement>('*')]
          .filter(draws)
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.height > 0 && r.width > 0)
          .sort((a, b) => a.top - b.top);
        if (boxes.length === 0) continue;
        let reach = boxes[0].top;
        let largest = 0;
        let where = 'interior';
        for (const box of boxes) {
          if (box.top > reach && box.top - reach > largest) largest = box.top - reach;
          reach = Math.max(reach, box.bottom);
        }
        const trailing = section.getBoundingClientRect().bottom - reach;
        if (trailing > largest) {
          largest = trailing;
          where = 'trailing';
        }
        const gapSvh = (largest / innerHeight) * 100;
        if (gapSvh > 34) out.push({ stage: section.dataset.stage!, gapSvh, where });
      }
      return out;
    });

    expect(gaps).toEqual([]);
  });

  test('the closing action is reachable, tappable and last @smoke', async ({ page }) => {
    // The old suite's `the CTA arrives over the scene, with no gap and no
    // footer collision`. There is no scene to arrive over and no sticky
    // container to release, so what is left of the requirement is the part that
    // was ever about the visitor: the closing action is at the end, it is on
    // screen when you get there, and it is big enough to hit.
    await open(page);
    await revealed(page);

    await page.locator('#stage-destination').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);

    const cta = page.getByTestId('cta-primary');
    await expect(cta).toBeVisible();
    const box = (await cta.boundingBox())!;
    expect(box.height, 'tap target below 44px').toBeGreaterThanOrEqual(44);

    // Last, with no blank screen after it. Not zero: the flow carries a real
    // bottom padding so the closing paragraph does not read under the fixed
    // telemetry strip, and that is the strip's height rather than a spacer.
    // What is forbidden is a synthetic band, which is a fraction of a screen.
    const trailing = await page.evaluate(() => {
      const last = document.querySelector('[data-stage="destination"]')!.getBoundingClientRect();
      const flow = document.querySelector('.mv-flow')!.getBoundingClientRect();
      return (flow.bottom - last.bottom) / innerHeight;
    });
    expect(trailing, 'a blank band follows the closing chapter').toBeLessThan(0.6);
  });

  test('the calls to action are real anchors with real destinations @smoke', async ({ page }) => {
    await open(page);

    await expect(page.getByTestId('cta-primary')).toHaveAttribute('href', '/arajanlat.html');
    await expect(page.getByTestId('cta-primary-hero')).toHaveAttribute('href', '/arajanlat.html');
    await expect(page.getByTestId('cta-secondary')).toHaveAttribute('href', '#stage-selected-work');
    await expect(page.getByTestId('cta-contact')).toHaveAttribute('href', '/ugyfelszolgalat.html');
    await expect(page.getByTestId('cta-qualify')).toHaveAttribute('href', '/arajanlat.html');
  });

  test('the chapters are announced in reading order, and unwound in reverse', async ({ page }) => {
    // The old suite recorded `data-meridian` off the HUD — six structural
    // states of an instrument that is not on this page. The requirement behind
    // it survives: assistive technology is told which chapter the visitor is
    // in, once per chapter, in order.
    //
    // Recorded by the page rather than polled from Node, for the same reason as
    // before: a poll's sampling rate, not the page, would decide whether a
    // short chapter was seen at all.
    await page.addInitScript(() => {
      const w = window as unknown as { __chapters: string[] };
      w.__chapters = [];
      const attach = () => {
        const el = document.querySelector('[data-testid="mobile-stage"]');
        if (!el) return void requestAnimationFrame(attach);
        const record = () => {
          const value = (el.textContent ?? '').trim();
          if (value && w.__chapters[w.__chapters.length - 1] !== value) w.__chapters.push(value);
        };
        record();
        new MutationObserver(record).observe(el, { childList: true, characterData: true, subtree: true });
      };
      attach();
    });

    await open(page);
    await revealed(page);

    const labels = STAGES.map((s) => s.label);
    const sweep = async (to: 'bottom' | 'top') => {
      await page.evaluate((seed) => {
        (window as unknown as { __chapters: string[] }).__chapters = [seed];
      }, to === 'bottom' ? labels[0] : labels[labels.length - 1]);

      // Stepped in pixels, by less than half a viewport, and not by a fraction
      // of the document. There is no damping here, so the readout is exact at
      // every stop and the only thing that could miss a chapter is a step
      // taller than the chapter — a risk a fractional step hides, because it is
      // a different distance on every viewport in the matrix.
      const travel = await page.evaluate(
        () => document.documentElement.scrollHeight - innerHeight,
      );
      const step = await page.evaluate(() => Math.round(innerHeight * 0.45));
      for (let walked = 0; walked <= travel + step; walked += step) {
        const at = to === 'bottom' ? Math.min(walked, travel) : Math.max(travel - walked, 0);
        await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), at);
        await page.waitForTimeout(90);
      }
      await page.waitForTimeout(300);
      return page.evaluate(() => (window as unknown as { __chapters: string[] }).__chapters);
    };

    expect(await sweep('bottom'), 'the chapters were not announced in order on the way down').toEqual(
      labels,
    );
    expect(await sweep('top'), 'the chapters did not unwind in reverse').toEqual([...labels].reverse());
  });
});

// =============================================================================
// The ascent readout.
//
// The old suite asserted this through `altitude-value` in the desktop HUD,
// driven by a damped scroll clock that a phone no longer has. What the visitor
// is promised has not changed: the journey starts on the ground, climbs as the
// document does, arrives at 30 000 m at the bottom, and comes back. Here it is
// the telemetry strip, `scrollY` and no damping — so the readings are exact and
// can be asserted as such rather than to a tolerance.
// =============================================================================
test.describe('portrait — the ascent', () => {
  test('starts on the ground, never runs backwards, and arrives at the ceiling', async ({
    page,
  }) => {
    await open(page);

    const read = () =>
      page
        .getByTestId('mobile-altitude')
        .innerText()
        .then((t) => Number(t.replace(/\D/g, '')));

    await scrollToFraction(page, 0);
    expect(await read(), 'the ascent does not start on the ground').toBeLessThan(300);

    // Every step of the way up, in order. A start/end pair would pass even if
    // the middle of the curve ran backwards or sat still for four screens —
    // which is the defect this shape of test was written for and the reason it
    // is kept.
    let previous = 0;
    for (const f of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
      await scrollToFraction(page, f);
      const metres = await read();
      expect(metres, `the altitude went backwards at ${f}`).toBeGreaterThanOrEqual(previous);
      expect(metres, `the altitude exceeded the ceiling at ${f}`).toBeLessThanOrEqual(30_000);
      previous = metres;
    }

    await scrollToFraction(page, 1);
    expect(await read(), 'the journey does not arrive').toBe(30_000);

    // And the baseline is reachable again. The specific bug behind this: the
    // first chapter's anchor has to be at scroll zero, or a visitor who scrolls
    // down and comes back settles part-way up the first chapter and the ground
    // state becomes unreachable after any scrolling at all.
    await scrollToFraction(page, 0);
    expect(await page.evaluate(() => Math.round(scrollY))).toBe(0);
    expect(await read(), 'the ground state is unreachable after scrolling').toBe(0);
  });

  test('the readout is not owned by the renderer', async ({ page }) => {
    // The old suite asked this twice — once with the tab hidden and the
    // frameloop parked, once with the context destroyed. Both were about the
    // desktop HUD owning its own clock. The portrait architecture answers it
    // structurally: `mobile/ascent.ts` imports nothing from the scene and the
    // instrument is one of its subscribers. This is the test that says the
    // structure holds in the built page.
    await open(page);
    await page.waitForSelector('.mv-alt__stage[data-ready]', { timeout: 45_000 });

    await page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement | null;
      const gl = c?.getContext('webgl2') || c?.getContext('webgl');
      (gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
    });
    await page.waitForTimeout(600);

    // Losing the context costs the visitor the instrument and nothing else: the
    // slot lands on the drawing rather than going blank.
    await expect(page.getByTestId('mobile-altimeter')).toHaveAttribute('data-mode', 'fallback');
    await expect(page.getByTestId('mobile-altimeter-svg')).toBeVisible();

    // And the ascent still arrives.
    await scrollToFraction(page, 1);
    const metres = await page
      .getByTestId('mobile-altitude')
      .innerText()
      .then((t) => Number(t.replace(/\D/g, '')));
    expect(metres, 'the readout died with the renderer').toBe(30_000);

    // The document is intact — the boundary wraps the canvas, not the page.
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByTestId('stage-destination')).toBeVisible();
  });
});

// =============================================================================
// Typography motion — §6. The reveals are the portrait page's whole character,
// and the failure mode they have is text that never arrives.
// =============================================================================
test.describe('portrait — the text arrives', () => {
  test('every reveal completes, and nothing is left hidden @smoke', async ({ page }) => {
    await open(page);
    await revealed(page);

    const stranded = await page.evaluate(() => {
      const roles = [...document.querySelectorAll('.mv-text, .mv-lines, .mv-copy, .mv-label, .mv-rule')];
      return {
        total: roles.length,
        unresolved: roles.filter((el) => !el.classList.contains('is-in')).length,
        invisible: roles.filter((el) => {
          const cs = getComputedStyle(el);
          return Number(cs.opacity) < 0.9 || cs.visibility === 'hidden';
        }).length,
      };
    });

    expect(stranded.total).toBeGreaterThan(20);
    expect(stranded.unresolved, 'text never finished revealing').toBe(0);
    expect(stranded.invisible, 'text is still transparent after its reveal').toBe(0);
  });

  test('scrolling back up does not un-reveal anything', async ({ page }) => {
    await open(page);
    await revealed(page);

    // The observer unobserves on intersect and the reveal is a one-way CSS
    // transition, so reverse scrolling has nothing to undo. This is the test
    // that says so, and it is the one that would catch a future "replay on
    // re-entry" change taking content away from a reader who scrolled back.
    for (const f of [1, 0.6, 0.2, 0.8, 0]) {
      await scrollToFraction(page, f);
    }
    await page.waitForTimeout(400);

    const unresolved = await page.evaluate(
      () =>
        [...document.querySelectorAll('.mv-text, .mv-lines, .mv-copy, .mv-label, .mv-rule')].filter(
          (el) => !el.classList.contains('is-in'),
        ).length,
    );
    expect(unresolved, 'reverse scrolling took text back off the page').toBe(0);
  });

  test('reduced motion shows everything immediately and moves nothing @smoke', async ({ page }) => {
    const verify = await enableReducedMotion(page);
    await page.goto('./');
    await verify();
    expect(await mounted(page), 'reduced motion changed which composition mounted').toBe(true);
    await ready(page);

    // No scroll walk. Under reduced motion the reveals resolve at registration,
    // so anything still hidden here is hidden for good.
    const state = await page.evaluate(() => {
      const roles = [...document.querySelectorAll('.mv-text, .mv-copy, .mv-label, .mv-lines, .mv-rule')];
      return {
        roles: roles.length,
        hidden: roles.filter((el) => !el.classList.contains('is-in')).length,
        invisible: roles.filter((el) => Number(getComputedStyle(el).opacity) < 0.99).length,
        moved: roles.filter((el) => {
          const t = getComputedStyle(el).transform;
          return t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)';
        }).length,
        rules: document.querySelectorAll('.mv-rule').length,
      };
    });

    expect(state.roles).toBeGreaterThan(20);
    expect(state.hidden, 'reduced motion left text unrevealed').toBe(0);
    expect(state.invisible, 'reduced motion left text transparent').toBe(0);
    // `.mv-rule` resolves to `scaleY(1)`, which is a transform. Nothing else
    // may have one.
    expect(state.moved).toBeLessThanOrEqual(state.rules);

    await expect(page.getByTestId('mobile-altimeter')).toBeVisible();
    await expect(page.getByTestId('cta-primary-hero')).toBeVisible();
  });
});

// =============================================================================
// The Altimeter — §6, and the section of the brief that insists the current
// implementation is detected before anything is asserted about it.
//
// What CURRENT HEAD does: `MobileAltimeter` probes WebGL after mount, and on a
// yes it lazily imports `MobileInstrument` — one GLB, one camera, four lights,
// a baked probe — and on a no it renders the `MeridianDrawing` SVG. The SVG is
// the failure path, not the normal experience. Neither path may load the
// desktop scene, the terrain, DRACO or an HDR environment.
// =============================================================================
test.describe('portrait — the instrument', () => {
  test('the real Altimeter loads, and nothing from the desktop scene does', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));

    await open(page);
    await page.waitForSelector('.mv-alt__stage[data-ready]', { timeout: 45_000 });

    // The instrument is the GLB, and it is the same file the desktop journey
    // uses — §2 of the 3D brief is that a visitor sees the same designed object
    // on both surfaces.
    expect(
      requested.filter((u) => /stratos-altimeter\.glb/.test(u)).length,
      'the Altimeter model was never requested',
    ).toBeGreaterThan(0);
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.getByTestId('mobile-altimeter')).toHaveAttribute('data-mode', 'live');

    // And the removed architecture stays removed. Each of these is a request
    // that the old portrait composition made and this one must not.
    expect(requested.filter((u) => /mountains/i.test(u)), 'the terrain came back').toEqual([]);
    expect(requested.filter((u) => /draco/i.test(u)), 'the DRACO decoder came back').toEqual([]);
    expect(
      requested.filter((u) => /JourneyScene|ScrollTrigger/.test(u)),
      'the desktop scene or its scroll driver came back',
    ).toEqual([]);
    expect(requested.filter((u) => /\.(hdr|exr|env)($|\?)/i.test(u)), 'an HDR environment was fetched').toEqual([]);

    // The fallback drawing is not shown while the real instrument is rendering.
    // §17: no visible fallback-to-real flash, which means the two are never on
    // screen together and the drawing is not the thing that gets replaced.
    expect(await page.getByTestId('mobile-altimeter-svg').count()).toBe(0);
  });

  test('the instrument cannot change the layout it sits in', async ({ page }) => {
    await open(page);

    // Measured before the renderer exists and again after it has settled. The
    // slot's box comes from CSS and a fixed aspect ratio; if the arrival of a
    // live instrument moves anything, the exclusion-band feedback loop the
    // rebuild removed has come back in another form.
    const boxOf = () =>
      page.evaluate(() => {
        const stage = document.querySelector('.mv-alt__stage');
        const next = document.querySelector('[data-stage="initial-ascent"]');
        const r = stage?.getBoundingClientRect();
        const n = next?.getBoundingClientRect();
        return {
          stage: r ? [Math.round(r.width), Math.round(r.height)] : null,
          nextSectionTop: n ? Math.round(n.top + scrollY) : null,
          docHeight: document.documentElement.scrollHeight,
        };
      });

    const before = await boxOf();
    await page.waitForSelector('.mv-alt__stage[data-ready]', { timeout: 45_000 });
    await page.waitForTimeout(800);
    const after = await boxOf();

    expect(after.stage, 'the instrument resized its own slot').toEqual(before.stage);
    expect(after.nextSectionTop, 'the instrument moved the chapter below it').toBe(before.nextSectionTop);
    expect(after.docHeight, 'the instrument changed the document height').toBe(before.docHeight);
  });

  test('no WebGL falls back to the drawing, and downloads no renderer @smoke', async ({ page }) => {
    await denyWebGL(page);

    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));

    await open(page);

    await expect(page.getByTestId('mobile-altimeter')).toHaveAttribute('data-mode', 'fallback');
    await expect(page.getByTestId('mobile-altimeter-svg')).toBeVisible();

    // Refusing the renderer must also refuse its download — that is the whole
    // point of the lazy boundary, and it is asserted on the request log because
    // a chunk that is fetched and unused costs the same as one that is used.
    await page.waitForTimeout(1500);
    expect(requested.filter((u) => /\.glb($|\?)/.test(u)), 'a model was fetched with no WebGL').toEqual([]);
    expect(
      requested.filter((u) => /MobileInstrument|JourneyScene/.test(u)),
      'a renderer chunk was fetched with no WebGL',
    ).toEqual([]);

    // And the drawing is a working instrument, not a placeholder: it tracks the
    // ascent.
    const readAt = async (f: number) => {
      await scrollToFraction(page, f);
      return page.evaluate(
        () =>
          document.querySelector('.dial__needle--primary')?.getAttribute('transform') ??
          document.querySelector('[data-testid="mobile-altimeter-svg"]')?.getAttribute('data-state') ??
          '',
      );
    };
    const low = await readAt(0.05);
    const high = await readAt(0.7);
    expect(high, 'the fallback dial does not follow the ascent').not.toBe(low);
  });
});

// =============================================================================
// Layout stability at the matrix widths — §6's last block.
// =============================================================================
test.describe('portrait — the layout holds', () => {
  test('the page never scrolls sideways, at any chapter @smoke', async ({ page }) => {
    await open(page);
    await revealed(page);

    for (const f of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      await scrollToFraction(page, f);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at ${f}`).toBeLessThanOrEqual(1);
    }
  });

  test('every action is hit-testable where it comes to rest', async ({ page }) => {
    // The overlap question, asked the only way that means anything to a
    // visitor: is the thing you are trying to press the thing the browser would
    // give the tap to?
    //
    // Not an intersection test against the telemetry strip. The strip is a
    // gradient wash with `pointer-events: none`, deliberately, so that copy
    // passes *behind* it rather than being cut off by an edge — a rectangle
    // test would report every paragraph on the last third of every screen as
    // covered, on a page whose composition is that on purpose. Hit-testing
    // reports what actually happens.
    await open(page);
    await revealed(page);

    // The three that are buttons carry the 44px floor. `cta-contact` and
    // `cta-qualify` are links inside a sentence — WCAG 2.5.8's inline
    // exception is exactly this case, and asserting a 44px box on a word in a
    // paragraph would be asking for a different design, not for an accessible
    // one. They still have to be hit-testable.
    const BUTTONS = new Set(['cta-primary-hero', 'cta-secondary', 'cta-primary']);

    for (const id of ['cta-primary-hero', 'cta-secondary', 'cta-primary', 'cta-contact', 'cta-qualify']) {
      await page.getByTestId(id).scrollIntoViewIfNeeded();
      await page.waitForTimeout(140);
      const hit = await page.evaluate((testid) => {
        const el = document.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
        if (!el) return { found: false } as const;
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          found: true,
          height: r.height,
          own: !!top && (top === el || el.contains(top) || top.contains(el)),
          blockedBy: top ? `${top.tagName.toLowerCase()}.${String(top.className).slice(0, 40)}` : 'nothing',
        } as const;
      }, id);

      expect(hit.found, `${id} is missing`).toBe(true);
      expect(hit.own, `${id} is covered by ${hit.found ? hit.blockedBy : ''}`).toBe(true);
      if (BUTTONS.has(id)) {
        expect(hit.found ? hit.height : 0, `${id} tap target below 44px`).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test('a viewport-height change moves no chapter', async ({ page }) => {
    // Safari's toolbars collapse and expand by ~90px on the first flick of
    // every session. The composition is measured against `svh`, which does not
    // move — so every chapter's *document* position must be identical
    // afterwards. A layout composed against `vh` or against `innerHeight` would
    // shift the whole page under a reader mid-gesture.
    await open(page);
    await revealed(page);

    const size = page.viewportSize()!;
    await scrollToFraction(page, 0.35);
    const before = await page.evaluate(() =>
      [...document.querySelectorAll('[data-stage]')].map((el) =>
        Math.round(el.getBoundingClientRect().top + scrollY),
      ),
    );

    await page.setViewportSize({ width: size.width, height: size.height + 92 });
    await page.waitForTimeout(500);
    const after = await page.evaluate(() =>
      [...document.querySelectorAll('[data-stage]')].map((el) =>
        Math.round(el.getBoundingClientRect().top + scrollY),
      ),
    );

    expect(after, 'a browser-chrome height change moved the composition').toEqual(before);
    await page.setViewportSize(size);
  });

  test('a rotation keeps the portrait composition and one context', async ({ page }) => {
    await open(page);
    await page.waitForSelector('.mv-alt__stage[data-ready]', { timeout: 45_000 });

    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.height, height: size.width });
    await page.waitForTimeout(700);

    // The fork is taken once, from `screen`'s short edge, so a rotation cannot
    // change the verdict — and must not, because retaking it would tear down a
    // live tree and rebuild the other underneath a moving finger.
    expect(await mounted(page), 'a rotation swapped the composition').toBe(true);
    await expect(page.getByTestId('mobile-altimeter')).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(1);

    await page.setViewportSize(size);
  });
});
