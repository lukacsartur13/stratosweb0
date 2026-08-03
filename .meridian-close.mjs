import { chromium } from '@playwright/test';
const OUT='/private/tmp/claude-501/-Users-arturlukacs-Library-Mobile-Documents-com-apple-CloudDocs-Downloads-StratosWeb/893d249a-232a-4d08-a617-690bdf5874fe/scratchpad/shots';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1600,height:1000}});
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('http://localhost:5176/experiments/stratos-ascent-full/full.html',{waitUntil:'networkidle'});
await p.waitForSelector('canvas'); await p.waitForTimeout(2500);
for (const [name, alt, cal] of [['close-18000',18000,1],['close-24000',24000,1],['close-30000',30000,null]]) {
  await p.evaluate(([a,c])=>{const s=globalThis.__stratos; s.journey.debug.altitude=a; s.journey.debug.finalCalibration=c; s.journey.debug.cameraZ=-0.55;},[alt,cal]);
  await p.waitForTimeout(2400);
  await p.screenshot({path:`${OUT}/${name}.png`});
  console.log('shot',name);
}
await b.close();
