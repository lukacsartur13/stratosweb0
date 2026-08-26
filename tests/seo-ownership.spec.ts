// The Hungarian keyword-ownership guard, run as a child process.
//
// The collision this protects against is invisible to every other check in this
// repository, and that is the whole reason it needs its own one. Three pages
// each had a unique title, a self-referential canonical and a reciprocal
// hreflang set — every existing rule passed — while all three opened with the
// same three words and competed for the same query. A rule that looks at one
// page at a time cannot see it.
import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('no Hungarian commercial head term is claimed by more than one page', async () => {
  let code = 0;
  let out = '';
  try {
    const r = await run(process.execPath, [join(ROOT, 'scripts', 'seo-ownership.mjs'), '--check'], { cwd: ROOT });
    out = r.stdout + r.stderr;
  } catch (e: any) {
    code = e.code ?? 1;
    out = (e.stdout ?? '') + (e.stderr ?? '');
  }
  expect(code, `seo-ownership reported a collision:\n${out}`).toBe(0);
  expect(out).toContain('no collisions');
});
