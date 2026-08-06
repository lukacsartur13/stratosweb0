import { test, expect, type Page } from '@playwright/test';

/**
 * The portrait-mobile homepage: stage entry, the top-of-screen deck, the layer
 * order, and which terrain composition a frame gets.
 *
 * WHY THESE ARE HERE AND NOT IN public-site.spec.ts
 * -------------------------------------------------
 * That file asks whether the journey works. These ask whether it is *composed*
 * on a phone — whether a stage shows its subject when you arrive at it, whether
 * the header and the instrument have stopped sharing a band, and whether the
 * copy is attached to the finger. Every one of them is a regression that
 * previously shipped while every existing assertion passed, because none of
 * them is a question about correctness. They are questions about geometry.
 *
 * WHY THEY ASSERT NUMBERS AND NOT SCREENSHOTS
 * -------------------------------------------
 * A screenshot test on a WebGL page that fades between damped states is a test
 * that fails for the weather. Each defect here has a measurable signature — a
 * distance in svh, an overlap in pixels, a custom property, a request URL — so
 * that is what is asserted. What the frames *look* like belongs in the review
 * package, which is what a human approves.
 *
 * ## The one thing these deliberately do not do
 *
 * None of them raises a timeout to make a lifecycle problem go away. Where a
 * test has to wait, it waits for a condition it names: the composition having
 * been measured (`data-composition`), or the scroll position having stopped
 * changing. A bare `waitForTimeout` here would be hiding exactly the class of
 * defect the file exists to catch.
 */

/** Portrait phone projects only. Everything below is a portrait composition. */
const portraitOnly = (page: Page) => {
  const vp = page.viewportSize();
  return !!vp && vp.width / vp.height < 1;
};

/**
 * Wait until `measureComposition` has run and published its decision.
 *
 * The portrait window is not the state the page loads in — it defaults to
 * natural flow so that a measurement which never happens degrades to a readable
 * document rather than to a band that was never sized. So every assertion below
 * has to wait for the measured state, and waiting for `data-composition` is
 * waiting for the exact event rather than for a duration that usually covers it.
 */
async function composed(page: Page) {
  await page.waitForFunction(
    () => document.documentElement.dataset.composition !== undefined,
    null,
    { timeout: 20_000 }
  );
  // The scene's first frames also settle `--meridian-gap`, which every band
  // width is derived from. Waiting for it to be non-zero is waiting for the
  // instrument to have been projected at least once.
  await page.waitForFunction(
    () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--meridian-gap')) > 0,
    null,
    { timeout: 20_000 }
  );
}

/** Scroll to the document position at which a stage's flow begins. */
async function goToStage(page: Page, stage: string) {
  const top = await page.evaluate((id) => {
    const panel = document.querySelector<HTMLElement>(`.panel[data-stage="${id}"]`);
    if (!panel) return null;
    // The panel's *flow* position: the portrait window gives each panel a
    // negative lead margin so adjacent plates share a screen of sticky range,
    // so the border box begins one screen before the stage does.
    const lead = parseFloat(getComputedStyle(panel).marginTop) || 0;
    return Math.round(panel.getBoundingClientRect().top + window.scrollY - lead);
  }, stage);
  expect(top, `stage ${stage} should exist`).not.toBeNull();
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), top!);
  // The damped clock drives the veil and the instrument's band; both have to
  // land before the geometry below means anything.
  await page.waitForFunction(
    (id) => {
      const p = document.querySelector<HTMLElement>(`.panel[data-stage="${id}"]`);
      return !!p && Number(p.style.getPropertyValue('--panel-veil') || '1') > 0.98;
    },
    stage,
    { timeout: 15_000 }
  );
}

// =============================================================================
// §23 — stage entry
// =============================================================================

/**
 * The three the brief names, by the copy that identifies them rather than by
 * index: a stage that is renumbered is still the same stage, and a test keyed
 * on position would pass through exactly the reordering it should catch.
 */
const NAMED_STAGES = [
  { stage: 'selected-work', hu: 'Akikkel', en: 'Those who climbed' },
  { stage: 'system', hu: 'Kilenc terület', en: 'Nine areas' },
  { stage: 'process', hu: 'Hét ellenőrzőpont', en: 'Seven checkpoints' },
];

/**
 * §6's budget. First meaningful content within 8–14svh, with headroom to 18svh
 * where a transition earns it — the instrument line under the header is such an
 * element, and it is what the extra allowance is spent on.
 */
const ENTRY_BUDGET_SVH = 18;

test.describe('portrait stage entry', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!portraitOnly(page), 'portrait composition only');
    await page.goto('/index.html', { waitUntil: 'load' });
    await composed(page);
  });

  for (const { stage, hu } of NAMED_STAGES) {
    test(`${stage} shows its subject in the first viewport`, async ({ page }) => {
      await goToStage(page, stage);

      const entry = await page.evaluate((id) => {
        const panel = document.querySelector<HTMLElement>(`.panel[data-stage="${id}"]`)!;
        const vh = window.innerHeight;
        const at = (sel: string) => {
          const el = panel.querySelector<HTMLElement>(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return r.height === 0 ? null : (r.top / vh) * 100;
        };
        return { eyebrow: at('.panel__eyebrow'), title: at('.panel__title'), fit: panel.dataset.fit };
      }, stage);

      expect(entry.fit, 'panel should have been measured').toBeTruthy();
      expect(entry.eyebrow, 'section marker should be laid out').not.toBeNull();
      // The defect this replaces measured 31–39svh here, and 30svh of unbroken
      // opaque plate above the eyebrow on a 390×844.
      expect(entry.eyebrow!).toBeLessThanOrEqual(ENTRY_BUDGET_SVH);
      expect(entry.title!).toBeLessThanOrEqual(ENTRY_BUDGET_SVH + 6);
    });

    test(`${stage} opens at the top of its own copy`, async ({ page }) => {
      await goToStage(page, stage);
      // `--stage-flow` is the walk through the flow window. At a stage's own
      // start it must be zero: any positive value is copy the visitor has been
      // scrolled past before arriving, which is how the process stage used to
      // open on checkpoint 02 with a clipped box where 01 had been.
      const flow = await page.evaluate((id) => {
        const p = document.querySelector<HTMLElement>(`.panel[data-stage="${id}"]`)!;
        return p.dataset.fit === 'window' ? Number(p.style.getPropertyValue('--stage-flow')) : 0;
      }, stage);
      expect(flow).toBeLessThanOrEqual(0.02);
    });
  }

  test('the named headlines are the stages under test', async ({ page }) => {
    // Guards the mapping above: if the copy moves to a different stage id, the
    // two tests per stage would keep passing while measuring the wrong panel.
    for (const { stage, hu } of NAMED_STAGES) {
      const text = await page.locator(`.panel[data-stage="${stage}"] .panel__title`).innerText();
      expect(text).toContain(hu);
    }
  });

  test('the entry budget itself stays inside §6', async ({ page }) => {
    // The invariant behind every per-stage assertion above, checked once rather
    // than eleven times: whatever the header state and the safe-area inset add
    // up to, the budget every panel is composed against is still a budget.
    //
    // Deliberately reads `--stage-entry-px` — the published number — and not
    // `--stage-entry`, which is a `var()` reference and resolves to a token
    // stream rather than to a length. That distinction is why the value is
    // computed in `entryBudget` and published at all.
    const svh = await page.evaluate(() => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--stage-entry-px');
      return (parseFloat(raw) / window.innerHeight) * 100;
    });
    expect(Number.isFinite(svh), '--stage-entry-px should be published in pixels').toBe(true);
    expect(svh).toBeGreaterThan(0);
    expect(svh).toBeLessThanOrEqual(ENTRY_BUDGET_SVH + 4);
  });
});

// =============================================================================
// §23 — header, safe area and the deck
// =============================================================================

test.describe('the mobile deck', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!portraitOnly(page), 'portrait composition only');
    await page.goto('/index.html', { waitUntil: 'load' });
    await composed(page);
  });

  test('header, instrument strip and first content never share a band', async ({ page }) => {
    // Every stage's *arrival* frame. A later panel scrolling its copy under the
    // deck afterwards is ordinary document behaviour — the same thing content
    // does under any fixed header — and is not what this asserts.
    const stages = ['calibration', 'selected-work', 'system', 'process', 'full-stratosphere'];
    for (const stage of stages) {
      await goToStage(page, stage);
      const overlap = await page.evaluate((id) => {
        const box = (sel: string) => {
          const el = document.querySelector<HTMLElement>(sel);
          return el ? el.getBoundingClientRect() : null;
        };
        const nav = box('.nav');
        const hud = box('.hud');
        const eyebrow = box(`.panel[data-stage="${id}"] .panel__eyebrow`);
        // The strip stands down entirely over the closing panel, and an element
        // at opacity 0 cannot collide with anything.
        const hudVisible = hud && Number(getComputedStyle(document.querySelector('.hud')!).opacity) > 0.01;
        const cross = (a: DOMRect | null, b: DOMRect | null) =>
          a && b ? Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0;
        return {
          navHud: hudVisible ? cross(nav, hud) : 0,
          hudEyebrow: hudVisible ? cross(hud, eyebrow) : 0,
        };
      }, stage);
      expect(overlap.navHud, `${stage}: header over strip`).toBeLessThanOrEqual(1);
      expect(overlap.hudEyebrow, `${stage}: strip over first content`).toBeLessThanOrEqual(1);
    }
  });

  test('the header carries the safe-area inset in every state', async ({ page }) => {
    // `env(safe-area-inset-top)` resolves to 0 in a headless browser, so this
    // cannot assert the inset itself. What it *can* assert is that the
    // declaration is still an `env()` — the regression that actually happened
    // was a later `padding-block` shorthand silently dropping it in the state
    // the visitor spends the whole page in, which is invisible until someone
    // opens the site on a notched phone.
    const css = await page.evaluate(async () => {
      const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];
      const chrome = links.find((l) => l.href.includes('chrome'));
      if (!chrome) return '';
      return (await fetch(chrome.href)).text();
    });
    expect(css, 'chrome.css should be linked').not.toBe('');
    const navRules = css.match(/\.nav(\[[^\]]+\])?\s*\{[^}]*padding[^}]*\}/g) ?? [];
    expect(navRules.length).toBeGreaterThan(0);
    for (const rule of navRules) {
      if (!/padding(-block)?\s*:/.test(rule)) continue;
      expect(rule, `nav padding rule without a safe-area inset: ${rule}`).toContain(
        'env(safe-area-inset-top)'
      );
    }
  });

  test('the altitude is published in one place, not two', async ({ page }) => {
    await goToStage(page, 'selected-work');
    const shown = await page.evaluate(() => {
      const visible = (el: Element | null) => {
        if (!el) return false;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      return {
        header: visible(document.querySelector('.nav__alt')),
        strip: visible(document.querySelector('.hud__readout')),
      };
    });
    expect(shown.header && shown.strip, 'two live altitude readouts on screen at once').toBe(false);
  });

  test('the menu is reachable and the deck survives it', async ({ page }) => {
    await goToStage(page, 'system');
    const burger = page.locator('.burger');
    await expect(burger).toBeVisible();
    const box = await burger.boundingBox();
    // §10.1's accessible touch target.
    expect(box!.height).toBeGreaterThanOrEqual(24);
    await burger.click();
    await expect(page.locator('.menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.menu.is-open')).toHaveCount(0);
    // The scroll lock is released and the composition is still the measured one.
    await expect(page.locator('html')).toHaveAttribute('data-composition', 'portrait');
  });
});

// =============================================================================
// §23 — layers and the instrument
// =============================================================================

test.describe('layers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'load' });
    await composed(page);
  });

  test('the layer order is declared centrally and consistently', async ({ page }) => {
    const layers = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      const read = (n: string) => Number(s.getPropertyValue(`--layer-${n}`).trim());
      const used = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).zIndex : null;
      };
      return {
        scene: s.getPropertyValue('--layer-scene').trim(),
        content: read('content'),
        hud: read('hud'),
        header: read('header'),
        overlay: read('overlay'),
        stageUsed: used('.journey__stage'),
        contentUsed: used('.journey__content'),
        hudUsed: used('.hud'),
        navUsed: used('.nav'),
      };
    });
    // The tokens exist…
    expect(Number.isFinite(layers.content)).toBe(true);
    expect(Number.isFinite(layers.hud)).toBe(true);
    // …the order is the composition. The strip is above the copy because it is
    // an overlay; it spent the whole journey underneath because the scene's
    // numeric index made its parent a stacking context.
    expect(layers.hud).toBeGreaterThan(layers.content);
    expect(layers.header).toBeGreaterThan(layers.hud);
    expect(layers.overlay).toBeGreaterThanOrEqual(layers.header);
    // The scene must stay `auto`. A number here is the regression: it reseals
    // the strip under the copy, and nothing visible changes on desktop, so
    // there is no other signal that it happened.
    expect(layers.scene).toBe('auto');
    expect(layers.stageUsed).toBe('auto');
    // …and the elements actually resolve to the tokens, so one that stops being
    // read is a failure rather than a comment.
    expect(layers.contentUsed).toBe(String(layers.content));
    expect(layers.hudUsed).toBe(String(layers.hud));
    // The header's number is quoted from chrome.css; if it changes there, this
    // is where the two stop agreeing.
    expect(layers.navUsed).toBe(String(layers.header));
  });

  test('no window plate paints an opaque band across the instrument', async ({ page }) => {
    test.skip(!portraitOnly(page), 'portrait composition only');
    // The window plate's wash is transparent between the two bands, and the
    // bands are sized from the measured exclusion zone. Assert the relationship
    // rather than a sampled pixel: the wash is a gradient whose stops are
    // custom properties, so the stops are the thing that can regress.
    const stages = ['calibration', 'lower-atmosphere', 'selected-work', 'process'];
    for (const stage of stages) {
      await goToStage(page, stage);
      const clear = await page.evaluate((id) => {
        const panel = document.querySelector<HTMLElement>(`.panel[data-stage="${id}"]`)!;
        if (panel.dataset.fit !== 'window') return null;
        // Real geometry, not custom properties. `--band` and `--lead-wash` are
        // `max()`/`calc()` expressions, and `getPropertyValue` hands back the
        // substituted token stream rather than a resolved length — `parseFloat`
        // on it is NaN, and every comparison against NaN is false, so a test
        // written that way passes by accident and keeps passing.
        //
        // The two band wrappers *are* boxes in window mode, so the clear region
        // is simply the space between them.
        const lead = panel.querySelector<HTMLElement>('.panel__band--lead')!.getBoundingClientRect();
        const flow = panel.querySelector<HTMLElement>('.panel__band--flow')!.getBoundingClientRect();
        const gap = parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--meridian-gap')
        );
        return { clear: flow.top - lead.bottom, gap };
      }, stage);
      if (clear === null) continue; // flow fallback: covered by its own test
      expect(
        clear.clear,
        `${stage}: only ${Math.round(clear.clear)}px clear for a ${Math.round(clear.gap)}px instrument`
      ).toBeGreaterThanOrEqual(clear.gap - 2);
    }
  });

  test('a flow-fallback plate does not cut through the instrument', async ({ page }) => {
    test.skip(!portraitOnly(page), 'portrait composition only');
    // Flow plates are solid cards and appear where the bands cannot hold the
    // copy — 200% zoom, larger text, German at narrow widths. They are allowed
    // to run over the scene; they are not allowed to slice it with a hard edge.
    const masked = await page.evaluate(() => {
      const out: { stage: string; mask: string }[] = [];
      for (const panel of document.querySelectorAll<HTMLElement>('.panel[data-fit="flow"]')) {
        const inner = panel.querySelector<HTMLElement>('.panel__inner')!;
        const s = getComputedStyle(inner);
        out.push({ stage: panel.dataset.stage!, mask: s.maskImage || s.webkitMaskImage || 'none' });
      }
      return out;
    });
    for (const m of masked) {
      expect(m.mask, `${m.stage}: flow plate has a hard leading edge`).toContain('gradient');
    }
  });
});

// =============================================================================
// §23 — terrain selection
// =============================================================================

test.describe('terrain composition', () => {
  test('the frame decides which terrain loads', async ({ page }) => {
    const models: string[] = [];
    page.on('request', (r) => {
      const u = r.url();
      if (u.endsWith('.glb')) models.push(u.split('/').pop()!);
    });
    await page.goto('/index.html', { waitUntil: 'load' });
    await composed(page);
    await page.waitForFunction(
      () => performance.getEntriesByType('resource').some((e) => e.name.includes('mountains')),
      null,
      { timeout: 20_000 }
    );

    const vp = page.viewportSize()!;
    const portrait = vp.width / vp.height < 1;
    const terrain = models.find((m) => m.includes('mountains'));
    expect(terrain, 'a terrain composition should have been requested').toBeTruthy();

    if (portrait) {
      expect(terrain).toContain('mobile');
    } else {
      // The landscape case is the regression: a landscape phone scored +0.01 on
      // four device signals that all agree with each other, and loaded a
      // composition authored for 9:19.5 into a 2.19:1 frame. Only aspect
      // describes the frame, and the frame is what the compositions differ on.
      expect(terrain).toContain('desktop');
    }
    // Exactly one composition, ever. Two means the variant decision oscillated.
    expect(models.filter((m) => m.includes('mountains')).length).toBe(1);
  });

  test('a viewport height change does not re-fetch the terrain', async ({ page }) => {
    test.skip(!portraitOnly(page), 'portrait composition only');
    const models: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('.glb') && r.url().includes('mountains')) models.push(r.url());
    });
    await page.goto('/index.html', { waitUntil: 'load' });
    await composed(page);
    await page.waitForFunction(
      () => performance.getEntriesByType('resource').some((e) => e.name.includes('mountains')),
      null,
      { timeout: 20_000 }
    );
    const before = models.length;

    // A browser toolbar collapsing is a height change of roughly this size, and
    // it must not cross the hysteresis band. §12.3.
    const vp = page.viewportSize()!;
    await page.setViewportSize({ width: vp.width, height: vp.height + 60 });
    await page.waitForTimeout(600);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(600);

    expect(models.length, 'terrain re-fetched on a toolbar-sized resize').toBe(before);
  });
});

// =============================================================================
// §23 — scroll
// =============================================================================

test.describe('scroll', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!portraitOnly(page), 'portrait composition only');
    await page.goto('/index.html', { waitUntil: 'load' });
    await composed(page);
  });

  test('nothing scrolls the document on the page\'s behalf', async ({ page }) => {
    // Scroll hijacking, measured rather than asserted from the source: park at
    // a position, do nothing, and require the document to still be there. A
    // snap, an inertia replacement or a programmatic correction all show up here.
    await goToStage(page, 'lower-atmosphere');
    const settled = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => window.scrollY);
    expect(Math.abs(after - settled)).toBeLessThanOrEqual(1);
  });

  test('copy stops when the finger does', async ({ page }) => {
    await goToStage(page, 'process');
    // A flick, then sample the copy's own transform while the scroll position
    // is provably constant. Before the fix this kept travelling 336px over
    // 400ms after scrollY had stopped changing — document text sliding under a
    // stationary reader.
    const y = await page.evaluate(() => window.scrollY);
    await page.evaluate((from) => window.scrollTo({ top: from + 600, behavior: 'instant' }), y);

    const readTransform = () =>
      page.evaluate(() => {
        const inner = document.querySelector<HTMLElement>(
          '.panel[data-stage="process"] .panel__band-inner'
        );
        if (!inner) return 0;
        const t = getComputedStyle(inner).transform;
        return t === 'none' ? 0 : Number(t.split(',')[5]?.replace(')', '')) || 0;
      });

    // Two frames, so the tick has published `--stage-flow` for the *new* scroll
    // position before the first sample. Reading immediately after `scrollTo`
    // samples the previous position's transform, and the difference then
    // measures the scroll itself rather than any drift after it — which reads
    // as a 1 212px failure on a page that is behaving correctly.
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    );
    const first = await readTransform();
    await page.waitForTimeout(250);
    const second = await readTransform();
    // 4px of slack for one frame of the browser's own scroll/paint sync. The
    // failure mode is hundreds.
    expect(Math.abs(second - first)).toBeLessThanOrEqual(4);
  });

  test('scrolling back restores the previous stage', async ({ page }) => {
    await goToStage(page, 'system');
    const forward = await page.evaluate(() => document.documentElement.dataset.meridian);
    await goToStage(page, 'selected-work');
    await goToStage(page, 'system');
    const back = await page.evaluate(() => document.documentElement.dataset.meridian);
    expect(back).toBe(forward);
  });
});
