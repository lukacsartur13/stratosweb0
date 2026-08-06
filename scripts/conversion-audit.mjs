// =============================================================================
// Conversion audit — Workstream A of Phase 9.
//
// Answers one question per public route: what is the visitor supposed to do
// here, and does the page actually let them do it?
//
//   node scripts/conversion-audit.mjs           write the report
//   node scripts/conversion-audit.mjs --check   exit non-zero on any integrity
//                                               failure (for CI and `npm test`)
//
// Output: _build/reports/phase9-conversion-audit.json
//
// WHAT COUNTS AS A CTA
//
// The same definition `content-inventory.mjs` uses — an <a> whose class carries
// `btn`, `cta` or `button` — so the two reports cannot disagree about what a CTA
// is. What this script adds is *placement*: the inventory skips <header>,
// <footer> and <nav> wholesale, which is right for measuring prose but wrong
// here, because the header CTA is a conversion path too. So this walker keeps
// them and labels each CTA with the chrome it belongs to:
//
//   chrome    the sticky header, the full-screen menu, the footer — identical
//             on every route, so it says nothing about *this* page's intent.
//   arrival   the shared Arrival section. A <section>, not a <footer>, so the
//             inventory counts it as body content; it is still the same two
//             CTAs on every subpage and must not be mistaken for a page's own
//             primary action.
//   body      the page's own CTAs. This is the set that carries page intent,
//             and the only set a primary-CTA hierarchy can be read from.
//
// Conflating those three is how a "every page has a CTA" audit passes while
// every page actually says the same generic thing.
//
// The markup comes from our own generator, so a small tokenizer is enough and
// keeps this dependency-free — same reasoning as content-inventory.mjs.
// =============================================================================

import { readdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, dirname, resolve, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, '_build', 'reports', 'phase9-conversion-audit.json');

const CHECK = process.argv.includes('--check');

// iCloud writes "thing 2.ext" beside "thing.ext". Same rule as .gitignore and
// assemble.mjs: never audit a sync duplicate, it is stale by definition.
const DUPLICATE = /\s\d+\.[^.]+$/;

// The nine case-study routes are `summary`, not `full` (see CASE_STATUS in
// _build/build.py). A "read the full case study" CTA pointing at one of them
// would promise a page that does not exist yet, so any CTA into these is
// reported and judged by its wording.
const CASE_SLUGS = [
  'munka-rapidkert', 'munka-barbershop', 'munka-mentaltrening',
  'work-rapidkert', 'work-barbershop', 'work-mentaltrening',
  'projekt-rapidkert', 'projekt-barbershop', 'projekt-mentaltrening',
];

// Wording that would promise a full case study. Checked per locale against the
// three languages the site actually ships.
const FULL_CASE_PROMISE = [
  /teljes\s+esettanulm/i,          // hu — "teljes esettanulmány"
  /full\s+case\s+stud/i,           // en
  /vollständige\s+fallstudie/i,    // de
  /ganze\s+fallstudie/i,
];

// ---------------------------------------------------------------- tokenizer

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;

function attrsOf(raw) {
  const out = {};
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(raw))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

function decode(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function textBetween(html, from, to) {
  return decode(html.slice(from, to).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Walk one document, reporting every CTA anchor with the landmark stack it sits
 * in. One pass, one stack — enough to answer "is this chrome, arrival, or the
 * page's own".
 */
function ctasOf(html) {
  const stack = [];
  const found = [];
  let groups = 0;   // one id per .btn-row, so CTAs offered side by side are comparable
  let m;
  TAG.lastIndex = 0;

  while ((m = TAG.exec(html))) {
    const [full, closing, rawName, rawAttrs, selfClose] = m;
    const name = rawName.toLowerCase();

    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
      continue;
    }

    const attrs = attrsOf(rawAttrs);
    const cls = attrs.class ?? '';

    if (name === 'a') {
      // Not every anchor is a CTA — the same class test content-inventory uses.
      if (/\b(btn|cta|button)\b/.test(cls)) {
        // The anchor's own end tag, so the label is the anchor's text and not
        // the rest of the document.
        const close = html.indexOf('</a>', m.index);
        found.push({
          text: textBetween(html, m.index + full.length, close === -1 ? m.index + full.length : close),
          href: attrs.href ?? null,
          className: cls,
          ariaLabel: attrs['aria-label'] ?? null,
          offset: m.index,
          zone: zoneOf(stack, cls),
          section: sectionOf(stack),
          emphasis: emphasisOf(cls),
          group: groupOf(stack),
        });
      }
      continue;
    }

    if (!VOID.has(name) && !selfClose) {
      if (/\bbtn-row\b/.test(cls)) stack.push({ name, cls, group: ++groups });
      else stack.push({ name, cls });
    }
  }

  return found;
}

function zoneOf(stack, ownClass) {
  for (const el of stack) {
    if (el.name === 'header' || el.name === 'nav' || el.name === 'footer') return 'chrome';
    if (/\bmenu\b/.test(el.cls)) return 'chrome';
    if (/\barrival\b/.test(el.cls)) return 'arrival';
  }
  // The header's own "Projekt indítása" sits directly on <a class="nav__cta">
  // outside <nav>, so it is caught by its class rather than its ancestry.
  if (/\bnav__cta\b/.test(ownClass) || /\bmenu__cta\b/.test(ownClass)) return 'chrome';
  return 'body';
}

/**
 * Emphasis is carried entirely by the class: `btn--ghost` is the outlined
 * secondary, a bare `btn` is the solid primary. Without this, an audit can
 * count CTAs but cannot see hierarchy — and "one clear primary action per page"
 * is a statement about hierarchy, not about counts.
 */
function emphasisOf(cls) {
  return /\bbtn--ghost\b/.test(cls) ? 'secondary' : 'primary';
}

/**
 * The `.btn-row` a CTA belongs to. Two CTAs offered side by side in one row are
 * a *choice presented to the visitor*; the same CTA repeated in the hero and
 * again in the closing band is reinforcement. Only the first can conflict, so
 * the conflict test is scoped to the row rather than to the page.
 */
function groupOf(stack) {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].group) return stack[i].group;
  return null;
}

function sectionOf(stack) {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].name === 'section' || stack[i].name === 'article') {
      const c = stack[i].cls.split(/\s+/)[0];
      if (c) return c;
    }
  }
  return null;
}

// ------------------------------------------------------------------- routes

async function pages(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'portal' || entry.name === 'experiments') continue;
      if (DUPLICATE.test(entry.name)) continue;
      await pages(p, acc);
    } else if (entry.name.endsWith('.html') && !DUPLICATE.test(entry.name)) {
      acc.push(p);
    }
  }
  return acc;
}

function localeOf(routePath) {
  if (routePath.startsWith('/en/')) return 'en';
  if (routePath.startsWith('/de/')) return 'de';
  return 'hu';
}

/**
 * Where an href on `fromRoute` actually lands.
 *
 * The site uses both forms and they must not be conflated: the three homepage
 * shells (built by Vite, not the Python generator) emit root-relative hrefs
 * like `/en/quote.html`, while every generated subpage emits document-relative
 * ones like `arajanlat.html`. Joining a root-relative href against the page's
 * own directory produces `/en/en/quote.html` and reports eight perfectly good
 * links as broken.
 */
function resolveHref(fromRoute, href) {
  if (!href) return null;
  if (/^(https?:|mailto:|tel:|#)/i.test(href)) return null;   // external or in-page
  const [path] = href.split('#');
  if (!path) return null;
  if (path.startsWith('/')) return posix.normalize(path);
  return posix.normalize(posix.join(posix.dirname(fromRoute), path));
}

async function exists(routePath) {
  try { await access(join(DIST, routePath.replace(/^\//, ''))); return true; }
  catch { return false; }
}

// -------------------------------------------------------------------- main

const files = await pages(DIST);
const routes = [];

for (const file of files.sort()) {
  const routePath = '/' + relative(DIST, file).split(/[\\/]/).join('/');
  const html = await readFile(file, 'utf8');
  const locale = localeOf(routePath);
  const length = html.length;

  const ctas = [];
  for (const c of ctasOf(html)) {
    const target = resolveHref(routePath, c.href);
    const external = /^https?:/i.test(c.href ?? '');
    ctas.push({
      text: c.text,
      href: c.href,
      zone: c.zone,
      section: c.section,
      emphasis: c.emphasis,
      group: c.group,
      target,
      external,
      // Rough scroll proxy: how far into the document the CTA sits. Not pixels
      // — a generated page's markup order is its visual order here — but enough
      // to catch "the only way to convert is 90% of the way down".
      depth: +(c.offset / length).toFixed(3),
      resolves: external || target === null ? true : await exists(target),
      toCaseStudy: target ? CASE_SLUGS.some((s) => target.includes(s)) : false,
      promisesFullCase: FULL_CASE_PROMISE.some((re) => re.test(c.text)),
      localeConsistent: target === null || external ? true : localeOf(target) === locale,
      hasLabel: Boolean(c.text || c.ariaLabel),
    });
  }

  const body = ctas.filter((c) => c.zone === 'body');
  routes.push({
    route: routePath,
    locale,
    ctaTotal: ctas.length,
    byZone: {
      chrome: ctas.filter((c) => c.zone === 'chrome').length,
      arrival: ctas.filter((c) => c.zone === 'arrival').length,
      body: body.length,
    },
    firstBodyCtaDepth: body.length ? Math.min(...body.map((c) => c.depth)) : null,
    ctas,
  });
}

// ------------------------------------------------------------- integrity

const flat = routes.flatMap((r) => r.ctas.map((c) => ({ ...c, route: r.route, locale: r.locale })));

/**
 * Conflicting primaries — the §5.2 result that was previously asserted in prose.
 *
 * The defect this catches is real and was shipped: the ads service page offered
 * "Árajánlat" and "Árajánlatot kérek" side by side, both solid, both landing on
 * the same questionnaire. That is a choice that is not a choice. Two solid
 * buttons in one row with the same destination is the machine-detectable shape
 * of it, in any language.
 */
const conflictingPrimary = [];
for (const r of routes) {
  const rows = new Map();
  for (const c of r.ctas) {
    if (c.group === null || c.emphasis !== 'primary') continue;
    const key = `${c.group}|${c.target ?? c.href ?? ''}`;
    rows.set(key, [...(rows.get(key) ?? []), c]);
  }
  for (const [, group] of rows) {
    if (group.length > 1) {
      conflictingPrimary.push({
        route: r.route,
        target: group[0].target ?? group[0].href,
        texts: group.map((c) => c.text),
      });
    }
  }
}

const failures = {
  conflictingPrimary,
  brokenDestination: flat.filter((c) => !c.resolves),
  wrongLocaleDestination: flat.filter((c) => !c.localeConsistent),
  unlabelled: flat.filter((c) => !c.hasLabel),
  fullCasePromise: flat.filter((c) => c.promisesFullCase),
  // A route whose only conversion path is the shared Arrival block has no
  // opinion of its own about what the visitor should do next.
  noBodyCta: routes.filter((r) => r.byZone.body === 0).map((r) => r.route),
};

const report = {
  generatedAt: new Date().toISOString(),
  routesAudited: routes.length,
  ctasAudited: flat.length,
  summary: {
    byZone: {
      chrome: flat.filter((c) => c.zone === 'chrome').length,
      arrival: flat.filter((c) => c.zone === 'arrival').length,
      body: flat.filter((c) => c.zone === 'body').length,
    },
    byEmphasis: {
      primary: flat.filter((c) => c.emphasis === 'primary').length,
      secondary: flat.filter((c) => c.emphasis === 'secondary').length,
    },
    conflictingPrimary: conflictingPrimary.length,
    brokenDestination: failures.brokenDestination.length,
    wrongLocaleDestination: failures.wrongLocaleDestination.length,
    unlabelled: failures.unlabelled.length,
    fullCasePromise: failures.fullCasePromise.length,
    routesWithNoBodyCta: failures.noBodyCta.length,
    ctasIntoCaseStudies: flat.filter((c) => c.toCaseStudy).length,
  },
  failures,
  routes,
};

await writeFile(OUT, JSON.stringify(report, null, 2) + '\n');

const s = report.summary;
console.log(`routes ${report.routesAudited}  ctas ${report.ctasAudited}`);
console.log(`  zones: chrome ${s.byZone.chrome}  arrival ${s.byZone.arrival}  body ${s.byZone.body}`);
console.log(`  emphasis: primary ${s.byEmphasis.primary}  secondary ${s.byEmphasis.secondary}`);
console.log(`  conflicting primaries   ${s.conflictingPrimary}`);
console.log(`  broken destination      ${s.brokenDestination}`);
console.log(`  wrong-locale destination ${s.wrongLocaleDestination}`);
console.log(`  unlabelled CTA          ${s.unlabelled}`);
console.log(`  full-case promise       ${s.fullCasePromise}`);
console.log(`  routes with no body CTA ${s.routesWithNoBodyCta}`);
console.log(`  CTAs into case studies  ${s.ctasIntoCaseStudies}`);
console.log(`-> ${relative(ROOT, OUT)}`);

if (CHECK) {
  const hard = s.brokenDestination + s.wrongLocaleDestination + s.unlabelled
    + s.fullCasePromise + s.conflictingPrimary;
  if (hard > 0) {
    console.error(`\nFAIL: ${hard} CTA integrity failure(s).`);
    for (const c of conflictingPrimary) {
      console.error(`  conflictingPrimary: ${c.route} -> ${c.target} (${c.texts.join(' / ')})`);
    }
    for (const [k, v] of Object.entries(failures)) {
      if (k === 'noBodyCta' || k === 'conflictingPrimary' || !v.length) continue;
      for (const c of v.slice(0, 20)) console.error(`  ${k}: ${c.route} -> ${c.href} (${c.text})`);
    }
    process.exit(1);
  }
  console.log('\nOK: no CTA integrity failures.');
}
