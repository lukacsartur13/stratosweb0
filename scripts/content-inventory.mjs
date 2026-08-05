// =============================================================================
// Content inventory — the Phase 8 baseline fixture.
//
// Walks the generated static site and records, per route and locale, everything
// the redesign is forbidden to lose: sections, headings, meaningful words, CTAs
// and their destinations, images and alt text, forms and their fields, internal
// links and metadata.
//
// "Meaningful" deliberately excludes the global header, the global footer, the
// mobile menu and the altimeter rail, because those are identical on all 33
// pages: counting them would let a page lose half its body copy while the total
// stayed flat. It also excludes visually-hidden text and `aria-hidden` subtrees,
// so an accessibility label can never be spent as if it were prose.
//
//   node scripts/content-inventory.mjs            record the baseline
//   node scripts/content-inventory.mjs --check    fail on any reduction
//
// Output: _build/reports/content-baseline.json
//
// The markup is produced by our own Python generator, so a small tokenizer is
// enough and keeps this dependency-free. It is a *skipping text extractor*, not
// a general HTML parser: it tracks one skip depth and one text buffer, which is
// all the measurement needs.
// =============================================================================

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_build', 'reports', 'content-baseline.json');

// Void elements never close, so they must never change depth.
const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Furniture and non-prose. Repeated identically across every page, or not text.
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'head', 'header', 'footer', 'nav', 'template']);
// Repeated furniture that is a <div>/<aside> rather than a landmark element.
//
// The altimeter entry is anchored to the start of a class token rather than
// written as `\brail\b`. A `-` is a non-word character, so the loose form also
// matched `logoset--rail` — the collaboration rail on the Work index — and
// silently dropped two real content images from the count. An audit that
// under-reports is worse than one that over-reports, because the number still
// looks plausible. `rail`, `rail__tape` and the rest of the altimeter are still
// skipped; a modifier that merely ends in the word is not.
const SKIP_CLASSES = [/(^|\s)rail(__[\w-]+)?(\s|$)/, /\bmenu\b/, /\bdrop\b/, /\blang\b/, /\bgrain\b/, /\bcurtain\b/, /\bplane-cursor\b/, /\bsr-only\b/, /\bskip\b/];

function decode(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, d) => String.fromCodePoint(parseInt(d, 16)))
    .replace(/&[a-z]+;/gi, ' ');
}

function attrsOf(tagSource) {
  const out = {};
  for (const m of tagSource.matchAll(/([a-zA-Z_:][-\w:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = m[1].toLowerCase();
    if (name === tagSource.match(/^<\s*([a-zA-Z][-\w]*)/)?.[1]?.toLowerCase()) continue;
    out[name] = m[3] ?? m[4] ?? m[5] ?? '';
  }
  return out;
}

/**
 * Walk the document, emitting an event per element and collecting visible text
 * outside every skipped subtree.
 */
function walk(html, onOpen) {
  const bodyStart = html.search(/<body\b[^>]*>/i);
  const start = bodyStart === -1 ? 0 : html.indexOf('>', bodyStart) + 1;
  const bodyEnd = html.lastIndexOf('</body>');
  const src = html.slice(start, bodyEnd === -1 ? html.length : bodyEnd);

  const tag = /<(\/?)\s*([a-zA-Z][-\w]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|<!--[\s\S]*?-->/g;
  const stack = [];
  let skipDepth = 0;
  let text = '';
  let last = 0;
  let m;

  while ((m = tag.exec(src))) {
    if (skipDepth === 0) text += src.slice(last, m.index) + ' ';
    last = tag.lastIndex;

    if (m[0].startsWith('<!--')) continue;

    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const selfClosing = m[4] === '/' || VOID.has(name);

    if (closing) {
      // Unwind to the matching open, tolerating unclosed optional tags.
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) {
          for (let j = stack.length - 1; j >= i; j--) if (stack[j].skipped) skipDepth--;
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const attrs = attrsOf(m[0]);
    const cls = attrs.class || '';
    const skipped =
      SKIP_TAGS.has(name) ||
      attrs['aria-hidden'] === 'true' ||
      'hidden' in attrs ||
      SKIP_CLASSES.some((re) => re.test(cls));

    if (!selfClosing) {
      stack.push({ name, skipped });
      if (skipped) skipDepth++;
    }

    if (skipDepth === 0 || (skipped && skipDepth === 1)) {
      // Report the element itself even when it opens a skipped subtree, so an
      // <img> inside furniture is still visible to the "was it removed" check.
    }
    if (skipDepth === 0 || (selfClosing && skipDepth === 0)) onOpen(name, attrs, m.index, src);
  }
  if (skipDepth === 0) text += src.slice(last);

  return decode(text).replace(/\s+/g, ' ').trim();
}

/** Visible text of the element that starts at `openIndex`, from `src`. */
function innerText(src, openIndex) {
  const openEnd = src.indexOf('>', openIndex) + 1;
  const name = src.slice(openIndex).match(/^<\s*([a-zA-Z][-\w]*)/)[1].toLowerCase();
  const scan = new RegExp(`<(\\/?)\\s*${name}\\b`, 'gi');
  scan.lastIndex = openEnd;
  let depth = 1;
  let s;
  let end = src.length;
  while ((s = scan.exec(src))) {
    depth += s[1] === '/' ? -1 : 1;
    if (depth === 0) {
      end = s.index;
      break;
    }
  }
  return decode(src.slice(openEnd, end).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function wordCount(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function metaContent(html, key, attrName = 'name') {
  const m = html.match(new RegExp(`<meta\\b[^>]*\\b${attrName}="${key}"[^>]*>`, 'i'));
  if (!m) return null;
  const c = m[0].match(/\bcontent="([^"]*)"/i);
  return c ? decode(c[1]) : null;
}

function inventory(html, route, locale) {
  const headings = [];
  const sections = [];
  const articles = [];
  const links = [];
  const images = [];
  const formOpens = [];
  const paragraphs = [];
  const listItems = [];

  const text = walk(html, (name, attrs, index, src) => {
    switch (name) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        headings.push({ level: Number(name[1]), text: innerText(src, index) });
        break;
      case 'section':
        sections.push({ id: attrs.id ?? null, className: attrs.class ?? null });
        break;
      case 'article':
        articles.push({ className: attrs.class ?? null });
        break;
      case 'a':
        links.push({ href: attrs.href ?? null, text: innerText(src, index), className: attrs.class ?? null });
        break;
      case 'img':
        images.push({ src: attrs.src ?? null, alt: attrs.alt ?? null, loading: attrs.loading ?? null });
        break;
      case 'form':
        formOpens.push({ index, action: attrs.action ?? null, method: attrs.method ?? null, id: attrs.id ?? null });
        break;
      case 'p': paragraphs.push(1); break;
      case 'li': listItems.push(1); break;
    }
  });

  // Form fields are read from the raw source: inputs inside a form are what the
  // business function is, regardless of any wrapper the walker skipped.
  const forms = formOpens.map((f) => {
    const body = html.slice(html.indexOf('<form', 0));
    const start = html.indexOf(f.action ? `action="${f.action}"` : '<form');
    const chunk = html.slice(start, html.indexOf('</form>', start) + 7);
    return {
      action: f.action,
      method: f.method,
      id: f.id,
      fields: [...chunk.matchAll(/<(input|textarea|select)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi)].map((x) => {
        const a = attrsOf(x[0]);
        return { tag: x[1].toLowerCase(), name: a.name ?? null, type: a.type ?? null, required: 'required' in a };
      }),
    };
  });

  const ctas = links
    .filter((l) => l.className && /\b(btn|cta|button)\b/.test(l.className))
    .map((l) => ({ text: l.text, href: l.href }));

  const canonical = html.match(/<link\b[^>]*rel="canonical"[^>]*>/i);

  return {
    route,
    locale,
    title: (html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim() || null,
    description: metaContent(html, 'description'),
    canonical: canonical ? decode(canonical[0].match(/\bhref="([^"]*)"/i)?.[1] ?? '') : null,
    hreflang: [...html.matchAll(/<link\b[^>]*rel="alternate"[^>]*>/gi)].map((m) => ({
      hreflang: m[0].match(/\bhreflang="([^"]*)"/i)?.[1] ?? null,
      href: m[0].match(/\bhref="([^"]*)"/i)?.[1] ?? null,
    })),
    og: {
      title: metaContent(html, 'og:title', 'property'),
      description: metaContent(html, 'og:description', 'property'),
      image: metaContent(html, 'og:image', 'property'),
    },
    twitter: { card: metaContent(html, 'twitter:card'), title: metaContent(html, 'twitter:title') },
    h1: headings.filter((h) => h.level === 1).map((h) => h.text),
    headings,
    sectionCount: sections.length,
    articleCount: articles.length,
    sections,
    meaningfulWordCount: wordCount(text),
    paragraphCount: paragraphs.length,
    listItemCount: listItems.length,
    links,
    internalLinks: links.filter((l) => l.href && !/^(https?:|mailto:|tel:|#)/i.test(l.href)),
    ctas,
    images,
    forms,
  };
}

async function collect() {
  const isRoute = (f) => f.endsWith('.html') && !/ \d+\.html$/.test(f); // iCloud sync duplicates are not routes
  const pages = [];

  for (const p of (await readdir(ROOT)).filter(isRoute)) {
    pages.push({ file: join(ROOT, p), route: `/${p}`, locale: 'hu' });
  }
  for (const loc of ['en', 'de']) {
    const dir = join(ROOT, loc);
    if (!existsSync(dir)) continue;
    for (const p of (await readdir(dir)).filter(isRoute)) {
      pages.push({ file: join(dir, p), route: `/${loc}/${p}`, locale: loc });
    }
  }

  const out = [];
  for (const page of pages) out.push(inventory(await readFile(page.file, 'utf8'), page.route, page.locale));
  out.sort((a, b) => a.route.localeCompare(b.route));
  return out;
}

function summarise(rows) {
  return rows.reduce(
    (a, r) => ({
      routes: a.routes + 1,
      sections: a.sections + r.sectionCount,
      words: a.words + r.meaningfulWordCount,
      images: a.images + r.images.length,
      ctas: a.ctas + r.ctas.length,
      forms: a.forms + r.forms.length,
    }),
    { routes: 0, sections: 0, words: 0, images: 0, ctas: 0, forms: 0 },
  );
}

const rows = await collect();
const summary = summarise(rows);

if (process.argv.includes('--check')) {
  if (!existsSync(OUT)) {
    console.error(`content-inventory: no baseline at ${relative(ROOT, OUT)} — run without --check first.`);
    process.exit(1);
  }
  const baseline = JSON.parse(await readFile(OUT, 'utf8'));
  const problems = [];

  const imageStem = (src) => String(src).replace(/\.[a-z0-9]+$/i, '');

  for (const base of baseline.routes) {
    const now = rows.find((r) => r.route === base.route);
    if (!now) {
      problems.push(`${base.route}: ROUTE MISSING`);
      continue;
    }
    if (now.sectionCount < base.sectionCount)
      problems.push(`${base.route}: sections ${base.sectionCount} -> ${now.sectionCount}`);
    if (now.meaningfulWordCount < base.meaningfulWordCount)
      problems.push(`${base.route}: words ${base.meaningfulWordCount} -> ${now.meaningfulWordCount}`);
    // Compared by stem, not by full src: re-encoding an asset — the 2.2 MB
    // team-richard.png that §H required be optimised became a 234 KB .jpg of
    // the same photograph — is not a removal, and failing the content gate for
    // it would make the gate argue against its own brief. The count, the alt
    // text and the route are all still asserted, so an image that genuinely
    // disappears still fails here; only the container format is allowed to
    // move.
    for (const img of base.images)
      if (img.src && !now.images.some((i) => imageStem(i.src) === imageStem(img.src)))
        problems.push(`${base.route}: image removed ${img.src}`);
    for (const cta of base.ctas)
      if (cta.href && !now.ctas.some((c) => c.href === cta.href)) problems.push(`${base.route}: CTA removed ${cta.href}`);
    for (const f of base.forms) {
      const match = now.forms.find((g) => g.action === f.action);
      if (!match) { problems.push(`${base.route}: form removed (action=${f.action})`); continue; }
      for (const field of f.fields)
        if (field.name && !match.fields.some((g) => g.name === field.name))
          problems.push(`${base.route}: form field removed ${field.name}`);
    }
  }

  if (problems.length) {
    console.error(`content-inventory: ${problems.length} regression(s)\n${problems.map((p) => '  ' + p).join('\n')}`);
    process.exit(1);
  }
  console.log(`content-inventory: OK — ${rows.length} routes, no reductions against baseline.`);
} else {
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), summary, routes: rows }, null, 2));
  console.log(`content-inventory: ${rows.length} routes -> ${relative(ROOT, OUT)}`);
  console.table(
    rows.map((r) => ({
      route: r.route,
      sec: r.sectionCount,
      art: r.articleCount,
      words: r.meaningfulWordCount,
      h1: r.h1.length,
      hN: r.headings.length,
      imgs: r.images.length,
      ctas: r.ctas.length,
      forms: r.forms.length,
    })),
  );
  console.log('TOTAL', summary);
}
