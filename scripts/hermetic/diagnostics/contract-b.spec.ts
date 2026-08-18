import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CONTRACT B — `homepage-modality.spec.ts:96`
 * "while it is open the page behind it cannot be reached, and afterwards it can"
 *
 * THE FAILURE, EXACTLY
 * --------------------
 *     page.evaluate: Execution context was destroyed, most likely because of a navigation
 *     at homepage-modality.spec.ts:248, immediately after page.mouse.click
 *
 * THE SHAPE OF THE TEST, AND WHY IT IS ALREADY A SECOND ATTEMPT
 * ------------------------------------------------------------
 * The spec carries a long comment describing a PREVIOUS fix of this exact
 * failure. The first version clicked and then called `waitForLoadState`, which
 * resolves immediately against the already-loaded document and therefore
 * settled nothing. The current version predicts the outcome instead:
 *
 *     target = elementFromPoint(x, y)          // sampled BEFORE the click
 *     if (target.closest('a[href]'))  → expect a navigation
 *     else                            → assume none is possible, page.evaluate()
 *
 * The comment claims "neither branch races". That claim is what this file
 * tests, because the failure returned.
 *
 * THE HYPOTHESIS, STATED SO IT CAN BE REFUTED
 * -------------------------------------------
 * The prediction is only sound if the element under the point at CLICK time is
 * the element that was sampled. `openMenu()` waits for `aria-expanded="true"`
 * and `toBeVisible()` — and `toBeVisible()` requires only a non-empty bounding
 * box. Neither waits for the layer's opening transition to finish. If the panel
 * is still moving, the topmost element at a fixed viewport coordinate changes
 * between the sample and the click; a sample that found no link can be followed
 * by a click that lands on one, the else-branch runs, the navigation commits,
 * and `page.evaluate` dies exactly as reported.
 *
 * So this records, per frame: what is under the point, whether it resolves to a
 * link, and what animations are in flight. If the identity is stable across the
 * whole window, the hypothesis is wrong and the record will say so.
 *
 * HOW THE CLICK IS OBSERVED WITHOUT RACING
 * ----------------------------------------
 * `page.exposeFunction` installs a binding the page can call SYNCHRONOUSLY from
 * a capture-phase listener. The value reaches Node at the moment of the click,
 * before any navigation can commit — so unlike `page.evaluate` afterwards, it
 * cannot be destroyed by the thing it is trying to describe.
 */

const OUT = process.env.CONTRACT_B_OUT ?? '_build/reports/final-two-contracts/contract-b';

const burger = (page: Page) => page.locator('.burger');
const menu = (page: Page) => page.locator('#menu');

async function homepageReady(page: Page) {
  await page.waitForSelector('[data-testid="altitude-hud"], [data-testid="mobile-telemetry"]', { timeout: 30_000 });
}

/** What is under the point, right now, and does it resolve to a link. */
const probe = (page: Page, point: [number, number]) =>
  page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    const a = el?.closest('a[href]') ?? null;
    const panel = document.querySelector('#menu .menu__panel') ?? document.getElementById('menu');
    return {
      tag: el ? `${el.tagName}${el.id ? '#' + el.id : ''}${el.className ? '.' + String(el.className).split(' ')[0] : ''}` : 'nothing',
      inLayer: !!el?.closest('#menu'),
      href: a?.getAttribute('href') ?? null,
      // Anything still moving is a reason the answer above can change.
      // Document-wide is useless here — the homepage runs a WebGL journey and
      // never reaches zero. Scoped to the layer it is a real settle signal.
      animations: (document.getAnimations?.() ?? []).length,
      layerAnimations: (() => {
        const m = document.getElementById('menu') as any;
        const list = m?.getAnimations?.({ subtree: true }) ?? [];
        return list.filter((a: any) => a.playState === 'running').length;
      })(),
      panelBox: panel ? (({ x: bx, y: by, width, height }) => ({ bx, by, width, height }))(panel.getBoundingClientRect()) : null,
      panelTransform: panel ? getComputedStyle(panel).transform : null,
      panelOpacity: panel ? getComputedStyle(panel).opacity : null,
    };
  }, point);

test.describe.configure({ timeout: 120_000 });

test('contract B — click through the open layer, instrumented', async ({ page }, info) => {
  const rec: Record<string, unknown> = {
    project: info.project.name,
    repeat: info.repeatEachIndex,
    worker: info.workerIndex,
    startedAt: new Date().toISOString(),
  };

  /* The click, recorded from inside the page at the instant it happens.
     Synchronous transfer to Node — survives the navigation it may cause. */
  const clicks: unknown[] = [];
  await page.exposeFunction('__recordClick', (d: unknown) => { clicks.push(d); });
  await page.addInitScript(() => {
    addEventListener('click', (e) => {
      const el = e.target as Element | null;
      const a = el?.closest?.('a[href]') ?? null;
      (window as any).__recordClick({
        tag: el ? `${el.tagName}${el.id ? '#' + el.id : ''}` : 'nothing',
        inLayer: !!el?.closest?.('#menu'),
        href: a?.getAttribute('href') ?? null,
        isNl: (el as HTMLElement | null)?.id === 'nl' || !!el?.closest?.('#nl'),
        path: (e.composedPath?.() ?? []).slice(0, 5)
          .map((n: any) => n?.tagName ? `${n.tagName}${n.id ? '#' + n.id : ''}` : String(n?.constructor?.name ?? '?')),
        defaultPrevented: e.defaultPrevented,
      });
    }, true);
  });

  await page.goto('/index.html');
  await expect(burger(page)).toBeVisible();
  await homepageReady(page);

  /* ORDER MATTERS, and getting it wrong is how the first version of this file
     measured the wrong thing entirely.
     The field is brought on screen BEFORE the layer opens, because opening it
     applies a position-fixed scroll lock and `scrollIntoViewIfNeeded` can no
     longer move anything. Open first and the coordinates stay wherever the
     field happened to be — off-screen — `elementFromPoint` returns null for a
     point outside the viewport, and the click gets clamped onto the header.
     That produced a clean, stable, entirely meaningless PASS. */
  await page.locator('#nl').scrollIntoViewIfNeeded();
  const box = await page.locator('#nl').boundingBox();
  expect(box, 'the newsletter field is not on screen to test against').not.toBeNull();
  const point: [number, number] = [box!.x + box!.width / 2, box!.y + box!.height / 2];
  rec.point = point;

  // Exactly the real test's open path — deliberately NOT stronger.
  await burger(page).click();
  await expect(burger(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(menu(page)).toBeVisible();

  /* THE MEASUREMENT. Sample the same coordinate repeatedly. If the identity
     under the pointer is stable, the real test's prediction is sound and the
     hypothesis above is wrong. */
  const samples: unknown[] = [];
  for (let i = 0; i < 25; i++) {
    samples.push({ i, ...(await probe(page, point)) });
    await page.waitForTimeout(20);
  }
  rec.samples = samples;
  const tags = [...new Set(samples.map((s: any) => s.tag))];
  const hrefs = [...new Set(samples.map((s: any) => s.href))];
  rec.distinctTargets = tags;
  rec.distinctHrefs = hrefs;
  rec.targetStable = tags.length === 1;
  rec.hrefStable = hrefs.length === 1;
  rec.anyAnimationsDuringWindow = samples.some((s: any) => s.animations > 0);

  /* The same stabilisation the corrected test now performs, so this diagnostic
     measures what remains AFTER it rather than what it already fixed. */
  await page.waitForFunction(
    ([x, y]) => {
      const w = window as any;
      const el = document.elementFromPoint(x, y);
      const a = el?.closest('a[href]') ?? null;
      const key = `${el ? `${el.tagName}#${el.id}.${String(el.className)}` : 'nothing'}|${a?.getAttribute('href') ?? ''}`;
      const seen = (w.__hit ??= { key: '', n: 0 });
      if (key === seen.key) seen.n += 1; else { seen.key = key; seen.n = 0; }
      return seen.n >= 5;
    },
    point,
    { timeout: 10_000, polling: 'raf' },
  );

  // The sample the real test would have taken, taken the way it takes it.
  const predicted = await probe(page, point);
  // And again immediately after, to catch a target that moves between the
  // prediction and the click even once it has "settled".
  rec.probeAfterPredict = await probe(page, point);
  rec.predicted = predicted;

  const urlBefore = page.url();
  await page.mouse.click(point[0], point[1]);
  rec.recordedClicks = clicks;

  /* Settle without asserting: give a navigation, if one was started, the chance
     to commit, then read the URL from Node (never from the page, which is the
     thing that may have been destroyed). */
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  const urlAfter = page.url();
  rec.urlBefore = urlBefore;
  rec.urlAfter = urlAfter;
  rec.navigated = !urlAfter.endsWith('/index.html');

  /* §12 — the first divergence, from the record. */
  const predictedNav = !!predicted.href;
  rec.predictedNavigation = predictedNav;
  rec.actualNavigation = rec.navigated;
  rec.predictionCorrect = predictedNav === rec.navigated;
  rec.firstDivergence = rec.predictionCorrect
    ? null
    : `prediction said navigate=${predictedNav}, actual navigate=${rec.navigated} — ` +
      `the element under the point at click time was not the element sampled`;

  // The real contract, which neither branch may violate.
  const nlTookIt = (clicks as any[]).some((c) => c.isNl);
  rec.newsletterFieldTookTheClick = nlTookIt;
  rec.outcome = !nlTookIt && rec.predictionCorrect ? 'PASS' : 'FAIL';

  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, `${info.project.name}-r${info.repeatEachIndex}-w${info.workerIndex}-${Date.now()}.json`),
    `${JSON.stringify(rec, null, 2)}\n`,
  );

  expect(nlTookIt, 'the newsletter field took a click through the layer').toBe(false);
  expect(rec.predictionCorrect, `${rec.firstDivergence}`).toBe(true);
});
