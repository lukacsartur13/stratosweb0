// =============================================================================
// Hungarian keyword-ownership regression guard.
//
//   node scripts/seo-ownership.mjs            # print the ownership table
//   node scripts/seo-ownership.mjs --check    # exit 1 if a collision returned
//
// Reads dist/ — what Netlify publishes — and asks one narrow question that the
// technical SEO audit deliberately does not: for each commercial head term,
// how many Hungarian pages CLAIM it, and is the claimant the page that is
// supposed to own it?
//
// WHY THIS EXISTS
// Before the ownership pass, /szolgaltatasok, /kkv and /nagyvallalat all opened
// their <title> with the same three words — `Weboldal készítés` — so Google had
// to pick between three Stratos pages for the site's most valuable commercial
// query. Nothing in the build could see that. Every existing check passed: the
// canonicals were self-referential, the hreflang sets were reciprocal, the
// titles were unique strings. Three pages competing for one query is invisible
// to every rule that looks at one page at a time.
//
// WHAT IT DOES NOT DO
// It does not judge copy, count keywords, or score anything. It matches literal
// strings in <title>, <h1> and <h2>, because a deterministic check that fails
// honestly is worth more here than a clever one that needs interpretation.
//
// A term is CLAIMED by a page when it appears in the title or an h1/h2 without
// a qualifier in front of it. `Havidíjas weboldal készítés` is not a claim on
// `weboldal készítés` — the qualifier is the whole point of the distinction the
// ownership pass drew, so the check has to understand it or it would forbid the
// arrangement it is meant to protect.
// =============================================================================

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const CHECK = process.argv.includes('--check');

// term -> the ONE Hungarian route allowed to claim it, plus the qualifiers that
// turn a mention into a different, non-competing term.
//
// `h3: true` widens the scan for one term from <title>/h1/h2 down to h3. Only
// `keresőoptimalizált weboldal készítés` sets it, because that phrase moved
// between two pages and the h3 is where it could quietly move back — /kkv held
// it in an h2 AND an h3, so a guard that stopped at h2 would have called the
// transfer done while half of it was still in place. The other terms stay at
// h2: several pages legitimately carry them in an h3 (`Weboldal készítés árak`
// on /kkv, `Keresőoptimalizálás` on /szolgaltatasok), and those are section
// labels inside a page about something else, not claims on the query.
//
// 2026-10-23, the owner's copy pack redrew the map: „weboldal készítés” belongs
// to the HOMEPAGE now („a »weboldal készítés« a főoldalé”), /szolgaltatasok is
// a collection page with no head term of its own, and /nagyvallalat moved from
// „weboldal fejlesztés” to „vállalati weboldal” with the ipari/B2B rewrite.
const OWNERSHIP = [
  { term: 'weboldal készítés', owner: 'index.html',
    qualifiers: ['havidíjas', 'keresőoptimalizált', 'céges', 'egyedi', 'professzionális', 'ingyenes'] },
  // Moved to its own page on 2026-10-07 (it had no impressions as an h3 on
  // /szolgaltatasok).
  { term: 'keresőoptimalizált weboldal készítés', owner: 'keresooptimalizalt-weboldal-keszites.html',
    qualifiers: [], h3: true },
  { term: 'vállalati weboldal', owner: 'nagyvallalat.html', qualifiers: [] },
  { term: 'keresőoptimalizálás', owner: 'keresooptimalizalas.html',
    qualifiers: ['helyi', 'webáruház', 'mi az a'] },
  { term: 'logó tervezés', owner: 'branding.html', qualifiers: [] },
  // The local landing pages (2026-10-06, HU_ONLY in _build/build.py). A head
  // term followed by a place is a different query with its own owner — see
  // PLACES below.
  { term: 'weboldal készítés győr', owner: 'weboldal-keszites-gyor.html', qualifiers: [] },
  { term: 'weboldal készítés budapest', owner: 'weboldal-keszites-budapest.html', qualifiers: [] },
  { term: 'weboldal készítés pest megye', owner: 'weboldal-keszites-pest-megye.html', qualifiers: [] },
  { term: 'weboldal készítés szeged', owner: 'weboldal-keszites-szeged.html', qualifiers: [] },
];

// A term immediately followed by one of these is the LOCAL query, not the head
// term: "weboldal készítés budapesten" is the Budapest page's claim, not a
// second claim on "weboldal készítés". Without it every local page would read
// as a collision with the service page that owns the national term.
// Stems, not words: "megyében" is megy-é-ben, so "pest megye" is not its prefix.
// „országosan” is the hub's own modifier (/hol-dolgozunk, „weboldal készítés
// országosan”): the nationwide query, a sibling of the regional ones.
const PLACES = ['győr', 'budapest', 'pest megy', 'pest vármegy', 'szeged', 'csongrád', 'országos'];

// A service page and the article about the same subject must not both read as
// commercial landing pages. The article's title has to be a question — that is
// the signal that separates `Keresőoptimalizálás (SEO)` from `Mi az a
// keresőoptimalizálás, és mennyibe kerül?`, and it is the one the ownership
// pass actually used.
const INTENT_PAIRS = [
  { service: 'keresooptimalizalas.html', article: 'blog-keresooptimalizalas.html', subject: 'keresőoptimalizálás' },
  { service: 'branding.html', article: 'blog-logo-keszites.html', subject: 'logó' },
];

const INTERROGATIVE = /^(mi|mit|mire|miért|mennyi|mennyibe|hogyan|mikor|hol|melyik|milyen|mennyit)\b/;

// A question either opens the title or follows its topic and a colon: „Logó
// készítés: mit kérj, mit ne?” reads as a question as plainly as „Mire figyelj
// logó készítésnél?”, and it is the form the copy pack gives its articles.
const readsAsQuestion = (title) => title.includes('?')
  && (INTERROGATIVE.test(title) || INTERROGATIVE.test(title.split(':').slice(1).join(':').trim()));

// Collection pages are listed, not failed, exactly like the homepage below: the
// blog index names the topics it collects („Blog: weboldal és
// keresőoptimalizálás”), which is a table of contents, not a landing page.
const HUBS = ['blog.html'];

const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

async function readPage(file) {
  const html = await readFile(join(DIST, file), 'utf8');
  const title = strip(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
  const heads = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)].map((m) => strip(m[1]));
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => strip(m[1]));
  const subheads = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => strip(m[1]));
  return { file, title, heads, h1s, subheads };
}

/** The headings a term is judged on: h1/h2, plus h3 when the term asks for it.
 *  An article that already reads as a question (an INTENT_PAIRS article) is
 *  judged on its h1 alone: its h2s are the chapters of an answer — „Kereső-
 *  optimalizálás az AI-keresők korában” — not a second landing page. */
const scope = (page, term) => (page.informational ? page.h1s
  : term.h3 ? [...page.heads, ...page.subheads] : page.heads);

/** Does `text` contain `term` with no qualifier immediately before it? */
function claims(text, term, qualifiers) {
  let i = text.indexOf(term);
  while (i !== -1) {
    const before = text.slice(0, i).trimEnd();
    const after = text.slice(i + term.length).trimStart();
    const local = !PLACES.some((p) => term.endsWith(p)) && PLACES.some((p) => after.startsWith(p));
    if (!qualifiers.some((q) => before.endsWith(q)) && !local) return true;
    i = text.indexOf(term, i + 1);
  }
  return false;
}

const manifest = JSON.parse(await readFile(join(ROOT, '_build', 'routes.json'), 'utf8'));
const huFiles = Object.values(manifest.slugs).map((s) => s.hu).filter((f) => f !== 'index.html');
const pages = (await Promise.all(huFiles.map(readPage))).filter((p) => !HUBS.includes(p.file));
for (const { article } of INTENT_PAIRS) {
  const a = pages.find((p) => p.file === article);
  if (a && readsAsQuestion(a.title)) a.informational = true;
}

// The homepage is scanned but never fails a term, and that exemption is stated
// out loud rather than left as a silent filter. It is built by Vite, not by
// _build/build.py, so it is not one of the routes this guard governs — and a
// homepage ranking for the category term alongside the category hub is the
// normal arrangement, not a collision. It is printed so the exemption is
// visible to whoever reads the output; see 05-hu-implemented.md section E.
const home = await readPage('index.html').catch(() => null);

const failures = [];
const table = [];

for (const entry of OWNERSHIP) {
  const { term, owner, qualifiers } = entry;
  const claimants = pages.filter(
    (p) => claims(p.title, term, qualifiers)
      || scope(p, entry).some((h) => claims(h, term, qualifiers)));
  const names = claimants.map((p) => '/' + p.file.replace(/\.html$/, ''));

  if (owner === 'index.html') {
    const homeClaims = Boolean(home) && (claims(home.title, term, qualifiers)
      || scope(home, entry).some((h) => claims(h, term, qualifiers)));
    table.push({ term, owner: '/', claimants: [...(homeClaims ? ['/'] : []), ...names] });
    if (!homeClaims) failures.push(`"${term}" — the homepage owns it, but its title and headings no longer claim it`);
    if (claimants.length) failures.push(`"${term}" — the homepage owns it, but ${names.join(', ')} claim(s) it too`);
    continue;
  }
  table.push({ term, owner: '/' + owner.replace(/\.html$/, ''), claimants: names });

  if (claimants.length === 0) {
    failures.push(`"${term}" — no page claims it; expected /${owner.replace(/\.html$/, '')}`);
  } else if (claimants.length > 1) {
    failures.push(`"${term}" — claimed by ${claimants.length} pages: ${names.join(', ')}. `
      + `Exactly one page may claim a commercial head term.`);
  } else if (claimants[0].file !== owner) {
    failures.push(`"${term}" — claimed by ${names[0]}, but the owner is /${owner.replace(/\.html$/, '')}`);
  }
}

for (const { service, article, subject } of INTENT_PAIRS) {
  const s = pages.find((p) => p.file === service);
  const a = pages.find((p) => p.file === article);
  if (!s || !a) { failures.push(`intent pair ${service} / ${article} — page missing`); continue; }
  const aQuestion = readsAsQuestion(a.title);
  if (!aQuestion) {
    failures.push(`/${article.replace(/\.html$/, '')} — the article about "${subject}" no longer reads as a `
      + `question, so it presents as a second commercial landing page alongside /${service.replace(/\.html$/, '')}. `
      + `Title: "${a.title}"`);
  }
  if (s.title.includes('?')) {
    failures.push(`/${service.replace(/\.html$/, '')} — the service page's title is a question, which reads as `
      + `informational. Title: "${s.title}"`);
  }
}

console.log('seo-ownership: Hungarian commercial head terms\n');
for (const r of table) {
  const ok = r.claimants.length === 1 && r.claimants[0] === r.owner;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${r.term.padEnd(36)} -> ${r.claimants.join(', ') || '(nobody)'}`);
}
console.log('\nseo-ownership: service/article intent separation\n');
for (const { service, article } of INTENT_PAIRS) {
  const a = pages.find((p) => p.file === article);
  const q = a && readsAsQuestion(a.title);
  console.log(`  ${q ? 'ok  ' : 'FAIL'}  /${article.replace(/\.html$/, '')} reads as ${q ? 'informational' : 'COMMERCIAL'}`);
}

if (home) {
  const alsoHome = OWNERSHIP
    .filter((e) => e.owner !== 'index.html')
    .filter((e) => claims(home.title, e.term, e.qualifiers)
      || scope(home, e).some((h) => claims(h, e.term, e.qualifiers)))
    .map((o) => o.term);
  if (alsoHome.length) {
    console.log(`\nseo-ownership: the homepage also claims ${alsoHome.map((t) => `"${t}"`).join(', ')}`);
    console.log('  Not a failure — see 05-hu-implemented.md section E. Homepage and');
    console.log('  category hub co-ranking is expected, and the homepage is outside the');
    console.log('  routes this guard governs.');
  }
}

const hubs = await Promise.all(HUBS.map(readPage));
for (const hub of hubs) {
  const also = OWNERSHIP.filter((e) => claims(hub.title, e.term, e.qualifiers)
    || scope(hub, e).some((h) => claims(h, e.term, e.qualifiers))).map((o) => o.term);
  if (also.length) {
    console.log(`\nseo-ownership: the collection page /${hub.file.replace(/\.html$/, '')} names ${also.map((t) => `"${t}"`).join(', ')}`);
    console.log('  Not a failure — a hub lists the topics it collects (HUBS above).');
  }
}

if (failures.length) {
  console.error(`\nseo-ownership: ${failures.length} collision(s)\n`);
  for (const f of failures) console.error(`  ${f}`);
  if (CHECK) process.exit(1);
} else {
  console.log('\nseo-ownership: no collisions');
}
