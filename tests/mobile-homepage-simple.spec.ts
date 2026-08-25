import { test, expect, type Page } from '@playwright/test';
import { enableReducedMotion } from './helpers/reduced-motion';
import { bootJourneyOnLoad } from './helpers/homepage';

// The homepage waits for a first move before it mounts the journey — see
// `bootJourneyOnLoad`. Every navigation in this file gets one, on every
// document it loads, so what these tests assert about is a page a visitor is
// reading rather than one they have only landed on.
test.beforeEach(async ({ page }) => {
  await bootJourneyOnLoad(page);
});


/**
 * The simplified portrait homepage — architecture, not pixels.
 *
 * §28 of the mobile reset brief asks for tests that validate the architecture
 * rather than overfitting individual measurements, and the distinction is the
 * whole design of this file. Every assertion below is about a *property the
 * architecture guarantees*:
 *
 *   * the terrain is not on this page — a request that is never made
 *   * the instrument is the Altimeter GLB and nothing else is loaded with it
 *   * the document scrolls itself — no transform, no programmatic scroll
 *   * a section's copy starts near its top — a distance in svh, with room
 *   * nothing paints an opaque plate across the instrument — a painting rule
 *   * the reveals finish — a class, not a frame
 *
 * None of them asserts a colour, a font size, or a screenshot. What the page
 * looks like belongs in the review package, which is what a human approves.
 *
 * ## What is deliberately absent
 *
 * No raised timeouts. Where a test waits, it waits for a condition it names —
 * the composition having mounted, or the scroll position having stopped
 * changing. A bare `waitForTimeout` tuned until a suite goes green is how a
 * lifecycle defect gets preserved as a passing test.
 *
 * No test here waits on desktop-only state from a portrait project, or the
 * reverse. That was the other half of §28, and it is enforced by
 * `mobileOnly` / `desktopOnly` skipping on what the page actually mounted
 * rather than on what the viewport implies.
 */

/** The mobile composition mounted. The only reliable signal of which fork ran. */
const mounted = (page: Page) =>
  page.locator('[data-testid="mobile-home"]').count().then((n) => n > 0);

/**
 * Wait for the mobile page to be ready to measure.
 *
 * `mv-on` is added by `MobileHome`'s mount effect, after `measureAscent` has
 * run once — so it is the exact event "the ascent has geometry", not a duration
 * that usually covers it.
 */
async function ready(page: Page) {
  await page.waitForFunction(() => document.documentElement.classList.contains('mv-on'), null, {
    timeout: 20_000,
  });
}

/**
 * Walk the document so every reveal fires, and do not move on until each one
 * has.
 *
 * ## What was wrong with the previous shape
 *
 * It scrolled the whole page in fixed 70 ms hops, returned to the top, and only
 * then waited for every element to carry `.is-in`. Three separate faults, all of
 * which this arrangement removes rather than mitigates:
 *
 *   * **70 ms was a guess about someone else's scheduler.** `IntersectionObserver`
 *     samples; it does not track. Whether an element scrolled past between two
 *     hops is reported at all depends on when the observer next runs, which
 *     depends on how much of the machine this tab is getting.
 *   * **A miss was unrecoverable.** Back at the top, an element halfway down the
 *     document is not intersecting and never will be again, so anything the
 *     sweep skipped could only ever be waited out to the 20 s timeout. The
 *     failure therefore arrived detached from its cause, in a helper, with a
 *     stack that pointed at the wait rather than at the hop that lost the
 *     element.
 *   * **The bound was a stale measurement.** `scrollHeight` was read once, before
 *     any reveal had fired.
 *
 * It failed in 2 of 5 baseline full-suite runs, on both WebKit projects at once,
 * and passed in isolation, file-serial and file-parallel every time — the
 * signature of something that only loses the race when the machine is
 * oversubscribed.
 *
 * ## The shape that cannot lose
 *
 * Advance one screen, then wait for the observer to have caught up on
 * everything now *fully above the reveal line* before advancing again. A slow
 * observer makes a step take longer; it can no longer make an element
 * disappear. The page's own geometry is re-read every iteration, so the walk
 * ends when the document says it has ended rather than when a number captured
 * beforehand says so.
 *
 * `REVEAL_LINE` is `mobile/reveal.ts`'s `rootMargin: '0px 0px -12% 0px'`
 * expressed the way a test can check it. Only elements whose *bottom* has
 * cleared the line are required to have arrived — one straddling it is
 * genuinely ambiguous, and demanding it would be asserting a rounding mode.
 */
async function revealed(page: Page) {
  const REVEAL_LINE = 0.88; // 1 - 12%, from ROOT_MARGIN in mobile/reveal.ts

  const settledAbove = () =>
    page.waitForFunction(
      (line) => {
        const due = [...document.querySelectorAll('.mv-text, .mv-copy, .mv-lines')].filter(
          (el) => el.getBoundingClientRect().bottom <= innerHeight * line,
        );
        return due.every((el) => el.classList.contains('is-in'));
      },
      REVEAL_LINE,
      { timeout: 20_000 },
    );

  // Bounded only to turn "the document grew forever" into a legible failure
  // rather than a hang; the loop's real exit is reaching the bottom.
  for (let guard = 0; guard < 400; guard += 1) {
    await settledAbove();
    const atBottom = await page.evaluate(() => {
      const doc = document.documentElement;
      if (Math.ceil(scrollY + innerHeight) >= doc.scrollHeight - 1) return true;
      scrollTo({ top: scrollY + Math.round(innerHeight * 0.8), behavior: 'instant' });
      return false;
    });
    if (atBottom) break;
  }

  await settledAbove();
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));

  // The contract the callers actually depend on: the reveals finished. Reached
  // by construction now rather than hoped for.
  await page.waitForFunction(
    () => document.querySelectorAll('.mv-text:not(.is-in), .mv-copy:not(.is-in), .mv-lines:not(.is-in)').length === 0,
    null,
    { timeout: 20_000 },
  );
}

/**
 * The instrument has drawn its first *correct* frame.
 *
 * `data-ready` is set from inside the render loop, on the first frame at which
 * every channel is inside its motion threshold — not when the model finished
 * decoding. It is therefore the exact event "the instrument is on screen and
 * settled", which is what every assertion below actually needs.
 */
/**
 * The instrument has arrived where the current scroll position asks it to be.
 *
 * Two frames, then the flag. The overlay's reader is coalesced to one pass per
 * animation frame, so there is a one-frame window after a scroll in which
 * `data-settled` is still the flag left over from the PREVIOUS position — and
 * `waitForSelector` polls on the frame clock, so it can win that race.
 * Measured: it reported `ascent` with the hero's geometry and opacity 1.00,
 * which is a frame that genuinely existed and is not the one being asserted
 * about. The page's signal is not wrong; a test that asks immediately is asking
 * a frame too early.
 */
const settled = async (page: Page) => {
  await page.evaluate(() => new Promise((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done(null)));
  }));
  await page.waitForSelector('.mv-alt__stage[data-settled]', { timeout: 10_000 });
};

const instrumentReady = (page: Page) =>
  page.waitForSelector('.mv-alt__stage[data-ready]', { timeout: 30_000 });

/**
 * The ascent reader has run against the scroll position just set.
 *
 * `scrollTo` moves `scrollY` synchronously and nothing else. `ascent.ts` listens
 * for the scroll event and coalesces to **at most one reader pass per animation
 * frame** — deliberately, and it is the whole of the portrait performance
 * architecture (§26: no new scroll listeners, nothing that runs after the finger
 * lifts). So the readout is written on a FRAME, and until one has happened it
 * still holds the value for the previous position.
 *
 * This replaces a `waitForTimeout(200)` in the two tests below, and that sleep
 * is the exact cause of both of this file's failures in `final-closure-01`:
 *
 *   :591  expected 30 000 at the foot of the document, read `0`
 *   :638  expected the ascent held across the menu, read a 14 970 m drift
 *
 * Neither is a drift and neither is a zero. `0` and `14 970` are the readings at
 * the position the page was at **before** the scroll — measured: the top of the
 * document reads `0`, and `scrollY = 5200` settles at exactly 14 970 m. 200 ms
 * is four frames on a quiet host and none at all on a host running five WebGL
 * pages at once, which is what the gate does to itself.
 *
 * Two frames, not one, and the reason is ordering rather than caution. The
 * scroll event is dispatched in the "update the rendering" step, *before* that
 * frame's animation callbacks, so the reader's own frame request is always
 * queued no later than the first one taken here — and is therefore always
 * serviced before the second. One frame is enough in every ordering but one;
 * two is enough in all of them, and costs a frame.
 *
 * Not a duration: on a page getting 3 fps this waits 660 ms and on a page
 * getting 120 fps it waits 17 ms, and it is the same statement either way.
 */
const ascentRead = (page: Page) =>
  page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );

/**
 * The document has come to rest where it was sent, and the reader has read it.
 *
 * `scrollTo` is not the end of the scroll on this engine. Measured on
 * `mobile-390`, thirty fresh loads, after
 * `scrollTo({ top: 5200, behavior: 'instant' })`:
 *
 *   * `scrollY` moved again after the instruction in **19 of 30** runs
 *   * it settled 1–2 px LOW — 5 200 became 5 199 or 5 198
 *   * it was stable from frame **7–8**, never before frame 5
 *
 * The page is still arriving when the instruction returns: reveals fire, images
 * below the fold decode, and the document adjusts under a fixed scroll offset.
 *
 * That matters to Contract C and not only to the readout. `header.js` captures
 * the position at the moment the layer OPENS — by then settled — and puts that
 * back on close, to a pixel. A `before` sampled two frames after the scroll is
 * the *unsettled* position, so the comparison measures the settling and blames
 * the lock. Measured: waiting only for the reader's frame, the restore
 * assertion `|scrollY − before| <= 2` failed 44 times in 400, reporting 3, 4, 5
 * and 6 px — a lock that was restoring its captured position exactly.
 *
 * And the position does not stop moving when the scroll does. Measured on
 * `mobile-430`, twenty-five fresh loads, sampling what `header.js` actually
 * locks (`-body.top` at the moment the layer opens) against the position the
 * test had already called settled:
 *
 *   before = 5 200 in 25 of 25;  locked = 5 198 in 9, 5 199 in 3, 5 200 in 13
 *   the restore was EXACT in 25 of 25 — `scrollY` after close == what was locked
 *
 * The page drifts up by a pixel or two *after* the scroll has stopped, and the
 * lock then faithfully restores the drifted position. The cause is named in the
 * sibling suite already: the deck compacts over ~0.45 s after a scroll, that is
 * a layout change above the viewport, and the browser holds the rendered
 * content still by taking the difference out of `scrollY`. Under a loaded host
 * the drift reaches 3–6 px, which is where the 44 failures came from.
 *
 * So all three are waited for, in the order they happen: the deck stops
 * resizing and the position stops moving — one condition, because the first
 * causes the second — and then the reader runs against where it stopped.
 * `waitForFunction` polls on the frame clock, so the count below is frames.
 */
async function scrolledAndRead(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __settle: { at: string; n: number } }).__settle = { at: '', n: 0 };
  });
  await page.waitForFunction(
    () => {
      // The deck's height is measured alongside the position because it is the
      // thing that MOVES the position. Rounded to a tenth so the transition's
      // own sub-pixel steps do not keep the counter at zero forever.
      const deck = document.querySelector('.nav');
      const height = deck ? Math.round(deck.getBoundingClientRect().height * 10) / 10 : 0;
      const at = `${scrollY}|${height}`;
      const s = (window as unknown as { __settle: { at: string; n: number } }).__settle;
      if (s.at === at) s.n += 1;
      else {
        s.at = at;
        s.n = 0;
      }
      return s.n >= 5;
    },
    null,
    { timeout: 15_000 },
  );
  await ascentRead(page);
}

/** The metres the page is currently showing the visitor. */
const altitude = (page: Page) =>
  page
    .locator('[data-testid="mobile-altitude"]')
    .innerText()
    .then((t) => Number(t.replace(/\D/g, '')));

/**
 * Is the navigation's scroll lock fully engaged?
 *
 * Both halves, because either one alone is a state the page should never be in.
 * `header.js` puts `.menu-open` on the root — which is what `ascent.ts` reads to
 * stand its reader down — and separately holds the body at `position: fixed`
 * with a negative `top`, which is the only lock iOS Safari actually honours.
 * A class without the fixed body is a page that scrolls behind an open menu; a
 * fixed body without the class is a page whose ascent reader is running against
 * a document the lock has collapsed to one viewport.
 */
const locked = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.classList.contains('menu-open') &&
      getComputedStyle(document.body).position === 'fixed',
  );

test.describe('portrait mobile — the composition that runs', () => {
  test('a phone gets the simple composition and exactly one canvas', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition — see the desktop suite below');
    await ready(page);

    // One. The instrument's scene, and no second surface of any kind — §3 asks
    // for a dedicated lightweight renderer rather than a share of the desktop
    // scene graph, and two canvases would mean two WebGL contexts on a phone.
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.locator('[data-testid="mobile-instrument-canvas"]')).toBeAttached();

    // The desktop track is the thing this replaced. Its absence is the
    // clearest single statement that the two compositions are separate.
    expect(await page.locator('[data-testid="journey-track"]').count()).toBe(0);
    await expect(page.locator('[data-testid="mobile-altimeter"]')).toBeVisible();
    await expect(page.locator('[data-testid="mobile-telemetry"]')).toBeVisible();

    // The SVG is a failure path now, not the portrait experience — §18.
    expect(await page.locator('[data-testid="mobile-altimeter-svg"]').count()).toBe(0);
  });

  test('the Altimeter GLB is loaded and nothing else from the old scene is', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));

    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);
    await instrumentReady(page);
    // Scroll the whole document: a lazily-mounted scene would be requested on
    // arrival, not on load, and a check that only looks at the first screen
    // would miss exactly that.
    await revealed(page);

    // §25's checklist, as one assertion each.
    const models = requested.filter((u) => u.includes('.glb'));
    expect(models).toHaveLength(1);
    expect(models[0]).toContain('stratos-altimeter.glb');

    expect(requested.filter((u) => /mountains/i.test(u))).toEqual([]);
    expect(requested.filter((u) => /JourneyScene|ScrollTrigger|draco/i.test(u))).toEqual([]);
    // No HDR, no .env, no cube faces: §9's environment is prefiltered in the
    // page from three flat emitters and costs nothing on the wire.
    expect(requested.filter((u) => /\.(hdr|exr|env)($|\?)/i.test(u))).toEqual([]);
  });

  test('the renderer is not requested at all when there is no WebGL', async ({ page }) => {
    // Denied the way a blocklisted driver denies it: the constructor is still
    // there, context creation just fails.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
        if (typeof type === 'string' && type.includes('webgl')) return null;
        // @ts-expect-error — passing through to the original signature
        return original.call(this, type, ...rest);
      };
    });

    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));

    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);
    await revealed(page);

    // §19: the drawing, gracefully, and the page still reads.
    await expect(page.locator('[data-testid="mobile-altimeter-svg"]')).toBeVisible();
    await expect(page.locator('[data-testid="mobile-altimeter"]')).toHaveAttribute(
      'data-mode',
      'fallback',
    );

    /**
     * And it is actually PAINTED.
     *
     * `toBeVisible` above is not enough and this is not a belt-and-braces
     * assertion — it is the one that catches the defect that happened.
     * Playwright's visibility check is `display`, `visibility` and a non-empty
     * box; it does not consider opacity. The canvas crossfade was written as
     * `.mv-alt__stage > div`, which also matched this wrapper and pinned it at
     * zero opacity on a path where nothing ever sets `data-ready` — so the
     * no-WebGL visitor got an empty slot containing a correctly laid-out,
     * completely invisible 315px instrument, and this test passed.
     */
    // The composition has arrived. `data-settled` is the placement settle's own
    // "I am where I am supposed to be" — the counterpart to `data-ready`, and
    // the one that exists on this path, where nothing ever renders a frame.
    // `revealed` above walks the whole document and jumps back to the top, so
    // without this the measurement lands inside the return transition and reads
    // an opacity that was true for one frame on its way to 1.
    await page.waitForSelector('.mv-alt__stage[data-settled]', { timeout: 10_000 });

    const painted = await page.evaluate(() => {
      const svg = document.querySelector('.mv-alt__dial');
      if (!svg) return null;
      const box = svg.getBoundingClientRect();
      // Effective opacity: every ancestor multiplies in.
      let opacity = 1;
      for (let el: Element | null = svg; el; el = el.parentElement) {
        opacity *= Number(getComputedStyle(el).opacity);
      }
      return { width: Math.round(box.width), height: Math.round(box.height), opacity };
    });

    expect(painted).not.toBeNull();
    expect(painted!.width).toBeGreaterThan(120);
    expect(painted!.height).toBeGreaterThan(120);
    expect(painted!.opacity).toBeGreaterThan(0.9);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('[data-testid="cta-primary-hero"]')).toBeVisible();

    // The whole point of the lazy boundary: declining the renderer must also
    // decline its download. This is the assertion that stops a stray top-level
    // import quietly costing every no-WebGL visitor a megabyte.
    //
    // `MobileInstrument` is the chunk name Rollup derives from the module's own
    // filename, and that module is the only import path to `three`, `@react-
    // three/*` and the GLB on this page — so its absence is the absence of all
    // of them. Asserted on the name rather than on a byte total, because a byte
    // total is a number that has to be maintained and this is a fact.
    expect(requested.filter((u) => /\.glb($|\?)/.test(u))).toEqual([]);
    expect(requested.filter((u) => /MobileInstrument|JourneyScene/.test(u))).toEqual([]);
  });

  test('the document scrolls itself', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);

    const native = await page.evaluate(() => {
      const html = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      return {
        // Nothing may move the whole page with a transform — §3.
        htmlTransform: html.transform,
        bodyTransform: body.transform,
        htmlPosition: html.position,
        bodyPosition: body.position,
        // No snapping, and no nested scroller standing in for the document.
        snap: html.scrollSnapType + '|' + body.scrollSnapType,
        // The document is the scrolling element. A page that had handed
        // scrolling to a container would report a different one.
        scroller: document.scrollingElement === document.documentElement,
        overflowY: body.overflowY,
      };
    });

    expect(native.htmlTransform === 'none' || native.htmlTransform === '').toBeTruthy();
    expect(native.bodyTransform === 'none' || native.bodyTransform === '').toBeTruthy();
    expect(native.bodyPosition).not.toBe('fixed');
    expect(native.snap).not.toContain('mandatory');
    expect(native.snap).not.toContain('proximity');
    expect(native.scroller).toBe(true);
    expect(['visible', 'clip', 'auto']).toContain(native.overflowY);
  });

  test('nothing moves the scroll position on the page\'s behalf', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);

    // Every scroll API the page could reach for, wrapped.
    //
    // The harness has to scroll too, so the wrapper ignores calls made while
    // `__harness` is set. Without that this test would be watching itself: the
    // only way to observe the page not scrolling is to scroll it, and
    // `page.mouse.wheel` — the one input that would sidestep the question — is
    // unsupported in mobile WebKit, which is the engine this most needs to hold
    // on.
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
        scrollTo({ top: y, behavior: 'instant' });
        w.__harness = false;
      }, to);

    await move(1400);
    await page.waitForTimeout(500);
    await move(700);
    await page.waitForTimeout(700);

    expect(
      await page.evaluate(() => (window as unknown as { __programmatic: string[] }).__programmatic),
    ).toEqual([]);

    // And the direct form of the same question, which needs no wrapper: left
    // alone, the position must not change. §4 records a 4px oscillation on the
    // old architecture that reversed every ~250 ms indefinitely with nobody
    // touching the page, arriving through a measurement feedback loop rather
    // than through any scroll handler — which is why a source audit found no
    // hijacking and the page still scrolled itself.
    const resting = await page.evaluate(() => scrollY);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => scrollY)).toBe(resting);
  });

  test('the page stops when the scroll stops', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);
    await revealed(page);

    await page.evaluate(() => scrollTo({ top: 3200, behavior: 'instant' }));
    // Long enough that a 300–400 ms drift would have started, short enough that
    // one would not yet have finished.
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

    // Not "small". Zero. Nothing on this page is interpolated towards a scroll
    // target, so there is nothing that could still be arriving.
    expect(drift).toBe(0);
  });
});

test.describe('portrait mobile — the composition itself', () => {
  test('every section starts near its own top', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);
    await revealed(page);

    const leads = await page.evaluate(() => {
      const out: { stage: string; svh: number }[] = [];
      for (const section of document.querySelectorAll<HTMLElement>('[data-stage]')) {
        const first = section.querySelector('.mv-eyebrow, .mv-title');
        if (!first) continue;
        const gap = first.getBoundingClientRect().top - section.getBoundingClientRect().top;
        out.push({ stage: section.dataset.stage!, svh: (gap / innerHeight) * 100 });
      }
      return out;
    });

    expect(leads.length).toBeGreaterThan(8);
    for (const lead of leads) {
      // §19: the first meaningful content appears within ~8–14 svh of a chapter
      // boundary. The opening section is allowed more, because it clears the
      // shared header rather than a section gap.
      const budget = lead.stage === 'calibration' ? 26 : 14;
      expect(lead.svh, `${lead.stage} opens ${lead.svh.toFixed(1)} svh in`).toBeLessThanOrEqual(budget);
    }
  });

  test('no section is a tall empty spacer', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);

    // A section may be tall because it holds a lot — the case-study section is
    // four projects deep and legitimately runs four screens. What a section may
    // not have is a tall run of NOTHING, which is what a stage spacer is.
    //
    // So the measurement is the largest vertical gap between consecutive
    // rendered boxes inside the section, not the section's height against its
    // character count. A ratio of text to height flags the work section for
    // being illustrated, which is not the defect being looked for.
    const gaps = await page.evaluate(() => {
      const out: { stage: string; gapSvh: number }[] = [];
      for (const section of document.querySelectorAll<HTMLElement>('[data-stage]')) {
        const boxes = [...section.querySelectorAll<HTMLElement>('*')]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.height > 0 && r.width > 0)
          .sort((a, b) => a.top - b.top);
        if (boxes.length === 0) continue;

        // Sweep a running low-water mark down the section: a gap only counts
        // when nothing at all occupies the band, which is what makes nested
        // boxes and overlapping columns not read as holes.
        let reach = section.getBoundingClientRect().top;
        let largest = 0;
        for (const box of boxes) {
          if (box.top > reach) largest = Math.max(largest, box.top - reach);
          reach = Math.max(reach, box.bottom);
        }
        largest = Math.max(largest, section.getBoundingClientRect().bottom - reach);
        const gapSvh = (largest / innerHeight) * 100;
        if (gapSvh > 34) out.push({ stage: section.dataset.stage!, gapSvh });
      }
      return out;
    });

    expect(gaps).toEqual([]);
  });

  test('nothing paints an opaque plate across the altimeter', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);

    const covering = await page.evaluate(() => {
      // The stage, not the dial. The instrument is a WebGL canvas now and the
      // dial is a node inside a GLB, so the element that has a box on this page
      // is the slot the canvas fills — and the slot is the right subject in any
      // case: §14 forbids the *instrument* being covered, and the instrument
      // occupies the whole slot.
      const stage = document.querySelector('.mv-alt__stage');
      if (!stage) return ['no instrument stage'];
      const box = stage.getBoundingClientRect();
      const solid: string[] = [];

      for (const el of document.querySelectorAll<HTMLElement>('.mv-sec, .mv-sec *, .mv-flow')) {
        const style = getComputedStyle(el);
        const bg = style.backgroundColor;
        const match = /rgba?\(([^)]+)\)/.exec(bg);
        if (!match) continue;
        const parts = match[1].split(',').map((n) => parseFloat(n));
        const alpha = parts.length > 3 ? parts[3] : 1;
        // Anything at all opaque is a plate. §10 and §18: this page has ONE
        // painted surface and it is the background, behind everything.
        if (alpha < 0.02) continue;
        const r = el.getBoundingClientRect();
        const overlaps =
          r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
        if (overlaps) solid.push(`${el.className} ${bg}`);
      }
      return solid;
    });

    expect(covering).toEqual([]);
  });

  test('there is one altitude readout, not two', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);

    // The old page published the altitude in the HUD and again in every panel
    // eyebrow, from two different numbers. There is one live readout now; the
    // eyebrows carry a static *range*, which is a label and not a reading.
    expect(await page.locator('[data-testid="mobile-altitude"]').count()).toBe(1);
    expect(await page.locator('[data-testid="altitude-value"]').count()).toBe(0);
    expect(await page.locator('[data-testid="mobile-stage"]').count()).toBe(1);
  });

  test('the telemetry stays visible and above the copy', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);
    await revealed(page);

    for (const at of [0, 0.4, 0.75, 1]) {
      await page.evaluate((f) => {
        scrollTo({ top: (document.documentElement.scrollHeight - innerHeight) * f, behavior: 'instant' });
      }, at);
      await page.waitForTimeout(120);
      const strip = page.locator('[data-testid="mobile-telemetry"]');
      await expect(strip).toBeInViewport();

      // Paint order, asked as paint order.
      //
      // `elementFromPoint` is the obvious tool and it is the wrong one here:
      // the strip is `pointer-events: none` so that a visitor can scroll
      // through it, and hit-testing therefore returns whatever is *behind* it —
      // reporting the readout as covered on a page where it is painted on top.
      // What has to be true is that the strip is out of the document's flow and
      // above everything in it, which is a pair of computed values.
      const stacking = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="mobile-telemetry"]') as HTMLElement;
        const own = getComputedStyle(el);
        let highestBelow = 0;
        for (const other of document.querySelectorAll<HTMLElement>('.mv-flow, .mv-flow *')) {
          const z = Number(getComputedStyle(other).zIndex);
          if (Number.isFinite(z)) highestBelow = Math.max(highestBelow, z);
        }
        return { position: own.position, z: Number(own.zIndex), highestBelow, opacity: Number(own.opacity) };
      });
      expect(stacking.position, `not fixed at ${at}`).toBe('fixed');
      expect(stacking.z, `outranked at ${at}`).toBeGreaterThan(stacking.highestBelow);
      expect(stacking.opacity).toBe(1);
    }
  });

  test('the altitude advances with the document and settles at the ceiling', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);

    const read = () =>
      page.locator('[data-testid="mobile-altitude"]').innerText().then((t) => Number(t.replace(/\D/g, '')));

    const top = await read();
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await scrolledAndRead(page);
    const bottom = await read();

    expect(top).toBeLessThan(1000);
    expect(bottom).toBe(30000);
  });

  test('every reveal completes', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);
    await revealed(page);

    const unresolved = await page.evaluate(
      () =>
        [...document.querySelectorAll('.mv-text, .mv-copy, .mv-label, .mv-lines, .mv-rule')].filter(
          (el) => !el.classList.contains('is-in'),
        ).length,
    );
    expect(unresolved).toBe(0);
  });

  test('the closing action is reachable at the bottom of the page', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);
    await revealed(page);

    await page.locator('#stage-destination').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-testid="cta-primary"]')).toBeVisible();
    // 44px is the floor; this page asks for 48.
    const box = await page.locator('[data-testid="cta-primary"]').boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('portrait mobile — lifecycle', () => {
  test('the menu opens, locks only while it is open, and leaves the ascent where it was', async ({
    page,
  }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);

    await page.evaluate(() => scrollTo({ top: 5200, behavior: 'instant' }));
    await scrolledAndRead(page);
    const before = await page.evaluate(() => scrollY);
    const altitudeBefore = await altitude(page);

    // `.burger` unconditionally, and no `test.skip` if it is missing.
    //
    // This asked for `.nav__burger, [data-nav-toggle], button[aria-controls]`
    // and skipped itself when none matched. Only the third alternative has ever
    // matched anything — the control is `.burger`, `aria-controls="menu"`, and
    // `homepage-chrome.spec.ts` has addressed it that way throughout — so two
    // thirds of that selector were guesses, and the `count() === 0` branch
    // turned "the phone has no menu button" from the loudest possible
    // regression into a green run with a skip note. A phone that cannot open
    // the navigation has no navigation.
    const toggle = page.locator('.burger');
    await expect(toggle, 'a portrait viewport has no menu control').toHaveCount(1);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // The lock is not on before it is asked for. Without this the two
    // assertions after the open are satisfied by a page that is permanently
    // fixed, which is a scroll trap rather than a scroll lock.
    expect(await locked(page), 'the body was already scroll-locked with the menu shut').toBe(false);

    // Whoever holds focus now is where `header.js` promises to put it back.
    // Recorded as a descriptor read out into Node rather than as a reference
    // stashed on `window`, so nothing about page globals surviving a click has
    // to be true for the comparison to mean something.
    const focusHere = () =>
      page.evaluate(() => {
        const a = document.activeElement;
        if (!a) return 'null';
        if (a === document.body || a === document.documentElement) return 'BODY';
        return `${a.tagName.toLowerCase()}#${a.id || ''}.${String(a.className).trim().split(/\s+/)[0] || ''}`;
      });
    const focusBefore = await focusHere();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // While open: the lock is on, and it is `position: fixed` on the body
    // rather than `overflow: hidden`, because iOS Safari honours only the
    // former. `ascent.ts` stands its reader down for exactly this window and
    // names this class as the signal, so the class is the contract, not an
    // implementation detail this test happened to find.
    expect(await locked(page), 'the menu opened without locking the page behind it').toBe(true);

    // Focus went into the layer. `header.js` sends it to the first link rather
    // than the burger, so "inside #menu" is the property, not a named element.
    expect(
      await page.evaluate(() => !!document.getElementById('menu')?.contains(document.activeElement)),
      'opening the menu left focus outside the layer',
    ).toBe(true);

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Escape put focus back where it came from, and above all NOT on <body>.
    //
    // Not `expect(toggle).toBeFocused()`. `header.js` restores focus to
    // whatever held it before the layer opened — `restoreTo` — and falls back
    // to the burger only when that element is gone. Asserting the burger
    // encodes Chromium's incidental behaviour that clicking a `<button>` also
    // focuses it: on WebKit a click does not focus a button, so `restoreTo` is
    // whatever the visitor was on (measured: `main.journey`), and returning
    // there is the *correct* outcome rather than a failure.
    //
    // Losing focus to `<body>` is the actual bug — it is what makes a keyboard
    // user restart from the top of the document — and `header.js` names it as
    // such. So that is what this asserts, on both engines.
    const landed = await focusHere();
    expect(landed, 'closing the menu dropped focus to <body>').not.toBe('BODY');
    expect(
      [focusBefore, 'button#.burger'],
      `focus landed on ${landed}, which is neither where it came from (${focusBefore}) nor the burger`,
    ).toContain(landed);

    // The lock came off with it.
    expect(await locked(page), 'the menu closed but the page stayed locked').toBe(false);

    // The old page walked the whole ascent back to the valley floor behind the
    // menu, because the scroll lock pinned `scrollY` at 0 and the driver
    // believed it. There is nothing to believe now — the reader reads `scrollY`
    // and the lock restores it.
    //
    // Asserted on the scroll position rather than on the readout, and to within
    // two pixels rather than exactly. `header.js` holds the body at a negative
    // `top` and puts the position back on close, which is the only lock iOS
    // Safari honours and is accurate to a pixel or so. The altitude is
    // continuous, so a two-pixel restore shows up as a few tens of metres — a
    // number that would make this test look like a regression in the ascent
    // when what it is measuring is the rounding in someone else's scroll lock.
    expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThanOrEqual(2);

    // And the readout agrees with the position it was put back to. This is the
    // half the scroll assertion cannot make: `ascent.ts` suspends its reader for
    // the duration of the lock and catches up on the close edge, so a restored
    // scroll position with a stale readout is a real, reachable state — the
    // visitor closes the menu and the instrument is reading 0 m at 23 000 m.
    expect(Math.abs((await altitude(page)) - altitudeBefore)).toBeLessThanOrEqual(60);

    // The document scrolls again. A lock that is released in the class but not
    // in the body's style passes every assertion above and still leaves a page
    // the visitor cannot move.
    await page.evaluate(() => scrollTo({ top: 3000, behavior: 'instant' }));
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => Math.round(scrollY)), 'the page will not scroll after the menu closed')
      .toBeGreaterThan(2500);
  });

  test('the menu closes on the burger too, and traps Tab while it is open', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);

    const toggle = page.locator('.burger');
    await expect(toggle).toHaveCount(1);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // The trap, asked at the two places it is implemented.
    //
    // Not "press Tab ten times and check focus is still inside". That reads as
    // the stronger test and is actually an engine test: WebKit's default tab
    // model moves between form controls only, and every one of the layer's 17
    // focusables is an `<a>`. Measured on this build, one Tab from a menu link
    // goes to `input#nl` — the newsletter field behind the layer — so the loop
    // asserts a keyboard model rather than this site's behaviour, and fails on
    // the engine every iPhone runs while the trap itself is intact.
    //
    // `header.js` implements the trap as two boundary wraps: Tab on the last
    // focusable goes to the first, Shift+Tab on the first goes to the last, and
    // the burger is deliberately first because while the layer is open it is
    // the close control. Focusing a boundary directly and pressing once
    // exercises exactly that, deterministically, on either engine.
    //
    // (The WebKit escape is real and worth knowing about — it is recorded as a
    // deferred accessibility finding in the final report — but it is a missing
    // `inert`/`aria-hidden` on the background, which is a product change and
    // not this brief's to make.)
    const boundaries = await page.evaluate(() => {
      const menu = document.getElementById('menu')!;
      const burger = document.querySelector('.burger') as HTMLElement;
      const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
      const list = [burger, ...menu.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      list[list.length - 1].dataset.probeLast = '1';
      return { count: list.length, firstIsBurger: list[0] === burger };
    });
    expect(boundaries.count, 'the layer has no focusables').toBeGreaterThan(1);
    expect(boundaries.firstIsBurger, 'the burger is not first in the trap').toBe(true);

    // Forward wrap: on the last, Tab goes to the first, which is the burger.
    await page.evaluate(() => {
      (document.querySelector('[data-probe-last]') as HTMLElement).focus();
    });
    await page.keyboard.press('Tab');
    await expect(toggle, 'Tab on the last focusable did not wrap to the burger').toBeFocused();

    // Backward wrap: on the first, Shift+Tab goes to the last.
    await page.keyboard.press('Shift+Tab');
    expect(
      await page.evaluate(() => document.activeElement?.hasAttribute('data-probe-last') ?? false),
      'Shift+Tab on the burger did not wrap to the last focusable',
    ).toBe(true);

    // Closing from the control itself, which is the path Escape does not cover.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(await locked(page)).toBe(false);
  });

  test('a back navigation comes back with a live, agreeing readout', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);

    await page.evaluate(() => scrollTo({ top: 6400, behavior: 'instant' }));
    await page.waitForTimeout(250);

    await page.goto('/impresszum.html');
    await page.goBack();
    await ready(page);
    // `pageshow` runs the readers synchronously — rAF does not fire in a
    // restoring tab, which is the whole reason that listener is not routed
    // through `onScroll` — and then once more a frame later, once the restored
    // document has its real height.
    await page.waitForTimeout(500);

    // NOT "the altitude is the one you left at".
    //
    // Scroll restoration does not work on this homepage, and it is not the
    // portrait composition's doing. Measured with controls in
    // `experiments/probe-back-navigation.mjs`, five trials per arm, leaving from
    // 6 400 px:
    //
    //   arm                        chromium              webkit
    //   home         390x844       2/5 bottom, 3/5 ok    5/5 bottom (13 349)
    //   home-desktop 1440x900      5/5 bottom (20 569)   5/5 near top (794)
    //   static       390x844       5/5 restored (6 400)  5/5 restored (6 400)
    //   static-nojs  390x844       5/5 restored (6 400)  5/5 restored (6 400)
    //
    // A generated static page restores exactly, at the same phone viewport, on
    // both engines — so neither the engine nor the mobile viewport is the
    // cause. The homepage fails on *both* compositions and *both* engines, in
    // different directions. What the failing arms share is a document whose
    // height is produced by React after load, which is the mechanism
    // `assets/js/transitions.js` already documents next to its
    // `scrollRestoration` note.
    //
    // So this is a homepage-wide defect, it is not this brief's to change
    // (§14), and it is recorded in
    // `_build/reports/mobile-test-reconciliation/final-report.md` as a separate
    // UX defect. A test that asserted the restored position would be asserting
    // a bug in something else.
    //
    // What IS this page's promise is that it comes back *working*: the reader
    // is running, the readout agrees with wherever the browser actually put the
    // scroll, and moving still moves it.
    const agrees = async () => {
      const y = await page.evaluate(() => scrollY);
      const shown = Number((await page.locator('[data-testid="mobile-altitude"]').innerText()).replace(/\D/g, ''));
      return { y, shown };
    };

    const restored = await agrees();
    // At the top the readout is 0; anywhere below it, it has climbed. Either is
    // consistent — a frozen reader is what this catches, and a frozen reader
    // reports 0 from a position that is not the top.
    if (restored.y > 200) expect(restored.shown).toBeGreaterThan(0);

    await page.evaluate(() => scrollTo({ top: 1200, behavior: 'instant' }));
    await page.waitForTimeout(250);
    const moved = await agrees();
    expect(moved.shown).not.toBe(restored.shown);
    expect(moved.shown).toBeLessThan(30_000);
  });

  test('browser chrome collapsing does not move the composition', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);
    await revealed(page);

    const size = page.viewportSize()!;
    await page.evaluate(() => scrollTo({ top: 4000, behavior: 'instant' }));
    await page.waitForTimeout(200);
    const before = await page.evaluate(() =>
      [...document.querySelectorAll('[data-stage]')].map((el) =>
        Math.round(el.getBoundingClientRect().top + scrollY),
      ),
    );

    // The toolbar collapsing is a viewport-height change and nothing else.
    // Every stage's *document* position must be identical afterwards: the
    // layout is composed against `svh`, which does not move.
    await page.setViewportSize({ width: size.width, height: size.height + 92 });
    await page.waitForTimeout(400);
    const after = await page.evaluate(() =>
      [...document.querySelectorAll('[data-stage]')].map((el) =>
        Math.round(el.getBoundingClientRect().top + scrollY),
      ),
    );

    expect(after).toEqual(before);
  });

  test('a rotation keeps the mobile composition', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);

    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.height, height: size.width });
    await page.waitForTimeout(600);

    // §23: mobile landscape gets the simple composition, and the decision is
    // never retaken. A rotation that swapped compositions would tear down a
    // live tree and rebuild the other underneath a moving finger.
    expect(await mounted(page)).toBe(true);
    await expect(page.locator('[data-testid="mobile-altimeter"]')).toBeVisible();

    // And the instrument survives the rotation as one context rather than
    // being torn down and rebuilt: a remount would cost a GLB re-parse, a
    // PMREM bake and a shader compile, in the middle of a gesture.
    await expect(page.locator('canvas')).toHaveCount(1);
  });
});

test.describe('portrait mobile — reduced motion', () => {
  test('everything is present and nothing travels', async ({ page }) => {
    await enableReducedMotion(page);
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);

    // §24: no scroll walk needed. Under reduced motion the reveals resolve at
    // registration, so if anything is still hidden it is hidden for good.
    const state = await page.evaluate(() => {
      const roles = [...document.querySelectorAll('.mv-text, .mv-copy, .mv-label, .mv-lines, .mv-rule')];
      const hidden = roles.filter((el) => !el.classList.contains('is-in')).length;
      const moved = roles.filter((el) => {
        const t = getComputedStyle(el).transform;
        return t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)';
      }).length;
      const invisible = roles.filter((el) => Number(getComputedStyle(el).opacity) < 0.99).length;
      return { roles: roles.length, hidden, moved, invisible };
    });

    expect(state.roles).toBeGreaterThan(20);
    expect(state.hidden).toBe(0);
    expect(state.invisible).toBe(0);
    // `.mv-rule` resolves to scaleY(1), which is a transform. Nothing else is
    // allowed one.
    expect(state.moved).toBeLessThanOrEqual(
      await page.locator('.mv-rule').count(),
    );

    await expect(page.locator('[data-testid="mobile-altimeter"]')).toBeVisible();
    await expect(page.locator('[data-testid="cta-primary-hero"]')).toBeVisible();
  });

  test('the real instrument stays, and stops moving', async ({ page }) => {
    await enableReducedMotion(page);
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);

    // §20, and it is a deliberate reversal of the obvious behaviour: reduced
    // motion does NOT demote the visitor to the inferior drawing. The physical
    // instrument is the content; the preference is about movement.
    await expect(page.locator('canvas')).toHaveCount(1);
    expect(await page.locator('[data-testid="mobile-altimeter-svg"]').count()).toBe(0);
    await instrumentReady(page);

    // And it holds still. The pose is scroll-driven for everyone else; here the
    // instrument keeps the composed attitude and only the needles follow the
    // altitude, so two frames a screen apart differ by the needle and nothing
    // that could be called drift.
    const canvas = page.locator('canvas');
    const composed = await canvas.screenshot();
    await page.evaluate(() => scrollTo({ top: 120, behavior: 'instant' }));
    await page.waitForTimeout(900);
    const later = await canvas.screenshot();

    // Not asserted equal: the needles are allowed to have moved, and at 120px
    // of scroll they will have. Asserted *present* — a canvas that had gone
    // blank or been unmounted is the failure this catches.
    expect(later.byteLength).toBeGreaterThan(1000);
    expect(composed.byteLength).toBeGreaterThan(1000);
  });
});

/**
 * The instrument's own architecture — §4, §5, §12 and §15 of the 3D brief.
 *
 * These are the tests that would have caught the two defects this work actually
 * had. The first version of the scene ran a permanent settle that never
 * converged and kept drawing for 3.2 seconds after every gesture; the second
 * kept drawing for the whole document because nothing told it the instrument
 * had left the screen. Neither was visible on screen and both were obvious in a
 * counter, which is why every assertion below counts something.
 */
test.describe('portrait mobile — the 3D instrument', () => {
  /** Count WebGL draws from before the first module runs. */
  const countDraws = (page: Page) =>
    page.addInitScript(() => {
      const w = window as unknown as { __draws: number };
      w.__draws = 0;
      for (const proto of [
        (window as unknown as { WebGLRenderingContext?: { prototype: object } }).WebGLRenderingContext?.prototype,
        (window as unknown as { WebGL2RenderingContext?: { prototype: object } }).WebGL2RenderingContext?.prototype,
      ]) {
        if (!proto) continue;
        for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
          const raw = (proto as Record<string, unknown>)[name];
          if (typeof raw !== 'function') continue;
          (proto as Record<string, unknown>)[name] = function (this: unknown, ...rest: unknown[]) {
            w.__draws++;
            return (raw as (...a: unknown[]) => unknown).apply(this, rest);
          };
        }
      }
    });

  const draws = (page: Page) =>
    page.evaluate(() => (window as unknown as { __draws: number }).__draws);

  test('nothing renders while the page is idle', async ({ page }) => {
    await countDraws(page);
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);
    await instrumentReady(page);

    // Let the settle finish. `data-ready` is the first settled frame, and the
    // margin is there so this measures an idle page rather than the tail of the
    // one that just settled.
    await page.waitForTimeout(1200);
    const before = await draws(page);
    await page.waitForTimeout(2500);
    const after = await draws(page);

    // §4, exactly: when the visitor is idle and the instrument is static, GPU
    // rendering stops. Zero, not "few" — a permanent rAF loop is either there
    // or it is not.
    expect(after - before).toBe(0);
  });

  /**
   * REPLACES 'nothing renders while the instrument is off screen'.
   *
   * That test asserted the defect this workstream exists to remove. It scrolled
   * four screens past the hero, confirmed the renderer had stopped, and passed
   * — which was exactly right when the instrument lived in the opening
   * section's flow and exactly the behaviour the review rejected: the page's
   * signature object left the experience after one screen of seventeen.
   *
   * The instrument is persistent now, so "off screen" is not a state it has.
   * What replaced the assertion is the pair of guarantees that still hold and
   * still matter — it stops when the page stops, and it stops when it has been
   * deliberately hidden — plus the one the change introduced a risk of: that a
   * persistent instrument does not quietly become a permanent render loop.
   */
  test('nothing renders while the instrument is deliberately hidden', async ({ page }) => {
    await countDraws(page);
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);
    await instrumentReady(page);

    // The navigation layer is the one authored disappearance mid-document.
    // `.burger`, and only `.burger`. A previous version of this file guessed at
    // three other selectors and matched none of them.
    await page.locator('.burger').click();
    await expect(page.locator('html')).toHaveClass(/menu-open/);
    await page.waitForTimeout(1500);

    const before = await draws(page);
    await page.waitForTimeout(2000);
    expect((await draws(page)) - before).toBe(0);
  });

  test('the instrument is still there, still reading, and never on the readout', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);
    await instrumentReady(page);

    const overlay = page.locator('[data-testid="mobile-altimeter"]');
    const stage = page.locator('.mv-alt__stage');

    // The frame the page opens on: the instrument fills the band the opening
    // section reserved for it, at full strength.
    await expect(overlay).toHaveAttribute('data-inst-state', 'hero');
    expect((await stage.boundingBox())!.width).toBeGreaterThan(280);

    /**
     * And then the rest of the document, one section at a time.
     *
     * ONE WALK, FOUR ASSERTIONS. This was two tests — persistence and the
     * telemetry clearance — each traversing the whole document and each taking
     * ~13 s. Two full traversals of a seventeen-screen WebGL page is real load
     * on a suite that already sits close to its timeouts under parallel
     * workers, and the two questions are asked at exactly the same scroll
     * positions. So they are asked together.
     *
     * Stepping by SECTION rather than by screen for the same reason: eleven
     * stops instead of seventeen, and a section boundary is where the
     * instrument's state can actually change, so the shorter walk tests more
     * per stop rather than less overall.
     *
     * At each stop:
     *   * the overlay names an AUTHORED state, not an improvised one
     *   * the instrument is settled — no assertion measures a transition
     *   * it is on screen, at a real size, at a real opacity
     *   * its needles agree with the altitude the page is showing
     *   * it is clear of the telemetry rule, the page's only other fixed object
     *
     * Together those are the review's requirement in its own words: at no point
     * in the primary journey is the reaction "where did the Altimeter go?".
     */
    const authored = new Set(['hero', 'ascent', 'capabilities', 'summit', 'work', 'process', 'arrival']);
    const stages = await page.$$eval('[data-stage]', (els) => els.map((el) => el.getAttribute('data-stage')!));
    expect(stages.length).toBeGreaterThan(8);

    let lastAltitude = -1;
    for (const id of stages) {
      await page.evaluate((stage) => {
        const section = document.querySelector(`[data-stage="${stage}"]`)!;
        const rect = section.getBoundingClientRect();
        scrollTo({ top: Math.max(0, rect.top + scrollY - innerHeight * 0.2), behavior: 'instant' });
      }, id);

      await settled(page);

      const state = await overlay.getAttribute('data-inst-state');
      // `recede` is authored too, and it is the LAST thing that happens: the
      // homepage flow has ended and the site's own Arrival panel and footer
      // have begun. Everything before that must be a visible state.
      if (state === 'recede') break;

      expect(authored, `${id} is in an authored state`).toContain(state);

      const box = await stage.boundingBox();
      const opacity = await stage.evaluate((el) => Number(getComputedStyle(el).opacity));
      const viewport = page.viewportSize()!;

      expect(box, `${id} has the instrument on screen`).not.toBeNull();
      expect(box!.width, `${id} instrument width`).toBeGreaterThan(60);
      expect(box!.y + box!.height, `${id} instrument top edge`).toBeGreaterThan(0);
      expect(box!.y, `${id} instrument bottom edge`).toBeLessThan(viewport.height);
      expect(opacity, `${id} instrument opacity`).toBeGreaterThan(0.4);

      /**
       * The page's two fixed objects, authored not to touch — in the DOCKED
       * states.
       *
       * The rail keeps the instrument clear of the telemetry strip's rule at
       * every viewport in the matrix, from a constant solved against the strip's
       * own padding rather than a number that happened to look right at 390.
       * A regression there is invisible in a screenshot of the top of the page
       * and obvious to anyone actually reading the altitude.
       *
       * The HERO is excluded, and not as a convenience. In the hero the
       * instrument is where the opening section's own composition puts it —
       * the same block, at the same offset, as the in-flow slot it replaces —
       * and on a short viewport that block's lower edge is already inside the
       * telemetry gradient. Measured on `mobile-430`, whose preset viewport is
       * 430x740: the reserve ends at 701 and the rule sits at 696. That is the
       * accepted, shipped hero frame and the gradient washing over its base is
       * how the strip has always separated itself from the page. Asserting
       * clearance there would be asserting against the composition rather than
       * against this change.
       */
      if (state !== 'hero') {
        const clash = await page.evaluate(() => {
          const instrument = document.querySelector('.mv-alt__stage')!.getBoundingClientRect();
          const rule = document.querySelector('.mv-telemetry__rule')!.getBoundingClientRect();
          return instrument.bottom > rule.top;
        });
        expect(clash, `${id}: instrument overlaps the telemetry rule`).toBe(false);
      }

      // It is not merely present, it is READING. The altitude only ever goes up
      // on the way down the page, which is the whole premise of the journey.
      const metres = await altitude(page);
      expect(metres, `${id} altitude advances`).toBeGreaterThanOrEqual(lastAltitude);
      lastAltitude = metres;
    }

    // The recede is reached, and it is a real departure rather than a shrug.
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await settled(page);
    await expect(overlay).toHaveAttribute('data-inst-state', 'recede');
    expect(await stage.evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(0.02);
  });

  test('the instrument adds no scroll listener of its own', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __scrollListeners: number };
      w.__scrollListeners = 0;
      for (const target of [window, document, document.documentElement].filter(Boolean)) {
        const raw = target.addEventListener.bind(target);
        (target as EventTarget).addEventListener = function (type: string, fn: never, opts: never) {
          if (type === 'scroll') w.__scrollListeners++;
          return raw(type, fn, opts);
        };
      }
    });

    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);
    await instrumentReady(page);

    const atRest = await page.evaluate(
      () => (window as unknown as { __scrollListeners: number }).__scrollListeners,
    );
    await page.evaluate(() => {
      (window as unknown as { __scrollListeners: number }).__scrollListeners = 0;
    });

    for (let i = 1; i <= 8; i++) {
      await page.evaluate((n) => scrollTo({ top: innerHeight * n * 0.7, behavior: 'instant' }), i);
      await page.waitForTimeout(90);
    }
    const duringScroll = await page.evaluate(
      () => (window as unknown as { __scrollListeners: number }).__scrollListeners,
    );

    // §15: zero new scroll listeners where the existing shared progress can be
    // reused, and the instrument reuses it — `onAscent` and `onMeasure`, both
    // already installed. The ceiling is generous because it counts the page's
    // own header and transition controller as well; what it forbids is a number
    // that grows with the scroll, which is the shape of the defect it catches.
    expect(atRest).toBeLessThanOrEqual(4);
    expect(duringScroll).toBe(0);
  });

  test('the slot has a fixed box that the instrument cannot change', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);

    // Measured before the renderer exists and after it has settled. §12: the
    // canvas must not generate exclusion zones, dynamic stage heights or
    // measured content offsets — so the arrival of a live instrument must move
    // precisely nothing.
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
    await instrumentReady(page);
    await page.waitForTimeout(800);
    const after = await boxOf();

    expect(after.stage).toEqual(before.stage);
    expect(after.nextSectionTop).toBe(before.nextSectionTop);
    expect(after.docHeight).toBe(before.docHeight);

    // And the slot is a slot, not an animation stage — §13's 38–52svh, with the
    // landscape case allowed its own smaller box by the same two declarations.
    const share = await page.evaluate(() => {
      const r = document.querySelector('.mv-alt__stage')!.getBoundingClientRect();
      return r.height / innerHeight;
    });
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.55);
  });

  // The painting rule §14 shares with the mobile reset's §10 is already
  // asserted, once, in 'nothing paints an opaque plate across the altimeter'
  // above — retargeted from the SVG dial to the instrument's slot. A second
  // copy here would be a second thing to keep in step with the first.
});

test.describe('desktop — the composition that must not have changed', () => {
  test('a desktop viewport still gets the cinematic journey and its terrain', async ({ page }, testInfo) => {
    // Reduced motion declines the renderer on purpose, on every viewport. There
    // is no terrain to assert on that path and asserting it would be asking the
    // page to break its own promise.
    test.skip(testInfo.project.name === 'reduced-motion', 'that path declines the renderer by design');

    // Which fork ran is a question about the DOM, so it has to be asked after a
    // navigation — and the terrain request happens during boot, so its listener
    // has to be armed before one. Load, ask, then arm and reload. The reload is
    // the cheap way to have both; arming first and skipping afterwards leaves a
    // pending `waitForRequest` behind on every phone project, which is what
    // this did and how it failed there.
    await page.goto('/');
    // Which fork ran is a question about the DOM, and the DOM does not have the
    // answer until the journey has mounted. That used to be true by the time
    // `goto` resolved; it is not any more, because the homepage waits for the
    // visitor's first move and `bootJourneyOnLoad` gives it one at `load`. So
    // wait for whichever composition arrives before asking which one it was —
    // otherwise a phone reads as "not mobile" and runs the desktop assertion.
    await page.waitForSelector('[data-testid="mobile-home"], [data-testid="journey-track"]', {
      timeout: 20_000,
    });
    if (await mounted(page)) test.skip(true, 'mobile composition — this is the desktop assertion');

    const terrain = page.waitForRequest(/mountains.*\.glb/i, { timeout: 45_000 });
    await page.reload();

    // The track is the desktop architecture. It is untouched, and this is the
    // test that says so from the outside.
    await expect(page.locator('[data-testid="journey-track"]')).toBeAttached();
    await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0, null, {
      timeout: 30_000,
    });

    // Waited for, not slept on. A fixed 3 s pass locally and failed under the
    // full suite's parallel load, which is the definition of a flaky assertion:
    // it was measuring how busy the machine was, not whether the terrain loads.
    await terrain;
  });
});
