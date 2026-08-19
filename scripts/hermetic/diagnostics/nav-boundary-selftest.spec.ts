import { test, expect } from '../../../tests/helpers/navigation-boundary';

/**
 * §37 — the instrumentation is not trusted until it has been made to lie and
 * refused to.
 *
 * Each arm below breaks the navigation at ONE known boundary and nothing else.
 * The recorder is correct only if `lastConfirmedState` names that boundary and
 * no state after it. A recorder that reported the same answer for all five
 * would be worse than none: it would end the next investigation with a
 * confident wrong classification instead of an honest empty one.
 *
 * Every arm is expected to FAIL. That is how the bundle gets written — the
 * whole point of the fixture is that it survives the failure of the test it is
 * attached to. `verify-selftest.mjs` reads the bundles and issues the verdict;
 * the red here is the apparatus working, not a regression.
 */

const ROUTE = '/kkv.html';

test.describe('nav-boundary self-test', () => {
  test.describe.configure({ timeout: 15_000 });

  // §22 / §23 — GOTO_CALLED and a request event, but the request is killed in
  // flight and the server never sees it. The discriminator is that
  // SERVER_RECEIVED must be ABSENT: it is derived from the server's own log,
  // so it cannot be faked by the test process observing its own optimism.
  test('A request that never reaches the server stops at REQUEST_STARTED', async ({ page }) => {
    await page.route(`**${ROUTE}`, (r) => r.abort('connectionrefused'));
    await page.goto(ROUTE);
  });

  // §24 — the request is received and never answered. Served by
  // `stall-server.mjs` on its own port rather than by a hook inside the gate's
  // server, so that §37's "revert all diagnostic mutations" is satisfied
  // literally: `scripts/test-server.mjs` carries no stall path at all.
  test('B a request the server receives and never answers stops at SERVER_RECEIVED', async ({ page }) => {
    const port = process.env.STRATOS_NAV_DIAG_STALL_PORT;
    test.skip(!port, 'stall-server not running');
    await page.goto(`http://127.0.0.1:${port}${ROUTE}`);
  });

  // §25 — the strongest case the old artefact could not tell apart from the
  // others: the server produced a complete response, and the navigation still
  // did not commit. `route.fetch()` performs the real request through the real
  // server and then the handler simply never fulfils it.
  test('C a completed response that never commits stops at RESPONSE_COMPLETE', async ({ page }) => {
    await page.route(`**${ROUTE}`, async (r) => {
      await r.fetch();
      await new Promise(() => {});
    });
    await page.goto(ROUTE);
  });

  // §26 — `main.js` and `header.js` on this page are NOT deferred, so holding
  // one holds the parser: the navigation commits and DOMContentLoaded never
  // arrives. This arm exists to prove NAV_COMMITTED and DOMCONTENTLOADED are
  // separable, and that the bundle names the blocker rather than shrugging.
  test('D a held parser-blocking script stops at NAV_COMMITTED', async ({ page }) => {
    await page.route('**/assets/js/main.js*', () => new Promise(() => {}));
    await page.goto(ROUTE);
  });

  // §27 — an IMAGE instead. Deferred scripts run before DOMContentLoaded, so
  // holding one lands in the same place as D; an image blocks only `load`. The
  // parser finishes, DOMContentLoaded fires, and `load` alone is outstanding —
  // one state higher than D, from a one-word change to what is held.
  // `work-3.jpg` is the wrong image to hold: at 390 px it is off-screen and
  // never requested, so holding it holds nothing and the arm passes — which is
  // itself a useful reminder that a diagnostic can be inert without saying so.
  // `plane-cursor.png` is eager and always fetched here.
  test('D2 a held image stops at DOMCONTENTLOADED', async ({ page }) => {
    await page.route('**/assets/img/plane-cursor.png*', () => new Promise(() => {}));
    await page.goto(ROUTE);
  });

  // §29 — goto resolved. Any later timeout in this test is NOT a navigation
  // failure, and the bundle has to be able to say so.
  test('E a timeout after a resolved goto reaches DESTINATION_READY', async ({ page }) => {
    await page.goto(ROUTE);
    await page.waitForSelector('#a-selector-that-is-never-in-the-document', { timeout: 12_000 });
    expect(true).toBe(false);
  });
});
