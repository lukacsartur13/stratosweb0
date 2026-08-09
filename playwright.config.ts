import { defineConfig, devices } from '@playwright/test';

// Tests run against the built artefact in dist/, not the source tree, so they
// exercise what actually gets deployed — including the assembled portal and the
// generated pages — rather than a development-only arrangement.
const PORT = 4322;
const BASE = `http://127.0.0.1:${PORT}`;

// Run in node, not in a page. The lead endpoint is exercised in-process (see
// tests/lead-endpoint.spec.ts) and the structured-data suite reads dist/ off
// the filesystem — neither opens a browser, so neither is a viewport question
// and running either five times over is five times the same answer.
const NODE_ONLY = [
  /lead-endpoint\.spec\.ts/, /structured-data\.spec\.ts/, /portal-analytics\.spec\.ts/,
];

// Two suites are viewport-independent: they read data attributes, class names
// and storage, and render nothing. What they *are* sensitive to is the engine —
// WebKit does not expose a Blob beacon's body to Playwright, which is why the
// analytics suite captures payloads in the page, and storage partitioning
// differs between engines, which is what the attribution suite reads. So both
// run once on Chromium (desktop-1440) and once on WebKit (mobile-390) and are
// skipped elsewhere.
//
// This is not only about redundancy. The homepage specs drive a ~1 MB WebGL
// bundle and sit close to the 30 s timeout under parallel load; running these
// tests five times over pushed them past it.
const ENGINE_ONLY = [/analytics\.spec\.ts/, /attribution\.spec\.ts/, /not-found\.spec\.ts/];

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // One project for everything that never opens a browser: it runs once
    // rather than five times over in every viewport.
    { name: 'node', testMatch: NODE_ONLY },

    { name: 'desktop-1440', testIgnore: NODE_ONLY, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'desktop-1920', testIgnore: [...NODE_ONLY, ...ENGINE_ONLY], use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
    { name: 'mobile-390',   testIgnore: NODE_ONLY, use: { ...devices['iPhone 13'] } },
    { name: 'mobile-430',   testIgnore: [...NODE_ONLY, ...ENGINE_ONLY], use: { ...devices['iPhone 14 Pro Max'] } },
    {
      testIgnore: [...NODE_ONLY, ...ENGINE_ONLY],
      // The site promises a readable document without animation, and this
      // project is where that promise is asserted.
      //
      // The `reducedMotion` option below is NOT what makes that happen, and
      // must not be read as sufficient. On Playwright 1.62.1 it does not reach
      // `matchMedia()` in this project: a page from here still reports
      // `matchMedia('(prefers-reduced-motion: reduce)').matches === false`.
      // It is kept only as the project's declared intent and as the canary for
      // 'the reduced-motion test environment is genuinely active', which fails
      // if that ever changes.
      //
      // Every test that claims to exercise reduced motion must call
      // `enableReducedMotion(page)` from tests/helpers/reduced-motion.ts, which
      // emulates the state at runtime and then verifies it from inside the page.
      name: 'reduced-motion',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' },
    },
  ],

  webServer: {
    command: `python3 -m http.server ${PORT} --directory dist`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
