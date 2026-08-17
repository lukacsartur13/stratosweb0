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
//
// TWO SPECS, AND WHICH PROJECT COLLECTS WHICH
// -------------------------------------------
// This route is one application with two compositions. `src/full/main.tsx`
// forks once, on `screen`'s short edge and the pointer type: a coarse-pointer
// device with a short edge under 540px gets `mobile/MobileHome.tsx`, everything
// else gets `FullAscent.tsx`. They are separate compositions, not one component
// with breakpoints, and they share the content tables and nothing else.
//
// So the suite is split the same way, by `testMatch` rather than by a
// `test.skip` inside a shared file:
//
//   full-ascent.spec.ts      the cinematic composition — canvas, sticky track,
//                            damped altitude clock, the Meridian's six
//                            structural states. Collected by `desktop` and
//                            `reduced-motion`.
//   portrait-journey.spec.ts the portrait composition — native document scroll,
//                            eleven block-flow chapters, IntersectionObserver
//                            reveals, the Altimeter GLB in a fixed CSS box.
//                            Collected by the five phone projects.
//
// The alternative — one file, gated on the project name — is what this replaces.
// It left the portrait projects asserting a canvas, a `journey__track` and a
// `data-meridian` attribute that a phone has not had since the mobile reset,
// and the repair on offer was to extend a `test.skip` to three more projects,
// which converts an open question into a silent assumption. Splitting by the
// composition each file describes means neither file needs a skip at all.
// =============================================================================
const PORT = 4327;
const BASE = `http://127.0.0.1:${PORT}/experiments/stratos-ascent-full/`;

/** The cinematic composition's spec, and the portrait composition's. */
const CINEMATIC = /full-ascent\.spec\.ts/;
const PORTRAIT = /portrait-journey\.spec\.ts/;

/**
 * Broad coverage everywhere, deep coverage twice.
 *
 * The brief asks for five viewports and, in the same breath, for the suite to
 * stay runnable — "do not multiply every expensive test across every viewport".
 * `@smoke` in a title is the line between the two: the cheap structural checks
 * that a narrower or shorter screen can genuinely break — overflow, chapter
 * order, the skip link, the reveals resolving, the no-WebGL fallback — run on
 * all five, and the walks that scroll the whole document several times over run
 * on the representative portrait size and on landscape.
 */
const SMOKE = /@smoke/;

export default defineConfig({
  testDir: './experiments/tests',
  testMatch: [CINEMATIC, PORTRAIT],
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
      testMatch: CINEMATIC,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },

    // -------------------------------------------------------------------------
    // The five phone shapes, and the two the deep walks run on.
    //
    // Heights are stated rather than taken from the device descriptor. A device
    // descriptor's viewport is the *content* box a real browser leaves after
    // its own chrome — 390×664 for an iPhone 13 — and the reconciliation brief
    // names the panel sizes: 390×844, 430×932, 375×812, 360×800, and 844×390
    // for landscape. Testing the panel is the stricter reading, because the
    // composition is written against `svh` and the taller box is the one a
    // collapsed toolbar produces.
    //
    // Engines are mixed on purpose. The iPhone descriptors run WebKit, which is
    // where a `position: fixed` telemetry strip, `svh` and momentum scrolling
    // actually differ; 360×800 runs Chromium as a Pixel, which is the other
    // half of the phone population and the engine the reveals' transitions are
    // cheapest on.
    // -------------------------------------------------------------------------
    {
      // The representative portrait size. Everything runs here.
      name: 'mobile-390',
      testMatch: PORTRAIT,
      use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
    },
    {
      // Landscape. The other shape with its own failure modes: the instrument
      // gets a smaller box, the telemetry strip is a much larger share of the
      // viewport, and a chapter that fits portrait can stop fitting here.
      name: 'mobile-landscape',
      testMatch: PORTRAIT,
      use: { ...devices['iPhone 13 landscape'], viewport: { width: 844, height: 390 } },
    },
    {
      name: 'mobile-430',
      testMatch: PORTRAIT,
      grep: SMOKE,
      use: { ...devices['iPhone 14 Pro Max'], viewport: { width: 430, height: 932 } },
    },
    {
      name: 'mobile-375',
      testMatch: PORTRAIT,
      grep: SMOKE,
      use: { ...devices['iPhone SE'], viewport: { width: 375, height: 812 } },
    },
    {
      // The narrowest shape in the matrix, and the one that finds horizontal
      // overflow first.
      name: 'mobile-360',
      testMatch: PORTRAIT,
      grep: SMOKE,
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 800 } },
    },

    {
      testMatch: CINEMATIC,
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
  //
  // OWNERSHIP. Under `scripts/hermetic/gate-run.mjs` this block is removed and
  // the gate starts, records and tears down the server itself — see the same
  // note in playwright.config.ts. It matters more here than there: this config
  // still names `python3 -m http.server`, which is the server the main suite
  // was moved OFF after two of five gate runs timed out on `page.goto` for a
  // plain static page (Python 3.9 answers HTTP/1.0 with no keep-alive, and
  // `--protocol` arrived in 3.11). The heaviest WebGL suite in the repository
  // was still being served by it. That is not fixed by editing this line —
  // §10 asks for the two servers to be COMPARED rather than swapped on a
  // hunch — so the command below is left exactly as it was, and the gate
  // selects the server it wants with `--server node|python`.
  ...(process.env.STRATOS_GATE_SERVER ? {} : {
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
  }),
});
