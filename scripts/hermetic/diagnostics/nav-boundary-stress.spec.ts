import { test, expect } from '../../../tests/helpers/navigation-boundary';

/**
 * The CONTROL arm — §18.
 *
 * `public-site.spec.ts:264 [mobile-390]` is the real path and it is stressed by
 * running that file itself, not by an imitation of it (§17). This file is the
 * other half of the comparison: the same route, in the same project, through
 * the same fixture, with everything else stripped away.
 *
 * The question it answers is narrow and worth answering separately. If the raw
 * navigation never fails while the complete contract does, the difference is
 * the two sibling navigations that precede it in the same worker and the
 * assertions that follow it — and the preceding state becomes the subject
 * rather than the transport. If both fail at the same rate, it does not.
 *
 * Nothing here may be treated as the contract under test. It is deliberately
 * NOT the same test: it has no `expect`, so it exercises the navigation and
 * only the navigation.
 */
test.describe('nav-boundary control', () => {
  test('bare goto /kkv.html', async ({ page }) => {
    await page.goto('/kkv.html');
  });
});

/**
 * EXTENDED DIAGNOSTIC OBSERVATION — §21.
 *
 * Never part of the gate, and it does not change the suite's timeout. It exists
 * for one question the normal budget cannot ask: when a navigation is still
 * pending at 30 s, is it pending because it is slow or because it is dead?
 *
 * The normal contract's answer is preserved by the gate; this arm re-runs the
 * same navigation with an explicit long deadline and samples the boundary at
 * 31 s, 60 s and 120 s, so a future failure can be labelled "resolved at 47 s"
 * rather than "timed out".
 *
 * Skipped unless explicitly armed, because 120 s of waiting per execution has
 * no place in a suite whose whole purpose is repeatability.
 */
test.describe('nav-boundary extended observation', () => {
  test.describe.configure({ timeout: 150_000 });

  test('how long does /kkv.html actually take', async ({ page }, testInfo) => {
    test.skip(!process.env.STRATOS_NAV_EXTENDED, 'extended observation not armed');
    const marks: Array<{ atMs: number; url: string; readyState: string | null }> = [];
    const t0 = Date.now();
    const sample = async () => {
      marks.push({
        atMs: Date.now() - t0,
        url: page.url(),
        readyState: await page
          .evaluate(() => document.readyState)
          .catch(() => null),
      });
    };
    const timers = [31_000, 60_000, 120_000].map((ms) => setTimeout(() => { void sample(); }, ms));
    try {
      await page.goto('/kkv.html', { timeout: 140_000 });
    } finally {
      for (const t of timers) clearTimeout(t);
      await testInfo.attach('extended-observation', {
        body: JSON.stringify({ totalMs: Date.now() - t0, marks }, null, 2),
        contentType: 'application/json',
      });
      // eslint-disable-next-line no-console
      console.log(`[extended] resolved after ${Date.now() - t0} ms; samples ${JSON.stringify(marks)}`);
    }
    expect(page.url()).toContain('/kkv.html');
  });
});
