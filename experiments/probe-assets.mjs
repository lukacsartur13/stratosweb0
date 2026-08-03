// =============================================================================
// Phase 5C: every image on every homepage route actually decodes.
//
//     npm run dev:home                                  # serves :5177
//     npm run build && npm run serve:dist               # serves :4322
//     node experiments/probe-assets.mjs
//
// ## The defect this exists to catch
//
// Case-study imagery is referenced by root-relative URL — `/assets/img/
// work-1.jpg` — which is what it is in production and what the other eleven
// static pages use. On the dev server nothing served that tree: Vite's
// `publicDir` is the repo-root `public/` (models and the DRACO decoder) and the
// project root is `experiments/`, so the request fell through to the SPA
// fallback and came back **200 OK with `Content-Type: text/html`**. The index
// document, served in place of a JPEG.
//
// That is why it went unnoticed for so long. There is no 404 in the network
// panel, no console error, and no failed request to count — the only symptom is
// that `img.naturalWidth` is 0 and the browser draws its broken-image box, in
// every dev-server still taken at 12 000 m where the case studies are on
// screen. A status-code check would have passed. This checks decode instead.
//
// The fix is `experiments/vite-site-assets.ts`, a dev-only middleware. Nothing
// about the production URLs changed, which is why this probe checks both: the
// point is that development now matches production, not that development was
// made to pass.
// =============================================================================
import { chromium } from '@playwright/test';

const DEV = process.env.DEV_URL ?? 'http://localhost:5177';
const PROD = process.env.PROD_URL ?? 'http://localhost:4322';

const ROUTES = [
  { label: 'dev  hu', url: `${DEV}/home/hu.html` },
  { label: 'dev  en', url: `${DEV}/home/en.html` },
  { label: 'dev  de', url: `${DEV}/home/de.html` },
  { label: 'prod hu', url: `${PROD}/` },
  { label: 'prod en', url: `${PROD}/en/` },
  { label: 'prod de', url: `${PROD}/de/` },
];

/**
 * Walk the whole track so every `loading="lazy"` image is asked for, then wait
 * for each one to finish decoding.
 *
 * `decode()` rather than the `load` event: a request that returned an HTML
 * document *fires* `load` on the `<img>`… it does not, in fact — but
 * `complete` becomes true either way once the browser has stopped waiting, and
 * `naturalWidth === 0` is the only reliable statement that nothing was drawn.
 * Both are reported.
 */
async function audit(page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let i = 0; i <= 14; i++) {
    await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), (height * i) / 14);
    await page.waitForTimeout(220);
  }
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(600);

  return page.evaluate(async () => {
    const images = Array.from(document.images);
    await Promise.all(
      images.map((img) =>
        img
          .decode()
          .then(() => undefined)
          .catch(() => undefined)
      )
    );
    return images.map((img) => ({
      src: img.currentSrc || img.src,
      alt: img.alt,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      loading: img.loading,
    }));
  });
}

/** What the server actually answered with, independent of the DOM. */
async function head(page, url) {
  return page.evaluate(async (u) => {
    try {
      const res = await fetch(u, { method: 'GET' });
      return { status: res.status, type: res.headers.get('content-type') };
    } catch (e) {
      return { status: 0, type: String(e) };
    }
  }, url);
}

const browser = await chromium.launch();
const failures = [];

for (const route of ROUTES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  let reached = true;
  try {
    const res = await page.goto(route.url, { waitUntil: 'networkidle', timeout: 30_000 });
    if (!res || res.status() >= 400) {
      reached = false;
      failures.push(`${route.label}: ${route.url} returned ${res?.status() ?? 'no response'}`);
    }
  } catch (e) {
    reached = false;
    failures.push(`${route.label}: ${route.url} unreachable — ${e.message.split('\n')[0]}`);
  }

  if (!reached) {
    console.log(`\n${route.label}  ${route.url}\n  UNREACHABLE`);
    await ctx.close();
    continue;
  }

  const images = await audit(page);
  const broken = images.filter((i) => i.naturalWidth === 0 || i.naturalHeight === 0);

  console.log(`\n${route.label}  ${route.url}`);
  console.log(`  ${images.length} images, ${images.length - broken.length} decoded, ${broken.length} broken`);
  for (const b of broken) {
    const served = await head(page, b.src);
    console.log(`    BROKEN ${b.src}  server said ${served.status} ${served.type}`);
    failures.push(`${route.label}: ${b.src} did not decode (server: ${served.status} ${served.type})`);
  }
  // The content-type of one known case-study image, reported either way. A
  // `text/html` here is the exact shape of the defect and is worth printing on
  // a passing run too.
  const sample = images.find((i) => /work-\d\.jpg/.test(i.src));
  if (sample) {
    const served = await head(page, sample.src);
    console.log(`    sample ${sample.src.replace(/^https?:\/\/[^/]+/, '')} -> ${served.status} ${served.type}`);
    if (!/^image\//.test(served.type ?? '')) {
      failures.push(`${route.label}: ${sample.src} served as ${served.type}, not an image`);
    }
  }

  await ctx.close();
}

await browser.close();

console.log('\n--- verdict ----------------------------------------------------');
if (failures.length) {
  console.log(`${failures.length} asset failures:`);
  for (const f of failures) console.log(`  ${f}`);
} else {
  console.log('every image on all six homepage routes decoded, dev and production.');
}
process.exitCode = failures.length ? 1 : 0;
