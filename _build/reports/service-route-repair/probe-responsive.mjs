import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const BASE='http://localhost:4331';
const ROUTES=['/impact-program.html','/hirdeteskezeles.html','/szolgaltatasok.html','/kkv.html','/nagyvallalat.html','/munkaink.html','/ugyfelszolgalat.html'];
const VIEWS=[[1920,1080],[1440,900],[1280,800],[430,932],[390,844]];
const H=()=>{
  window.__px=s=>{const m=String(s).match(/[\d.]+/g);if(!m)return null;return{r:+m[0],g:+m[1],b:+m[2],a:m.length>3?+m[3]:1};};
  window.__over=(f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
  window.__lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b);};
  window.__ratio=(a,b)=>{const[x,y]=[window.__lum(a),window.__lum(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05);};
  window.__bg=el=>{const st=[];let n=el;while(n&&n.nodeType===1){const c=window.__px(getComputedStyle(n).backgroundColor);
    if(c&&c.a>0){st.push(c);if(c.a===1)break;}n=n.parentElement;}
    let b={r:255,g:255,b:255,a:1};for(let i=st.length-1;i>=0;i--)b=window.__over(st[i],b);return b;};
};
const CHECK=()=>{
  const roles=['.panel h3','.panel .checks li','.panel .tags span','.build__k','.smark__n','.sig','.faq summary','.field select option'];
  const out={};
  for(const s of roles){
    const els=[...document.querySelectorAll(s)];
    if(!els.length) continue;
    let worst=Infinity, w=null;
    for(const e of els){
      const cs=getComputedStyle(e);
      if(cs.display==='none') continue;
      const fg=window.__px(cs.color); if(!fg) continue;
      const bg=window.__bg(e);
      const r=window.__ratio(window.__over(fg,bg),bg);
      if(r<worst){worst=r;w={color:cs.color,bg:`rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,size:cs.fontSize};}
    }
    if(w) out[s]={ratio:+worst.toFixed(2),...w};
  }
  return {
    roles: out,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    widest: (()=>{ let m=0,sel='';
      for(const e of document.querySelectorAll('body *')){
        const r=e.getBoundingClientRect();
        if(r.right>m){m=r.right;sel=e.className&&typeof e.className==='string'?e.className:e.tagName;} }
      return {right:Math.round(m),sel:String(sel).slice(0,50)}; })(),
  };
};
const br=await chromium.launch(); const out={};
for(const [W,Hh] of VIEWS){
  out[`${W}x${Hh}`]={};
  for(const r of ROUTES){
    const ctx=await br.newContext({viewport:{width:W,height:Hh},reducedMotion:'reduce'});
    const p=await ctx.newPage();
    await p.goto(`${BASE}${r}`,{waitUntil:'networkidle'});
    await p.evaluate(H); await p.waitForTimeout(200);
    out[`${W}x${Hh}`][r]=await p.evaluate(CHECK);
    await ctx.close();
  }
}
await br.close();
writeFileSync('_build/reports/service-route-repair/responsive-after.json',JSON.stringify(out,null,2));
// report
for(const [v,routes] of Object.entries(out)){
  const bad=[],ovf=[];
  for(const [r,d] of Object.entries(routes)){
    for(const [sel,m] of Object.entries(d.roles)) if(m.ratio<4.5) bad.push(`${r} ${sel} ${m.ratio} (${m.color} on ${m.bg})`);
    if(d.overflowX>0) ovf.push(`${r} +${d.overflowX}px [${d.widest.sel}]`);
  }
  console.log(`\n${v}:  roles below 4.5 -> ${bad.length?bad.join(" | "):"none"}`);
  console.log(`         horizontal overflow -> ${ovf.length?ovf.join(" | "):"none"}`);
}
