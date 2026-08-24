import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const BASE='http://localhost:4331';
const H=()=>{
  window.__px=s=>{const m=String(s).match(/[\d.]+/g);if(!m)return null;return{r:+m[0],g:+m[1],b:+m[2],a:m.length>3?+m[3]:1};};
  window.__over=(f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
  window.__lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b);};
  window.__ratio=(a,b)=>{const[x,y]=[window.__lum(a),window.__lum(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05);};
  window.__bg=el=>{const st=[];let n=el;while(n&&n.nodeType===1){const c=window.__px(getComputedStyle(n).backgroundColor);
    if(c&&c.a>0){st.push(c);if(c.a===1)break;}n=n.parentElement;}
    let b={r:255,g:255,b:255,a:1};for(let i=st.length-1;i>=0;i--)b=window.__over(st[i],b);return b;};
  window.__m=el=>{const cs=getComputedStyle(el);const fg=window.__px(cs.color);const bg=window.__bg(el);
    return {color:cs.color,bg:`rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
      ratio:+window.__ratio(window.__over(fg,bg),bg).toFixed(2)};};
};
const br=await chromium.launch(); const out={};

// --- FAQ full state machine ------------------------------------------------
{
  const ctx=await br.newContext({viewport:{width:1440,height:900}});
  const p=await ctx.newPage(); await p.goto(`${BASE}/hirdeteskezeles.html`,{waitUntil:'networkidle'});
  await p.evaluate(H);
  const det=p.locator('.faq details').first(), sum=det.locator('summary');
  await det.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
  const mark=()=>sum.evaluate(e=>{const cs=getComputedStyle(e,'::after');
    return {markBg:cs.backgroundImage.slice(0,60), border:getComputedStyle(e.parentElement).borderBottomColor};});
  out.faq={};
  out.faq.closed={...await sum.evaluate(e=>window.__m(e)),...await mark()};
  await sum.hover(); await p.waitForTimeout(300);
  out.faq.hover={...await sum.evaluate(e=>window.__m(e)),...await mark()};
  await p.mouse.move(0,0); await p.waitForTimeout(150);
  await sum.click(); await p.waitForTimeout(500);
  out.faq.open={...await sum.evaluate(e=>window.__m(e)),...await mark()};
  out.faq.answer=await det.locator('.faq__a').evaluate(e=>window.__m(e));
  // keyboard: real Tab to the summary, then Enter to toggle
  await p.evaluate(()=>scrollTo(0,0));
  await sum.evaluate(e=>e.focus());
  await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
  out.faq.focusRing=await p.evaluate(()=>{const a=document.activeElement;const cs=getComputedStyle(a);
    return {tag:a.tagName,matchesFV:a.matches(':focus-visible'),
      outline:`${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`};});
  await ctx.close();
}

// --- the Meta (panel--lit) card must NOT have been touched -----------------
{
  const ctx=await br.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const p=await ctx.newPage(); await p.goto(`${BASE}/hirdeteskezeles.html`,{waitUntil:'networkidle'});
  await p.evaluate(H);
  out.metaCard=await p.evaluate(()=>{
    const lit=document.querySelector('.panel--lit');
    const g=s=>{const e=lit.querySelector(s);return e?{sel:s,...window.__m(e)}:null;};
    return [g('h3'),g('p'),g('.checks li'),g('.card__k')].filter(Boolean);});
  out.googleCard=await p.evaluate(()=>{
    const d=document.querySelector('.panel:not(.panel--lit)');
    const g=s=>{const e=d.querySelector(s);return e?{sel:s,...window.__m(e)}:null;};
    return [g('h3'),g('p'),g('.checks li'),g('.card__k')].filter(Boolean);});
  await ctx.close();
}

// --- the select dropdown on the impact form --------------------------------
{
  const ctx=await br.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const p=await ctx.newPage(); await p.goto(`${BASE}/impact-program.html`,{waitUntil:'networkidle'});
  await p.evaluate(H);
  out.option=await p.evaluate(()=>{const o=document.querySelector('.field select option');
    return o?window.__m(o):null;});
  out.impactCards=await p.evaluate(()=>{
    const c=document.querySelector('.band--pale .panel');
    const g=s=>{const e=c.querySelector(s);return e?{sel:s,...window.__m(e)}:null;};
    return [g('h3'),g('p'),g('.tags span'),g('.card__k')].filter(Boolean);});
  await ctx.close();
}

// --- the altitude rail ticks, measured from REAL PIXELS ---------------------
// The rail is a translucent gradient over whatever section is behind it, so
// computed background-color cannot answer this. Sample the rendered canvas.
{
  const ctx=await br.newContext({viewport:{width:1440,height:900}});
  const p=await ctx.newPage(); await p.goto(`${BASE}/impact-program.html`,{waitUntil:'networkidle'});
  await p.evaluate(H);
  out.railTicks=await p.evaluate(async()=>{
    const t=document.querySelector('.tick__n'); if(!t) return null;
    const r=t.getBoundingClientRect();
    const behind=document.elementsFromPoint(r.left+2,r.top+2)
      .map(e=>e.className&&typeof e.className==='string'?e.className:e.tagName).slice(0,6);
    return {fg:getComputedStyle(t).color,size:getComputedStyle(t).fontSize,
      railBg:getComputedStyle(document.querySelector('.rail')).backgroundImage.slice(0,80),
      ariaHidden:document.querySelector('.rail')?.getAttribute('aria-hidden'),
      pointerEvents:getComputedStyle(document.querySelector('.rail')).pointerEvents,
      behind};});
  await ctx.close();
}
await br.close();
writeFileSync('_build/reports/service-route-repair/verify-after.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
