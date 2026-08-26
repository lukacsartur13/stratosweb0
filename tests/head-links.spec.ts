/* ============================================================================
   The <head> links that have to be absolute, and have to point at real pages.

   WHY THIS FILE EXISTS
   --------------------
   Six rounds of auditing called the hreflang set "flawless" on every route,
   and it was not. `build_alternates()` in _build/build.py was the one consumer
   of `absolute()` that forgot to prefix it with the origin, so all 78 generated
   routes shipped `href="/kkv.html"` while the three Vite-built homepage shells
   — which interpolate the origin themselves — correctly said the full URL.

   The check that missed it counted the tags and verified they were reciprocal.
   Both were true. Neither looks at what is inside the href, and a relative
   hreflang is not interpreted at all: Google's requirement is a fully-qualified
   URL, scheme included, so the annotation is silently dropped and the language
   versions are never connected. An external crawler found it; the suite did
   not, because the suite was asking the wrong question about the right tag.

   So this file asks about the VALUE, on every page in the build, for the three
   things a crawler actually reports on hreflang: broken targets, redirected
   targets, and relative URLs.
   ========================================================================== */
import { test, expect } from '@playwright/test';
import { readdir, readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

type Doc = { file: string; html: string; lang: string };

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    // dist/portal is the SPA's own build; its shell is Vite's and carries no
    // hreflang set of ours.
    if (entry.name === 'portal') continue;
    // "blog 2.html" and friends. iCloud makes these on a sync conflict, inside
    // the working tree, and they are not routes: .gitignore drops them,
    // scripts/assemble.mjs refuses to copy them, and they 404 on the deployed
    // site. Same rule here, so a sync artefact cannot fail a build that is
    // correct — checked: both of the two currently on disk return 404 live.
    if (/ \d+$/.test(entry.name.replace(/\.[^.]+$/, ''))) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

let docs: Doc[] = [];

test.beforeAll(async () => {
  const files = await walk(DIST);
  docs = await Promise.all(files.map(async (f) => {
    const html = await readFile(f, 'utf8');
    return {
      file: f.slice(DIST.length + 1),
      html,
      lang: /<html[^>]*\blang="([^"]*)"/.exec(html)?.[1] ?? '',
    };
  }));
  expect(docs.length, 'the build produced pages to check').toBeGreaterThan(50);
});

/** Every `<link rel="alternate" hreflang>` on a page, as (lang, href) pairs. */
const alternates = (html: string) =>
  [...html.matchAll(/<link[^>]*rel="alternate"[^>]*>/g)]
    .map((m) => m[0])
    .map((tag) => ({
      lang: /hreflang="([^"]*)"/.exec(tag)?.[1] ?? '',
      href: /href="([^"]*)"/.exec(tag)?.[1] ?? '',
    }))
    .filter((a) => a.lang);

test('every hreflang href is an absolute URL', async () => {
  const { siteOrigin } = await import('../scripts/site-origin.mjs');
  const origin: string = siteOrigin();

  let checked = 0;
  for (const doc of docs) {
    for (const { lang, href } of alternates(doc.html)) {
      checked += 1;
      // The whole point. A root-relative href is the defect this file was
      // written for, and `startsWith('/')` is exactly what it looked like.
      expect(href, `${doc.file}: hreflang="${lang}" is not absolute`).toMatch(/^https?:\/\//);
      expect(href.startsWith(`${origin}/`),
        `${doc.file}: hreflang="${lang}" is ${href}, not on ${origin}`).toBe(true);
    }
  }
  expect(checked, 'every page carries a hreflang set').toBeGreaterThan(200);
});

test('every hreflang target is a page this build actually contains', async () => {
  const { siteOrigin } = await import('../scripts/site-origin.mjs');
  const origin: string = siteOrigin();

  // "Fix broken hreflang URLs" — a target that 404s is worse than no
  // annotation, because it tells a crawler the set is unreliable.
  const missing: string[] = [];
  for (const doc of docs) {
    for (const { lang, href } of alternates(doc.html)) {
      const path = href.slice(origin.length);
      // `/`, `/en/` and `/de/` are directories served as index.html.
      const file = path.endsWith('/') ? `${path}index.html` : path;
      try {
        await access(join(DIST, file.replace(/^\//, '')));
      } catch {
        missing.push(`${doc.file}: hreflang="${lang}" -> ${href}`);
      }
    }
  }
  expect(missing, 'hreflang targets that are not in the build').toEqual([]);
});

test('the hreflang set is reciprocal and complete', () => {
  // Every page that declares a set declares the same set: three languages plus
  // x-default, and x-default matches the Hungarian entry. A one-way annotation
  // is ignored by Google, so an asymmetric set is a set that does nothing.
  for (const doc of docs) {
    const alts = alternates(doc.html);
    if (!alts.length) continue;
    const langs = alts.map((a) => a.lang).sort();
    expect(langs, `${doc.file} hreflang languages`).toEqual(['de', 'en', 'hu', 'x-default']);

    const hu = alts.find((a) => a.lang === 'hu')!.href;
    const xd = alts.find((a) => a.lang === 'x-default')!.href;
    expect(xd, `${doc.file}: x-default and hu disagree`).toBe(hu);

    // The page names itself in its own language slot.
    const self = alts.find((a) => a.lang === doc.lang);
    expect(self, `${doc.file} does not list its own language (${doc.lang})`).toBeTruthy();
  }
});

test('canonical and og:url are absolute too', async () => {
  const { siteOrigin } = await import('../scripts/site-origin.mjs');
  const origin: string = siteOrigin();

  // These were already correct. They are asserted here so that the next
  // consumer of `absolute()` added to build.py cannot repeat the omission in a
  // different tag without a test noticing.
  for (const doc of docs) {
    for (const re of [/<link[^>]*rel="canonical"[^>]*href="([^"]*)"/,
                      /<meta[^>]*property="og:url"[^>]*content="([^"]*)"/]) {
      const href = re.exec(doc.html)?.[1];
      if (!href) continue;
      expect(href.startsWith(`${origin}/`),
        `${doc.file}: ${href} is not an absolute URL on ${origin}`).toBe(true);
    }
  }
});
