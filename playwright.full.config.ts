import { defineConfig, devices } from '@playwright/test';

// =============================================================================
// The full 0–30 000 m journey.
//
// A third config rather than a project inside either existing one, for the same
// reason the prototype got its own: this suite needs a build step, and adding
// it to playwright.config.ts would make `npm test` — the production regression
// suite — depend on a Vite build of an experiment. The three suites are:
//
//   npm test              production site + portal + lead endpoint  (unchanged)
//   npm run test:experiments   the 0–8 000 m prototype              (unchanged)
//   npm run test:full          this one
//
// Viewports are the ones the brief named, plus WebKit, because the sticky
// handoff is exactly the kind of thing that behaves differently on iOS Safari
// and "it works in Chrome" is not evidence about a phone.
// =============================================================================
const PORT = 4327;
const BASE = `http://127.0.0.1:${PORT}/experiments/stratos-ascent-full/`;

export default defineConfig({
  testDir: './experiments/tests',
  testMatch: /full-ascent\.spec\.ts/,
  fullyParallel: false, // one GPU, one canvas at a time — parallel WebGL is noise
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  // Eleven screens of scroll with a damped clock: the journey tests genuinely
  // take longer than a document test, and the default 30 s is not enough for
  // the full-ascent walk.
  timeout: 120_000,

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
    // The three phone sizes the brief called out. 390×844 and 430×932 are the
    // common iPhone widths; 375×667 is the small one, and it is the one that
    // actually breaks sticky layouts because the viewport is shorter than most
    // panels' content.
    {
      name: 'mobile-390',
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'mobile-430',
      use: { ...devices['iPhone 14 Pro Max'] },
    },
    {
      name: 'mobile-375',
      use: { ...devices['iPhone SE'], viewport: { width: 375, height: 667 } },
    },
    {
      // Reduced motion is *activated at runtime* by the spec, not by this
      // option — see tests/helpers/reduced-motion.ts. The option is here as the
      // project's declared intent and as the canary that fails if Playwright
      // ever starts honouring it.
      name: 'reduced-motion',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'reduce',
      },
    },
  ],

  // ---------------------------------------------------------------------------
  // The build the suite depends on is `npm run test:full`'s job, not this
  // block's. Option B of the two the brief offered, and it is the one that
  // makes the dependency impossible to forget rather than merely documented.
  //
  // The trap it closes, in full:
  //
  //   * `npm run build` runs `scripts/assemble.mjs`, which clears every entry
  //     in `dist/` except `portal` — including `dist/experiments/`;
  //   * `build:full` is not part of `npm run build` and should not be, because
  //     the experiment route is `noindex` development output and does not
  //     belong in every production build;
  //   * so a clean production build leaves this suite with no route to test.
  //
  // The old arrangement put `npm run build:full &&` in the `command` below,
  // which looks like it closes that — and does, exactly until it does not.
  // `reuseExistingServer: !CI` means the command is *not run at all* when
  // something is already listening on this port, which locally is the common
  // case: a static server left over from the previous run happily serves the
  // stale, or absent, route while the build that would have fixed it is
  // skipped. The result is 404s that look like a test failure.
  //
  // Building in the npm script instead runs unconditionally, exactly once, and
  // before Playwright decides anything about servers. The guard in `command`
  // is for the other entry point — invoking Playwright directly against this
  // config — where it fails with the fix rather than with a wall of 404s.
  // ---------------------------------------------------------------------------
  webServer: {
    command:
      `test -f dist/experiments/stratos-ascent-full/index.html || ` +
      `{ echo "\\nmissing dist/experiments/stratos-ascent-full — run: npm run build:full\\n" >&2; exit 1; }; ` +
      // The typography has to be present too, and its absence is silent.
      // `build:full` emits the route but not `dist/assets/`, which comes from
      // `npm run build`. Run this suite against a tree that has one and not the
      // other and every page renders in the browser's default serif: no 404 in
      // the console, no failing assertion, just layout, collision and stills
      // measured against metrics the live site never uses. Fail loudly instead.
      `test -f dist/assets/css/type.css || ` +
      `{ echo "\\nmissing dist/assets/css/type.css — the route would render in a fallback serif. Run: npm run build\\n" >&2; exit 1; }; ` +
      `python3 -m http.server ${PORT} --directory dist`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
