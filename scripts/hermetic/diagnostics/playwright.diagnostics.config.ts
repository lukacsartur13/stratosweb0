import { defineConfig, devices } from '@playwright/test';

/**
 * The diagnostic harness, kept separate from the gate it is diagnosing.
 *
 * The projects below are copied from `playwright.config.ts` rather than
 * imported, and the duplication is the point: a diagnostic that inherits the
 * configuration under investigation cannot tell you whether the configuration
 * is what makes the difference. The four here are exactly the four that carry
 * `lead-forms.spec.ts` — two Chromium desktops and two WebKit phones — plus the
 * WebKit desktop and Chromium phone that carry `homepage-history.spec.ts`.
 *
 * `workers` and `repeat-each` are left to the command line, because §17 asks
 * for the same contract at four different concurrency levels and the whole
 * question is what changes between them.
 *
 * No `webServer`. The server is owned by `gate-run.mjs` or started by hand, and
 * a diagnostic that starts its own would be measuring a different server
 * lifecycle from the one the failure appeared under.
 */
const PORT = Number(process.env.STRATOS_DIAG_PORT ?? 4322);
const SOFTWARE_RASTER = !!process.env.STRATOS_SOFTWARE_RASTER;
const CHROMIUM_ARGS = SOFTWARE_RASTER ? [] : ['--use-angle=metal'];

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? 'diag.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: { args: CHROMIUM_ARGS } },
    },
    {
      name: 'desktop-1920',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 }, launchOptions: { args: CHROMIUM_ARGS } },
    },
    { name: 'mobile-390', use: { ...devices['iPhone 13'] } },
    { name: 'mobile-430', use: { ...devices['iPhone 14 Pro Max'] } },
    {
      name: 'desktop-webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'portrait-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        launchOptions: { args: CHROMIUM_ARGS },
      },
    },
  ],
});
