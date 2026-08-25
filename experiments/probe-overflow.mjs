import { chromium } from 'playwright';
const b = await chromium.launch();
const W = Number(process.env.W ?? 1440), H = Number(process.env.H ?? 900);
const DSF = Number(process.env.DSF ?? 1);
const ROOT = process.env.ROOTFS ?? '';
const p = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF }).then((c) => c.newPage());
await p.goto(process.env.BASE ?? 'http://localhost:5177/home/hu.html', { waitUntil: 'load' });
await p.waitForFunction(() => globalThis.__stratos?.journey, null, { timeout: 40000 });
if (ROOT) await p.addStyleTag({ content: `html{font-size:${ROOT}!important}` });
await p.waitForTimeout(2500);
const over = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;
console.log('base overflow', await p.evaluate(over));
const tests = [
  ['.panel__band::before', '.panel .panel__band::before{content:none!important}'],
  ['.horizon', '.horizon{display:none!important}'],
  ['.scene-notes', '.scene-notes{display:none!important}'],
  ['.notes', '.notes{display:none!important}'],
  ['.collab', '.collab{display:none!important}'],
  ['.feature__figure::after', '.feature__figure::after{content:none!important}'],
  ['.feature__figure', '.feature__figure{display:none!important}'],
  ['.panel__eyebrow', '.panel__eyebrow{display:none!important}'],
  ['.panel__stages', '.panel__stages{display:none!important}'],
  ['.check__grid', '.check__grid{display:none!important}'],
  ['.ladder', '.ladder{display:none!important}'],
  ['.system', '.system{display:none!important}'],
  ['site header/footer', 'header,footer,.arrival,.site-footer{display:none!important}'],
  ['.panel__title', '.panel__title{display:none!important}'],
  ['all panels', '.panel{display:none!important}'],
];
const SHELL = 'header,footer,.arrival,.site-footer{display:none!important}';
if (process.env.HIDESHELL) { await p.addStyleTag({ content: SHELL }); console.log('shell hidden ->', await p.evaluate(over)); }
for (const [name, css] of tests) {
  await p.addStyleTag({ content: css });
  console.log(`${name.padEnd(26)} -> ${await p.evaluate(over)}`);
  await p.evaluate(() => document.querySelectorAll('style').forEach((s, i, a) => { if (i === a.length - 1) s.remove(); }));
}
await b.close();
