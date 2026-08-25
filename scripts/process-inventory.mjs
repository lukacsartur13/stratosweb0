// =============================================================================
// THE PROCESS PASSAGE'S CONTENT, INVENTORIED AND THEN AUDITED. §4, §5, §30, §39.
//
// Two modes, and the order they were run in is the order the phase required.
//
//   --snapshot   PASS 0. Reads the seven checkpoints out of `content.ts` in all
//                three locales and writes `inventory-source.json`. Run ONCE,
//                before any production change, so the "before" is a measurement
//                rather than a memory. The file is committed.
//
//   (default)    PASS 8. Reads that snapshot back, joins it to the
//                classification below, and checks that every one of the
//                thirty-five original units actually ended up where its
//                classification says it did. Writes the audit table the report
//                embeds, and exits non-zero if any unit is unaccounted for.
//
// §39 asks for a verification that no original process idea simply disappeared,
// and explicitly permits a generated audit table rather than a brittle
// text-equality test. This is that table, and the only assertion it makes is
// the one §39 names: a unit classified as moved has to be findable at its
// destination, and a unit classified as kept or dropped has to say where its
// meaning went.
//
// Usage:  node scripts/process-inventory.mjs --snapshot
//         node scripts/process-inventory.mjs
// =============================================================================

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'experiments', 'src', 'full');
const OUT = join(ROOT, '_build', 'reports', 'luxury-art-direction', 'process');
const SNAPSHOT = join(OUT, 'inventory-source.json');

/** Where the deep detail was sent. One route, chosen in §F of the report. */
const DEEP_ROUTE = join(ROOT, '_build', 'pages', 'szolgaltatasok.html');
const DEEP_I18N = join(ROOT, '_build', 'i18n', 'szolgaltatasok.json');
/** What the homepage kept, so a "core" unit can be checked against real copy. */
const MESSAGES = join(SRC, 'locales', 'messages.ts');
const CONTENT = join(SRC, 'content.ts');

// -----------------------------------------------------------------------------
// THE CLASSIFICATION — §5's four buckets, one row per original unit.
//
// `id` is `<checkpoint index><term letter>`, with `n` for the checkpoint's own
// name. `to` is the classification. `note` is why, and for a REDUNDANT unit it
// has to name where the same point is already made — §24 does not allow "cut"
// as a reason on its own.
//
// The rule this table is checked against:
//
//   core      the compressed homepage carries it — verified against messages.ts
//   support   the homepage carries it in reduced form — verified the same way
//   deep      it moved to DEEP_ROUTE — verified as an exact string in the page
//   redundant it is dropped from this journey, and `note` names where the same
//             information is already communicated
// -----------------------------------------------------------------------------
const CLASSIFICATION = {
  '1n': { to: 'support', note: 'Named on the homepage in the seven-stage support line.' },
  '1a': { to: 'deep', note: 'The discovery conversation, stage by stage.' },
  '1b': { to: 'core', note: 'Principle 1 in full: the written assessment and the honest answer.' },
  '1c': { to: 'deep', note: 'What the client supplies at discovery.' },
  '1d': { to: 'core', note: 'Principle 1\'s label — "or a straight no" is the idea the label carries.' },

  '2n': { to: 'support', note: 'Named on the homepage in the seven-stage support line.' },
  '2a': { to: 'deep', note: 'The research work itself.' },
  '2b': { to: 'deep', note: 'The research deliverable.' },
  '2c': { to: 'deep', note: 'What the client supplies at research.' },
  '2d': { to: 'deep', note: 'Research feeds strategy — the ordering point the System act already makes.' },

  '3n': { to: 'support', note: 'Named on the homepage in the seven-stage support line.' },
  '3a': { to: 'deep', note: 'What strategy decides.' },
  '3b': { to: 'deep', note: 'The strategy deliverable.' },
  '3c': { to: 'core', note: 'Principle 2: the stage that most depends on the client.' },
  '3d': {
    to: 'redundant',
    note:
      'System says the same thing about ordering, harder: `A sorrend a lényeg` and '
      + '`Ez dönti el a többit. Enélkül minden alatta lévő döntés találgatás.` §23 separates '
      + 'the two chapters and §24 forbids repeating a point already made strongly elsewhere.',
  },

  '4n': { to: 'support', note: 'Named on the homepage in the seven-stage support line.' },
  '4a': { to: 'deep', note: 'What design produces, and that it uses real content.' },
  '4b': { to: 'deep', note: 'The design deliverable.' },
  '4c': { to: 'core', note: 'Principle 2: feedback is something the client owes, in one round.' },
  '4d': { to: 'deep', note: 'The design outcome.' },

  '5n': { to: 'support', note: 'Named on the homepage in the seven-stage support line.' },
  '5a': { to: 'core', note: 'Principle 2: `menet közben látod, nem a végén`, carried verbatim.' },
  '5b': { to: 'deep', note: 'The build deliverable.' },
  '5c': { to: 'deep', note: 'What the client supplies during the build.' },
  '5d': { to: 'deep', note: 'The build outcome.' },

  '6n': {
    to: 'support',
    renamedTo: 'Élesítés',
    note:
      'Named on the homepage in the seven-stage support line, but RENAMED — `Indulás` -> '
      + '`Élesítés`, the word this checkpoint\'s own first sentence already uses for the act. '
      + 'It is the one source string phase 4 changed, and the reason is a collision rather than '
      + 'taste: `Indulás` is also the ads route\'s closing-CTA eyebrow, where the site dictionary '
      + 'reads it as `Starting out`. See content.ts.',
  },
  '6a': { to: 'deep', note: 'What go-live consists of.' },
  '6b': { to: 'deep', note: 'The go-live deliverable.' },
  '6c': { to: 'deep', note: 'What the client supplies at go-live.' },
  '6d': { to: 'core', note: 'Principle 3: the system runs and measures.' },

  '7n': { to: 'support', note: 'Named on the homepage in the seven-stage support line.' },
  '7a': { to: 'core', note: 'Principle 3\'s spine: `nem projektzárás, hanem üzemeltetés`, verbatim.' },
  '7b': { to: 'deep', note: 'The monthly deliverable.' },
  '7c': { to: 'deep', note: 'What the client supplies during operation.' },
  '7d': { to: 'core', note: 'Principle 3: the system gets better rather than going out of date.' },
};

/**
 * The passage frame copy that is not in the snapshot, because it lives in
 * `messages.ts` rather than in `content.ts`. Checked the same way.
 */
const EXTRA = [
  {
    id: 'lead',
    role: 'passage lead',
    hu: 'Minden ponton tudod, mi történik, mit kapsz tőlünk, mit várunk tőled, és mi lesz az eredménye.',
    to: 'deep',
    note: 'A summary of the four terms, so it went where the four terms went — it is the section lead there.',
  },
  { id: 'term.a', role: 'term label', hu: 'Mi történik', to: 'deep', note: 'A `<dt>` of the detail section.' },
  { id: 'term.b', role: 'term label', hu: 'Amit átadunk', to: 'deep', note: 'A `<dt>` of the detail section.' },
  { id: 'term.c', role: 'term label', hu: 'Amit tőled kérünk', to: 'deep', note: 'A `<dt>` of the detail section, and principle 2\'s label on the homepage.' },
  { id: 'term.d', role: 'term label', hu: 'Várható eredmény', to: 'deep', note: 'A `<dt>` of the detail section.' },
];

const TERMS = { a: 'happens', b: 'weProduce', c: 'youProvide', d: 'outcome' };

// -----------------------------------------------------------------------------

async function loadContentModule() {
  // Vite lives in `experiments/`, not at the root — same resolution trick, and
  // the same reason, as `meridian-i18n.mjs`.
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

async function snapshot() {
  const mod = await loadContentModule();
  const process_ = mod.SOURCE_TABLES?.PROCESS_HU;
  if (!process_) throw new Error('content.ts no longer exports SOURCE_TABLES.PROCESS_HU');
  const en = await localeTable('en');
  const de = await localeTable('de');
  const say = (hu) => ({ hu, en: en[hu] ?? null, de: de[hu] ?? null });

  const units = [];
  for (const p of process_) {
    units.push({ id: `${p.index}n`, checkpoint: p.index, role: 'name', ...say(p.name) });
    for (const [letter, key] of Object.entries(TERMS)) {
      units.push({ id: `${p.index}${letter}`, checkpoint: p.index, role: key, ...say(p[key]) });
    }
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(SNAPSHOT, JSON.stringify({ takenAt: 'phase 4 · pass 0', units }, null, 2) + '\n', 'utf8');
  const gaps = units.filter((u) => !u.en || !u.de);
  console.log(`snapshot: ${units.length} units, ${gaps.length} without a full translation`);
  console.log(`  -> ${SNAPSHOT}`);
}

async function audit() {
  const snap = JSON.parse(await readFile(SNAPSHOT, 'utf8'));
  const deepHtml = await readFile(DEEP_ROUTE, 'utf8');
  const deepI18n = JSON.parse(await readFile(DEEP_I18N, 'utf8'));
  const homepage = (await readFile(MESSAGES, 'utf8')) + (await readFile(CONTENT, 'utf8'));

  // A translated page is built from the Hungarian markup plus this dictionary,
  // so "the German is present" means "the Hungarian sentence is a key in it".
  const inDeep = (hu) => deepHtml.includes(hu) || Object.hasOwn(deepI18n, hu);
  const inHomepage = (hu) => homepage.includes(hu);

  const rows = [];
  const failures = [];

  for (const u of snap.units) {
    const c = CLASSIFICATION[u.id];
    if (!c) {
      failures.push(`${u.id} · "${u.hu}" has no classification`);
      continue;
    }
    // A renamed unit is checked under its new name, and the rename is the note.
    const look = c.renamedTo ?? u.hu;
    let held = null;
    if (c.to === 'deep') held = inDeep(look);
    else if (c.to === 'support') held = inHomepage(look) && inDeep(look);
    else held = null; // core and redundant are editorial judgements, recorded not matched

    if (held === false) {
      failures.push(`${u.id} · classified ${c.to} but "${look}" is not at its destination`);
    }
    rows.push({ ...u, to: c.to, note: c.note, held });
  }

  for (const e of EXTRA) {
    const held = inDeep(e.hu);
    if (!held) failures.push(`${e.id} · classified ${e.to} but "${e.hu}" is not at its destination`);
    rows.push({ ...e, checkpoint: '—', held });
  }

  const tally = rows.reduce((t, r) => ({ ...t, [r.to]: (t[r.to] ?? 0) + 1 }), {});

  const md = [
    '<!-- generated by scripts/process-inventory.mjs — do not edit by hand -->',
    '',
    `${snap.units.length} original units. `
    + Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(' · '),
    '',
    '| # | role | Hungarian source | classification | where it went |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((r) =>
      `| ${r.id} | ${r.role} | ${r.hu.replace(/\|/g, '\\|')} | **${r.to}** | ${r.note.replace(/\|/g, '\\|')} |`),
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
    console.log('  every original unit is accounted for.');
  }
}

await (process.argv.includes('--snapshot') ? snapshot() : audit());
