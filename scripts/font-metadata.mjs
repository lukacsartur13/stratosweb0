// =============================================================================
// What the font files actually contain.
//
//     node scripts/font-metadata.mjs
//
// The Phase 6 brief is explicit that an axis must not be assumed from a
// typeface's name or from a vendor stylesheet — the binaries have to be
// inspected. `fonttools` is not available here and is not worth a Python
// toolchain in this repo, so this reads the WOFF2 container directly.
//
// It decompresses the brotli stream, walks the table directory to find `fvar`,
// and reports every variation axis with its real minimum, default and maximum,
// plus the named instances. Everything the typography tokens claim about weight
// and width ranges is checked against this output rather than against
// fonts.googleapis.com.
// =============================================================================

import { readFile, readdir } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONT_DIR = join(ROOT, 'assets', 'fonts');

// The 63 tags WOFF2 encodes as a 6-bit index instead of four bytes. Order is
// normative — it is the table in the WOFF2 specification, appendix A.
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm',
  'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern',
  'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC',
  'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty',
  'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
];

/** WOFF2's variable-length integer: 7 bits per byte, high bit continues. */
function readBase128(buf, pos) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[pos++];
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value >>> 0, pos];
  }
  throw new Error('malformed UIntBase128');
}

/** Fixed 16.16 signed. */
const fixed = (buf, off) => buf.readInt32BE(off) / 65536;

function readWoff2(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a WOFF2 file');
  const numTables = buf.readUInt16BE(12);

  let pos = 48;
  const dir = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos++];
    const tagIndex = flags & 0x3f;
    const transformVersion = (flags >> 6) & 0x03;

    let tag;
    if (tagIndex === 0x3f) {
      tag = buf.toString('latin1', pos, pos + 4);
      pos += 4;
    } else {
      tag = KNOWN_TAGS[tagIndex];
    }

    let origLength;
    [origLength, pos] = readBase128(buf, pos);

    // transformLength is present only when a transform is actually applied:
    // for glyf/loca that is version 0, for every other table it is version != 0.
    const transformed =
      tag === 'glyf' || tag === 'loca' ? transformVersion === 0 : transformVersion !== 0;
    let length = origLength;
    if (transformed) [length, pos] = readBase128(buf, pos);

    dir.push({ tag, length });
  }

  const data = brotliDecompressSync(buf.subarray(pos));

  // Tables are concatenated in directory order in the decompressed stream.
  let offset = 0;
  const tables = new Map();
  for (const entry of dir) {
    tables.set(entry.tag, data.subarray(offset, offset + entry.length));
    offset += entry.length;
  }
  return tables;
}

function readFvar(fvar) {
  if (!fvar || fvar.length < 16) return null;
  const axesArrayOffset = fvar.readUInt16BE(4);
  const axisCount = fvar.readUInt16BE(8);
  const axisSize = fvar.readUInt16BE(10);
  const instanceCount = fvar.readUInt16BE(12);
  const instanceSize = fvar.readUInt16BE(14);

  const axes = [];
  for (let i = 0; i < axisCount; i++) {
    const at = axesArrayOffset + i * axisSize;
    axes.push({
      tag: fvar.toString('latin1', at, at + 4),
      min: fixed(fvar, at + 4),
      default: fixed(fvar, at + 8),
      max: fixed(fvar, at + 12),
      nameId: fvar.readUInt16BE(at + 18),
    });
  }

  const instances = [];
  const instBase = axesArrayOffset + axisCount * axisSize;
  for (let i = 0; i < instanceCount; i++) {
    const at = instBase + i * instanceSize;
    if (at + 4 + axisCount * 4 > fvar.length) break;
    instances.push({
      nameId: fvar.readUInt16BE(at),
      coords: axes.map((_, j) => fixed(fvar, at + 4 + j * 4)),
    });
  }

  return { axes, instances };
}

/** Names from the `name` table, so instance ids resolve to readable strings. */
function readNames(name) {
  if (!name) return new Map();
  const count = name.readUInt16BE(2);
  const stringOffset = name.readUInt16BE(4);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    if (at + 12 > name.length) break;
    const platformId = name.readUInt16BE(at);
    const encodingId = name.readUInt16BE(at + 2);
    const nameId = name.readUInt16BE(at + 6);
    const len = name.readUInt16BE(at + 8);
    const off = stringOffset + name.readUInt16BE(at + 10);
    if (off + len > name.length) continue;
    const raw = name.subarray(off, off + len);
    const text =
      platformId === 3 || (platformId === 0 && encodingId >= 3)
        ? raw.swap16 && len % 2 === 0
          ? Buffer.from(raw).swap16().toString('utf16le')
          : raw.toString('utf16le')
        : raw.toString('latin1');
    if (!out.has(nameId)) out.set(nameId, text);
  }
  return out;
}

/** Which of the three languages' characters the file can actually set. */
const COVERAGE_PROBES = {
  Hungarian: 'áéíóöőúüű ÁÉÍÓÖŐÚÜŰ',
  German: 'äöüß ÄÖÜ',
  English: 'abcdefghijklmnopqrstuvwxyz',
};

/** Every codepoint the cmap maps, as a Set — formats 4 and 12 only. */
function readCmap(cmap) {
  if (!cmap) return null;
  const numTables = cmap.readUInt16BE(2);
  const covered = new Set();
  for (let i = 0; i < numTables; i++) {
    const off = cmap.readUInt32BE(4 + i * 8 + 4);
    if (off + 4 > cmap.length) continue;
    const format = cmap.readUInt16BE(off);
    if (format === 4) {
      const segX2 = cmap.readUInt16BE(off + 6);
      const endBase = off + 14;
      const startBase = endBase + segX2 + 2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = cmap.readUInt16BE(endBase + s * 2);
        const start = cmap.readUInt16BE(startBase + s * 2);
        if (start === 0xffff) continue;
        for (let c = start; c <= end && c !== 0xffff; c++) covered.add(c);
      }
    } else if (format === 12) {
      const nGroups = cmap.readUInt32BE(off + 12);
      for (let g = 0; g < nGroups; g++) {
        const at = off + 16 + g * 12;
        if (at + 12 > cmap.length) break;
        const start = cmap.readUInt32BE(at);
        const end = cmap.readUInt32BE(at + 4);
        for (let c = start; c <= end; c++) covered.add(c);
      }
    }
  }
  return covered;
}

const families = await readdir(FONT_DIR, { withFileTypes: true });
for (const entry of families) {
  if (!entry.isDirectory()) continue;
  const dir = join(FONT_DIR, entry.name);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.woff2')).sort();

  console.log(`\n${'='.repeat(78)}\n${entry.name}\n${'='.repeat(78)}`);
  // Coverage is only meaningful across the whole family: `latin` and
  // `latin-ext` are loaded together and unicode-range decides which file serves
  // a given character, so ő living outside `latin` is by design, not a gap.
  const union = new Set();
  for (const file of files) {
    const buf = await readFile(join(dir, file));
    let tables;
    try {
      tables = readWoff2(buf);
    } catch (err) {
      console.log(`\n  ${file}\n    could not read: ${err.message}`);
      continue;
    }
    const names = readNames(tables.get('name'));
    const fvar = readFvar(tables.get('fvar'));
    const cmap = readCmap(tables.get('cmap'));

    console.log(`\n  ${file}   (${(buf.length / 1024).toFixed(1)} kB)`);
    console.log(`    family      ${names.get(16) ?? names.get(1) ?? '?'}`);
    console.log(`    subfamily   ${names.get(17) ?? names.get(2) ?? '?'}`);
    console.log(`    version     ${(names.get(5) ?? '?').trim()}`);
    console.log(`    tables      ${[...tables.keys()].join(' ')}`);

    if (!fvar) {
      console.log('    axes        NONE — this is a static font, not a variable one');
    } else {
      console.log(`    axes        ${fvar.axes.length}`);
      for (const a of fvar.axes) {
        console.log(
          `      ${a.tag}  ${String(a.min).padStart(7)} .. ${String(a.max).padEnd(7)}  default ${a.default}   (${names.get(a.nameId) ?? '?'})`,
        );
      }
      if (fvar.instances.length) {
        console.log(
          `    instances   ${fvar.instances.length}: ${fvar.instances
            .slice(0, 6)
            .map((i) => names.get(i.nameId) ?? '?')
            .join(', ')}${fvar.instances.length > 6 ? ', …' : ''}`,
        );
      }
    }

    if (cmap) {
      for (const c of cmap) union.add(c);
      console.log(`    glyphs      ${cmap.size} mapped in this subset`);
    }
  }

  // The line that actually answers "does this family set all three languages".
  console.log(`\n  family coverage (latin + latin-ext together): ${union.size} codepoints`);
  for (const [lang, chars] of Object.entries(COVERAGE_PROBES)) {
    const missing = [...chars].filter((c) => c !== ' ' && !union.has(c.codePointAt(0)));
    console.log(`    ${lang.padEnd(10)} ${missing.length ? `MISSING ${missing.join(' ')}` : 'complete'}`);
  }
}
console.log('');
