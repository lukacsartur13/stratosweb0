// =============================================================================
// Phase 8 route matrix.
//
// The content inventory (scripts/content-inventory.mjs) records *what a page
// contains*. This records *what a page is*: its archetype, the template that
// produced it, the CTA it is trying to earn, and the structural faults that the
// redesign has to answer for. The two are deliberately separate files — the
// inventory is a regression fixture that must not drift, this is a judgement
// that will be rewritten as the phase progresses.
//
//   node scripts/route-matrix.mjs
//
// Output: _build/reports/phase8-route-matrix.json
//         _build/reports/phase8-content-inventory.json   (inventory, frozen copy)
//
// Reads the generated pages in the source tree, the same set the inventory
// walks, so the two reports always describe the same 33 documents. The three
// React homepages are counted separately: they are shells whose content is a
// JavaScript bundle, and measuring their empty <main> as "0 words" would be a
// lie about the homepage rather than a fact about it.
// =============================================================================

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_build', 'reports', 'phase8-route-matrix.json');

// Canonical key -> per-locale filename. Mirrors SLUGS in _build/build.py; the
// generator owns the mapping and this file states it rather than guessing it.
const SLUGS = {
  index:      { hu: 'index.html',                    en: 'index.html',                 de: 'index.html' },
  about:      { hu: 'rolunk.html',                   en: 'about.html',                 de: 'ueber-uns.html' },
  sme:        { hu: 'kkv.html',                      en: 'web-design-sme.html',        de: 'webdesign-kmu.html' },
  enterprise: { hu: 'nagyvallalat.html',             en: 'web-design-enterprise.html', de: 'webdesign-grossunternehmen.html' },
  branding:   { hu: 'branding.html',                 en: 'branding.html',              de: 'branding.html' },
  ads:        { hu: 'hirdeteskezeles.html',          en: 'ads-management.html',        de: 'werbeanzeigen.html' },
  impact:     { hu: 'impact-program.html',           en: 'impact-program.html',        de: 'impact-programm.html' },
  blog:       { hu: 'blog.html',                     en: 'blog.html',                  de: 'blog.html' },
  contact:    { hu: 'ugyfelszolgalat.html',          en: 'contact.html',               de: 'kontakt.html' },
  quote:      { hu: 'arajanlat.html',                en: 'quote.html',                 de: 'angebot.html' },
  privacy:    { hu: 'adatkezelesi-tajekoztato.html', en: 'privacy-policy.html',        de: 'datenschutz.html' },
  imprint:    { hu: 'impresszum.html',               en: 'imprint.html',               de: 'impressum.html' },
};

// The archetype vocabulary from the Phase 8 brief, §3.
const ARCHETYPE = {
  index:      'home',
  about:      'about',
  sme:        'service detail',
  enterprise: 'service detail',
  branding:   'service detail',
  ads:        'service detail',
  impact:     'Impact Program',
  blog:       'blog / editorial',
  contact:    'contact',
  quote:      'questionnaire',
  privacy:    'legal / utility',
  imprint:    'legal / utility',
};

// Which build produced the document. The homepage is a Vite/React bundle; every
// other route is a Python-generated fragment in the shared SHELL.
const TEMPLATE = (key) => (key === 'index' ? 'experiments/home (Vite + R3F)' : '_build/build.py SHELL + _build/pages/*.html');

const LOCALES = ['hu', 'en', 'de'];

const decode = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, d) => String.fromCodePoint(parseInt(d, 16)));

const strip = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function filePath(key, locale) {
  const name = SLUGS[key][locale];
  return locale === 'hu' ? join(ROOT, name) : join(ROOT, locale, name);
}

function routeUrl(key, locale) {
  const name = SLUGS[key][locale];
  return '/' + (locale === 'hu' ? '' : locale + '/') + name;
}

/** The body of the document, with the shared chrome removed. */
function pageBody(html) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  return main ? main[1] : '';
}

function analyse(html, key, locale) {
  const body = pageBody(html);
  const h1 = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => strip(m[1]));
  const sections = [...body.matchAll(/<section\b([^>]*)>/gi)].map((m) => {
    const cls = m[1].match(/class="([^"]*)"/i);
    return cls ? cls[1] : '';
  });

  // A CTA is a link that carries the button class. `.tlink` is a text link and
  // is counted separately — treating both as CTAs is what produced the
  // "primary CTA after every section" problem this phase is meant to fix.
  const anchors = [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({
    attrs: m[1],
    text: strip(m[2]),
    href: (m[1].match(/href="([^"]*)"/i) || [])[1] || null,
    cls: (m[1].match(/class="([^"]*)"/i) || [])[1] || '',
  }));
  const ctas = anchors.filter((a) => /\bbtn\b/.test(a.cls)).map((a) => ({ text: a.text, href: a.href, variant: /btn--ghost/.test(a.cls) ? 'secondary' : 'primary' }));

  const forms = [...body.matchAll(/<form\b([^>]*)>/gi)].map((m) => ({
    dataLead: (m[1].match(/data-lead="([^"]*)"/i) || [])[1] || null,
    action: (m[1].match(/action="([^"]*)"/i) || [])[1] || null,
  }));

  const images = [...body.matchAll(/<img\b([^>]*)>/gi)].map((m) => ({
    src: (m[1].match(/src="([^"]*)"/i) || [])[1] || null,
    alt: (m[1].match(/alt="([^"]*)"/i) || [])[1] ?? null,
    loading: (m[1].match(/loading="([^"]*)"/i) || [])[1] || null,
    hasDimensions: /\bwidth=/.test(m[1]) && /\bheight=/.test(m[1]),
  }));

  const words = strip(body).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

  const internalLinks = anchors
    .map((a) => a.href)
    .filter((h) => h && !/^(https?:|mailto:|tel:|#|javascript:)/i.test(h));

  return {
    route: routeUrl(key, locale),
    key,
    locale,
    archetype: ARCHETYPE[key],
    template: TEMPLATE(key),
    title: strip((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '') || null,
    metaDescription: (html.match(/<meta\b[^>]*name="description"[^>]*content="([^"]*)"/i) || [])[1] || null,
    canonical: (html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]*)"/i) || [])[1] || null,
    hreflang: [...html.matchAll(/<link\b[^>]*rel="alternate"[^>]*>/gi)].map(
      (m) => (m[0].match(/hreflang="([^"]*)"/i) || [])[1],
    ),
    ogTitle: (html.match(/<meta\b[^>]*property="og:title"[^>]*content="([^"]*)"/i) || [])[1] || null,
    ogImage: (html.match(/<meta\b[^>]*property="og:image"[^>]*content="([^"]*)"/i) || [])[1] || null,
    structuredData: /application\/ld\+json/i.test(html),
    breadcrumb: /class="crumbs"/i.test(body),
    h1,
    h1Count: h1.length,
    headingLevels: [...body.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1])),
    sectionCount: sections.length,
    sectionClasses: sections,
    meaningfulWords: words,
    primaryCta: ctas.find((c) => c.variant === 'primary') || null,
    secondaryCta: ctas.find((c) => c.variant === 'secondary') || null,
    ctas,
    forms,
    images,
    internalLinkCount: internalLinks.length,
    internalLinks: [...new Set(internalLinks)],
  };
}

/** Structural faults that are decidable from the markup alone. */
function faults(row, all) {
  const out = [];

  if (row.h1Count === 0) out.push('no H1 in the served document');
  if (row.h1Count > 1) out.push(`${row.h1Count} H1 elements`);
  if (row.meaningfulWords === 0) out.push('no server-rendered body content — client-rendered only');
  else if (row.meaningfulWords < 150) out.push(`thin page (${row.meaningfulWords} words)`);
  if (!row.canonical) out.push('no canonical URL');
  if (!row.ogTitle) out.push('no Open Graph title');
  if (!row.ogImage) out.push('no Open Graph image');
  if (!row.metaDescription) out.push('no meta description');
  if (!row.primaryCta && row.archetype !== 'legal / utility') out.push('no primary CTA');
  if (!row.breadcrumb && !['home', 'legal / utility', 'questionnaire'].includes(row.archetype))
    out.push('no breadcrumb');
  // The site does not use Netlify Forms and deliberately does not: every form
  // posts the canonical envelope to /api/lead. So the fault worth reporting is
  // a form that is *not* wired to that controller, not one that Netlify cannot
  // see. See _build/reports/phase8-lead-pipeline.md.
  for (const f of row.forms) {
    if (!f.dataLead) out.push('form is not wired to the lead controller (no data-lead)');
    if (f.action) out.push(`form posts off-controller to ${f.action}`);
  }

  // Heading order: every step down must be by one level.
  let prev = 0;
  for (const level of row.headingLevels) {
    if (prev && level > prev + 1) { out.push(`heading order skips h${prev} -> h${level}`); break; }
    prev = level;
  }

  for (const img of row.images) {
    if (img.alt === null) out.push(`image without alt attribute: ${img.src}`);
    if (!img.hasDimensions) { out.push('images lack intrinsic width/height (CLS risk)'); break; }
  }

  // A route with no locale sibling is an orphan in the language switcher.
  for (const loc of LOCALES) {
    if (!all.some((r) => r.key === row.key && r.locale === loc))
      out.push(`missing ${loc.toUpperCase()} locale equivalent`);
  }

  return out;
}

const rows = [];
const missing = [];

for (const key of Object.keys(SLUGS)) {
  for (const locale of LOCALES) {
    const file = filePath(key, locale);
    if (!existsSync(file)) { missing.push(routeUrl(key, locale)); continue; }
    rows.push(analyse(await readFile(file, 'utf8'), key, locale));
  }
}

for (const row of rows) row.faults = faults(row, rows);

// Duplicate detection: two routes in the same locale whose H1 and section
// signature match are the same page under two names.
const signature = (r) => `${r.locale}|${r.h1.join('/')}|${r.sectionClasses.join(',')}`;
const seen = new Map();
const duplicates = [];
for (const r of rows) {
  const s = signature(r);
  if (r.meaningfulWords === 0) continue;          // the three empty shells are not duplicates of each other
  if (seen.has(s)) duplicates.push([seen.get(s), r.route]);
  else seen.set(s, r.route);
}

// Orphans: a route nothing links to. The generated nav and footer are shared
// chrome and are excluded from the inventory's link set, so this is measured
// against in-body links only — which is exactly the question worth asking.
const linkedTo = new Set();
for (const r of rows) for (const href of r.internalLinks) linkedTo.add(href.split(/[#?]/)[0]);
const orphans = rows
  .filter((r) => r.locale === 'hu' && r.key !== 'index')
  .filter((r) => !linkedTo.has(SLUGS[r.key].hu))
  .map((r) => r.route);

const byArchetype = {};
for (const r of rows) (byArchetype[r.archetype] ??= []).push(r.route);

const report = {
  generatedAt: new Date().toISOString(),
  summary: {
    routes: rows.length,
    locales: LOCALES.length,
    keys: Object.keys(SLUGS).length,
    missingRoutes: missing,
    archetypes: Object.fromEntries(Object.entries(byArchetype).map(([k, v]) => [k, v.length])),
    routesWithForms: rows.filter((r) => r.forms.length).length,
    formsOnCanonicalController: rows.reduce((n, r) => n + r.forms.filter((f) => f.dataLead).length, 0),
    routesWithoutPrimaryCta: rows.filter((r) => !r.primaryCta).length,
    routesWithoutCanonical: rows.filter((r) => !r.canonical).length,
    routesWithoutOg: rows.filter((r) => !r.ogTitle).length,
    routesWithStructuredData: rows.filter((r) => r.structuredData).length,
    clientRenderedRoutes: rows.filter((r) => r.meaningfulWords === 0).map((r) => r.route),
  },
  archetypes: byArchetype,
  duplicates,
  orphans,
  routes: rows,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(report, null, 2));

console.log(`route-matrix: ${rows.length} routes -> ${relative(ROOT, OUT)}`);
console.table(
  rows.map((r) => ({
    route: r.route,
    archetype: r.archetype,
    h1: r.h1Count,
    sec: r.sectionCount,
    words: r.meaningfulWords,
    cta: r.primaryCta ? r.primaryCta.href : '—',
    forms: r.forms.length,
    faults: r.faults.length,
  })),
);
console.log('SUMMARY', report.summary);
if (duplicates.length) console.log('DUPLICATES', duplicates);
if (orphans.length) console.log('ORPHANS (not linked from any page body)', orphans);
