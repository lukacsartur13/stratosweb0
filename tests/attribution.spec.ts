// =============================================================================
// Phase 9, Workstream D — attribution.
//
// The design is _build/reports/phase9-attribution-design.md. This file exists so
// that the two claims that matter are checked rather than described:
//
//   1. It is an ALLOW-LIST. Not "we strip the dangerous ones" — an unknown
//      parameter is never read, on either side of the wire. The interesting
//      test is therefore not that `utm_source` arrives; it is that
//      `?email=someone@example.com&gclid=…&token=…` does not, and is not in
//      device storage either.
//   2. It is SESSION-SCOPED and OPTIONAL. A visitor with no campaign tags and
//      no external referrer causes zero bytes of storage, and nothing survives
//      the tab.
//
// Both halves are asserted: the browser's capture against a real generated
// page, and the server's `normaliseMeta` in-process, because the server list is
// the one that holds against a hand-written POST that never ran the client.
// =============================================================================
import { test, expect, type Page } from '@playwright/test';
import { META, normaliseMeta, normaliseHost } from '../netlify/functions/lead-contract.mjs';

/** A generated page that carries a form, so both halves can be exercised on it. */
const PAGE = '/ugyfelszolgalat.html';

/** The five, and only the five. Written out rather than derived, so that adding
 *  a sixth to either implementation has to be a deliberate edit here too. */
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

/** Identifiers that must never be read, stored or declared. Each of these is a
 *  per-click identifier a vendor can join back to a person. */
const CLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id', 'dclid'];

const stored = (page: Page) =>
  page.evaluate(() => {
    const raw = window.sessionStorage.getItem('stratos.attribution');
    return raw ? JSON.parse(raw) : null;
  });

test.describe('attribution — the client allow-list', () => {
  test('captures the five UTM parameters and the landing route', async ({ page }) => {
    await page.goto(
      `${PAGE}?utm_source=newsletter&utm_medium=email&utm_campaign=spring-2026` +
      '&utm_content=footer-cta&utm_term=weboldal',
    );

    expect(await stored(page)).toEqual({
      utmSource: 'newsletter',
      utmMedium: 'email',
      utmCampaign: 'spring-2026',
      utmContent: 'footer-cta',
      utmTerm: 'weboldal',
      landingRoute: PAGE,
    });
  });

  test('reads nothing else in the query string', async ({ page }) => {
    // Everything a real URL picks up on its way through the world: somebody
    // else's analytics, a session token in a shared link, and an address.
    await page.goto(
      `${PAGE}?utm_source=partner&email=someone%40example.com&token=s3cr3t` +
      '&ref=affiliate-42&mc_eid=abc123&_ga=GA1.1.999&password=hunter2',
    );

    const attribution = await stored(page);
    expect(attribution).toEqual({ utmSource: 'partner', landingRoute: PAGE });

    // Not merely absent under those names — absent as values, so a rename
    // cannot smuggle one back in.
    const serialised = JSON.stringify(attribution);
    for (const leak of ['someone@example.com', 's3cr3t', 'affiliate-42', 'abc123', 'hunter2']) {
      expect(serialised).not.toContain(leak);
    }
  });

  test('reads no advertising click identifier', async ({ page }) => {
    await page.goto(`${PAGE}?${CLICK_IDS.map((k) => `${k}=CLICKID${k}`).join('&')}`);

    // No allow-listed parameter and no external referrer: nothing to record, so
    // nothing is written at all.
    expect(await stored(page)).toBeNull();

    const params = await page.evaluate(() => Object.keys((window as any).Stratos.lead._attrParams));
    expect(params.sort()).toEqual([...UTM].sort());
    for (const id of CLICK_IDS) expect(params).not.toContain(id);
  });

  test('writes nothing for a visitor with no campaign and no referrer', async ({ page }) => {
    await page.goto(PAGE);
    expect(await stored(page)).toBeNull();
    expect(await page.evaluate(() => window.sessionStorage.length)).toBe(0);
  });

  test('strips characters a campaign label cannot contain, and caps length', async ({ page }) => {
    await page.goto(`${PAGE}?utm_source=${encodeURIComponent('<script>alert(1)</script>')}`);
    let attribution = await stored(page);
    expect(attribution.utmSource).toBe('scriptalert1script');
    expect(attribution.utmSource).not.toContain('<');

    await page.evaluate(() => window.sessionStorage.clear());
    await page.goto(`${PAGE}?utm_campaign=${'x'.repeat(400)}`);
    attribution = await stored(page);
    expect(attribution.utmCampaign).toHaveLength(100);
  });

  test('the campaign survives an internal navigation, and is not overwritten by it',
    async ({ page }) => {
      await page.goto(`${PAGE}?utm_source=newsletter&utm_campaign=spring-2026`);
      // Two hops, the second of which carries its own — and later — tags.
      await page.goto('/szolgaltatasok.html');
      await page.goto(`${PAGE}?utm_source=overwritten`);

      const attribution = await stored(page);
      expect(attribution.utmSource).toBe('newsletter');
      expect(attribution.utmCampaign).toBe('spring-2026');
      expect(attribution.landingRoute).toBe(PAGE);
    });

  test('the landing route is a path, never a URL with a query string', async ({ page }) => {
    await page.goto(`${PAGE}?utm_source=x&token=s3cr3t`);
    const attribution = await stored(page);
    expect(attribution.landingRoute).toBe(PAGE);
    expect(attribution.landingRoute).not.toContain('?');
    expect(attribution.landingRoute).not.toMatch(/^https?:/);
  });

  test('nothing survives the session', async ({ page, context }) => {
    await page.goto(`${PAGE}?utm_source=newsletter`);
    expect(await stored(page)).not.toBeNull();

    // A new context is a new session, which is what closing the tab produces.
    const second = await context.browser()!.newContext();
    const fresh = await second.newPage();
    await fresh.goto(new URL(PAGE, page.url()).href);
    expect(await stored(fresh)).toBeNull();
    await second.close();
  });

  test('no cookie is set, and localStorage is untouched', async ({ page, context }) => {
    await page.goto(`${PAGE}?utm_source=newsletter&utm_campaign=spring-2026`);
    expect(await page.evaluate(() => document.cookie)).toBe('');
    expect(await page.evaluate(() => window.localStorage.length)).toBe(0);
    expect(await context.cookies()).toEqual([]);
  });
});

test.describe('attribution — what reaches the envelope', () => {
  test.beforeEach(() => { test.slow(); });   // the controller waits out MIN_FILL_MS

  test('the submitted envelope carries the campaign and the host, and no query string',
    async ({ page }) => {
      const sent: any[] = [];
      await page.route('**/api/lead', async (route) => {
        sent.push(JSON.parse(route.request().postData() || '{}'));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, submissionId: 'x', leadId: 'test-lead-id' }),
        });
      });

      await page.goto(`${PAGE}?utm_source=newsletter&utm_medium=email&utm_campaign=spring-2026&token=s3cr3t`);
      await page.fill('#vez', 'Kovács');
      await page.fill('#ker', 'János');
      await page.fill('#em', 'janos@example.com');
      await page.fill('#tl', '+36 30 000 0000');
      await page.fill('#cg', 'Példa Kft.');
      await page.fill('#mj', 'Szeretnék árajánlatot kérni egy új weboldalra.');
      await page.check('input[name="adatvedelem_elfogadva"]');
      await page.click('form[data-lead] button[type="submit"]');

      await expect.poll(() => sent.length, { timeout: 20_000 }).toBe(1);

      const meta = sent[0].meta;
      expect(meta.utmSource).toBe('newsletter');
      expect(meta.utmMedium).toBe('email');
      expect(meta.utmCampaign).toBe('spring-2026');
      expect(meta.landingRoute).toBe(PAGE);
      expect(meta.host).toBe('127.0.0.1');
      expect(JSON.stringify(sent[0])).not.toContain('s3cr3t');
    });
});

// -----------------------------------------------------------------------------
// The server list. This is the one that holds: a hand-written POST never ran
// the client, so everything above is a convenience and this is the boundary.
// -----------------------------------------------------------------------------
test.describe('attribution — the server allow-list', () => {
  test('declares the five UTM parameters and no click identifier', () => {
    const keys = Object.keys(META);
    for (const utm of UTM) {
      const camel = utm.replace(/_(.)/g, (_, c) => c.toUpperCase());
      expect(keys).toContain(camel);
    }
    for (const id of CLICK_IDS) {
      expect(keys.map((k) => k.toLowerCase())).not.toContain(id.toLowerCase());
    }
  });

  test('drops every key it does not declare', () => {
    const out = normaliseMeta({
      utmSource: 'newsletter',
      gclid: 'CjwKCA',
      email: 'someone@example.com',
      message: 'a whole enquiry',
      utm_source: 'the underscore spelling is not the declared name',
      ipAddress: '203.0.113.7',
      __proto__: { polluted: true },
    });

    expect(out).toEqual({ utmSource: 'newsletter' });
    expect(JSON.stringify(out)).not.toContain('someone@example.com');
    expect(({} as any).polluted).toBeUndefined();
  });

  test('caps every attribution value at its declared length', () => {
    const out = normaliseMeta({
      utmSource: 'a'.repeat(5000),
      utmCampaign: 'b'.repeat(5000),
    });
    expect(out.utmSource).toHaveLength(META.utmSource.max);
    expect(out.utmCampaign).toHaveLength(META.utmCampaign.max);
  });

  test('refuses a host that is not a bare hostname', () => {
    expect(normaliseHost('Google.com')).toBe('google.com');
    expect(normaliseHost('news.ycombinator.com')).toBe('news.ycombinator.com');

    // Rendered in the portal, so everything below is treated as hostile input.
    expect(normaliseHost('https://evil.example/path')).toBe('');
    expect(normaliseHost('evil.example:8080')).toBe('');
    expect(normaliseHost('javascript:alert(1)')).toBe('');
    expect(normaliseHost('<img src=x onerror=alert(1)>')).toBe('');
    expect(normaliseHost('user:pass@evil.example')).toBe('');
    expect(normaliseHost('..')).toBe('');
    expect(normaliseHost('a b.example')).toBe('');
  });

  test('refuses a landing route that is not a same-site path', () => {
    expect(normaliseMeta({ landingRoute: '/en/contact.html' }).landingRoute).toBe('/en/contact.html');

    for (const hostile of [
      'https://evil.example/', '//evil.example/', 'contact.html',
      'javascript:alert(1)', 'C:\\Windows',
    ]) {
      expect(normaliseMeta({ landingRoute: hostile })).not.toHaveProperty('landingRoute');
    }
  });

  test('a malformed attribution value never fails the submission', () => {
    // Everything hostile at once. The contract's job is to drop it, not to
    // reject the enquiry that carried it.
    const out = normaliseMeta({
      utmSource: '',
      landingRoute: 'https://evil.example',
      landingReferrerHost: 'not a host',
      host: '',
      elapsedMs: 4200,
    });
    expect(out).toEqual({ elapsedMs: 4200 });
  });
});
