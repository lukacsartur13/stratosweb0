/* §10 — every consumer. Finds every element whose own background is DARK while
   it sits inside a light `.band--pale`, and reports each text descendant's
   contrast. This is the authoritative list of "dark island in a pale band". */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const BASE='http://localhost:4331';
const ROUTES=process.argv.slice(2);

const FN = () => {
  const px=s=>{const m=String(s).match(/[\d.]+/g);if(!m)return null;return{r:+m[0],g:+m[1],b:+m[2],a:m.length>3?+m[3]:1};};
  const over=(f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
  const lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b);};
  const ratio=(a,b)=>{const[x,y]=[lum(a),lum(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05);};
  const bgOf=el=>{const st=[];let n=el;while(n&&n.nodeType===1){const c=px(getComputedStyle(n).backgroundColor);
    if(c&&c.a>0){st.push(c);if(c.a===1)break;}n=n.parentElement;}
    let b={r:255,g:255,b:255,a:1};for(let i=st.length-1;i>=0;i--)b=over(st[i],b);return b;};
  const cls=el=>el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/).join('.'):el.tagName.toLowerCase();

  const out=[];
  for(const pale of document.querySelectorAll('.band--pale')){
    for(const el of pale.querySelectorAll('*')){
      const own=px(getComputedStyle(el).backgroundColor);
      if(!own||own.a<0.9) continue;
      const bg=bgOf(el);
      if(lum(bg)>0.18) continue;                 // not a dark island
      // text inside this island
      for(const t of [el,...el.querySelectorAll('*')]){
        const txt=Array.from(t.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(' ').trim();
        if(!txt) continue;
        const cs=getComputedStyle(t);
        if(cs.display==='none'||cs.visibility==='hidden') continue;
        const fg=px(cs.color); if(!fg) continue;
        const tb=bgOf(t);
        out.push({island:cls(el),el:cls(t),tag:t.tagName.toLowerCase(),
          color:cs.color,bg:`rgb(${Math.round(tb.r)}, ${Math.round(tb.g)}, ${Math.round(tb.b)})`,
          size:+parseFloat(cs.fontSize).toFixed(1),
          ratio:+ratio(over(fg,tb),tb).toFixed(2),text:txt.slice(0,40)});
      }
    }
  }
  return out;
};

const browser=await chromium.launch(); const out={};
for(const r of ROUTES){
  const ctx=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const p=await ctx.newPage();
  try{ await p.goto(`${BASE}${r}`,{waitUntil:'domcontentloaded',timeout:15000}); await p.waitForTimeout(250);
       const rows=await p.evaluate(FN); if(rows.length) out[r]=rows; }
  catch(e){ }
  await ctx.close();
}
await browser.close();
writeFileSync('_build/reports/service-route-repair/islands-before.json',JSON.stringify(out,null,2));
const bad=[]; for(const [r,rows] of Object.entries(out)) rows.filter(x=>x.ratio<4.5).forEach(x=>bad.push({r,...x}));
console.log(`routes with dark islands in pale bands: ${Object.keys(out).length}`);
console.log(`failing text inside those islands: ${bad.length}\n`);
const g={}; for(const b of bad){const k=`${b.island} ${b.el} :: ${b.color} on ${b.bg} (${b.ratio})`;(g[k]=g[k]||new Set()).add(b.r);}
for(const [k,v] of Object.entries(g).sort()) console.log(`  ${k}\n     ${[...v].sort().join(' ')}\n`);
