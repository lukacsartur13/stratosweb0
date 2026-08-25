/** Ad-hoc geometry probe for the art-direction pass. */
import { chromium } from 'playwright';

const base = process.env.BASE ?? 'http://localhost:5177/home/hu.html';
const W = Number(process.env.W ?? 1440), H = Number(process.env.H ?? 900);
const SAMPLES = (process.env.ALTS ?? '0,1200,3600,5200,6700,9200,11500,13400,15800,18400,21200,24400,27300,29200,30000')
  .split(',').map(Number);

const go = (m) => new Promise((res) => {
  const s = globalThis.__stratos;
  s.journey.debug.altitude = m;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const t = document.querySelector('[data-testid="journey-track"]');
    const travel = (t?.offsetHeight ?? document.documentElement.scrollHeight) - innerHeight;
    scrollTo({ top: s.journey.current * travel, behavior: 'instant' });
    s.journey.debug.altitude = m;
    setTimeout(res, 240);
  }));
});

const READ = () => {
  const vis = (el) => {
    let o = 1, n = el;
    while (n && n !== document.documentElement) { o *= Number(getComputedStyle(n).opacity); n = n.parentElement; }
    return o;
  };
  const rows = [];
  for (const p of document.querySelectorAll('.panel')) {
    const r = p.getBoundingClientRect();
    if (r.bottom < -20 || r.top > innerHeight + 20) continue;
    const grab = (sel) => [...p.querySelectorAll(sel)].map((e) => {
      const b = e.getBoundingClientRect();
      return { sel, t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), o: +vis(e).toFixed(2), fs: getComputedStyle(e).fontSize, txt: (e.textContent||'').slice(0,34) };
    }).filter((x) => x.o > 0.06 && x.b > 0 && x.t < innerHeight);
    rows.push({
      stage: p.dataset.stage,
      tier: p.dataset.monument, frame: p.dataset.frame, inst: p.dataset.instrument, hang: p.dataset.hang,
      leadH: p.style.getPropertyValue('--lead-h'), hangRoom: p.style.getPropertyValue('--hang-room'),
      stmtW: p.style.getPropertyValue('--statement-w'),
      sep: p.style.getPropertyValue('--flow-sep'), contact: p.style.getPropertyValue('--contact'),
      pass: p.style.getPropertyValue('--pass'),
      cs: (() => { const c = getComputedStyle(p); return { screen: c.getPropertyValue('--screen'), pinned: c.getPropertyValue('--pinned'), leaveFrom: c.getPropertyValue('--leave-from'), leave: c.getPropertyValue('--leave'), panelH: c.getPropertyValue('--panel-h') }; })(),
      items: [...grab('.panel__title'), ...grab('.panel__lead'), ...grab('.notes__item'), ...grab('.ladder__name'), ...grab('.feature__name'), ...grab('.case__metric'), ...grab('.collab__title'), ...grab('.panel__actions')],
    });
  }
  const s = globalThis.__stratos;
  return { alt: Math.round(s.journey.altitude), rows };
};

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: { width: W, height: H } }).then((c) => c.newPage());
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__stratos?.journey && globalThis.__stratos?.scene, null, { timeout: 40000 });
await page.waitForTimeout(1400);
for (const a of SAMPLES) {
  await page.evaluate(go, a);
  const r = await page.evaluate(READ);
  console.log(`\n=== ${a} m (reported ${r.alt}) ===`);
  for (const row of r.rows) {
    console.log(` ${row.stage} [${row.tier}/${row.frame}/${row.inst} hang=${row.hang}] leadH=${row.leadH} hangRoom=${row.hangRoom} stmtW=${row.stmtW} sep=${row.sep} contact=${row.contact} pass=${row.pass} ${JSON.stringify(row.cs)}`);
    // collision detection among visible items
    for (const it of row.items) console.log(`   ${it.sel.padEnd(16)} y${String(it.t).padStart(5)}..${String(it.b).padStart(5)} x${String(it.l).padStart(5)}..${String(it.r).padStart(5)} o${it.o} ${it.fs.padStart(7)}  ${JSON.stringify(it.txt)}`);
    for (let i = 0; i < row.items.length; i++) for (let j = i + 1; j < row.items.length; j++) {
      const a1 = row.items[i], b1 = row.items[j];
      const ox = Math.min(a1.r, b1.r) - Math.max(a1.l, b1.l);
      const oy = Math.min(a1.b, b1.b) - Math.max(a1.t, b1.t);
      if (ox > 6 && oy > 6 && a1.o > 0.12 && b1.o > 0.12) console.log(`   !! OVERLAP ${a1.sel}${JSON.stringify(a1.txt.slice(0,18))} x ${b1.sel}${JSON.stringify(b1.txt.slice(0,18))}  ${ox}x${oy}px  o=${a1.o}/${b1.o}`);
    }
  }
}
await browser.close();
