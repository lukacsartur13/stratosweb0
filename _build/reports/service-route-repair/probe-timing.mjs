/* §12/§16 — the actual timeline of every pinned section, from document
   geometry rather than from eyeballing a recording. For each pinned block:
   container height, pin travel, where each stage turns on, and how much of
   that stage is readable WHILE PINNED. */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:4331';
const ROUTES = (process.env.ROUTES || '/kkv.html,/nagyvallalat.html,/szolgaltatasok.html,/hirdeteskezeles.html,/impact-program.html,/rolunk.html,/ugyfelszolgalat.html,/branding.html,/munkaink.html').split(',');
const W = Number(process.env.W || 1440), H = Number(process.env.H || 900);

const browser = await chromium.launch();
const out = {};

for (const route of ROUTES) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const blocks = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[data-stage], [data-rail]')) {
      const pin = el.querySelector('.stage__pin, .rail__pin');
      const r = el.getBoundingClientRect();
      out.push({
        kind: el.hasAttribute('data-stage') ? 'stage' : 'rail',
        cls: el.className,
        docTop: Math.round(r.top + scrollY),
        height: Math.round(r.height),
        pinH: pin ? Math.round(pin.getBoundingClientRect().height) : null,
        pinTop: pin ? getComputedStyle(pin).top : null,
        items: el.querySelectorAll('[data-stage-item]').length,
      });
    }
    return out;
  });
  if (!blocks.length) { await ctx.close(); continue; }

  // Walk each block through its own range at 40px resolution.
  const timelines = [];
  for (const [bi, b] of blocks.entries()) {
    const from = b.docTop - H, to = b.docTop + b.height + 40;
    const samples = [];
    for (let y = Math.max(0, from); y <= to; y += 40) {
      await page.evaluate((yy) => scrollTo({top:yy,behavior:'instant'}), y);
      await page.waitForTimeout(45);
      samples.push(await page.evaluate((i) => {
        const el = document.querySelectorAll('[data-stage], [data-rail]')[i];
        const pin = el.querySelector('.stage__pin, .rail__pin');
        const r = el.getBoundingClientRect();
        const pr = pin?.getBoundingClientRect();
        const items = Array.from(el.querySelectorAll('[data-stage-item]'));
        return {
          y: Math.round(scrollY),
          top: Math.round(r.top),
          p: Number(getComputedStyle(el).getPropertyValue('--stage-p')) || 0,
          at: el.dataset.stageAt ?? null,
          on: items.map(s => s.classList.contains('is-on') ? 1 : 0).join(''),
          // pinned == the pin's top is glued to its inset while the container straddles it
          pinned: pr ? (Math.abs(pr.top) < 2 && r.top <= 1 && r.bottom >= pr.height - 1) : false,
        };
      }, bi));
    }
    timelines.push({ ...b, samples });
  }
  out[route] = timelines;
  await ctx.close();
}
await browser.close();
writeFileSync(process.env.OUT || '_build/reports/service-route-repair/timing-1440-before.json', JSON.stringify(out, null, 2));
console.log('blocks:', Object.entries(out).map(([k,v])=>`${k}:${v.length}`).join(' '));
