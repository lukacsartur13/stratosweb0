import { chromium } from '@playwright/test';
const URL = 'http://localhost:5176/experiments/stratos-ascent-full/full.html?lang=hu';
const b = await chromium.launch();
for (const [w,h] of [[1440,900],[1366,768],[1024,768],[844,390],[390,844]]) {
  const p = await b.newPage({ viewport:{width:w,height:h}, deviceScaleFactor:1 });
  await p.goto(URL, { waitUntil:'networkidle' });
  await p.waitForFunction(()=>globalThis.__stratos?.scene);
  await p.waitForTimeout(800);
  const rows = await p.evaluate(() => {
    const out = [];
    for (const cls of ['panel--wide','panel--centre','']) {
      const sel = cls ? `.panel.${cls} .panel__inner` : '.panel:not(.panel--wide):not(.panel--centre) .panel__inner';
      const el = document.querySelector(sel);
      if (!el) { out.push({cls: cls||'plain', missing:true}); continue; }
      const cs = getComputedStyle(el);
      out.push({
        cls: cls || 'plain',
        width: Math.round(el.getBoundingClientRect().width),
        copyWidthVar: getComputedStyle(el.closest('.panel')).getPropertyValue('--copy-width').trim() || '(unset)',
        cssWidth: cs.width,
      });
    }
    return { aspect:(innerWidth/innerHeight).toFixed(2), vw: innerWidth, out };
  });
  console.log(`${w}x${h} aspect=${rows.aspect}`);
  for (const r of rows.out) console.log(`   ${String(r.cls).padEnd(14)} width=${r.width??'-'}px  --copy-width=${r.copyWidthVar??'-'}`);
  await p.close();
}
await b.close();
