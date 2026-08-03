// Portrait: where does the instrument actually sit vertically, against the
// 38%/62% transparent band the plate opens?
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
  let lo=100,hi=0;
  const rows=[];
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
      const v=new THREE.Vector3();
      let T=Infinity,B=-Infinity;
      root.traverse(o=>{if(!o.isMesh||!o.visible||inG.has(o))return;
        for(let q=o.parent;q;q=q.parent)if(!q.visible)return;
        const g=o.geometry;if(!g)return;if(!g.boundingBox)g.computeBoundingBox();const bb=g.boundingBox;if(!bb)return;
        for(let i=0;i<8;i++){v.set(i&1?bb.max.x:bb.min.x,i&2?bb.max.y:bb.min.y,i&4?bb.max.z:bb.min.z);
          v.applyMatrix4(o.matrixWorld);v.project(cam);
          const py=cr.top+((1-v.y)/2)*ch;T=Math.min(T,py);B=Math.max(B,py);}});
      // which panel is on screen, and does it have a title?
      let panel=null;
      for(const el of document.querySelectorAll('.panel')){
        const rr=el.getBoundingClientRect();
        if(rr.top<innerHeight*0.5&&rr.bottom>innerHeight*0.5){panel=el;break;}
      }
      return {T,B,vh:innerHeight,
        panelCls:panel?panel.className:'(none)',
        hasTitle:!!panel?.querySelector('.panel__title'),
        titleNext:panel?.querySelector('.panel__title')?.nextElementSibling?.className??'(none)'};
    });
    const t=100*r.T/r.vh,bm=100*r.B/r.vh;
    lo=Math.min(lo,t);hi=Math.max(hi,bm);
    rows.push({a,t,bm,cls:r.panelCls,hasTitle:r.hasTitle,next:r.titleNext});
  }
  console.log(`\n${w}x${h}  instrument spans ${lo.toFixed(1)}% .. ${hi.toFixed(1)}% of viewport (plate opens 38%..62%)`);
  for(const x of rows) console.log(`   ${String(x.a).padStart(5)}m  ${x.t.toFixed(1)}%..${x.bm.toFixed(1)}%  ${x.hasTitle?'title':'NO-TITLE'}  next=${x.next}  [${x.cls}]`);
  await p.close();
}
await b.close();
