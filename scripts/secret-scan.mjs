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
];

// Lines that name a rule in order to forbid it: this scanner, the tests that
// assert the absence, and the prose that explains why. A finding is a value, not
// a mention, and these files carry mentions on purpose.
const DESCRIBES_THE_RULE = new Set([
  'scripts/secret-scan.mjs',
  'tests/lead-forms.spec.ts',
  'tests/lead-endpoint.spec.ts',
  'tests/portal.spec.ts',
  'README.md',
  '.env.example',
  'ARCHITECTURE.md',
  'netlify/functions/submit-lead.mjs',
  'supabase/migrations/20260801000200_rls.sql',
]);

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
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
