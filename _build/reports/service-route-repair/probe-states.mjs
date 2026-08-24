/* States the settled sweep cannot see: an OPEN FAQ entry, a summary under
   hover, and the scroll-driven `.is-on` stage progression. §26 — this is what
   separates a colour bug from a timing bug. */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:4331';
const HELPERS = () => {
  window.__px = (s) => { const m = String(s).match(/[\d.]+/g); if (!m) return null;
    return { r:+m[0], g:+m[1], b:+m[2], a: m.length>3?+m[3]:1 }; };
  window.__over = (f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
  window.__lum = (c)=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
    return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);};
  window.__ratio=(a,b)=>{const[x,y]=[window.__lum(a),window.__lum(b)].sort((m,n)=>n-m);return (x+0.05)/(y+0.05);};
  window.__bg=(el)=>{const st=[];let n=el;while(n&&n.nodeType===1){const c=window.__px(getComputedStyle(n).backgroundColor);
    if(c&&c.a>0){st.push(c);if(c.a===1)break;}n=n.parentElement;}
    let base={r:255,g:255,b:255,a:1};for(let i=st.length-1;i>=0;i--)base=window.__over(st[i],base);return base;};
  window.__m=(el)=>{const cs=getComputedStyle(el);const fg=window.__px(cs.color);const bg=window.__bg(el);
    return {color:cs.color,bg:`rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
      size:+parseFloat(cs.fontSize).toFixed(1),weight:cs.fontWeight,
      ratio:+window.__ratio(window.__over(fg,bg),bg).toFixed(2)};};
};

const browser = await chromium.launch();
const out = {};

// ---- FAQ: closed / hover / open, on the pale band --------------------------
{
  const page = await (await browser.newContext({ viewport:{width:1440,height:900} })).newPage();
  await page.goto(`${BASE}/hirdeteskezeles.html`, { waitUntil:'networkidle' });
  await page.addInitScript(HELPERS); await page.evaluate(HELPERS);
  const faq = page.locator('.faq details').first();
  await faq.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  const sum = faq.locator('summary');
  out.faq = {};
  out.faq.closed = await sum.evaluate((e)=>window.__m(e));
  await sum.hover(); await page.waitForTimeout(250);
  out.faq.hover = await sum.evaluate((e)=>window.__m(e));
  await page.mouse.move(0,0); await page.waitForTimeout(150);
  await sum.click(); await page.waitForTimeout(500);
  out.faq.open = await sum.evaluate((e)=>window.__m(e));
  out.faq.answer = await faq.locator('.faq__a').evaluate((e)=>window.__m(e));
  // keyboard focus-visible
  out.faq.focus = await page.evaluate(() => {
    const s = document.querySelector('.faq summary');
    s.focus();
    const cs = getComputedStyle(s);
    return { outline: cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor,
             boxShadow: cs.boxShadow, isActive: document.activeElement === s };
  });
  await page.context().close();
}

// ---- build stages: does `.is-on` actually progress with scroll? ------------
for (const route of ['/kkv.html','/nagyvallalat.html']) {
  const page = await (await browser.newContext({ viewport:{width:1440,height:900} })).newPage();
  await page.goto(`${BASE}${route}`, { waitUntil:'networkidle' });
  await page.evaluate(HELPERS);
  const has = await page.locator('.build__stage').count();
  if (!has) { await page.context().close(); continue; }
  const samples = [];
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let i = 0; i <= 20; i++) {
    await page.evaluate((y) => scrollTo({top:y,behavior:'instant'}), Math.round((H - 900) * i / 20));
    await page.waitForTimeout(160);
    samples.push(await page.evaluate(() => {
      const st = Array.from(document.querySelectorAll('.build__stage'));
      const box = document.querySelector('.build');
      const r = box?.getBoundingClientRect();
      return {
        y: Math.round(scrollY),
        on: st.map(s => s.classList.contains('is-on') ? 1 : 0),
        k: st.map(s => window.__m(s.querySelector('.build__k')).ratio),
        rect: r ? { top: Math.round(r.top), h: Math.round(r.height) } : null,
      };
    }));
  }
  out[`build${route}`] = samples;
  await page.context().close();
}

await browser.close();
writeFileSync('_build/reports/service-route-repair/states-before.json', JSON.stringify(out,null,2));
console.log(JSON.stringify(out.faq, null, 2));
