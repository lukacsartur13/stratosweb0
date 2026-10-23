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
// dist/ is what Netlify publishes, and the titles and descriptions there are
// the ones after translation and after every build step. So this runs after
// the pages exist, which is why it is its own step rather than part of
// assemble.mjs, where robots.txt and sitemap.xml are written.
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
//
// 2026-10-23 (the owner's copy pack): the two main offers first, the local
// pages under their own heading, the Impact Program apart from the services
// it is not.
const SECTIONS = [
  ['Fő ajánlatok', ['configurator', 'seo']],
  ['A cég', ['index', 'about', 'services']],
  ['Szolgáltatások', ['sme', 'enterprise', 'shop', 'seo-web', 'ads', 'branding']],
  ['Referenciák', ['work', 'case-rapidkert', 'case-godatafusion', 'case-barbershop', 'case-mentaltrening', 'case-honeygarden', 'case-o2']],
  ['Hol dolgozunk', ['local-hub', 'local-gyor', 'local-budapest', 'local-pest', 'local-szeged']],
  ['Kapcsolat', ['contact', 'quote', 'booking']],
  ['Blog', ['blog', 'post-arak', 'post-seo', 'post-seo-alap', 'post-cegprofil',
            'post-hirdetes', 'post-elavult', 'post-konverzio', 'post-marketing',
            'post-logo', 'post-webdesign']],
  ['Egyéb', ['impact']],
];

// The facts a model is asked about most, stated once and in the words the
// pages use. Every line is a claim the site itself makes; none is new here.
const FACTS = [
  'Alapadatok:',
  '- Márkanév: Stratos Webdesign. Üzemeltető: Lukács Artúr e.v. Weboldal: https://stratosweb.hu. E-mail: hello@stratosweb.hu. Telefon: +36 30 584 8024.',
  '- Földrajz: az egész ország, online. Irodai ügyfélfogadás nincs; ha a projekt indokolja, személyesen kimegyünk az ügyfélhez.',
  '- Nyelvek: magyar, angol, német.',
  '- Díjmodell: a weboldal egyszeri projektdíjas, és az ügyfélé. A keresőoptimalizálás és a karbantartás havidíjas partnerségként választható. Árlista nincs, minden ajánlat egyedi.',
  '- Folyamat: ingyenes igényfelmérő hívás, egyedi írásos ajánlat, az előleg után indul a munka, tervezés három kör módosítással, fejlesztés, átadás. Határidő-garancia, ha minden anyag időben megérkezik az ügyféltől. Ajánlatkérésre munkanapokon 24 órán belül válaszolunk.',
  '- Technológia: minden új weboldal egyedi kódból készül, sablon és oldalépítő nélkül. Webshopnál a platformról felmérés után döntünk.',
  '- Keresőoptimalizálás: helyezést nem garantálunk. Az eredmény általában 3–6 hónap alatt kezd látszani.',
];

// Named with the owner's permission (DONTESEK 2), whether or not their case
// study is indexed yet.
const CLIENTS = 'Rapidkert, GoDataFusion, MindForge, Barbershop Győr, HoneyGarden, O2 Tanácsadó, '
  + 'Kontyos Borház, GranTOOL, ICOOL, Synergy Digital Hungary, Duna Hajók, Duna Enterior, RS Oil, Reverb Content';

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

// The <title> carries the brand for a search result — "Rólunk: kis csapat,
// nagy felelősség | Stratos Webdesign". In a list where every line is the same
// company that suffix is noise on every one of them, so it comes off here and
// is stated once, in the heading.
const shortTitle = (title) => title.replace(/\s*[|·—–-]\s*Stratos( Media| Webdesign)?\s*$/i, '').trim();

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
  const groups = [...SECTIONS.map(([h, keys]) => [h, h === 'Egyéb' ? [...keys, ...extra] : keys]),
    ...(extra.length && !SECTIONS.some(([h]) => h === 'Egyéb') ? [['Egyéb', extra]] : []),
    ['Optional', OPTIONAL]];

  const home = await meta(CANONICAL.index.hu);
  if (!home?.desc) {
    console.error('llms: dist/index.html has no description — run the full build first.');
    process.exit(1);
  }

  const lines = [
    '# Stratos Webdesign',
    '',
    '> Magyar webdesign-ügynökség: egyedi kódból épített weboldalak, 3D weboldalak és termékkonfigurátorok, havidíjas keresőoptimalizálás (SEO) és hirdetéskezelés egy kézben, az egész országban.',
    '',
    'A Stratos Webdesign magyar webdesign-ügynökség. Egyedi kódból épített weboldalakat, 3D weboldalakat és termékkonfigurátorokat, webshopokat és arculatot készít, és havidíjas keresőoptimalizálással, Google- és Meta-hirdetéskezeléssel viszi tovább őket. Az egész országban dolgozik, online. Ha a projekt indokolja, személyesen is kimegy az ügyfélhez. Magyarul, angolul és németül dolgozik. A teljes oldal három nyelven él; a magyar az elsődleges (x-default).',
    '',
    ...FACTS,
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
    if (heading === 'Referenciák') rows.push(`- Ügyfeleink közül: ${CLIENTS}.`);
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
