import { chromium } from '@playwright/test';
const W = Number(process.argv[2] || 1440), H = Number(process.argv[3] || 900);
const LOC = process.argv[4] || 'hu';
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=metal','--enable-unsafe-swiftshader'] });
const c = await b.newContext({ viewport:{width:W,height:H}, deviceScaleFactor:1 });
const p = await c.newPage();
await p.goto(LOC==='hu'?'http://localhost:4322/index.html':`http://localhost:4322/${LOC}/index.html`, {waitUntil:'networkidle'});
await p.evaluate(()=>document.fonts.ready);
await p.waitForTimeout(2000);
const r = await p.evaluate((H) => {
  const out = {};
  const track = document.querySelector('[data-testid="journey-track"]');
  out.track = track ? track.offsetHeight : null;
  out.screens = out.track / H;
  out.u = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u'));
  out.panels = [...document.querySelectorAll('.panel')].map(pl => {
    const body = pl.querySelector('.act__body, .passage__body');
    const hold = pl.querySelector('.passage__hold, .act__hold');
    return {
      stage: pl.dataset.stage, level: pl.dataset.level,
      h: +(pl.offsetHeight/H).toFixed(3),
      hold: hold ? +(hold.offsetHeight/H).toFixed(3) : null,
      body: body ? +(body.offsetHeight/H).toFixed(3) : null,
      items: [...pl.querySelectorAll('.passage__item, .act__body > *')].map(i => ({
        cls: i.className, h: +(i.offsetHeight/H).toFixed(3),
        n: i.querySelectorAll('h3,p,li').length,
      })),
    };
  });
  return out;
}, H);
console.log(JSON.stringify(r, null, 1));
await b.close();
