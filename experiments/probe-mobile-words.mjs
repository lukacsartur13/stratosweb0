/** Does any display line on the phone break a word across two lines? */
import { chromium, devices } from 'playwright';
const b = await chromium.launch();
const dev = process.env.DEV ?? 'iPhone 13';
const p = await b.newContext({ ...devices[dev] }).then((c) => c.newPage());
await p.goto(process.env.BASE ?? 'http://localhost:5177/home/hu.html', { waitUntil: 'load' });
await p.waitForFunction(() => document.querySelectorAll('.mv-sec').length > 0, null, { timeout: 40000 });
await p.waitForTimeout(2500);
const rows = await p.evaluate(() => {
  const out = [];
  const walk = (root) => {
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = it.nextNode())) nodes.push(n);
    return nodes;
  };
  for (const sec of document.querySelectorAll('.mv-sec')) {
    const t = sec.querySelector('.mv-title');
    if (!t) continue;
    const broken = [];
    for (const node of walk(t)) {
      const text = node.textContent ?? '';
      const re = /\S+/g;
      let m;
      while ((m = re.exec(text))) {
        const r = document.createRange();
        r.setStart(node, m.index);
        r.setEnd(node, m.index + m[0].length);
        if (r.getClientRects().length > 1) broken.push(m[0]);
      }
    }
    out.push({
      stage: sec.dataset.stage ?? sec.className,
      tier: sec.dataset.monument,
      fs: getComputedStyle(t).fontSize,
      w: Math.round(t.getBoundingClientRect().width),
      broken,
    });
  }
  return out;
});
let bad = 0;
for (const r of rows) {
  if (r.broken.length) bad++;
  console.log(
    `${String(r.stage).padEnd(26)} ${String(r.tier).padEnd(9)} ${r.fs.padStart(9)} box=${String(r.w).padStart(4)} ` +
      (r.broken.length ? `BREAKS: ${r.broken.join(', ')}` : 'whole'),
  );
}
console.log(bad ? `\n${bad} statement(s) break mid-word` : '\nno mid-word breaks');
await b.close();
process.exit(bad ? 1 : 0);
