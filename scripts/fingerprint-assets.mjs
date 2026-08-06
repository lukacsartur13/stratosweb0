// =============================================================================
// Cache-bust the shared stylesheets and scripts.
//
// THE BUG THIS EXISTS TO PREVENT
// ------------------------------
// `netlify.toml` serves /assets/* with `Cache-Control: public, max-age=604800`
// — seven days — and the shared files have fixed names: /assets/css/main.css,
// /assets/js/main.js. The HTML does not: it has no Cache-Control rule, so
// Netlify serves it `max-age=0, must-revalidate` and a returning visitor always
// gets the current markup.
//
// Those two facts together are the defect. Phase 8 took main.css from 52,410 to
// 72,931 bytes, adding the whole subpage vocabulary — `.smark`, `.choice` and
// the rest. Anyone who had loaded the site in the previous week then received
// the NEW markup against their CACHED OLD stylesheet: the new blocks rendered
// with no grid, no rules and no spacing, while everything older looked correct,
// for up to seven days, with nothing wrong on the server. It was reported from
// a real browser as "something is off", and it was reproduced exactly by
// serving the current page with the previous stylesheet.
//
// THE FIX
// -------
// Append `?v=<content hash>` to every reference. A changed file gets a changed
// URL, which is a different cache key, so a deploy invalidates its own assets.
// An unchanged file keeps its hash and stays cached for the full week.
//
// This also repairs caches that are ALREADY poisoned, which is why it is worth
// doing rather than only shortening the max-age: the HTML always revalidates,
// the fresh HTML points at a URL the browser has never seen, and the stale copy
// is bypassed on the next visit rather than waited out.
//
// WHY A SEPARATE STEP, AND WHY LAST
// ---------------------------------
// `npm run build` is generate -> build:site -> build:home -> build:portal. The
// three homepage shells are written by Vite in build:home, AFTER assemble.mjs
// has run, so a pass inside the assembler would miss exactly the three routes
// with the most JavaScript. This runs at the end and sees every emitted page.
//
// dist/portal is skipped: Vite already content-hashes the portal's filenames,
// and netlify.toml caches /portal/assets/* immutable on that basis.
//
// dist/experiments is skipped for a different reason, and it is worth stating
// because its absence made `--check` disagree with itself. That route is not
// deployed: `npm run build` does not create it and, through assemble.mjs, wipes
// it — only `npm run build:full` emits it, for the benchmark suite. So this
// pass stamps a tree that does not contain it, and `--check` then walked a tree
// that did (because `validate:full` runs `build:full` afterwards) and reported
// one unstamped reference that no deploy will ever serve. Same shape as the two
// scope defects in _build/reports/phase9-test-reconciliation.md §6: a check
// whose answer depends on which npm script ran last.
//
// SCOPE
// -----
// CSS and JS only. A stale stylesheet or script silently renders the wrong
// page; a stale image is still the image it was, and the fonts are versioned by
// the CSS that names them. Widening this to every asset would churn URLs for no
// correctness gain.
//
//   node scripts/fingerprint-assets.mjs
//   node scripts/fingerprint-assets.mjs --check   # verify, change nothing
// =============================================================================

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const CHECK = process.argv.includes('--check');

/** Every reference to a shared stylesheet or script, in either quote style —
 *  build.py emits both. The path is captured whole so it can be resolved
 *  against the asset table; a reference that already carries a query or a
 *  fragment is left alone rather than double-stamped. */
const REF = /\b(href|src)=("|')([^"']*?assets\/(?:css|js)\/[^"'?#]+?)\2/g;

/** iCloud Drive writes "thing 2.ext" beside "thing.ext" when the project folder
 *  syncs from two machines, and it does it to dist/ as readily as to the source
 *  — including in the seconds between a build and a check, which is how a
 *  `dist/blog 2.html` nobody generated turned up here and failed verification.
 *  Netlify never sees one (it builds from the repository, where .gitignore
 *  refuses them), so they are noise on this machine only. Same rule as
 *  `isDuplicate` in scripts/assemble.mjs. */
const isDuplicate = (name) => / \d+$/.test(name.replace(/\.[^.]+$/, ''));

async function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (isDuplicate(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, out);
    else out.push(path);
  }
  return out;
}

async function main() {
  if (!existsSync(DIST)) {
    console.error('fingerprint: no dist/ — run `npm run build` first.');
    process.exit(1);
  }

  // ---------------------------------------------------------- the asset table
  // Keyed by the path as it appears in markup from `assets/` onwards, so a
  // reference resolves the same whether it was written `assets/css/main.css`,
  // `../assets/css/main.css` or `/assets/css/main.css`.
  const hashes = new Map();
  for (const kind of ['css', 'js']) {
    for (const file of await walk(join(DIST, 'assets', kind))) {
      const key = relative(DIST, file).split(sep).join('/');
      const hash = createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 8);
      hashes.set(key, hash);
    }
  }

  if (!hashes.size) {
    console.error('fingerprint: no css or js under dist/assets — nothing to stamp.');
    process.exit(1);
  }

  // ------------------------------------------------------------- the rewrite
  const NOT_DEPLOYED = new Set(['portal', 'experiments']);
  const pages = (await walk(DIST))
    .filter((f) => f.endsWith('.html'))
    .filter((f) => !relative(DIST, f).split(sep).some((part) => NOT_DEPLOYED.has(part)));

  let stamped = 0;
  const unresolved = new Set();

  for (const page of pages) {
    const before = await readFile(page, 'utf8');
    const after = before.replace(REF, (whole, attr, q, path) => {
      const key = path.slice(path.indexOf('assets/'));
      const hash = hashes.get(key);
      if (!hash) { unresolved.add(key); return whole; }
      stamped += 1;
      return `${attr}=${q}${path}?v=${hash}${q}`;
    });
    if (after !== before && !CHECK) await writeFile(page, after, 'utf8');
  }

  // ------------------------------------------------------------ the reporting
  // A reference this could not resolve is the failure mode that matters: it
  // means an asset is named in markup under a path that is not in dist, so the
  // page is either 404ing on it already or reaching outside the copied tree.
  for (const key of unresolved) console.error(`fingerprint: no such asset in dist — ${key}`);

  if (CHECK) {
    // Verification runs against what is on disk, so it must find references
    // that are ALREADY stamped rather than ones it would stamp.
    let bare = 0;
    for (const page of pages) {
      const html = await readFile(page, 'utf8');
      for (const m of html.matchAll(REF)) {
        const key = m[3].slice(m[3].indexOf('assets/'));
        if (hashes.has(key)) { bare += 1; console.error(`fingerprint: unstamped ${key} in ${relative(DIST, page)}`); }
      }
    }
    console.log(`fingerprint --check: ${pages.length} pages, ${hashes.size} assets, ${bare} unstamped`);
    process.exit(bare || unresolved.size ? 1 : 0);
  }

  console.log(`fingerprint: ${stamped} references across ${pages.length} pages -> ${hashes.size} assets`);
  for (const [key, hash] of [...hashes].sort()) console.log(`  ${key} ?v=${hash}`);
  process.exit(unresolved.size ? 1 : 0);
}

main().catch((e) => { console.error('fingerprint failed:', e); process.exit(1); });
