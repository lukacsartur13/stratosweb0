// =============================================================================
// The service routes: information must be readable when it is meant to be read,
// and the scroll must move the design when the reader expects it to move.
//
// WHAT THIS FILE CONTRACTS
//
// Two defect families were found on the public secondary routes and repaired at
// their root. Both were invisible to the existing suite because both are about
// COMPOSITION rather than structure: the markup was correct throughout, and a
// page whose every heading is present and correctly nested can still render
// that heading in black on a near-black card.
//
//   A. A component that paints its own background must state its own
//      foreground. `.panel` and `.card` set `background: var(--ink)` and said
//      nothing about colour, so inside `.band--pale` — which flips the section
//      to ink-on-paper and then re-states each text role as a descendant rule —
//      they inherited the pale band's black. Measured 1.07 to 1.10 : 1 on the
//      Impact cause cards, their chips, and the Google Ads checklist.
//
//   B. `--signal` is 1.09 : 1 against `--paper`. It was carrying words on pale
//      bands — the open FAQ question, the build step names, the section
//      numerals, the accent word inside a headline.
//
// And one timing defect: a pinned section is only readable while its pin is
// stuck, so progress normalised over the section's full height spent its last
// `pinHeight / height` advancing after the pin had let go. The third build
// stage got 5.6% of its own pinned window.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It does not assert colours. A contract that spells `rgb(110, 98, 0)` breaks
// the next time the accent is tuned and proves nothing about legibility in the
// meantime. Every assertion here is a measured contrast ratio against the
// composited background, which is the property that actually matters and the
// one that was wrong.
//
// It does not assert pixel positions or scroll offsets. The timing contract is
// expressed as a share of the pinned window, which is scale-free and therefore
// true at 1280x800 and 1920x1080 alike.
//
// It does not assert that decorative text is readable. §6 of the brief allows
// atmospheric typography to stay quiet, and the altimeter tape is exactly that:
// `.rail` is `aria-hidden` and `pointer-events: none`, its labels are generated
// decoration, and they are excluded here on purpose rather than by omission.
// =============================================================================
import { test, expect, type Page } from '@playwright/test';
import { enableReducedMotion } from './helpers/reduced-motion';

/* Composite a foreground over its real background and return the WCAG ratio.
   The background has to be composited rather than read, because these surfaces
   stack translucent colours — `rgba(244,244,244,.78)` on `var(--ink)` inside a
   `.band--pale` is three layers before it is a colour. */
type Rgb = { r: number; g: number; b: number; a: number };
type Reading = { ratio: number; color: string; size: number; weight: number };

/* Runs in the page, so it closes over nothing and is serialised whole. */
function measure(el: Element): Reading {
  const px = (s: string): Rgb | null => {
    const m = String(s).match(/[\d.]+/g);
    if (!m) return null;
    return { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 };
  };
  const over = (f: Rgb, b: Rgb): Rgb => ({
    r: f.r * f.a + b.r * (1 - f.a),
    g: f.g * f.a + b.g * (1 - f.a),
    b: f.b * f.a + b.b * (1 - f.a),
    a: 1,
  });
  const lum = (c: Rgb) => {
    const f = (v: number) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const bgOf = (start: Element): Rgb => {
    const stack: Rgb[] = [];
    let n: Element | null = start;
    while (n && n.nodeType === 1) {
      const c = px(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
      n = n.parentElement;
    }
    let base: Rgb = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };

  const cs = getComputedStyle(el);
  const fg = px(cs.color) ?? { r: 0, g: 0, b: 0, a: 1 };
  const bg = bgOf(el);
  const [hi, lo] = [lum(over(fg, bg)), lum(bg)].sort((m, n) => n - m);
  return {
    ratio: +((hi + 0.05) / (lo + 0.05)).toFixed(2),
    color: cs.color,
    size: parseFloat(cs.fontSize),
    weight: Number(cs.fontWeight) || 400,
  };
}

const read = (page: Page, selector: string, nth = 0): Promise<Reading> =>
  page.locator(selector).nth(nth).evaluate(measure);

/**
 * Read a colour that has stopped moving.
 *
 * `.faq summary` carries `transition: color .3s`, so the instant after a click
 * its computed colour is somewhere between the two states. Reading there is how
 * this file first "passed" against the unrepaired stylesheet: it caught the
 * open question at almost-black on its way to yellow and called it legible.
 * A settled state is the only one worth asserting about — §5 is about what the
 * reader ends up looking at.
 */
async function readSettled(page: Page, selector: string, nth = 0): Promise<Reading> {
  let last = '';
  for (let i = 0; i < 40; i++) {
    const r = await read(page, selector, nth);
    if (r.color === last) return r;
    last = r.color;
    await page.waitForTimeout(50);
  }
  throw new Error(`${selector} never settled on a colour (last was ${last})`);
}

/**
 * The motion system has decided.
 *
 * `motion.js` sets `motion-ready` on the root as the first thing `boot()` does,
 * after `load` — and until it has, `[data-stage-item]` is still wearing the
 * pre-reveal `opacity: 0` that motion.css gives it, mid-transition on its way
 * to wherever it is going. Reading a settled state before that marker exists
 * measures the page shrugging, not the page. It is the same readiness idiom the
 * homepage suite uses with `window.Stratos.header`, for the same reason.
 */
const motionReady = (page: Page) =>
  page.waitForFunction(() => document.documentElement.classList.contains('motion-ready'),
    null, { timeout: 15_000 });

/**
 * The document has stopped growing.
 *
 * Every geometry assertion below is taken against `[data-stage]`'s box and the
 * scroll range around it, and both move while late images and web fonts land.
 * Measuring first and scrolling afterwards then walks a range that no longer
 * exists — which showed up as a pinned window that was never entered at all,
 * `dwell.size === 0`, only under parallel load. Four equal samples rather than
 * two, for the reason homepage-chrome.spec.ts gives at length: one repeat is
 * not rest when the quantity is eased.
 */
async function settled(page: Page) {
  let last = -1, same = 0;
  for (let i = 0; i < 80 && same < 4; i++) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    same = h === last ? same + 1 : 0;
    last = h;
    if (same < 4) await page.waitForTimeout(100);
  }
  expect(same, 'the document never stopped growing').toBeGreaterThanOrEqual(4);
}

/** WCAG AA for the size the text is actually rendered at. */
const floorFor = (r: Reading) => (r.size >= 24 || (r.size >= 18.66 && r.weight >= 700) ? 3 : 4.5);

const readable = (r: Reading, what: string) => {
  expect(r.ratio, `${what} measured ${r.ratio}:1 in ${r.color} at ${r.size}px`)
    .toBeGreaterThanOrEqual(floorFor(r));
};

// -----------------------------------------------------------------------------
// A. Dark surfaces that sit inside a light section.
// -----------------------------------------------------------------------------

/* Both routes place a `.panel` inside `.band--pale`, which is the exact
   configuration that produced black-on-black, and both do it in all three
   locales. Asserted per locale because the defect was never language-specific
   but the fix has to reach the generated pages, not just the Hungarian source. */
const DARK_ISLANDS = [
  { route: '/impact-program.html', lang: 'hu' },
  { route: '/en/impact-program.html', lang: 'en' },
  { route: '/de/impact-programm.html', lang: 'de' },
  { route: '/hirdeteskezeles.html', lang: 'hu' },
  { route: '/en/ads-management.html', lang: 'en' },
  { route: '/de/werbeanzeigen.html', lang: 'de' },
];

for (const { route, lang } of DARK_ISLANDS) {
  test(`a dark card in a light section keeps its own text colour (${lang}, ${route})`, async ({ page }) => {
    await page.goto(route);
    const card = page.locator('.band--pale .panel:not(.panel--lit)').first();
    await expect(card, 'this route is supposed to have a dark card on a pale band').toHaveCount(1);
    await card.scrollIntoViewIfNeeded();

    // The title is the thing that read as black-on-black.
    readable(await read(page, '.band--pale .panel:not(.panel--lit) h3'), `${route} card title`);

    // And every text role the pale band overrides, which is how the chips and
    // the checklist went with it. Each is only present on one of the two
    // routes; whichever is here has to be readable.
    for (const role of ['p', '.checks li', '.tags span', '.card__k']) {
      const sel = `.band--pale .panel:not(.panel--lit) ${role}`;
      const n = await page.locator(sel).count();
      for (let i = 0; i < n; i++) readable(await read(page, sel, i), `${route} ${role}[${i}]`);
    }
  });
}

test('the yellow card beside it is untouched and still yellow', async ({ page }) => {
  // §21: the two cards must not become the same card. The repair had to leave
  // the black/yellow comparison intact, and `.panel--lit` is a genuinely light
  // surface that wants the pale band's ink — so it is excluded from the island
  // rules rather than swept up by them.
  await page.goto('/hirdeteskezeles.html');
  const lit = page.locator('.panel--lit').first();
  await expect(lit).toHaveCount(1);
  await lit.scrollIntoViewIfNeeded();

  const bg = await lit.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg, 'the Meta card is the signal-yellow surface').toMatch(/255,\s*238,\s*37/);

  for (const role of ['h3', 'p', '.checks li', '.card__k']) {
    const n = await page.locator(`.panel--lit ${role}`).count();
    for (let i = 0; i < n; i++) readable(await read(page, `.panel--lit ${role}`, i), `Meta card ${role}[${i}]`);
  }
});

test('a dark select on a pale form does not render black on black', async ({ page }) => {
  // Found by the same sweep and easy to miss: `.field select option` painted a
  // dark background and inherited the pale section's ink, at 1.10 : 1 — on a
  // control, where being unable to read the choices is the whole failure.
  await page.goto('/impact-program.html');
  const opt = page.locator('.field select option').first();
  if (await opt.count() === 0) test.skip(true, 'no select on this route');
  readable(await read(page, '.field select option'), 'select option');
});

// -----------------------------------------------------------------------------
// B. The FAQ. The active state is a mark, not a colour on the question.
// -----------------------------------------------------------------------------

test.describe('the FAQ on a pale band', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/hirdeteskezeles.html');
    await page.locator('.faq details').first().scrollIntoViewIfNeeded();
  });

  test('the question is readable closed, hovered and open', async ({ page }) => {
    const sum = page.locator('.faq summary').first();

    readable(await readSettled(page, '.faq summary'), 'closed question');

    // §5: hovering must never be what makes text legible — and here it used to
    // be what made it illegible, which is the same rule broken the other way.
    await sum.hover();
    readable(await readSettled(page, '.faq summary'), 'hovered question');

    await sum.click();
    await expect(page.locator('.faq details').first()).toHaveAttribute('open', '');
    readable(await readSettled(page, '.faq summary'), 'OPEN question');
    readable(await readSettled(page, '.faq .faq__a'), 'the answer');
  });

  test('opening still says, unmistakably, which entry is open', async ({ page }) => {
    // The signal moved off the words and onto the two things that are state and
    // carry none: the mark at the end of the row, and the rule under the entry.
    // Asserted as "these three properties change", not as a colour value.
    const det = page.locator('.faq details').first();
    const sum = det.locator('summary');

    const read = () => sum.evaluate((el) => ({
      mark: getComputedStyle(el, '::after').backgroundImage,
      spin: getComputedStyle(el, '::after').transform,
      rule: getComputedStyle(el.parentElement as Element).borderBottomColor,
    }));

    /* Settled, not immediate — the same reason `readSettled` exists above.
       All three of these properties are transitioned: the mark's background
       over .3s, its transform over .4s. Read the frame after the click and you
       are sampling the animation rather than the state it is animating to, and
       whether that frame has moved yet depends on how busy the machine is.
       Measured on mobile-390: three runs in a row read the mark still at its
       closed value while `[open]` was already on the element. Polling until the
       value stops changing is what the sibling test does with colour. */
    const settledSnapshot = async () => {
      let last = '';
      for (let i = 0; i < 40; i++) {
        const r = await read();
        const key = `${r.mark}|${r.spin}|${r.rule}`;
        if (key === last) return r;
        last = key;
        await page.waitForTimeout(50);
      }
      throw new Error('the FAQ mark never settled');
    };

    const closed = await settledSnapshot();
    await sum.click();
    await expect(det).toHaveAttribute('open', '');
    const open = await settledSnapshot();

    expect(open.mark, 'the mark takes the accent when the entry opens').not.toBe(closed.mark);
    expect(open.spin, 'the mark rotates from + to x').not.toBe(closed.spin);
    expect(open.rule, 'an open entry is bracketed by an accent rule').not.toBe(closed.rule);
  });

  test('the same accordion on a DARK band keeps the full signal', async ({ page }) => {
    // Both branches of `--faq-accent` are live in production: kkv, nagyvallalat
    // and hirdeteskezeles put the FAQ on a pale band, rolunk and impact-program
    // on a dark one. On dark, `--signal` is 15.86 : 1 and needs no substitute,
    // so the accent stays the brand yellow exactly as before.
    await page.goto('/rolunk.html');
    const det = page.locator('.faq details').first();
    await det.scrollIntoViewIfNeeded();
    const sum = det.locator('summary');

    readable(await readSettled(page, '.faq summary'), 'closed question on dark');
    await sum.click();
    await expect(det).toHaveAttribute('open', '');
    readable(await readSettled(page, '.faq summary'), 'open question on dark');
    readable(await readSettled(page, '.faq .faq__a'), 'answer on dark');

    const accent = await sum.evaluate((el) => ({
      mark: getComputedStyle(el, '::after').backgroundImage,
      rule: getComputedStyle(el.parentElement as Element).borderBottomColor,
    }));
    expect(accent.mark, 'the mark is signal yellow on a dark band').toMatch(/255,\s*238,\s*37/);
    expect(accent.rule, 'so is the rule under the open entry').toMatch(/255,\s*238,\s*37/);
  });

  test('it is operable and legible from the keyboard alone', async ({ page }) => {
    const sum = page.locator('.faq summary').first();
    await sum.focus();

    // A real focus ring, not `outline: none` and not a ring the pale band
    // swallows — the global ring is signal yellow, which is 1.09 : 1 on paper.
    const ring = await sum.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { visible: el.matches(':focus-visible'), style: cs.outlineStyle, width: cs.outlineWidth };
    });
    expect(ring.visible, 'a focused summary is :focus-visible').toBe(true);
    expect(ring.style, 'the focus ring is drawn').not.toBe('none');
    expect(parseFloat(ring.width)).toBeGreaterThan(0);

    await page.keyboard.press('Enter');
    await expect(page.locator('.faq details').first()).toHaveAttribute('open', '');
    readable(await readSettled(page, '.faq summary'), 'question opened by keyboard');
    readable(await readSettled(page, '.faq .faq__a'), 'answer opened by keyboard');
  });
});

// -----------------------------------------------------------------------------
// C. Scroll-driven states reach their intended active state, and in time.
// -----------------------------------------------------------------------------

const STAGED = ['/kkv.html', '/nagyvallalat.html'];

for (const route of STAGED) {
  test(`every build stage gets a fair share of the pinned window (${route})`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'reduced-motion', 'the pin is released under reduced motion; covered below');
    await page.goto(route);
    await motionReady(page);
    await settled(page);

    const geo = await page.evaluate(() => {
      const el = document.querySelector('[data-stage]') as HTMLElement;
      const pin = el.querySelector('.stage__pin') as HTMLElement;
      return {
        docTop: Math.round(el.getBoundingClientRect().top + scrollY),
        height: Math.round(el.getBoundingClientRect().height),
        pinH: Math.round(pin.getBoundingClientRect().height),
        stages: el.querySelectorAll('[data-stage-item]').length,
        sticky: getComputedStyle(pin).position,
      };
    });
    // Below 860 the sequence is authored as a stacked list instead — a
    // different, and correct, design rather than a broken pin.
    test.skip(geo.sticky !== 'sticky', 'this width renders the sequence as flowed text');

    // Walk the section and record which stage is live while the pin is stuck.
    const dwell = new Map<string, number>();
    let unpinnedProgress = 0, samples = 0, pinnedSamples = 0;
    const STEP = 40;
    for (let y = Math.max(0, geo.docTop - 200); y <= geo.docTop + geo.height; y += STEP) {
      // Scroll and read in ONE round trip, with two frames between them. The
      // driver is a rAF loop, so a read scheduled by a separate `evaluate` is
      // racing it: under parallel load the reply can arrive before the tick
      // that acts on the new position, and the sample lands on the previous
      // stage. Waiting for two frames in-page removes the race rather than
      // hoping the machine is fast — an earlier draft of this file was green
      // alone and red in a full run for exactly that reason.
      const s = await page.evaluate(async (v) => {
        // `behavior: 'instant'` because main.css sets `scroll-behavior: smooth`
        // on the root. A plain `scrollTo` starts an animation, and two frames
        // later the page has barely left where it was — 97 samples, none of
        // them pinned, and a contract that reported the section never pins.
        scrollTo({ top: v, behavior: 'instant' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const el = document.querySelector('[data-stage]') as HTMLElement;
        const pin = el.querySelector('.stage__pin') as HTMLElement;
        const r = el.getBoundingClientRect(), pr = pin.getBoundingClientRect();
        return {
          at: el.dataset.stageAt ?? '?',
          p: Number(getComputedStyle(el).getPropertyValue('--stage-p')) || 0,
          pinned: Math.abs(pr.top) < 2 && r.top <= 1 && r.bottom >= pr.height - 1,
        };
      }, y);
      samples++;
      if (s.pinned) { pinnedSamples++; dwell.set(s.at, (dwell.get(s.at) ?? 0) + STEP); }
      else if (s.p > 0 && s.p < 1) unpinnedProgress += STEP;
    }

    // Every stage is reached, and reached while it can still be read.
    expect(dwell.size,
      `every stage becomes the live one while pinned — geo=${JSON.stringify(geo)} ` +
      `samples=${samples} pinnedSamples=${pinnedSamples} dwell=${JSON.stringify([...dwell])}`,
    ).toBe(geo.stages);

    const total = [...dwell.values()].reduce((a, c) => a + c, 0);
    const fair = 1 / geo.stages;
    for (const [at, px] of dwell) {
      // Half a fair share is the contract. The defect gave the last stage 5.6%
      // of a 33% share; the repair gives each an even third. A generous floor
      // keeps this true under sampling noise and future re-authoring of the
      // section's height, and still fails the bug by a wide margin.
      expect(px / total, `stage ${at} is readable for ${(100 * px / total).toFixed(1)}% of the pinned window`)
        .toBeGreaterThan(fair / 2);
    }

    // And nothing advances after the pin lets go: the section is one viewport
    // taller than its travel so that viewport can HOLD the end state.
    expect(unpinnedProgress, 'progress keeps advancing after the pin released').toBeLessThanOrEqual(STEP);
  });
}

test('the services rail finishes its travel before it comes unstuck', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'reduced-motion', 'the rail is static under reduced motion');
  await page.goto('/szolgaltatasok.html');
  await motionReady(page);
  await settled(page);

  const geo = await page.evaluate(() => {
    const el = document.querySelector('[data-rail]') as HTMLElement;
    const pin = el.querySelector('.rail__pin') as HTMLElement;
    return {
      docTop: Math.round(el.getBoundingClientRect().top + scrollY),
      height: Math.round(el.getBoundingClientRect().height),
      travel: Number(getComputedStyle(el).getPropertyValue('--rail-travel').replace('px', '')) || 0,
      static: el.classList.contains('is-static'),
      panels: el.querySelectorAll('[data-rail-panel]').length,
    };
  });
  test.skip(geo.static || geo.travel === 0, 'the rail is a vertical list at this width');

  let atRelease = 0, lastPanel = '0';
  for (let y = Math.max(0, geo.docTop - 200); y <= geo.docTop + geo.height; y += 40) {
    // Same single round trip with two frames as the stage loop above.
    const s = await page.evaluate(async (v) => {
      scrollTo({ top: v, behavior: 'instant' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const el = document.querySelector('[data-rail]') as HTMLElement;
      const pin = el.querySelector('.rail__pin') as HTMLElement;
      const track = el.querySelector('[data-rail-track]') as HTMLElement;
      const r = el.getBoundingClientRect(), pr = pin.getBoundingClientRect();
      const m = /translate3d\(([-\d.]+)px/.exec(track.style.transform);
      return {
        x: m ? Math.abs(+m[1]) : 0,
        at: el.dataset.railAt ?? '0',
        pinned: Math.abs(pr.top) < 2 && r.top <= 1 && r.bottom >= pr.height - 1,
      };
    }, y);
    if (s.pinned) { atRelease = s.x; lastPanel = s.at; }
  }

  // It used to reach 55–66% and panel 2 of 4 before the section let go, so the
  // last panels only ever appeared while the whole thing was scrolling away.
  expect(atRelease / geo.travel, 'share of the rail travelled while still pinned')
    .toBeGreaterThan(0.9);
  expect(Number(lastPanel), 'the last panel is reached while the rail is still pinned')
    .toBe(geo.panels - 1);
});

// -----------------------------------------------------------------------------
// D. Reduced motion gets the readable settled state, not the dim one.
// -----------------------------------------------------------------------------

/* NOT `test.use({ reducedMotion })`. tests/helpers/reduced-motion.ts documents
   why: the declarative option does not reliably reach `matchMedia()` on
   Playwright 1.62.1 in this project, and a reduced-motion test that quietly ran
   the animated path is worse than no test because it gets cited as evidence.
   This block was written with the declarative option first and did exactly
   that — it measured a stage mid-transition at 0.599 opacity and read it as a
   reduced-motion defect. The helper emulates it and then PROVES it took. */
test.describe('reduced motion', () => {
  for (const route of STAGED) {
    test(`every stage of the sequence is present and readable (${route})`, async ({ page }) => {
      const verify = await enableReducedMotion(page);
      await page.goto(route);
      await verify();
      await motionReady(page);
      const stages = page.locator('[data-stage-item]');
      const n = await stages.count();
      expect(n).toBeGreaterThan(1);

      for (let i = 0; i < n; i++) {
        const s = stages.nth(i);
        // §35: nothing may be left in a pre-reveal state that only scroll clears.
        await expect(s, `stage ${i} is shown`).toBeVisible();
        expect(await s.evaluate((el) => getComputedStyle(el).opacity), `stage ${i} opacity`).toBe('1');
        // And present to assistive technology — all of them are on screen at
        // once here, so none of them is a duplicate of a slot.
        expect(await s.getAttribute('aria-hidden'), `stage ${i} aria-hidden`).not.toBe('true');
        readable(await read(page, '[data-stage-item] .build__k', i), `${route} stage ${i} label`);
      }
    });
  }

  test('the dark cards and the FAQ are readable without any scrolling at all', async ({ page }) => {
    const verify = await enableReducedMotion(page);
    await page.goto('/hirdeteskezeles.html');
    await verify();
    await motionReady(page);
    readable(await read(page, '.band--pale .panel:not(.panel--lit) h3'), 'card title under reduced motion');
    readable(await read(page, '.band--pale .panel:not(.panel--lit) .checks li'), 'checklist under reduced motion');
    await page.locator('.faq summary').first().click();
    readable(await readSettled(page, '.faq summary'), 'open question under reduced motion');
  });
});

// -----------------------------------------------------------------------------
// E. The repair changed colour and timing, and nothing else.
// -----------------------------------------------------------------------------

const REPAIRED = [
  '/impact-program.html', '/hirdeteskezeles.html', '/szolgaltatasok.html',
  '/kkv.html', '/nagyvallalat.html', '/munkaink.html', '/ugyfelszolgalat.html',
];

for (const route of REPAIRED) {
  test(`${route} still fits its viewport sideways`, async ({ page }) => {
    await page.goto(route);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, 'typography corrections must not introduce a sideways scroll').toBeLessThanOrEqual(1);
  });
}

test('the repaired routes keep their section order', async ({ page }) => {
  // Cheap insurance for §38: this was a colour and timing repair, so the
  // sequence of bands on the page is not something it may have moved.
  await page.goto('/hirdeteskezeles.html');
  const bands = await page.evaluate(() =>
    [...document.querySelectorAll('section')].map((s) => s.className.trim()));
  expect(bands).toEqual([
    'phead', 'band band--tight', 'band', 'band band--pale', 'band',
    'band band--tight', 'band band--tight', 'band band--tight',
    'band band--pale', 'band band--tight', 'band', 'arrival',
  ]);
});
