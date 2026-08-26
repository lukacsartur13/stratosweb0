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
const OWNERSHIP = [
  { term: 'weboldal készítés', owner: 'szolgaltatasok.html',
    qualifiers: ['havidíjas', 'keresőoptimalizált', 'céges', 'egyedi', 'professzionális', 'ingyenes'] },
  { term: 'keresőoptimalizált weboldal készítés', owner: 'szolgaltatasok.html',
    qualifiers: [], h3: true },
  { term: 'weboldal fejlesztés', owner: 'nagyvallalat.html',
    qualifiers: ['céges', 'egyedi', 'vállalati'] },
  { term: 'keresőoptimalizálás', owner: 'keresooptimalizalas.html',
    qualifiers: ['helyi', 'webáruház', 'mi az a'] },
  { term: 'logó tervezés', owner: 'branding.html', qualifiers: [] },
];

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

const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

async function readPage(file) {
  const html = await readFile(join(DIST, file), 'utf8');
  const title = strip(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
  const heads = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)].map((m) => strip(m[1]));
  const subheads = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => strip(m[1]));
  return { file, title, heads, subheads };
}

/** The headings a term is judged on: h1/h2, plus h3 when the term asks for it. */
const scope = (page, term) => (term.h3 ? [...page.heads, ...page.subheads] : page.heads);

/** Does `text` contain `term` with no qualifier immediately before it? */
function claims(text, term, qualifiers) {
  let i = text.indexOf(term);
  while (i !== -1) {
    const before = text.slice(0, i).trimEnd();
    if (!qualifiers.some((q) => before.endsWith(q))) return true;
    i = text.indexOf(term, i + 1);
  }
  return false;
}

const manifest = JSON.parse(await readFile(join(ROOT, '_build', 'routes.json'), 'utf8'));
const huFiles = Object.values(manifest.slugs).map((s) => s.hu).filter((f) => f !== 'index.html');
const pages = await Promise.all(huFiles.map(readPage));

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
  const aQuestion = a.title.includes('?') && INTERROGATIVE.test(a.title);
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
  const q = a && a.title.includes('?') && INTERROGATIVE.test(a.title);
  console.log(`  ${q ? 'ok  ' : 'FAIL'}  /${article.replace(/\.html$/, '')} reads as ${q ? 'informational' : 'COMMERCIAL'}`);
}

if (home) {
  const alsoHome = OWNERSHIP
    .filter((e) => claims(home.title, e.term, e.qualifiers)
      || scope(home, e).some((h) => claims(h, e.term, e.qualifiers)))
    .map((o) => o.term);
  if (alsoHome.length) {
    console.log(`\nseo-ownership: the homepage also claims ${alsoHome.map((t) => `"${t}"`).join(', ')}`);
    console.log('  Not a failure — see 05-hu-implemented.md section E. Homepage and');
    console.log('  category hub co-ranking is expected; the homepage is Vite-built and');
    console.log('  outside the routes this guard governs.');
  }
}

if (failures.length) {
  console.error(`\nseo-ownership: ${failures.length} collision(s)\n`);
  for (const f of failures) console.error(`  ${f}`);
  if (CHECK) process.exit(1);
} else {
  console.log('\nseo-ownership: no collisions');
}
