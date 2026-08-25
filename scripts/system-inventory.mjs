// =============================================================================
// THE SYSTEM CHAPTER'S CONTENT, INVENTORIED AND THEN AUDITED — phase 5.1, §3,
// §4, §27.
//
// The same instrument `process-inventory.mjs` is, pointed at the other
// structural passage, and written for the same reason: §27 forbids verified
// service information disappearing silently, and the only honest way to say it
// did not is to snapshot the units BEFORE the edit and then check each one
// against its declared destination afterwards.
//
//   --snapshot   PASS 0. Reads the system chapter out of `content.ts` and
//                `messages.ts` in all three locales and writes
//                `inventory-source.json`. Run ONCE, before any production
//                change. The file is committed.
//
//   (default)    Reads that snapshot back, joins it to the classification
//                below, and checks that every unit is where its classification
//                says it is. Writes the audit table the report embeds, and
//                exits non-zero if any unit is unaccounted for.
//
// Usage:  node scripts/system-inventory.mjs --snapshot
//         node scripts/system-inventory.mjs
// =============================================================================

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'experiments', 'src', 'full');
const OUT = join(ROOT, '_build', 'reports', 'luxury-art-direction', 'compression');
const SNAPSHOT = join(OUT, 'inventory-source.json');

/** Where the detail was sent. The same route the process detail went to. */
const DEEP_ROUTE = join(ROOT, '_build', 'pages', 'szolgaltatasok.html');
const DEEP_I18N = join(ROOT, '_build', 'i18n', 'szolgaltatasok.json');
/** What the homepage kept. */
const MESSAGES = join(SRC, 'locales', 'messages.ts');
const CONTENT = join(SRC, 'content.ts');
const HOMEPAGE_TSX = [
  join(SRC, 'FullAscent.tsx'),
  join(SRC, 'mobile', 'MobileHome.tsx'),
];

// -----------------------------------------------------------------------------
// THE CLASSIFICATION — §3's buckets, one row per unit of the system chapter.
//
//   kept       the compressed chapter still shows it, in the picture
//   deep       it moved to DEEP_ROUTE, verbatim
//   retired    it was already not rendered before this phase, and why
//
// A unit that is BOTH moved and a duplicate of something the homepage keeps
// elsewhere carries `duplicate`, naming the line it duplicates. §4 asks for
// exactly that list.
// -----------------------------------------------------------------------------
const CLASSIFICATION = {
  'statement.a':  { to: 'kept', note: 'The passage statement, unchanged, on the spine at 66u.' },
  'statement.em': { to: 'kept', note: 'The passage statement, unchanged. The layer relationship is the one thing only this chapter says.' },
  'support':      { to: 'kept', note: 'The passage support line, unchanged, at the counter axis.' },
  'lead.a':       { to: 'retired', note: 'A caption on the concentric-ring diagram the continuity pass removed. Not rendered before this phase either; left in messages.ts with its note.' },

  'ring.0.name': { to: 'kept', note: 'Layer 1 of 3, now composed in the chapter’s one body beat rather than met alone.' },
  'ring.1.name': { to: 'kept', note: 'Layer 2 of 3, same beat.' },
  'ring.2.name': { to: 'kept', note: 'Layer 3 of 3, same beat.' },
  'ring.0.note': { to: 'kept', note: 'The dependency argument for the core. Verbatim.' },
  'ring.1.note': { to: 'kept', note: 'The dependency argument for the structure. Verbatim.' },
  'ring.2.note': { to: 'kept', note: 'The dependency argument for operation. Verbatim.' },

  'research.name':     { to: 'kept', note: 'Named in the core layer’s line, so `Kilenc` stays a true sentence about the page.' },
  'strategy.name':     { to: 'kept', note: 'Named in the core layer’s line.' },
  'branding.name':     { to: 'kept', note: 'Named in the structure layer’s line.' },
  'website.name':      { to: 'kept', note: 'Named in the structure layer’s line.' },
  'development.name':  { to: 'kept', note: 'Named in the structure layer’s line.' },
  'ads.name':          { to: 'kept', note: 'Named in the operation layer’s line.' },
  'analytics.name':    { to: 'kept', note: 'Named in the operation layer’s line.' },
  'optimisation.name': { to: 'kept', note: 'Named in the operation layer’s line.' },
  'automation.name':   { to: 'kept', note: 'Named in the operation layer’s line.' },

  'research.blurb': {
    to: 'deep',
    note: 'Moved verbatim to §06 of the services route, under its own layer heading.',
  },
  'strategy.blurb': {
    to: 'deep',
    duplicate: 'Act III’s capability ladder: `Előbb eldöntjük, mit érdemes megépíteni. A többi ebből következik.` — and the core layer’s own note repeats its second clause word for word (`Ez dönti el a többit.`).',
    note: 'Moved verbatim to §06 of the services route.',
  },
  'branding.blurb': {
    to: 'deep',
    note: 'Moved verbatim to §06 of the services route.',
  },
  'website.blurb': {
    to: 'deep',
    note: 'Moved verbatim to §06 of the services route.',
  },
  'development.blurb': {
    to: 'deep',
    duplicate: 'Act III’s capability ladder: `Egyedi kód, mérhető sebesség. Nem sablon, amit hetente frissíteni kell.`',
    note: 'Moved verbatim to §06 of the services route.',
  },
  'ads.blurb': {
    to: 'deep',
    duplicate: 'Act III’s capability ladder: `Forgalmat oda küldünk, ahol már van mit fogadnia.` — the same sentence in the other voice.',
    note: 'Moved verbatim to §06 of the services route.',
  },
  'analytics.blurb': {
    to: 'deep',
    note: 'Moved verbatim to §06 of the services route.',
  },
  'optimisation.blurb': {
    to: 'deep',
    note: 'Moved verbatim to §06 of the services route.',
  },
  'automation.blurb': {
    to: 'deep',
    duplicate: 'Act III’s capability ladder: `Ami ismétlődik, az fusson magától.`',
    note: 'Moved verbatim to §06 of the services route.',
  },
};

// -----------------------------------------------------------------------------

async function loadContentModule() {
  const requireFromExperiments = createRequire(join(ROOT, 'experiments', 'package.json'));
  const { build } = await import(pathToFileURL(requireFromExperiments.resolve('vite')).href);
  const result = await build({
    logLevel: 'silent',
    resolve: { alias: { '@': join(ROOT, 'experiments', 'src') } },
    build: { write: false, ssr: join(SRC, 'content.ts'), rollupOptions: { output: { format: 'es' } } },
  });
  const chunk = (Array.isArray(result) ? result[0] : result).output.find((o) => o.type === 'chunk');
  return import('data:text/javascript;base64,' + Buffer.from(chunk.code).toString('base64'));
}

async function localeTable(lang) {
  const mod = await import(pathToFileURL(join(SRC, 'locales', `${lang}.ts`)).href);
  return mod[lang.toUpperCase()] ?? {};
}

/** The four message keys the chapter carries outside `content.ts`. */
const MESSAGE_UNITS = [
  { id: 'statement.a', role: 'statement', key: 'system.title.a' },
  { id: 'statement.em', role: 'statement', key: 'system.title.em' },
  { id: 'support', role: 'support', key: 'system.lead.b' },
  { id: 'lead.a', role: 'retired lead', key: 'system.lead.a' },
  { id: 'ring.0.name', role: 'layer name', key: 'system.ring.0.name' },
  { id: 'ring.1.name', role: 'layer name', key: 'system.ring.1.name' },
  { id: 'ring.2.name', role: 'layer name', key: 'system.ring.2.name' },
  { id: 'ring.0.note', role: 'layer note', key: 'system.ring.0.note' },
  { id: 'ring.1.note', role: 'layer note', key: 'system.ring.1.note' },
  { id: 'ring.2.note', role: 'layer note', key: 'system.ring.2.note' },
];

/**
 * The message strings, read out of `messages.ts` as source text rather than by
 * importing it — the module pulls in the whole i18n runtime, and all this needs
 * is the three locale literals under a key.
 */
async function messageStrings() {
  const src = await readFile(MESSAGES, 'utf8');
  const out = {};
  for (const { key } of MESSAGE_UNITS) {
    const at = src.indexOf(`'${key}':`);
    if (at < 0) { out[key] = null; continue; }
    const window_ = src.slice(at, at + 900);
    const pick = (lang) => {
      const m = window_.match(new RegExp(`\\b${lang}:\\s*'((?:[^'\\\\]|\\\\.)*)'`));
      return m ? m[1].replace(/\\'/g, "'") : null;
    };
    out[key] = { hu: pick('hu'), en: pick('en'), de: pick('de') };
  }
  return out;
}

async function snapshot() {
  const mod = await loadContentModule();
  const system = mod.SOURCE_TABLES?.SYSTEM_HU;
  if (!system) throw new Error('content.ts no longer exports SOURCE_TABLES.SYSTEM_HU');
  const en = await localeTable('en');
  const de = await localeTable('de');
  const say = (hu) => ({ hu, en: en[hu] ?? null, de: de[hu] ?? null });

  const msgs = await messageStrings();
  const units = [];
  for (const u of MESSAGE_UNITS) {
    const s = msgs[u.key];
    if (!s) throw new Error(`messages.ts no longer carries ${u.key}`);
    units.push({ id: u.id, role: u.role, source: u.key, ...s });
  }
  for (const n of system) {
    // PASS 0 CAN ONLY BE RUN ONCE, AND THIS IS THE LOCK.
    //
    // `SystemNode.blurb` is the field phase 5.1 removed. Re-running --snapshot
    // after the change would overwrite the committed before-state with a table
    // of nulls and quietly turn the audit into a tautology, so it refuses
    // instead. The snapshot is the measurement; it is not regenerated.
    if (typeof n.blurb !== 'string') {
      throw new Error(
        'content.ts no longer carries SYSTEM[].blurb — the snapshot is the phase 5.1 '
        + 'before-state and must not be retaken. Delete this guard only if a later phase '
        + 'is deliberately establishing a new baseline.',
      );
    }
    units.push({ id: `${n.id}.name`, role: `area name (ring ${n.ring})`, source: 'content.ts SYSTEM', ...say(n.name) });
    units.push({ id: `${n.id}.blurb`, role: `area line (ring ${n.ring})`, source: 'content.ts SYSTEM', ...say(n.blurb) });
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(SNAPSHOT, JSON.stringify({ takenAt: 'phase 5.1 · pass 0', units }, null, 2) + '\n', 'utf8');
  const gaps = units.filter((u) => !u.en || !u.de);
  console.log(`snapshot: ${units.length} units, ${gaps.length} without a full translation`);
  console.log(`  -> ${SNAPSHOT}`);
}

/**
 * The homepage sources WITHOUT their comments.
 *
 * This matters for one direction of the audit and it is the direction that
 * catches real mistakes: a sentence classified as MOVED must not still be in
 * the homepage source. Every note in this codebase quotes the copy it is
 * about — `content.ts` names the four duplicated sentences in as many words —
 * so a plain substring search over the file reports a sentence as still
 * shipping when what it found was the note explaining that it does not.
 *
 * Quote-aware rather than a pair of regexes, because a `//` inside a URL and a
 * `/*` inside a string are both in these files. Template literals are treated
 * as strings; there are no regex literals in the three sources this reads, and
 * a `/` outside a string is only ever a comment opener or a divide — neither of
 * which can swallow a Hungarian sentence.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

async function audit() {
  const snap = JSON.parse(await readFile(SNAPSHOT, 'utf8'));
  const deepHtml = await readFile(DEEP_ROUTE, 'utf8');
  const deepI18n = JSON.parse(await readFile(DEEP_I18N, 'utf8'));
  let homepage = stripComments(await readFile(MESSAGES, 'utf8'))
    + stripComments(await readFile(CONTENT, 'utf8'));
  for (const f of HOMEPAGE_TSX) homepage += stripComments(await readFile(f, 'utf8'));

  const inDeep = (hu) => deepHtml.includes(hu) || Object.hasOwn(deepI18n, hu);
  const inHomepage = (hu) => homepage.includes(hu);

  const rows = [];
  const failures = [];
  for (const u of snap.units) {
    const c = CLASSIFICATION[u.id];
    if (!c) { failures.push(`${u.id} · "${u.hu}" has no classification`); continue; }
    let held = null;
    if (c.to === 'deep') {
      held = inDeep(u.hu);
      if (inHomepage(u.hu)) {
        failures.push(`${u.id} · classified deep but "${u.hu}" is still in the homepage source`);
      }
    } else if (c.to === 'kept') {
      held = inHomepage(u.hu);
    }
    if (held === false) {
      failures.push(`${u.id} · classified ${c.to} but "${u.hu}" is not at its destination`);
    }
    rows.push({ ...u, to: c.to, note: c.note, duplicate: c.duplicate ?? null, held });
  }

  const tally = rows.reduce((t, r) => ({ ...t, [r.to]: (t[r.to] ?? 0) + 1 }), {});
  const dupes = rows.filter((r) => r.duplicate);

  const md = [
    '<!-- generated by scripts/system-inventory.mjs — do not edit by hand -->',
    '',
    `${rows.length} units in the system chapter before phase 5.1. `
    + Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(' · '),
    '',
    '| id | role | Hungarian source | classification | where it is now |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((r) =>
      `| ${r.id} | ${r.role} | ${r.hu.replace(/\|/g, '\\|')} | **${r.to}** | ${r.note.replace(/\|/g, '\\|')} |`),
    '',
    `## SEMANTIC DUPLICATION (§4) — ${dupes.length} units`,
    '',
    '| id | Hungarian source | what it repeats |',
    '| --- | --- | --- |',
    ...dupes.map((r) => `| ${r.id} | ${r.hu.replace(/\|/g, '\\|')} | ${r.duplicate.replace(/\|/g, '\\|')} |`),
    '',
  ].join('\n');

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'content-audit.md'), md, 'utf8');
  await writeFile(join(OUT, 'content-audit.json'), JSON.stringify({ tally, rows, failures }, null, 2) + '\n', 'utf8');

  console.log(`audit: ${rows.length} units · ` + Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(' · '));
  console.log(`  -> ${join(OUT, 'content-audit.md')}`);
  if (failures.length) {
    console.error(`\n${failures.length} unaccounted for:`);
    for (const f of failures) console.error('  ' + f);
    process.exitCode = 1;
  } else {
    console.log('  every unit is accounted for.');
  }
}

await (process.argv.includes('--snapshot') ? snapshot() : audit());
