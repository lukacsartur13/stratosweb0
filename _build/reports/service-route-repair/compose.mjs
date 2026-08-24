import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const D = '_build/reports/service-route-repair';
const b64 = (f) => `data:image/png;base64,${readFileSync(`${D}/shots/${f}`).toString('base64')}`;

const CSS = `
  *{box-sizing:border-box} body{margin:0;background:#0b0b0b;color:#f4f4f4;
    font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:34px}
  h1{font:600 24px/1.2 inherit;margin:0 0 4px;letter-spacing:-.01em}
  .sub{color:#8b8b8b;margin:0 0 26px;max-width:110ch}
  h2{font:600 15px/1.3 inherit;margin:30px 0 10px;letter-spacing:.02em}
  .note{color:#8b8b8b;margin:0 0 12px;max-width:110ch;font-size:13px}
  .pair{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .cell{border:1px solid #262626;background:#111;overflow:hidden}
  .cap{display:flex;justify-content:space-between;align-items:baseline;
    padding:8px 11px;border-bottom:1px solid #262626;font:600 11px/1 inherit;
    letter-spacing:.11em;text-transform:uppercase}
  .before .cap{color:#ff8f6b} .after .cap{color:#7fd39b}
  .m{font-weight:400;letter-spacing:.02em;text-transform:none;color:#7c7c7c;font-size:11px}
  img{display:block;width:100%;height:auto}
  .strip{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
  .strip .cell img{aspect-ratio:16/10;object-fit:cover;object-position:top}
  .strip .cap{padding:5px 7px;font-size:9px;letter-spacing:.07em}
  table{border-collapse:collapse;margin:10px 0 4px;font-size:12.5px}
  th,td{border:1px solid #262626;padding:5px 10px;text-align:left}
  th{background:#151515;font-weight:600;color:#b9b9b9}
  td.bad{color:#ff8f6b} td.good{color:#7fd39b}
`;

/* ---------------------------------------------------------- contrast sheet */
const contrast = `<style>${CSS}</style>
<h1>Service routes — contrast, before and after</h1>
<p class="sub">Every figure is a measured WCAG ratio against the composited background, taken in the settled
state at 1440&times;900. Nothing here is a redesign: the cards are the same black, the chips are the same
outlined chips, the FAQ is the same accordion. Only the accidental invisibility is gone.</p>

<h2>1 &middot; Impact Program — the two cause cards</h2>
<p class="note">A <code>.panel</code> inside a <code>.band--pale</code>. The panel painted its own dark background and said
nothing about colour, so it inherited the pale section's ink: the titles rendered black on near-black and the
pale band's chip rule reached across the boundary and did the same to all twelve tags.</p>
<div class="pair">
  <div class="cell before"><div class="cap"><span>Before</span><span class="m">title 1.10 : 1 &middot; tags 1.07 : 1</span></div><img src="${b64('impact-cards-before.png')}"></div>
  <div class="cell after"><div class="cap"><span>After</span><span class="m">title 17.30 : 1 &middot; tags 8.73 : 1</span></div><img src="${b64('impact-cards-after.png')}"></div>
</div>

<h2>2 &middot; Hirdetéskezelés — the Google / Meta pair</h2>
<p class="note">The same defect, plus the checklist: <code>.band--pale .checks li</code> outranked <code>.checks li</code> and
painted four lines of the Google card black on black. The asymmetry the review noticed was real and had one
cause — the Meta card is <code>.panel--lit</code>, a genuinely light surface, so every one of its roles was already
stated explicitly and none of them inherited anything. It is untouched here.</p>
<div class="pair">
  <div class="cell before"><div class="cap"><span>Before</span><span class="m">Google title 1.10 &middot; checklist 1.08</span></div><img src="${b64('ads-cards-before.png')}"></div>
  <div class="cell after"><div class="cap"><span>After</span><span class="m">Google title 17.30 &middot; checklist 10.66</span></div><img src="${b64('ads-cards-after.png')}"></div>
</div>

<h2>3 &middot; Hirdetéskezelés — the open FAQ entry</h2>
<p class="note">The active question was set in <code>--signal</code>, 1.09 : 1 on paper — the one line the reader is
certainly reading, and the hardest on the page to read. Hover did the same, so pointing at a question made it
less legible. The question now keeps full authority in every state and the signal moved to the two things that
are state and carry no words: the mark at the end of the row, and the rule under the open entry.</p>
<div class="pair">
  <div class="cell before"><div class="cap"><span>Before</span><span class="m">open question 1.09 : 1 &middot; hover 1.16 : 1</span></div><img src="${b64('faq-open-before.png')}"></div>
  <div class="cell after"><div class="cap"><span>After</span><span class="m">open question 19.09 : 1 in every state</span></div><img src="${b64('faq-open-after.png')}"></div>
</div>

<h2>4 &middot; What was measured</h2>
<table>
<tr><th>Role</th><th>Route(s)</th><th>Before</th><th>After</th></tr>
<tr><td><code>.panel h3</code></td><td>impact-program, hirdeteskezeles &times; hu/en/de</td><td class="bad">1.10</td><td class="good">17.30</td></tr>
<tr><td><code>.panel .tags span</code></td><td>impact-program &times; hu/en/de</td><td class="bad">1.07</td><td class="good">8.73</td></tr>
<tr><td><code>.panel .checks li</code></td><td>hirdeteskezeles &times; hu/en/de</td><td class="bad">1.08</td><td class="good">10.66</td></tr>
<tr><td><code>.field select option</code></td><td>impact-program &times; hu/en/de</td><td class="bad">1.10</td><td class="good">17.30</td></tr>
<tr><td><code>.faq details[open] summary</code></td><td>every route with an accordion</td><td class="bad">1.09</td><td class="good">19.09</td></tr>
<tr><td><code>.faq summary:hover</code></td><td>every route with an accordion</td><td class="bad">1.16</td><td class="good">19.09</td></tr>
<tr><td><code>.build__k</code></td><td>kkv, nagyvallalat</td><td class="bad">1.09</td><td class="good">5.60</td></tr>
<tr><td><code>.smark__n</code></td><td>szolgaltatasok, ugyfelszolgalat, munkaink</td><td class="bad">1.09</td><td class="good">5.60</td></tr>
<tr><td><code>.sig</code></td><td>munkaink, hirdeteskezeles, branding</td><td class="bad">1.09</td><td class="good">4.56&ndash;5.60</td></tr>
<tr><td><code>:focus-visible</code> ring on paper</td><td>every pale band</td><td class="bad">1.09</td><td class="good">5.60</td></tr>
</table>`;

/* ------------------------------------------------------------ timing sheet */
const strip = (tag, label, n = 5) => Array.from({ length: n }, (_, i) =>
  `<div class="cell ${label}"><div class="cap"><span>${i * 25}%</span></div><img src="${b64(`timing-${tag}-${i}-${label}.png`)}"></div>`).join('');

const timing = `<style>${CSS}</style>
<h1>Service routes — scroll timing, before and after</h1>
<p class="sub">Five frames taken at even intervals across each pinned section's own scroll range, 1440&times;900.
The defect was one line of arithmetic: progress was normalised over the section's full height, but a pinned
section is only readable while its pin is stuck, and that window is <code>height &minus; pinHeight</code>.</p>

<h2>1 &middot; kkv.html — the three build stages</h2>
<p class="note">Before: the pin releases at p = 0.706 while the third stage only begins at p = 0.667, so stage 3 got
120&nbsp;px of pinned scroll — 5.6% of its own window — and then 880&nbsp;px passed with progress still advancing over a
section that had already let go. After: an even third each, and progress reaches 1 exactly as the pin releases.</p>
<div class="strip">${strip('kkv', 'before')}</div>
<div class="strip" style="margin-top:6px">${strip('kkv', 'after')}</div>

<h2>2 &middot; szolgaltatasok.html — the horizontal services rail</h2>
<p class="note">The same arithmetic, on the primitive that documents the intent it was breaking: the section is
one viewport taller than its travel <em>so that the extra viewport holds the end state</em>. It was spending that
viewport still animating, and came unstuck two panels short.</p>
<div class="strip">${strip('szolgaltatasok', 'before')}</div>
<div class="strip" style="margin-top:6px">${strip('szolgaltatasok', 'after')}</div>

<h2>3 &middot; What was measured</h2>
<table>
<tr><th>Section</th><th>Viewport</th><th>Before</th><th>After</th></tr>
<tr><td rowspan="3">build stages, share of the pinned window</td><td>1280&times;800</td><td class="bad">46.9 / 46.9 / <b>6.1%</b></td><td class="good">34.7 / 32.7 / 32.7%</td></tr>
<tr><td>1440&times;900</td><td class="bad">48.1 / 46.3 / <b>5.6%</b></td><td class="good">33.3 / 33.3 / 33.3%</td></tr>
<tr><td>1920&times;1080</td><td class="bad">47.7 / 47.7 / <b>4.6%</b></td><td class="good">33.8 / 33.8 / 32.3%</td></tr>
<tr><td rowspan="3">progress advancing while unpinned</td><td>1280&times;800</td><td class="bad">800 px</td><td class="good">0 px</td></tr>
<tr><td>1440&times;900</td><td class="bad">880 px</td><td class="good">0 px</td></tr>
<tr><td>1920&times;1080</td><td class="bad">1080 px</td><td class="good">0 px</td></tr>
<tr><td rowspan="3">rail travel completed while pinned</td><td>1280&times;800</td><td class="bad">66.3%, panel 2 of 4</td><td class="good">99.1%, panel 4 of 4</td></tr>
<tr><td>1440&times;900</td><td class="bad">65.8%, panel 2 of 4</td><td class="good">98.6%, panel 4 of 4</td></tr>
<tr><td>1920&times;1080</td><td class="bad">55.2%, panel 2 of 4</td><td class="good">98.3%, panel 4 of 4</td></tr>
</table>`;

const br = await chromium.launch();
for (const [name, html] of [['contrast-before-after', contrast], ['scroll-timing-before-after', timing]]) {
  writeFileSync(`${D}/${name}.html`, html);
  const ctx = await br.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1.5 });
  const p = await ctx.newPage();
  await p.setContent(html, { waitUntil: 'load' });
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${D}/${name}.png`, fullPage: true });
  await ctx.close();
  console.log('wrote', `${name}.png`);
}
await br.close();
