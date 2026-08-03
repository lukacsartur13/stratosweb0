// =============================================================================
// Copy the DRACO decoder out of the installed `three` into public/draco/.
//
//     npm run draco:sync         # write the files
//     npm run draco:check        # verify they match the installed three
//
// WHY THE DECODER IS VENDORED AT ALL
// ----------------------------------
// `stratos-mountains-{desktop,mobile}.glb` both declare
// `KHR_draco_mesh_compression` in `extensionsRequired`, so neither will parse
// without a decoder. Three ships one but does not serve one: `DRACOLoader`'s
// documented default is `https://www.gstatic.com/draco/versioned/decoders/...`,
// a third-party CDN. That is one more origin the page depends on at runtime,
// one more entry the CSP has to allow, and a request that leaves the visitor's
// browser for Google on a page that otherwise fetches nothing off-origin.
// Serving it ourselves removes all three.
//
// WHY A SCRIPT AND NOT A COMMITTED BLOB
// -------------------------------------
// The decoder is versioned *with* three: the wrapper the loader fetches has to
// match the `DRACOLoader` that drives it. A blob committed once goes stale
// silently the first time someone bumps three, and the failure mode is a decode
// error in production rather than a build error here. `draco:check` runs in the
// build so the mismatch is loud.
//
// WHY `gltf/` AND NOT THE PARENT DIRECTORY
// ----------------------------------------
// Three ships two builds. The parent has the full decoder; `gltf/` has the one
// trimmed to what glTF actually uses — 192 KB of WASM instead of 286 KB, for
// identical results on these two files. `DRACOLoader` is pointed at whichever
// directory this writes.
//
// The encoder is deliberately not copied. Nothing in this site compresses a
// mesh in the browser, and it is the largest file in the directory.
// =============================================================================

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// `three` is a dependency of experiments/, not of the repository root.
//
// Resolved by walking up from the resolved entry point rather than by asking
// for `three/package.json` directly: three's `exports` map does not list the
// manifest, so a direct resolve throws ERR_PACKAGE_PATH_NOT_EXPORTED on Node
// 18+. The entry point is exported, and the package root is the directory above
// `build/`.
const requireFromExperiments = createRequire(join(ROOT, 'experiments', 'package.json'));
const THREE_DIR = (() => {
  let dir = dirname(requireFromExperiments.resolve('three'));
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('cannot locate the installed three package root');
})();
const THREE_PKG = join(THREE_DIR, 'package.json');
const SRC = join(THREE_DIR, 'examples', 'jsm', 'libs', 'draco', 'gltf');
const OUT = join(ROOT, 'public', 'draco');

/**
 * The three files `DRACOLoader` can ask for, and why each is here.
 *
 * The loader decides between them at runtime: it probes for WebAssembly and
 * fetches the wrapper plus the .wasm when it is available, or the single
 * self-contained .js when it is not — or when `setDecoderConfig({type:'js'})`
 * forces it. All three ship because the fallback is only a fallback if it is
 * actually served.
 */
const FILES = [
  'draco_wasm_wrapper.js', // WASM path: the JS half that instantiates the module
  'draco_decoder.wasm', // WASM path: the decoder itself
  'draco_decoder.js', // JS path: the whole decoder, asm.js-style, no WASM
];

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

async function main() {
  const check = process.argv.includes('--check');
  const version = JSON.parse(await readFile(THREE_PKG, 'utf8')).version;

  if (!existsSync(SRC)) {
    throw new Error(`three ${version} has no decoder at ${SRC} — the layout changed; update this script.`);
  }

  await mkdir(OUT, { recursive: true });

  const manifestPath = join(OUT, 'MANIFEST.json');
  const manifest = { three: version, source: 'three/examples/jsm/libs/draco/gltf', files: {} };
  const problems = [];

  for (const name of FILES) {
    const src = await readFile(join(SRC, name));
    manifest.files[name] = { bytes: src.length, sha256: sha(src) };

    const dest = join(OUT, name);
    if (check) {
      if (!existsSync(dest)) {
        problems.push(`${name}: missing from public/draco/`);
        continue;
      }
      const have = await readFile(dest);
      if (sha(have) !== sha(src)) problems.push(`${name}: differs from three ${version}`);
    } else {
      await writeFile(dest, src);
    }
  }

  if (check) {
    let recorded = null;
    if (existsSync(manifestPath)) recorded = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (recorded?.three !== version) {
      problems.push(`MANIFEST.json records three ${recorded?.three ?? 'nothing'}, installed is ${version}`);
    }
    if (problems.length) {
      console.error(`draco: public/draco/ is out of date with three ${version}`);
      for (const p of problems) console.error('  ' + p);
      console.error('  run: npm run draco:sync');
      process.exit(1);
    }
    console.log(`draco: public/draco/ matches three ${version}`);
    return;
  }

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const listed = (await readdir(OUT)).sort();
  console.log(`draco: wrote ${FILES.length} files from three ${version} -> public/draco/`);
  for (const name of listed) {
    const f = manifest.files[name];
    console.log(`  ${name}${f ? ` (${f.bytes.toLocaleString('en-GB')} bytes)` : ''}`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
