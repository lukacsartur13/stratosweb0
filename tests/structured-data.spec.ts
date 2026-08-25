// =============================================================================
// Phase 9, Workstream G — structured data.
//
// JSON-LD is a set of machine-readable claims published under our name to
// parties who cannot check them. This file is the check.
//
// It reads the BUILT output, every public page of it, rather than the
// generator: what ships is what search engines read, and a generator that is
// correct but wired up wrong ships nothing at all — which is a failure mode
// with no symptom on the page.
//
// The assertions are deliberately shaped as "this must NOT be claimed" wherever
// possible. `Organization.name` being right is worth one test; `aggregateRating`
// being absent is worth more, because that is the one that turns into a
// manual action rather than into a missing rich result.
// =============================================================================
import { test, expect } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const LD_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

type Node = Record<string, any>;
type Doc = { file: string; graph: Node[]; html: string };

/** iCloud writes "thing 2.html" next to "thing.html"; assemble.mjs skips them. */
const isDuplicate = (name: string) => / \d+$/.test(name.replace(/\.[^.]+$/, ''));

/** Every public HTML page in dist/, excluding the private portal. */
async function publicPages(): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (isDuplicate(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        // `experiments` is the one worth naming. dist/experiments/ is the
        // fixed benchmark baseline: noindex, absent from the sitemap and from
        // every internal link, and DELETED by `npm run build` — only
        // `npm run build:full` creates it. Walking it made this suite pass
        // after a plain build and fail after `validate:full`, on identical
        // source, purely because of which script ran last. A suite whose
        // answer depends on the order of the commands before it is not a
        // suite. Asserted separately below, as an exclusion rather than an
        // oversight.
        if (['portal', 'assets', 'experiments'].includes(entry.name)) continue;
        await walk(path);
      } else if (entry.name.endsWith('.html') && entry.name !== '404.html') {
        // A 404 carries no structured data on purpose — see the note in
        // _build/build.py. It is asserted to carry none, below, rather than
        // quietly skipped here.
        out.push(path);
      }
    }
  }
  await walk(DIST);
  return out.sort();
}

let docs: Doc[] = [];

test.beforeAll(async () => {
  docs = [];
  for (const file of await publicPages()) {
    const html = await readFile(file, 'utf8');
    const graph: Node[] = [];
    for (const match of html.matchAll(LD_RE)) {
      // `</` is escaped on the way out so the HTML parser cannot end the
      // element early; undo that before parsing, and fail loudly if the
      // result is not JSON.
      const raw = match[1].split('<\\/').join('</');
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        throw new Error(`${relative(ROOT, file)}: JSON-LD does not parse — ${error}`);
      }
      graph.push(...(parsed['@graph'] ?? [parsed]));
    }
    docs.push({ file: relative(ROOT, file), graph, html });
  }
});

const nodesOfType = (doc: Doc, type: string) =>
  doc.graph.filter((n) => n['@type'] === type);

/** Every string value anywhere in the graph, for the "must not appear" checks. */
function strings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((v) => strings(v, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((v) => strings(v, out));
  return out;
}

test('a 404 publishes no structured data at all', async () => {
  for (const path of ['404.html', 'en/404.html', 'de/404.html']) {
    const html = await readFile(join(DIST, path), 'utf8');
    // Every schema.org node is a statement about a page, and there is no page.
    expect([...html.matchAll(LD_RE)], `${path}`).toHaveLength(0);
    expect(html, `${path} canonical`).not.toContain('rel="canonical"');
    // The <link rel="alternate"> set, not the `hreflang` attribute — the
    // language switcher in the chrome carries that on visible <a> links, and
    // it is a hint to the visitor rather than a claim to a crawler.
    expect(html, `${path} alternates`).not.toContain('rel="alternate"');
    expect(html, `${path} open graph`).not.toContain('property="og:');
  }
});

test('the experiment route is excluded on purpose, and is noindex', async () => {
  // The exclusion above is only defensible if the thing excluded really is
  // outside the public site. Asserted here rather than trusted, and skipped
  // when the route is absent — `npm run build` deletes it, so its absence is
  // the normal state and is not a failure.
  const path = join(DIST, 'experiments', 'stratos-ascent-full', 'index.html');
  let html: string;
  try {
    html = await readFile(path, 'utf8');
  } catch {
    test.skip(true, 'dist/experiments is absent — only `npm run build:full` creates it');
    return;
  }
  expect(html, 'the experiment route must be noindex').toMatch(/name="robots"[^>]*noindex/);

  // And it must not have leaked into anything that offers pages to a crawler.
  const sitemap = await readFile(join(DIST, 'sitemap.xml'), 'utf8');
  expect(sitemap).not.toContain('/experiments/');
});

test('every public page carries exactly one parseable JSON-LD block', () => {
  expect(docs.length).toBeGreaterThan(60);
  for (const doc of docs) {
    const blocks = [...doc.html.matchAll(LD_RE)];
    expect(blocks, `${doc.file} must carry exactly one JSON-LD block`).toHaveLength(1);
    // beforeAll already threw on anything unparseable; this asserts the graph
    // is non-trivial rather than an empty array that parsed fine.
    expect(doc.graph.length, `${doc.file} graph`).toBeGreaterThanOrEqual(3);
  }
});

test('every URL in the graph is absolute, https, and on the site origin', () => {
  for (const doc of docs) {
    for (const value of strings(doc.graph)) {
      if (!/^(https?:)?\/\//i.test(value)) continue;
      expect(value, `${doc.file}: ${value}`).toMatch(/^https:\/\//);
    }
    // Every @id and url that belongs to us — social profiles are the only
    // off-origin URLs, and they are checked separately below.
    for (const node of doc.graph) {
      for (const key of ['@id', 'url', 'mainEntityOfPage']) {
        const value = typeof node[key] === 'string' ? node[key] : node[key]?.['@id'];
        if (typeof value !== 'string' || !value.startsWith('http')) continue;
        expect(value, `${doc.file}: ${key}`).toMatch(/^https:\/\/[^/]+\//);
      }
    }
  }
});

test('no Wix and no localhost origin is ever published', () => {
  const forbidden = [
    /^https?:\/\/([^/]*\.)?media-stratos\.com/i,  // the Wix site every canonical used to point at
    /wixsite|wixstatic|wix\.com/i,
    /localhost|127\.0\.0\.1|0\.0\.0\.0|\.local\b/i,
    /^http:\/\//i,
  ];
  for (const doc of docs) {
    for (const value of strings(doc.graph)) {
      if (!/^https?:\/\//i.test(value)) continue;
      for (const pattern of forbidden) {
        expect(pattern.test(value), `${doc.file} publishes ${value}`).toBe(false);
      }
    }
  }
});

/**
 * The organisation node of a document, found by identity rather than by type.
 *
 * It used to be `n['@type'] === 'Organization'`, which is a narrower claim than
 * these tests mean to make: the site now publishes it as `ProfessionalService`,
 * a subtype of LocalBusiness and therefore of Organization, so an exact-match
 * lookup silently found nothing and four assertions failed on a graph that was
 * correct. `@id` is the thing that never changes when the subtype does.
 */
const organisation = (doc: Doc) =>
  doc.graph.find((n) => typeof n['@id'] === 'string' && /#organization$/.test(n['@id']))!;

test('every own-site URL is on the one origin this build resolved', async () => {
  // Not a hardcoded hostname. Pre-cutover the site is legitimately served from
  // stratosweb1.netlify.app, and a test that banned that would fail on the only
  // deploy that currently exists — while a test that hardcoded stratosweb.hu
  // would pass on a build whose pages said something else entirely. What has to
  // hold in every environment is that the JSON-LD, the canonical and the
  // resolver all name the SAME origin, whatever it is.
  const { siteOrigin } = await import('../scripts/site-origin.mjs');
  const origin: string = siteOrigin();
  expect(origin).toMatch(/^https:\/\/[^/]+$/);

  const offSite = new Set(
    (organisation(docs[0]).sameAs as string[]),
  );

  for (const doc of docs) {
    for (const value of strings(doc.graph)) {
      if (!/^https?:\/\//i.test(value) || offSite.has(value)) continue;
      expect(value.startsWith(`${origin}/`), `${doc.file}: ${value} is not on ${origin}`).toBe(true);
    }
  }
});

test('the page node self-references the page it is on', () => {
  for (const doc of docs) {
    const page = doc.graph.find((n) => String(n['@id'] ?? '').endsWith('#webpage'));
    expect(page, `${doc.file} has a page node`).toBeTruthy();

    // The canonical the page states in <head> is the URL the graph must claim.
    const canonical = doc.html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    expect(canonical, `${doc.file} has a canonical`).toBeTruthy();
    expect(page!.url, `${doc.file} page url`).toBe(canonical);
    expect(page!['@id'], `${doc.file} page @id`).toBe(`${canonical}#webpage`);
  }
});

test('the page name and description are the ones the page shows', () => {
  const decode = (s: string) =>
    s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

  for (const doc of docs) {
    const page = doc.graph.find((n) => String(n['@id'] ?? '').endsWith('#webpage'))!;
    const title = decode(doc.html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? '');
    const desc = decode(doc.html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '');
    expect(page.name, `${doc.file} name`).toBe(title);
    expect(page.description, `${doc.file} description`).toBe(desc);
  }
});

test('organisation identity is one entity, identical on every page', () => {
  const seen = new Map<string, string>();
  for (const doc of docs) {
    const orgs = doc.graph.filter(
      (n) => typeof n['@id'] === 'string' && /#organization$/.test(n['@id']),
    );
    expect(orgs, `${doc.file} declares one organisation`).toHaveLength(1);
    const org = orgs[0];
    expect(org['@id']).toMatch(/#organization$/);
    expect(org.name).toBe('Stratos');

    const fingerprint = JSON.stringify(org);
    const [firstFile, first] = [...seen.entries()][0] ?? [];
    if (first === undefined) seen.set(doc.file, fingerprint);
    else expect(fingerprint, `${doc.file} differs from ${firstFile}`).toBe(first);
  }
});

test('no duplicate @id inside a page, and no conflicting entity across pages', () => {
  // Same @id, two different bodies, is the failure that makes a knowledge graph
  // silently pick one. It is worth catching site-wide, not only per page.
  const byId = new Map<string, { file: string; body: string }>();
  for (const doc of docs) {
    const local = new Set<string>();
    for (const node of doc.graph) {
      const id = node['@id'];
      if (!id) continue;
      expect(local.has(id), `${doc.file} repeats @id ${id}`).toBe(false);
      local.add(id);

      // Cross-page: only the two site-wide entities are expected to recur.
      if (!/#(organization|website)$/.test(id)) continue;
      const body = JSON.stringify(node);
      const prior = byId.get(id);
      if (!prior) byId.set(id, { file: doc.file, body });
      else expect(body, `${id} differs between ${prior.file} and ${doc.file}`).toBe(prior.body);
    }
  }
});

test('nothing claims a rating, a review, a price or an award', () => {
  const forbidden = [
    'aggregateRating', 'review', 'reviewRating', 'ratingValue', 'reviewCount',
    'offers', 'price', 'priceRange', 'priceSpecification',
    'award', 'awards', 'numberOfEmployees', 'foundingDate', 'founder',
    'geo', 'openingHours', 'openingHoursSpecification',
    'taxID', 'vatID', 'legalName', 'duns', 'leiCode', 'naics', 'isicV4',
    'employee', 'member', 'potentialAction',
  ];
  // `address` and `areaServed` came OFF this list, and the distinction is the
  // point of the test rather than an exception to it. Everything above is a
  // claim no page of this site makes: there is no rating, no price, no award,
  // no headcount. The seat IS published — /impresszum.html states it because a
  // Hungarian sole trader is required to — and "Győr és Budapest" is in the
  // footer of all 69 routes. Marking up a fact the site already states is what
  // structured data is for; `geo`, `openingHours` and `priceRange` stay
  // forbidden because those the site genuinely does not publish anywhere.
  for (const doc of docs) {
    const serialised = JSON.stringify(doc.graph);
    for (const key of forbidden) {
      expect(serialised.includes(`"${key}"`), `${doc.file} claims ${key}`).toBe(false);
    }
  }
});

test('an article carries no invented publication date', () => {
  // The six blog fragments carry no date in their front matter. A date here
  // could only have been produced by the build clock or by the git history,
  // and both would be a fabricated fact about when something was written.
  for (const doc of docs) {
    for (const article of nodesOfType(doc, 'Article')) {
      expect(article, `${doc.file}`).not.toHaveProperty('datePublished');
      expect(article, `${doc.file}`).not.toHaveProperty('dateModified');
      expect(article.headline, `${doc.file} headline`).toBeTruthy();
      expect(article.image, `${doc.file} image`).toMatch(/^https:\/\//);
      expect(article.inLanguage, `${doc.file} inLanguage`).toMatch(/^(hu|en|de)-/);
      expect(article.author['@id'], `${doc.file} author`).toMatch(/#organization$/);
      expect(article.publisher['@id'], `${doc.file} publisher`).toMatch(/#organization$/);
    }
  }
  const articles = docs.filter((d) => nodesOfType(d, 'Article').length).length;
  expect(articles, 'six posts in three languages').toBe(18);
});

test('a draft or summary case study is never presented as a full case study', async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, '_build', 'routes.json'), 'utf8'));
  const notFull = Object.entries(manifest.status as Record<string, string>)
    .filter(([, status]) => status !== 'full')
    .map(([key]) => key);
  expect(notFull.length, 'the phase 9 baseline records three').toBeGreaterThan(0);

  const paths = new Set(
    notFull.flatMap((key) =>
      (manifest.langs as string[]).map((l: string) =>
        l === 'hu' ? manifest.slugs[key][l] : `${l}/${manifest.slugs[key][l]}`)),
  );

  let checked = 0;
  for (const doc of docs) {
    const route = doc.file.replace(/^dist\//, '');
    if (!paths.has(route)) continue;
    checked += 1;
    // It gets a WebPage and a breadcrumb, and nothing that reads as an
    // editorially complete work.
    for (const type of ['Article', 'CreativeWork', 'Report', 'CaseStudy', 'NewsArticle']) {
      expect(nodesOfType(doc, type), `${doc.file} declares ${type}`).toHaveLength(0);
    }
    // And it is noindex, which is the other half of the same statement.
    expect(doc.html, `${doc.file} robots`).toContain('name="robots" content="noindex, follow"');
  }
  expect(checked, 'every non-full case study was checked').toBe(paths.size);
});

test('a Service node describes a service and offers no price', () => {
  let services = 0;
  for (const doc of docs) {
    for (const service of nodesOfType(doc, 'Service')) {
      services += 1;
      expect(service.name, `${doc.file}`).toBeTruthy();
      expect(service.provider['@id'], `${doc.file}`).toMatch(/#organization$/);
      expect(service, `${doc.file}`).not.toHaveProperty('offers');
    }
  }
  expect(services, 'five service pages in three languages').toBe(15);
});

test('sameAs lists only profiles the site itself links to', () => {
  const org = organisation(docs[0]);
  for (const profile of org.sameAs as string[]) {
    expect(profile).toMatch(/^https:\/\//);
    // The footer of every page links it, which is what makes it a supported
    // claim rather than an assertion about accounts we hope exist.
    expect(docs[0].html, `footer must link ${profile}`).toContain(profile);
  }
});

test('the breadcrumb trail matches the one the page renders', () => {
  let withTrail = 0;
  for (const doc of docs) {
    const lists = nodesOfType(doc, 'BreadcrumbList');
    const rendered = doc.html.match(/<p class="crumbs">([\s\S]*?)<\/p>/)?.[1];
    if (!rendered) {
      expect(lists, `${doc.file} renders no trail`).toHaveLength(0);
      continue;
    }
    expect(lists, `${doc.file} renders a trail`).toHaveLength(1);
    withTrail += 1;

    const visible = rendered
      .replace(/<[^>]+>/g, '')
      .split('/')
      .map((s) => s.replace(/&amp;/g, '&').trim())
      .filter(Boolean);
    const claimed = (lists[0].itemListElement as Node[]).map((i) => i.name);
    expect(claimed, `${doc.file} trail`).toEqual(visible);

    (lists[0].itemListElement as Node[]).forEach((item, i) => {
      expect(item.position, `${doc.file} position`).toBe(i + 1);
      expect(item.item, `${doc.file} item`).toMatch(/^https:\/\//);
    });
  }
  expect(withTrail, 'the questionnaire is the only route with no trail').toBe(69);
});
