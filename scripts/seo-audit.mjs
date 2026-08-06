// =============================================================================
// Phase 9, Workstream F — the technical SEO audit.
//
//   node scripts/seo-audit.mjs            # write the report
//   node scripts/seo-audit.mjs --check    # exit 1 if any route fails a hard check
//
// Reads dist/ — the artefact Netlify publishes — rather than the source tree,
// because the questions here are about what a crawler receives. Writes
// _build/reports/phase9-seo-audit.json.
//
// WHAT COUNTS AS A HARD CHECK
// Only things that are wrong on their face, whatever anyone intended: a missing
// or non-self-referential canonical, a broken hreflang pair, a duplicate title,
// a page with no <h1> or with two, a sitemap entry that is noindex, an
// indexable page that no other page links to. Everything else — description
// length, title length, an og:image nobody set — is reported as a warning and
// left to a human, because the right answer to those is a judgement about the
// page rather than a rule.
//
// The route audit (scripts/route-audit.mjs) drives a browser and asks whether
// pages RENDER. This one reads markup and asks what they CLAIM. Neither
// subsumes the other.
// =============================================================================

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteOrigin, isPreviewOrigin } from './site-origin.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, '_build', 'reports', 'phase9-seo-audit.json');
const CHECK = process.argv.includes('--check');

const ORIGIN = siteOrigin();
const PREVIEW = isPreviewOrigin();

// Recommended ranges. Outside them is a warning, never a failure — a title is
// too long for a search result, not too long to be correct.
const TITLE_MAX = 65;
const DESC_MIN = 70;
const DESC_MAX = 165;

const isDuplicate = (name) => / \d+$/.test(name.replace(/\.[^.]+$/, ''));

const one = (html, re) => html.match(re)?.[1] ?? null;
const all = (html, re) => [...html.matchAll(re)].map((m) => m[1]);

const decode = (s) =>
  s == null ? null : s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Every public HTML document in dist/, as a route path. */
async function routes() {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (isDuplicate(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'portal' || entry.name === 'assets') continue;
        await walk(path);
      } else if (entry.name.endsWith('.html')) {
        out.push(path);
      }
    }
  }
  await walk(DIST);
  return out.sort();
}

/** The route path a crawler would use, from a file path in dist/. */
const routeOf = (file) => '/' + relative(DIST, file).split('\\').join('/');

async function main() {
  if (!existsSync(DIST)) {
    console.error('seo-audit: no dist/ — run `npm run build` first.');
    process.exit(1);
  }

  const files = await routes();
  const sitemap = existsSync(join(DIST, 'sitemap.xml'))
    ? await readFile(join(DIST, 'sitemap.xml'), 'utf8') : '';
  const sitemapPaths = new Set(
    [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname));
  const robots = existsSync(join(DIST, 'robots.txt'))
    ? await readFile(join(DIST, 'robots.txt'), 'utf8') : '';

  const pages = [];
  // Every same-site href seen anywhere, for orphan detection.
  const inbound = new Map();

  for (const file of files) {
    const html = await readFile(file, 'utf8');
    const route = routeOf(file);
    const is404 = basename(file) === '404.html';

    const canonical = one(html, /<link rel="canonical" href="([^"]+)"/);
    const alternates = [...html.matchAll(
      /<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)]
      .map((m) => ({ hreflang: m[1], href: m[2] }));

    const robotsMeta = one(html, /<meta name="robots" content="([^"]+)"/);
    const indexable = !is404 && !/noindex/i.test(robotsMeta ?? '');

    // The canonical path a crawler would settle on for this document.
    const canonicalPath = canonical ? new URL(canonical, ORIGIN).pathname : null;

    for (const href of all(html, /\shref="([^"#][^"]*)"/g)) {
      if (/^(https?:|mailto:|tel:|javascript:)/i.test(href)) continue;
      const target = new URL(href, `${ORIGIN}${route}`).pathname;
      if (!inbound.has(target)) inbound.set(target, new Set());
      // A page linking to itself is not an inbound link.
      if (target !== route && target !== canonicalPath) inbound.get(target).add(route);
    }

    pages.push({
      route,
      file: relative(ROOT, file),
      bytes: Buffer.byteLength(html),
      is404,
      lang: one(html, /<html lang="([^"]+)"/),
      title: decode(one(html, /<title>([\s\S]*?)<\/title>/))?.trim() ?? null,
      description: decode(one(html, /<meta name="description" content="([^"]*)"/)),
      h1: [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)]
        .map((m) => m[1].replace(/<[^>]+>/g, '').trim()),
      canonical,
      canonicalPath,
      alternates,
      robotsMeta,
      indexable,
      og: {
        title: decode(one(html, /<meta property="og:title" content="([^"]*)"/)),
        description: decode(one(html, /<meta property="og:description" content="([^"]*)"/)),
        image: one(html, /<meta property="og:image" content="([^"]*)"/),
        url: one(html, /<meta property="og:url" content="([^"]*)"/),
        type: one(html, /<meta property="og:type" content="([^"]*)"/),
      },
      twitterCard: one(html, /<meta name="twitter:card" content="([^"]*)"/),
      // An empty mount point plus a module bundle: the document's content is
      // JavaScript's to produce. Only the three homepage shells are built this
      // way, and it changes which questions this script can answer about them.
      clientRendered: /<main[^>]*class="journey"[^>]*>\s*<\/main>/.test(html)
        && /<script[^>]*type="module"/.test(html),
      jsonLd: (html.match(/<script type="application\/ld\+json">/g) ?? []).length,
      breadcrumb: html.includes('"BreadcrumbList"'),
      inSitemap: sitemapPaths.has(route) || (canonicalPath && sitemapPaths.has(canonicalPath)),
    });
  }

  const byRoute = new Map(pages.map((p) => [p.route, p]));
  const failures = [];
  const warnings = [];
  const fail = (route, rule, detail) => failures.push({ route, rule, detail });
  const warn = (route, rule, detail) => warnings.push({ route, rule, detail });

  // ---- duplicate titles and descriptions, among indexable routes only -------
  const seenTitle = new Map();
  const seenDesc = new Map();

  for (const p of pages) {
    // ---- the things every document owes ------------------------------------
    if (!p.lang) fail(p.route, 'lang', 'no <html lang>');
    if (!p.title) fail(p.route, 'title', 'no <title>');
    if (!p.description) fail(p.route, 'description', 'no meta description');

    // The three homepages are a React application: their <h1> is in the bundle
    // and does not exist in the shell this script reads. Failing them here
    // would be reporting on the wrong artefact — the question "does the
    // homepage have exactly one h1" is answered by a browser, and is, in
    // tests/public-site.spec.ts `has one h1 and a skip link`. Recorded as a
    // deferral with the name of the test that covers it, so it is a pointer
    // rather than an exemption.
    if (p.clientRendered) {
      p.h1Source = 'rendered — see tests/public-site.spec.ts "has one h1 and a skip link"';
    } else {
      if (p.h1.length !== 1) fail(p.route, 'h1', `${p.h1.length} <h1> elements`);
      if (p.h1.length === 1 && !p.h1[0]) fail(p.route, 'h1', 'the <h1> is empty');
    }

    if (p.title && p.title.length > TITLE_MAX) {
      warn(p.route, 'title-length', `${p.title.length} characters (over ${TITLE_MAX})`);
    }
    if (p.description) {
      const n = p.description.length;
      if (n < DESC_MIN || n > DESC_MAX) {
        warn(p.route, 'description-length', `${n} characters (outside ${DESC_MIN}–${DESC_MAX})`);
      }
    }

    if (p.is404) {
      // A 404 must claim nothing. The inverse checks.
      if (p.canonical) fail(p.route, '404-canonical', 'a 404 must not declare a canonical');
      if (p.alternates.length) fail(p.route, '404-hreflang', 'a 404 must not declare alternates');
      if (p.indexable) fail(p.route, '404-robots', 'a 404 must be noindex');
      if (p.inSitemap) fail(p.route, '404-sitemap', 'a 404 must not be in the sitemap');
      continue;
    }

    // ---- canonical ----------------------------------------------------------
    if (!p.canonical) {
      fail(p.route, 'canonical', 'no canonical');
    } else {
      if (!/^https:\/\//.test(p.canonical)) {
        fail(p.route, 'canonical-absolute', `not an absolute https URL: ${p.canonical}`);
      }
      if (!p.canonical.startsWith(`${ORIGIN}/`)) {
        fail(p.route, 'canonical-origin', `points off ${ORIGIN}: ${p.canonical}`);
      }
      if (/media-stratos\.com|wixsite|wixstatic/i.test(p.canonical)) {
        fail(p.route, 'canonical-wix', `points at the old Wix site: ${p.canonical}`);
      }
      // Self-referential: the canonical of /en/about.html must be /en/about.html
      // or the URL that serves it. The homepages are the one legitimate case
      // where the two differ, and the redirect table closes it.
      const expected = p.route.replace(/\/index\.html$/, '/');
      if (p.canonicalPath !== p.route && p.canonicalPath !== expected) {
        fail(p.route, 'canonical-self',
          `canonical is ${p.canonicalPath}, expected ${expected}`);
      }
      // The locale of the canonical must be this page's locale.
      const localeOf = (path) => (path.match(/^\/(en|de)\//) ?? [, 'hu'])[1];
      if (localeOf(p.canonicalPath ?? '') !== localeOf(p.route)) {
        fail(p.route, 'canonical-locale',
          `${p.route} canonicalises into ${localeOf(p.canonicalPath)}`);
      }
    }

    // ---- hreflang -----------------------------------------------------------
    const langs = p.alternates.map((a) => a.hreflang);
    for (const required of ['hu', 'en', 'de', 'x-default']) {
      if (!langs.includes(required)) {
        fail(p.route, 'hreflang-missing', `no hreflang="${required}"`);
      }
    }
    if (!langs.includes(p.lang)) {
      fail(p.route, 'hreflang-self', `no self-referential hreflang for ${p.lang}`);
    }

    for (const alt of p.alternates) {
      const target = new URL(alt.href, `${ORIGIN}${p.route}`).pathname;
      const targetPage = byRoute.get(target) ?? byRoute.get(`${target}index.html`);
      if (!targetPage) {
        fail(p.route, 'hreflang-404', `hreflang="${alt.hreflang}" -> ${target} does not exist`);
        continue;
      }
      if (alt.hreflang !== 'x-default') {
        if (targetPage.lang !== alt.hreflang) {
          fail(p.route, 'hreflang-lang',
            `hreflang="${alt.hreflang}" -> ${target}, which is lang="${targetPage.lang}"`);
        }
        // Reciprocity: the target must point back here under this page's lang.
        const back = targetPage.alternates.find((a) => a.hreflang === p.lang);
        const backTarget = back
          ? new URL(back.href, `${ORIGIN}${targetPage.route}`).pathname : null;
        if (!back) {
          fail(p.route, 'hreflang-reciprocal', `${target} declares no hreflang="${p.lang}"`);
        } else if (backTarget !== p.route && backTarget !== p.canonicalPath) {
          fail(p.route, 'hreflang-reciprocal',
            `${target} points hreflang="${p.lang}" at ${backTarget}, not at ${p.route}`);
        }
      }
      if (!targetPage.indexable && alt.hreflang !== 'x-default') {
        warn(p.route, 'hreflang-noindex', `hreflang="${alt.hreflang}" -> ${target} is noindex`);
      }
    }

    // ---- social -------------------------------------------------------------
    for (const [field, value] of Object.entries(p.og)) {
      if (!value) warn(p.route, 'og', `no og:${field}`);
    }
    if (p.og.url && p.canonical && p.og.url !== p.canonical) {
      fail(p.route, 'og-url', `og:url ${p.og.url} disagrees with the canonical ${p.canonical}`);
    }
    if (!p.twitterCard) warn(p.route, 'twitter', 'no twitter:card');

    // ---- structured data ----------------------------------------------------
    if (p.jsonLd !== 1) fail(p.route, 'json-ld', `${p.jsonLd} JSON-LD blocks, expected 1`);

    // ---- indexability vs the sitemap ---------------------------------------
    if (p.indexable && !p.inSitemap) {
      fail(p.route, 'sitemap-missing', 'indexable but absent from the sitemap');
    }
    if (!p.indexable && p.inSitemap) {
      fail(p.route, 'sitemap-noindex', 'noindex but present in the sitemap');
    }

    // ---- duplicates ---------------------------------------------------------
    if (p.indexable) {
      if (p.title) {
        const prior = seenTitle.get(p.title);
        if (prior) fail(p.route, 'title-duplicate', `same <title> as ${prior}`);
        else seenTitle.set(p.title, p.route);
      }
      if (p.description) {
        const prior = seenDesc.get(p.description);
        if (prior) fail(p.route, 'description-duplicate', `same description as ${prior}`);
        else seenDesc.set(p.description, p.route);
      }
    }
  }

  // ---- orphans --------------------------------------------------------------
  for (const p of pages) {
    if (p.is404 || !p.indexable) continue;
    const links = inbound.get(p.route) ?? inbound.get(p.canonicalPath ?? '') ?? new Set();
    p.inboundLinks = links.size;
    if (links.size === 0) fail(p.route, 'orphan', 'no other page links to it');
  }

  // ---- robots.txt -----------------------------------------------------------
  const robotsFindings = [];
  if (!robots) {
    failures.push({ route: '/robots.txt', rule: 'robots', detail: 'missing' });
  } else {
    // Never block what the page needs to render. Blocking CSS or JS makes the
    // rendered page a crawler sees different from the one a visitor sees.
    for (const line of robots.split('\n')) {
      const m = line.match(/^Disallow:\s*(.+)$/i);
      if (!m) continue;
      const path = m[1].trim();
      robotsFindings.push(path);
      if (/^\/(assets|models|draco)\b/.test(path)) {
        failures.push({
          route: '/robots.txt', rule: 'robots-blocks-rendering',
          detail: `Disallow: ${path} blocks resources the page needs to render`,
        });
      }
    }
    if (PREVIEW && !/^Disallow:\s*\/\s*$/m.test(robots)) {
      failures.push({
        route: '/robots.txt', rule: 'preview-indexable',
        detail: 'this is a preview origin but robots.txt does not disallow everything',
      });
    }
    if (!PREVIEW && !robots.includes('Sitemap:')) {
      failures.push({ route: '/robots.txt', rule: 'robots-sitemap', detail: 'no Sitemap: line' });
    }
    if (!/Disallow:\s*\/portal/.test(robots)) {
      failures.push({ route: '/robots.txt', rule: 'portal', detail: 'the portal is not disallowed' });
    }
  }

  const report = {
    generated: new Date().toISOString(),
    origin: ORIGIN,
    previewOrigin: PREVIEW,
    counts: {
      documents: pages.length,
      indexable: pages.filter((p) => p.indexable && !p.is404).length,
      noindex: pages.filter((p) => !p.indexable && !p.is404).length,
      notFound: pages.filter((p) => p.is404).length,
      sitemapEntries: sitemapPaths.size,
      failures: failures.length,
      warnings: warnings.length,
    },
    robots: { disallow: robotsFindings, hasSitemapLine: robots.includes('Sitemap:') },
    failures,
    warnings,
    pages,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 1), 'utf8');

  const { counts } = report;
  console.log(
    `seo-audit: ${counts.documents} documents — ${counts.indexable} indexable, ` +
    `${counts.noindex} noindex, ${counts.notFound} not-found, ` +
    `${counts.sitemapEntries} sitemap entries`);
  console.log(`  ${counts.failures} failing, ${counts.warnings} warnings -> ${relative(ROOT, OUT)}`);

  for (const f of failures.slice(0, 40)) console.log(`  FAIL ${f.route}  ${f.rule}: ${f.detail}`);
  if (failures.length > 40) console.log(`  … and ${failures.length - 40} more`);

  if (CHECK && failures.length) process.exit(1);
}

main().catch((err) => {
  console.error('seo-audit failed:', err);
  process.exit(1);
});
