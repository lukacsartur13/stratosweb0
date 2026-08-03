// =============================================================================
// Collect the generated static site into dist/, which is what Netlify publishes.
//
// The repository root is deliberately still a servable site — `python3 -m
// http.server` in the project root works exactly as it did before any of this
// existed, which keeps the authoring loop short. This script only assembles a
// deploy artefact; it never writes back into the source tree.
//
// Run order inside `npm run build`: generate (python) -> assemble (this) ->
// build:portal (vite, which writes dist/portal itself).
// =============================================================================

import { cp, mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const SITE_URL = process.env.VITE_SITE_URL || process.env.URL || 'https://media-stratos.com';

// Everything the browser is allowed to fetch. Anything not named here — the
// Python generator, its page fragments, the translation JSON, the backups — is
// intentionally left behind.
const COPY_DIRS = ['assets', 'en', 'de'];

// Paths inside COPY_DIRS that are source, not deliverable. assets/ is copied
// wholesale, so a 3D source file dropped in there would otherwise be published
// verbatim — a .blend is several hundred KB nobody requests and a look inside
// the workshop nobody asked for.
const SKIP = [join('assets', 'blender')];

// iCloud Drive writes "thing 2.ext" next to "thing.ext" when the folder syncs
// from two machines. .gitignore already refuses to commit them, so Netlify —
// which builds from the repository — has never seen one. A local build did:
// it copied them into dist/ and shipped stale pages alongside the real ones,
// which meant `npm test` was checking a different site from the deployed one.
// Mirrors the "* [0-9].*" rule in .gitignore, and also catches directories,
// which have no extension to strip.
const isDuplicate = (name) => / \d+$/.test(name.replace(/\.[^.]+$/, ''));

const isSkipped = (path) =>
  SKIP.some((s) => path === join(ROOT, s)) || isDuplicate(basename(path));

async function main() {
  // dist/portal is written by Vite in a later step, so only clear what we own.
  if (existsSync(DIST)) {
    for (const entry of await readdir(DIST)) {
      if (entry !== 'portal') await rm(join(DIST, entry), { recursive: true, force: true });
    }
  }
  await mkdir(DIST, { recursive: true });

  // Hungarian pages live at the root of the repo.
  const pages = (await readdir(ROOT))
    .filter((f) => f.endsWith('.html') && !isDuplicate(f));
  for (const page of pages) {
    await cp(join(ROOT, page), join(DIST, page));
  }

  for (const dir of COPY_DIRS) {
    if (existsSync(join(ROOT, dir))) {
      await cp(join(ROOT, dir), join(DIST, dir), { recursive: true, filter: (src) => !isSkipped(src) });
    }
  }

  await writeFile(join(DIST, 'robots.txt'), robots(), 'utf8');
  await writeFile(join(DIST, 'sitemap.xml'), await sitemap(pages), 'utf8');

  console.log(`assemble: ${pages.length} Hungarian pages + ${COPY_DIRS.join(', ')} -> dist/`);
}

function robots() {
  // Disallowing /portal is a hint to well-behaved crawlers so the sign-in page
  // stays out of search results. It is not access control — see the RLS
  // migration for that — and it deliberately does not name anything that is not
  // already discoverable.
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /portal',
    'Disallow: /api/',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n');
}

// The three languages are the same twelve pages under different names. The
// generator owns that mapping, so it is mirrored here rather than guessed.
const SLUGS = {
  index:      ['index.html', 'en/index.html', 'de/index.html'],
  about:      ['rolunk.html', 'en/about.html', 'de/ueber-uns.html'],
  sme:        ['kkv.html', 'en/web-design-sme.html', 'de/webdesign-kmu.html'],
  enterprise: ['nagyvallalat.html', 'en/web-design-enterprise.html', 'de/webdesign-grossunternehmen.html'],
  branding:   ['branding.html', 'en/branding.html', 'de/branding.html'],
  ads:        ['hirdeteskezeles.html', 'en/ads-management.html', 'de/werbeanzeigen.html'],
  impact:     ['impact-program.html', 'en/impact-program.html', 'de/impact-programm.html'],
  blog:       ['blog.html', 'en/blog.html', 'de/blog.html'],
  contact:    ['ugyfelszolgalat.html', 'en/contact.html', 'de/kontakt.html'],
  quote:      ['arajanlat.html', 'en/quote.html', 'de/angebot.html'],
  privacy:    ['adatkezelesi-tajekoztato.html', 'en/privacy-policy.html', 'de/datenschutz.html'],
  imprint:    ['impresszum.html', 'en/imprint.html', 'de/impressum.html'],
};

const LANGS = ['hu', 'en', 'de'];
const PRIORITY = { index: '1.0', quote: '0.9', contact: '0.8', privacy: '0.3', imprint: '0.3' };

async function sitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [];

  for (const [key, paths] of Object.entries(SLUGS)) {
    paths.forEach((path, i) => {
      // Every URL carries the full hreflang set, including x-default pointing at
      // Hungarian — the same contract the generated <head> already states.
      const alts = paths
        .map((p, j) => `    <xhtml:link rel="alternate" hreflang="${LANGS[j]}" href="${SITE_URL}/${p}"/>`)
        .join('\n');
      urls.push(
        `  <url>\n` +
        `    <loc>${SITE_URL}/${path}</loc>\n` +
        `    <lastmod>${today}</lastmod>\n` +
        `    <changefreq>monthly</changefreq>\n` +
        `    <priority>${i === 0 ? (PRIORITY[key] ?? '0.6') : '0.5'}</priority>\n` +
        alts + '\n' +
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/${paths[0]}"/>\n` +
        `  </url>`,
      );
    });
  }

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    urls.join('\n') +
    '\n</urlset>\n'
  );
}

main().catch((err) => {
  console.error('assemble failed:', err);
  process.exit(1);
});
