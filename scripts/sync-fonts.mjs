// =============================================================================
// Bring the self-hosted typefaces into assets/fonts/.
//
//     node scripts/sync-fonts.mjs           download + write the manifest
//     node scripts/sync-fonts.mjs --check   verify what is committed matches
//
// Why self-hosted at all
// ----------------------
// The site used to pull Archivo and JetBrains Mono from the Google Fonts CDN on
// every page. Self-hosting removes a third-party origin from the critical path,
// removes two DNS+TLS handshakes before any text can paint, and lets
// `font-src`/`style-src` in netlify.toml drop `fonts.googleapis.com` and
// `fonts.gstatic.com` altogether.
//
// Why these faces
// ---------------
// The Phase 6 brief specifies ABC Arizona, ABC Diatype and ABC Diatype Mono.
// None of the three is present in this repository, there is no licence for any
// of them, and they are commercial Dinamo releases that cannot be obtained from
// here. See FONTS.md for the full audit and for exactly what has to be dropped
// in to reach the intended typography.
//
// Archivo and JetBrains Mono are the *operating* tier, not a placeholder for a
// missing axis: Archivo is a true variable font with both a weight axis
// (100-900) and a width axis (62-125%), which is what the kinetic typography in
// §6.7/6.8 actually needs. A system-font fallback stack has no axes at all and
// would have left the signature behaviour unimplementable.
//
// Aboreto is the third, and it is not part of that tier at all: it sets the
// Stratos wordmark and nothing else. That is a brand rule, not a typographic
// preference — the mark is always Aboreto — so it is fetched here rather than
// left to a CDN or, as it was until now, simply named in CONTENT_GUIDE.md while
// the wordmark actually rendered in Archivo. One weight, no italic, no axes,
// two subsets, 15 kB.
//
// All three are SIL Open Font License 1.1, which permits redistribution
// including self-hosting. The licence text is downloaded alongside the binaries
// and is committed with them, because OFL §2 requires it to travel with them.
//
// Subsetting
// ----------
// Only `latin` and `latin-ext` are kept. That is a deliberate, checked decision
// rather than a default:
//
//   * English and German need `latin` only — ä ö ü ß are all U+00E4/F6/FC/DF.
//   * Hungarian needs `latin-ext` for ő (U+0151) and ű (U+0171); every other
//     Hungarian accent lives in `latin`.
//
// Cyrillic, Greek and Vietnamese are dropped, which is most of the transfer.
// =============================================================================

import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONT_DIR = join(ROOT, 'assets', 'fonts');
const MANIFEST = join(FONT_DIR, 'MANIFEST.json');

// A browser UA, because the Google Fonts CSS endpoint serves TTF to anything it
// does not recognise and WOFF2 only to modern browsers.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* The two subsets that cover Hungarian, English and German, and nothing else:
   `latin` whole, and `latin-ext` pinned to four characters. See below. */

// -----------------------------------------------------------------------------
// latin-ext, pinned to the four characters that are actually in it
//
// Google's `latin-ext` subset is a whole extended-Latin alphabet — Polish,
// Czech, Turkish, Welsh, Vietnamese diacritics and about a thousand others. For
// Archivo, with a weight axis and a width axis, that is 86 kB of the 176 kB of
// Archivo this site ships.
//
// A scan of every built page, in all three languages, finds exactly THREE
// characters above U+00FF anywhere in the site's prose: ő, ű and Ű. Everything
// else people assume is "extended" — the em dash, the thin space, the Hungarian
// quotation marks, the ellipsis, the euro sign — is inside the plain `latin`
// range and always was. So `latin-ext` was being downloaded, on the English
// homepage too (the word "Győr" is in its title), to draw three letters.
//
// `&text=` on the Google CSS endpoint returns exactly those glyphs:
//
//     archivo-normal-latin-ext      85,856 ->  5,240 bytes
//     archivo-italic-latin-ext      93,252 ->  6,252
//     jetbrains-mono-normal-…       15,204 ->  1,876
//     aboreto-normal-latin-ext       4,768 ->  1,040
//
// Ő is included although nothing sets it today: it is the capital of a letter
// the site uses constantly, and a headline is one `text-transform` away from
// needing it.
//
// The fifth character is a rightwards arrow, and it is here because the check
// below found it. Google's published `latin` range covers U+2191 and U+2193 but
// NOT U+2192 — an omission nothing on this site had noticed, so every "→" in
// nine pages of prose was being drawn in Arial beside Archivo. It is 300 bytes
// to fix in the file that already had to be fetched for ő.
//
// WHAT MAKES THIS SAFE TO PIN
// ---------------------------
// `scripts/font-coverage.mjs` runs at the end of every build and fails it if
// any built page contains a character this subset no longer covers. A fifth
// letter arriving in a blog post is therefore a red build with the file and the
// character named in it, not a page that quietly sets one word in Arial.
const LATIN_EXT_TEXT = 'őŐűŰ→';

// Declared by us rather than copied from the response. Google's `&text=` reply
// widens the range to the composition bases as well — `U+4f, U+55, U+6f, U+75,
// U+30b` — and O, U, o and u already have a home in the `latin` face. Two faces
// of one family claiming the same codepoint is a rule about declaration order,
// and this is not a thing to leave to one.
const LATIN_EXT_RANGE = 'U+0150-0151, U+0170-0171, U+2192';

const FAMILIES = [
  {
    dir: 'archivo',
    family: 'Archivo',
    // ital,wdth,wght — the full variable design space Google publishes.
    query: 'Archivo:ital,wdth,wght@0,62..125,100..900;1,62..125,100..900',
    licence: 'https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/OFL.txt',
    role: 'display + body',
  },
  {
    dir: 'aboreto',
    family: 'Aboreto',
    // One weight, no italic, no axes — Aboreto ships a single 400 upright and
    // that is all it is asked for. It sets the logo wordmark and nothing else,
    // so there is no second weight to fall back to and nothing to interpolate.
    query: 'Aboreto',
    licence: 'https://raw.githubusercontent.com/google/fonts/main/ofl/aboreto/OFL.txt',
    role: 'logo wordmark',
  },
  {
    dir: 'jetbrains-mono',
    family: 'JetBrains Mono',
    // Upright only: the mono is used for altitude readouts, technical labels and
    // tabular metadata, none of which is ever set in italic.
    query: 'JetBrains+Mono:wght@100..800',
    licence: 'https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/OFL.txt',
    role: 'technical + numeric',
  },
];

async function fetchText(url, accept) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...(accept ? { Accept: accept } : {}) } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

async function fetchBinary(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Split a Google Fonts stylesheet into one record per @font-face block. */
function parseFaces(css) {
  const faces = [];
  // Each block is preceded by a `/* subset */` comment naming the range.
  const re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const subset = m[1];
    const body = m[2];
    const pick = (prop) => body.match(new RegExp(`${prop}:\\s*([^;]+);`))?.[1]?.trim() ?? null;
    // Not `\.woff2$`: a `&text=` response serves the subset from
    // `/l/font?kit=…`, which has no extension at all. The `format('woff2')`
    // beside it is the statement of what it is.
    const url = body.match(/url\((https:[^)]+)\)\s*format\('woff2'\)/)?.[1];
    if (!url) continue;
    faces.push({
      subset,
      url,
      style: pick('font-style') ?? 'normal',
      weight: pick('font-weight') ?? '400',
      stretch: pick('font-stretch'),
      unicodeRange: pick('unicode-range'),
    });
  }
  return faces;
}

const slug = (f) =>
  `${f.family.toLowerCase().replace(/\s+/g, '-')}-${f.style}-${f.subset}.woff2`;

async function sync({ check }) {
  const manifest = { generatedAt: new Date().toISOString(), families: [] };
  const written = [];

  for (const fam of FAMILIES) {
    const css = await fetchText(
      `https://fonts.googleapis.com/css2?family=${fam.query}&display=swap`,
      'text/css',
    );
    const faces = parseFaces(css)
      .filter((f) => f.subset === 'latin')
      .map((f) => ({ ...f, family: fam.family }));

    // The extended faces come from a second request, for four characters. A
    // `&text=` response carries no `/* subset */` comments — it is one block per
    // style — so the faces are labelled here instead, in the same shape the
    // parser produces, and matched to the upright/italic split by font-style.
    const extCss = await fetchText(
      `https://fonts.googleapis.com/css2?family=${fam.query}` +
        `&text=${encodeURIComponent(LATIN_EXT_TEXT)}&display=swap`,
      'text/css',
    );
    for (const face of parseFaces(extCss.replace(/@font-face/g, '/* latin-ext */ @font-face'))) {
      faces.push({ ...face, family: fam.family, subset: 'latin-ext', unicodeRange: LATIN_EXT_RANGE });
    }

    if (!faces.length) throw new Error(`no usable faces for ${fam.family}`);
    if (!faces.some((f) => f.subset === 'latin-ext')) {
      throw new Error(`no latin-ext faces for ${fam.family} — the &text= endpoint answered nothing`);
    }

    const outDir = join(FONT_DIR, fam.dir);
    if (!check) await mkdir(outDir, { recursive: true });

    const files = [];
    for (const face of faces) {
      const name = slug(face);
      const bytes = await fetchBinary(face.url);
      const target = join(outDir, name);
      if (!check) await writeFile(target, bytes);
      files.push({
        file: `${fam.dir}/${name}`,
        subset: face.subset,
        style: face.style,
        weight: face.weight,
        stretch: face.stretch,
        unicodeRange: face.unicodeRange,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
      });
      written.push({ path: target, bytes: bytes.length });
    }

    const licence = await fetchText(fam.licence);
    if (!check) await writeFile(join(outDir, 'OFL.txt'), licence);

    manifest.families.push({
      family: fam.family,
      dir: fam.dir,
      role: fam.role,
      licence: 'SIL Open Font License 1.1',
      licenceFile: `${fam.dir}/OFL.txt`,
      source: `https://fonts.googleapis.com/css2?family=${fam.query}`,
      // The latin-ext files are not the published subset — see LATIN_EXT_TEXT.
      latinExtText: LATIN_EXT_TEXT,
      // Reported straight from the served stylesheet, which is the authoritative
      // statement of the variable ranges these binaries actually carry.
      axes: {
        weight: [...new Set(files.map((f) => f.weight))],
        stretch: [...new Set(files.map((f) => f.stretch).filter(Boolean))],
        styles: [...new Set(files.map((f) => f.style))],
      },
      files,
      totalBytes: files.reduce((n, f) => n + f.bytes, 0),
    });
  }

  if (check) {
    if (!existsSync(MANIFEST)) {
      console.error('sync-fonts: no manifest — run `node scripts/sync-fonts.mjs`.');
      process.exit(1);
    }
    const have = JSON.parse(await readFile(MANIFEST, 'utf8'));
    const problems = [];
    for (const fam of manifest.families) {
      const mine = have.families.find((f) => f.family === fam.family);
      if (!mine) { problems.push(`missing family ${fam.family}`); continue; }
      for (const f of fam.files) {
        const known = mine.files.find((g) => g.file === f.file);
        if (!known) { problems.push(`missing ${f.file}`); continue; }
        if (known.sha256 !== f.sha256) problems.push(`${f.file}: upstream changed (${known.sha256} -> ${f.sha256})`);
        if (!existsSync(join(FONT_DIR, f.file))) problems.push(`${f.file}: not on disk`);
      }
    }
    if (problems.length) {
      console.error('sync-fonts:\n' + problems.map((p) => '  ' + p).join('\n'));
      process.exit(1);
    }
    console.log('sync-fonts: OK — committed fonts match upstream.');
    return;
  }

  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));

  const total = manifest.families.reduce((n, f) => n + f.totalBytes, 0);
  for (const fam of manifest.families) {
    console.log(`\n${fam.family}  (${fam.role})  — ${fam.licence}`);
    console.log(`  weight ${fam.axes.weight.join(' / ')}   width ${fam.axes.stretch.join(' / ') || 'none'}   styles ${fam.axes.styles.join(', ')}`);
    for (const f of fam.files) console.log(`  ${(f.bytes / 1024).toFixed(1).padStart(7)} kB  ${f.file}`);
    console.log(`  ${(fam.totalBytes / 1024).toFixed(1)} kB total`);
  }
  console.log(`\nall fonts: ${(total / 1024).toFixed(1)} kB -> assets/fonts/`);
}

await sync({ check: process.argv.includes('--check') });
