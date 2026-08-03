import { chromium, devices } from '@playwright/test';
const URL='http://127.0.0.1:4327/experiments/stratos-ascent-full/';
for (const [name, vp] of [['desktop',{width:1440,height:900}],['mobile-390',{width:390,height:844}]]) {
  const b=await chromium.launch();
  const p=await b.newPage({viewport:vp, deviceScaleFactor:name==='desktop'?1:3});
  await p.goto(URL);
  await p.locator('canvas').waitFor({state:'visible',timeout:20000});
  await p.waitForTimeout(2000);
  // park mid-journey where the scene is heaviest
  const h=await p.evaluate(()=>document.documentElement.scrollHeight);
  await p.evaluate(y=>scrollTo({top:y,behavior:'instant'}), Math.round(h*0.35));
  await p.waitForTimeout(3000);
  const r=await p.evaluate(()=>new Promise(res=>{
    const t=[]; let last=performance.now(); let n=0;
    const tick=()=>{const now=performance.now(); t.push(now-last); last=now; if(++n<60) requestAnimationFrame(tick); else res(t);};
    requestAnimationFrame(tick);
  }));
  const dts=r.slice(5);
  const mean=dts.reduce((a,b)=>a+b,0)/dts.length;
  const sorted=[...dts].sort((a,b)=>a-b);
  console.log(`${name.padEnd(11)} mean ${mean.toFixed(1)} ms  (${(1000/mean).toFixed(1)} fps)   median ${sorted[Math.floor(sorted.length/2)].toFixed(1)} ms   worst ${sorted.at(-1).toFixed(1)} ms`);
  await b.close();
}
