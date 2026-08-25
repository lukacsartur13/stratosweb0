// =============================================================================
// §46 · THE DETAIL DESTINATION, PHOTOGRAPHED.
//
// `05 · A folyamat` on the services route, which is where the seven checkpoints
// and their four terms went. Desktop and phone, all three locales, so the
// review can see that the deep content reads as part of THAT page's design
// system rather than as the homepage composition transplanted onto it — §25.
//
// It serves the generated site off the filesystem through Playwright's own
// router instead of asking for a web server: the pages are static and their
// asset URLs are root-absolute, so a route handler rooted at the repository is
// exactly the server they need and one fewer thing to have running.
//
// Usage:  npm run generate && node experiments/shots-process-detail.mjs
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = '_build/reports/luxury-art-direction/process';

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
};

/** hu / en / de -> the page's filename in that tree, from `_build/routes.json`. */
const ROUTES = JSON.parse(readFileSync(join(ROOT, '_build', 'routes.json'), 'utf8')).slugs.services;
const PAGE = { hu: `/${ROUTES.hu}`, en: `/en/${ROUTES.en}`, de: `/de/${ROUTES.de}` };

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });

async function serve(context) {
  await context.route('**/*', async (route) => {
    const { pathname } = new URL(route.request().url());
    const file = join(ROOT, decodeURIComponent(pathname));
    if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
      return route.fulfill({ status: 404, body: '' });
    }
    route.fulfill({
      status: 200,
      contentType: TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      body: readFileSync(file),
    });
  });
}

async function shoot({ locale, width, height, mobile, name }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    ...(mobile ? { hasTouch: true, isMobile: true } : null),
  });
  await serve(context);
  const page = await context.newPage();
  await page.goto(`https://stratos.local${PAGE[locale]}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // The steps carry `data-reveal`, which is a scroll reveal rather than a
  // gate: the copy is in the document either way, and this only makes the
  // picture show it at full contrast.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-reveal]')) el.classList.add('is-in', 'in');
    document.querySelector('#folyamat')?.scrollIntoView();
  });
  await page.waitForTimeout(1200);
  // The section's own box rather than a clip on the page: the band is taller
  // than the viewport and a clip past the fold needs a full-page capture, which
  // would drag in the header and every band above it.
  const shot = page.locator('#folyamat');
  await shot.screenshot({ path: `${OUT}/${name}.png` });
  const tall = (await shot.boundingBox())?.height ?? 0;
  console.log(`${name}  ${Math.round(tall)}px`);
  await context.close();
}

await shoot({ locale: 'hu', width: 1440, height: 900, name: 'process-detail-desktop-hu' });
await shoot({ locale: 'de', width: 1440, height: 900, name: 'process-detail-desktop-de' });
await shoot({ locale: 'en', width: 1440, height: 900, name: 'process-detail-desktop-en' });
await shoot({ locale: 'hu', width: 390, height: 844, mobile: true, name: 'process-detail-mobile-hu' });

await browser.close();
