import { defineConfig, devices } from '@playwright/test';

// =============================================================================
// Portrait terrain framing. §18 of the mountain camera and material brief.
//
// ## Why this needs a config of its own
//
// Every other suite in this repository runs against `dist/`, deliberately, so
// it exercises what is actually deployed. This one cannot, and the reason is
// not a preference: the measurements it makes need the scene graph, the camera
// and a way to park the journey clock at an altitude, and all three are reached
// through `globalThis.__stratos`, which is published behind `import.meta.env.DEV`
// and is statically eliminated from a production build. Pointed at `dist/` the
// suite does not fail informatively — it waits thirty seconds for a handle that
// will never appear.
//
// The alternative would be to ship the handle in production so the suite could
// use it, which is a worse trade by a wide margin: a debug surface on every
// visitor's page so that a test can be filed in a tidier directory.
//
// So this runs against the Vite dev server, which is exactly how the sibling
// capture scripts (`shots-mountains.mjs`, `shots-portrait.mjs`) already work,
// and the same measurement modules serve both — `valley-metrics.mjs` and
// `terrain-mask.mjs` are imported by the probe and by this spec, so a threshold
// calibrated against a captured still means the same thing when it gates a run.
//
// ## What this suite does *not* cover
//
// The production route is still covered by `npm test`, which includes the
// mobile-fidelity regressions and the homepage chrome. Nothing here replaces
// those; this adds the structural terrain questions they cannot ask.
// =============================================================================
const PORT = 5177;
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './experiments/tests',
  testMatch: /mountain-framing\.spec\.ts/,
  // One GPU, one canvas at a time. Parallel WebGL on a single machine is noise,
  // and every assertion here is a measurement of a rendered frame.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  // The DRACO decode of the range plus a damped clock settling at six
  // altitudes. Matched to `playwright.full.config.ts`, which measures the same
  // scene, rather than raised past it.
  timeout: 120_000,

  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  /*
   * The three portrait viewports the composition is authored against — the same
   * set `MOBILE_VIEWPORTS` uses in `stratos_terrain.py`, so the Blender-side
   * audit and this suite judge the same frames.
   *
   * Written out rather than taken from Playwright's device descriptors, and
   * that is a correctness fix rather than a style choice. `devices['iPhone 13']`
   * reports a **390 x 664** viewport, not 390 x 844: the descriptor subtracts
   * the browser chrome, so its aspect is 0.587 where the authored composition's
   * is 0.462. That is a materially different frame — measured through it the
   * valley opening reads 37.9% against the authored frame's 47.9% at 2 500 m,
   * for the same scene, because the opening is a fraction of *width* and the
   * frame is a fifth shorter. Gating the brief's 45–60% target against a shape
   * the target was never stated for is measuring the descriptor.
   *
   * The device profile is kept in every other respect — `isMobile` and
   * `hasTouch` drive the same capability path and the same GLB variant choice —
   * so what changes here is the frame and nothing else.
   *
   * There is no desktop project: the desktop composition is accepted and out of
   * scope for this pass, and a project that skips every test in the file is a
   * slower way of running nothing.
   */
  projects: [
    {
      name: 'mobile-390x844',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    {
      name: 'mobile-430x932',
      use: { ...devices['Desktop Chrome'], viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    {
      name: 'mobile-360x800',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
  ],

  webServer: {
    command: 'npm --prefix experiments run dev:home',
    url: `${BASE}/home/hu.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
