// =============================================================================
// Portal translations — what is missing.
//
//     node scripts/i18n-check.mjs            every file
//     node scripts/i18n-check.mjs pages/sales.tsx features/payments   only these
//     node scripts/i18n-check.mjs --strict   exit 1 on any finding
//
// 1. MISSING  every literal `t('…')` key must have its translations in
//             portal/src/i18n/parts/*.json: an English-source key needs `hu`
//             and `de`, a Hungarian-source key (client portal) `en` and `de`.
// 2. BARE     text a person reads that is not wrapped in `t()`: JSX text and
//             the usual text props (title, label, placeholder, …). A heuristic:
//             it lists candidates, a person decides.
//
// Keys are the source text; see portal/src/lib/i18n.ts.
// =============================================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(import.meta.dirname, '..', 'portal', 'src');
const PARTS = join(SRC, 'i18n', 'parts');
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const only = args.filter((a) => !a.startsWith('--'));

// Written in Hungarian: the client portal.
// (ClientAccountsPanel sits in that folder but is the owner's, in English.)
const HUNGARIAN_SOURCE = [/^features\/client\/(ClientApp|HelpChat|AcceptInvite)\.tsx$/, /^lib\/clientPortal\.ts$/];
const HU_CHARS = /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/;

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  if (statSync(full).isDirectory()) return name === 'i18n' ? [] : walk(full);
  return /\.(tsx?|mjs)$/.test(name) && !/ \d\./.test(name) && !name.endsWith('.d.ts') ? [full] : [];
});

const files = walk(SRC)
  .map((f) => relative(SRC, f))
  .filter((f) => only.length === 0 || only.some((o) => f.startsWith(o)));

// 3. CONFLICT  the same key translated differently in two parts: the
//              dictionary keeps one, so which one shows would be an accident.
const dict = {};
const seen = {};
for (const name of readdirSync(PARTS).filter((n) => n.endsWith('.json'))) {
  const part = JSON.parse(readFileSync(join(PARTS, name), 'utf8'));
  for (const [key, langs] of Object.entries(part)) {
    dict[key] = { ...(dict[key] ?? {}), ...langs };
    for (const [lang, text] of Object.entries(langs)) (seen[`${lang}\u0000${key}`] ??= new Set()).add(text);
  }
}
const conflicts = Object.entries(seen).filter(([, v]) => v.size > 1)
  .map(([k, v]) => ({ lang: k.split('\u0000')[0], key: k.split('\u0000')[1], texts: [...v] }));

// The first argument of t(...) when it is a plain string literal.
const CALL = /\bt(?:c\(\s*'[\w-]+'\s*,|\()\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.)*)`)/g;
const unescape = (s) => s.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`').replace(/\\\\/g, '\\');

const missing = [];
const bare = [];
for (const file of files) {
  const source = readFileSync(join(SRC, file), 'utf8');
  const hungarianFile = HUNGARIAN_SOURCE.some((r) => r.test(file));
  for (const m of source.matchAll(CALL)) {
    const key = unescape(m[1] ?? m[2] ?? m[3]);
    const need = hungarianFile || HU_CHARS.test(key) ? ['en', 'de'] : ['hu', 'de'];
    const lacking = need.filter((l) => !dict[key]?.[l]);
    if (lacking.length) missing.push({ file, key, lacking });
  }
  source.split('\n').forEach((line, i) => {
    const l = line.trim();
    if (/^(\/\/|\*|\/\*|import |export \{|console\.|throw )/.test(l)) return;
    if (/\bt\(/.test(l) && !/>[^<{}]*[A-Za-zÀ-ű]{3,}[^<{}]*</.test(l.replace(/\{t\([^)]*\)\}/g, ''))) return;
    const jsxText = /(^|>)\s*([A-Za-zÀ-ű][^<>{}=;]*[A-Za-zÀ-ű.!?:)])\s*(<|$)/.exec(l);
    const prop = /\b(title|label|placeholder|description|note|hint|body|aria-label|alt)="([A-Za-zÀ-ű][^"]*\s[^"]*)"/.exec(l);
    const looksLikeCode = /^[\w.]+\s*[(=:]|=>|^(const|let|return|if|else|case|for|type|interface|function)\b|[;{}]$/.test(l);
    if (prop) bare.push({ file, line: i + 1, text: prop[2] });
    else if (jsxText && file.endsWith('.tsx') && !looksLikeCode && /\s/.test(jsxText[2])) {
      bare.push({ file, line: i + 1, text: jsxText[2] });
    }
  });
}

if (conflicts.length) {
  console.log(`CONFLICTING translations (${conflicts.length}):`);
  for (const c of conflicts) console.log(`  [${c.lang}] ${JSON.stringify(c.key)} → ${c.texts.map((x) => JSON.stringify(x)).join(' | ')}`);
}
if (missing.length) {
  console.log(`MISSING translations (${missing.length}):`);
  for (const m of missing) console.log(`  ${m.file}: ${JSON.stringify(m.key)} → needs ${m.lacking.join(', ')}`);
}
if (bare.length) {
  console.log(`\nBARE text, probably not wrapped in t() (${bare.length}):`);
  for (const b of bare) console.log(`  ${b.file}:${b.line}  ${b.text.slice(0, 90)}`);
}
console.log(`\n${files.length} files · ${Object.keys(dict).length} dictionary keys · ${conflicts.length} conflicts · ${missing.length} missing · ${bare.length} bare candidates`);
process.exit(conflicts.length || (strict && (missing.length || bare.length)) ? 1 : 0);
