// =============================================================================
// The legacy Wix redirects, asserted against the CONFIGURATION.
//
// WHAT THIS TEST DOES AND DOES NOT COVER
// --------------------------------------
// The suite serves `dist/` with `python -m http.server`. That server knows
// nothing about `netlify.toml`, so a request to `/book-online` against it 404s
// whether the redirect is configured correctly, configured wrongly, or deleted.
// An HTTP-level test written against that server would therefore assert its own
// setup and nothing about the product — and, worse, would read as Netlify
// coverage in a report.
//
// So this file asserts exactly one thing, and says so in its own name:
//
//     CONFIGURATION VALIDATED; NETLIFY RUNTIME VALIDATION PENDING DEPLOYMENT.
//
// It parses the canonical `netlify.toml` and checks that the rules are declared
// with the right source, destination and status, and that the destination is a
// page the build actually emits — which is the failure mode a redirect map
// really has: a rule that survives a rename and points at a 404.
//
// The runtime half is a post-deploy verification item, not something any local
// harness can stand in for.
// =============================================================================
import { test, expect } from '@playwright/test';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type Redirect = { from: string; to: string; status: number };

/**
 * The `[[redirects]]` blocks of netlify.toml.
 *
 * A hand-rolled reader rather than a TOML dependency: the file's redirect
 * section is a flat list of three scalar keys per block, the project ships no
 * TOML parser, and adding one to the devDependencies to read six lines would be
 * a supply-chain decision taken for a test. The parser is strict about shape —
 * it only collects a block once it has all three keys — so a malformed entry
 * disappears rather than being silently half-read, and the assertions below
 * fail on a missing rule.
 */
async function redirects(): Promise<Redirect[]> {
  const toml = await readFile(join(ROOT, 'netlify.toml'), 'utf8');
  const out: Redirect[] = [];
  let current: Partial<Redirect> | null = null;

  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) continue;

    if (line === '[[redirects]]') {
      current = {};
      continue;
    }
    // Any other table header ends the block — headers, build, context and so on.
    if (line.startsWith('[') && line !== '[[redirects]]') {
      current = null;
      continue;
    }
    if (!current) continue;

    const match = /^(from|to|status)\s*=\s*(.+)$/.exec(line);
    if (!match) continue;
    const key = match[1] as 'from' | 'to' | 'status';
    const value = match[2];
    if (key === 'status') current.status = Number(value);
    else current[key] = value.replace(/^["']|["']$/g, '');

    if (current.from && current.to && current.status) {
      out.push(current as Redirect);
      current = null;
    }
  }
  return out;
}

// Redirect targets are the extensionless canonical URLs (2026-10-09), which
// Netlify serves from `<path>.html`; a target that already names a file is
// checked as it is.
const emitted = async (path: string) => {
  const rel = path.replace(/^\//, '');
  for (const candidate of rel.endsWith('.html') || rel === '' ? [rel] : [rel, `${rel}.html`]) {
    try {
      await access(join(ROOT, 'dist', candidate));
      return true;
    } catch {
      /* try the next spelling */
    }
  }
  return false;
};

test.describe('legacy redirect configuration (Netlify runtime validation pending deployment)', () => {
  test('/book-online is declared as a 301 to the contact page', async () => {
    const rules = await redirects();
    const rule = rules.find((r) => r.from === '/book-online');

    expect(rule, '/book-online has no redirect rule in netlify.toml').toBeDefined();
    expect(rule!.status, '/book-online is not a permanent redirect').toBe(301);

    /* The destination is asserted as the CONTACT PAGE, by its emitted path.
       `/ugyfelszolgalat.html` is the Hungarian slug of the page whose canonical
       key is `contact` — see the SLUGS table in _build/build.py — so "→
       /contact" and "→ /ugyfelszolgalat" are the same statement about the
       same route, one in page keys and one in URLs. This asserts the URL,
       because that is what Netlify serves — extensionless, as the canonical
       is, so the redirect is one hop and not two. */
    expect(rule!.to).toBe('/ugyfelszolgalat');

    // And the destination is a page the build actually emits. A redirect to a
    // 404 is the one failure a redirect map cannot survive.
    expect(await emitted(rule!.to), `${rule!.to} is not in dist/`).toBe(true);
  });

  test('the other two Wix Bookings entry points land on the same page', async () => {
    // Both spellings of the service-page slug, because which of the two arrives
    // depends on the client. See the note in netlify.toml.
    const rules = await redirects();
    for (const from of [
      '/service-page/ingyenes-konzultáció',
      '/service-page/ingyenes-konzult%C3%A1ci%C3%B3',
    ]) {
      const rule = rules.find((r) => r.from === from);
      expect(rule, `${from} has no redirect rule`).toBeDefined();
      expect(rule!.status).toBe(301);
      expect(rule!.to).toBe('/ugyfelszolgalat');
    }
  });

  test('every declared redirect points at something that exists', async () => {
    const rules = await redirects();
    expect(rules.length, 'netlify.toml declares no redirects at all').toBeGreaterThan(5);

    const dangling: string[] = [];
    for (const rule of rules) {
      // Only the ones that name a site page. `/portal/...` is client-routed and
      // covered by portal.spec.ts; absolute host moves and the localised 404
      // fallbacks name no page of their own.
      if (/^https?:/.test(rule.to) || rule.to.startsWith('/portal') || rule.status === 404) continue;
      if (!(await emitted(rule.to))) dangling.push(`${rule.from} -> ${rule.to}`);
    }
    expect(dangling, `redirects pointing at pages the build does not emit`).toEqual([]);
  });
});
