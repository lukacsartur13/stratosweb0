// =============================================================================
// Phase 9, Workstream C — the analytics adapter.
//
// Three promises are made about measurement on this site, and this file exists
// so that none of them is only a promise:
//
//   1. Nothing ships unless it is configured. An unconfigured build emits no
//      config block and no script tag, and the committed generated pages must
//      never carry a configured build.
//   2. No personal data is ever sent. Every field the lead schema declares is
//      refused as an analytics parameter key, so adding a form field fails this
//      suite until the field is listed as prohibited.
//   3. No cookie, no storage. That is what keeps the site consent-free.
//
// The adapter is injected into a real built page rather than tested in
// isolation: the page context it reads (data-page-key, the CTA classes, the
// form lifecycle) is generated markup, and testing it against a fixture would
// prove that the fixture works.
// =============================================================================
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMS } from '../netlify/functions/lead-contract.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTER = resolve(ROOT, 'assets/js/analytics.js');

type Event = Record<string, unknown>;

/**
 * Capture what the adapter hands to the transport.
 *
 * Route interception alone cannot do this. The adapter sends with
 * `navigator.sendBeacon` — the right choice in production, because a beacon
 * survives the pagehide that a CTA click causes where a fetch does not — and
 * WebKit, which the two mobile projects run, does not expose a Blob beacon's
 * body to Playwright at all: the request arrives and is intercepted, but both
 * `postData()` and `postDataBuffer()` are null. Reading it in the page works on
 * every engine, and asserts the payload the adapter actually built.
 *
 * The route interception below stays, so that a request genuinely being issued
 * is still part of what is verified.
 */
async function captureBeacons(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__events = [];
    const original = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url: string, data?: BodyInit | null) {
      if (data instanceof Blob) {
        data.text().then((text) => {
          try { (window as any).__events.push(JSON.parse(text)); } catch { /* not ours */ }
        });
      }
      return original(url, data as any);
    };
  });
}

/** Pull the page's captured events into the node-side array. */
async function pull(page: Page, events: Event[]): Promise<void> {
  const inPage = (await page.evaluate(() => (window as any).__events || [])) as Event[];
  events.length = 0;
  events.push(...inPage);
}

/**
 * Wait for events to actually arrive rather than for a duration to elapse.
 *
 * A fixed timeout is a guess about how fast the machine is, and the mobile
 * projects are emulated and slower than the desktop ones. Polling for the
 * expected count is deterministic on both.
 */
async function settle(events: Event[], atLeast: number, page: Page, budgetMs = 5000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    await pull(page, events);
    if (events.length >= atLeast || Date.now() > deadline) break;
    await page.waitForTimeout(50);
  }
  // A grace period so events arriving *after* the expected ones — the ones a
  // test may be asserting the absence of — are captured too.
  await page.waitForTimeout(200);
  await pull(page, events);
}

/** Clear both sides, so a test can assert on what happens next only. */
async function reset(page: Page, events: Event[]): Promise<void> {
  await page.evaluate(() => { (window as any).__events = []; });
  events.length = 0;
}

/**
 * Load a built page, then bring the adapter up against a test configuration.
 *
 * The shipped configuration is GA4, and GA4 refuses to start on a host that is
 * not on its allowlist — 127.0.0.1 never is. So on the test server the shipped
 * adapter has already run and bailed out by the time the page has loaded, and
 * replacing the config and loading the adapter again is clean rather than a
 * double-bind. That is worth stating plainly, because it only holds *because*
 * the host check works; if it ever stopped working, these tests would start
 * seeing doubled events, which is the failure they should show.
 */
async function withAdapter(page: Page, route: string, config?: object): Promise<Event[]> {
  const events: Event[] = [];

  await page.route('**/api/event', async (r) => {
    await r.fulfill({ status: 204, body: '' });
  });
  // gtag.js must never actually be fetched from Google in a test run.
  await page.route('https://www.googletagmanager.com/**', async (r) => {
    await r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });

  await page.goto(route);
  await captureBeacons(page);

  await page.evaluate((cfg) => {
    const existing = document.getElementById('analytics-config');
    if (existing) existing.remove();
    const node = document.createElement('script');
    node.id = 'analytics-config';
    node.type = 'application/json';
    node.textContent = JSON.stringify(cfg);
    document.head.appendChild(node);
  }, config ?? { enabled: true, endpoint: '/api/event' });
  await page.addScriptTag({ path: ADAPTER });

  await settle(events, 1, page);
  return events;
}

/**
 * The events GA4 received.
 *
 * A GA4-only configuration has no first-party endpoint, so nothing goes through
 * sendBeacon and the beacon capture above sees nothing. gtag's queue is the
 * sink, and reading it is what verifies the GA4 path end to end.
 */
async function ga4Events(page: Page): Promise<Array<{ name: string; params: Record<string, unknown> }>> {
  return page.evaluate(() => ((window as any).dataLayer || [])
    .map((a: unknown) => Array.from(a as ArrayLike<unknown>))
    .filter((a: unknown[]) => a[0] === 'event')
    .map((a: unknown[]) => ({ name: a[1] as string, params: (a[2] ?? {}) as Record<string, unknown> })));
}

/** A GA4 configuration that is allowed to run on the test host. */
function ga4Config(hostname: string, extra: Record<string, unknown> = {}) {
  return {
    enabled: true,
    requireConsent: true,
    ga4: {
      measurementId: 'G-TESTONLY',
      allowHosts: [hostname],
      productionHosts: [],
      ...extra,
    },
  };
}

const names = (events: Event[]) => events.map((e) => e.event);

// ------------------------------------------------------- the shipped build

test.describe('what the shipped build actually configures', () => {
  test('every committed page carries the GA4 config, and it requires consent', () => {
    for (const file of ['kkv.html', 'en/web-design-sme.html', 'de/webdesign-kmu.html']) {
      const html = readFileSync(resolve(ROOT, file), 'utf8');
      const match = html.match(/<script id="analytics-config"[^>]*>([\s\S]*?)<\/script>/);
      expect(match, `${file} must carry an analytics config`).toBeTruthy();

      const cfg = JSON.parse(match![1]);
      expect(cfg.enabled).toBe(true);
      expect(cfg.ga4.measurementId).toBe('G-JZD43PHJ41');

      // GA4 sets cookies, so consent is not a build option that can be
      // forgotten. If this is ever false, the site sets cookies without asking.
      expect(cfg.requireConsent, 'GA4 must never ship without consent required').toBe(true);

      // The first-party sink is the provider-neutral seam, not the production
      // solution, and must not be quietly switched on alongside GA4.
      expect(cfg.endpoint).toBeUndefined();
    }
  });

  test('the host allowlist excludes local, preview and the known-bad domain', () => {
    const html = readFileSync(resolve(ROOT, 'kkv.html'), 'utf8');
    const cfg = JSON.parse(html.match(/<script id="analytics-config"[^>]*>([\s\S]*?)<\/script>/)![1]);

    expect(cfg.ga4.allowHosts).toContain('stratosweb.hu');
    expect(cfg.ga4.allowHosts).toContain('www.stratosweb.hu');
    // Integration testing happens here until the domain cutover.
    expect(cfg.ga4.allowHosts).toContain('stratosweb1.netlify.app');

    for (const forbidden of ['localhost', '127.0.0.1', 'media-stratos.com', 'www.media-stratos.com']) {
      expect(cfg.ga4.allowHosts, `${forbidden} must not be measured`).not.toContain(forbidden);
    }
    // Only the real domain counts as production; everything else is staging.
    expect(cfg.ga4.productionHosts).toEqual(['stratosweb.hu', 'www.stratosweb.hu']);
    expect(cfg.ga4.productionHosts).not.toContain('stratosweb1.netlify.app');
  });

  test('the CSP permits gtag and nothing from the advertising side', () => {
    const toml = readFileSync(resolve(ROOT, 'netlify.toml'), 'utf8');
    // The value is a TOML multi-line string; take it from the directive name to
    // the closing delimiter rather than assuming which header follows it.
    const fence = '"'.repeat(3);
    const from = toml.indexOf('Content-Security-Policy');
    const csp = toml.slice(from, toml.indexOf(fence, toml.indexOf(fence, from) + 3));
    expect(csp.length).toBeGreaterThan(100);

    expect(csp).toContain('https://www.googletagmanager.com');
    expect(csp).toContain('https://www.google-analytics.com');
    // Adding these is what turns analytics into ad tracking.
    expect(csp).not.toContain('doubleclick');
    expect(csp).not.toContain('googleadservices');
    // The strongest part of the policy must survive the widening.
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain('unsafe-eval');
  });

  test('the adapter refuses to run on a host that is not allowlisted', async ({ page }) => {
    // The test server is 127.0.0.1, which is deliberately not on the list, so
    // the *shipped* configuration is what is being exercised here.
    await page.goto('/kkv.html');
    await page.waitForTimeout(400);

    expect(await page.locator('#analytics-config').count()).toBe(1);
    expect(
      await page.evaluate(() => Boolean((window as any).Stratos?.analytics)),
      'a non-allowlisted host must get no adapter at all',
    ).toBe(false);
    expect(await page.evaluate(() => document.cookie)).toBe('');
    expect(await page.evaluate(() => Object.keys(localStorage).length)).toBe(0);
    // And no consent banner, because there is nothing to consent to here.
    expect(await page.locator('.consent').count()).toBe(0);
  });

  test('the adapter stays inert without a valid config', async ({ page }) => {
    const seen: string[] = [];
    await page.route('**/api/event', async (r) => { seen.push(r.request().url()); await r.fulfill({ status: 204, body: '' }); });
    await page.goto('/kkv.html');

    // enabled, but with no sink at all: a misconfiguration is not a reason to
    // start collecting.
    await page.evaluate(() => {
      document.getElementById('analytics-config')?.remove();
      const node = document.createElement('script');
      node.id = 'analytics-config';
      node.type = 'application/json';
      node.textContent = JSON.stringify({ enabled: true });
      document.head.appendChild(node);
    });
    await page.addScriptTag({ path: ADAPTER });
    await page.waitForTimeout(300);

    expect(seen).toHaveLength(0);
    expect(await page.evaluate(() => Boolean((window as any).Stratos?.analytics))).toBe(false);
  });
});

// ------------------------------------------------------------------- the guard

test.describe('no personal data leaves the page', () => {
  test('every field the lead schema declares is refused as a parameter key', async ({ page }) => {
    await withAdapter(page, '/ugyfelszolgalat.html');

    const fields = new Set<string>();
    for (const type of Object.keys(FORMS)) {
      for (const field of Object.keys((FORMS as any)[type].fields)) fields.add(field);
    }
    expect(fields.size).toBeGreaterThan(30);

    // The assertion that matters: adding a field to lead-contract.mjs fails
    // this test until the field is also refused by the adapter.
    const refused = await page.evaluate((list: string[]) => {
      const a = (window as any).Stratos.analytics;
      return list.filter((f) => a._offendingKey({ [f]: 'x' }) === f);
    }, [...fields]);

    expect(refused.sort()).toEqual([...fields].sort());
  });

  test('an event carrying a prohibited parameter is dropped whole', async ({ page }) => {
    const events = await withAdapter(page, '/ugyfelszolgalat.html');
    await reset(page, events);

    await page.evaluate(() => {
      const a = (window as any).Stratos.analytics;
      a.track('clean_event', { locale: 'hu', cta_id: 'body.mid.contact' });
      a.track('with_email', { email: 'someone@example.com' });
      a.track('with_message', { megjegyzes: 'private text' });
      a.track('with_submission_id', { submission_id: 'abc-123' });
      a.track('with_clean_and_dirty', { cta_id: 'x', telefon: '+36301234567' });
    });
    await settle(events, 1, page);

    // Not scrubbed — dropped. A partially-scrubbed event is worse, because it
    // looks like it worked.
    expect(names(events)).toEqual(['clean_event']);
  });

  test('field_name is permitted, because a name is not a value', async ({ page }) => {
    const events = await withAdapter(page, '/ugyfelszolgalat.html');
    await reset(page, events);
    await page.evaluate(() => {
      (window as any).Stratos.analytics.track('form_validation_error', {
        form_type: 'contact', field_name: 'email',
      });
    });
    await settle(events, 1, page);

    expect(names(events)).toEqual(['form_validation_error']);
    expect(events[0].field_name).toBe('email');
    expect(JSON.stringify(events[0])).not.toContain('@');
  });

  test('no payload ever contains an @ or a phone-shaped string', async ({ page }) => {
    const events = await withAdapter(page, '/ugyfelszolgalat.html');
    await page.fill('input[name="email"]', 'visitor@example.com').catch(() => {});
    await page.fill('input[name="telefon"]', '+36301234567').catch(() => {});
    await page.waitForTimeout(300);

    const blob = JSON.stringify(events);
    expect(blob).not.toContain('visitor@example.com');
    expect(blob).not.toContain('+36301234567');
  });
});

// ------------------------------------------------------------- cookie-free

test('measurement sets no cookie and writes no storage', async ({ page }) => {
  await withAdapter(page, '/blog-weboldal-arak.html');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(400);

  const state = await page.evaluate(() => ({
    cookie: document.cookie,
    local: Object.keys(localStorage).length,
    session: Object.keys(sessionStorage).length,
  }));

  // This is what makes the consent-free position true, not the privacy policy.
  expect(state.cookie).toBe('');
  expect(state.local).toBe(0);
  expect(state.session).toBe(0);
  expect(await page.context().cookies()).toHaveLength(0);
});

// ------------------------------------------------------------------- events

test.describe('the taxonomy is actually emitted', () => {
  test('a service page reports its identity, not its slug', async ({ page }) => {
    const events = await withAdapter(page, '/en/web-design-sme.html');
    const view = events.find((e) => e.event === 'page_view');

    expect(view).toBeTruthy();
    // The slug is translated; the key is not. /en/web-design-sme.html and
    // /de/webdesign-kmu.html are both `sme`, which is what makes the three
    // locales aggregable.
    expect(view!.page_key).toBe('sme');
    expect(view!.page_type).toBe('service detail');
    expect(view!.locale).toBe('en');
    expect(names(events)).toContain('service_view');
  });

  test('mid-page and closing CTAs are distinguishable', async ({ page }) => {
    // Without this the whole Workstream A F6 change is unmeasurable: there
    // would be no way to ask whether the mid-page path was worth adding.
    const events = await withAdapter(page, '/blog-weboldal-arak.html');
    await reset(page, events);

    const placements = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll('a.btn').forEach((a) => {
        const declared = (a as HTMLElement).closest('[data-cta-placement]');
        if (declared) out.push(declared.getAttribute('data-cta-placement')!);
        else if ((a as HTMLElement).closest('.article__aside')) out.push('mid');
        else if ((a as HTMLElement).closest('.launch')) out.push('closing');
      });
      return out;
    });

    expect(placements).toContain('mid');
    expect(placements).toContain('closing');
  });

  test('article progress fires at most four times, once per threshold', async ({ page }) => {
    const events = await withAdapter(page, '/blog-weboldal-arak.html');
    await reset(page, events);

    // Down, back up, and down again — a real reader's scrolling.
    for (const f of [0.3, 0.6, 0.2, 0.8, 0.5, 0.99]) {
      await page.evaluate((v) => {
        const h = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, h * v);
      }, f);
      await page.waitForTimeout(220);
    }

    const progress = events.filter((e) => e.event === 'article_progress');
    const pcts = progress.map((e) => e.progress_pct);
    expect(progress.length).toBeLessThanOrEqual(4);
    expect(new Set(pcts).size).toBe(pcts.length);   // monotonic, never re-fired
    for (const p of pcts) expect([25, 50, 75, 90]).toContain(p);
    expect(progress.every((e) => e.article_key === 'post-arak')).toBe(true);
  });

  test('the questionnaire funnel is measured without a <form>', async ({ page }) => {
    const events = await withAdapter(page, '/arajanlat.html');

    // The premise: the wizard genuinely has no form element to bind to.
    expect(await page.locator('#app form').count()).toBe(0);
    await reset(page, events);

    await page.click('#start');
    await page.waitForTimeout(250);
    await page.fill('#inp', 'Teszt Kft');
    await page.click('#next');
    await settle(events, 4, page);

    expect(names(events)).toContain('questionnaire_start');

    const steps = events.filter((e) => e.event === 'questionnaire_step_view');
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps[0].step_index).toBe(1);
    // step_key is a field name, never an answer.
    expect(steps[0].step_key).toBe('cegnev');
    expect(JSON.stringify(events)).not.toContain('Teszt Kft');
  });
});

// ------------------------------------------------------------------- drift

test('the page-type table matches the one the reports use', async ({ page }) => {
  // Two copies exist because the reports are Node and the site is not. This
  // fails the day they diverge, rather than quietly mislabelling every event.
  const matrix = readFileSync(resolve(ROOT, 'scripts/route-matrix.mjs'), 'utf8');
  const block = matrix.slice(
    matrix.indexOf('const ARCHETYPE_BY_KEY = {'),
    matrix.indexOf('};', matrix.indexOf('const ARCHETYPE_BY_KEY = {')),
  );

  const expected: Record<string, string> = {};
  for (const [, key, value] of block.matchAll(/(\w[\w-]*):\s*'([^']+)'/g)) expected[key] = value;
  expect(Object.keys(expected).length).toBeGreaterThan(10);

  await withAdapter(page, '/kkv.html');
  const actual = await page.evaluate((keys: string[]) => {
    const a = (window as any).Stratos.analytics;
    const out: Record<string, string> = {};
    for (const k of keys) out[k] = a._pageTypeOf(k);
    return out;
  }, Object.keys(expected));

  expect(actual).toEqual(expected);
  // And the two families the reports resolve by prefix.
  const families = await page.evaluate(() => {
    const a = (window as any).Stratos.analytics;
    return { case: a._pageTypeOf('case-rapidkert'), post: a._pageTypeOf('post-arak') };
  });
  expect(families).toEqual({ case: 'case study', post: 'article' });
});

// ------------------------------------------------------ GA4 + consent mode

test.describe('GA4 loads only after consent', () => {
  const gtagRequests = (page: Page) => {
    const hits: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('googletagmanager.com') || r.url().includes('google-analytics.com')) {
        hits.push(r.url());
      }
    });
    return hits;
  };

  test('nothing is contacted, stored or sent before an answer is given', async ({ page }) => {
    const hits = gtagRequests(page);
    await withAdapter(page, '/kkv.html', ga4Config('127.0.0.1'));
    await page.waitForTimeout(500);

    // Basic Consent Mode, the strict reading: the tag is not loaded at all, so
    // a visitor who has not answered causes no contact with Google whatsoever.
    expect(hits, 'no Google request before consent').toHaveLength(0);
    expect(await page.evaluate(() => document.cookie)).toBe('');
    expect(await page.evaluate(() => Boolean((window as any).dataLayer))).toBe(false);
    expect(await page.evaluate(() => (window as any).Stratos.analytics.consentState())).toBe('denied');
  });

  test('refusing loads nothing, and is remembered', async ({ page }) => {
    const hits = gtagRequests(page);
    await withAdapter(page, '/kkv.html', ga4Config('127.0.0.1'));
    await page.evaluate(() => (window as any).Stratos.analytics.consent('denied'));
    await page.waitForTimeout(400);

    expect(hits).toHaveLength(0);
    expect(await page.evaluate(() => document.cookie)).toBe('');
    // Remembering the refusal is what stops the banner asking on every page.
    const stored = await page.evaluate(() => localStorage.getItem('stratos.consent'));
    expect(JSON.parse(stored ?? '{}').state).toBe('denied');
  });

  test('accepting loads gtag, and only then', async ({ page }) => {
    const hits = gtagRequests(page);
    await withAdapter(page, '/kkv.html', ga4Config('127.0.0.1'));
    expect(hits).toHaveLength(0);

    await page.evaluate(() => (window as any).Stratos.analytics.consent('granted'));
    await page.waitForTimeout(600);

    expect(hits.some((u) => u.includes('/gtag/js?id=G-TESTONLY'))).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('stratos.consent'))).toContain('granted');
  });

  test('advertising storage is refused even when analytics is accepted', async ({ page }) => {
    await withAdapter(page, '/kkv.html', ga4Config('127.0.0.1'));
    await page.evaluate(() => (window as any).Stratos.analytics.consent('granted'));
    await page.waitForTimeout(400);

    const layer = await page.evaluate(() =>
      ((window as any).dataLayer || []).map((a: unknown) => JSON.stringify(Array.from(a as ArrayLike<unknown>))));
    const consentCall = layer.find((c: string) => c.includes('"consent"') && c.includes('default'));

    expect(consentCall, 'a consent default must be set before config').toBeTruthy();
    expect(consentCall).toContain('"ad_storage":"denied"');
    expect(consentCall).toContain('"ad_personalization":"denied"');
    expect(consentCall).toContain('"analytics_storage":"granted"');

    const configCall = layer.find((c: string) => c.includes('"config"'));
    expect(configCall).toContain('"allow_google_signals":false');
    // GA4's own automatic page view would double count the taxonomy's one.
    expect(configCall).toContain('"send_page_view":false');
  });

  test('withdrawal stops sending and clears the cookies', async ({ page }) => {
    await withAdapter(page, '/kkv.html', ga4Config('127.0.0.1'));
    await page.evaluate(() => (window as any).Stratos.analytics.consent('granted'));
    await page.waitForTimeout(300);

    // Stand in for what GA4 would have written.
    await page.evaluate(() => { document.cookie = '_ga=GA1.1.123.456; path=/'; });
    expect(await page.evaluate(() => document.cookie)).toContain('_ga');

    await page.evaluate(() => (window as any).Stratos.analytics.consent('denied'));
    await page.waitForTimeout(300);

    // "You can withdraw consent" is only half true if the cookies survive it.
    expect(await page.evaluate(() => document.cookie)).not.toContain('_ga');
    const layer = await page.evaluate(() =>
      ((window as any).dataLayer || []).map((a: unknown) => JSON.stringify(Array.from(a as ArrayLike<unknown>))));
    expect(layer.some((c: string) => c.includes('update') && c.includes('"analytics_storage":"denied"'))).toBe(true);
  });

  test('staging traffic is distinguishable from production', async ({ page }) => {
    // 127.0.0.1 is allowed but not a production host, so it is staging.
    await withAdapter(page, '/kkv.html', ga4Config('127.0.0.1'));
    expect(await ga4Events(page), 'nothing sent before consent').toHaveLength(0);

    await page.evaluate(() => (window as any).Stratos.analytics.consent('granted'));
    await page.waitForTimeout(400);

    const sent = await ga4Events(page);
    expect(sent.length).toBeGreaterThan(0);
    // 127.0.0.1 is allowlisted here but is not a production host, so every
    // event it produces is marked staging and can be excluded from reporting.
    expect(sent[0].params.environment).toBe('staging');
    expect(await page.evaluate(() => (window as any).Stratos.analytics.environment)).toBe('staging');
  });

  test('the queue is discarded on refusal, not replayed later', async ({ page }) => {
    await withAdapter(page, '/kkv.html', ga4Config('127.0.0.1'));
    await page.evaluate(() => (window as any).Stratos.analytics.consent('denied'));
    await page.waitForTimeout(200);
    // Change of mind: only what happens from now on may be sent.
    await page.evaluate(() => (window as any).Stratos.analytics.consent('granted'));
    await page.waitForTimeout(400);

    const sent = await ga4Events(page);
    expect(sent.filter((e) => e.name === 'page_view'),
      'events queued before a refusal must be discarded, not replayed').toHaveLength(0);
  });
});

// ----------------------------------------------------------- consent UI

test.describe('the consent interface', () => {
  async function withConsentUI(page: Page) {
    await page.route('https://www.googletagmanager.com/**', async (r) => {
      await r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    });
    await page.goto('/kkv.html');
    await page.evaluate((cfg) => {
      document.getElementById('analytics-config')?.remove();
      const node = document.createElement('script');
      node.id = 'analytics-config';
      node.type = 'application/json';
      node.textContent = JSON.stringify(cfg);
      document.head.appendChild(node);
    }, ga4Config('127.0.0.1'));
    await page.addScriptTag({ path: resolve(ROOT, 'assets/js/analytics.js') });
    await page.addScriptTag({ path: resolve(ROOT, 'assets/js/consent.js') });
    await page.waitForTimeout(300);
  }

  test('offers accept and refuse with equal weight', async ({ page }) => {
    await withConsentUI(page);

    const banner = page.locator('.consent');
    await expect(banner).toBeVisible();

    const buttons = banner.locator('.consent__btn');
    await expect(buttons).toHaveCount(2);

    // Not a dark pattern: the two answers are the same element, same classes,
    // same size. Neither is styled to be the obvious one.
    const [acceptClass, declineClass] = await buttons.evaluateAll((els) => els.map((e) => e.className));
    expect(acceptClass).toBe(declineClass);

    // Width follows the label — "Nem járulok hozzá" is simply a longer phrase
    // than "Elfogadom" — so what has to match is the *treatment*: identical
    // colour, weight, border, size and padding. A refusal styled to look
    // secondary is the dark pattern, not a refusal with more letters in it.
    const [acceptStyle, declineStyle] = await buttons.evaluateAll((els) =>
      els.map((e) => {
        const s = getComputedStyle(e);
        return [s.backgroundColor, s.color, s.borderColor, s.borderWidth,
          s.fontSize, s.fontWeight, s.fontFamily, s.opacity, s.padding, s.textTransform].join('|');
      }));
    expect(acceptStyle).toBe(declineStyle);

    const [acceptBox, declineBox] = await buttons.evaluateAll((els) =>
      els.map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
    expect(Math.abs(acceptBox.h - declineBox.h), 'same height').toBeLessThan(2);
    // Neither may be made small enough to be hard to hit.
    expect(Math.min(acceptBox.w, declineBox.w)).toBeGreaterThan(80);

    // Refusing is one click, not hidden behind a preferences screen.
    await buttons.nth(1).click();
    await expect(banner).toBeHidden();
    expect(await page.evaluate(() => (window as any).Stratos.analytics.consentState())).toBe('denied');
  });

  test('cannot be dismissed into implied consent', async ({ page }) => {
    await withConsentUI(page);
    const banner = page.locator('.consent');

    // There is no close control at all, and Escape does not answer for you.
    expect(await banner.locator('[aria-label*="close" i], .consent__close').count()).toBe(0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await expect(banner).toBeVisible();
    expect(await page.evaluate(() => (window as any).Stratos.analytics.consentState())).toBe('denied');
    expect(await page.evaluate(() => localStorage.getItem('stratos.consent'))).toBeNull();
  });

  test('does not block the page, and is reachable from the keyboard', async ({ page }) => {
    await withConsentUI(page);

    // Not a modal: the page underneath is still usable while it is open.
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');

    // Focus is moved into the banner rather than left for the visitor to find.
    const focused = await page.evaluate(() => document.activeElement?.className ?? '');
    expect(focused).toContain('consent__btn');
  });

  test('the choice can be reopened and reversed from the footer', async ({ page }) => {
    await withConsentUI(page);
    await page.locator('.consent__btn').first().click();      // accept
    await expect(page.locator('.consent')).toBeHidden();
    expect(await page.evaluate(() => (window as any).Stratos.analytics.consentState())).toBe('granted');

    const settings = page.locator('[data-consent-settings]').first();
    await expect(settings).toBeVisible();
    await settings.click();
    await expect(page.locator('.consent')).toBeVisible();

    await page.locator('.consent__btn').nth(1).click();       // withdraw
    expect(await page.evaluate(() => (window as any).Stratos.analytics.consentState())).toBe('denied');
  });

  test('a remembered answer is not asked again', async ({ page }) => {
    await withConsentUI(page);
    await page.locator('.consent__btn').nth(1).click();
    await withConsentUI(page);                                 // second visit
    await expect(page.locator('.consent')).toBeHidden();
  });
});

// ------------------------------------------------ the policy vs the system

test.describe('the privacy policy describes the system that exists', () => {
  const LEGAL = [
    ['adatkezelesi-tajekoztato.html', 'hu'],
    ['en/privacy-policy.html', 'en'],
    ['de/datenschutz.html', 'de'],
  ] as const;

  // The Phase 9 baseline found the policy declaring Google Analytics, a Meta
  // Pixel and a marketing-cookie taxonomy that did not exist anywhere in the
  // codebase — inherited from the pre-rework Wix site. The document was wrong,
  // not the system. These assertions are what stop the two drifting apart
  // again, in whichever direction.

  /* What the page tells a visitor — HTML comments stripped. The source carries
     a review marker that describes the inaccurate claims it replaced, and a
     content assertion must not match the description of the thing it forbids. */
  const visibleText = (file: string) =>
    readFileSync(resolve(ROOT, file), 'utf8').replace(/<!--[\s\S]*?-->/g, ' ');

  test('declares no processor or tracker that is not implemented', () => {
    const implemented = readFileSync(resolve(ROOT, 'assets/js/analytics.js'), 'utf8');
    const hasPixel = /fbq|connect\.facebook|facebook\.net/i.test(implemented);
    expect(hasPixel, 'no Meta Pixel is implemented').toBe(false);

    for (const [file] of LEGAL) {
      const html = visibleText(file);

      // Meta Pixel may only appear as a denial, never as a declared processor.
      const claimsPixel = /Meta Platforms[^<]*Pixel|Szolgáltatások:[^<]*Meta Pixel/i.test(html);
      expect(claimsPixel, `${file} must not declare a Meta Pixel that does not exist`).toBe(false);

      // Search Console is not visitor analytics and not a processor.
      if (html.includes('Search Console')) {
        const asProcessor = /Search Console[^<]*(hirdetési|advertising|Werbe)/i.test(html);
        expect(asProcessor, `${file} must not list Search Console as a tracking processor`).toBe(false);
      }
    }
  });

  test('describes GA4 as consent-gated, and says consent can be withdrawn', () => {
    const expected: Record<string, RegExp[]> = {
      hu: [/Google Analytics 4/, /hozzájárul/i, /visszavon/i, /Süti-beállítások/],
      en: [/Google Analytics 4/, /consent/i, /withdraw/i, /Cookie settings/],
      de: [/Google Analytics 4/, /Einwilligung/i, /[Ww]iderruf/, /Cookie-Einstellungen/],
    };

    for (const [file, locale] of LEGAL) {
      const html = visibleText(file);
      for (const re of expected[locale]) {
        expect(re.test(html), `${file} must mention ${re}`).toBe(true);
      }
    }
  });

  test('the cookie names it lists are the ones that can actually be set', () => {
    const adapter = readFileSync(resolve(ROOT, 'assets/js/analytics.js'), 'utf8');
    // The adapter clears cookies by this prefix; the policy names the same ones.
    expect(adapter).toContain("indexOf('_ga')");
    expect(adapter).toContain('stratos.consent');

    for (const [file] of LEGAL) {
      const html = visibleText(file);
      expect(html, `${file} must name the _ga cookies`).toContain('_ga');
      expect(html, `${file} must name the consent storage key`).toContain('stratos.consent');
    }
  });

  test('is flagged for legal review before launch', () => {
    // Item 11 of the brief. A marker in the source rather than a banner for
    // visitors: telling the public that the privacy policy has not been
    // checked would be worse than the problem it documents.
    for (const [file] of LEGAL) {
      const html = readFileSync(resolve(ROOT, file), 'utf8');
      expect(html, `${file} must carry the pre-launch review marker`)
        .toContain('REQUIRES FINAL LEGAL REVIEW BEFORE PRODUCTION LAUNCH');
    }
  });
});
