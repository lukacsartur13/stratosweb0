/** Every chapter's statement size and its support layers, at one viewport. */
import { chromium } from 'playwright';
const b = await chromium.launch();
const W = Number(process.env.W ?? 1440), H = Number(process.env.H ?? 900);
const p = await b.newContext({ viewport: { width: W, height: H } }).then((c) => c.newPage());
await p.goto(process.env.BASE ?? 'http://localhost:5177/home/hu.html', { waitUntil: 'load' });
await p.waitForFunction(() => globalThis.__stratos?.journey, null, { timeout: 40000 });
await p.waitForTimeout(2500);
const rows = await p.evaluate(() => {
  const px = (el) => (el ? Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10 : null);
  return [...document.querySelectorAll('.panel')].map((s) => ({
    stage: s.dataset.stage,
    tier: s.dataset.monument,
    frame: s.dataset.frame,
    inst: s.dataset.instrument,
    hang: s.dataset.hang,
    title: px(s.querySelector('.panel__title')),
    lead: px(s.querySelector('.panel__lead')),
    note: px(s.querySelector('.notes__item')),
    contact: s.style.getPropertyValue('--contact') || '—',
    sep: s.style.getPropertyValue('--flow-sep') || '—',
  }));
});
console.log('stage'.padEnd(25), 'tier'.padEnd(9), 'frame'.padEnd(8), 'instrument'.padEnd(11), 'hang'.padEnd(6), 'A'.padStart(6), 'B'.padStart(6), 'C'.padStart(6), 'ratio'.padStart(6), 'contact'.padStart(8));
for (const r of rows) {
  const ratio = r.title && r.lead ? (r.title / r.lead).toFixed(1) + '×' : '—';
  console.log(
    String(r.stage).padEnd(25), String(r.tier).padEnd(9), String(r.frame).padEnd(8), String(r.inst).padEnd(11),
    String(r.hang).padEnd(6), String(r.title ?? '—').padStart(6), String(r.lead ?? '—').padStart(6),
    String(r.note ?? '—').padStart(6), ratio.padStart(6), String(r.contact).padStart(8),
  );
}
await b.close();
