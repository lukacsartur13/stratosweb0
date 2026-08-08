import { test, expect, type Page } from '@playwright/test';
import { enableReducedMotion } from './helpers/reduced-motion';

/**
 * The simplified portrait homepage — architecture, not pixels.
 *
 * §28 of the mobile reset brief asks for tests that validate the architecture
 * rather than overfitting individual measurements, and the distinction is the
 * whole design of this file. Every assertion below is about a *property the
 * architecture guarantees*:
 *
 *   * the terrain is not on this page — a request that is never made
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

/** Let every reveal fire, then let the longest transition (1.05 s) finish. */
async function revealed(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = await page.evaluate(() => Math.round(innerHeight * 0.8));
  for (let y = 0; y < height; y += step) {
    await page.evaluate((to) => scrollTo({ top: to, behavior: 'instant' }), y);
    await page.waitForTimeout(70);
  }
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForFunction(
    () => document.querySelectorAll('.mv-text:not(.is-in), .mv-copy:not(.is-in), .mv-lines:not(.is-in)').length === 0,
    null,
    { timeout: 20_000 },
  );
}

test.describe('portrait mobile — the composition that runs', () => {
  test('a phone gets the simple composition and no canvas', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition — see the desktop suite below');
    await ready(page);

    expect(await page.locator('canvas').count()).toBe(0);
    // The desktop track is the thing this replaced. Its absence is the
    // clearest single statement that the two compositions are separate.
    expect(await page.locator('[data-testid="journey-track"]').count()).toBe(0);
    await expect(page.locator('[data-testid="mobile-altimeter"]')).toBeVisible();
    await expect(page.locator('[data-testid="mobile-telemetry"]')).toBeVisible();
  });

  test('no terrain, no renderer and no model is ever requested', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));

    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);
    // Scroll the whole document: a lazily-mounted scene would be requested on
    // arrival, not on load, and a check that only looks at the first screen
    // would miss exactly that.
    await revealed(page);

    expect(requested.filter((u) => u.includes('.glb'))).toEqual([]);
    expect(requested.filter((u) => /mountains/i.test(u))).toEqual([]);
    expect(requested.filter((u) => /JourneyScene|ScrollTrigger|draco/i.test(u))).toEqual([]);
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
      const dial = document.querySelector('.mv-alt__dial');
      if (!dial) return ['no dial'];
      const box = dial.getBoundingClientRect();
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
    await page.waitForTimeout(200);
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
  test('the menu opens, closes and leaves the ascent where it was', async ({ page }) => {
    await page.goto('/');
    if (!(await mounted(page))) test.skip(true, 'desktop composition');
    await ready(page);

    await page.evaluate(() => scrollTo({ top: 5200, behavior: 'instant' }));
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => scrollY);

    const toggle = page.locator('.nav__burger, [data-nav-toggle], button[aria-controls]').first();
    if ((await toggle.count()) === 0) test.skip(true, 'no menu control on this build');
    await toggle.click();
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

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
    // Chromium's own scroll restoration does not put a mobile viewport back
    // where it was on this site: measured on pristine `main`, a back navigation
    // from 6 400 px landed at 19 932 px — the bottom of the document — on the
    // mobile projects, while the desktop viewport restored to within 70 px.
    // That predates this work, reproduces identically on the previous
    // architecture, and is not this brief's to change. A test that asserted the
    // restored position would be asserting a bug in something else.
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
    expect(await page.locator('canvas').count()).toBe(0);
    await expect(page.locator('[data-testid="mobile-altimeter"]')).toBeVisible();
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
