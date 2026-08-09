/**
 * Real-time scroll recordings for the mobile review package — §29.
 *
 * Three passes at 1x, recorded as video: a slow drag, a fast flick, and a
 * reverse scroll. Nothing is slowed down, sped up, trimmed or re-timed. §29 is
 * explicit about that, and the reason is obvious once stated: a recording that
 * has been slowed to look smooth is a recording of the editing, not of the page.
 *
 * WHY `Input.synthesizeScrollGesture` AND NOT `window.scrollTo`
 * -------------------------------------------------------------
 * `scrollTo` teleports. It produces no gesture, no momentum and no fling, so a
 * recording of it shows the page arriving at positions rather than travelling
 * between them — which is precisely the thing under review. The CDP gesture
 * synthesiser injects real touch points through the same pipeline a finger
 * uses, including the compositor's fling curve, so `speed` is a real
 * pixels-per-second and a flick genuinely coasts afterwards.
 *
 * The videos are what a human watches. They are not a pass/fail gate — §25 is
 * clear that the gate is the real phone — but they are what makes it possible
 * to see a regression without having one in your hand.
 *
 *   node experiments/record-mobile-scroll.mjs [--origin http://localhost:4322]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const ORIGIN = arg('origin', 'http://localhost:4322');
const OUT = resolve(
  ROOT,
  '_build/reports',
  arg('into', 'mobile-homepage-simple-review'),
  'recordings',
);

const VIEWPORT = { width: 390, height: 844 };

/**
 * The three gestures §26 asks for, in the units the synthesiser speaks.
 *
 * `speed` is pixels per second. 900 is an unhurried read; 6 000 is a flick hard
 * enough to fling. `repeat` is how many gestures the pass makes, and the pause
 * between them is where a drift would be visible if there were one — the page
 * is meant to be completely still in those windows.
 */
const PASSES = [
  { name: 'slow-scroll', speed: 900, distance: 700, repeat: 8, pause: 250, direction: 'down' },
  { name: 'fast-flick', speed: 6000, distance: 2400, repeat: 6, pause: 900, direction: 'down' },
  { name: 'reverse-scroll', speed: 2400, distance: 1400, repeat: 8, pause: 400, direction: 'up', from: 0.85 },
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/**
 * On the platform's GPU. A recording made on Chromium's software rasteriser is
 * a recording of SwiftShader filling a 780x1688 buffer on the main thread —
 * measured at 62 ms a frame, which no phone pays and which would make the
 * videos evidence of the wrong thing entirely. See `probe-mobile-cost.mjs`.
 */
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
});

for (const pass of PASSES) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    recordVideo: { dir: OUT, size: VIEWPORT },
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  await page.goto(ORIGIN + '/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.classList.contains('mv-on'), null, {
    timeout: 20_000,
  });

  // A reverse pass has to start from somewhere. Jumped rather than scrolled:
  // the recording is of the reverse gesture, and eight screens of getting there
  // is not what anyone is being asked to watch.
  if (pass.from) {
    await page.evaluate((f) => {
      scrollTo({ top: (document.documentElement.scrollHeight - innerHeight) * f, behavior: 'instant' });
    }, pass.from);
  }
  await page.waitForTimeout(900);

  for (let i = 0; i < pass.repeat; i++) {
    await cdp.send('Input.synthesizeScrollGesture', {
      x: Math.round(VIEWPORT.width / 2),
      y: Math.round(VIEWPORT.height / 2),
      xDistance: 0,
      // Negative yDistance scrolls the content up, i.e. moves the page down.
      yDistance: pass.direction === 'down' ? -pass.distance : pass.distance,
      speed: pass.speed,
      gestureSourceType: 'touch',
      // Let the fling run. Without this the gesture ends the moment the finger
      // lifts and a flick records as a drag, which is the one behaviour §26
      // most wants to see.
      preventFling: false,
    });
    await page.waitForTimeout(pass.pause);
  }

  // A long, still tail. Anything that is still arriving after the last gesture
  // is visible here and nowhere else.
  await page.waitForTimeout(1600);

  const video = page.video();
  await context.close();
  const produced = await video?.path();
  if (produced) {
    renameSync(produced, resolve(OUT, `${pass.name}.webm`));
  }
  console.log(`${pass.name.padEnd(16)} ${pass.repeat} gestures @ ${pass.speed} px/s`);
}

await browser.close();

// Playwright writes one file per page; anything left is a stray.
for (const file of readdirSync(OUT)) {
  if (!/^(slow-scroll|fast-flick|reverse-scroll)\.webm$/.test(file)) rmSync(resolve(OUT, file), { force: true });
}

console.log(`\nwrote ${OUT}`);
