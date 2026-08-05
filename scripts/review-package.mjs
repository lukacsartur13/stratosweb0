// =============================================================================
// Phase 8 — the human visual review package (§18).
//
//   node scripts/review-package.mjs
//
// Writes _build/reports/phase8-review/ — one folder per archetype, each holding
// the viewports §18 asks for plus a full-page thumbnail, and an index.html that
// lays them out side by side with the labels the reviewer needs: what is new,
// what changed, what is retained, and what is still waiting on the user's
// factual approval.
//
// The output is deliberately NOT committed. It is a few hundred screenshots of
// a site that is already in the repository; §20 says do not stage screenshot
// packages, and .gitignore already refuses this directory's siblings.
// =============================================================================

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_build', 'reports', 'phase8-review');
const PORT = 4328;
const BASE = `http://127.0.0.1:${PORT}`;

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '390x844', width: 390, height: 844 },
  { name: '844x390', width: 844, height: 390 },
];

// §18's list, in the order a reviewer should walk it.
const SUBJECTS = [
  { id: '01-homepage',      url: '/index.html',                    label: 'Homepage (reference — unchanged, Phase 6/7)', status: 'retained' },
  { id: '02-contact',       url: '/ugyfelszolgalat.html',          label: 'Contact and project start',                  status: 'rebuilt' },
  { id: '03-questionnaire', url: '/arajanlat.html',                label: 'Questionnaire',                              status: 'changed — server-rendered shell added' },
  { id: '04-services',      url: '/szolgaltatasok.html',           label: 'Services overview',                          status: 'new route' },
  { id: '05-service-sme',   url: '/kkv.html',                      label: 'Primary service page (SME)',                 status: 'changed — cross-links, case-study links, new CTA' },
  { id: '06-service-ads',   url: '/hirdeteskezeles.html',          label: 'Service page variation (ads)',               status: 'changed — cross-links, new CTA' },
  { id: '07-work',          url: '/munkaink.html',                 label: 'Work index',                                 status: 'new route' },
  { id: '08-case',          url: '/munka-rapidkert.html',          label: 'Strongest case study (Rapidkert)',           status: 'new route — results pending client facts' },
  { id: '09-about',         url: '/rolunk.html',                   label: 'About',                                      status: 'changed — related block, optimised portrait' },
  { id: '10-impact',        url: '/impact-program.html',           label: 'Impact Program',                             status: 'changed — boundaries section added' },
  { id: '11-blog',          url: '/blog.html',                     label: 'Blog listing',                               status: 'changed — cards now have destinations' },
  { id: '12-article',       url: '/blog-google-elso-oldal.html',   label: 'Complete article',                           status: 'new route — FACTUAL REVIEW PENDING' },
  // The locale pass is easier to judge on one route in all three languages
  // than on three unrelated pages.
  { id: '13-locale-en',     url: '/en/services.html',              label: 'Services overview — English',                status: 'new route' },
  { id: '14-locale-de',     url: '/de/leistungen.html',            label: 'Services overview — German (long headings)', status: 'new route' },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', join(ROOT, 'dist')], { stdio: 'ignore' });
  await wait(900);
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const shots = [];

  for (const s of SUBJECTS) {
    await mkdir(join(OUT, s.id), { recursive: true });
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      await page.goto(BASE + s.url, { waitUntil: 'load' });
      await page.waitForTimeout(400);

      // First viewport: the hero, as the visitor first sees it.
      await page.screenshot({ path: join(OUT, s.id, `${vp.name}-hero.png`) });

      // Then the sections §18 asks to see individually. Scrolling in fractions
      // of the document rather than to named selectors keeps this working on
      // every archetype, including the ones that do not have a form.
      if (vp.name === '1440x900') {
        const h = await page.evaluate(() => document.body.scrollHeight);
        for (const [tag, frac] of [['middle', 0.4], ['proof', 0.62], ['conversion', 0.82], ['final-cta', 0.97]]) {
          await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, h * frac - 450));
          // Reveal transitions are ~0.9s; a shot taken sooner is a shot of the
          // animation rather than of the design.
          await page.waitForTimeout(1000);
          await page.screenshot({ path: join(OUT, s.id, `${vp.name}-${tag}.png`) });
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(OUT, s.id, `${vp.name}-fullpage.png`), fullPage: true });
      }
      await ctx.close();
    }
    shots.push(s);
    process.stdout.write(`  ${s.id} ${s.url}\n`);
  }

  await browser.close();
  server.kill();
  await writeFile(join(OUT, 'index.html'), indexHtml(shots), 'utf8');
  console.log(`\nreview package -> ${OUT}/index.html`);
}

function indexHtml(subjects) {
  const card = (s) => `
  <section id="${s.id}">
    <h2>${s.label}</h2>
    <p class="meta"><code>${s.url}</code> <b class="${/new route/.test(s.status) ? 'new' : /rebuilt|changed/.test(s.status) ? 'chg' : 'keep'}">${s.status}</b></p>
    <div class="grid">
      ${VIEWPORTS.map((v) => `<figure><img src="${s.id}/${v.name}-hero.png" alt="${s.label} at ${v.name}" loading="lazy"><figcaption>${v.name} — hero</figcaption></figure>`).join('')}
      ${['middle', 'proof', 'conversion', 'final-cta'].map((t) => `<figure><img src="${s.id}/1440x900-${t}.png" alt="${s.label}, ${t}" loading="lazy"><figcaption>1440x900 — ${t}</figcaption></figure>`).join('')}
      <figure class="tall"><img src="${s.id}/1440x900-fullpage.png" alt="${s.label}, full page" loading="lazy"><figcaption>1440x900 — full page</figcaption></figure>
    </div>
  </section>`;

  return `<!doctype html><meta charset="utf-8"><title>Stratos — Phase 8 visual review</title>
<style>
 :root{color-scheme:dark}
 body{background:#0b0b0b;color:#eee;font:15px/1.6 system-ui,sans-serif;margin:0;padding:2rem clamp(1rem,4vw,4rem)}
 h1{font-size:1.8rem;margin:0 0 .4rem}
 .lede{color:#aaa;max-width:70ch}
 nav{margin:2rem 0;padding:1rem 0;border-block:1px solid #262626;display:flex;flex-wrap:wrap;gap:.4rem 1.4rem;font-size:13px}
 nav a{color:#9cc6e4}
 section{margin:3.5rem 0;padding-top:1.4rem;border-top:1px solid #262626}
 h2{font-size:1.25rem;margin:0 0 .3rem}
 .meta{color:#888;font-size:13px;margin:0 0 1.2rem}
 b.new{color:#FFEE25}b.chg{color:#9cc6e4}b.keep{color:#7a7a7a}
 .grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
 figure{margin:0}
 img{width:100%;border:1px solid #262626;background:#000;display:block}
 .tall img{max-height:1400px;object-fit:contain;object-position:top}
 figcaption{font:12px/1.5 ui-monospace,monospace;color:#777;padding-top:.4rem}
 .flags{background:#141414;border:1px solid #2a2a2a;padding:1.2rem 1.4rem;margin:1.5rem 0}
 .flags h3{margin:.2rem 0 .6rem;font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:#FFEE25}
 .flags ul{margin:0;padding-left:1.2rem}
 .flags li{margin:.3rem 0;color:#ccc}
</style>
<h1>Stratos — Phase 8 visual review</h1>
<p class="lede">Generated by <code>scripts/review-package.mjs</code> from <code>dist/</code>. Nothing here is approved; this package exists so that a human can decide.</p>

<div class="flags">
  <h3>Requires user factual approval</h3>
  <ul>
    <li><b>The six blog articles</b> — technically complete and included below, but their factual content has not been reviewed by the user. They must not be treated as production-approved until it has been.</li>
    <li><b>Case-study results</b> — all three case studies deliberately carry no metrics. Project duration, delivery date, technology used, measured outcomes and any client quote are marked <code>REQUIRES USER FACTUAL APPROVAL</code> on the pages themselves.</li>
    <li><b>Uncensored Society and Brickness Community</b> — named as real references in <code>CONTENT_GUIDE.md</code>, but no project material exists in the repository. They are deliberately absent from the work index rather than invented into it.</li>
    <li><b>German register</b> — <code>CONTENT_GUIDE.md</code> asks for formal <i>Sie</i>; every German page already shipped informal <i>du</i>, and the Phase 8 pages match what shipped. Changing it is a site-wide decision, not a Phase 8 one.</li>
  </ul>
</div>
<div class="flags">
  <h3>Media rights</h3>
  <ul>
    <li><code>cruise-jet.jpg</code> is quarantined in <code>_backup/media-rights-hold/</code>. No page referenced it, but <code>assemble.mjs</code> copies <code>assets/</code> wholesale, so it was being published on a guessable URL. It must not go back into <code>assets/img/</code> until rights are confirmed.</li>
  </ul>
</div>
<div class="flags">
  <h3>Documented exceptions</h3>
  <ul>
    <li>The three questionnaire routes still have no server-rendered primary CTA — the wizard's own Start button is injected by JavaScript. They now serve an H1, an intro and a link to the short contact form, which they did not before.</li>
    <li><code>/impresszum.html</code> is linked from the footer of all 66 routes but from no page <i>body</i>. No body link would be contextually honest, so none was added.</li>
    <li>Legal and imprint routes use the quiet hero and the simplified template, not the editorial one.</li>
  </ul>
</div>

<nav>${subjects.map((s) => `<a href="#${s.id}">${s.label}</a>`).join('')}</nav>
${subjects.map(card).join('')}
`;
}

main().catch((e) => { console.error(e); process.exit(1); });
