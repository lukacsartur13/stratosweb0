/**
 * Contact sheet of the homepage ascent at a list of altitudes.
 *
 * Usage: node shots.mjs <outDir> [--base http://localhost:5177/home/hu.html]
 */
import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';

const out = process.argv[2] ?? 'shots';
const baseIdx = process.argv.indexOf('--base');
const base = baseIdx > 0 ? process.argv[baseIdx + 1] : 'http://localhost:5177/home/hu.html';
const only = process.argv.includes('--mobile') ? 'mobile' : process.argv.includes('--desktop') ? 'desktop' : 'both';

const ALTS = (process.env.ALTS ?? '0,1200,3600,5200,6700,9200,11500,13400,15800,18400,21200,24400,27300,29200,30000').split(',').map(Number);

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const settle = () =>
  new Promise((res) => {
    let last = null, stable = 0, frames = 0;
    const tick = () => {
      const s = globalThis.__stratos;
      let root = null;
      s?.scene?.traverse?.((o) => { if (o.userData?.meridianRoot) root = o; });
      const p = root ? root.matrixWorld.elements.join(',') : String(frames);
      if (p === last) stable++; else stable = 0;
      last = p;
      if (stable >= 3 || ++frames > 240) return res();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

const go = (m) =>
  new Promise((res) => {
    const s = globalThis.__stratos;
    s.journey.debug.altitude = m;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const track = document.querySelector('[data-testid="journey-track"]');
        const travel = (track?.offsetHeight ?? document.documentElement.scrollHeight) - innerHeight;
        scrollTo({ top: s.journey.current * travel, behavior: 'instant' });
        s.journey.debug.altitude = m;
        res();
      }),
    );
  });

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  if (only !== 'both' && only !== vp.name) continue;
  const ctx = await browser.newContext(
    vp.name === 'mobile'
      ? { ...devices['iPhone 13'], deviceScaleFactor: 2 }
      : { viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 },
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`  !! pageerror ${e.message}`));
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => globalThis.__stratos?.scene && globalThis.__stratos?.journey, null, { timeout: 40_000 });
  await page.waitForTimeout(1500);
  for (const a of ALTS) {
    await page.evaluate(go, a);
    await page.evaluate(settle);
    await page.waitForTimeout(180);
    const name = `${vp.name}-${String(a).padStart(5, '0')}.jpg`;
    await page.screenshot({ path: `${out}/${name}`, type: 'jpeg', quality: 72 });
    console.log(`  ${name}`);
  }
  await ctx.close();
}
await browser.close();
