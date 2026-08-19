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
  /portal-health\.spec\.ts/, /lead-notify\.spec\.ts/, /redirects\.spec\.ts/,
  // Runs the repository secret scan as a child process and asserts what it does
  // and does not read. No page, no viewport, and running it five times over is
  // five full walks of the repository for the same answer.
  /gate-independence\.spec\.ts/,
];

// The two interaction-hardening suites, and the four compositions they are
// required to hold on.
//
// Both are about things the two ENGINES genuinely disagree about, so a matrix
// chosen for viewports is the wrong one for them:
//
//   modality  WebKit does not put links in the sequential focus order unless
//             the visitor asks it to. The trap that held on Chromium therefore
//             never fired there, and the defect was invisible to a suite whose
//             only WebKit projects skip Tab as "not a phone interaction".
//   history   Chromium has scroll anchoring and WebKit does not, so the same
//             clamped restore lands at the bottom on one and near the top on
//             the other. Testing either alone tests half the failure.
//
// So they run on exactly four projects — desktop and portrait, Chromium and
// WebKit — and are excluded from the rest rather than run seven times over.
// `desktop-webkit` and `portrait-chromium` exist for these two files only and
// carry no other tests; the suite's totals elsewhere are unchanged by them.
const HARDENING = [/homepage-modality\.spec\.ts/, /homepage-history\.spec\.ts/];

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
// `portal-control-room.spec.ts` joins them for a third reason: most of it reads
// portal/src off the filesystem and asserts structure, which is the same answer
// in every engine and at every width. Its handful of rendered checks want one
// desktop and one phone, which is exactly what this pair is.
//
// `portal-revenue.spec.ts` joins it for a FOURTH: every test in that file is
// either a pure function over plain data or a read of portal/src and
// supabase/migrations off the filesystem. Neither opens a page. It could
// therefore live in the `node` project — and does not, only because it shares a
// subject with the control-room suite and running the two together is how a
// change to one is noticed by the other.
const ENGINE_ONLY = [
  /analytics\.spec\.ts/, /attribution\.spec\.ts/, /not-found\.spec\.ts/,
  /portal-control-room\.spec\.ts/, /portal-revenue\.spec\.ts/,
];

// =============================================================================
// Rasterization, and why it is configured rather than inherited.
//
// Headless Chromium on this platform defaults to SwiftShader — ANGLE's software
// rasteriser — and draws every WebGL frame on the CPU. WebKit, in the same
// suite, uses the Apple GPU. That asymmetry was invisible in this file and it
// was the cause of the suite's wandering failures. Measured on the built
// homepage, on the machine this runs on:
//
//                              1 page          5 pages (the suite's real shape)
//   SwiftShader (the default)   4 fps           3-7 fps
//                               2 086 ms/click  4 850 - 20 781 ms/click
//   ANGLE Metal                58 fps          41-50 fps
//                                  89 ms/click     40 -     47 ms/click
//
// The per-test budget is 30 000 ms. A single click costing twenty seconds is
// how `homepage-chrome`'s menu tests failed: Playwright's actionability check
// waits for *stability* — two consecutive animation frames with an unchanged
// box — and at four frames a second that wait is arithmetic, not a defect. The
// hit-test was correct every time it was captured: right element, pointer
// events on, visible, nothing covering it.
//
// So this is not a performance flag. Software rasterisation was making the four
// Chromium projects assert against a machine no visitor has, while the three
// WebKit projects asserted against hardware — the brief's own class D,
// "software rasterizer behaviour not representative of target browser/device".
// Asking for the GPU makes the Chromium projects test the browser being
// shipped to.
//
// PORTABILITY. `--use-angle=metal` selects a backend that only exists on macOS.
// Where it cannot be honoured — a Linux CI container, any host without a GPU —
// Chromium falls back to SwiftShader on its own; the flag is inert, not fatal.
// That fallback is silent, which is the dangerous part, so it is not left to
// trust: `tests/harness.spec.ts` asserts which renderer each Chromium project
// actually got and fails if the suite is running software-rastered without
// STRATOS_SOFTWARE_RASTER having declared it. An unrepresentative environment
// is allowed; an undeclared one is not.
//
// FALLBACK. When that variable is set, the WebGL-heavy projects drop to one
// worker each, because on a software rasteriser concurrency is what turns a
// slow suite into a wandering one. It is deliberately not the default: capping
// workers to outlast a bad renderer is the mitigation this workstream exists to
// replace, and it is kept only for hosts that have no renderer to fix.
// =============================================================================
const SOFTWARE_RASTER = !!process.env.STRATOS_SOFTWARE_RASTER;
const CHROMIUM_ARGS = SOFTWARE_RASTER ? [] : ['--use-angle=metal'];

/**
 * One worker per Chromium project when there is no GPU to share out.
 *
 * The rendering cost of this suite is concentrated in five of its nineteen
 * files — `homepage-chrome`, `public-site`, `mobile-homepage-simple`,
 * `homepage-modality`, `homepage-history` — which between them account for
 * ~1 668 of the baseline's 2 792 test-seconds and every one of its ~380 scene
 * instantiations. They are carried by the four Chromium projects, so capping
 * those projects is what caps the concurrent software rasterisation.
 *
 * Applied only under `STRATOS_SOFTWARE_RASTER`. With the GPU in play the cap is
 * unnecessary and measurably so: five concurrent hardware-rendered homepages
 * hold 41-50 fps and 40-47 ms clicks, against 3-7 fps and up to 20 781 ms on the
 * software path.
 */
const heavyWorkers = SOFTWARE_RASTER ? { workers: 1 } : {};

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Retries mask exactly the property this suite is now required to have: that
  // the same commit produces the same result. A test that only passes on the
  // second attempt is a wandering failure with its evidence thrown away.
  retries: 0,
  // Stated rather than inherited from "50% of cores", so the number is a
  // decision that can be argued with.
  workers: process.env.CI ? 2 : 5,
  // A machine-readable report on EVERY run, not only on CI. The P2 miscount
  // happened because the only artefact was terminal output and it was read with
  // `tail`; `scripts/gate-report.mjs` reconciles this file's totals against the
  // collected count and refuses to produce a verdict that does not add up.
  reporter: [
    ['list'],
    // `outputFile` set in the reporter options WINS over
    // PLAYWRIGHT_JSON_OUTPUT_NAME, so hard-coding it means every repeated run
    // overwrites the previous one's artefact — which defeats the repeated-run
    // check the gate policy is built on. Found the hard way: five consecutive
    // frozen-commit runs produced one file. The env var is honoured first, and
    // the fixed path is only the default for an ordinary single run.
    [
      'json',
      {
        outputFile:
          process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ??
          '_build/reports/regression-harness/last-run.json',
      },
    ],
    ...(process.env.CI ? [['github'] as const, ['html', { open: 'never' }] as const] : []),
  ],

  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // One project for everything that never opens a browser: it runs once
    // rather than five times over in every viewport.
    { name: 'node', testMatch: NODE_ONLY },

    { name: 'desktop-1440', testIgnore: [...NODE_ONLY, ...HARDENING], ...heavyWorkers, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: { args: CHROMIUM_ARGS } } },
    // Desktop Chromium at 1920x1080 is the hardening matrix's Chromium desktop
    // arm, so `HARDENING` is deliberately NOT ignored here.
    { name: 'desktop-1920', testIgnore: [...NODE_ONLY, ...ENGINE_ONLY], ...heavyWorkers, use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 }, launchOptions: { args: CHROMIUM_ARGS } } },
    // Portrait WebKit, and the matrix's WebKit portrait arm for the same reason.
    { name: 'mobile-390',   testIgnore: NODE_ONLY, use: { ...devices['iPhone 13'] } },
    { name: 'mobile-430',   testIgnore: [...NODE_ONLY, ...ENGINE_ONLY, ...HARDENING], use: { ...devices['iPhone 14 Pro Max'] } },

    // The two arms the matrix above did not already have. Both carry the
    // hardening suites and nothing else — `testMatch`, not `testIgnore`, so a
    // suite added later does not silently acquire two more projects.
    {
      name: 'desktop-webkit',
      testMatch: HARDENING,
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'portrait-chromium',
      testMatch: HARDENING,
      ...heavyWorkers,
      // Chromium at the phone viewport, with the coarse pointer and touch that
      // `main.tsx` forks the composition on. Spelled out rather than taken from
      // a device preset because every preset at this size defaults to WebKit,
      // which is the engine this project exists to NOT be.
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        launchOptions: { args: CHROMIUM_ARGS },
      },
    },
    {
      // Only the files that contain a reduced-motion assertion.
      //
      // This project used to be `testIgnore`-shaped, and so carried 147 tests:
      // 41 from homepage-chrome, 29 from public-site, 27 from
      // mobile-homepage-simple — and 29 from lead-forms and 21 from portal,
      // neither of which contains a single reduced-motion assertion.
      //
      // Those last 50 were not a weaker version of the same coverage. Because
      // the declarative option does not reach the page (see below), and because
      // this project is Desktop Chrome at 1440x900 exactly as `desktop-1440`
      // is, they were the same tests, in the same engine, at the same size,
      // against the same media state, run a second time. The suite's own canary
      // — public-site.spec.ts, 'the reduced-motion test environment is
      // genuinely active' — is what proves it, by asserting that an un-emulated
      // page here still reports `matches === false`.
      //
      // Removing them removes no assertion from the suite and no failure mode
      // from the gate. It is §41's "duplication where proven safe", and the
      // proof is the canary.
      //
      // What is deliberately NOT done: cutting this further to only the ~20
      // tests that call `enableReducedMotion`. That needs a tag on each of
      // them, and the remaining duplication inside these three files is a
      // tidiness cost rather than a correctness one — it is quantified in
      // resource-map.md rather than traded away here.
      testMatch: [
        /homepage-chrome\.spec\.ts/, /public-site\.spec\.ts/, /mobile-homepage-simple\.spec\.ts/,
      ],
      ...heavyWorkers,
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
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'reduce',
        launchOptions: { args: CHROMIUM_ARGS },
      },
    },
  ],

  // ---------------------------------------------------------------------------
  // Who owns the server.
  //
  // Under `scripts/hermetic/gate-run.mjs` the answer is: the gate does. It
  // starts the server, records its PID, port, ready time, shutdown time and
  // exit code, and confirms the process is dead and the port released before
  // the run is allowed to produce a verdict.
  //
  // So this block is REMOVED in that path rather than set to
  // `reuseExistingServer: false`. The distinction matters. With the option set
  // to false, Playwright still owns a server, still races the port, and still
  // has to decide what to do about one that is already there — and "already
  // there" is exactly how the previous investigation ended up with a suite
  // attached to a seventeen-hour-old server serving a different checkout.
  // Handing ownership to one process that tracks it removes the question
  // instead of answering it.
  //
  // Outside the gate — a developer running `npm test` — nothing changes.
  // ---------------------------------------------------------------------------
  ...(process.env.STRATOS_GATE_SERVER
    ? {}
    : {
        webServer: {
          // Was `python3 -m http.server`. It answers HTTP/1.0 with no keep-alive on
          // this host's Python 3.9, so every asset opened a new socket, and under five
          // parallel workers it dropped a request often enough to time out a
          // `page.goto` on a plain 15 KB HTML page in two of five gate runs. See the
          // header of scripts/test-server.mjs.
          command: `node scripts/test-server.mjs ${PORT} dist`,
          url: BASE,
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
        },
      }),
});
