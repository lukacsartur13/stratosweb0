#!/usr/bin/env node
// =============================================================================
// Does the site still only use characters the shipped fonts can draw?
//
//     node scripts/font-coverage.mjs        # over dist/, the last build step
//
// WHY THIS EXISTS
// ---------------
// `assets/css/type.css` used to declare the whole published `latin-ext` block —
// a thousand-odd codepoints of Polish, Czech, Turkish, Welsh and Vietnamese —
// against files that carried all of them, at 86 kB for Archivo alone. A scan of
// every built page found three characters above U+00FF in the site's prose: ő,
// ű and Ű. The files are now `&text=` subsets of exactly those four letters
// (Ő included, as the capital of one of them) and the declared `unicode-range`
// was narrowed to match. See LATIN_EXT_TEXT in scripts/sync-fonts.mjs.
//
// That is a pin, and a pin needs a check. Without one, a fifth extended letter
// arriving in a blog post — a client called Kraśnik, a German quotation using
// Č — falls outside every declared range and is drawn in Arial next to Archivo,
// in one word, on one page, which is exactly the class of defect nobody
// notices for months.
//
// WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT
// -------------------------------------------------
// It reads the ranges out of type.css rather than restating them, so the file
// under test is the file that ships. It looks at the TEXT of the built pages —
// what a person reads — with `<script>`, `<style>` and markup removed, because
// an emoji in a console message inside a bundle is not typography and flagging
// it would train everyone to ignore this.
//
// Characters below U+0100 are not checked: the `latin` faces are the published
// subset, unmodified, and cover them.
// =============================================================================

import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const TYPE_CSS = join(ROOT, 'assets', 'css', 'type.css');

/** Every codepoint any `unicode-range` in type.css claims. */
function declaredRanges(css) {
  const ranges = [];
  for (const block of css.matchAll(/unicode-range:\s*([^;]+);/g)) {
    for (const token of block[1].split(',')) {
      const m = /^\s*U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?\s*$/.exec(token);
      if (!m) continue;
      const from = parseInt(m[1], 16);
      ranges.push([from, m[2] ? parseInt(m[2], 16) : from]);
    }
  }
  return ranges;
}

const covers = (ranges, cp) => ranges.some(([a, b]) => cp >= a && cp <= b);

/** The readable text of a built page: no scripts, no styles, no tags. */
function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Attribute values are read too: `alt`, `title`, `aria-label` and the
    // meta description are all text a person or a screen reader receives.
    .replace(/<[^>]+>/g, (tag) => ' ' + [...tag.matchAll(/="([^"]*)"/g)].map((m) => m[1]).join(' ') + ' ');
}

async function pages(dir, found = []) {
  for (const entry of await readdir(dir)) {
    const path = join(dir, entry);
    // The portal is an application shell, not prose, and its bundle is Vite's.
    if (entry === 'portal') continue;
    if ((await stat(path)).isDirectory()) await pages(path, found);
    else if (extname(path) === '.html') found.push(path);
  }
  return found;
}

const ENTITY = /&#(\d+);|&#x([0-9a-f]+);/gi;

async function main() {
  const ranges = declaredRanges(await readFile(TYPE_CSS, 'utf8'));
  if (!ranges.length) {
    console.error('font-coverage: type.css declares no unicode-range at all.');
    process.exit(1);
  }

  const missing = new Map();
  let scanned = 0;

  for (const path of await pages(DIST)) {
    scanned += 1;
    let text = visibleText(await readFile(path, 'utf8'));
    // A numeric entity is the same character to a reader and to a font.
    text = text.replace(ENTITY, (_, dec, hex) =>
      String.fromCodePoint(parseInt(dec ?? hex, dec ? 10 : 16)));

    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp < 0x100 || covers(ranges, cp)) continue;
      const where = missing.get(ch) ?? new Set();
      where.add(relative(DIST, path));
      missing.set(ch, where);
    }
  }

  if (missing.size) {
    console.error(
      `font-coverage: ${missing.size} character(s) on the site are outside every ` +
      `unicode-range in assets/css/type.css, and will be drawn in the fallback face:\n`);
    for (const [ch, where] of missing) {
      const at = [...where].slice(0, 3).join(', ') + (where.size > 3 ? ` (+${where.size - 3} more)` : '');
      console.error(`  ${JSON.stringify(ch)}  U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}  ${at}`);
    }
    console.error(
      '\nEither the copy is wrong, or the subset needs widening: add the character to' +
      '\nLATIN_EXT_TEXT in scripts/sync-fonts.mjs, widen the matching unicode-range in' +
      '\nassets/css/type.css, and re-run `node scripts/sync-fonts.mjs`.');
    process.exit(1);
  }

  console.log(`font-coverage: ${scanned} pages, every character covered by a shipped face.`);
}

main().catch((err) => {
  console.error('font-coverage failed:', err);
  process.exit(1);
});
