// =============================================================================
// Write the homepage's outstanding translations to _build/missing-meridian-*.json.
//
//     npm run i18n:meridian
//
// WHY THIS IS SEPARATE FROM _build/missing-{en,de}.json
// -----------------------------------------------------
// Those two are written by _build/build.py and describe the eleven *generated*
// pages. The homepage is no longer one of them — it is a Vite build now — so a
// translator working from those files would see no homepage strings at all and
// conclude the homepage was done. Two files, two owners, no file written by two
// processes.
//
// The shape is identical to the Python build's: `{ "<hungarian source>": "" }`,
// keyed on the Hungarian sentence, so the same person can work through both
// with the same habits. Filling one in means copying the pair into
// experiments/src/full/locales/<lang>.ts.
//
// HOW THE STRINGS ARE FOUND
// -------------------------
// By collecting them from the content modules through the same `localise` walk
// the application itself uses, executed by Vite so the TypeScript is real
// TypeScript rather than something a regex guessed at. That matters: a regex
// over content.ts silently misses template literals and silently invents
// matches inside comments, and this file is a person's worklist.
// =============================================================================

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Vite is a dependency of `experiments/`, not of the repository root, and Node
// resolves a bare specifier from the importing *file's* directory — which is
// `scripts/`, where there is no `vite`. Anchoring a require at the experiments
// package resolves it where it actually lives, without adding a second copy to
// the root package.json for the sake of one reporting script.
const requireFromExperiments = createRequire(join(ROOT, 'experiments', 'package.json'));
const { build } = await import(pathToFileURL(requireFromExperiments.resolve('vite')).href);
const SRC = join(ROOT, 'experiments', 'src', 'full');
const OUT = join(ROOT, '_build');

const LANGS = ['en', 'de'];

/**
 * Every user-visible string in a content structure, in document order.
 *
 * `skip` is `NON_COPY_KEYS`, imported from the same bundle rather than
 * redeclared here — see content.ts for why. Without it this walk collects `id`
 * and `src` values, and the worklist asks a translator to translate
 * `/assets/img/work-1.jpg`.
 */
function collect(value, into, skip) {
  if (typeof value === 'string') {
    if (value.trim()) into.add(value);
    return into;
  }
  if (Array.isArray(value)) {
    for (const v of value) collect(v, into, skip);
    return into;
  }
  if (value && typeof value === 'object' && value.constructor === Object) {
    for (const [k, v] of Object.entries(value)) if (!skip.has(k)) collect(v, into, skip);
  }
  return into;
}

/**
 * Bundle the content modules to plain JS so Node can import them.
 *
 * `content.ts` imports `./i18n`, which reads `document` — so the bundle is
 * built for SSR and `i18n.ts` guards its detection with a `typeof document`
 * check that resolves to Hungarian here. Hungarian is exactly what we want: the
 * source strings, untranslated.
 */
async function loadSource() {
  const entry = join(SRC, 'content.ts');
  const result = await build({
    logLevel: 'silent',
    resolve: { alias: { '@': join(ROOT, 'experiments', 'src') } },
    build: {
      write: false,
      ssr: entry,
      rollupOptions: { output: { format: 'es' } },
    },
  });
  const chunk = (Array.isArray(result) ? result[0] : result).output.find((o) => o.type === 'chunk');
  const mod = await import(
    'data:text/javascript;base64,' + Buffer.from(chunk.code).toString('base64')
  );
  return mod;
}

async function main() {
  const mod = await loadSource();
  const source = mod.SOURCE_TABLES;
  if (!source) throw new Error('content.ts no longer exports SOURCE_TABLES');
  const skip = mod.NON_COPY_KEYS;
  if (!skip) throw new Error('content.ts no longer re-exports NON_COPY_KEYS');

  const strings = [...collect(source, new Set(), skip)].sort((a, b) => a.localeCompare(b, 'hu'));

  await mkdir(OUT, { recursive: true });
  let report = [];

  for (const lang of LANGS) {
    // The locale tables are .ts modules (see locales/en.ts for why), so the
    // already-filled keys are read by importing the module rather than by
    // parsing JSON.
    const tablePath = join(SRC, 'locales', `${lang}.ts`);
    let table = {};
    if (existsSync(tablePath)) {
      const mod = await import(pathToFileURL(tablePath).href).catch(() => null);
      table = mod ? (mod[lang.toUpperCase()] ?? {}) : {};
    }

    const missing = {};
    for (const s of strings) if (!table[s]) missing[s] = '';

    const file = join(OUT, `missing-meridian-${lang}.json`);
    await writeFile(file, JSON.stringify(missing, null, 1) + '\n', 'utf8');
    report.push(`${lang}: ${Object.keys(missing).length}/${strings.length} untranslated`);
  }

  console.log(`meridian i18n: ${strings.length} source strings`);
  for (const line of report) console.log('  ' + line);
  console.log(`  -> _build/missing-meridian-{${LANGS.join(',')}}.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
