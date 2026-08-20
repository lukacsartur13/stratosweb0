import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Everything the shipped site references must be IN THE REPOSITORY.
 *
 * WHY THIS EXISTS
 * ---------------
 * Twice now a file has been referenced by a committed page, present in the
 * working tree, and never staged. Both times every local check passed and the
 * defect only appeared once something built from a clean checkout:
 *
 *   assets/img/work-rapidkert.jpg   the homepage featured a case study whose
 *                                   photograph 404d in the frozen build. It
 *                                   surfaced as nine console-error failures in
 *                                   two suites that never mention Rapidkert.
 *   assets/css/page-rapidkert.css   the Netlify build died at the last step of
 *                                   `npm run build` — "fingerprint: no such
 *                                   asset in dist" — after the deploy was
 *                                   already pushed.
 *
 * The existing guards cannot catch this, and it is worth being precise about
 * why rather than adding a third one that also cannot. `fingerprint:check` and
 * every Playwright suite read `dist/`, and `dist/` is built from the WORKING
 * TREE — so an untracked file is present for all of them and absent only for
 * the clone Netlify makes. The question "is this file in the build?" is not the
 * same question as "is this file in the repository?", and only the second one
 * predicts what a deploy will do.
 *
 * So this asks git, not the filesystem. It is a node-project test: no page, no
 * viewport, no server.
 */

// The repo is `"type": "module"`, so `__dirname` does not exist here.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every path git is tracking, as a set of repo-relative paths. */
function trackedFiles(): Set<string> {
  return new Set(
    execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n')
      .filter(Boolean),
  );
}

/**
 * The shipped HTML: the generated pages at the repo root and in the two
 * language trees.
 *
 * iCloud writes "thing 2.html" beside "thing.html" when a folder syncs from two
 * machines. `scripts/assemble.mjs` refuses to copy those into `dist/` and
 * `.gitignore` refuses to commit them, so they are not shipped and their
 * references are not this test's business — the same rule, applied here.
 */
const isDuplicate = (name: string) => / \d+$/.test(name.replace(/\.[^.]+$/, ''));

function shippedPages(): string[] {
  const out: string[] = [];
  for (const dir of ['.', 'en', 'de']) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      if (!name.endsWith('.html') || isDuplicate(name)) continue;
      out.push(dir === '.' ? name : `${dir}/${name}`);
    }
  }
  return out.sort();
}

test.describe('asset packaging', () => {
  test('every asset a shipped page references is tracked by git', () => {
    const tracked = trackedFiles();
    const pages = shippedPages();

    // A loop over an empty list is a passing test that checks nothing.
    expect(pages.length, 'no shipped pages found').toBeGreaterThan(20);

    const missing: string[] = [];
    let references = 0;

    for (const page of pages) {
      const html = readFileSync(join(ROOT, page), 'utf8');
      // src="…" and href="…" pointing anywhere inside assets/, with any
      // ?v= fingerprint or #fragment stripped. Relative "../assets/…" from the
      // language trees resolves against the page's own directory.
      for (const [, raw] of html.matchAll(/(?:src|href)="((?:\.\.\/)*assets\/[^"?#]+)/g)) {
        references += 1;
        const rel = normalize(join(dirname(page), raw)).replace(/\\/g, '/');
        if (!tracked.has(rel)) missing.push(`${rel}  <- ${page}`);
      }
    }

    expect(references, 'no asset references found — the matcher is broken').toBeGreaterThan(100);
    expect(
      [...new Set(missing)].sort(),
      'referenced by a shipped page but absent from a clean checkout',
    ).toEqual([]);
  });

  test('every translation dictionary the generator reads is tracked by git', () => {
    // `_build/build.py` merges every `_build/i18n/*.json` by glob, so an
    // untracked dictionary is not an error anywhere — it is a silent fallback
    // to Hungarian. That is how the English case study came within one push of
    // being regenerated in the wrong language on a page that had been reviewed
    // in English.
    const tracked = trackedFiles();
    const dir = join(ROOT, '_build/i18n');
    const dicts = readdirSync(dir).filter((n) => n.endsWith('.json') && !isDuplicate(n));

    expect(dicts.length, 'no translation dictionaries found').toBeGreaterThan(5);

    const untracked = dicts.filter((n) => !tracked.has(`_build/i18n/${n}`));
    expect(
      untracked,
      'a dictionary on disk but not in the repository — the generator would fall back to Hungarian',
    ).toEqual([]);
  });
});
