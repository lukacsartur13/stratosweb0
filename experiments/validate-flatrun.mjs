// =============================================================================
// Calibrate and validate the silhouette shape gate against both populations.
//
//     node experiments/validate-flatrun.mjs
//
// ## The two populations
//
// REJECTED — `experiments/screenshots/scope/{v1,v2}-*-mask.png`. These are exact
// silhouette masks kept from the pre-correction passes, produced by the same
// `silhouette()` render the live script uses, so they are the same input the
// gate will see in production use rather than an approximation of it. `v2` at
// 390×844 is the full-height curtain the brief describes: a single flat mass
// from the frame top to below the midline across almost the whole width, with a
// narrow wedge hard against each edge.
//
// ACCEPTED — `experiments/screenshots/mountains/report.json`, the sixteen stills
// that passed full-resolution human review, re-scored through the same function.
//
// A gate that does not separate these two is not a gate. This prints both, with
// the margin, so the thresholds in `silhouette-metrics.mjs` can be read as
// measurements rather than taken on trust.
//
// ## Why masks and the live report, and never the finished stills
//
// A mask is a decision that has already been made: a pixel is mountain or it is
// not. Re-deriving that from a finished frame means thresholding a graphite
// range against a near-black sky, which is the unreliable separation the mask
// exists to avoid.
//
// That is not a caution, it is a measurement. An earlier version of this script
// scored the finished PNGs with a luminance cut and reported
// `mountains-desktop-07000` as a 45.8%-wide full-height curtain with zero
// contour, and all four 12 000 m stills as "the range is drawn at an altitude it
// should have passed below" — at an altitude where the report records zero
// mountain coverage. It was reading the *page*: the copy plate, the HUD, the
// case-study imagery, every DOM pixel in the screenshot. Four confident
// failures against stills that had passed full-resolution human review.
//
// So the accepted population is read from `report.json`, which carries the
// per-column data taken from the same GPU mask render the gate uses live, and
// the rejected population is read from the kept mask PNGs. Both sides are the
// mask. The finished stills are evidence for a person and are not scored here.
// =============================================================================
import { chromium } from '@playwright/test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { shapeMetrics, shapeVerdict, SHAPE } from './silhouette-metrics.mjs';

const COLS = 240;
const SCOPE = 'experiments/screenshots/scope';
const CURRENT = 'experiments/screenshots/mountains';

/**
 * Columns from a PNG, decoded in a real browser.
 *
 * No image dependency is added for this. The repository already has Chromium
 * through Playwright, and a canvas `getImageData` is a more trustworthy decoder
 * than a hand-rolled PNG reader for palette and interlace variants.
 *
 * The kept masks are two-colour — the mountain black on a light field — so the
 * threshold is a formality rather than a tuned separation, which is exactly the
 * property that makes a mask worth keeping.
 */
async function columnsFromPng(page, path, { mountainIsDark, threshold }) {
  const b64 = readFileSync(path).toString('base64');
  return page.evaluate(
    async ({ data, cols, dark, cut }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, W, H).data;

      const skyline = [];
      const cover = [];
      for (let c = 0; c < cols; c++) {
        const x = Math.min(W - 1, Math.round(((c + 0.5) / cols) * W));
        let top = -1;
        let covered = 0;
        for (let row = 0; row < H; row++) {
          const i = (row * W + x) * 4;
          const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
          const isMountain = dark ? lum < cut : lum > cut;
          if (isMountain) {
            if (top < 0) top = row;
            covered++;
          }
        }
        skyline.push(top < 0 ? 1 : top / H);
        cover.push(covered / H);
      }
      return { skyline, cover, W, H };
    },
    { data: b64, cols: COLS, dark: mountainIsDark, cut: threshold }
  );
}

const browser = await chromium.launch();
const page = await browser.newPage();

const rows = [];

// --- rejected: the kept masks ----------------------------------------------
const masks = existsSync(SCOPE)
  ? readdirSync(SCOPE)
      .filter((f) => f.endsWith('-mask.png'))
      .sort()
  : [];

for (const file of masks) {
  const { skyline, cover, W, H } = await columnsFromPng(page, `${SCOPE}/${file}`, {
    mountainIsDark: true,
    threshold: 127,
  });
  const metres = Number(file.match(/-(\d{5})-mask\.png$/)?.[1] ?? 0);
  const m = shapeMetrics(skyline, cover);
  const v = shapeVerdict(m, { expectVisible: metres < 12_000 });
  rows.push({ population: 'REJECTED', name: file.replace('-mask.png', ''), size: `${W}x${H}`, metres, ...m, ...v });
}

// --- accepted: the sixteen current stills, re-scored ------------------------
//
// From the per-column data the live script records, which is the same GPU mask
// render the gate reads at capture time. Nothing here is derived from a
// finished PNG, so no threshold is calibrated against a number of unstated
// provenance.
const currentReport = existsSync(`${CURRENT}/report.json`)
  ? JSON.parse(readFileSync(`${CURRENT}/report.json`, 'utf8'))
  : [];

for (const r of currentReport) {
  if (!r.sky?.columns) continue;
  const m = shapeMetrics(r.sky.columns.skyline, r.sky.columns.cover);
  const v = shapeVerdict(m, { expectVisible: r.requested < 12_000 });
  rows.push({
    population: 'ACCEPTED',
    name: `mountains-${r.view}-${String(r.requested).padStart(5, '0')}`,
    size: `${r.sky.maskPixels} px`,
    metres: r.requested,
    ...m,
    ...v,
  });
}

if (!currentReport.some((r) => r.sky?.columns)) {
  console.error(
    'no per-column data in the accepted report — run `node experiments/shots-mountains.mjs` first.\n' +
      'The accepted population must be scored from the same mask the gate reads, not from the finished PNGs.'
  );
  process.exitCode = 2;
}

await browser.close();

// --- report -----------------------------------------------------------------
const head =
  `${'population'.padEnd(14)} ${'still'.padEnd(30)} ${'m'.padStart(6)}  ` +
  `${'contour'.padStart(8)} ${'flat'.padStart(6)} ${'curtain'.padStart(8)} ${'wall'.padStart(6)} ${'edge'.padStart(6)}  verdict`;
console.log(head);
console.log('-'.repeat(head.length));

for (const r of rows) {
  const verdict = r.failures.length ? `FAIL — ${r.failures[0]}` : r.warnings.length ? `warn — ${r.warnings[0]}` : 'pass';
  console.log(
    `${r.population.padEnd(14)} ${r.name.padEnd(30)} ${String(r.metres).padStart(6)}  ` +
      `${String(r.contour ?? '-').padStart(8)} ${String(r.flatRun ?? '-').padStart(6)} ` +
      `${String(r.curtainRun ?? '-').padStart(8)} ${String(r.wallRun ?? '-').padStart(6)} ` +
      `${String(r.edgeWedgeRun ?? '-').padStart(6)}  ${verdict}`
  );
}

// --- the separation ---------------------------------------------------------
const rejected = rows.filter((r) => r.population === 'REJECTED' && r.present);
const accepted = rows.filter((r) => r.population === 'ACCEPTED' && r.present);
const stat = (set, key) =>
  set.length ? { min: Math.min(...set.map((r) => r[key])), max: Math.max(...set.map((r) => r[key])) } : null;

console.log('\n--- measured populations ---------------------------------------');
for (const key of ['contour', 'flatRun', 'curtainRun', 'wallRun', 'edgeWedgeRun']) {
  const rj = stat(rejected, key);
  const ac = stat(accepted, key);
  console.log(
    `${key.padEnd(13)} rejected ${rj ? `${rj.min.toFixed(4)} … ${rj.max.toFixed(4)}` : 'n/a'.padEnd(17)}   ` +
      `accepted ${ac ? `${ac.min.toFixed(4)} … ${ac.max.toFixed(4)}` : 'n/a'}`
  );
}

console.log('\n--- thresholds -------------------------------------------------');
for (const [k, v] of Object.entries(SHAPE)) console.log(`  ${k.padEnd(20)} ${v}`);

const rejectedPassing = rejected.filter((r) => r.failures.length === 0);
const acceptedFailing = accepted.filter((r) => r.failures.length > 0);
const acceptedWarning = accepted.filter((r) => r.warnings.length > 0);
const currentPresent = currentReport.filter((r) => r.sky && r.requested < 12_000).length;

console.log('\n--- verdict ----------------------------------------------------');
console.log(`rejected masks scored     : ${rejected.length}, of which ${rejectedPassing.length} would still pass`);
console.log(`accepted stills scored    : ${accepted.length}, of which ${acceptedFailing.length} fail, ${acceptedWarning.length} warn`);
console.log(`live accepted states gated in shots-mountains.mjs: ${currentPresent}`);
for (const r of rejectedPassing) console.log(`  MISSED  ${r.name} — the gate does not reject a known-bad still`);
for (const r of acceptedFailing) console.log(`  BROKE   ${r.name} — ${r.failures.join('; ')}`);

process.exitCode = rejectedPassing.length || acceptedFailing.length ? 1 : 0;
