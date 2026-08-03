// Ring clip geometry on short landscape viewports: which edge, by how much,
// and what vertical world-frame would be needed to contain it.
import { chromium } from '@playwright/test';
const URL='http://localhost:5176/experiments/stratos-ascent-full/full.html?lang=hu';
const VPS=[[844,390],[800,360],[932,430],[896,414],[1366,768],[1440,900]];
const ALTS=[0,3000,5000,6000,7000,8000,9000,12000,18000,24000,27000,30000];
const b=await chromium.launch();
for (const [w,h] of VPS){
  const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
  await p.goto(URL,{waitUntil:'networkidle'});
  await p.waitForFunction(()=>globalThis.__stratos?.scene&&globalThis.__stratos?.journey);
  await p.waitForTimeout(900);
  let worst={m:Infinity};
  for(const a of ALTS){
    await p.evaluate(m=>{globalThis.__stratos.journey.debug.altitude=m;},a);
    await p.waitForTimeout(300);
    const r=await p.evaluate(()=>{
      const s=globalThis.__stratos,THREE=s.three,cam=s.camera;
      let root=null,gim=null;
      s.scene.traverse(o=>{if(o.userData?.meridianRoot)root=o;if(o.userData?.meridianGimbal)gim=o;});
      const inG=new Set(); if(gim)gim.traverse(o=>inG.add(o));
      const cv=s.gl.domElement,cw=cv.clientWidth,ch=cv.clientHeight,cr=cv.getBoundingClientRect();
      const v=new THREE.Vector3();
      const bounds=(list)=>{let L=Infinity,T=Infinity,R=-Infinity,B=-Infinity,wy=-Infinity,any=false;
        for(const o of list){const g=o.geometry;if(!g)continue;if(!g.boundingBox)g.computeBoundingBox();const bb=g.boundingBox;if(!bb)continue;
          for(let i=0;i<8;i++){v.set(i&1?bb.max.x:bb.min.x,i&2?bb.max.y:bb.min.y,i&4?bb.max.z:bb.min.z);
            v.applyMatrix4(o.matrixWorld);
            wy=Math.max(wy,Math.abs(v.y-cam.position.y));
            const q=v.clone().project(cam);
            L=Math.min(L,cr.left+((q.x+1)/2)*cw);R=Math.max(R,cr.left+((q.x+1)/2)*cw);
            T=Math.min(T,cr.top+((1-q.y)/2)*ch);B=Math.max(B,cr.top+((1-q.y)/2)*ch);any=true;}}
        return any?{L,T,R,B,worldHalfY:wy}:null;};
      const ess=[],rg=[];
      root.traverse(o=>{if(!o.isMesh||!o.visible)return;for(let q=o.parent;q;q=q.parent)if(!q.visible)return;(inG.has(o)?rg:ess).push(o);});
      const e=bounds(ess),g2=bounds(rg);
      const fovV=cam.fov*Math.PI/180, dist=cam.position.z;
      return {e,g2,vw:innerWidth,vh:innerHeight,camZ:cam.position.z,fov:cam.fov,
              visibleH:2*Math.tan(fovV/2)*dist};
    });
    if(!r.g2) continue;
    const mg={left:r.g2.L,top:r.g2.T,right:r.vw-r.g2.R,bottom:r.vh-r.g2.B};
    const mn=Math.min(mg.left,mg.top,mg.right,mg.bottom);
    if(mn<worst.m) worst={m:mn,a,mg,r};
  }
  const {m,a,mg,r}=worst;
  const edge=Object.entries(mg).sort((x,y)=>x[1]-y[1])[0][0];
  // world half-height the ring needs, vs what the frame currently shows
  const needH = 2*r.g2.worldHalfY;
  console.log(`${String(w+'x'+h).padEnd(10)} worstRing=${m.toFixed(0)}px on ${edge} @${a}m  L/T/R/B=${mg.left.toFixed(0)}/${mg.top.toFixed(0)}/${mg.right.toFixed(0)}/${mg.bottom.toFixed(0)}`);
  console.log(`${''.padEnd(10)}   ringWorldHeight=${needH.toFixed(3)}u  visibleWorldHeight=${r.visibleH.toFixed(3)}u  camZ=${r.camZ.toFixed(3)}  fov=${r.fov}`);
  await p.close();
}
await b.close();
