/**
 * §17 (Rapidkert's temporal behaviour) and §27 (the header CTA's states),
 * walked over the whole track in one pass because both are questions about
 * WHEN rather than about what.
 */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const W = Number(arg('width', 1440)), H = Number(arg('height', 900));
const STEPS = Number(arg('steps', 300));
const TAG = arg('tag', 'desktop');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] });
const c = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: W < 768, hasTouch: W < 768 });
const p = await c.newPage();
await p.goto(arg('base', 'http://localhost:4322') + '/index.html', { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(2500);
const geom = await p.evaluate(() => {
  const t = document.querySelector('[data-testid="journey-track"]');
  return t ? { top: t.offsetTop, height: t.offsetHeight } : { top: 0, height: document.documentElement.scrollHeight };
});
const scrollable = geom.height - H;
const rows = [];
for (let i = 0; i <= STEPS; i++) {
  const y = geom.top + (scrollable * i) / STEPS;
  await p.evaluate((t) => scrollTo({ top: t, behavior: 'instant' }), y);
  await p.waitForTimeout(60);
  rows.push({ screens: +((y - geom.top) / H).toFixed(3), ...(await p.evaluate(() => {
    const eff = (el) => { let o = 1; for (let n = el; n && n !== document.documentElement; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none') return 0; const v = parseFloat(cs.opacity); if (Number.isFinite(v)) o *= v; if (o < 0.004) return 0; } return o; };
    const on = (r) => r.bottom > 0 && r.top < innerHeight && r.width > 2 && r.height > 2;
    const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { o: on(r) ? +eff(el).toFixed(3) : 0, top: Math.round(r.top), h: Math.round(r.height) }; };
    // The header's own call to action. §27: it must stay neutral through the
    // ascent and must not become the signal colour.
    const cta = document.querySelector('.site-header [data-testid="header-cta"], .site-header a.btn, header a.btn, .deck a.btn, .deck [class*="cta"]');
    const cs = cta ? getComputedStyle(cta) : null;
    return {
      metric: pick('[data-testid="case-rapidkert"] ~ * .act__monument--figure') || pick('.act__monument--figure'),
      shot:   pick('.act__shot'),
      shotImg: (() => { const i = document.querySelector('.act__shot img'); if (!i) return null; const r = i.getBoundingClientRect(); return { o: on(r) ? +eff(i).toFixed(3) : 0, top: Math.round(r.top), h: Math.round(r.height), loaded: i.complete && i.naturalWidth > 0 }; })(),
      define: pick('.act__editorial'),
      routes: pick('.act__routes'),
      header: cta ? { bg: cs.backgroundColor, color: cs.color, border: cs.borderColor, text: (cta.textContent || '').trim().slice(0, 24) } : null,
      deck: document.documentElement.getAttribute('data-deck') || document.querySelector('.site-header')?.getAttribute('data-state') || null,
    };
  })) });
}
writeFileSync(`_build/reports/luxury-art-direction/temporal/proof-${TAG}.json`, JSON.stringify({ meta: { W, H, STEPS, screens: scrollable / H }, rows }, null, 1));

const life = (key, sub = 'o') => {
  const idx = rows.map((r, i) => [i, r[key] ? r[key][sub] : 0]).filter(([, v]) => v >= 0.05).map(([i]) => i);
  if (!idx.length) return 'never';
  const full = rows.map((r, i) => [i, r[key] ? r[key][sub] : 0]).filter(([, v]) => v >= 0.9).map(([i]) => i);
  return `${rows[idx[0]].screens.toFixed(2)} → ${rows[idx[idx.length - 1]].screens.toFixed(2)}` +
    (full.length ? `   full ${rows[full[0]].screens.toFixed(2)} → ${rows[full[full.length - 1]].screens.toFixed(2)} (${(rows[full[full.length - 1]].screens - rows[full[0]].screens).toFixed(2)} screens)` : '   never full');
};
console.log(`# ${TAG} ${W}x${H}\n`);
console.log('## §17 · THE PROOF ACT, OBJECT BY OBJECT (screens of scroll)');
for (const k of ['metric', 'shot', 'shotImg', 'define', 'routes']) console.log(`   ${k.padEnd(9)} ${life(k)}`);
console.log('\n## §27 · THE HEADER CALL TO ACTION');
const states = [];
for (const r of rows) {
  if (!r.header) continue;
  const key = `${r.header.bg}|${r.header.color}|${r.header.border}`;
  if (states.length && states[states.length - 1].key === key) states[states.length - 1].to = r.screens;
  else states.push({ key, from: r.screens, to: r.screens, h: r.header });
}
if (!states.length) console.log('   no header CTA matched');
for (const s of states) console.log(`   ${s.from.toFixed(2)} → ${s.to.toFixed(2)}   bg ${s.h.bg}   color ${s.h.color}   "${s.h.text}"`);
await b.close();
