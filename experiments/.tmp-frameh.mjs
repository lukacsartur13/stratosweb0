// Required FRAME_HEIGHT so the active ring is fully contained, with the mobile
// 16px edge margin, at every altitude on short landscape viewports.
//
// When the height term binds, visibleWorldHeight = k * FRAME_HEIGHT, so
//   FRAME_HEIGHT >= ringWorldHeight * h/(h-32) / k
import { chromium } from '@playwright/test';
const URL='http://localhost:5176/experiments/stratos-ascent-full/full.html?lang=hu';
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
const span=(m,a,b)=>clamp((m-a)/(b-a));
const ease=(t)=>t*t*(3-2*t);
const lerp=(a,b,t)=>a+(b-a)*t;
const kAt=(m)=>{let k=lerp(1.06,0.94,ease(span(m,0,2400)));k=lerp(k,1.14,ease(span(m,5000,9500)));k=lerp(k,1.3,ease(span(m,9500,17000)));k=lerp(k,1.38,ease(span(m,24000,30000)));return k;};
const ALTS=Array.from({length:31},(_,i)=>i*1000);
const VPS=[[844,390],[800,360],[932,430],[896,414]];
const b=await chromium.launch();
for(const [w,h] of VPS){
  const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
  await p.goto(URL,{waitUntil:'networkidle'});
  await p.waitForFunction(()=>globalThis.__stratos?.scene&&globalThis.__stratos?.journey);
  await p.waitForTimeout(900);
  let need=0,needAt=null,maxRing=0;
  for(const a of ALTS){
    await p.evaluate(m=>{globalThis.__stratos.journey.debug.altitude=m;},a);
    await p.waitForTimeout(220);
    const rh=await p.evaluate(()=>{
      const s=globalThis.__stratos,THREE=s.three,cam=s.camera;
      let root=null,gim=null;
      s.scene.traverse(o=>{if(o.userData?.meridianRoot)root=o;if(o.userData?.meridianGimbal)gim=o;});
      if(!gim)return null;
      const inG=new Set();gim.traverse(o=>inG.add(o));
      const v=new THREE.Vector3();let wy=0,any=false;
      root.traverse(o=>{if(!o.isMesh||!o.visible||!inG.has(o))return;
        for(let q=o.parent;q;q=q.parent)if(!q.visible)return;
        const g=o.geometry;if(!g)return;if(!g.boundingBox)g.computeBoundingBox();const bb=g.boundingBox;if(!bb)return;
        for(let i=0;i<8;i++){v.set(i&1?bb.max.x:bb.min.x,i&2?bb.max.y:bb.min.y,i&4?bb.max.z:bb.min.z);
          v.applyMatrix4(o.matrixWorld);wy=Math.max(wy,Math.abs(v.y-cam.position.y));any=true;}});
      return any?2*wy:null;});
    if(!rh)continue;
    maxRing=Math.max(maxRing,rh);
    const req=rh*h/(h-32)/kAt(a);
    if(req>need){need=req;needAt=a;}
  }
  console.log(`${String(w+'x'+h).padEnd(9)} maxRingWorldHeight=${maxRing.toFixed(3)}u  requiredFRAME_HEIGHT=${need.toFixed(3)}u @${needAt}m (k=${kAt(needAt).toFixed(3)})`);
  await p.close();
}
await b.close();
