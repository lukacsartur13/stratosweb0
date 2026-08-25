#!/usr/bin/env node
/**
 * Claude Design — fetch-fonts.mjs
 *
 * Downloads the open-licence (SIL OFL 1.1) webfonts that fonts.css expects
 * into ./files/. Run it once after cloning; the files are gitignored by
 * default so the repo stays free of binaries.
 *
 *   node design-system/claude-design/fonts/fetch-fonts.mjs
 *
 * The licensed brand faces (Styrene, Tiempos, Berkeley Mono) are NOT fetched
 * here and never will be — they are commercial. See ./README.md.
 *
 * Sources are the @fontsource packages on jsDelivr: the upstream Google Fonts
 * / Adobe binaries, repackaged, versioned, and served with immutable caching.
 */

import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "files");

const CDN = "https://cdn.jsdelivr.net/npm";

const FONTS = [
  {
    name: "Inter-Variable.woff2",
    url: `${CDN}/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2`,
    licence: "SIL OFL 1.1 — https://github.com/rsms/inter",
  },
  {
    name: "SourceSerif4-Variable.woff2",
    url: `${CDN}/@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2`,
    licence: "SIL OFL 1.1 — https://github.com/adobe-fonts/source-serif",
  },
  {
    name: "SourceSerif4-Italic-Variable.woff2",
    url: `${CDN}/@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-italic.woff2`,
    licence: "SIL OFL 1.1 — https://github.com/adobe-fonts/source-serif",
  },
  {
    name: "JetBrainsMono-Variable.woff2",
    url: `${CDN}/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2`,
    licence: "SIL OFL 1.1 — https://github.com/JetBrains/JetBrainsMono",
  },
];

const exists = (p) => stat(p).then(() => true, () => false);

async function fetchOne(font, { force }) {
  const dest = join(OUT, font.name);

  if (!force && (await exists(dest))) {
    console.log(`  skip   ${font.name} (already present)`);
    return { ok: true, skipped: true };
  }

  const res = await fetch(font.url);
  if (!res.ok) {
    console.error(`  FAIL   ${font.name} — HTTP ${res.status} ${res.statusText}`);
    return { ok: false };
  }

  const buf = Buffer.from(await res.arrayBuffer());

  // woff2 files start with the magic number "wOF2". Anything else means the
  // CDN handed us an error page with a 200, which has happened before.
  if (buf.subarray(0, 4).toString("latin1") !== "wOF2") {
    console.error(`  FAIL   ${font.name} — not a woff2 file (got ${buf.length} bytes)`);
    return { ok: false };
  }

  await writeFile(dest, buf);
  console.log(`  ok     ${font.name}  ${(buf.length / 1024).toFixed(1)} KB`);
  return { ok: true };
}

const force = process.argv.includes("--force");

await mkdir(OUT, { recursive: true });
console.log(`Fetching ${FONTS.length} open-licence webfonts into ${OUT}\n`);

const results = [];
for (const font of FONTS) {
  results.push(await fetchOne(font, { force }));
}

const failed = results.filter((r) => !r.ok).length;
console.log(
  `\n${results.length - failed}/${results.length} available.` +
    (failed ? ` ${failed} failed — see above.` : "")
);
console.log("All fetched faces are SIL OFL 1.1. Ship the licence with them.");

process.exit(failed ? 1 : 0);
