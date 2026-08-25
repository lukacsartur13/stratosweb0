/** Contact sheet of the phone homepage (`MobileHome`), by section. */
import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';
const out = process.argv[2] ?? 'shots-mobile';
await mkdir(out, { recursive: true });
const b = await chromium.launch();
const p = await b.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 }).then((c) => c.newPage());
p.on('pageerror', (e) => console.error('  !! ' + e.message));
await p.goto(process.env.BASE ?? 'http://localhost:5177/home/hu.html', { waitUntil: 'load' });
await p.waitForFunction(() => document.querySelectorAll('.mv-sec').length > 0, null, { timeout: 40000 });
await p.waitForTimeout(2500);
const ids = await p.evaluate(() => [...document.querySelectorAll('.mv-sec')].map((s) => s.id || s.dataset.stage || ''));
let i = 0;
for (const id of ids) {
  i++;
  const offs = process.env.OFFSETS ? process.env.OFFSETS.split(',').map(Number) : [0, 420];
  for (const off of offs) {
    await p.evaluate(
      ([sel, o]) => {
        const el = document.getElementById(sel) ?? document.querySelectorAll('.mv-sec')[0];
        const y = el.getBoundingClientRect().top + scrollY + o;
        scrollTo({ top: Math.max(0, y), behavior: 'instant' });
      },
      [id, off],
    );
    await p.waitForTimeout(700);
    const name = `mv-${String(i).padStart(2, '0')}-${id || 'sec'}-${off}.jpg`;
    await p.screenshot({ path: `${out}/${name}`, type: 'jpeg', quality: 74 });
    console.log('  ' + name);
  }
}
await b.close();
