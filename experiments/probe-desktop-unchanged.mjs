/**
 * Did the mobile reset move the desktop homepage? — §22.
 *
 * Screenshots the desktop composition from two origins, at the same altitudes,
 * and reports the per-pixel difference. The two origins are meant to be a
 * pristine `git worktree` build of HEAD and the working tree's build.
 *
 *   node experiments/probe-desktop-unchanged.mjs --before http://localhost:4323 --after http://localhost:4322
 *
 * WHY IT WAITS FOR THE CLOCK RATHER THAN FOR A DURATION
 * -----------------------------------------------------
 * The desktop journey damps its progress, so two runs that scroll to the same
 * pixel are photographed at two different altitudes unless something makes them
 * wait for the same *state*. With a fixed 1 600 ms pause this probe reported a
 * 7.9% difference between two builds that are byte-identical on desktop — the
 * frames were the same composition at 3 242 m and 2 677 m. It now polls the
 * readout until it has stopped changing, which `SETTLE_EPSILON` guarantees
 * terminates: the settler snaps to its target rather than approaching it
 * forever.
 *
 * A WebGL scene is not bit-deterministic across processes, so the threshold is
 * a fraction of differing pixels rather than zero. Anything structural — a
 * moved panel, a resized instrument, a lost layer — is orders of magnitude
 * above it.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = resolve(ROOT, '_build/reports/desktop-unchanged');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const BEFORE = arg('before', 'http://localhost:4323');
const AFTER = arg('after', 'http://localhost:4322');

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
];

/** Fractions of the track to photograph. One per narrative beat. */
const STOPS = [0, 0.12, 0.3, 0.5, 0.7, 0.88, 1];

async function shoot(origin, viewport, label) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(origin + '/', { waitUntil: 'networkidle' });
  // The scene chunk, the GLB and the first render.
  await page.waitForTimeout(4000);

  const shots = [];
  for (const stop of STOPS) {
    await page.evaluate((f) => {
      const y = (document.documentElement.scrollHeight - innerHeight) * f;
      scrollTo({ top: y, behavior: 'instant' });
    }, stop);

    // WAIT FOR THE CLOCK TO STOP, NOT FOR A DURATION.
    //
    // This was `waitForTimeout(1600)` and it produced a 7.9% difference at one
    // stop between two builds that are byte-identical on desktop. The frames
    // were the same composition photographed at two different altitudes —
    // 3 242 m against 2 677 m — because the damper is asymptotic and 1 600 ms
    // is sometimes enough and sometimes not. A probe that reports the damper's
    // convergence rate as a regression is worse than no probe.
    //
    // `SETTLE_EPSILON` guarantees this terminates: the settler snaps to the
    // target rather than approaching it forever.
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="altitude-value"]');
          if (!el) return true; // no readout on this path; nothing to settle
          const w = window;
          const now = el.textContent ?? '';
          if (now === w.__lastAlt) w.__same = (w.__same || 0) + 1;
          else {
            w.__lastAlt = now;
            w.__same = 0;
          }
          return (w.__same || 0) >= 6;
        },
        null,
        { timeout: 15_000, polling: 100 },
      )
      .catch(() => {});
    // One more frame for the renderer to draw the settled state.
    await page.waitForTimeout(250);
    shots.push({ stop, buffer: await page.screenshot() });
  }

  await context.close();
  await browser.close();
  console.log(`  captured ${label} ${viewport.name}`);
  return shots;
}

/**
 * Compare two PNG buffers, in a browser.
 *
 * Deliberately not `pngjs`: this repository ships two production dependencies
 * on purpose and a decoder is already present in every browser the harness
 * launches. Decoding two data URIs onto a canvas is the whole of it, and it
 * removes a dependency from the diff rather than adding one.
 */
async function diff(page, a, b) {
  return page.evaluate(
    async ([one, two]) => {
      const load = (b64) =>
        new Promise((ok, fail) => {
          const img = new Image();
          img.onload = () => ok(img);
          img.onerror = fail;
          img.src = `data:image/png;base64,${b64}`;
        });
      const [ia, ib] = await Promise.all([load(one), load(two)]);
      if (ia.width !== ib.width || ia.height !== ib.height) {
        return { differing: 1, total: 1, fraction: 1, note: 'size' };
      }
      const draw = (img) => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
        return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      };
      const da = draw(ia);
      const db = draw(ib);
      let differing = 0;
      for (let i = 0; i < da.length; i += 4) {
        // A per-channel tolerance of 8/255. Below that is renderer noise: two
        // processes rasterising the same anti-aliased edge do not agree exactly.
        if (
          Math.abs(da[i] - db[i]) > 8 ||
          Math.abs(da[i + 1] - db[i + 1]) > 8 ||
          Math.abs(da[i + 2] - db[i + 2]) > 8
        ) {
          differing++;
        }
      }
      const total = ia.width * ia.height;
      return { differing, total, fraction: differing / total };
    },
    [a.toString('base64'), b.toString('base64')],
  );
}

mkdirSync(OUT, { recursive: true });
const report = [];
let worst = 0;

// One blank page, used only as an image decoder for the comparison above.
const judge = await chromium.launch();
const judgePage = await (await judge.newContext()).newPage();

for (const viewport of VIEWPORTS) {
  const before = await shoot(BEFORE, viewport, 'before');
  const after = await shoot(AFTER, viewport, 'after');
  for (let i = 0; i < before.length; i++) {
    const d = await diff(judgePage, before[i].buffer, after[i].buffer);
    const pct = (d.fraction * 100).toFixed(3);
    worst = Math.max(worst, d.fraction);
    report.push({ viewport: viewport.name, stop: before[i].stop, differingPixels: d.differing, pct: Number(pct) });
    console.log(`${viewport.name} @${before[i].stop}  ${d.differing} px  ${pct}%`);
    if (d.fraction > 0.005) {
      writeFileSync(resolve(OUT, `${viewport.name}-${before[i].stop}-before.png`), before[i].buffer);
      writeFileSync(resolve(OUT, `${viewport.name}-${before[i].stop}-after.png`), after[i].buffer);
    }
  }
}

await judge.close();
writeFileSync(resolve(OUT, 'desktop-unchanged.json'), JSON.stringify({ before: BEFORE, after: AFTER, worst, report }, null, 2));
console.log(`\nworst frame differs by ${(worst * 100).toFixed(3)}% of pixels`);
console.log(worst > 0.005 ? 'DESKTOP MOVED — see the written pairs' : 'desktop unchanged within renderer noise');
process.exit(worst > 0.005 ? 1 : 0);
