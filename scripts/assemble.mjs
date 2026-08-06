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

import { cp, mkdir, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteOrigin, isPreviewOrigin } from './site-origin.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

// Resolved, never written down — see scripts/site-origin.mjs for why, and for
// why nothing here has to choose between the apex and the www host.
const SITE_URL = siteOrigin();
const PREVIEW = isPreviewOrigin();

// Everything the browser is allowed to fetch. Anything not named here — the
// Python generator, its page fragments, the translation JSON, the backups — is
// intentionally left behind.
const COPY_DIRS = ['assets', 'en', 'de'];

// Paths inside COPY_DIRS that are source, not deliverable. assets/ is copied
// wholesale, so a 3D source file dropped in there would otherwise be published
// verbatim — a .blend is several hundred KB nobody requests and a look inside
// the workshop nobody asked for.
const SKIP = [join('assets', 'blender')];

// Documentation that lives beside the assets it describes, and must not be
// served with them.
//
// `assets/img/FORRASOK.md` is the media-rights audit: it names every image's
// source and licence, and it names the one file whose rights are unresolved and
// where it is quarantined. `assets/fonts/MANIFEST.json` is the font inventory.
// Both belong next to what they document — that is what keeps them accurate —
// and neither is something to publish at a guessable URL. `assets/` is copied
// wholesale, so absent this rule they shipped, and they did.
const isDoc = (name) => /\.md$/i.test(name) || name === 'MANIFEST.json';

// iCloud Drive writes "thing 2.ext" next to "thing.ext" when the folder syncs
// from two machines. .gitignore already refuses to commit them, so Netlify —
// which builds from the repository — has never seen one. A local build did:
// it copied them into dist/ and shipped stale pages alongside the real ones,
// which meant `npm test` was checking a different site from the deployed one.
// Mirrors the "* [0-9].*" rule in .gitignore, and also catches directories,
// which have no extension to strip.
const isDuplicate = (name) => / \d+$/.test(name.replace(/\.[^.]+$/, ''));

const isSkipped = (path) =>
  SKIP.some((s) => path === join(ROOT, s)) ||
  isDuplicate(basename(path)) ||
  isDoc(basename(path));

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
  // A preview must not be crawlable. Until the custom domain is attached this
  // site is served from a netlify.app subdomain, and a second indexable copy of
  // the same pages competes with the real one for the same queries — with the
  // subdomain usually losing, but not always, which is worse. `isPreviewOrigin`
  // covers deploy previews and branch deploys too.
  if (PREVIEW) {
    return [
      '# Preview deploy — not the canonical site. See scripts/site-origin.mjs.',
      'User-agent: *',
      'Disallow: /',
      '',
    ].join('\n');
  }

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

// The three languages are the same pages under different names, and the
// generator owns that mapping. It used to be mirrored here by hand; Phase 8
// took the route count from twelve keys to twenty-three, at which point a
// hand-mirrored copy is a sitemap that goes stale without anyone noticing. It
// is now read from the manifest _build/build.py writes, which runs immediately
// before this script inside `npm run build`.
const MANIFEST = join(ROOT, '_build', 'routes.json');
if (!existsSync(MANIFEST)) {
  console.error(`assemble: missing ${MANIFEST} — run \`npm run generate\` first.`);
  process.exit(1);
}
const {
  langs: LANGS, slugs: RAW, canonical: CANONICAL, status: STATUS = {},
} = JSON.parse(await readFile(MANIFEST, 'utf8'));

if (!CANONICAL) {
  console.error('assemble: routes.json has no `canonical` table — run `npm run generate` first.');
  process.exit(1);
}

// The CANONICAL URL of each route, per language, as a path with no leading
// slash — ready to be appended to the origin.
//
// Built from the manifest's `canonical` table rather than from its filenames.
// For 21 of the 22 keys the two are the same; for the homepage they are not,
// and that difference is the whole reason this table exists. The homepage
// shells are built by Vite and their own `<link rel="canonical">` says `/`,
// `/en/` and `/de/`. This file used to derive `index.html`, `en/index.html`
// and `de/index.html` from the filenames instead — so the sitemap offered three
// URLs that each carried a canonical pointing at a fourth. A crawler resolves
// that eventually and at its own pace; there is no reason to make it.
const SLUGS = Object.fromEntries(
  Object.entries(RAW).map(([key]) => [
    key,
    LANGS.map((l) => CANONICAL[key][l].replace(/^\//, '')),
  ]),
);

const PRIORITY = {
  index: '1.0', quote: '0.9', contact: '0.8', services: '0.8', work: '0.7',
  privacy: '0.3', imprint: '0.3',
};

// -----------------------------------------------------------------------------
// WHY THERE IS NO <lastmod>
//
// There used to be, and it was `new Date()` — every URL stamped with the day the
// build ran. That is not a modification date, it is a build date, and emitting
// it told every crawler that all 60 pages changed simultaneously on every
// deploy, including deploys that changed one CSS file. A signal that is always
// "everything just changed" is indistinguishable from one that is always
// "nothing just changed", and Google's own guidance is that it will ignore a
// lastmod it finds inconsistent — after having been given a reason to distrust
// the rest of the file.
//
// The honest alternatives were: omit it, or derive it from the git history of
// each page's fragment and translation dictionary. The second is a real date
// and is also a build-time git dependency, a shallow-clone failure mode and a
// second thing to keep correct as the source layout moves. `lastmod` is
// optional in the sitemap protocol and is a hint rather than an instruction, so
// omitting it costs a hint we could not give truthfully anyway.
//
// If it is wanted later, the derivation is `git log -1 --format=%cs` over
// `_build/pages/<stem>.html` and `_build/i18n/<stem>.json`, taking the later of
// the two, with the whole block skipped when git is unavailable.
// -----------------------------------------------------------------------------
async function sitemap() {
  const urls = [];

  for (const [key, paths] of Object.entries(SLUGS)) {
    // Only a `full` route is offered to search engines. A case study still
    // gathering its material is reachable, linked and translated — it is just
    // not something to rank as a case study, and the generated page says so
    // itself with `noindex, follow`. A sitemap entry for a noindex URL is a
    // contradiction the crawler has to resolve, so it is not emitted at all.
    // The status comes from _build/build.py, which owns it.
    if ((STATUS[key] ?? 'full') !== 'full') continue;
    paths.forEach((path, i) => {
      // Every URL carries the full hreflang set, including x-default pointing at
      // Hungarian — the same contract the generated <head> already states.
      const alts = paths
        .map((p, j) => `    <xhtml:link rel="alternate" hreflang="${LANGS[j]}" href="${SITE_URL}/${p}"/>`)
        .join('\n');
      urls.push(
        `  <url>\n` +
        `    <loc>${SITE_URL}/${path}</loc>\n` +
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
