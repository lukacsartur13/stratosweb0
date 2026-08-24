/* §40 review assets. Run twice — LABEL=before against the unrepaired build,
   LABEL=after against the repaired one — then compose.mjs builds the sheets. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:4331';
const LABEL = process.env.LABEL || 'after';
const DIR = `_build/reports/service-route-repair/shots`;
mkdirSync(DIR, { recursive: true });

const br = await chromium.launch();

/* ---- the three contrast targets §40 names ---- */
const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();

// 1. Impact cause cards
await p.goto(`${BASE}/impact-program.html`, { waitUntil: 'networkidle' });
await p.evaluate(() => document.documentElement.classList.add('motion-off'));
await p.addStyleTag({ content: '[data-reveal]{opacity:1!important;transform:none!important}' });
await p.locator('.band--pale .panel').first().scrollIntoViewIfNeeded();
await p.waitForTimeout(600);
await p.locator('.band--pale .grid.g-2').first()
  .screenshot({ path: `${DIR}/impact-cards-${LABEL}.png` });

// 2. Google Ads / Meta Ads pair
await p.goto(`${BASE}/hirdeteskezeles.html`, { waitUntil: 'networkidle' });
await p.addStyleTag({ content: '[data-reveal]{opacity:1!important;transform:none!important}' });
await p.locator('.band--pale .panel').first().scrollIntoViewIfNeeded();
await p.waitForTimeout(600);
await p.locator('.band--pale .grid.g-2').first()
  .screenshot({ path: `${DIR}/ads-cards-${LABEL}.png` });

// 3. FAQ, with an entry open — the state the screenshot in the brief shows
await p.locator('.faq details').first().scrollIntoViewIfNeeded();
await p.waitForTimeout(300);
await p.locator('.faq summary').first().click();
await p.waitForTimeout(700);
await p.locator('.faq').first().screenshot({ path: `${DIR}/faq-open-${LABEL}.png` });
await ctx.close();

/* ---- the scroll-timing contact sheet: one frame per stage boundary ---- */
for (const route of ['/kkv.html', '/szolgaltatasok.html']) {
  const c = await br.newContext({ viewport: { width: 1440, height: 900 } });
  const q = await c.newPage();
  await q.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  await q.waitForTimeout(500);
  const geo = await q.evaluate(() => {
    const el = document.querySelector('[data-stage], [data-rail]');
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top + scrollY), h: Math.round(r.height) };
  });
  // Five frames evenly across the section's own scroll range.
  for (let i = 0; i < 5; i++) {
    const y = geo.top + Math.round((geo.h - 900) * i / 4);
    await q.evaluate(async (v) => {
      scrollTo({ top: v, behavior: 'instant' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, y);
    await q.waitForTimeout(250);
    const tag = route.replace(/[/.]|html/g, '') || 'home';
    await q.screenshot({ path: `${DIR}/timing-${tag}-${i}-${LABEL}.png` });
  }
  await c.close();
}

/* ---- natural-scroll recordings, one per affected route ---- */
for (const route of ['/impact-program.html', '/hirdeteskezeles.html', '/kkv.html', '/szolgaltatasok.html']) {
  const tag = route.replace(/[/.]|html/g, '');
  const c = await br.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: `${DIR}/../recordings-${LABEL}/${tag}`, size: { width: 1440, height: 900 } },
  });
  const q = await c.newPage();
  await q.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  await q.waitForTimeout(800);
  // A reader's pace, not a jump: ~90px per beat with the page's own smooth
  // scrolling doing the easing, which is what §33 means by natural scroll.
  const H = await q.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < H - 900; y += 90) {
    await q.evaluate((v) => scrollTo(0, v), y);
    await q.waitForTimeout(55);
  }
  await q.waitForTimeout(700);
  await c.close();
}

await br.close();
console.log('captured:', LABEL);
