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
 * Load a built page, then bring the adapter up against it with a test endpoint.
 *
 * The default build ships no analytics at all, which is the point of the first
 * promise above — so exercising the adapter means configuring it here rather
 * than depending on how `dist/` happened to be built.
 */
async function withAdapter(page: Page, route: string): Promise<Event[]> {
  const events: Event[] = [];

  await page.route('**/api/event', async (r) => {
    await r.fulfill({ status: 204, body: '' });
  });

  await page.goto(route);
  await captureBeacons(page);

  // Only inject if the build did not already configure it — otherwise the
  // adapter would run twice and every event would be duplicated.
  if ((await page.locator('#analytics-config').count()) === 0) {
    await page.evaluate(() => {
      const node = document.createElement('script');
      node.id = 'analytics-config';
      node.type = 'application/json';
      node.textContent = JSON.stringify({ enabled: true, endpoint: '/api/event' });
      document.head.appendChild(node);
    });
    await page.addScriptTag({ path: ADAPTER });
  }

  await settle(events, 1, page);
  return events;
}

const names = (events: Event[]) => events.map((e) => e.event);

// -------------------------------------------------------------------- inert

test.describe('ships nothing unless configured', () => {
  test('the committed generated pages carry no analytics', () => {
    // Guards against a configured build being committed. These are tracked
    // files, generated by _build/build.py, and the default build is silent.
    for (const file of ['kkv.html', 'en/web-design-sme.html', 'de/webdesign-kmu.html']) {
      const html = readFileSync(resolve(ROOT, file), 'utf8');
      expect(html, `${file} must not ship a configured analytics build`)
        .not.toContain('analytics-config');
      expect(html, `${file} must not link the adapter`).not.toContain('analytics.js');
    }
  });

  test('a built page links the adapter only when it also carries a config', async ({ page }) => {
    await page.goto('/kkv.html');
    const hasConfig = (await page.locator('#analytics-config').count()) > 0;
    const hasScript = (await page.locator('script[src*="analytics.js"]').count()) > 0;
    expect(hasScript, 'config and script must ship together or not at all').toBe(hasConfig);

    if (hasConfig) {
      const cfg = JSON.parse((await page.locator('#analytics-config').textContent()) ?? '{}');
      expect(cfg.enabled).toBe(true);
      // The CSP is `connect-src 'self'`. A third-party endpoint could not
      // transmit under it, and must not be introduced without widening the
      // policy deliberately.
      expect(String(cfg.endpoint), 'the endpoint must be same-origin').toMatch(/^\//);
    }
  });

  test('the adapter stays inert without a valid config', async ({ page }) => {
    const seen: string[] = [];
    await page.route('**/api/event', async (r) => { seen.push(r.request().url()); await r.fulfill({ status: 204, body: '' }); });
    await page.goto('/kkv.html');

    // enabled, but with nowhere to send: a misconfiguration is not a reason to
    // start collecting.
    await page.evaluate(() => {
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
