import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { enableReducedMotion } from '../../tests/helpers/reduced-motion';
import { ACTS, INSTRUMENT, MONUMENT, PASSAGE, PASSAGES, YELLOW, actOf, levelOf } from '../src/full/acts';
import { STAGES } from '../src/full/journey';
import { MESSAGES } from '../src/full/locales/messages';
import { SCENE } from '../src/full/scene';
import { COLLABORATIONS, FEATURED_CASE_ID, WORK } from '../src/full/content';
import { bootJourneyOnLoad } from '../../tests/helpers/homepage';
// This file measures both routes: the prototype at
// /experiments/stratos-ascent-full/, which mounts on load and always has, and
// the three locale homepages, which do not — see `bootJourneyOnLoad`. Arming it
// for every navigation gives the homepage a visitor who has moved, and costs
// the prototype a dispatched event nothing is listening for.
test.beforeEach(async ({ page }) => {
  await bootJourneyOnLoad(page);
});


/**
 * THE SIX-ACT DESIGN, AS CONTRACTS. §51 of the production brief.
 *
 * Eleven things the approved art direction says are true, written so that the
 * design cannot decay back into the one it replaced without a test going red.
 *
 * ## Why these and not screenshots
 *
 * §47 is explicit that the master-frame comparison is an optical judgement and
 * not a pixel diff, and it is right — a reference-image suite over a live
 * WebGL scene is a suite that fails on a driver update. What is left after that
 * are the properties a picture cannot express and a selector can: an altitude
 * that never decreases, an object that is genuinely not in a frame rather than
 * merely faint, a figure that is still the figure `content.ts` names, a
 * statement that has not been re-broken by a browser.
 *
 * ## Why they are derived rather than transcribed
 *
 * Every expectation below is read from the same tables the page renders from —
 * `acts.ts`, `journey.ts`, `scene.ts`, `content.ts`, `messages.ts`. A test that
 * repeated the numbers would pass a design that had drifted away from its own
 * source of truth, which is the failure mode a design system is for.
 */

/** Where a peak act's frame is settled: 0.4 of a screen into its hold. */
const SETTLE = 0.4;

/**
 * NOTHING IN THIS FILE READS `__stratos`, AND THAT IS THE POINT.
 *
 * The development handle is compiled out of production on purpose, and this
 * suite runs against the built route — so the first version of this file, which
 * asked the scene graph for the instrument's projected silhouette, timed out on
 * every test waiting for a global that a production build correctly does not
 * have.
 *
 * What replaces it is what the page publishes to its own stylesheet once a
 * frame: `--alt` for the altitude and `--instrument` for the appearance budget.
 * Both are real composition values with real consumers rather than test hooks,
 * and reading the design's own published state is a stricter question than
 * reaching into the renderer anyway — it asks what the PAGE thinks is true.
 */
async function ready(page: Page) {
  await page.goto('./');
  await page.evaluate(() => document.fonts.ready);
  // The composition publisher's first pass, which is what puts `--alt` and
  // `--instrument` on the root. It runs on the journey clock's first tick.
  await page.waitForFunction(
    () => getComputedStyle(document.documentElement).getPropertyValue('--instrument').trim() !== '',
    { timeout: 30_000 },
  );
  // The damped clock, the damped lighting and the GLB decode.
  await page.waitForTimeout(2600);
}

/** The altitude the page is publishing, in metres. */
const metresNow = (page: Page) =>
  page.evaluate(
    () => Number(getComputedStyle(document.documentElement).getPropertyValue('--alt')) * 30_000,
  );

/** How much of the instrument is in the picture, 0..1, as the page states it. */
const presenceNow = (page: Page) =>
  page.evaluate(() =>
    Number(getComputedStyle(document.documentElement).getPropertyValue('--instrument')),
  );

async function settleOn(page: Page, stage: string, at = SETTLE) {
  await page.evaluate(
    ([id, fraction]) => {
      // `.panel[data-stage]`, not `[data-stage]`: the HUD publishes the stage
      // it is reading and carries the same attribute, earlier in the document.
      const panel = document.querySelector(`.panel[data-stage="${id}"]`) as HTMLElement;
      scrollTo({ top: panel.offsetTop + (fraction as number) * innerHeight, behavior: 'instant' });
    },
    [stage, at] as const,
  );
  await page.waitForTimeout(2400);
}

// =============================================================================
test.describe('the six-act art direction', () => {
  // ---------------------------------------------------------------------------
  // 1 · THE ALTITUDE NEVER DECREASES THROUGH THE JOURNEY.
  //
  // The first blocker the production brief names, and the one the master study
  // left open: the acts as grouped ran Noise at 6 000–8 500 m before System at
  // 3 000–6 000 m, so the six acts descended 2 500 m between the second and the
  // third. It is asserted twice — once against the map, which is cheap and
  // catches a re-mapping, and once against the running page, which catches the
  // map being right and the scroll being wrong.
  // ---------------------------------------------------------------------------
  test('the acts run in strictly increasing altitude @smoke', async ({ page }) => {
    const order = STAGES.map((s) => s.id);
    const peaks = ACTS.map((a) => a.peak);
    const positions = peaks.map((p) => order.indexOf(p));
    for (let i = 1; i < positions.length; i++) {
      expect(
        positions[i],
        `act ${ACTS[i].numeral} (${peaks[i]}) must come after act ${ACTS[i - 1].numeral}`,
      ).toBeGreaterThan(positions[i - 1]);
    }

    const floors = peaks.map((p) => STAGES.find((s) => s.id === p)!.from);
    for (let i = 1; i < floors.length; i++) {
      expect(
        floors[i],
        `act ${ACTS[i].numeral} starts below act ${ACTS[i - 1].numeral}`,
      ).toBeGreaterThanOrEqual(floors[i - 1]);
    }

    await ready(page);
    let previous = -1;
    for (const act of ACTS) {
      await settleOn(page, act.peak);
      const metres = await metresNow(page);
      expect(
        metres,
        `act ${act.numeral} reads ${Math.round(metres)} m, below the act before it`,
      ).toBeGreaterThan(previous);
      previous = metres;
    }
  });

  // ---------------------------------------------------------------------------
  // 2 · THE ALTIMETER IS NOT IN THE FRAMES IT IS NOT IN.
  //
  // §32's appearance budget, asserted as absence rather than as faintness. The
  // silhouette is measured off the live scene graph and projected through the
  // real camera, so "absent" means the object contributes no pixels — not that
  // it is small, not that it is at 8% opacity, not that it is behind something.
  // ---------------------------------------------------------------------------
  test('the instrument is absent from every act that does not budget one', async ({ page }) => {
    await ready(page);
    for (const act of ACTS) {
      await settleOn(page, act.peak);
      const presence = await presenceNow(page);
      if (INSTRUMENT[act.id]) continue;
      expect(
        presence,
        `act ${act.numeral} budgets no instrument and the page reports ${presence} of one`,
      ).toBeLessThan(0.05);
    }
  });

  // ---------------------------------------------------------------------------
  // 2b · THE INTENTIONAL-DEPTH CONTRACT. §45, §46.
  //
  // The old contract was "the instrument never overlaps type", and the depth
  // proof breaks it on purpose for exactly one pair. What replaces it has to be
  // narrower than "overlap is allowed now", or the suite stops protecting the
  // thing it was written to protect — so this asserts BOTH halves:
  //
  //   permitted  an act that declares `occlusion: 'monument'` publishes a mask,
  //              and the mask stands in front of that act's Monument
  //   forbidden  in the same frame, the mask touches nothing else — not the
  //              support line, not the index, not the action, not the routes —
  //              and an act that declares nothing publishes no mask at all
  //
  // Read off the page's own published `--occl-*`, which is the geometry the
  // stylesheet is actually cutting with. A test that recomputed the ellipse
  // would be asserting that the same arithmetic can be written twice.
  // ---------------------------------------------------------------------------
  test('the object stands in front of the statement and in front of nothing else', async ({ page }) => {
    await ready(page);
    const covering: [string, number][] = [];
    for (const act of ACTS) {
      await settleOn(page, act.peak);
      const declared = INSTRUMENT[act.id]?.occlusion === 'monument';

      const frame = await page.evaluate((id) => {
        const root = getComputedStyle(document.documentElement);
        const n = (k: string) => Number(root.getPropertyValue(k));
        const occl = { on: n('--occl'), x: n('--occl-x'), y: n('--occl-y'), rx: n('--occl-rx'), ry: n('--occl-ry') };
        const panel = document.querySelector(`.panel[data-act="${id}"]`) as HTMLElement | null;
        const field = panel?.querySelector('.act__field') as HTMLElement | null;
        const hits: Record<string, number> = {};
        if (field && occl.on > 0) {
          const f = field.getBoundingClientRect();
          const u = f.width / 1440;
          for (const el of field.querySelectorAll('[class*="act__"]')) {
            const key = [...el.classList].find((c) => c.startsWith('act__') && c !== 'act__field');
            if (!key || hits[key] !== undefined) continue;
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) continue;
            const b = [(r.x - f.x) / u, (r.y - f.y) / u, r.width / u, r.height / u];
            let inside = 0;
            let total = 0;
            for (let y = b[1]; y < b[1] + b[3]; y += 2) {
              for (let x = b[0]; x < b[0] + b[2]; x += 2) {
                total++;
                const dx = (x - occl.x) / occl.rx;
                const dy = (y - occl.y) / occl.ry;
                if (dx * dx + dy * dy <= 1) inside++;
              }
            }
            if (inside > 0) hits[key] = inside / Math.max(total, 1);
          }
        }
        return { occl, attr: panel?.dataset.occlusion ?? null, hits };
      }, act.id);

      expect(
        frame.attr === 'monument',
        `act ${act.numeral}: the panel's declaration disagrees with the placement table`,
      ).toBe(declared);

      if (!declared) {
        expect(frame.occl.on, `act ${act.numeral} declares no occlusion and publishes a mask`).toBe(0);
        continue;
      }

      expect(frame.occl.on, `act ${act.numeral} declares occlusion and publishes no mask`).toBe(1);
      // The declaration is a PERMISSION, not a requirement — §46's property is
      // `none | monument`, and a locale whose authored line breaks keep the
      // statement clear of the object is exercising the permission by not using
      // it. So the overlap is recorded here and asserted once, below, over the
      // whole set: the system has to be demonstrably doing something somewhere,
      // and it must never do it anywhere it was not allowed to.
      covering.push([act.numeral, frame.hits.act__monument ?? 0]);

      // Everything else in the frame is in clear air. §25.
      const trespass = Object.entries(frame.hits).filter(([k]) => k !== 'act__monument');
      expect(
        trespass.map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`),
        `act ${act.numeral}: the object is in front of matter it was not authored to cover`,
      ).toEqual([]);
    }

    expect(
      covering.filter(([, v]) => v > 0.01).length,
      `no act in this locale puts the object in front of its statement: ${covering.map(([n, v]) => `${n} ${(v * 100).toFixed(0)}%`).join(', ')}`,
    ).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // 2c · THE READABILITY CONTRACT. §47.
  //
  // §47 is explicit that this must not collapse to one arbitrary percentage and
  // that a human protects the optical quality while the suite protects against
  // catastrophic obstruction. So the unit is the GLYPH — a `Range` per character
  // and its own rect against the published ellipse, which is what a reader
  // actually loses — and the three things asserted are the three ways a
  // statement stops being reconstructable:
  //
  //   a whole line survives      the phrase always has an intact anchor
  //   no line loses half itself  a line reduced past this is not occluded,
  //                              it is deleted
  //   most of the phrase stands  the total, as the backstop
  //
  // The optical question — does the edge fall THROUGH a letter rather than
  // between two words, so that the fragment reads as covered rather than as
  // short — is judged in §G and §H of the depth report, on the frames. It is not
  // assertable and it is the more important half.
  // ---------------------------------------------------------------------------
  test('an occluded statement keeps enough of itself to be read', async ({ page }) => {
    await ready(page);
    for (const act of ACTS) {
      if (INSTRUMENT[act.id]?.occlusion !== 'monument') continue;
      await settleOn(page, act.peak);

      const lines = await page.evaluate((id) => {
        const root = getComputedStyle(document.documentElement);
        const n = (k: string) => Number(root.getPropertyValue(k));
        const occl = { x: n('--occl-x'), y: n('--occl-y'), rx: n('--occl-rx'), ry: n('--occl-ry') };
        const field = document.querySelector(`.panel[data-act="${id}"] .act__field`) as HTMLElement;
        const mon = field.querySelector('.act__monument') as HTMLElement;
        const f = field.getBoundingClientRect();
        const u = f.width / 1440;
        const out: { text: string; hidden: number; glyphs: number; visible: string }[] = [];
        for (const sp of mon.querySelectorAll('span')) {
          const node = sp.firstChild;
          if (!node || node.nodeType !== 3) continue;
          const text = node.textContent ?? '';
          let hidden = 0;
          let visible = '';
          for (let i = 0; i < text.length; i++) {
            const rr = document.createRange();
            rr.setStart(node, i);
            rr.setEnd(node, i + 1);
            const r = rr.getBoundingClientRect();
            let covered = 0;
            if (r.width > 0 && r.height > 0) {
              const b = [(r.x - f.x) / u, (r.y - f.y) / u, r.width / u, r.height / u];
              let inside = 0;
              let total = 0;
              for (let y = b[1]; y < b[1] + b[3]; y += 2) {
                for (let x = b[0]; x < b[0] + b[2]; x += 2) {
                  total++;
                  const dx = (x - occl.x) / occl.rx;
                  const dy = (y - occl.y) / occl.ry;
                  if (dx * dx + dy * dy <= 1) inside++;
                }
              }
              covered = inside / Math.max(total, 1);
            }
            if (covered > 0.5) {
              hidden++;
              visible += '\u00b7';
            } else visible += text[i];
          }
          out.push({ text, hidden, glyphs: text.length, visible });
        }
        return out;
      }, act.id);

      expect(lines.length, `act ${act.numeral} has no authored lines to measure`).toBeGreaterThan(0);
      expect(
        lines.some((l) => l.hidden === 0),
        `act ${act.numeral}: every line of "${lines.map((l) => l.visible).join(' ')}" is broken into`,
      ).toBe(true);
      for (const line of lines) {
        expect(
          line.hidden / line.glyphs,
          `act ${act.numeral}: "${line.text}" reads as "${line.visible}"`,
        ).toBeLessThan(0.4);
      }
      const glyphs = lines.reduce((a, l) => a + l.glyphs, 0);
      const hidden = lines.reduce((a, l) => a + l.hidden, 0);
      expect(
        hidden / glyphs,
        `act ${act.numeral}: the statement reads as "${lines.map((l) => l.visible).join(' ')}"`,
      ).toBeLessThan(0.25);

      // AND THE STATEMENT KEEPS ITS OWN FULL STOP.
      //
      // The one rule the candidate frames produced that is not a percentage. A
      // sentence with letters missing from the middle of a word reads as
      // occluded — the reader completes it without noticing they did. A sentence
      // whose final punctuation is missing reads as BROKEN, because nothing
      // about the picture says a full stop was ever there, and the eye has
      // nothing to complete. It is also the cheapest possible failure to avoid:
      // it is decided by a few pixels of the placement's x.
      //
      // The rule is not "the last glyph must survive", and the candidate frames
      // are what corrected it. A statement whose final WORD is visibly cut does
      // not read as a sentence missing its full stop — it reads as a sentence
      // continuing behind an object, and the reader supplies both the letters
      // and the punctuation without noticing. `egy rendsz···` is that, and it
      // is right. What is wrong is `a görbületet` with the period alone taken:
      // there the word is whole, the sentence looks finished, and the missing
      // stop reads as a typographic mistake rather than as depth. One earlier
      // High Altitude candidate did exactly that, at a centre 40px to the left
      // of the authored one, which is how narrow the difference is.
      //
      // So: the last glyph may go, but only in the company of the one before it.
      const tail = lines[lines.length - 1];
      const lost = (n: number) => tail.visible.at(-n) !== tail.text.at(-n);
      expect(
        lost(1) && !lost(2),
        `act ${act.numeral}: the statement lost only its own full stop — "${tail.visible}"`,
      ).toBe(false);
    }
  });

  // ---------------------------------------------------------------------------
  // 3 · AND IT RETURNS AT THE ARRIVAL.
  //
  // The other half of the same budget, and the half a "nothing is visible"
  // check would pass by deleting the object. It has to be there, it has to be
  // near the size the study authored, and it has to be near where the study
  // put it.
  // ---------------------------------------------------------------------------
  test('the instrument returns at the arrival, on the acts\u2019 own grid', async ({ page }) => {
    await ready(page);
    for (const act of ACTS) {
      if (!INSTRUMENT[act.id]) continue;
      await settleOn(page, act.peak);
      const presence = await presenceNow(page);
      expect(
        presence,
        `act ${act.numeral} budgets an instrument and the page reports ${presence}`,
      ).toBeGreaterThan(0.9);
      await expect(page.locator('canvas'), `act ${act.numeral} has no scene`).toBeVisible();
    }

    // Recognisably the same object, and deliberately not the same appearance.
    // §31: completion, not repetition.
    const opening = INSTRUMENT.i!;
    const arrival = INSTRUMENT.vi!;
    expect(arrival.dial, 'the arrival must not be the opening again').toBeLessThan(opening.dial);
    expect(
      Math.abs(arrival.x - 720),
      'the arrival is the one centred frame in the design',
    ).toBeLessThan(24);

    // THE TYPE AND THE OBJECT ARE ON ONE GRID.
    //
    // The instrument's placement is solved in `composition.ts` from
    // `actFrame()`, and every letter on the frame is placed by `--u` in the
    // stylesheet. They are two expressions of `min(vw / 1440, vh / 900)`, and
    // the whole composition depends on them agreeing: a disagreement puts the
    // statement on one grid and the dial on another, and it is invisible at
    // 1440x900 because there both are exactly 1.
    for (const [w, h] of [
      [1440, 900],
      [1280, 800],
      [1024, 768],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(500);
      // MEASURED, NOT READ. `--u` is an unregistered custom property holding
      // `min(calc(100vw / 1440), calc(100svh / 900))`, and an unregistered
      // property's computed value is its token stream — `getPropertyValue`
      // hands back the expression, and `parseFloat` of that is NaN. Putting it
      // on a probe's width is what resolves it, and ×1000 keeps the precision
      // the comparison needs.
      const u = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;height:0;width:calc(1000 * var(--u))';
        document.body.appendChild(probe);
        const value = probe.getBoundingClientRect().width / 1000;
        probe.remove();
        return value;
      });
      const stage = await page.evaluate(() => {
        const r = document.querySelector('.journey__stage')!.getBoundingClientRect();
        return { w: r.width, h: r.height };
      });
      const want = Math.min(stage.w / 1440, stage.h / 900);
      expect(u, `${w}x${h}: the type grid and the instrument grid disagree`).toBeCloseTo(want, 2);
    }
  });

  // ---------------------------------------------------------------------------
  // 4 · RAPIDKERT IS THE SOLE FEATURED SUBSTANTIAL CASE.
  //
  // §27: the homepage does not expand into multiple case studies. Asserted from
  // `content.ts` in both directions — the featured case going missing is a
  // regression, and a second one appearing beside it is the regression this
  // architecture exists to prevent.
  // ---------------------------------------------------------------------------
  test('one featured case, and it is Rapidkert @smoke', async ({ page }) => {
    await ready(page);
    await expect(page.locator('[data-testid^="case-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="case-"]')).toHaveAttribute(
      'data-testid',
      `case-${FEATURED_CASE_ID}`,
    );
    for (const w of WORK.filter((c) => c.id !== FEATURED_CASE_ID)) {
      await expect(page.getByTestId(`case-${w.id}`), `${w.id} belongs on /work`).toHaveCount(0);
    }
    // Six marks, one line, no heading over them. §28.
    const marks = page.getByTestId('collaborations').locator('img');
    await expect(marks).toHaveCount(COLLABORATIONS.length);
    await expect(page.getByTestId('collaborations').locator('h1, h2, h3')).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------
  // 5 · THE FIGURE KEEPS ITS SOURCED MEANING.
  //
  // §11. `~15M Ft` is contracted project value from search — not revenue, not
  // profit, not ROAS, not attributed to advertising alone — and the label that
  // says so is `content.ts`'s, word for word, in all three locales.
  // ---------------------------------------------------------------------------
  test('the figure and its label are content.ts, word for word @smoke', async ({ page }) => {
    const featured = WORK.find((w) => w.id === FEATURED_CASE_ID)!;
    expect(featured.metric, 'the featured case is the one with a sourced figure').toBeTruthy();
    await ready(page);

    const figure = page.locator("[data-act='iv'] .act__monument--figure");
    await expect(figure).toHaveCount(1);
    await expect(figure).toHaveText(featured.metric!.value);

    const define = page.locator("[data-act='iv'] .act__editorial span");
    await expect(define).toHaveCount(2);
    await expect(define.nth(0)).toHaveText(featured.name);
    await expect(define.nth(1)).toHaveText(featured.metric!.label);
  });

  // ---------------------------------------------------------------------------
  // 6 · THE YELLOW BUDGET.
  //
  // §38: two events on the page, and four consecutive acts without any before
  // the first. Measured as painted area rather than as a count of elements
  // carrying the token, because a border, a fill and a glyph are three
  // different amounts of the same colour.
  // ---------------------------------------------------------------------------
  test('yellow appears where the budget says and nowhere else', async ({ page }) => {
    await ready(page);
    for (const act of ACTS) {
      await settleOn(page, act.peak);
      const signalled = await page.evaluate((id) => {
        const act = document.querySelector(`[data-act='${id}'] .act__field`);
        if (!act) return [];
        const yellow = (v: string) => /rgba?\(\s*25[0-9]|rgba?\(\s*255/.test(v) && /2[0-9][0-9]\s*,\s*[0-6]?[0-9]\s*\)?/.test(v);
        const out: string[] = [];
        for (const el of act.querySelectorAll('*')) {
          if (!(el.textContent ?? '').trim() && el.tagName !== 'IMG') continue;
          const cs = getComputedStyle(el);
          if (yellow(cs.color) || yellow(cs.backgroundColor))
            out.push((el.className || el.tagName).toString());
        }
        return out;
      }, act.id);

      if (YELLOW[act.id] === 'none') {
        expect(signalled, `act ${act.numeral} must carry no yellow`).toEqual([]);
      } else {
        expect(signalled.length, `act ${act.numeral} must carry its one yellow event`).toBeGreaterThan(0);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 7 · NO HORIZONTAL OVERFLOW, ANYWHERE ON THE TRACK.
  // ---------------------------------------------------------------------------
  test('the journey never overflows horizontally @smoke', async ({ page }) => {
    await ready(page);
    const bad = await page.evaluate(async () => {
      const track = document.querySelector('[data-testid="journey-track"]') as HTMLElement;
      const travel = track.offsetHeight - innerHeight;
      const out: number[] = [];
      for (let f = 0; f <= 1.0001; f += 0.02) {
        scrollTo({ top: track.offsetTop + travel * f, behavior: 'instant' as ScrollBehavior });
        await new Promise((r) => setTimeout(r, 40));
        const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        if (over > 1) out.push(Math.round(f * 100));
      }
      return out;
    });
    expect(bad, 'horizontal overflow, at these percentages of the track').toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // 8 · THE LOCALE-AUTHORED MONUMENT GEOMETRY RESOLVES.
  //
  // §20: equivalent authority, different geometry. Each act's statement is set
  // on the number of lines its own locale authored, at the size its own locale
  // was solved to, and no line has been re-broken by the browser — which is the
  // one fault a display line may not have and the one an automated check can
  // see and a screenshot cannot.
  // ---------------------------------------------------------------------------
  for (const [locale, path] of [
    ['hu', '/index.html'],
    ['en', '/en/index.html'],
    ['de', '/de/index.html'],
  ] as const) {
    test(`the monuments resolve to their authored geometry in ${locale} @smoke`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await page.waitForTimeout(1200);

      for (const act of ACTS) {
        // Act IV's statement is a figure from `content.ts`, not a message.
        if (act.id === 'iv') continue;
        const key = `act.${act.id}.monument` as keyof typeof MESSAGES;
        const authored = MESSAGES[key][locale].split('|');
        expect(
          authored.length,
          `act ${act.numeral} ${locale}: the scale table expects ${MONUMENT[act.id][locale].lines} lines`,
        ).toBe(MONUMENT[act.id][locale].lines);

        const measured = await page.evaluate((id) => {
          const mon = document.querySelector(`[data-act='${id}'] .act__monument`);
          if (!mon) return null;
          return [...mon.querySelectorAll('span')].map((span) => {
            const range = document.createRange();
            range.selectNodeContents(span);
            return {
              text: (span.textContent ?? '').trim(),
              // One client rect per LINE BOX. More than one means the browser
              // has re-broken an authored line.
              boxes: range.getClientRects().length,
              size: Math.round(parseFloat(getComputedStyle(mon).fontSize)),
            };
          });
        }, act.id);

        expect(measured, `act ${act.numeral} ${locale}: no monument`).not.toBeNull();
        expect(
          measured!.map((l) => l.text),
          `act ${act.numeral} ${locale}: the rendered lines are not the authored ones`,
        ).toEqual(authored.map((l) => l.trim()));
        for (const line of measured!) {
          expect(
            line.boxes,
            `act ${act.numeral} ${locale}: "${line.text}" was re-broken by the browser`,
          ).toBe(1);
        }
        // The solved size, scaled by the frame. Compared as a ratio so the
        // assertion holds at every viewport rather than only at 1440x900.
        const u = await page.evaluate(() => Math.min(innerWidth / 1440, innerHeight / 900));
        expect(
          measured![0].size / u,
          `act ${act.numeral} ${locale}: solved size drifted`,
        ).toBeGreaterThan(MONUMENT[act.id][locale].size - 2);
        expect(measured![0].size / u).toBeLessThan(MONUMENT[act.id][locale].size + 2);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 8b · THE PASSAGE STATEMENTS DO NOT RE-BREAK, IN ANY LOCALE.
  //
  // The same fault and the same check as the monuments above, at the passage
  // tier. `.passage__statement span` is `white-space: nowrap`, so an over-long
  // line does NOT re-break — it overruns, visibly, which is the failure a
  // designer can see. What this catches is the other half: that it does not
  // overrun either.
  //
  // The passages take ONE size across the three locales, which the uniform fit
  // makes defensible and which is only defensible if it is measured. Hungarian
  // has the longest first line at the cloud entry and German the longest second
  // line and the longest statement at the process, so the three are genuinely
  // different questions.
  // ---------------------------------------------------------------------------
  for (const [locale, path] of [
    ['hu', '/index.html'],
    ['en', '/en/index.html'],
    ['de', '/de/index.html'],
  ] as const) {
    test(`the passage statements hold their measure in ${locale} @smoke`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await page.waitForTimeout(1200);

      for (const id of PASSAGES) {
        const measured = await page.evaluate((stage) => {
          const panel = document.querySelector(`.panel[data-stage="${stage}"]`)!;
          const st = panel.querySelector('.passage__statement')!;
          const field = panel.querySelector('.passage__field')!;
          const f = field.getBoundingClientRect();
          const u = f.width / 1440;
          return {
            lines: [...st.querySelectorAll('span')].map((span) => {
              const range = document.createRange();
              range.selectNodeContents(span);
              return {
                text: (span.textContent ?? '').trim(),
                boxes: range.getClientRects().length,
                // The line's width in the study's own grid, and how far its
                // furthest edge is from the frame's own margin.
                width: span.getBoundingClientRect().width / u,
              };
            }),
            size: parseFloat(getComputedStyle(st).fontSize) / u,
          };
        }, id);

        expect(measured.lines.length, `${id} ${locale}: line count`).toBe(PASSAGE[id].lines);
        expect(measured.size, `${id} ${locale}: size drifted`).toBeGreaterThan(PASSAGE[id].size - 2);
        expect(measured.size).toBeLessThan(PASSAGE[id].size + 2);

        for (const line of measured.lines) {
          expect(line.boxes, `${id} ${locale}: "${line.text}" was re-broken`).toBe(1);
          // The type field is 1200 reference px between the two margins. A line
          // wider than that has overrun the composition, which `nowrap` makes
          // visible rather than silent — and which this makes reportable.
          expect(
            Math.round(line.width),
            `${id} ${locale}: "${line.text}" overruns the 1200u field`,
          ).toBeLessThanOrEqual(1200);
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 9 · NO TWO STATEMENTS LEGIBLE IN ONE FRAME.
  //
  // The failure the whole-journey scan found and the master frames could not:
  // an act's frame releases and travels up while the next act's box is already
  // entering from below, so `Magasságot építünk.` and `Idelent minden zajos.`
  // were on screen together at 148px and 167px, at full opacity. Twice.
  // ---------------------------------------------------------------------------
  /**
   * THE TWO WALKS BELOW DESCRIBE A CHOREOGRAPHY, AND ONE PATH DOES NOT HAVE ONE.
   *
   * Under `prefers-reduced-motion` the act frames do not ramp: all seven are
   * composed, still and reachable, which is §44's requirement and is asserted
   * directly by `hides no essential content and keeps every CTA usable` in the
   * full-ascent suite. Asking that path whether two statements are ever legible
   * at once, or how long its silences are, is asking about a behaviour it was
   * deliberately given instead of the one being measured.
   *
   * Skipped by name rather than by a `grep`, so the skip is visible in the
   * report and says why.
   */
  test('two statements are never legible in the same frame', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'reduced-motion', 'the frames do not ramp on that path — §44');
    await ready(page);
    const collisions = await page.evaluate(async () => {
      const track = document.querySelector('[data-testid="journey-track"]') as HTMLElement;
      const travel = track.offsetHeight - innerHeight;
      const out: string[] = [];
      const effective = (el: Element) => {
        let o = 1;
        for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
          const v = parseFloat(getComputedStyle(n).opacity);
          if (Number.isFinite(v)) o *= v;
          if (o < 0.005) return 0;
        }
        return o;
      };
      for (let f = 0; f <= 1.0001; f += 0.01) {
        scrollTo({ top: track.offsetTop + travel * f, behavior: 'instant' as ScrollBehavior });
        // Two frames and a beat, not one rAF. `--pass` is published by the
        // journey clock's tick, so a sample taken on the frame after the scroll
        // reads the ramps for the PREVIOUS position — which showed up as a
        // 1.43-screen silence that the same walk with a 60 ms settle could not
        // reproduce.
        await new Promise((r) => setTimeout(r, 60));
        const legible: string[] = [];
        for (const el of document.querySelectorAll('.act__monument')) {
          const r = el.getBoundingClientRect();
          if (r.bottom < 0 || r.top > innerHeight) continue;
          if (effective(el) < 0.14) continue;
          legible.push((el.textContent ?? '').trim().slice(0, 22));
        }
        if (legible.length > 1) out.push(`${Math.round(f * 100)}%: ${legible.join(' + ')}`);
      }
      return out;
    });
    expect(collisions, 'two statements in one frame').toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // 10 · NO DEAD STAGES.
  //
  // §41 permits genuine silence and §49 forbids a giant one, so the difference
  // has to be a number. One screen is the line: a silence shorter than the
  // frame it sits between is a crossing, and a longer one is a stretch of
  // journey carrying nothing.
  // ---------------------------------------------------------------------------
  test('no stretch of the journey is empty for more than a screen', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'reduced-motion', 'the frames do not ramp on that path — §44');
    await ready(page);
    const runs = await page.evaluate(async () => {
      const track = document.querySelector('[data-testid="journey-track"]') as HTMLElement;
      const travel = track.offsetHeight - innerHeight;
      const screens = track.offsetHeight / innerHeight;
      const STEPS = 120;
      const effective = (el: Element) => {
        let o = 1;
        for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
          const v = parseFloat(getComputedStyle(n).opacity);
          if (Number.isFinite(v)) o *= v;
          if (o < 0.005) return 0;
        }
        return o;
      };
      const empty: boolean[] = [];
      for (let i = 0; i <= STEPS; i++) {
        scrollTo({ top: track.offsetTop + (travel * i) / STEPS, behavior: 'instant' as ScrollBehavior });
        await new Promise((r) => setTimeout(r, 60));
        let ink = 0;
        // EVERY TEXT LEAF INSIDE A PANEL, not a list of class names.
        //
        // The list this replaces named eleven selectors and missed the
        // crossings' own content — the nine areas' list items, the seven
        // checkpoints' description lists — so 4.4 screens of chapter that is
        // full of copy measured as empty and the walk reported a 1.63-screen
        // dead stage that is not there. A silence check whose definition of ink
        // has to be kept in step with the markup is a check that will be wrong
        // again.
        //
        // Leaves only, so a paragraph is not counted once for itself and again
        // for every ancestor that contains it.
        const inkNodes = [...document.querySelectorAll('.panel :is(p, h1, h2, h3, h4, li, dt, dd, figcaption, a)')]
          .filter((el) => (el.textContent ?? '').trim().length > 1)
          .filter((el, _i, all) => !all.some((other) => other !== el && el.contains(other)));
        for (const el of inkNodes) {
          const r = el.getBoundingClientRect();
          if (r.bottom < 0 || r.top > innerHeight || r.width < 2) continue;
          const o = effective(el);
          if (o < 0.14) continue;
          ink += r.width * (Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * o;
        }
        empty.push(ink / (innerWidth * innerHeight) < 0.004);
      }
      const out: number[] = [];
      let start = -1;
      for (let i = 0; i <= empty.length; i++) {
        if (empty[i]) { if (start < 0) start = i; }
        else if (start >= 0) { out.push(((i - start) / STEPS) * screens); start = -1; }
      }
      return out.map((v) => Number(v.toFixed(2)));
    });
    const longest = runs.reduce((m, r) => Math.max(m, r), 0);
    expect(longest, `silences, in screens: ${runs.join(', ')}`).toBeLessThan(1);
  });

  // ---------------------------------------------------------------------------
  // 11 · THE CROSSINGS ARE STILL CROSSINGS.
  //
  // §3 and §26 together: an internal stage keeps its content and loses its
  // rank. A crossing whose statement is set at an act's scale is a crossing
  // competing with the act it runs under, and it is how eleven chapters grew
  // back the last time.
  // ---------------------------------------------------------------------------
  test('a crossing never sets larger than the act it runs under @smoke', async ({ page }) => {
    await ready(page);
    const sizes = await page.evaluate(() => {
      const out: Record<string, number> = {};
      for (const el of document.querySelectorAll('.panel[data-stage]')) {
        const panel = el as HTMLElement;
        const title = panel.querySelector('.act__monument, .passage__statement, .panel__title');
        if (!title) continue;
        out[panel.dataset.stage!] = Math.round(parseFloat(getComputedStyle(title).fontSize));
      }
      return out;
    });

    const peaks = ACTS.map((a) => a.peak);
    const smallestPeak = Math.min(...peaks.map((p) => sizes[p] ?? Infinity));
    for (const stage of STAGES) {
      if (peaks.includes(stage.id)) continue;
      const size = sizes[stage.id];
      if (size === undefined) continue;
      expect(
        size,
        `crossing ${stage.id} sets at ${size}px against the smallest act's ${smallestPeak}px`,
      ).toBeLessThan(smallestPeak);
      // And it kept its words. §26 and §43: the reduction is visual, not
      // editorial.
      const text = await page.getByTestId(`stage-${stage.id}`).innerText();
      expect(text.trim().length, `crossing ${stage.id} lost its content`).toBeGreaterThan(120);
    }

    // The appearance budget, expressed in the table the page actually reads.
    //
    // Two chapters carried the object before the depth proof and four carry it
    // now — the opening, the System act, the High Altitude act and the arrival —
    // because §35 makes those three the frames the new system has to work on and
    // a frame cannot be judged without the object in it. The other seven are
    // still ABSENT in §32's sense: not faint, not small, not there.
    //
    // Derived from the placement table rather than written as a literal, and
    // asserted as a SET rather than as a count: the object is present at exactly
    // the peak stages of the acts that budget a placement, and at no other
    // chapter. A count would pass a budget that had moved an appearance from an
    // act's frame to one of its crossings, which is precisely the drift §32 is
    // about — an act's crossings belong to the act and do not inherit its
    // instrument.
    const carrying = STAGES.filter((x) => SCENE[x.id].instrument !== 'absent').map((x) => x.id).sort();
    const carriers = ACTS.filter((x) => INSTRUMENT[x.id] !== undefined).map((x) => x.peak).sort();
    expect(carrying, 'the appearance budget has drifted').toEqual(carriers);
  });

  // ===========================================================================
  // ===================== T H E   C O N T I N U I T Y   P A S S ================
  // ===========================================================================
  //
  // §50 of the continuity brief, and §51's warning with it: test the semantics
  // and the intentional contracts, not the pixels. Nothing below hardcodes a
  // coordinate. What each one asserts is a decision — the page has two visual
  // levels; a rejected element does not render; the instrument stays out of the
  // crossings; the yellow stays spent where it was budgeted.
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // PASSAGE CLASSIFICATION — §2, §50.
  //
  // Every authored chapter resolves to one of exactly two levels, and the page
  // says which one it thinks it is. A chapter that resolves to neither is a
  // chapter that was added without being designed, which is the mechanism by
  // which a third visual language returns.
  // ---------------------------------------------------------------------------
  test('every chapter is a master act or an editorial passage, and nothing else @smoke', async ({ page }) => {
    await ready(page);
    const levels = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>('.panel[data-stage]')].map((p) => [
          p.dataset.stage!,
          p.dataset.level ?? '(none)',
        ]),
      ),
    );

    expect(Object.keys(levels).sort()).toEqual(STAGES.map((s) => s.id).sort());
    for (const stage of STAGES) {
      expect(levels[stage.id], `${stage.id} declares no level`).toBe(levelOf(stage.id));
      expect(['master', 'passage']).toContain(levels[stage.id]);
    }

    // Seven master acts and four passages, which is the whole of §2's split.
    const masters = Object.values(levels).filter((l) => l === 'master').length;
    expect(masters).toBe(ACTS.length);
    expect(Object.values(levels).filter((l) => l === 'passage').length).toBe(PASSAGES.length);

    // And a passage carries the two attributes the stylesheet composes against,
    // out of the same table — §32's vocabulary, asserted so a fifth passage
    // cannot be added without being classified.
    for (const id of PASSAGES) {
      const el = page.getByTestId(`stage-${id}`);
      await expect(el).toHaveAttribute('data-passage', id);
      await expect(el).toHaveAttribute('data-passage-kind', PASSAGE[id].kind);
      await expect(el).toHaveAttribute('data-axis', PASSAGE[id].axis);
    }
  });

  // ---------------------------------------------------------------------------
  // NO OLD VISUAL SYSTEM — §6, §50.
  //
  // The rejected crossing UI does not render on the homepage. Asserted as
  // ABSENCE FROM THE DOCUMENT rather than as invisibility, because §34 is
  // explicit that two working visual systems must not be left behind selectors:
  // an element that is present and hidden is one CSS change away from coming
  // back, and the point of this pass is that it cannot.
  //
  // Each entry names the §6 item it is there for, so a failure says which
  // decision has been reversed rather than only which selector matched.
  // ---------------------------------------------------------------------------
  test('the rejected crossing composition does not render @smoke', async ({ page }) => {
    await ready(page);
    const REJECTED: [string, string][] = [
      ['.panel__eyebrow', 'old chapter markers — the roman numeral and the chapter name'],
      ['.panel__altitude', 'altitude decoration in a crossing'],
      ['.panel__title', 'the old medium-tier statement'],
      ['.panel__rail, .rail', 'rails'],
      ['.notes, .notes__item', 'the annotation layer — dense microcopy on hairlines'],
      ['.system, .system__ring, .system__ring-index', 'concentric rings, the three-column grid and its yellow index'],
      ['.process, .check, .check__grid, .check__index, .check__at', 'the checkpoint dashboard, its index numerals and its altitude stamps'],
      ['.ladder, .ladder__step, .ladder__at', 'the capability table and its altitude column'],
      ['.horizon, .horizon__word', 'the horizon fragment'],
    ];
    for (const [selector, why] of REJECTED) {
      await expect(page.locator(selector), `${why} — still in the document`).toHaveCount(0);
    }

    // THE TWO CHAPTER DIAGRAMS ARE OUT OF THE SCENE AS WELL, and that cannot
    // be asked of the DOM: `SystemRings` and `Checkpoints` were three.js
    // objects, so they never had a selector. §45 forbids the background
    // announcing a chapter and a diagram that MOUNTS at an altitude is that
    // announcement, so what has to be true is that nothing mounts them.
    //
    // Asserted against the source, which is the only place that fact lives.
    // It is a real contract rather than a lint: re-adding either component to
    // the scene graph is precisely the regression §6 and §45 are written
    // against, and it would leave no trace in the document for a page test to
    // find.
    const scene = await readFile(
      new URL('../src/full/components/JourneyScene.tsx', import.meta.url),
      'utf8',
    );
    for (const gone of ['SystemRings', 'Checkpoints']) {
      const mounted = new RegExp(`<${gone}\\b`).test(scene);
      expect(mounted, `${gone} is mounted in the scene again — §6, §45`).toBe(false);
    }
  });

  // ---------------------------------------------------------------------------
  // MASTER PROTECTION — §46, §50.
  //
  // A crossing change must not alter a master frame. The composition is
  // absolute and solved per act per locale in `acts.ts`, so what has to hold is
  // that the page still resolves each monument to the setting the table names,
  // and that the seven acts are still in altitude order with their bodies under
  // them. The geometry itself is asserted in `the monuments resolve to their
  // authored geometry`, per locale, above; this is the structural half.
  // ---------------------------------------------------------------------------
  test('the master acts are intact and in order @smoke', async ({ page }) => {
    await ready(page);
    const order = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.panel[data-level="master"]')].map((p) => ({
        stage: p.dataset.stage!,
        act: p.dataset.act!,
        top: p.offsetTop,
        monument: p.querySelector('.act__monument')?.textContent?.trim() ?? '',
        size: Math.round(parseFloat(getComputedStyle(p.querySelector('.act__monument')!).fontSize)),
      })),
    );

    expect(order.map((o) => o.act)).toEqual(ACTS.map((a) => a.id));
    for (let i = 1; i < order.length; i++) {
      expect(order[i].top, `${order[i].act} is above ${order[i - 1].act}`).toBeGreaterThan(order[i - 1].top);
    }
    // Every act still carries its own statement at its own solved size.
    //
    // Act IV is the exception and it is a property of the design rather than of
    // this test: its monument is a FIGURE and it comes from `content.ts`, not
    // from `messages.ts` — there is no `act.iv.monument` key, deliberately, and
    // the figure's text is asserted against the content table in `the figure
    // and its label are content.ts, word for word`.
    for (const o of order) {
      expect(o.size, `${o.act}'s monument is ${o.size}px`).toBe(
        MONUMENT[o.act as keyof typeof MONUMENT].hu.size,
      );
      if (o.act === 'iv') {
        expect(o.monument.length, 'the Proof act lost its figure').toBeGreaterThan(3);
        continue;
      }
      const key = `act.${o.act}.monument` as keyof typeof MESSAGES;
      expect(o.monument.replace(/\s+/g, '')).toBe(
        MESSAGES[key].hu.split('|').join('').replace(/\s+/g, ''),
      );
    }
  });

  // ---------------------------------------------------------------------------
  // THE PASSAGE TIER — §4, §5, §18, §48.
  //
  // "Do not make every passage large." The master acts need contrast, and the
  // contrast is a ratio rather than a taste: a passage sets at well under half
  // the smallest monument and well over the editorial voice, so it is
  // unmistakably its own rank at thumbnail scale in both directions.
  //
  // Bounds rather than exact sizes — §51 warns against a test that forbids all
  // future change, and the design decision here is "clearly smaller than a
  // monument and clearly larger than a line", not 72 pixels.
  // ---------------------------------------------------------------------------
  test('a passage statement is its own tier, between the monument and the line', async ({ page }) => {
    await ready(page);
    const sizes = await page.evaluate(() => {
      const px = (el: Element | null) => (el ? Math.round(parseFloat(getComputedStyle(el).fontSize)) : 0);
      return {
        monuments: [...document.querySelectorAll('.act__monument')].map(px),
        statements: [...document.querySelectorAll('.passage__statement')].map(px),
        editorial: px(document.querySelector('.act__editorial')),
      };
    });

    expect(sizes.statements.length).toBe(PASSAGES.length);
    const smallestMonument = Math.min(...sizes.monuments);
    const largestPassage = Math.max(...sizes.statements);
    const smallestPassage = Math.min(...sizes.statements);

    expect(
      largestPassage / smallestMonument,
      `the largest passage is ${largestPassage}px against the smallest monument's ${smallestMonument}px`,
    ).toBeLessThan(0.68);
    expect(
      smallestPassage / sizes.editorial,
      `the smallest passage is ${smallestPassage}px against the editorial line's ${sizes.editorial}px`,
    ).toBeGreaterThan(2.4);

    // AND A PASSAGE IS COMPOSED FOR LESS SCROLL THAN AN ACT — §18's destination
    // and movement, as a number rather than a feeling.
    //
    // THIS USED TO COMPARE THE HOLDS AND THAT WAS THE WRONG QUANTITY.
    //
    // It read `--act-hold` off the first master panel and the first passage
    // panel and asserted one was smaller than the other. Two things were wrong
    // with it and the temporal review found both:
    //
    //   * an act publishes `--act-hold` on `.act__hold`, not on the panel, so
    //     the master half of the comparison was always an empty string and the
    //     assertion ran against the `|| 1.8` fallback — a constant, not a
    //     measurement;
    //   * the hold is an INPUT. What a visitor gets is the hold minus both
    //     ramps, and the ramps differ by level. With the shipped numbers before
    //     the review, a hold ratio of 1.25 : 1.8 produced a composed ratio of
    //     0.15 : 0.91 — six to one, which is a statement that flashes rather
    //     than a quieter tier. A contract on the hold could not see it.
    //
    // So this asserts the quantity the eye actually meets, from the values each
    // panel publishes, for EVERY chapter rather than for the first of each
    // kind — which also covers Act I, whose hold is deliberately below the
    // passage hold (see `GROUND_HOLD`) while its composed window is three times
    // the largest passage's.
    const composed = await page.evaluate(() => {
      const n = (el: Element, name: string, fallback: number) => {
        const v = parseFloat(getComputedStyle(el).getPropertyValue(name));
        return Number.isFinite(v) ? v : fallback;
      };
      return [...document.querySelectorAll<HTMLElement>('.panel')].map((panel) => {
        const holder = panel.querySelector('.act__hold, .passage__hold') ?? panel;
        const hold = n(holder, '--act-hold', 1.8);
        const rampIn = n(panel, '--ramp-in', 0.42);
        const lead = n(panel, '--ramp-in-lead', 0.3);
        // The same fallback chain the ramp expressions in `styles.css` use:
        // `--screens` is the measured panel height and is published once the
        // composition pass has run, `--share` is the authored floor before it.
        // Reading it the same way here is what keeps this contract true on the
        // reduced-motion path, where there is no clock to publish anything.
        const screens = n(panel, '--screens', n(panel, '--share', 2));
        // A frame that never departs is composed until its PANEL runs out
        // rather than until its hold does — see `data-act-departs` — so for
        // those two the window is the panel minus the incoming frame's lead.
        const departs = panel.dataset.actDeparts !== 'no';
        const end = departs ? hold - 1 : screens - lead;
        return {
          stage: panel.dataset.stage!,
          level: panel.dataset.level!,
          window: +(end - (rampIn - lead)).toFixed(3),
        };
      });
    });

    const masters = composed.filter((c) => c.level === 'master');
    const passages = composed.filter((c) => c.level === 'passage');
    expect(masters.length, 'master chapters').toBeGreaterThan(0);
    expect(passages.length, 'passage chapters').toBe(PASSAGES.length);

    const quietestAct = masters.reduce((a, b) => (a.window < b.window ? a : b));
    const loudestPassage = passages.reduce((a, b) => (a.window > b.window ? a : b));
    expect(
      loudestPassage.window,
      `${loudestPassage.stage} is composed for ${loudestPassage.window.toFixed(2)} screens ` +
        `against the quietest act (${quietestAct.stage}) at ${quietestAct.window.toFixed(2)}`,
    ).toBeLessThan(quietestAct.window);

    // And it is a TIER rather than a hair's difference: the loudest passage is
    // composed for at most two thirds of the quietest act. The shipped ratio is
    // about a half; two thirds is where "quieter" stops being legible as a
    // level of its own.
    expect(loudestPassage.window / quietestAct.window).toBeLessThan(0.68);
  });

  // ---------------------------------------------------------------------------
  // ALTIMETER BUDGET IN THE CROSSINGS — §20, §50.
  //
  // "Do NOT add the Altimeter into crossings. Its rarity is now part of the
  // luxury language." Asked of the published presence at every passage rather
  // than of the scene graph, for the reason at the top of this file.
  // ---------------------------------------------------------------------------
  test('no passage shows the instrument @smoke', async ({ page }) => {
    await ready(page);
    for (const id of PASSAGES) {
      await settleOn(page, id, 0.3);
      const presence = await presenceNow(page);
      expect(presence, `the instrument is present at the ${id} passage`).toBeLessThan(0.02);
      expect(SCENE[id].instrument, `${id} budgets an instrument`).toBe('absent');
    }
  });

  // ---------------------------------------------------------------------------
  // YELLOW IN THE CROSSINGS — §22, §50.
  //
  // The budget is two events and the crossings are not exempt from the count.
  // The existing yellow test asks the two acts that HAVE a budget; this asks
  // the four chapters that do not, by walking each one and looking at what
  // actually painted.
  // ---------------------------------------------------------------------------
  test('no passage paints the signal colour', async ({ page }) => {
    await ready(page);
    for (const id of PASSAGES) {
      await settleOn(page, id, 0.3);
      const hits = await page.evaluate((stage) => {
        const isSignal = (c: string) => {
          const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/.exec(c || '');
          if (!m) return false;
          const [r, g, b] = [+m[1], +m[2], +m[3]];
          const a = m[4] === undefined ? 1 : +m[4];
          return a > 0.05 && r > 150 && g > 130 && b < 110 && r - b > 90 && g - b > 70;
        };
        const panel = document.querySelector(`.panel[data-stage="${stage}"]`)!;
        const out: string[] = [];
        for (const el of panel.querySelectorAll('*')) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'backgroundImage'] as const) {
            if (isSignal(cs[prop])) out.push(`${el.className || el.tagName} · ${prop}`);
          }
        }
        return [...new Set(out)];
      }, id);
      expect(hits, `the ${id} passage paints yellow`).toEqual([]);
    }
  });

  /* THE HEADER'S CALL TO ACTION IS CONTRACTED IN `tests/homepage-chrome.spec.ts`,
     NOT HERE — §21, §52.
     
     This suite runs against `/experiments/stratos-ascent-full/`, which is a
     BARE MOUNT HOST: `experiments/full.html` carries the React root and nothing
     else, so there is no flight deck on it, no `.nav .btn`, and no yellow to
     neutralise. A contract written here would have waited two minutes for an
     element that route correctly does not have — which is exactly what the
     first run of it did.
     
     The chrome is rendered into the three homepage shells by `build.py` and
     substituted at build time, so the built homepage is the only artefact where
     "the header has a call to action" is a fact rather than an intention. That
     is the suite it belongs in, and it is the same argument the note at the top
     of that file already makes about why it asserts against `dist/`. */

  // ---------------------------------------------------------------------------
  // REDUCED MOTION — §30, §50.
  //
  // "No content withholding, no zero-height passages, no invisible transitions,
  // semantic sequence remains obvious, Master vs Passage hierarchy remains
  // visually intact. Do not fall back to the previous visual system."
  //
  // Five things, and all five are asked here rather than assumed from the fact
  // that the stylesheet pins the ramps. This runs on BOTH projects on purpose:
  // the properties are true of the design, not of one code path, and a test
  // that only ran on `reduced-motion` could not tell "correct on that path"
  // from "the media query never matched".
  // ---------------------------------------------------------------------------
  test('every passage is composed, present and legible with no clock @smoke', async ({ page }, testInfo) => {
    // THIS TEST TURNS REDUCED MOTION ON ITSELF, AND THAT IS NOT BELT AND
    // BRACES — IT IS THE ONLY THING THAT MAKES THE PROJECT MEAN ANYTHING HERE.
    //
    // The `reduced-motion` project declares `reducedMotion: 'reduce'` in its
    // `use` block, and `tests/helpers/reduced-motion.ts` exists because that
    // option does not reliably reach `matchMedia()` in this project. Every
    // reduced-motion test in `full-ascent.spec.ts` calls `enableReducedMotion`
    // for exactly that reason. **No test in THIS file ever has** — so the
    // project has been collecting `six-acts.spec.ts` and running it against the
    // ordinary animated page, and the two `test.skip(project ===
    // 'reduced-motion')` guards further up have been skipping tests on a path
    // that was not reduced motion. That is recorded in §M and §O of the
    // continuity report; fixing it for the whole file means auditing fifteen
    // tests on a path they have never run, which is its own change.
    //
    // What this test does is make its own half true: enable before navigating —
    // the application reads the preference once, in its capability probe, on
    // first mount — and then PROVE from inside the page that the query flipped
    // before asserting anything that depends on it.
    const reduced = testInfo.project.name === 'reduced-motion';
    if (reduced) {
      const verify = await enableReducedMotion(page);
      await page.goto('./');
      await page.evaluate(() => document.fonts.ready);
      await verify();
      // No canvas, no clock, no composition publisher on this path — so there
      // is no `--instrument` to wait for. The passages are ordinary document
      // content and they are there as soon as React has mounted.
      await page.waitForSelector('.panel[data-level="passage"]', { timeout: 30_000 });
      await page.waitForTimeout(600);
    } else {
      await ready(page);
    }

    const state = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.panel[data-level="passage"]')].map((p) => {
        const frame = p.querySelector<HTMLElement>('.passage')!;
        const statement = p.querySelector<HTMLElement>('.passage__statement')!;
        const cs = getComputedStyle(frame);
        return {
          stage: p.dataset.stage!,
          // No zero-height passage.
          height: p.offsetHeight,
          frameHeight: frame.offsetHeight,
          // No content withheld: the statement is in the box tree with ink.
          statement: statement.textContent!.trim(),
          statementPx: Math.round(parseFloat(getComputedStyle(statement).fontSize)),
          // No invisible transition: the frame's presence, as the page states
          // it. On a path with no clock nothing publishes `--pass`, so the ramp
          // has to fall back to fully present rather than to zero.
          presence: parseFloat(cs.opacity),
          visibility: cs.visibility,
        };
      }),
    );

    expect(state.length).toBe(PASSAGES.length);
    for (const s of state) {
      expect(s.height, `${s.stage} has no height`).toBeGreaterThan(200);
      expect(s.frameHeight, `${s.stage}'s frame has no height`).toBeGreaterThan(200);
      expect(s.statement.length, `${s.stage} withholds its statement`).toBeGreaterThan(8);
      expect(s.visibility, `${s.stage}'s frame is hidden`).toBe('visible');
      if (reduced) {
        // §30's own words: no invisible transitions. Every passage on this path
        // is settled and readable at rest, wherever it is in the document.
        expect(s.presence, `${s.stage} is faded out on the reduced-motion path`).toBeGreaterThan(0.9);
      }
    }

    // The hierarchy survives: the passages are still the quieter tier, on this
    // path as on the other. §30 forbids falling back to the previous system,
    // and the previous system's crossings set within a few pixels of an act.
    const monuments = await page.evaluate(() =>
      [...document.querySelectorAll('.act__monument')].map((el) =>
        Math.round(parseFloat(getComputedStyle(el).fontSize)),
      ),
    );
    expect(Math.max(...state.map((s) => s.statementPx))).toBeLessThan(Math.min(...monuments) * 0.68);

    // And the sequence is still obvious: document order is altitude order.
    const order = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.panel[data-stage]')].map((p) => p.dataset.stage!),
    );
    expect(order).toEqual(STAGES.map((s) => s.id));
  });
});