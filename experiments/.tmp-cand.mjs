// Candidate art-direction settings, rendered as stills for human review.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5177/home/hu.html';
const OUT = 'experiments/screenshots/cand';

const CANDIDATES = {
  A_baseline: { desktop: {}, mobile: {} },
  B_station: {
    desktop: { stationForward: -600, stationRise: 150 },
    mobile: { stationForward: -400, stationRise: 150 },
  },
  C_station_tone: {
    desktop: {
      stationForward: -600,
      stationRise: 150,
      valleyDarken: 0.9,
      keyAzimuth: -46,
      fillIntensity: 0.13,
      levelNear: 1.05,
    },
    mobile: {
      stationForward: -400,
      stationRise: 150,
      valleyDarken: 0.92,
      keyAzimuth: -34,
      fillIntensity: 0.16,
      levelNear: 0.8,
    },
  },
};

const VIEWS = [
  { id: 'desktop', width: 1440, height: 900, dsf: 1, mobile: false, key: 'desktop' },
  { id: '390x844', width: 390, height: 844, dsf: 3, mobile: true, key: 'mobile' },
];
const STOPS = [0, 7000];

function freeze() {
  let v;
  Object.defineProperty(globalThis, '__stratos', {
    configurable: true,
    get: () => v,
    set: (x) => {
      v = x;
      if (x?.journey?.debug) x.journey.debug.ringRotation = 0;
    },
  });
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const view of VIEWS) {
  const ctx = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: view.dsf,
    isMobile: view.mobile,
    hasTouch: view.mobile,
  });
  const page = await ctx.newPage();
  await page.addInitScript(freeze);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '.debug, .debug__toggle { display: none !important; }' });
  await page.waitForFunction(() => !!globalThis.__stratos?.scene, { timeout: 30_000 });
  await page.waitForTimeout(5000);

  for (const [name, cfg] of Object.entries(CANDIDATES)) {
    const params = cfg[view.key];
    await page.evaluate((p) => {
      const d = globalThis.__stratos.journey.debug.mountainLook;
      // reset every overridable field first
      d.stationForward = 0;
      d.stationRise = 0;
      d.valleyDarken = null;
      d.keyAzimuth = null;
      d.keyElevation = null;
      d.keyIntensity = null;
      d.fillIntensity = null;
      d.levelNear = null;
      d.levelMid = null;
      d.levelFar = null;
      d.crestGain = null;
      d.depthFog = null;
      d.heightFog = null;
      Object.assign(d, p);
    }, params);

    for (const m of STOPS) {
      await page.evaluate((v) => {
        globalThis.__stratos.journey.debug.altitude = v;
      }, m);
      await page.waitForTimeout(120);
      await page.evaluate(() => {
        const max = document.documentElement.scrollHeight - innerHeight;
        scrollTo({ top: max * globalThis.__stratos.journey.current, behavior: 'instant' });
      });
      await page.waitForTimeout(2400);
      const path = `${OUT}/${name}-${view.id}-${String(m).padStart(5, '0')}.png`;
      await page.screenshot({ path, animations: 'disabled' });
      console.log(`wrote ${path}`);
    }
  }
  await ctx.close();
}
await browser.close();
