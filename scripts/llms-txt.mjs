// =============================================================================
// /llms.txt — the site's own table of contents, addressed to a language model.
//
//   node scripts/llms-txt.mjs
//
// WHY IT EXISTS
// An assistant answering "ki csinál weboldalt Magyarországon" does not crawl
// 81 routes; it fetches one or two documents and answers from those. llms.txt
// (llmstxt.org) is the file it looks for first: a Markdown index at the origin
// root, one line per page, each line saying what that page is. Without it the
// model reads whatever route it happened to land on — which, on this site, is
// as likely to be a blog post about Facebook ads as the services page.
//
// WHY IT IS GENERATED AND NOT WRITTEN
// The same reason the sitemap is. Every line here is a URL plus that page's own
// <title> and <meta name="description">, read back out of dist/ — the artefact
// Netlify publishes. A hand-written copy is a second list of 29 routes that
// goes stale the first time a slug moves, and nothing would fail when it did.
//
// WHY IT READS dist/ AND NOT THE SOURCE TREE
// The three homepage shells are built by Vite in `build:home`; index.html at
// the repo root is a template with no <title> at all. Reading source would
// index the homepage — the most important line in the file — as untitled. So
// this runs after the pages exist, which is why it is its own step rather than
// part of assemble.mjs, where robots.txt and sitemap.xml are written.
//
// HUNGARIAN, WITH THE OTHER TWO NAMED
// One llms.txt per origin, and this origin's x-default is Hungarian. The
// English and German trees are listed as entry points rather than mirrored
// line by line: three copies of 29 descriptions is 87 lines that say the same
// things, and the point of the file is that it is short enough to be read
// whole.
// =============================================================================

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteOrigin, isPreviewOrigin } from './site-origin.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SITE_URL = siteOrigin();

// The order is the reading order: what the company is, then what it sells, then
// the evidence, then the writing. A key not named here is still emitted, under
// Egyéb — a new route should appear in the file on the build that adds it,
// not on the build where somebody remembers to come back here.
const SECTIONS = [
  ['A cég', ['index', 'about', 'services']],
  ['Szolgáltatások', ['sme', 'enterprise', 'branding', 'ads', 'seo', 'shop', 'impact']],
  ['Referenciák', ['work', 'case-rapidkert', 'case-barbershop', 'case-mentaltrening']],
  ['Kapcsolat', ['contact', 'quote']],
  ['Blog', ['blog', 'post-seo', 'post-seo-alap', 'post-arak', 'post-cegprofil',
            'post-hirdetes', 'post-elavult', 'post-konverzio', 'post-marketing',
            'post-logo', 'post-webdesign']],
];

// llms.txt reserves one heading: everything under `## Optional` may be skipped
// by a reader that is short of context. The privacy notice and the imprint are
// exactly that — required to publish, never the answer to a question about what
// the company does.
const OPTIONAL = ['privacy', 'imprint'];

const one = (html, re) => html.match(re)?.[1]?.trim() ?? null;

const decode = (s) =>
  s == null ? null : s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');

/** dist path of a canonical URL path. `/` and `/en/` are directories. */
const fileFor = (path) => {
  const p = path.replace(/^\//, '');
  if (p === '' || p.endsWith('/')) return join(DIST, p, 'index.html');
  return join(DIST, p.endsWith('.html') ? p : `${p}.html`);
};

/** A page's own <title> and description, or null if it was not built. */
async function meta(path) {
  const file = fileFor(path);
  if (!existsSync(file)) return null;
  const html = await readFile(file, 'utf8');
  const title = decode(one(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const desc = decode(one(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i));
  return { title, desc };
}

// The <title> carries the brand for a search result — "Rólunk — A Stratos
// története | Stratos Media". In a list where every line is the same company
// that suffix is noise on all 29 of them, so it comes off here and is stated
// once, in the heading.
const shortTitle = (title) => title.replace(/\s*[|·—–-]\s*Stratos( Media)?\s*$/i, '').trim();

async function main() {
  if (isPreviewOrigin()) {
    // robots.txt on a preview is `Disallow: /`. An llms.txt next to it inviting
    // a model to read the same pages says the opposite thing to the same
    // audience, so the preview simply does not have one.
    console.log('llms: preview origin — skipped (robots.txt disallows everything here).');
    return;
  }

  const manifest = join(ROOT, '_build', 'routes.json');
  if (!existsSync(manifest)) {
    console.error(`llms: missing ${manifest} — run \`npm run generate\` first.`);
    process.exit(1);
  }
  const { canonical: CANONICAL, status: STATUS = {} } = JSON.parse(await readFile(manifest, 'utf8'));

  const placed = new Set([...SECTIONS.flatMap(([, keys]) => keys), ...OPTIONAL]);
  const extra = Object.keys(CANONICAL).filter((k) => !placed.has(k));
  const groups = [...SECTIONS, ...(extra.length ? [['Egyéb', extra]] : []), ['Optional', OPTIONAL]];

  const home = await meta(CANONICAL.index.hu);
  if (!home?.desc) {
    console.error('llms: dist/index.html has no description — run the full build first.');
    process.exit(1);
  }

  const lines = [
    '# Stratos Media',
    '',
    `> ${home.desc}`,
    '',
    'Stratos Media — magyar webstúdió. Weboldal- és webshop-készítés, arculat és',
    'hirdetéskezelés, egyedi fejlesztéssel, egyszeri díjas és havidíjas',
    'konstrukcióban. A teljes oldal három nyelven él: magyarul, angolul és',
    'németül; a magyar az elsődleges (x-default).',
    '',
  ];

  let count = 0;
  for (const [heading, keys] of groups) {
    const rows = [];
    for (const key of keys) {
      const path = CANONICAL[key]?.hu;
      if (!path) continue;
      // A case study still gathering its material is `noindex, follow` and is
      // kept out of the sitemap for that reason. The same reason applies here.
      if ((STATUS[key] ?? 'full') !== 'full') continue;
      const m = await meta(path);
      if (!m?.title) continue;
      const url = `${SITE_URL}${path}`;
      rows.push(`- [${shortTitle(m.title)}](${url})${m.desc ? `: ${m.desc}` : ''}`);
    }
    if (!rows.length) continue;
    count += rows.length;
    lines.push(`## ${heading}`, '', ...rows, '');
  }

  lines.push(
    '## Más nyelvek',
    '',
    `- [English](${SITE_URL}${CANONICAL.index.en}): the same site in English.`,
    `- [Deutsch](${SITE_URL}${CANONICAL.index.de}): dieselbe Website auf Deutsch.`,
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  );

  await writeFile(join(DIST, 'llms.txt'), lines.join('\n'), 'utf8');
  console.log(`llms: dist/llms.txt — ${count} routes`);
}

main().catch((err) => {
  console.error('llms failed:', err);
  process.exit(1);
});
