import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newContext({ viewport: { width: 1440, height: 900 } }).then((c) => c.newPage());
await p.goto('http://localhost:5177/home/hu.html', { waitUntil: 'load' });
await p.waitForFunction(() => globalThis.__stratos?.journey && globalThis.__stratos?.scene, null, { timeout: 40000 });
await p.waitForTimeout(1500);
const go = (m) => new Promise((res) => { const s = globalThis.__stratos; s.journey.debug.altitude = m; requestAnimationFrame(() => requestAnimationFrame(() => { const t = document.querySelector('[data-testid="journey-track"]'); const travel = (t?.offsetHeight ?? document.documentElement.scrollHeight) - innerHeight; scrollTo({ top: s.journey.current * travel, behavior: 'instant' }); s.journey.debug.altitude = m; setTimeout(res, 200); })); });
const alts = (process.env.ALTS ?? '900,2600,5600,8100,10600,11500,16600,17200,21600,22200,25100,25900,27600,29400,29700,29900').split(',').map(Number);
for (const a of alts) {
  await p.evaluate(go, a);
  const rows = await p.evaluate(() => [...document.querySelectorAll('.horizon')].map((h) => {
    const panel = h.closest('.panel');
    const r = h.getBoundingClientRect();
    const w = h.querySelector('.horizon__word');
    const wr = w?.getBoundingClientRect();
    return { stage: panel.dataset.stage, o: +getComputedStyle(h).opacity, pass: panel.style.getPropertyValue('--pass'), veil: panel.style.getPropertyValue('--lead-veil'), y: Math.round(wr?.top ?? 0), x: Math.round(wr?.left ?? 0), fs: w ? getComputedStyle(w).fontSize : '' };
  }).filter((x) => x.o > 0.02));
  console.log(`${String(a).padStart(6)}  ` + (rows.length ? rows.map((r) => `${r.stage} o=${r.o.toFixed(2)} pass=${r.pass} veil=${r.veil} @${r.x},${r.y} ${r.fs}`).join(' | ') : '—'));
}
await b.close();
