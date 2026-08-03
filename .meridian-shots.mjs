import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const OUT = process.env.OUT || '/private/tmp/claude-501/-Users-arturlukacs-Library-Mobile-Documents-com-apple-CloudDocs-Downloads-StratosWeb/893d249a-232a-4d08-a617-690bdf5874fe/scratchpad/shots';
const URL = 'http://localhost:5176/experiments/stratos-ascent-full/full.html';
const STOPS = [0, 3000, 7000, 12000, 18000, 24000, 30000];
const W = Number(process.env.W || 1440);
const H = Number(process.env.H || 900);

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
await page.waitForTimeout(2500);

for (const m of STOPS) {
  await page.evaluate((metres) => {
    globalThis.__stratos.journey.debug.altitude = metres;
  }, m);
  await page.waitForTimeout(2200);
  const name = `${W}-${String(m).padStart(5, '0')}m.png`;
  await page.screenshot({ path: `${OUT}/${name}` });
  console.log('shot', name, await page.evaluate(() => JSON.stringify({
    ap: globalThis.__stratos.meridian.apertureOpen.toFixed(3),
    r: globalThis.__stratos.meridian.rings.map((x) => x.settle.toFixed(2)).join('/'),
  })));
}

await browser.close();
