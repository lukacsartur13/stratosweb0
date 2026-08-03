import { defineConfig, devices } from '@playwright/test';

// =============================================================================
// The 3D prototype gets its own Playwright config rather than a project inside
// playwright.config.ts, for two reasons:
//
//   1. that config's browser projects use `testIgnore: ENDPOINT`, so any new
//      spec dropped into tests/ would immediately run five times over, in
//      viewports it was never written for;
//   2. these tests need a build step the production suite must not depend on.
//
// Two files means `npm test` is byte-for-byte the run it was before the
// prototype existed. Run this one with `npm run test:experiments`.
// =============================================================================
const PORT = 4324;
const BASE = `http://127.0.0.1:${PORT}/experiments/stratos-ascent/`;

export default defineConfig({
  testDir: './experiments/tests',
  // Scoped to this spec. The folder now also holds full-ascent.spec.ts, which
  // has its own config, its own build and its own viewports — without this it
  // would run here too, against the wrong baseURL and a route this server does
  // not build.
  // Anchored to a path boundary, not just to the end of the string: a bare
  // /ascent\.spec\.ts$/ also matches `full-ascent.spec.ts`, which dragged the
  // full-journey suite into this run against the wrong baseURL.
  testMatch: /(^|[\\/])ascent\.spec\.ts$/,
  fullyParallel: false, // one GPU, one canvas at a time — parallel WebGL is noise
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'] },
    },
    {
      // The prototype promises a readable, motionless document to anyone who
      // asks for one. This project holds it to that.
      //
      // The `reducedMotion` option below does not, on its own, produce that
      // state — on Playwright 1.62.1 it never reaches `matchMedia()` here. The
      // specs call `enableReducedMotion(page)` (tests/helpers/reduced-motion.ts)
      // and verify the query from inside the page. See that file.
      name: 'reduced-motion',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'reduce',
      },
    },
  ],

  webServer: {
    // Built fresh, then served out of dist/ alongside the static site so the
    // prototype and the current hero can be compared on one origin.
    command: `npm run build:experiments && python3 -m http.server ${PORT} --directory dist`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
