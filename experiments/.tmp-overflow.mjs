// Portrait: by how much does band content exceed the room the instrument leaves?
import { chromium } from '@playwright/test';
const URL='http://localhost:5176/experiments/stratos-ascent-full/full.html?lang=hu';
const VPS=[[768,1024],[430,932],[390,844],[360,800],[320,568]];
const ALTS=[0,2727,3000,5454,8181,10909,12000,18000,21818,24000,30000];
const b=await chromium.launch();
for(const [w,h] of VPS){
  const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
  await p.goto(URL,{waitUntil:'networkidle'});
  await p.waitForFunction(()=>globalThis.__stratos?.scene&&globalThis.__stratos?.journey);
  await p.waitForTimeout(900);
  const bad=[];
  for(const a of ALTS){
    await p.evaluate(m=>{const s=globalThis.__stratos;s.journey.debug.altitude=m;
      const t=document.querySelector('[data-testid="journey-track"]');
      const trav=(t?.offsetHeight??document.documentElement.scrollHeight)-innerHeight;
      scrollTo({top:s.journey.current*trav,behavior:'instant'});s.journey.debug.altitude=m;},a);
    await p.waitForTimeout(320);
    const r=await p.evaluate(()=>{
      const s=globalThis.__stratos,THREE=s.three,cam=s.camera;
      let root=null,gim=null;
      s.scene.traverse(o=>{if(o.userData?.meridianRoot)root=o;if(o.userData?.meridianGimbal)gim=o;});
      const inG=new Set();if(gim)gim.traverse(o=>inG.add(o));
      const cv=s.gl.domElement,cw=cv.clientWidth,ch=cv.clientHeight,cr=cv.getBoundingClientRect();
      const v=new THREE.Vector3();let T=Infinity,B=-Infinity;
      root.traverse(o=>{if(!o.isMesh||!o.visible||inG.has(o))return;
        for(let q=o.parent;q;q=q.parent)if(!q.visible)return;
        const g=o.geometry;if(!g)return;if(!g.boundingBox)g.computeBoundingBox();const bb=g.boundingBox;if(!bb)return;
        for(let i=0;i<8;i++){v.set(i&1?bb.max.x:bb.min.x,i&2?bb.max.y:bb.min.y,i&4?bb.max.z:bb.min.z);
          v.applyMatrix4(o.matrixWorld);v.project(cam);
          const py=cr.top+((1-v.y)/2)*ch;T=Math.min(T,py);B=Math.max(B,py);}});
      const pad=Math.max(8,Math.min(innerWidth,innerHeight)*0.015);
      const zt=T-pad, zb=B+pad;
      const hits=[];
      for(const el of document.querySelectorAll('.panel h1,.panel h2,.panel__lead,.panel__eyebrow,.panel p,a.btn')){
        const rr=el.getBoundingClientRect();
        if(rr.width===0||rr.height===0)continue;
        if(rr.bottom<0||rr.top>innerHeight)continue;
        const cs=getComputedStyle(el); if(cs.visibility==='hidden'||Number(cs.opacity)<0.05)continue;
        let faded=false;for(let q=el.parentElement;q&&q!==document.body;q=q.parentElement){if(Number(getComputedStyle(q).opacity)<0.05){faded=true;break;}}
        if(faded)continue;
        if(rr.top<zb&&rr.bottom>zt){
          // how far into the zone, and from which side
          const fromTop = zb - rr.top;      // pushing down needed
          const fromBot = rr.bottom - zt;   // pulling up needed
          hits.push({cls:el.className||el.tagName,top:Math.round(rr.top),bot:Math.round(rr.bottom),
                     need: Math.round(Math.min(fromTop,fromBot)), side: fromBot<fromTop?'above':'below'});
        }
      }
      return {T:Math.round(T),B:Math.round(B),zt:Math.round(zt),zb:Math.round(zb),vh:innerHeight,hits};
    });
    if(r.hits.length) bad.push({a,r});
  }
  console.log(`\n${w}x${h}`);
  for(const {a,r} of bad){
    console.log(`  ${String(a).padStart(5)}m instr ${r.T}..${r.B} zone ${r.zt}..${r.zb} (vh=${r.vh})`);
    for(const x of r.hits.slice(0,5)) console.log(`      ${String(x.cls).slice(0,26).padEnd(27)} ${x.top}..${x.bot} overlap=${x.need}px from ${x.side}`);
  }
  await p.close();
}
await b.close();
