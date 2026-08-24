import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const BASE='http://localhost:4331';
const VIEWS=[[1440,900],[1280,800],[1920,1080]];
const browser=await chromium.launch(); const out={};
for(const [W,H] of VIEWS){
  const ctx=await browser.newContext({viewport:{width:W,height:H}});
  const page=await ctx.newPage();
  await page.goto(`${BASE}/szolgaltatasok.html`,{waitUntil:'networkidle'});
  await page.waitForTimeout(300);
  const geo=await page.evaluate(()=>{
    const el=document.querySelector('[data-rail]'); const pin=el.querySelector('.rail__pin');
    const r=el.getBoundingClientRect();
    return {docTop:Math.round(r.top+scrollY),height:Math.round(r.height),
      pinH:Math.round(pin.getBoundingClientRect().height),
      travel:Number(getComputedStyle(el).getPropertyValue('--rail-travel').replace('px','')),
      innerH:innerHeight};
  });
  const samples=[];
  for(let y=Math.max(0,geo.docTop-H); y<=geo.docTop+geo.height+40; y+=40){
    await page.evaluate(v=>scrollTo({top:v,behavior:'instant'}),y); await page.waitForTimeout(40);
    samples.push(await page.evaluate(()=>{
      const el=document.querySelector('[data-rail]'); const pin=el.querySelector('.rail__pin');
      const track=el.querySelector('[data-rail-track]');
      const r=el.getBoundingClientRect(), pr=pin.getBoundingClientRect();
      const m=/translate3d\(([-\d.]+)px/.exec(track.style.transform);
      return {y:Math.round(scrollY),top:Math.round(r.top),x:m?Math.round(+m[1]):0,
        at:el.dataset.railAt??null,
        pinned: Math.abs(pr.top)<2 && r.top<=1 && r.bottom>=pr.height-1};
    }));
  }
  out[`${W}x${H}`]={geo,samples};
}
await browser.close();
writeFileSync('_build/reports/service-route-repair/rail-after.json',JSON.stringify(out,null,2));
for(const [k,v] of Object.entries(out)){
  const pin=v.samples.filter(s=>s.pinned);
  const last=pin[pin.length-1];
  const end=v.samples[v.samples.length-1];
  console.log(`\n${k}  innerH=${v.geo.innerH} height=${v.geo.height} pinH=${v.geo.pinH} travel=${v.geo.travel}px`);
  console.log(`  pinned window ${pin[0]?.y} -> ${last?.y}`);
  console.log(`  rail x at pin RELEASE: ${last?.x}px of ${-v.geo.travel}px  => ${(100*Math.abs(last?.x||0)/v.geo.travel).toFixed(1)}% travelled while pinned`);
  console.log(`  rail x at very end   : ${end.x}px  (remaining ${(100-100*Math.abs(last?.x||0)/v.geo.travel).toFixed(1)}% happens UNPINNED)`);
  console.log(`  panel index at release: ${last?.at}`);
}
