import { test, expect } from '@playwright/test';
import { bootJourneyOnLoad } from './helpers/homepage';

// The homepage waits for a first move before it mounts the journey — see
// `bootJourneyOnLoad`. Every navigation in this file gets one, on every
// document it loads, so what these tests assert about is a page a visitor is
// reading rather than one they have only landed on.
test.beforeEach(async ({ page }) => {
  await bootJourneyOnLoad(page);
});


/**
 * The tests that test the harness.
 *
 * Everything else in this suite is an assertion about the product. These are
 * assertions about the environment the product is being asserted in, and they
 * exist because that environment was wrong for a long time without saying so.
 *
 * WHAT WENT WRONG
 * ---------------
 * Headless Chromium defaulted to SwiftShader, ANGLE's software rasteriser, and
 * drew every WebGL frame of the homepage on the CPU — while the WebKit projects
 * in the same suite used the Apple GPU. Measured on the built homepage:
 *
 *                            1 page             5 pages
 *   SwiftShader               4 fps               3-7 fps
 *                             2 086 ms/click      4 850 - 20 781 ms/click
 *   ANGLE Metal              58 fps              41-50 fps
 *                                89 ms/click        40 -     47 ms/click
 *
 * Against a 30 s budget, that is the whole of the suite's "flakiness". Five
 * consecutive baseline runs of one commit produced 7, 5, 6, 5 and 7 failures
 * with twelve different tests involved and only one of them failing every time.
 *
 * None of it was visible. The renderer is not printed, not asserted, and not
 * mentioned in the configuration; it is a default that changes behaviour by two
 * orders of magnitude. So it is asserted here, and the suite now fails loudly in
 * the one situation where it used to go quietly slow and wrong.
 *
 * WHY THIS IS NOT "REQUIRE A GPU"
 * -------------------------------
 * Plenty of legitimate hosts have no GPU — a Linux CI container above all — and
 * on those `--use-angle=metal` is inert and Chromium falls back to SwiftShader.
 * That is allowed. What is not allowed is falling back *silently*, because a
 * silent fallback is indistinguishable from the situation this workstream was
 * called in to fix. Set `STRATOS_SOFTWARE_RASTER=1` and the suite accepts the
 * software rasteriser, drops the WebGL-heavy projects to one worker each, and
 * says so in the report.
 *
 * An unrepresentative environment is a decision. An undeclared one is a bug.
 */

const SOFTWARE_RASTER = !!process.env.STRATOS_SOFTWARE_RASTER;

/** ANGLE spells software rasterisation with these names, and no other. */
const isSoftware = (renderer: string) =>
  /swiftshader|llvmpipe|software|microsoft basic render/i.test(renderer);

/** What is actually drawing this page, asked of the page itself. */
async function renderer(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'no-webgl';
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return String(
      debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
  });
}

test.describe('the test environment itself', () => {
  test('WebGL is available to this project at all', async ({ page }) => {
    // A project that cannot make a WebGL context does not fail the homepage
    // tests — the site has a designed fallback for exactly that visitor — it
    // silently tests the fallback instead, while the report still says
    // "homepage". Worth one assertion.
    await page.goto('/index.html');
    expect(await renderer(page), 'this project cannot create a WebGL context').not.toBe('no-webgl');
  });

  test('the rasteriser is either hardware, or declared', async ({ page }, testInfo) => {
    await page.goto('/index.html');
    const name = await renderer(page);
    const software = isSoftware(name);

    // Recorded on every run, pass or fail. The number that explains a slow run
    // should not require a rerun to obtain.
    testInfo.annotations.push({ type: 'renderer', description: `${testInfo.project.name}: ${name}` });

    if (SOFTWARE_RASTER) {
      // The declared case. Nothing to assert about which renderer arrived —
      // the point of the variable is that the operator has said they know.
      expect(name.length, 'the renderer did not identify itself').toBeGreaterThan(0);
      return;
    }

    expect(
      software,
      `this project is rendering through a SOFTWARE rasteriser (${name}).\n\n` +
        'On this suite that is a 10-20x penalty on every frame, and Playwright ' +
        'derives element stability, input dispatch and every waitForFunction ' +
        'poll from frames — so it does not read as "slow", it reads as a ' +
        'shifting set of timeouts in whichever tests happened to run beside ' +
        'each other. That is the exact failure this assertion exists to stop ' +
        'being rediscovered.\n\n' +
        'If this host genuinely has no GPU, that is fine and supported: set ' +
        'STRATOS_SOFTWARE_RASTER=1. The suite will accept the software ' +
        'rasteriser, drop the WebGL-heavy projects to one worker each, and the ' +
        'gate report will carry the fact. What is not supported is running ' +
        'software-rastered without saying so.',
    ).toBe(false);
  });

  test('the page is getting a usable frame rate', async ({ page }, testInfo) => {
    /**
     * The consequence, asserted directly rather than inferred from the
     * renderer's name — a hardware renderer on a machine with nothing left to
     * give produces the same failures as a software one.
     *
     * The threshold is deliberately far below anything a visitor would accept.
     * This is not a performance budget: `homepage-chrome` and `homepage-history`
     * assert what the journey does, not how fast it does it, and a frame-rate
     * assertion masquerading as a functional one is the confusion §17 of the
     * brief asks us not to introduce. 12 fps is the line under which
     * Playwright's own two-frame stability check starts costing more than a
     * sixth of a second, which is where 30 s budgets begin to be arithmetic.
     */
    const FLOOR = SOFTWARE_RASTER ? 2 : 12;

    await page.goto('/index.html');
    await page.waitForSelector('[data-testid="altitude-hud"], [data-testid="mobile-telemetry"]', {
      state: 'visible',
      timeout: 30_000,
    });

    /**
     * Best of three one-second samples, not the first one.
     *
     * The first second after the instrument appears is not the steady state:
     * the `.glb` is still decoding and shaders are still compiling, and both are
     * CPU work that a GPU does not take away. Sampled once, this project
     * reported 7 fps on hardware that sustains 50 — which would have made this
     * canary the very thing it exists to prevent, a test that fails for reasons
     * that have nothing to do with what it claims to assert.
     *
     * The question worth asking is "can this page reach a usable frame rate",
     * so the answer is the best sample rather than the average of a warm-up.
     */
    const sample = () =>
      page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            let frames = 0;
            const started = performance.now();
            const tick = () => {
              frames += 1;
              if (performance.now() - started < 1_000) requestAnimationFrame(tick);
              else resolve(frames);
            };
            requestAnimationFrame(tick);
          }),
      );

    const samples = [await sample(), await sample(), await sample()];
    const fps = Math.max(...samples);
    testInfo.annotations.push({
      type: 'fps',
      description: `${testInfo.project.name}: ${samples.join(', ')} (best ${fps})`,
    });

    expect(
      fps,
      `the homepage is running at ${fps} fps in this project. Below ${FLOOR} fps ` +
        'the suite stops measuring the product and starts measuring the ' +
        'machine: Playwright waits two consecutive animation frames for element ' +
        'stability before it will dispatch a click, so a low frame rate turns ' +
        'into multi-second actionability waits and then into timeouts that move ' +
        'from run to run.',
    ).toBeGreaterThanOrEqual(FLOOR);
  });
});
