#!/usr/bin/env node
// =============================================================================
// Repository-wide secret scan.
//
//     npm run scan:secrets
//
// Walks every tracked text file — source, generated pages, and the built dist/
// — and fails the run on anything that looks like a credential shipped by
// mistake. It exists because this repository already published one: a Web3Forms
// access key sitting in assets/js/main.js, readable by every visitor.
//
// Exit code 1 on any finding, so it can gate a build.
// =============================================================================

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Directories that hold no authored source, or hold a deliberate copy of the
// old site. _backup is gitignored and exists to be restored from, not shipped.
const SKIP_DIRS = new Set(['node_modules', '.git', 'test-results', 'playwright-report', '_backup']);

const TEXT = /\.(html|js|mjs|cjs|jsx|ts|tsx|css|json|md|txt|xml|yml|yaml|toml|py|sql|sh|env|example)$/i;

const RULES = [
  {
    id: 'web3forms-endpoint',
    re: /api\.web3forms\.com/i,
    note: 'Web3Forms endpoint. Public forms post to /api/lead.',
  },
  {
    id: 'web3forms-key',
    re: /c29cba39-7b75-4a6d-a6e0-d37672745b4a/,
    note: 'The Web3Forms access key that was published in the old bundle.',
  },
  {
    id: 'form-access-key',
    re: /\baccess_key\b/,
    note: 'A form access key in client code is readable by every visitor.',
  },
  {
    id: 'supabase-service-role',
    // The role is encoded in the JWT payload, so a leaked service key carries
    // this string wherever it is pasted.
    re: /service_role/,
    note: 'Supabase service role key. Server-side only, never in a bundle.',
  },
  {
    id: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    note: 'A JWT literal.',
  },
  {
    id: 'private-key',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    note: 'A private key block.',
  },
  {
    id: 'aws-key',
    re: /\bAKIA[0-9A-Z]{16}\b/,
    note: 'An AWS access key id.',
  },

  // ---- Phase 9, Workstream O -------------------------------------------------
  // Four credential shapes this project can now plausibly acquire, added
  // BEFORE it acquires them. A scanner written after the leak is a scanner that
  // certifies the leak as clean on its first run.
  {
    id: 'google-service-account',
    // The Analytics Data API integration the Portal will need is authenticated
    // by a service-account JSON file, and its private key is a real secret —
    // unlike the GA4 Measurement ID, which is public by design and ships in
    // every page. The PEM block is caught by `private-key` above; this catches
    // the JSON wrapper, which is how the key actually arrives from Google.
    re: /"type"\s*:\s*"service_account"|"private_key_id"\s*:\s*"/,
    note: 'A Google service-account credential. Server-side only, never in the repository.',
  },
  {
    id: 'supabase-secret-key',
    // The current Supabase secret-key model. Not a JWT, so the `jwt` rule
    // above does not see it.
    re: /\bsb_secret_[A-Za-z0-9_-]{16,}/,
    note: 'A Supabase secret key. Netlify function environment only.',
  },
  {
    id: 'netlify-token',
    re: /\bnfp_[A-Za-z0-9]{20,}/,
    note: 'A Netlify personal access token.',
  },
  {
    id: 'database-url',
    // A connection string with credentials in it. The user:password@host shape
    // is what makes this a finding — a bare postgres://host is not a secret.
    re: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^\s:@/]+:[^\s@/]+@/i,
    note: 'A database URL with credentials in it.',
  },
  {
    id: 'vcs-token',
    re: /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|glpat-[A-Za-z0-9_-]{16,})\b/,
    note: 'A version-control access token.',
  },
];

// Lines that name a rule in order to forbid it: this scanner, the tests that
// assert the absence, and the prose that explains why. A finding is a value, not
// a mention, and these files carry mentions on purpose.
const DESCRIBES_THE_RULE = new Set([
  'scripts/secret-scan.mjs',
  'tests/lead-forms.spec.ts',
  'tests/lead-endpoint.spec.ts',
  'tests/portal.spec.ts',
  // The same assertion, for the Control Room's bundles: it names the rule in
  // order to forbid it, and carries no value.
  'tests/portal-control-room.spec.ts',
  'README.md',
  '.env.example',
  'ARCHITECTURE.md',
  'netlify/functions/submit-lead.mjs',
  'supabase/migrations/20260801000200_rls.sql',
  // Read-only diagnostics run by hand against the live database. They name the
  // four default Postgres roles — including service_role — while explaining
  // which grants the new columns inherit and why `anon` holding them is not a
  // hole. Mentions, in prose, in files that contain no value of any kind.
  'supabase/checks/lead-envelope-preflight.sql',
  'supabase/checks/lead-envelope-preflight-quick.sql',
  'supabase/checks/lead-envelope-verify.sql',
  'supabase/checks/lead-envelope-rollback.sql',
  // The Phase 9 dependency and secret audit. It lists this scanner's own rules
  // in a table — what each looks for and why it was added — which is precisely
  // the mention-not-value case this set exists for. Listed individually rather
  // than by exempting `_build/reports/**`: a report that pasted a real key
  // would be a genuine finding, and a directory-wide exemption is how that
  // stops being caught.
  '_build/reports/phase9-dependency-audit.md',
]);

/**
 * Machine-generated run artefacts, excluded by PATH PREFIX rather than by name.
 *
 * The gate writes a Playwright JSON report into its own run directory, and that
 * report quotes failing test SOURCE and error text verbatim. So when
 * `tests/lead-forms.spec.ts` failed — on a line that reads
 *
 *     expect(JSON.stringify(envelope)).not.toMatch(/access_key|web3forms/i);
 *
 * — the words landed inside `runs/g4-02/playwright-main.json`, and this scanner
 * reported six findings for them. That file is already in `DESCRIBES_THE_RULE`
 * precisely because it names the rule in order to forbid it; the exemption is
 * keyed on the authored path, and quoting the same text somewhere else brought
 * the finding back from the dead.
 *
 * The consequence was worse than a false positive. The artefact persists, so
 * EVERY LATER RUN failed the same way: run 3 was red because of run 2's output,
 * which destroys the independence the repeated-run gate is built on. Six runs
 * are not six runs if one can poison the next.
 *
 * Deliberately NOT `_build/reports/**`. The comment on `DESCRIBES_THE_RULE`
 * argues that a directory-wide exemption there is how a real pasted key stops
 * being caught, and that argument is right — for AUTHORED reports. These paths
 * are different in kind: regenerated every run, never written by hand, never
 * deployed. That is the same category as `test-results` and
 * `playwright-report`, which SKIP_DIRS already excludes by name; these need a
 * prefix because their directory names are not distinctive.
 */
const GENERATED_TREES = [
  '_build/reports/hermetic-gate/runs',
  '_build/reports/final-navigation-boundary/failures',
  '_build/reports/final-navigation-boundary/stress',
  '_build/reports/regression-harness/last-run.json',
];
const isGenerated = (rel) => GENERATED_TREES.some((p) => rel === p || rel.startsWith(`${p}/`));

// iCloud Drive writes "thing 2.ext" next to "thing.ext" when the folder syncs
// from two machines. .gitignore already refuses to commit them and
// scripts/assemble.mjs already keeps them out of dist/, so they are neither
// authored source nor deployed output — but this scan was still reading them,
// and three stale copies of the test suite were enough to fail the gate on
// every run. A gate that is always red is a gate nobody reads.
//
// Same rule as `isDuplicate` in scripts/assemble.mjs and the "* [0-9].*" line
// in .gitignore. Also catches directories, which have no extension to strip.
const isDuplicate = (name) => / \d+$/.test(name.replace(/\.[^.]+$/, ''));

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (isDuplicate(entry.name)) continue;
    const path = join(dir, entry.name);
    if (isGenerated(relative(ROOT, path))) continue;
    if (entry.isDirectory()) await walk(path, out);
    else if (TEXT.test(entry.name)) out.push(path);
  }
  return out;
}

async function main() {
  const files = await walk(ROOT);
  const findings = [];

  for (const file of files) {
    const rel = relative(ROOT, file);
    const body = await readFile(file, 'utf8');
    body.split('\n').forEach((line, i) => {
      for (const rule of RULES) {
        if (!rule.re.test(line)) continue;
        if (DESCRIBES_THE_RULE.has(rel)) continue;
        findings.push({ rel, line: i + 1, rule, text: line.trim().slice(0, 120) });
      }
    });
  }

  console.log(`secret-scan: ${files.length} files, ${RULES.length} rules`);

  if (!findings.length) {
    console.log('secret-scan: clean.');
    return;
  }

  console.error(`\nsecret-scan: ${findings.length} finding(s)\n`);
  for (const f of findings) {
    console.error(`  ${f.rel}:${f.line}  [${f.rule.id}] ${f.rule.note}`);
    console.error(`    ${f.text}`);
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('secret-scan failed:', err);
  process.exit(1);
});
