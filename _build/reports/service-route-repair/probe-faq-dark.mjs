import { chromium } from 'playwright';
const H=()=>{
  window.__px=s=>{const m=String(s).match(/[\d.]+/g);if(!m)return null;return{r:+m[0],g:+m[1],b:+m[2],a:m.length>3?+m[3]:1};};
  window.__over=(f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
  window.__lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b);};
  window.__ratio=(a,b)=>{const[x,y]=[window.__lum(a),window.__lum(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05);};
  window.__bg=el=>{const st=[];let n=el;while(n&&n.nodeType===1){const c=window.__px(getComputedStyle(n).backgroundColor);
    if(c&&c.a>0){st.push(c);if(c.a===1)break;}n=n.parentElement;}
    let b={r:255,g:255,b:255,a:1};for(let i=st.length-1;i>=0;i--)b=window.__over(st[i],b);return b;};
  window.__m=el=>{const cs=getComputedStyle(el);const fg=window.__px(cs.color);const bg=window.__bg(el);
    return {color:cs.color,bg:`rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
      ratio:+window.__ratio(window.__over(fg,bg),bg).toFixed(2)};};
};
const br=await chromium.launch();
for(const r of ['/rolunk.html','/impact-program.html']){
  const ctx=await br.newContext({viewport:{width:1440,height:900}});
  const p=await ctx.newPage();
  await p.goto('http://localhost:4331'+r,{waitUntil:'networkidle'});
  await p.evaluate(H);
  const det=p.locator('.faq details').first(), sum=det.locator('summary');
  await det.scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
  const closed=await sum.evaluate(e=>window.__m(e));
  await sum.click(); await p.waitForTimeout(700);
  const open=await sum.evaluate(e=>window.__m(e));
  const mark=await sum.evaluate(e=>getComputedStyle(e,'::after').backgroundImage.slice(0,52));
  const rule=await det.evaluate(e=>getComputedStyle(e).borderBottomColor);
  const ans=await det.locator('.faq__a').evaluate(e=>window.__m(e));
  console.log(`${r}  (dark band)`);
  console.log(`   closed  ${closed.color} on ${closed.bg}  ratio ${closed.ratio}`);
  console.log(`   open    ${open.color} on ${open.bg}  ratio ${open.ratio}`);
  console.log(`   answer  ratio ${ans.ratio}`);
  console.log(`   mark    ${mark}`);
  console.log(`   rule    ${rule}\n`);
  await ctx.close();
}
await br.close();
