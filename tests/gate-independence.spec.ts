import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Run N's output must not be able to change run N+1's result.
 *
 * WHAT HAPPENED
 * -------------
 * The `g4` sequence was stopped after three runs, and the third was thrown away
 * for a reason that had nothing to do with the product. Run 2 failed a test in
 * `tests/lead-forms.spec.ts`, and Playwright writes the failing SOURCE LINE
 * into its JSON report. The line it quoted asserts that the deployed bundle
 * carries no form access key — so it names the very strings the secret scanner
 * looks for, in order to forbid them. Those words landed in
 * `_build/reports/hermetic-gate/runs/g4-02/playwright-main.json`, and run 3's
 * secret scan reported six findings for them.
 *
 * The artefact persists, so every later run would have failed identically. Run 3
 * was red because of run 2. Six runs are not six runs if one can poison the
 * next, and a repeated-run gate whose runs are not independent measures nothing.
 *
 * Fixed in b7d67a2 by excluding the gate's own generated trees from the walk.
 * This file is the regression, and it asserts BOTH halves of that fix, because
 * only one of them is about independence and the other is about not going blind:
 *
 *   1. a synthetic failure artefact inside a generated tree does NOT make the
 *      source scan red — the independence property itself;
 *   2. the same content just OUTSIDE that tree DOES — the exclusion is a narrow
 *      prefix over machine-written artefacts, not an amnesty for
 *      `_build/reports/**`, where a genuinely pasted credential must still be
 *      caught.
 *
 * Assertion 2 is what stops assertion 1 from being satisfied by simply
 * switching the scanner off.
 */

/**
 * Scanner-triggering text, assembled at runtime.
 *
 * Composed from fragments rather than written out, so this file contains no
 * literal the scanner would match and needs no entry in its
 * `DESCRIBES_THE_RULE` exemption — an exemption is a hole, and a test about not
 * going blind should not open one. Nothing here is a real credential: the first
 * is the field name that caused the g4-03 cascade, the second is a syntactically
 * shaped but invented AWS key id.
 */
const FIXTURE = [
  '  "error": "expect(JSON.stringify(envelope)).not.toMatch(/',
  ['access', 'key'].join('_'),
  '|web3forms/i)"',
  '\n  "attachment": "',
  `AKIA${'EXAMPLEFIXTURE0'}0`,
  '"\n',
].join('');

/** Inside the excluded tree: what a previous run's failure report looks like. */
const GENERATED = join(ROOT, '_build/reports/hermetic-gate/runs/zz-independence-fixture/playwright-main.json');
/**
 * Outside it, and deliberately only one level outside: a sibling of `runs/`
 * under the same reports directory. If the exclusion were written as
 * `_build/reports` or `_build/reports/hermetic-gate`, this file would stop being
 * scanned and the second assertion would fail.
 */
const AUTHORED = join(ROOT, '_build/reports/hermetic-gate/zz-independence-fixture-authored.md');

/** The scan, as the gate runs it. Resolves to the exit code and the output. */
async function scan(): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await run('node', ['scripts/secret-scan.mjs'], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
    return { code: 0, out: stdout + stderr };
  } catch (err: any) {
    return { code: err.code ?? 1, out: String(err.stdout ?? '') + String(err.stderr ?? '') };
  }
}

const clean = () => Promise.all([
  rm(dirname(GENERATED), { recursive: true, force: true }),
  rm(AUTHORED, { force: true }),
]);

test.describe('hermetic run-output independence', () => {
  /**
   * ONE test for both halves, and not two, because they cannot be run at the
   * same time. The second half deliberately makes the repository-wide scan go
   * red for as long as its fixture exists — and the first half asserts the scan
   * is green. Run in parallel in the same worker pool, each is the other's
   * false result. Splitting them would need `mode: 'serial'`, which turns a
   * failure in the first into a SKIP in the second, and a skip set that changes
   * when a test fails is exactly what §54 forbids the gate to have.
   */
  test('a previous run\'s artefact cannot make the next run red, and an authored one still can', async () => {
    await clean();
    try {
      // Nothing below means anything if the tree is not clean to begin with.
      // This also proves no earlier attempt left a fixture behind.
      const baseline = await scan();
      expect(baseline.code, `secret-scan was already failing before the fixture:\n${baseline.out}`).toBe(0);

      // -- half one: the independence property itself ------------------------
      // Run N writes a failure report that quotes a source line naming the
      // rules. Run N+1's source scan must not care.
      await mkdir(dirname(GENERATED), { recursive: true });
      await writeFile(GENERATED, FIXTURE, 'utf8');

      const withGenerated = await scan();
      expect(
        withGenerated.code,
        `run N's generated artefact made run N+1's source scan red:\n${withGenerated.out}`,
      ).toBe(0);

      await rm(dirname(GENERATED), { recursive: true, force: true });

      // -- half two: the exclusion is not a switched-off scanner --------------
      // The same bytes, one directory outside the excluded prefix, in a tree
      // that holds hand-written reports. This must still be a finding, or half
      // one is measuring nothing.
      await writeFile(AUTHORED, FIXTURE, 'utf8');

      const withAuthored = await scan();
      expect(withAuthored.code, 'a credential in an authored report was not caught').toBe(1);
      expect(withAuthored.out).toContain('zz-independence-fixture-authored.md');

      await rm(AUTHORED, { force: true });

      // And the tree is clean again the moment the fixture is gone, which is
      // what leaves the repository as this test found it.
      expect((await scan()).code).toBe(0);
    } finally {
      await clean();
    }
  });

  test('the exclusion is a list of named generated trees, not a directory amnesty', async () => {
    // A structural companion to the behavioural test, and the one that survives
    // a rewrite of it: the pair above would both still pass if someone widened
    // the exclusion to a whole tree that also holds authored reports and then
    // moved the authored fixture, so the shape of the rule is asserted directly.
    // Reads a file and writes nothing, so it cannot race the test above.
    const src = await readFile(join(ROOT, 'scripts/secret-scan.mjs'), 'utf8');
    const block = src.match(/const GENERATED_TREES = \[([\s\S]*?)\];/);
    expect(block, 'scripts/secret-scan.mjs no longer declares GENERATED_TREES').toBeTruthy();

    const paths = [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);

    // Every entry must be specific. `_build`, `_build/reports` and
    // `_build/reports/hermetic-gate` all contain hand-written reports, and
    // exempting any of them is how a pasted key stops being caught.
    const TOO_BROAD = ['_build', '_build/reports', '_build/reports/hermetic-gate', 'tests', 'scripts', 'dist', '.'];
    for (const p of paths) {
      expect(TOO_BROAD, `GENERATED_TREES exempts '${p}', which holds authored files`).not.toContain(p);
    }
  });
});
