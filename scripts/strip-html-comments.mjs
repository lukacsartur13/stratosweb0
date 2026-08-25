#!/usr/bin/env node
/**
 * Strip HTML comments from the built pages.
 *
 * WHY THIS EXISTS
 * ---------------
 * The source tree is unusually comment-dense on purpose — the comments are
 * where the reasons live, and `scripts/assemble.mjs` says so at length about
 * the stylesheets and scripts, which is why those are minified rather than
 * inlined from source.
 *
 * The HTML had no equivalent step. `assemble.mjs` copies the generated pages
 * into dist verbatim and Vite leaves the homepage shells' own comments alone,
 * so every route shipped its build notes to the public: 15 comments and 5,198
 * bytes on the homepage, 6.8% of the document, all of it English commentary
 * about React mount hosts and scroll restoration sitting in a Hungarian page
 * directly under the <title>.
 *
 * Two costs, one of them not about bytes. It is weight on every request of a
 * document that is already 76 KB. And it is internal engineering notes
 * published on a marketing site, where the only readers are whoever views
 * source.
 *
 * The source keeps every word. This runs on dist, after `build:site` and
 * `build:home` have both written their HTML, and before `fingerprint` rewrites
 * the asset URLs.
 *
 * WHAT IT DOES NOT TOUCH
 * ----------------------
 * `<script>`, `<style>`, `<pre>` and `<textarea>` contents are held out and
 * put back unchanged. A naive global regex would treat `<!--` inside a script
 * string or a CSS content property as the start of a comment and eat the file
 * from there to the next `-->`, which is the classic way this kind of script
 * corrupts a build while still exiting 0.
 *
 * Conditional comments (`<!--[if `) are kept: they are markup, not commentary.
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/** Regions whose contents are opaque to the comment syntax. */
const OPAQUE = /<(script|style|pre|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** A comment, but not a conditional comment and not the `<!--[if` family. */
const COMMENT = /<!--(?!\[if)[\s\S]*?-->/g;

const tags = (s) => (s.match(/<[a-zA-Z/][^>]*>/g) || []).length;

function strip(html) {
  const held = [];
  // Park the opaque regions behind placeholders that cannot occur in HTML.
  const parked = html.replace(OPAQUE, (m) => {
    held.push(m);
    return ` OPAQUE${held.length - 1} `;
  });

  // These comments quote markup constantly — `<main id="main">`, `<head>`,
  // `<br />` — so the tags inside them count toward the document's total and
  // have to be subtracted before the result can be compared against it. This
  // is what makes the caller's check exact rather than approximately right;
  // the first version of it counted raw tags and aborted on every page.
  const removed = parked.match(COMMENT) || [];
  const inComments = removed.reduce((n, c) => n + tags(c), 0);

  const cleaned = parked
    .replace(COMMENT, '')
    // A comment on its own line leaves the blank line behind it.
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n');

  let restored = 0;
  const out = cleaned.replace(/ OPAQUE(\d+) /g, (_, i) => {
    restored += 1;
    return held[+i];
  });

  // A parked region that never came back is the failure mode that matters:
  // the page keeps its shape and silently loses a stylesheet or a script.
  return { out, inComments, intact: restored === held.length };
}

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir)) {
    // dist/portal is the React SPA's own build output; its shell is Vite's and
    // carries no commentary of ours.
    if (entry === 'portal') continue;
    const path = join(dir, entry);
    if ((await stat(path)).isDirectory()) yield* htmlFiles(path);
    else if (entry.endsWith('.html')) yield path;
  }
}

let files = 0;
let saved = 0;
for await (const path of htmlFiles(DIST)) {
  const before = await readFile(path, 'utf8');
  const { out, inComments, intact } = strip(before);
  if (out === before) continue;

  // A file that lost markup rather than commentary is a corrupted page that
  // still looks plausible, so it must fail the build rather than ship.
  if (!intact || tags(out) !== tags(before) - inComments) {
    console.error(`strip-html-comments: ${path} lost markup — aborting`);
    process.exit(1);
  }

  await writeFile(path, out, 'utf8');
  files += 1;
  saved += before.length - out.length;
}

console.log(
  `strip-html-comments: ${files} pages, ${(saved / 1024).toFixed(1)} KB of comments removed`,
);
