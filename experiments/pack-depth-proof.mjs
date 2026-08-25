// =============================================================================
// PHASE 5.2A · THE DECISION SHEETS. §31, §32, §52.
//
// Everything here is composed from files already on disk — the before stills,
// the proof stills, the alignment probe's debug views and the two JSON records
// — so the sheets cannot disagree with the measurements they are captioned
// with. Nothing is re-photographed and nothing is redrawn.
//
//   node experiments/pack-depth-proof.mjs
// =============================================================================
import { chromium } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';

const OUT = '_build/reports/luxury-art-direction/depth';
const LOCALE = process.env.LOCALE ?? 'hu';
const b64 = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;

const before = JSON.parse(readFileSync(`${OUT}/before-${LOCALE}.json`, 'utf8'));
const after = JSON.parse(readFileSync(`${OUT}/after-${LOCALE}.json`, 'utf8'));
const align = existsSync(`${OUT}/align/authored-${LOCALE}.json`)
  ? JSON.parse(readFileSync(`${OUT}/align/authored-${LOCALE}.json`, 'utf8'))
  : {};

const SCENES = [
  ['hero', 'ACT I · HERO', 'Magasságot építünk.'],
  ['system', 'ACT III · SYSTEM', 'Hat terület, egy rendszer.'],
  ['high', 'ACT V · HIGH ALTITUDE', 'Innen már látni a görbületet.'],
];

const mono = 'ui-monospace,SFMono-Regular,Menlo,monospace';
const css = `
  body { margin:0; padding:26px; background:#07090d; color:#aeb7c1; font:12px/1.6 ${mono}; }
  h1 { font:13px/1.4 ${mono}; color:#e8e8e8; margin:0 0 4px; letter-spacing:.04em; }
  .sub { margin:0 0 22px; color:#6d7681; }
  figure { margin:0 0 26px; }
  img { display:block; width:100%; border:1px solid #1b2027; }
  figcaption { margin:8px 0 0; color:#6d7681; }
  b { color:#e8e8e8; font-weight:400; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px 18px; }
  .k { color:#e8e8e8; }
  .warn { color:#ffda05; }
`;

const shot = async (browser, name, width, html) => {
  const page = await (await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })).newPage();
  await page.setContent(`<style>${css}</style><body>${html}</body>`);
  await page.screenshot({ path: `${OUT}/${name}`, fullPage: true });
  console.log(`wrote ${OUT}/${name}`);
};

const contract = (key) => {
  const m = after[key];
  if (!m) return '';
  const lines = (m.lines ?? []).map((l) => `<b>${l.visible}</b> — ${l.glyphs - l.hidden}/${l.glyphs} glyphs clear`).join(' &nbsp;·&nbsp; ');
  const others = Object.keys(m.hits ?? {}).filter((k) => k !== 'act__monument');
  const a = align[key];
  return `
    dial <b>${m.dial || '—'}</b>u ·
    mask <b>${Math.round(m.occl.rx)}×${Math.round(m.occl.ry)}</b>u at <b>${Math.round(m.occl.x)},${Math.round(m.occl.y)}</b> ·
    monument covered <b>${((m.hits?.act__monument ?? 0) * 100).toFixed(0)}%</b> ·
    other objects covered <span class="${others.length ? 'warn' : ''}">${others.length ? others.join(', ') : 'none'}</span>
    <br>${lines}
    ${a ? `<br>mask edge against the object's visible footprint: median <b>${a.edgeStats.medianGapPx}px</b>, p90 <b>${a.edgeStats.p90GapPx}px</b>, worst <b>${a.edgeStats.worstGapPx}px</b>` : ''}`;
};

const browser = await chromium.launch();

// --- §31 · the main decision sheet -------------------------------------------
await shot(
  browser,
  'three-scene-before-after.png',
  2960,
  `<h1>PHASE 5.2A · THREE-SCENE DEPTH PROOF — CURRENT vs PROOF · 1440×900 · ${LOCALE}</h1>
   <p class="sub">Left: the accepted Phase 5.1 frame. Right: the same frame with the Altimeter as a foreground object and the statement cut by its housing.</p>
   ${SCENES.map(([k, title, phrase]) => `
     <h1 style="margin-top:8px">${title} — ${phrase}</h1>
     <div class="grid">
       <figure><img src="${b64(`${OUT}/before/${k}-${LOCALE}.png`)}"><figcaption><b>CURRENT</b> · instrument ${before[k]?.instrument ?? '—'} · monument ${before[k]?.monumentPx ?? '—'}u</figcaption></figure>
       <figure><img src="${b64(`${OUT}/after/${k}-${LOCALE}.png`)}"><figcaption><b>PROOF</b> · ${contract(k)}</figcaption></figure>
     </div>`).join('')}`,
);

// --- §52 · one sheet per scene ------------------------------------------------
for (const [k, title, phrase] of SCENES) {
  const file = k === 'high' ? 'high-altitude-depth-proof.png' : `${k}-depth-proof.png`;
  await shot(
    browser,
    file,
    1500,
    `<h1>${title} — ${phrase}</h1>
     <p class="sub">1440×900 · ${LOCALE} · settled at 0.4 of the act's hold</p>
     <figure><img src="${b64(`${OUT}/after/${k}-${LOCALE}.png`)}"><figcaption>${contract(k)}</figcaption></figure>
     <figure><img src="${b64(`${OUT}/before/${k}-${LOCALE}.png`)}"><figcaption><b>the frame this replaces</b> — Phase 5.1, accepted</figcaption></figure>`,
  );
}

// --- §27 · the engineering view ----------------------------------------------
const dbg = SCENES.filter(([k]) => existsSync(`${OUT}/align/authored-${k}-debug.png`));
await shot(
  browser,
  'occlusion-debug.png',
  1500,
  `<h1>PHASE 5.2A · §27 · OCCLUSION DEBUG — NOT SHIPPED</h1>
   <p class="sub">
     The object's own contribution to the frame, isolated by subtracting the same frame with the instrument taken out of it, and amplified ×26 so a
     difference of one level out of 255 is a visible grey. The yellow ellipse is the mask the stylesheet is cutting with; the cross is its centre.
     Where the yellow runs over grey the mask is on the object. Where it runs over black the mask would be cutting type in front of nothing.
   </p>
   ${dbg.map(([k, title]) => {
     const a = align[k];
     return `<figure><img src="${b64(`${OUT}/align/authored-${k}-debug.png`)}"><figcaption>
       <b>${title}</b> · mask <b>${Math.round(a.mask.rx)}×${Math.round(a.mask.ry)}</b> at <b>${Math.round(a.mask.x)},${Math.round(a.mask.y)}</b> ·
       edge points measured <b>${a.edgeStats.points}</b>/720 (the rest are cropped by the frame) ·
       mask beyond the object: median <b>${a.edgeStats.medianGapPx}px</b>, p90 <b>${a.edgeStats.p90GapPx}px</b>, worst <b>${a.edgeStats.worstGapPx}px</b> ·
       object beyond the mask: up to <b>${a.edgeStats.overhangPx}px</b>
     </figcaption></figure>`;
   }).join('')}`,
);

await browser.close();
