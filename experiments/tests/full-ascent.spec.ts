import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  assertReducedMotionActive,
  assertReducedMotionInactive,
  enableReducedMotion,
} from '../../tests/helpers/reduced-motion';
import {
  JOURNEY_SMOOTHING,
  MAX_FRAME_DT,
  SETTLE_EPSILON,
  STAGES,
  altitudeAt,
  stageAt,
  stageAtAltitude,
  type StageId,
} from '../src/full/journey';
import {
  HIDE_ABOVE,
  MOUNTAIN_SCALE,
  UNMOUNT_ABOVE,
  cameraStation,
  mountainRootTransform,
  mountainStateAt,
} from '../src/full/mountains';
import {
  ALTITUDE_STOPS,
  FINAL_CALIBRATED_OPEN,
  MERIDIAN_STAGES,
  RINGS,
  apertureOpen,
  createMeridianState,
  meridianStageAt,
  meridianState,
  ringLock,
} from '../src/full/meridian';
import { IRIS, irisHoleRadius } from '../src/full/components/meridianParts';

/**
 * Centre a stage's panel in the viewport, by measuring where it actually is.
 *
 * Not computed from the stage shares. Two earlier attempts got this wrong in
 * two different ways: hand-picked fractions put every still half a stage late,
 * and share-derived fractions were right at 1440px and wrong at 390px, because
 * the case-study and process panels overrun their nominal budget on a narrow
 * viewport. Asking the DOM is correct on every viewport by construction.
 */
async function scrollToStage(page: Page, id: string) {
  await page.evaluate((stageId) => {
    const panel = document.getElementById(`stage-${stageId}`);
    if (!panel) throw new Error(`no panel for stage ${stageId}`);

    // Centre the *plate*, not the panel. The panel is mostly deliberate empty
    // scroll — that is what gives each stage its dwell time — so centring it
    // frames whitespace. The plate is the content, and where it comes to rest
    // is what a visitor actually reads.
    const plate = (panel.querySelector('.panel__inner') as HTMLElement | null) ?? panel;
    const plateTop = plate.getBoundingClientRect().top + scrollY;

    // Where the readable area starts: below the HUD strip on mobile, at the top
    // of the viewport on desktop where the HUD is in a corner.
    const hud = document.querySelector('.hud')?.getBoundingClientRect();
    const chrome = hud && hud.top <= 1 ? hud.height : 0;

    // A plate taller than the viewport cannot be centred meaningfully; pin its
    // top just under the chrome instead, which is where the reader starts.
    const centred = plateTop + plate.offsetHeight / 2 - innerHeight / 2;
    const pinned = plateTop - chrome - 8;
    const fits = plate.offsetHeight <= innerHeight - chrome;

    scrollTo({ top: fits ? centred : pinned, behavior: 'instant' as ScrollBehavior });
  }, id);
  await page.waitForTimeout(1700);
}

// =============================================================================
// The full 0–30 000 m journey.
//
// These tests are written to answer the questions that decide whether this is a
// production candidate — does the whole altitude range actually get reached,
// does the content survive without the renderer, does the reduced-motion path
// avoid downloading 970 KB it will not use, does the mobile sticky handoff hold
// — rather than to assert that a canvas element exists.
// =============================================================================

const SHOTS = resolve(process.cwd(), 'experiments/screenshots/full');
const DIST = resolve(process.cwd(), 'dist/experiments/stratos-ascent-full');

/**
 * Capture a still, after making sure there is one to capture.
 *
 * `Page.captureScreenshot` does not wait for the renderer: if the page has not
 * painted since its context was created, Chrome answers "Unable to capture
 * screenshot" outright, in well under a second. That is not a timeout and no
 * amount of `waitForTimeout` before it helps, because nothing in the test is
 * asking the page for a frame.
 *
 * It showed up as one reliably failing test — the no-WebGL still, which runs
 * immediately after the eleven-stage walk tears down a WebGL context that has
 * been rendering for half a minute. The same test passes on its own, which is
 * the tell: the failure belongs to the *previous* test's teardown, not to
 * anything on the page being captured.
 *
 * Waiting for two animation frames asks for the frame and then lets the one
 * after it be the settled one. The retry is there because the first frame after
 * a GPU-process hiccup is the one that can still be refused, and a screenshot
 * that is evidence is worth one more attempt rather than a red suite.
 */
const shot = async (page: Page, name: string) => {
  await page.evaluate(
    () => new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))),
  );
  const capture = () => page.screenshot({ path: resolve(SHOTS, `${name}.png`), animations: 'disabled' });
  try {
    await capture();
  } catch {
    await page.waitForTimeout(400);
    await capture();
  }
};

test.beforeAll(async () => {
  await mkdir(SHOTS, { recursive: true });
});

/** Runtime emulation for the reduced-motion project — never the config option. */
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'reduced-motion') await enableReducedMotion(page);
});

const isMotion = (name: string) => name !== 'reduced-motion';
const isMobile = (name: string) => name.startsWith('mobile');

/**
 * Scroll to a fraction of *the track*, not of the document.
 *
 * They differ: the footer sits below the track, so scrolling to the bottom of
 * the document lands past the end of the journey. Fraction 1.0 here means "the
 * end of the destination panel", which is what every assertion about 30 000 m
 * actually means.
 */
async function scrollTo(page: Page, fraction: number) {
  await page.evaluate((f) => {
    const track = document.querySelector('[data-testid="journey-track"]') as HTMLElement | null;
    const travel = track
      ? track.offsetHeight - innerHeight
      : document.documentElement.scrollHeight - innerHeight;
    scrollTo({ top: (track?.offsetTop ?? 0) + travel * f, behavior: 'instant' as ScrollBehavior });
  }, fraction);
  // The readout damps toward the scroll position rather than snapping to it,
  // and over 30 000 m the settle is genuinely slower than the prototype's.
  await page.waitForTimeout(1700);
}

const readAltitude = async (page: Page) => {
  const text = await page.getByTestId('altitude-value').textContent();
  return Number((text ?? '0').replace(/[^\d]/g, ''));
};

/** Errors that are the environment's fault, not the page's. */
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|net::ERR_/i.test(t)) return;
    errors.push(t);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

// -----------------------------------------------------------------------------
test.describe('the journey renders', () => {
  test.beforeEach(({}, info) => {
    test.skip(!isMotion(info.project.name), 'there is no canvas under reduced motion');
  });

  test('loads the scene and the instrument with no console errors', async ({ page }, info) => {
    const errors = collectErrors(page);

    // Armed before navigating: the model is preloaded as soon as the scene
    // chunk evaluates, which can be before the canvas is painted. Waiting
    // afterwards is a race that loses on a warm cache.
    const model = page.waitForResponse(
      (r) => r.url().includes('stratos-altimeter.glb') && r.status() === 200,
      { timeout: 30_000 },
    );

    await page.goto('./');
    await assertReducedMotionInactive(page);
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });

    const response = await model;
    expect(Number(response.headers()['content-length'] ?? 0)).toBeGreaterThan(1000);

    expect(errors, `console errors on ${info.project.name}`).toEqual([]);
  });

  test('the altitude climbs the whole way and reaches exactly 30 000 m', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });

    await scrollTo(page, 0);
    expect(await readAltitude(page), 'starts at ground level').toBeLessThan(300);

    // Every stage boundary is passed, in order, and the altitude is monotonic.
    // A single start/end assertion would pass even if the middle of the curve
    // ran backwards or sat still for four screens.
    let previous = 0;
    for (const f of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
      await scrollTo(page, f);
      const m = await readAltitude(page);
      expect(m, `altitude went backwards at ${f}`).toBeGreaterThanOrEqual(previous);
      expect(m, `altitude exceeded the ceiling at ${f}`).toBeLessThanOrEqual(30_000);
      previous = m;
    }

    // The destination. This is the assertion the whole route exists to satisfy:
    // the journey has to actually arrive, not stop at 27 000 m because the
    // stage shares and the panel heights disagree.
    await scrollTo(page, 1);
    expect(await readAltitude(page)).toBe(30_000);
    await expect(page.getByTestId('altitude-stage')).toHaveText('Célmagasság');
  });

  test('the rendered scene changes between every act', async ({ page }) => {
    await page.goto('./');
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 20_000 });

    // One frame per act. If any two are byte-identical, that stretch of the
    // journey is not driving the scene however good the stills look.
    const frames: Record<string, Buffer> = {};
    for (const [name, f] of [
      ['ground', 0.01],
      ['cloud', 0.3],
      ['breakthrough', 0.4],
      ['work', 0.5],
      ['space', 0.92],
    ] as const) {
      await scrollTo(page, f);
      frames[name] = await canvas.screenshot();
    }

    const names = Object.keys(frames);
    for (let i = 0; i < names.length - 1; i++) {
      expect(
        Buffer.compare(frames[names[i]], frames[names[i + 1]]),
        `the scene is identical at ${names[i]} and ${names[i + 1]}`,
      ).not.toBe(0);
    }
  });

  test('never scrolls sideways, at any altitude', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      await scrollTo(page, f);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at ${f}`).toBeLessThanOrEqual(1);
    }
  });
});

// -----------------------------------------------------------------------------
// The altitude clock is owned by the HUD's own rAF, not by the render loop, so
// that it keeps time while the canvas frameloop is parked. These are the tests
// that hold that architecture in place — it is invisible until it breaks, and
// when it breaks the symptom is an altitude stuck in the lower atmosphere.
test.describe('the altitude clock is independent of the render loop', () => {
  test.beforeEach(({}, info) => {
    test.skip(!isMotion(info.project.name), 'no canvas, no frameloop to park');
  });

  test('keeps time while the tab is hidden and the canvas is parked', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });

    await scrollTo(page, 0.5);
    const before = await readAltitude(page);

    // Park the loop the way the page itself does — the visibility handler and
    // the IntersectionObserver both route into setFrameloop('never').
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(300);

    await scrollTo(page, 0.75);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(1500);

    const after = await readAltitude(page);
    expect(after, 'the altitude froze while the canvas was parked').toBeGreaterThan(before);
  });

  test('reaches the ceiling even if the canvas never renders again', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });

    // Kill the context outright. The HUD's clock must not care.
    await page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement | null;
      const gl = c?.getContext('webgl2') || c?.getContext('webgl');
      (gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
    });
    await page.waitForTimeout(400);

    await scrollTo(page, 1);
    expect(await readAltitude(page)).toBe(30_000);
  });
});

// -----------------------------------------------------------------------------
test.describe('the content survives without the canvas', () => {
  test('every stage, case study and process step is real HTML', async ({ page }) => {
    await page.goto('./');

    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('a.skip')).toHaveAttribute('href', '#journey-content');

    // All eleven stages are in the document at once, not mounted on scroll.
    const stages = [
      'calibration', 'initial-ascent', 'lower-atmosphere', 'cloud-entry',
      'cloud-breakthrough', 'selected-work', 'system', 'process',
      'stratosphere-transition', 'full-stratosphere', 'destination',
    ];
    for (const id of stages) {
      const section = page.getByTestId(`stage-${id}`);
      await expect(section, `stage ${id} is missing`).toHaveCount(1);
      expect((await section.innerText()).trim().length, `stage ${id} is empty`).toBeGreaterThan(60);
    }

    // The case studies carry the five-part structure, with prose in each part.
    //
    // Three, not the four this asserted through Phase 8. Phase 8.5 §9.2 caps the
    // homepage Selected Work at three project summaries, and §10.2's approved
    // organisation list does not include Pille Sewing — two independent reasons
    // for the same removal. The count is asserted BOTH ways on purpose: a
    // fourth case study reappearing is as much a regression as one of these
    // three going missing, and a loop over a list can only catch the second.
    for (const id of ['rapidkert', 'barbershop', 'mentaltrening']) {
      const c = page.getByTestId(`case-${id}`);
      await expect(c, `case ${id} is missing`).toHaveCount(1);
      await expect(c.locator('dt')).toHaveCount(5);
      for (const dd of await c.locator('dd').all()) {
        expect((await dd.innerText()).trim().length).toBeGreaterThan(20);
      }
    }
    await expect(
      page.locator('[data-testid^="case-"]'),
      'the homepage shows exactly three project summaries (§9.2)',
    ).toHaveCount(3);

    // Seven process checkpoints, each with all four columns answered.
    for (let i = 1; i <= 7; i++) {
      const cp = page.getByTestId(`checkpoint-${i}`);
      await expect(cp).toHaveCount(1);
      await expect(cp.locator('dt')).toHaveCount(4);
    }

    // No invented metrics. The repository has no verified figure for any of
    // these projects, so the metric row must be absent rather than filled in
    // with something plausible.
    await expect(page.locator('.case__metric')).toHaveCount(0);
  });

  test('the calls to action are real anchors with real destinations', async ({ page }) => {
    await page.goto('./');

    await expect(page.getByTestId('cta-primary')).toHaveAttribute('href', '/arajanlat.html');
    await expect(page.getByTestId('cta-primary-hero')).toHaveAttribute('href', '/arajanlat.html');
    await expect(page.getByTestId('cta-secondary')).toHaveAttribute('href', '#stage-selected-work');
    await expect(page.getByTestId('cta-contact')).toHaveAttribute('href', '/ugyfelszolgalat.html');
    await expect(page.getByTestId('cta-qualify')).toHaveAttribute('href', '/arajanlat.html');

    // Every in-page anchor resolves to an element that exists.
    const dangling = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="#"]')]
        .map((a) => (a as HTMLAnchorElement).getAttribute('href')!)
        .filter((h) => h.length > 1 && !document.querySelector(h)),
    );
    expect(dangling, 'anchors pointing at nothing').toEqual([]);
  });
});

// -----------------------------------------------------------------------------
test.describe('reduced motion', () => {
  test.beforeEach(({}, info) => {
    test.skip(isMotion(info.project.name), 'asserted in the reduced-motion project');
  });

  test('reads as a document and never downloads the renderer', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));

    await page.goto('./');

    // First, and non-negotiably: prove the environment is what this test says.
    await assertReducedMotionActive(page);

    await expect(page.getByTestId('journey-fallback')).toBeVisible();
    await expect(page.getByTestId('journey-fallback')).toHaveAttribute('data-reason', 'reduced-motion');
    await expect(page.locator('canvas')).toHaveCount(0);

    // The whole point of the lazy boundary: refusing the animation must also
    // refuse its download. 970 KB of renderer and a 397 KB model.
    await page.waitForTimeout(1500);
    const heavy = requested.filter((u) => /JourneyScene|three|gsap|ScrollTrigger|\.glb/i.test(u));
    expect(heavy, 'reduced motion must not fetch the 3D payload').toEqual([]);

    // And the document still reads, in full — not a stripped-down variant.
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByTestId('stage-destination')).toBeVisible();
    // Three, per §9.2 — see the note on the same list in "the content survives
    // without the canvas". Reduced motion must show the SAME three, which is
    // what makes the count worth asserting here too: this is the path where a
    // stripped-down variant would be easiest to ship by accident.
    for (const id of ['rapidkert', 'barbershop', 'mentaltrening']) {
      await expect(page.getByTestId(`case-${id}`)).toBeVisible();
    }
    await expect(page.locator('[data-testid^="case-"]')).toHaveCount(3);
  });

  test('hides no essential content and keeps every CTA usable', async ({ page }) => {
    await page.goto('./');
    await assertReducedMotionActive(page);

    // Nothing that carries meaning may be transparent, clipped or zero-sized on
    // this path. A reduced-motion page that "works" by hiding the copy that
    // would have animated in is the failure mode this asserts against.
    const faded = await page.evaluate(() =>
      [...document.querySelectorAll('.panel h1, .panel h2, .panel h3, .panel p, .panel a.btn, .case, .check')]
        .filter((el) => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return Number(cs.opacity) < 0.9 || cs.visibility === 'hidden' || r.height === 0;
        })
        .map((el) => el.tagName + '.' + (el.className || '')),
    );
    expect(faded, 'content hidden on the reduced-motion path').toEqual([]);

    // The track is un-stuck: an eleven-screen sticky pin is itself motion.
    const sticky = await page.evaluate(
      () => getComputedStyle(document.querySelector('.journey__stage')!).position,
    );
    expect(sticky).toBe('relative');

    // Every CTA is clickable, not merely present.
    for (const id of ['cta-primary', 'cta-secondary', 'cta-contact', 'cta-qualify', 'cta-primary-hero']) {
      await expect(page.getByTestId(id)).toBeEnabled();
    }
  });
});

// -----------------------------------------------------------------------------
test.describe('capability fallbacks', () => {
  test('falls back to the static instrument when WebGL cannot be created', async ({ page }, info) => {
    test.skip(!isMotion(info.project.name), 'covered by the reduced-motion path');

    // Deny WebGL the way a blocklisted driver does: the constructor is still
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

    await page.goto('./');
    await expect(page.getByTestId('journey-fallback')).toBeVisible();
    await expect(page.getByTestId('journey-fallback')).toHaveAttribute('data-reason', 'no-webgl');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByTestId('altitude-hud')).toBeVisible();

    // No WebGL means no renderer download either.
    await page.waitForTimeout(1200);
    expect(requested.filter((u) => /JourneyScene|\.glb/i.test(u))).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// Build-level assertions. These read the emitted files rather than the network,
// because the failure they guard against — a manualChunks entry hoisting the
// renderer above the dynamic-import boundary — leaves the import dynamic and so
// passes every runtime lazy-loading test while still emitting a modulepreload.
test.describe('the build keeps the renderer lazy', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'desktop', 'inspected once, not per viewport');
  });

  test('three.js is absent from the eager entry and never preloaded', async () => {
    const html = await readFile(resolve(DIST, 'index.html'), 'utf8');
    const files = await readdir(resolve(DIST, 'assets'));

    // 1. The document must reference exactly one script, and it must not be the
    //    scene chunk.
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).not.toMatch(/JourneyScene/);

    // 2. Nothing is modulepreloaded. A modulepreload of unused 3D code is not
    //    acceptable — it costs the bytes it was supposed to save.
    const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(preloads.filter((p) => /JourneyScene|three/i.test(p))).toEqual([]);

    // 3. The eager chunk must not contain three.js. Checked by content, not by
    //    filename, because the filename is a hash.
    const entry = scripts[0].split('/').pop()!;
    const eager = await readFile(resolve(DIST, 'assets', entry), 'utf8');
    for (const marker of ['WebGLRenderer', 'BufferGeometry', 'PerspectiveCamera']) {
      expect(eager.includes(marker), `${marker} leaked into the eager chunk`).toBe(false);
    }

    // 4. And the scene chunk must exist and actually contain it, so that a
    //    passing test above cannot mean "three.js is nowhere at all".
    const scene = files.find((f) => f.startsWith('JourneyScene'));
    expect(scene, 'no scene chunk was emitted').toBeTruthy();
    const sceneCode = await readFile(resolve(DIST, 'assets', scene!), 'utf8');
    expect(sceneCode.includes('WebGLRenderer')).toBe(true);

    // 5. The dev-only debug panel is not in the production build at all.
    expect(files.some((f) => /DebugPanel/i.test(f)), 'debug panel chunk emitted').toBe(false);
    expect(eager.includes('Ascent debug')).toBe(false);
  });

  test('no secrets and no Web3Forms references reached the bundle', async () => {
    // Assembled from fragments rather than written as literals.
    //
    // `npm run scan:secrets` greps the whole repository for exactly these
    // strings, and a spec file that spells them out to assert their *absence*
    // is reported as a finding — a scanner that cries wolf about its own test
    // is a scanner people start ignoring. Splitting the tokens keeps this test
    // honest and the scan clean.
    const forbidden = [
      new RegExp(['service', '_role'].join(''), 'i'),
      new RegExp(['SUPABASE', '_SERVICE'].join(''), 'i'),
      new RegExp(['web3', 'forms'].join(''), 'i'),
    ];

    const files = await readdir(resolve(DIST, 'assets'));
    for (const f of files) {
      const body = await readFile(resolve(DIST, 'assets', f), 'utf8');
      for (const pattern of forbidden) {
        expect(body, `${pattern.source} found in ${f}`).not.toMatch(pattern);
      }
    }
  });
});

// -----------------------------------------------------------------------------
// The mobile sticky handoff. This is the specific defect the brief called out
// in the prototype, and these are the assertions that say it is fixed.
test.describe('the sticky handoff into the final CTA', () => {
  test.beforeEach(({}, info) => {
    test.skip(!isMobile(info.project.name), 'a mobile layout problem');
  });

  test('the CTA arrives over the scene, with no gap and no footer collision', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });

    await scrollTo(page, 1);

    const geometry = await page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
      const cta = r('[data-testid="stage-destination"]');
      const stage = r('.journey__stage');
      const footer = r('.journey__footer');
      const canvas = r('canvas');
      return {
        ctaTop: cta?.top ?? null,
        ctaBottom: cta?.bottom ?? null,
        stageTop: stage?.top ?? null,
        stageBottom: stage?.bottom ?? null,
        footerTop: footer?.top ?? null,
        canvasVisible: !!canvas && canvas.height > 0,
        viewport: innerHeight,
      };
    });

    // The scene is still behind the CTA — that is the fix. If the stage had
    // released, its bottom would be above the viewport top.
    expect(geometry.canvasVisible).toBe(true);
    expect(geometry.stageBottom, 'the sticky scene released before the CTA').toBeGreaterThan(0);

    // No blank gap between the end of the CTA panel and the footer.
    if (geometry.ctaBottom !== null && geometry.footerTop !== null) {
      expect(Math.abs(geometry.footerTop - geometry.ctaBottom)).toBeLessThanOrEqual(2);
    }

    // The CTA is on screen and the primary action is tappable, not under the
    // footer and not under the HUD.
    const cta = page.getByTestId('cta-primary');
    await expect(cta).toBeInViewport();
    const box = (await cta.boundingBox())!;
    expect(box.height, 'tap target below 44px').toBeGreaterThanOrEqual(44);
  });

  test('scrolling to the very end is not trapped and does not jump', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });

    // Walk the last stretch in small steps and watch for a discontinuity: a
    // sticky release that snaps shows up as the stage's top jumping by more
    // than the scroll delta.
    const jumps = await page.evaluate(async () => {
      const track = document.querySelector('[data-testid="journey-track"]') as HTMLElement;
      const travel = track.offsetHeight - innerHeight;
      const out: number[] = [];
      let previousTop: number | null = null;
      for (let f = 0.9; f <= 1.0001; f += 0.01) {
        scrollTo({ top: track.offsetTop + travel * f, behavior: 'instant' as ScrollBehavior });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const top = document.querySelector('.journey__stage')!.getBoundingClientRect().top;
        if (previousTop !== null) out.push(Math.abs(top - previousTop));
        previousTop = top;
      }
      return out;
    });

    // Every step is one hundredth of the track; the sticky stage should not
    // move relative to the viewport at all until it releases at the footer.
    for (const jump of jumps) {
      expect(jump, 'the sticky stage jumped mid-handoff').toBeLessThan(120);
    }

    // And the document actually ends — no trapped scroll.
    const atEnd = await page.evaluate(() => {
      scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' as ScrollBehavior });
      return Math.abs(
        document.documentElement.scrollHeight - innerHeight - Math.round(scrollY),
      );
    });
    expect(atEnd).toBeLessThanOrEqual(2);
  });

  test('no canvas/text overlap and no viewport overflow at any stage', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });

    // Measured at each stage's *resting* position — the panel centred, which is
    // where a visitor stops to read. Content briefly passing under the HUD strip
    // mid-scroll is not a defect: the strip is opaque and occludes it, the same
    // way any fixed header does. What would be a defect is content that comes to
    // rest underneath it, and that is what this checks.
    for (const stage of STAGES) {
      await scrollToStage(page, stage.id);
      const bad = await page.evaluate(() => {
        const out: string[] = [];

        // The rect an element is *painted* at: its border box intersected with
        // every clipping ancestor.
        //
        // `getBoundingClientRect` ignores `overflow` entirely, so an element
        // scrolled out of a clipped region still reports the position it would
        // occupy if the region were unbounded. The portrait composition has one
        // such region by design — the flow band is a window onto copy taller
        // than itself — and measured against the raw rect the paragraph that has
        // been scrolled up out of that window reports y=36 while the window it
        // lives in starts at y=338. The check then reports the altitude readout
        // as covering a paragraph that is not on screen at all.
        //
        // This makes the assertion stricter about what it means, not weaker: an
        // element clipped entirely away contributes no pixels to the frame, and
        // the same reasoning is already written down in validate-meridian.mjs,
        // which measures the same overlap from the instrument's side.
        const painted = (el: Element) => {
          const r = el.getBoundingClientRect();
          let [left, top, right, bottom] = [r.left, r.top, r.right, r.bottom];
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const cs = getComputedStyle(p);
            const pr = p.getBoundingClientRect();
            if (cs.overflowX !== 'visible') {
              left = Math.max(left, pr.left);
              right = Math.min(right, pr.right);
            }
            if (cs.overflowY !== 'visible') {
              top = Math.max(top, pr.top);
              bottom = Math.min(bottom, pr.bottom);
            }
          }
          return { left, top, right, bottom, width: right - left, height: bottom - top };
        };

        // Every visible panel plate must sit inside the viewport horizontally.
        for (const el of document.querySelectorAll('.panel__inner')) {
          const r = el.getBoundingClientRect();
          if (r.bottom < 0 || r.top > innerHeight) continue;
          if (r.left < -1 || r.right > innerWidth + 1) out.push(`overflow ${Math.round(r.left)}..${Math.round(r.right)}`);
        }
        // The HUD must not print itself across anything a visitor has to read.
        // Headings included — checking only buttons is what let the readout sit
        // straight through the closing headline on a 390px screen.
        const hudEl = document.querySelector('.hud') as HTMLElement | null;
        const hud = hudEl?.getBoundingClientRect();
        // A HUD faded out of the way is not an overlap.
        const hudVisible = hudEl && Number(getComputedStyle(hudEl).opacity) > 0.05;
        if (hud && hudVisible) {
          // Something painted at zero opacity is not something the readout is
          // covering. The portrait composition hands over between stages by
          // fading one plate out and the next in, so at any stage's resting
          // position the neighbouring plates are still in the document, still
          // in the accessibility tree — which is the point of using `opacity`
          // rather than `display` — and contributing no pixels. The same guard,
          // including the walk up the ancestors, is in validate-meridian.mjs.
          const invisible = (el: Element) => {
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return true;
            for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
              if (Number(getComputedStyle(p).opacity) < 0.05) return true;
            }
            return false;
          };

          for (const el of document.querySelectorAll('a.btn, .panel h1, .panel h2, .panel__lead')) {
            const r = painted(el);
            if (r.height <= 0 || r.width <= 0) continue;
            if (invisible(el)) continue;
            // Only elements *wholly* on screen count. Something straddling the
            // viewport edge is being scrolled past, not read — a plate taller
            // than the viewport cannot have all of its content at rest at once
            // — and the strip is opaque, so it occludes rather than tangles.
            if (r.top < 0 || r.bottom > innerHeight) continue;
            const overlaps =
              r.left < hud.right && r.right > hud.left && r.top < hud.bottom && r.bottom > hud.top;
            if (overlaps) out.push(`hud covers "${el.textContent?.trim().slice(0, 28)}"`);
          }
        }
        return out;
      });
      expect(bad, `layout problems at stage ${stage.id}`).toEqual([]);
    }
  });
});

// -----------------------------------------------------------------------------
// The instrument.
//
// Two halves, and the split is deliberate.
//
// The first half tests `meridian.ts` as what it is: a pure function from metres
// to a mechanical state, imported straight into Node. No browser, no canvas, no
// timing. Every claim the brief makes about the object that can be settled by
// arithmetic — the aperture's three calibrated stops, the ring locks happening
// in order and only at their altitudes, all three rings sharing one gesture,
// nothing overshooting, the whole thing reproducing identically in reverse — is
// settled here, exactly, rather than inferred from a screenshot.
//
// The second half tests what a visitor actually gets, against the *built* page:
// the readout, the announced structural stage, and the round trip back to zero.
// Those cannot be arithmetic, because the bug they exist to catch was not in the
// arithmetic — it was in the scroll-to-altitude calibration underneath it.
// -----------------------------------------------------------------------------
test.describe('Altimeter Meridian — the instrument', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'desktop', 'device-independent; running it once is the point');
  });

  test('the aperture holds three exact settings and nothing between them drifts', () => {
    // 0 m is a calibrated slit, not a closed hole and not a missing asset.
    expect(apertureOpen(0)).toBeCloseTo(0.055, 6);
    // 12 000 m is fully open, exactly. The breakthrough lands on a stop.
    expect(apertureOpen(ALTITUDE_STOPS.breakthrough)).toBeCloseTo(1, 6);
    // 30 000 m stops back down to the calibrated setting: precision, not maximum
    // exposure. This is the whole point of the final act.
    expect(apertureOpen(ALTITUDE_STOPS.meridian)).toBeCloseTo(FINAL_CALIBRATED_OPEN, 6);
    expect(FINAL_CALIBRATED_OPEN).toBeLessThan(1);

    // Monotone up to the snap and monotone back down to the setting, with no
    // wobble anywhere in between. A non-monotone aperture is one that opens
    // slightly while it is closing, which reads as a mechanism hunting for a
    // value rather than moving to one.
    const sample = (from: number, to: number) =>
      Array.from({ length: 201 }, (_, i) => apertureOpen(from + ((to - from) * i) / 200));

    const rising = sample(0, ALTITUDE_STOPS.breakthrough);
    for (let i = 1; i < rising.length; i++) expect(rising[i]).toBeGreaterThanOrEqual(rising[i - 1] - 1e-9);

    const falling = sample(ALTITUDE_STOPS.thirdRing, ALTITUDE_STOPS.meridian);
    for (let i = 1; i < falling.length; i++) expect(falling[i]).toBeLessThanOrEqual(falling[i - 1] + 1e-9);

    // And it holds wide open across the whole expansion between the two events,
    // rather than sagging towards the stop-down early.
    for (const m of [12_500, 15_000, 18_000, 21_000, 24_000]) expect(apertureOpen(m)).toBeCloseTo(1, 6);
  });

  test('the iris closes without a gap and opens without one', () => {
    // The hole is never actually zero: a real diaphragm bottoms out on a slit,
    // and a zero here would render as the blades meeting at a point.
    expect(irisHoleRadius(0)).toBeGreaterThan(0);
    expect(irisHoleRadius(1)).toBeGreaterThan(irisHoleRadius(0) * 5);

    // Strictly increasing, so every intermediate opening is a real setting and
    // the blades never reverse mid-travel.
    let previous = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const r = irisHoleRadius(i / 100);
      expect(r).toBeGreaterThan(previous);
      previous = r;
    }

    // The plate has to stay clear of the two things the dial already says. See
    // the bounds table in meridianParts.
    expect(IRIS.retainerOuter).toBeLessThan(0.114); // the ALTITUDE legend
    expect(IRIS.retainerTopZ).toBeLessThan(0.061); // the secondary needle
    expect(IRIS.blades).toBeGreaterThanOrEqual(7);
    expect(IRIS.blades).toBeLessThanOrEqual(11);
  });

  test('the rings lock in order, one at a time, each at its own altitude', () => {
    const state = createMeridianState();
    const settleAt = (m: number) => meridianState(m, 0, state).rings.map((r) => r.settle);

    // Seated at the baseline.
    expect(settleAt(ALTITUDE_STOPS.baseline)).toEqual([0, 0, 0]);
    // And still seated at the first signal: nothing separates before 3 000 m.
    expect(settleAt(ALTITUDE_STOPS.firstSignal)).toEqual([0, 0, 0]);

    // One ring per headline altitude, and never two at once.
    const locked = (m: number) => settleAt(m).map((s) => s > 0.995);
    expect(locked(ALTITUDE_STOPS.firstRing)).toEqual([true, false, false]);
    expect(locked(ALTITUDE_STOPS.secondRing)).toEqual([true, true, false]);
    expect(locked(ALTITUDE_STOPS.thirdRing)).toEqual([true, true, true]);
    expect(locked(ALTITUDE_STOPS.meridian)).toEqual([true, true, true]);

    // No two rings are ever in motion together. The brief asks for stillness
    // between events, and the cheapest way to lose it is to let the next ring
    // start unseating while the previous one is still travelling.
    for (const [i, ring] of RINGS.entries()) {
      if (i === 0) continue;
      expect(ring.startAltitude, `${ring.id} starts before ${RINGS[i - 1].id} locks`).toBeGreaterThanOrEqual(
        RINGS[i - 1].endAltitude,
      );
    }

    // Mass increases outward, speed decreases outward. This is the ordering that
    // makes the third lock read as the heaviest rather than merely the last.
    expect(RINGS[0].massFactor).toBeLessThan(RINGS[1].massFactor);
    expect(RINGS[1].massFactor).toBeLessThan(RINGS[2].massFactor);
    expect(RINGS[0].idleRate).toBeGreaterThan(RINGS[1].idleRate);
    expect(RINGS[1].idleRate).toBeGreaterThan(RINGS[2].idleRate);
    // And the last ring is the largest once it has locked.
    expect(RINGS[2].finalScale).toBeGreaterThan(RINGS[1].finalScale);
    expect(RINGS[2].finalScale).toBeGreaterThan(RINGS[0].finalScale);
  });

  test('all three rings perform the same lock gesture, and none of them bounces', () => {
    for (const cfg of RINGS) {
      const at = (u: number) =>
        ringLock(cfg.startAltitude + (cfg.endAltitude - cfg.startAltitude) * u, cfg);

      // The shared four-phase rhythm: seam, lift, hold, travel.
      expect(at(0.1).lift, `${cfg.id} moved during the seam phase`).toBe(0);
      expect(at(0.1).settle).toBe(0);

      expect(at(0.35).lift, `${cfg.id} did not lift`).toBeGreaterThan(0);
      expect(at(0.35).settle, `${cfg.id} tilted before it had risen`).toBe(0);

      // The hold. Risen, stopped, not yet travelling — the eight percent that
      // makes the lift and the tilt read as two events rather than one swoop.
      expect(at(0.5).lift).toBe(1);
      expect(at(0.5).settle).toBe(0);

      expect(at(1).settle, `${cfg.id} did not arrive`).toBeCloseTo(1, 6);
      expect(at(1).locked).toBe(true);

      // Monotone and bounded in both channels: no overshoot, no corrective
      // rebound, nothing that ever exceeds its target and comes back.
      let lift = -Infinity;
      let settle = -Infinity;
      for (let i = 0; i <= 200; i++) {
        const s = at(i / 200);
        expect(s.lift).toBeGreaterThanOrEqual(lift - 1e-9);
        expect(s.settle).toBeGreaterThanOrEqual(settle - 1e-9);
        expect(s.lift).toBeLessThanOrEqual(1);
        expect(s.settle).toBeLessThanOrEqual(1);
        lift = s.lift;
        settle = s.settle;
      }
    }
  });

  test('the whole instrument state is a pure function of altitude, in both directions', () => {
    const snapshot = (m: number, out: ReturnType<typeof createMeridianState>) =>
      JSON.stringify(meridianState(m, 0, out));

    // Two independent state objects, walked in opposite directions through the
    // same 301 altitudes. Anything that accumulated — a "has this fired" flag, a
    // velocity, a spin — would make the descending pass disagree with the
    // ascending one, which is exactly the class of bug that makes reverse
    // scrolling leave a scene in a state it can never have arrived at forwards.
    const up = createMeridianState();
    const down = createMeridianState();
    const metres = Array.from({ length: 301 }, (_, i) => (i / 300) * ALTITUDE_STOPS.meridian);

    const ascending = metres.map((m) => snapshot(m, up));
    const descending: string[] = [];
    for (let i = metres.length - 1; i >= 0; i--) descending[i] = snapshot(metres[i], down);

    expect(descending).toEqual(ascending);

    // Out-of-range input is clamped rather than extrapolated: a rubber-band
    // scroll past either end must not drive the instrument past its stops.
    expect(snapshot(-5_000, up)).toEqual(snapshot(0, down));
    expect(snapshot(90_000, up)).toEqual(snapshot(ALTITUDE_STOPS.meridian, down));

    // And nothing anywhere in the range is NaN — a NaN in a transform removes an
    // object from the scene silently instead of throwing.
    for (const frame of ascending) expect(frame).not.toContain('null');
  });

  test('the six announced stages cover the range and never run backwards', () => {
    expect(MERIDIAN_STAGES.map((s) => s.id)).toEqual([
      'baseline',
      'first-ring',
      'aperture-open',
      'second-ring',
      'third-ring',
      'meridian',
    ]);

    let previous = -1;
    for (let m = 0; m <= ALTITUDE_STOPS.meridian; m += 50) {
      const index = MERIDIAN_STAGES.findIndex((s) => s.id === meridianStageAt(m).id);
      expect(index, `no stage at ${m} m`).toBeGreaterThanOrEqual(0);
      expect(index, `stage went backwards at ${m} m`).toBeGreaterThanOrEqual(previous);
      previous = index;
    }
    expect(previous).toBe(MERIDIAN_STAGES.length - 1);
  });
});

// -----------------------------------------------------------------------------
// The two determinism defects Phase 5C closed. Both are arithmetic, and both
// were invisible in a still — which is precisely why they need a test rather
// than another screenshot.
// -----------------------------------------------------------------------------
test.describe('the mountain range — the hide boundary and the root transform', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'desktop', 'arithmetic; running it once is the point');
  });

  /** Where the journey camera actually sits. See JourneyScene's camera prop. */
  const CAMERA: [number, number, number] = [0, -0.1, 2.35];
  const VARIANTS = ['desktop', 'mobile'] as const;
  const root = (m: number, v: (typeof VARIANTS)[number]) =>
    mountainRootTransform(mountainStateAt(m, v), CAMERA);

  test('the canonical root transform exists at every altitude the range is mounted at', () => {
    // The defect: `useFrame` returned early on `!visible` *before* writing the
    // transform, so a hidden root kept whatever it last had. Coming down from
    // above, "whatever it last had" is the world origin, because the component
    // mounts at 13 600 m and stays hidden until roughly 11 988 m — 1 600 m of
    // reverse travel with the range parked at (0, 0, 0) instead of at its
    // camera station. Nothing is drawn there, so no still shows it; what it
    // breaks is the claim that an altitude reconstructs one state.
    //
    // This asserts the property the fix restores: the transform is a total
    // function of altitude over the whole residency band, including the part of
    // it where the range is not drawn.
    for (const variant of VARIANTS) {
      for (let m = 0; m <= UNMOUNT_ABOVE; m += 25) {
        const t = root(m, variant);
        for (const axis of t.position) expect(Number.isFinite(axis), `position at ${m} m`).toBe(true);
        expect(t.scale).toBe(MOUNTAIN_SCALE);
        // Never the world origin, which is what an unwritten root reads as.
        // The Blender station is never lower than 200 model metres, so the
        // root's Y is always at least two scene units below the camera and can
        // never be zero — a root at Y ≈ 0 means nothing wrote to it.
        expect(t.position[1], `root sat at the origin at ${m} m`).toBeLessThan(-1.5);
      }
    }
  });

  test('just below, exactly at, and just above the hide boundary', () => {
    for (const variant of VARIANTS) {
      const below = root(HIDE_ABOVE - 1, variant);
      const at = root(HIDE_ABOVE, variant);
      const above = root(HIDE_ABOVE + 1, variant);

      // The boundary is a residency boundary, not a picture boundary. Opacity
      // reached zero at 12 000 m, four hundred metres below it, so all three of
      // these are already undrawn and the crossing changes nothing visible.
      expect(below.visible).toBe(false);
      expect(at.visible).toBe(false);
      expect(above.visible).toBe(false);
      expect(below.opacity).toBe(0);

      // And the transform is continuous through it. One metre of altitude moves
      // the root by less than a thousandth of a scene unit on every axis, so
      // there is no one-frame jump available at the crossing whatever else
      // changes there.
      for (let axis = 0; axis < 3; axis++) {
        expect(Math.abs(at.position[axis] - below.position[axis])).toBeLessThan(1e-3);
        expect(Math.abs(above.position[axis] - at.position[axis])).toBeLessThan(1e-3);
      }
    }
  });

  test('crossing below 12 000 m introduces no discontinuity', () => {
    // The altitude the brief names. The range fades out over 10 800–12 000 m
    // and `visible` follows the opacity, so this is where a stale transform
    // would actually surface as a jump: the frame it is switched back on is the
    // first frame anyone can see it.
    for (const variant of VARIANTS) {
      let previous = root(11_900, variant);
      for (let m = 11_900; m <= 12_100; m += 1) {
        const now = root(m, variant);
        for (let axis = 0; axis < 3; axis++) {
          expect(
            Math.abs(now.position[axis] - previous.position[axis]),
            `${variant} jumped on axis ${axis} at ${m} m`
          ).toBeLessThan(1e-3);
        }
        previous = now;
      }
    }
  });

  test('reverse re-entry reconstructs the forward transform exactly', () => {
    // The whole point. Two sweeps over the same altitudes in opposite
    // directions, compared as strings so a difference anywhere in the transform
    // — position, scale, visibility or opacity — fails rather than only the
    // component someone thought to assert.
    const metres = Array.from({ length: 561 }, (_, i) => 11_000 + i * 5); // 11 000 → 13 800
    for (const variant of VARIANTS) {
      const ascending = metres.map((m) => JSON.stringify(root(m, variant)));
      const descending: string[] = [];
      for (let i = metres.length - 1; i >= 0; i--) descending[i] = JSON.stringify(root(metres[i], variant));
      expect(descending).toEqual(ascending);
    }

    // The station itself is the thing that has to be direction-free, and it is
    // a pure function of altitude with no state to carry — asserted here rather
    // than assumed, because the early return above was exactly a way for a pure
    // function to stop being applied.
    for (const variant of VARIANTS) {
      expect(cameraStation(12_000, variant)).toEqual(cameraStation(12_000, variant));
      expect(cameraStation(HIDE_ABOVE, variant)).toEqual(cameraStation(HIDE_ABOVE, variant));
    }
  });

  test('nothing is drawn while hidden, and nothing is mounted above the unmount threshold', () => {
    for (const variant of VARIANTS) {
      // Visible implies a non-zero opacity, and zero opacity implies not drawn.
      for (let m = 0; m <= UNMOUNT_ABOVE + 500; m += 10) {
        const s = mountainStateAt(m, variant);
        if (s.visible) expect(s.opacity, `drawn at zero opacity at ${m} m`).toBeGreaterThan(0.001);
        if (s.opacity <= 0.001) expect(s.visible, `drawn while transparent at ${m} m`).toBe(false);
        if (m > HIDE_ABOVE) expect(s.visible, `still drawn at ${m} m`).toBe(false);
        if (m > UNMOUNT_ABOVE) expect(s.resident, `still resident at ${m} m`).toBe(false);
      }
      // The two thresholds keep their ordering: hidden first, unmounted later,
      // so the unmount is never the thing a visitor sees.
      expect(HIDE_ABOVE).toBeLessThan(UNMOUNT_ABOVE);
    }
  });
});

// -----------------------------------------------------------------------------
test.describe('the journey stage is a function of altitude alone', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'desktop', 'arithmetic; running it once is the point');
  });

  test('3 000 m resolves the same way from either direction', () => {
    // The defect, exactly: at 3 000 m the desktop page could report
    // `initial-ascent` or `lower-atmosphere` depending on which way the visitor
    // was scrolling, because the rule was keyed on progress with a closed
    // interval on both sides and the damped progress landed on either side of
    // the boundary by an ulp.
    expect(stageAtAltitude(2_999.999)).toBe('initial-ascent');
    expect(stageAtAltitude(3_000)).toBe('lower-atmosphere');
    expect(stageAtAltitude(3_000.001)).toBe('lower-atmosphere');

    // The interval that starts at a boundary owns it — [from, to) — at every
    // boundary, not only the one that was reported.
    for (const stage of STAGES) {
      if (stage.from === 0) continue;
      expect(stageAtAltitude(stage.from), `${stage.id} does not own its own floor`).toBe(stage.id);
      expect(stageAtAltitude(stage.from - 1e-6), `${stage.id} claimed the metre below it`).not.toBe(stage.id);
    }
  });

  test('a forward sweep and a reverse sweep agree at every altitude', () => {
    // Every boundary, plus a dense sweep, walked in both directions. A stage
    // rule that depended on how it got there — a hysteresis band, a last-value
    // cache, a progress comparison — fails here and passes a single-direction
    // test, which is how the 3 000 m defect survived.
    const metres = [
      ...STAGES.flatMap((s) => [s.from - 1e-6, s.from, s.from + 1e-6]),
      ...Array.from({ length: 1_201 }, (_, i) => i * 25),
    ].filter((m) => m >= 0 && m <= 30_000);
    metres.sort((a, b) => a - b);

    const up = metres.map(stageAtAltitude);
    const down: StageId[] = [];
    for (let i = metres.length - 1; i >= 0; i--) down[i] = stageAtAltitude(metres[i]);
    expect(down).toEqual(up);

    // And it never runs backwards: the stage index is monotonic in altitude, so
    // no scroll position can announce a stage the visitor has already left.
    const order = STAGES.map((s) => s.id);
    let previous = -1;
    for (let i = 0; i < metres.length; i++) {
      const index = order.indexOf(up[i]);
      expect(index, `no stage at ${metres[i]} m`).toBeGreaterThanOrEqual(0);
      expect(index, `stage went backwards at ${metres[i]} m`).toBeGreaterThanOrEqual(previous);
      previous = index;
    }
    expect(order[previous]).toBe('destination');
  });

  test('the progress-keyed helper is the altitude rule, not a second copy of it', () => {
    // `stageAt(progress)` used to be the implementation. It is now a composition
    // — progress to metres through the one piecewise map, metres to a stage
    // through the one canonical rule — and this is what stops the thresholds
    // drifting apart again.
    for (let i = 0; i <= 2_000; i++) {
      const p = i / 2_000;
      expect(stageAt(p), `disagreement at progress ${p}`).toBe(stageAtAltitude(altitudeAt(p)));
    }

    // Out of range on both sides is clamped, not extrapolated.
    expect(stageAtAltitude(-5_000)).toBe(STAGES[0].id);
    expect(stageAtAltitude(90_000)).toBe(STAGES[STAGES.length - 1].id);
  });
});

// -----------------------------------------------------------------------------
test.describe('Altimeter Meridian — as the visitor gets it', () => {
  /** The structural stage the HUD is currently announcing. */
  const announced = (page: Page) =>
    page.getByTestId('altitude-hud').evaluate((el) => (el as HTMLElement).dataset.meridian ?? '');

  test('scrolling down and back up returns the instrument to its 0 m baseline', async ({ page }, info) => {
    test.skip(info.project.name === 'reduced-motion', 'the fallback has no scroll-driven clock');
    await page.goto('./');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });

    // A regression test with a specific bug behind it. The stage boundaries are
    // measured off the real layout, and the calibration panel is exactly one
    // viewport tall — so measuring a stage's end as "its bottom reaches the
    // bottom of the viewport" made that stage exactly zero scroll wide. The
    // altitude map then skipped it for any progress above zero, and because the
    // eased progress approaches zero asymptotically and never lands on it, a
    // visitor who scrolled down and came back settled at 150 m in the *second*
    // stage. The baseline state was unreachable after any scroll at all.
    const walk = async (to: number) => {
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let i = 0; i <= 24; i++) {
        const from = to === 1 ? i / 24 : 1 - i / 24;
        await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), height * from);
        await page.waitForTimeout(90);
      }
      await page.waitForTimeout(2_600); // let the damped clock settle
    };

    await walk(1);
    expect(await announced(page)).toBe('meridian');

    await walk(0);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await expect(page.getByTestId('altitude-value')).toHaveText('0');
    expect(await announced(page)).toBe('baseline');
    await expect(page.getByTestId('altitude-stage')).toHaveText(STAGES[0].label);
  });

  test('the altitude climbs continuously, with no stage boundary that stalls it', async ({ page }, info) => {
    test.skip(info.project.name === 'reduced-motion', 'the fallback has no scroll-driven clock');
    await page.goto('./');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });

    // The other half of the same defect. Measured ends fell one viewport short
    // of the next stage's start, so the bounds did not tile the track and the
    // altitude map answered each of the eleven gaps with the next stage's floor
    // — a screen of scrolling at every boundary that moved the altitude not at
    // all. Sampling the real page is the only way to see it: the arithmetic in
    // meridian.ts was correct the whole time.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const read = () =>
      page.getByTestId('altitude-value').evaluate((el) => Number((el.textContent ?? '').replace(/\D/g, '')));

    let previous = -1;
    for (let i = 0; i <= 20; i++) {
      await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), (height * i) / 20);
      await page.waitForTimeout(950);
      const metres = await read();
      if (i > 0 && previous < 30_000) {
        expect(metres, `the altitude stalled at ${(i * 5).toFixed(0)}% of the track`).toBeGreaterThan(previous);
      }
      previous = metres;
    }
    expect(previous).toBe(30_000);
  });

  test('the structural stages are announced in order, and unwound in reverse', async ({ page }, info) => {
    test.skip(info.project.name === 'reduced-motion', 'the fallback announces its own discrete states');

    // Recorded by the page rather than sampled by the test. Polling from Node
    // is both slower and less accurate: every sample costs a round trip, and
    // the sampling rate — not the page — decides whether a short stage is seen
    // at all. A MutationObserver on the one attribute the HUD publishes catches
    // every transition exactly once, at full frame rate, for one round trip in
    // total.
    await page.addInitScript(() => {
      const w = window as unknown as { __meridianLog: string[] };
      w.__meridianLog = [];
      const attach = () => {
        const hud = document.querySelector('[data-testid="altitude-hud"]') as HTMLElement | null;
        if (!hud) return void requestAnimationFrame(attach);
        const record = () => {
          const value = hud.dataset.meridian;
          if (value && w.__meridianLog[w.__meridianLog.length - 1] !== value) w.__meridianLog.push(value);
        };
        record();
        new MutationObserver(record).observe(hud, { attributes: true, attributeFilter: ['data-meridian'] });
      };
      attach();
    });

    await page.goto('./');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('altitude-hud')).toHaveAttribute('data-meridian', 'baseline');

    // Scrolled in sixteen steps rather than jumped, and that is a statement
    // about what is being tested rather than caution.
    //
    // The clock damps by up to 45% of the remaining distance in a single tick
    // when a frame runs long, so a one-shot jump from the bottom of the page to
    // the top can cross two structural boundaries between two frames and
    // legitimately announce neither — the instrument really did pass through
    // both, in about a third of a second, and a live region that read them out
    // would be noise. That is correct behaviour for a Home keypress and it is
    // not what this test is about. Sixteen steps is an ordinary scroll, which is
    // the case where every state has to be reachable and observable.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const sweep = async (to: 'bottom' | 'top') => {
      await page.evaluate((from) => {
        const w = window as unknown as { __meridianLog: string[] };
        // Seeded with where the instrument already is, so the recorded list is
        // the whole path rather than everything after the first transition.
        w.__meridianLog = [from];
      }, to === 'bottom' ? 'baseline' : 'meridian');

      for (let i = 1; i <= 16; i++) {
        const at = to === 'bottom' ? i / 16 : 1 - i / 16;
        await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), height * at);
        await page.waitForTimeout(340);
      }
      await page.waitForTimeout(3_000);
      return page.evaluate(() => (window as unknown as { __meridianLog: string[] }).__meridianLog);
    };

    const order = MERIDIAN_STAGES.map((s) => s.id);
    // Every stage, in order, with nothing skipped and nothing repeated: the
    // instrument passed through all six structural states on the way up.
    expect(await sweep('bottom')).toEqual(order);
    // And the same six in reverse on the way down — the rings unlock and the
    // aperture closes rather than the scene being left in a top-of-page state
    // that still has three rings locked in it.
    expect(await sweep('top')).toEqual([...order].reverse());
  });

  test('the stage announced at a scroll position does not depend on the direction', async ({ page }, info) => {
    test.skip(info.project.name === 'reduced-motion', 'the fallback has no scroll-driven stage label');
    // Twenty settles, each of which now waits for the instrument to stop rather
    // than for a fixed 1.7 s. On a real GPU that is quicker than the old flat
    // wait; on a software rasteriser it is honest about how long convergence
    // actually takes, and the default 120 s is not enough room for that.
    test.setTimeout(300_000);

    // The page-level half of the 3 000 m fix, and the half that covers mobile:
    // the arithmetic tests run once on desktop, and this one runs on all four
    // real viewports, where the boundaries are *measured off the layout* rather
    // than seeded from the stage shares. A rule that resolved the stage from
    // progress is exactly the one a different layout can move.
    await page.goto('./');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_200);

    // Walk the whole track once before measuring anything.
    //
    // Not caution — the first version of this test failed on it, twice, at two
    // different boundaries, and the failure was real but was not the defect
    // under test. The case-study imagery is lazily decoded, so scrolling into
    // the upper half grows those panels, `useStageCalibration` re-measures, and
    // the map from scroll position to altitude *changes underneath the test*.
    // The same scrollY then legitimately reports two different altitudes,
    // which is a layout event rather than a direction dependency. Warming the
    // track first, and waiting for the document height to stop moving, is what
    // makes "the same scroll position" mean the same thing in both phases.
    const settledHeight = async () => {
      let previous = -1;
      for (let i = 0; i < 40; i++) {
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        if (height === previous) return height;
        previous = height;
        await page.waitForTimeout(250);
      }
      return previous;
    };
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let i = 0; i <= 12; i++) {
      await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), (height * i) / 12);
      await page.waitForTimeout(220);
    }
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }));
    await settledHeight();
    await page.waitForTimeout(1_700);

    // Where each stage's panel starts, on this viewport. These are the scroll
    // positions the boundaries actually land on here.
    const boundaries = await page.evaluate((ids) => {
      const track = document.querySelector('[data-testid="journey-track"]') as HTMLElement | null;
      const travel = (track?.offsetHeight ?? document.documentElement.scrollHeight) - innerHeight;
      const top = track?.offsetTop ?? 0;
      return ids
        .map((id) => document.getElementById(`stage-${id}`))
        .filter((el): el is HTMLElement => !!el)
        .map((el) => top + Math.round(el.getBoundingClientRect().top + scrollY - top))
        .filter((y) => y > 0 && y < top + travel);
    }, STAGES.map((s) => s.id));
    expect(boundaries.length).toBeGreaterThan(4);

    // Five of them, not all eleven. Each one costs four full settles of the
    // damped clock in the two directions, and the boundaries are not
    // independent experiments — they are the same rule evaluated at different
    // altitudes. The `lower-atmosphere` boundary at 3 000 m, the one the defect
    // was reported at, is always among them because it is the third.
    const sampled = boundaries.slice(1, 6);

    // Wait for the damper to have *provably* arrived, rather than for a fixed
    // number of milliseconds.
    //
    // This was a flat 1.7 s, which is a statement about hardware rather than
    // about the journey, and it is why this test failed. `advance` moves
    // `journey.current` a fixed fraction of the remaining distance per frame,
    // so how long convergence takes is a function of the frame rate — measured
    // here at 39 fps on the mobile projects and 7.9 fps on desktop, where the
    // scene is four times the pixels through a software rasteriser. The three
    // mobile projects converged inside 1.7 s and passed; desktop did not, and
    // the test read "still moving" as "disagrees by direction".
    //
    // Waiting for the readout to stop changing does not fix it either, and that
    // is worth stating because it is the obvious repair. The altitude is
    // displayed rounded to 10 m, so on the final approach it sits unchanged at
    // "6 000" for a second or more while `current` is still creeping toward the
    // boundary that decides the stage. A stability window lands inside that
    // plateau and reads a settled altitude next to a stage that has not flipped
    // yet — which is precisely the shape of the failure being chased.
    //
    // So the wait reproduces the damper's own arithmetic. Each frame multiplies
    // the remaining fraction by the same decay `advance` applies, and the wait
    // ends when that fraction is far enough below `SETTLE_EPSILON` that the snap
    // in `settle` must have fired for any starting distance this test can
    // create. Frame-rate independent by construction: ~34 frames at 39 fps,
    // ~18 at 8 fps, and correct at either.
    const settleAt = async (y: number) => {
      await page.evaluate((to) => scrollTo({ top: to, behavior: 'instant' as ScrollBehavior }), y);

      await page.evaluate(
        ({ smoothing, maxDt, epsilon }) =>
          new Promise<void>((resolve, reject) => {
            // The largest distance a park-then-read step can leave on the clock
            // is the 600 px hop as a fraction of the track. Being generous here
            // only costs frames.
            let remaining = 1;
            let frames = 0;
            let last = performance.now();
            const tick = () => {
              const now = performance.now();
              const dt = Math.min((now - last) / 1000, maxDt);
              last = now;
              remaining *= Math.pow(smoothing, dt * 60);
              frames++;
              // epsilon / 1000: three orders of margin under the snap threshold,
              // so the conclusion holds however far the clock had to travel.
              if (remaining < epsilon / 1000) return resolve();
              if (frames > 900) return reject(new Error('journey clock never settled'));
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }),
        { smoothing: JOURNEY_SMOOTHING, maxDt: MAX_FRAME_DT, epsilon: SETTLE_EPSILON },
      );

      return page.evaluate(() => ({
        stage: (document.querySelector('.hud') as HTMLElement | null)?.dataset.stage ?? '',
        metres: (document.querySelector('[data-testid="altitude-value"]')?.textContent ?? '').replace(/\D/g, ''),
      }));
    };

    // Approached from below, then from above, settling fully each time. Same
    // scroll position, same altitude, and therefore — this is the assertion —
    // the same stage.
    //
    // The altitude is asserted as well as the stage, and that is the point
    // rather than extra thoroughness. Making the stage rule a function of
    // altitude fixed the rule; it did not by itself fix the altitude, because
    // an exponential damper stops one ulp short on whichever side it approached
    // from and never lands. At the `system` boundary that produced
    // 16 999.999 97 m going up and 17 000.000 03 m coming down — the same
    // "17 000 m" on screen, opposite sides of the boundary, two different
    // labels. `SETTLE_EPSILON` is what closes it, and this line is what proves
    // it closed.
    const forward: Record<number, { stage: string; metres: string }> = {};
    for (const y of sampled) {
      await settleAt(Math.max(0, y - 600));
      forward[y] = await settleAt(y);
    }
    for (const y of [...sampled].reverse()) {
      await settleAt(y + 600);
      const back = await settleAt(y);
      expect(back.metres, `altitude differed by direction at scroll ${y}`).toBe(forward[y].metres);
      expect(back.stage, `stage flipped on the way down at scroll ${y} (${back.metres} m)`).toBe(forward[y].stage);
    }
  });
});

// -----------------------------------------------------------------------------
test.describe('evaluation stills', () => {
  test('captures every stage of the journey', async ({ page }, info) => {
    const name = info.project.name;

    if (name === 'reduced-motion') {
      await page.goto('./');
      await assertReducedMotionActive(page);
      await expect(page.getByTestId('journey-fallback')).toBeVisible();
      await shot(page, 'reduced-motion-document');
      await page.evaluate(() => scrollTo({ top: 2400, behavior: 'instant' as ScrollBehavior }));
      await page.waitForTimeout(300);
      await shot(page, 'reduced-motion-content');
      return;
    }

    await page.goto('./');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2200); // environment map and model settle

    // One still per stage, positioned and named from the stage map, so adding
    // or resizing a stage moves and renames its evidence automatically.
    for (const [i, stage] of STAGES.entries()) {
      await scrollToStage(page, stage.id);
      await shot(page, `${name}-${String(i + 1).padStart(2, '0')}-${stage.id}`);
    }
  });

  test('captures the no-WebGL fallback', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'captured once');
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
        if (typeof type === 'string' && type.includes('webgl')) return null;
        // @ts-expect-error — passing through
        return original.call(this, type, ...rest);
      };
    });
    await page.goto('./');
    await expect(page.getByTestId('journey-fallback')).toBeVisible();
    await shot(page, 'fallback-no-webgl');
  });
});

// -----------------------------------------------------------------------------
test.describe('cost', () => {
  test('records what each path transfers', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'measured once, on desktop');

    const bytes = new Map<string, number>();
    page.on('response', (r) => {
      const len = Number(r.headers()['content-length'] ?? 0);
      if (len) bytes.set(r.url(), len);
    });

    // Armed before navigating. The model is preloaded the moment the scene
    // chunk evaluates, which is routinely before the canvas is painted — so
    // waiting for it *after* `goto` is a race, and on a warm cache it is a race
    // that always loses.
    const modelResponse = page.waitForResponse((r) => r.url().includes('.glb'), { timeout: 30_000 });

    await page.goto('./');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });
    await modelResponse;
    await page.waitForTimeout(1200);

    const sum = (pred: (u: string) => boolean) =>
      [...bytes.entries()].filter(([u]) => pred(u)).reduce((a, [, b]) => a + b, 0);

    const eager = sum((u) => !/JourneyScene|ScrollTrigger|index-|\.glb|\.jpg|\.png/i.test(u));
    const lazy = sum((u) => /JourneyScene|ScrollTrigger|index-/i.test(u));
    const model = sum((u) => /\.glb/i.test(u));
    const images = sum((u) => /\.jpg|\.png/i.test(u));

    // Recorded, not gated. A hard budget here would only ever be a number
    // invented in this file; the measurements live in PERFORMANCE_COMPARISON.md.
    console.log(
      `\n  full journey transfer (uncompressed):\n` +
        `    document + css + app shell : ${(eager / 1024).toFixed(1)} KB\n` +
        `    lazy 3D chunks             : ${(lazy / 1024).toFixed(1)} KB\n` +
        `    altimeter GLB              : ${(model / 1024).toFixed(1)} KB\n` +
        `    case-study imagery         : ${(images / 1024).toFixed(1)} KB\n`,
    );
    expect(eager).toBeGreaterThan(0);
  });
});
