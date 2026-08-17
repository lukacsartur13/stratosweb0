#!/usr/bin/env node
/**
 * Content-hash the test subject, so a run can be proven to have tested one
 * thing from beginning to end.
 *
 * WHY THIS EXISTS
 * ---------------
 * The previous investigation spent a long time on an `ESTALE` finding and a
 * population of "navigation-shaped" timeouts before discovering that another
 * process had been rebuilding `dist/` underneath the suite while it ran. Every
 * number produced during that window was uninterpretable — not wrong, not
 * right, *uninterpretable* — because pass and fail were being measured against
 * an artefact that was not the same artefact at the end as at the beginning.
 *
 * The detector in place at the time watched CPU. CPU is a fine thing to watch
 * and it is not the thing that invalidates a run. What invalidates a run is the
 * subject changing, and nothing was watching that.
 *
 * So: hashes, not timestamps. A timestamp says a file was written; it does not
 * say the bytes differ, and — the case that actually matters — it does not
 * catch a file that was changed and changed back, which is exactly what a
 * rebuild of unchanged sources looks like. Content hashes catch the first and
 * make the second visible through the mid-run canary in gate-run.mjs.
 *
 * WHAT IS HASHED, AND WHY IN GROUPS
 * ---------------------------------
 * Four groups, because a difference in each means something different:
 *
 *   product   The site and portal sources. A change here means the gate is no
 *             longer testing the product it started with.
 *   test      Specs, helpers, validators. A change here means the gate changed
 *             its own definition of pass mid-flight.
 *   config    Playwright configs, package manifests, lockfiles, netlify.toml.
 *             A change here can silently alter project lists and worker counts,
 *             which changes the collected count and so the arithmetic.
 *   dist      The served artefact. This is the one the browser actually sees,
 *             and the one the previous contamination was in.
 *
 * A single aggregate hash would tell you a run was invalid. Four tell you what
 * touched it, which is the difference between "discard this run" and "stop the
 * process that is writing to dist".
 *
 * WHAT IS DELIBERATELY NOT HASHED
 * -------------------------------
 *   _build/reports/**   The gate writes its own reports there while it runs.
 *                       Hashing them would make every run invalidate itself.
 *   test-results/**     Playwright's own output, same reason.
 *   node_modules/**     Four hundred megabytes and ~50 000 files; hashing it
 *                       per run would cost more than the run. Frozen by the
 *                       lockfiles, which ARE hashed, and by the fact that
 *                       nothing in the gate path runs an install. The
 *                       limitation is stated rather than hidden: a dependency
 *                       mutated in place without touching a lockfile would not
 *                       be caught here.
 *   .git/**             Not the subject. Another session committing in the
 *                       main checkout must not invalidate a gate running in a
 *                       worktree, and the worktree's own files are unaffected
 *                       by that anyway.
 *
 * USAGE
 * -----
 *   node scripts/hermetic/manifest.mjs capture --out <file> [--root <dir>]
 *   node scripts/hermetic/manifest.mjs compare <before.json> <after.json>
 *
 * Exit codes:
 *   0  captured, or compared and IDENTICAL
 *   3  compared and DIFFERENT — the run that spans these two is INVALID
 *   2  usage or I/O error
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Group definitions.
//
// Paths are roots to walk; a root that does not exist is recorded as absent
// rather than skipped silently, because "the tests directory was not there"
// is a fact a gate report should carry.
// ---------------------------------------------------------------------------
const GROUPS = {
  product: [
    'assets', 'en', 'de', 'portal/src', 'portal/index.html', 'portal/public',
    'experiments/src', 'netlify', 'supabase', 'public',
    '_build/pages', '_build/i18n', '_build/partials', '_build/build.py',
  ],
  test: ['tests', 'scripts'],
  config: [
    'playwright.config.ts', 'playwright.full.config.ts',
    'playwright.experiments.config.ts', 'playwright.mountains.config.ts',
    'package.json', 'package-lock.json', 'netlify.toml',
    'portal/package.json', 'portal/package-lock.json', 'portal/tsconfig.json',
    'portal/vite.config.ts',
    'experiments/package.json', 'experiments/package-lock.json',
    'experiments/tsconfig.json',
  ],
  dist: ['dist'],
};

// Root-level HTML pages are product too, and there are ~40 of them; globbing
// them here keeps the group definition honest without listing each by hand.
const ROOT_HTML = /\.html$/;

/**
 * Names that must never enter a hash.
 *
 * `.DS_Store` and `._*` are written by the Finder and by iCloud's own metadata
 * handling at moments nobody controls, and a run invalidated by a Finder window
 * opening is a run invalidated for no reason. `.icloud` placeholders are the
 * stub left when a file has been evicted to the cloud — their presence is worth
 * reporting (see `evicted` below) but their bytes are not the subject's.
 */
const IGNORED_NAMES = new Set(['.DS_Store', '.git', 'node_modules', 'test-results', '.playwright']);
const IGNORED_PREFIX = ['._'];
const IGNORED_SUFFIX = ['.icloud'];

// Report output written by the gate itself, and the gate's own scratch.
const IGNORED_PATHS = [
  join('_build', 'reports'),
  join('scripts', 'webkit-nav', 'out'),
];

const ignored = (name) =>
  IGNORED_NAMES.has(name) ||
  IGNORED_PREFIX.some((p) => name.startsWith(p)) ||
  IGNORED_SUFFIX.some((s) => name.endsWith(s));

function walk(root, base, out, evicted) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ignored(e.name)) {
      if (e.name.endsWith('.icloud')) evicted.push(relative(base, join(root, e.name)));
      continue;
    }
    const full = join(root, e.name);
    const rel = relative(base, full);
    if (IGNORED_PATHS.some((p) => rel === p || rel.startsWith(p + sep))) continue;
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) walk(full, base, out, evicted);
    else if (e.isFile()) {
      const buf = readFileSync(full);
      out.set(rel.split(sep).join('/'), {
        sha: createHash('sha256').update(buf).digest('hex'),
        bytes: buf.length,
      });
    }
  }
}

function hashGroup(base, roots, includeRootHtml = false) {
  const files = new Map();
  const evicted = [];
  const absent = [];
  for (const r of roots) {
    const full = join(base, r);
    if (!existsSync(full)) {
      absent.push(r);
      continue;
    }
    if (statSync(full).isDirectory()) walk(full, base, files, evicted);
    else {
      const buf = readFileSync(full);
      files.set(r, { sha: createHash('sha256').update(buf).digest('hex'), bytes: buf.length });
    }
  }
  if (includeRootHtml) {
    for (const name of readdirSync(base).sort()) {
      if (!ROOT_HTML.test(name) || ignored(name)) continue;
      const buf = readFileSync(join(base, name));
      files.set(name, { sha: createHash('sha256').update(buf).digest('hex'), bytes: buf.length });
    }
  }

  // The group hash is over the sorted `path:sha` lines, so it is stable against
  // directory-read order and changes if a file is added, removed OR edited.
  // Hashing only the concatenated contents would miss a rename.
  const lines = [...files.keys()].sort().map((k) => `${k}:${files.get(k).sha}`);
  return {
    hash: createHash('sha256').update(lines.join('\n')).digest('hex'),
    fileCount: files.size,
    bytes: [...files.values()].reduce((a, f) => a + f.bytes, 0),
    absentRoots: absent,
    evictedPlaceholders: evicted,
    files: Object.fromEntries([...files.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function capture(base, label) {
  const groups = {};
  for (const [name, roots] of Object.entries(GROUPS)) {
    groups[name] = hashGroup(base, roots, name === 'product');
  }
  const commit = (() => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: base, encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  })();
  // The combined hash exists so a report can quote ONE number, and is derived
  // from the four so it cannot disagree with them.
  const combined = createHash('sha256')
    .update(Object.entries(groups).map(([n, g]) => `${n}:${g.hash}`).join('\n'))
    .digest('hex');
  return {
    label: label ?? null,
    root: base,
    commit,
    timestamp: new Date().toISOString(),
    combinedHash: combined,
    groups,
  };
}

function compare(a, b) {
  const problems = [];
  for (const name of Object.keys(GROUPS)) {
    const ga = a.groups[name];
    const gb = b.groups[name];
    if (!ga || !gb) {
      problems.push({ group: name, kind: 'MISSING_GROUP' });
      continue;
    }
    if (ga.hash === gb.hash) continue;

    const before = new Set(Object.keys(ga.files));
    const after = new Set(Object.keys(gb.files));
    const added = [...after].filter((f) => !before.has(f));
    const removed = [...before].filter((f) => !after.has(f));
    const changed = [...after].filter((f) => before.has(f) && ga.files[f].sha !== gb.files[f].sha);
    problems.push({ group: name, kind: 'HASH_CHANGED', added, removed, changed });
  }
  return problems;
}

// ---------------------------------------------------------------------------

const [, , mode, ...rest] = process.argv;
const flag = (name, fallback = null) => {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? fallback : rest[i + 1];
};

if (mode === 'capture') {
  const base = flag('root', process.cwd());
  const manifest = capture(base, flag('label'));
  const out = flag('out');
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  if (out) writeFileSync(out, json);
  else process.stdout.write(json);
  const g = manifest.groups;
  console.error(
    `manifest ${manifest.combinedHash.slice(0, 12)}  ` +
      Object.entries(g).map(([n, v]) => `${n}=${v.hash.slice(0, 8)}(${v.fileCount})`).join(' '),
  );
  process.exit(0);
}

if (mode === 'compare') {
  const [fa, fb] = rest.filter((r) => !r.startsWith('--'));
  if (!fa || !fb || !existsSync(fa) || !existsSync(fb)) {
    console.error('usage: manifest.mjs compare <before.json> <after.json>');
    process.exit(2);
  }
  const a = JSON.parse(readFileSync(fa, 'utf8'));
  const b = JSON.parse(readFileSync(fb, 'utf8'));
  const problems = compare(a, b);
  if (!problems.length) {
    console.log(`SUBJECT IDENTICAL  ${a.combinedHash}`);
    process.exit(0);
  }
  console.error('RUN INVALID — TEST SUBJECT CHANGED DURING EXECUTION');
  for (const p of problems) {
    console.error(`  group ${p.group}: ${p.kind}`);
    for (const f of p.changed ?? []) console.error(`    changed: ${f}`);
    for (const f of p.added ?? []) console.error(`    added:   ${f}`);
    for (const f of p.removed ?? []) console.error(`    removed: ${f}`);
  }
  process.exit(3);
}

console.error('usage: manifest.mjs capture|compare');
process.exit(2);
