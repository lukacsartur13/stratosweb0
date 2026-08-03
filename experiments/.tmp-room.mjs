// How much clear width is there beside the centred instrument, per viewport,
// across the journey? Drives the landscape copy budget.
import { chromium } from '@playwright/test';
const URL = 'http://localhost:5176/experiments/stratos-ascent-full/full.html?lang=hu';
const VPS = [[1440,900],[1366,768],[1920,1080],[1024,768],[844,390],[800,360],[932,430],[896,414]];
const ALTS = [0,3000,7000,12000,18000,24000,30000];
const b = await chromium.launch();
for (const [w,h] of VPS) {
  const p = await b.newPage({ viewport:{width:w,height:h}, deviceScaleFactor:1 });
  await p.goto(URL,{waitUntil:'networkidle'});
  await p.waitForFunction(()=>globalThis.__stratos?.scene&&globalThis.__stratos?.journey);
  await p.waitForTimeout(900);
  let minSide=Infinity, worst=null, ringWorst=Infinity, ringAt=null;
  for (const a of ALTS) {
    await p.evaluate((m)=>{ globalThis.__stratos.journey.debug.altitude=m; },a);
    await p.waitForTimeout(320);
    const r = await p.evaluate(()=>{
      const s=globalThis.__stratos, THREE=s.three, cam=s.camera;
      let root=null,gim=null;
      s.scene.traverse(o=>{ if(o.userData?.meridianRoot)root=o; if(o.userData?.meridianGimbal)gim=o; });
      const inG=new Set(); if(gim) gim.traverse(o=>inG.add(o));
      const cv=s.gl.domElement, cw=cv.clientWidth, ch=cv.clientHeight, cr=cv.getBoundingClientRect();
      const v=new THREE.Vector3();
      const proj=(list)=>{let a1=Infinity,b1=Infinity,c1=-Infinity,d1=-Infinity,any=false;
        for(const o of list){const g=o.geometry; if(!g)continue; if(!g.boundingBox)g.computeBoundingBox(); const bb=g.boundingBox; if(!bb)continue;
          for(let i=0;i<8;i++){v.set(i&1?bb.max.x:bb.min.x,i&2?bb.max.y:bb.min.y,i&4?bb.max.z:bb.min.z);v.applyMatrix4(o.matrixWorld);v.project(cam);
            const px=cr.left+((v.x+1)/2)*cw, py=cr.top+((1-v.y)/2)*ch;
            a1=Math.min(a1,px);c1=Math.max(c1,px);b1=Math.min(b1,py);d1=Math.max(d1,py);any=true;}}
        return any?{left:a1,top:b1,right:c1,bottom:d1}:null;};
      const ess=[],rings=[];
      root.traverse(o=>{ if(!o.isMesh||!o.visible)return; for(let q=o.parent;q;q=q.parent) if(!q.visible)return; (inG.has(o)?rings:ess).push(o); });
      const e=proj(ess), g2=proj(rings);
      return { e, g2, vw:innerWidth, vh:innerHeight };
    });
    if(r.e){ const side=Math.min(r.e.left, r.vw-r.e.right); if(side<minSide){minSide=side;worst=a;} }
    if(r.g2){ const rs=Math.min(r.g2.left, r.vw-r.g2.right, r.g2.top, r.vh-r.g2.bottom); if(rs<ringWorst){ringWorst=rs;ringAt=a;} }
  }
  console.log(`${String(w+'x'+h).padEnd(10)} aspect=${(w/h).toFixed(2)}  narrowestSideGap=${minSide.toFixed(0)}px @${worst}m   worstRingMargin=${ringWorst.toFixed(0)}px @${ringAt}m`);
  await p.close();
}
await b.close();
