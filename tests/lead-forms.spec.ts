import { test, expect, type Page } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The public forms, from the visitor's side.
 *
 * dist/ is static, so nothing answers /api/lead in a test run. Every test here
 * intercepts the call: what the browser *sends* and what it *shows* for each
 * reply is exactly the half of the contract that lives in the page. The server
 * half is asserted in lead-endpoint.spec.ts.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

type Reply = { status?: number; body?: unknown; delayMs?: number };

/**
 * Intercept /api/lead, record every envelope posted, answer with `reply`.
 *
 * The default reply is the real success contract — `{ ok, submissionId,
 * leadId }` — because a page that only works against `{ ok: true }` is a page
 * that has not been tested against the endpoint it actually talks to.
 */
async function interceptLead(page: Page, reply: Reply = {}) {
  const sent: any[] = [];
  await page.route('**/api/lead', async (route) => {
    const envelope = JSON.parse(route.request().postData() || '{}');
    sent.push(envelope);
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    await route.fulfill({
      status: reply.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(reply.body ?? {
        ok: true, submissionId: envelope.submissionId, leadId: 'test-lead-id',
      }),
    });
  });
  return sent;
}

/**
 * Every test in this file is slow by construction, and it is worth saying why
 * rather than papering over it with retries.
 *
 * The controller deliberately waits out the server's three-second minimum fill
 * time instead of being silently dropped by it, so no submission here can
 * complete in under three seconds. Several tests then hold the reply open for
 * another 1.5–2.5s to observe the in-flight state, and two of them submit
 * twice. Against a `fullyParallel` project that is a lot of concurrent browser
 * contexts all sleeping at once, and on a loaded machine the default timeout
 * runs out before the assertion is wrong — which showed up as a different test
 * failing on each run.
 *
 * `test.slow()` triples the timeout for the whole file. It changes no
 * assertion and hides no failure: a submission that genuinely never completes
 * still fails, just later.
 */
test.beforeEach(() => {
  test.slow();
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Every envelope must satisfy the contract, whatever form produced it. */
function expectWellFormed(envelope: any, formType: string, route: string, locale = 'hu') {
  expect(envelope.submissionId).toMatch(UUID_RE);
  expect(envelope.formType).toBe(formType);
  expect(envelope.locale).toBe(locale);
  expect(envelope.route).toBe(route);
  expect(typeof envelope.fields).toBe('object');
  expect(Array.isArray(envelope.fields)).toBe(false);
  // The honeypot travels in meta, never in fields, so no schema can declare it.
  expect(envelope.fields).not.toHaveProperty('company_website');
  expect(envelope.meta).toHaveProperty('botField');
  expect(envelope.meta.elapsedMs).toBeGreaterThanOrEqual(3000);
  // Nothing that used to be sent to a third party goes out any more.
  expect(JSON.stringify(envelope)).not.toMatch(/access_key|web3forms/i);
}

async function fillContact(page: Page) {
  await page.fill('#vez', 'Kovács');
  await page.fill('#ker', 'János');
  await page.fill('#em', 'janos@example.com');
  await page.fill('#tl', '+36 30 000 0000');
  await page.fill('#cg', 'Példa Kft.');
  await page.fill('#mj', 'Szeretnék árajánlatot kérni egy új weboldalra.');
  await page.check('input[name="adatvedelem_elfogadva"]');
}

/** The live region the form reports into. One per page that has a real form. */
const status = (page: Page) => page.locator('.form__status');

test.describe('contact form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ugyfelszolgalat.html');
  });

  test('a valid submission reaches /api/lead with every field mapped', async ({ page }) => {
    const sent = await interceptLead(page);
    await fillContact(page);
    await page.getByRole('button', { name: 'Küldés' }).click();

    await expect(status(page)).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
    expect(sent).toHaveLength(1);

    const envelope = sent[0];
    expectWellFormed(envelope, 'contact', '/ugyfelszolgalat.html');

    // Field names travel as they are in the markup. Mapping them to lead
    // columns is the server's job and is asserted in lead-endpoint.spec.ts —
    // the page's job is to send every answer, under the name the schema knows.
    expect(envelope.fields).toMatchObject({
      vezeteknev: 'Kovács',
      keresztnev: 'János',
      email: 'janos@example.com',
      telefon: '+36 30 000 0000',
      ceg: 'Példa Kft.',
      megjegyzes: 'Szeretnék árajánlatot kérni egy új weboldalra.',
      adatvedelem_elfogadva: 'Igen',
    });
    // An unchecked optional consent posts nothing at all, which the server's
    // `consent` rule reads as "not given".
    expect(envelope.fields.hirlevel).toBeUndefined();
    expect(envelope.meta.botField).toBe('');
  });

  test('shows the success state and clears the form', async ({ page }) => {
    await interceptLead(page);
    await fillContact(page);
    await page.getByRole('button', { name: 'Küldés' }).click();

    await expect(status(page)).toHaveText(/Köszönjük/, { timeout: 15_000 });
    await expect(page.locator('#em')).toHaveValue('');
    // The button stays out of action: it went through, and a second press
    // would only produce a duplicate.
    await expect(page.getByRole('button', { name: /Elküldve/ })).toBeDisabled();
  });

  test('shows a submitting state while the request is in flight', async ({ page }) => {
    await interceptLead(page, { delayMs: 1500 });
    await fillContact(page);
    await page.getByRole('button', { name: 'Küldés' }).click();

    await expect(status(page)).toHaveAttribute('data-state', 'submitting', { timeout: 15_000 });
    await expect(status(page)).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
  });

  test('shows the rate-limited state on 429 and lets the visitor retry', async ({ page }) => {
    await interceptLead(page, {
      status: 429,
      body: { ok: false, code: 'RATE_LIMITED', message: 'Túl sok beküldés egymás után. Kérlek, várj egy percet.' },
    });
    await fillContact(page);
    await page.getByRole('button', { name: 'Küldés' }).click();

    await expect(status(page)).toHaveAttribute('data-state', 'limited', { timeout: 15_000 });
    await expect(status(page)).toHaveText(/várj egy percet/i);
    await expect(page.getByRole('button', { name: 'Küldés' })).toBeEnabled();
  });

  test('shows a generic server-error state on 500', async ({ page }) => {
    await interceptLead(page, {
      status: 500,
      body: { ok: false, code: 'STORE_FAILED', message: 'We could not save that.' },
    });
    await fillContact(page);
    await page.getByRole('button', { name: 'Küldés' }).click();

    await expect(status(page)).toHaveAttribute('data-state', 'error', { timeout: 15_000 });
    // Nothing internal leaks into the page.
    await expect(status(page)).not.toHaveText(/postgres|supabase|constraint/i);
    await expect(page.getByRole('button', { name: 'Küldés' })).toBeEnabled();
  });

  test("surfaces the server's own validation message on 422", async ({ page }) => {
    await interceptLead(page, {
      status: 422,
      body: {
        ok: false,
        code: 'VALIDATION_FAILED',
        message: 'Please check the highlighted fields.',
        errors: { email: 'That email address does not look right.' },
      },
    });
    await fillContact(page);
    await page.getByRole('button', { name: 'Küldés' }).click();

    await expect(status(page)).toHaveAttribute('data-state', 'invalid', { timeout: 15_000 });
    await expect(status(page)).toHaveText(/does not look right/i);
  });

  test('rejects a malformed address in the page, before the network', async ({ page }) => {
    const sent = await interceptLead(page);
    await fillContact(page);
    await page.fill('#em', 'not-an-address');

    // Submitted the way a script would, which is also the only way past the
    // browser's own constraint validation — so this asserts our layer, not it.
    await page.evaluate(() => {
      document.querySelector('form[data-lead="contact"]')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await expect(status(page)).toHaveAttribute('data-state', 'invalid');
    await page.waitForTimeout(4000);
    expect(sent, 'an invalid address must never reach the endpoint').toHaveLength(0);
  });

  test('rejects a submission with no name at all', async ({ page }) => {
    const sent = await interceptLead(page);
    await fillContact(page);
    await page.fill('#vez', '');
    await page.fill('#ker', '');

    await page.evaluate(() => {
      document.querySelector('form[data-lead="contact"]')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await expect(status(page)).toHaveText(/add meg a nevedet/i);
    await page.waitForTimeout(4000);
    expect(sent).toHaveLength(0);
  });

  test('an empty form never reaches the network', async ({ page }) => {
    const sent = await interceptLead(page);
    await page.getByRole('button', { name: 'Küldés' }).click();
    await page.waitForTimeout(4000);
    expect(sent).toHaveLength(0);
  });

  test('carries a filled honeypot through untouched, for the server to drop', async ({ page }) => {
    const sent = await interceptLead(page);
    await fillContact(page);
    await page.fill('#hp-contact', 'https://spam.example');
    await page.getByRole('button', { name: 'Küldés' }).click();

    await expect(status(page)).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
    // The page must not decide this locally — the endpoint answers a filled
    // honeypot with a success no bot can tell from the real thing.
    expect(sent[0].meta.botField).toBe('https://spam.example');
    expect(sent[0].fields).not.toHaveProperty('company_website');
  });

  test('a double click produces exactly one request', async ({ page }) => {
    // A slow reply keeps the first request in flight while the second click
    // lands — which is the only arrangement in which the guard can be wrong.
    const sent = await interceptLead(page, { delayMs: 2500 });
    await fillContact(page);

    const button = page.getByRole('button', { name: 'Küldés' });
    await button.click();
    await button.click({ force: true, noWaitAfter: true }).catch(() => {});

    await expect(status(page)).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
    expect(sent, 'a second click must not create a second lead').toHaveLength(1);
  });

  test('Enter in a text field cannot slip a second request past the disabled button', async ({ page }) => {
    const sent = await interceptLead(page, { delayMs: 2500 });
    await fillContact(page);
    await page.getByRole('button', { name: 'Küldés' }).click();

    // A disabled submit button does not stop an implicit submit from a text
    // input, so the guard has to be on the form, not on the button.
    await page.evaluate(() => {
      document.querySelector('form[data-lead="contact"]')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await expect(status(page)).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
    expect(sent).toHaveLength(1);
  });

  test('a network failure shows the failure state and keeps everything typed', async ({ page }) => {
    await page.route('**/api/lead', (route) => route.abort('failed'));
    await fillContact(page);
    await page.getByRole('button', { name: 'Küldés' }).click();

    await expect(status(page)).toHaveAttribute('data-state', 'error', { timeout: 15_000 });
    // Nothing the visitor typed may be lost by a failure they did not cause.
    await expect(page.locator('#em')).toHaveValue('janos@example.com');
    await expect(page.locator('#mj')).toHaveValue('Szeretnék árajánlatot kérni egy új weboldalra.');
    await expect(page.getByRole('button', { name: 'Küldés' })).toBeEnabled();
  });

  test('a retry after a failure re-sends the same submission id', async ({ page }) => {
    let fail = true;
    const sent: any[] = [];
    await page.route('**/api/lead', async (route) => {
      const envelope = JSON.parse(route.request().postData() || '{}');
      sent.push(envelope);
      if (fail) { fail = false; return route.abort('failed'); }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, submissionId: envelope.submissionId, leadId: 'x' }),
      });
    });

    await fillContact(page);
    await page.getByRole('button', { name: 'Küldés' }).click();
    await expect(status(page)).toHaveAttribute('data-state', 'error', { timeout: 15_000 });

    await page.getByRole('button', { name: 'Küldés' }).click();
    await expect(status(page)).toHaveAttribute('data-state', 'success', { timeout: 15_000 });

    expect(sent).toHaveLength(2);
    // The idempotency key is what stops a retry becoming a second lead, so it
    // has to be the *same* key — and the attempt counter has to say it is a retry.
    expect(sent[1].submissionId).toBe(sent[0].submissionId);
    expect(sent[0].meta.attempt).toBe(1);
    expect(sent[1].meta.attempt).toBe(2);
  });

  test('a fresh enquiry after a success gets a new submission id', async ({ page }) => {
    const sent = await interceptLead(page);
    await fillContact(page);
    await page.getByRole('button', { name: 'Küldés' }).click();
    await expect(status(page)).toHaveAttribute('data-state', 'success', { timeout: 15_000 });

    // The button stays disabled after a success, so a second enquiry means a
    // fresh page — but the id must not be reused even if it did not.
    await page.evaluate(() => {
      const form = document.querySelector('form[data-lead="contact"]') as HTMLFormElement;
      form.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    });
    await fillContact(page);
    await page.getByRole('button', { name: /Elküldve|Küldés/ }).click();
    await expect.poll(() => sent.length, { timeout: 15_000 }).toBe(2);

    expect(sent[1].submissionId).not.toBe(sent[0].submissionId);
  });

  test('the honeypot is hidden from sight and from the tab order', async ({ page }) => {
    const hp = page.locator('#hp-contact');
    await expect(hp).not.toBeInViewport();
    await expect(hp).toHaveAttribute('tabindex', '-1');
    await expect(hp.locator('xpath=..')).toHaveAttribute('aria-hidden', 'true');
  });
});

/**
 * The minimum fill wait, which is the one thing in this controller that can
 * lose a real enquiry without anyone finding out.
 *
 * `submit-lead.mjs` discards any envelope whose `meta.elapsedMs` is below
 * `MIN_FILL_MS` (3 000) as automated — and `dropSilently` answers that discard
 * with HTTP 200, `ok: true` and a freshly invented `leadId`. The page cannot
 * tell that apart from a stored lead, so it shows the success copy and the
 * enquiry is gone. There is no error anywhere: the only trace is a
 * `drop.tooFast` line in a function log nobody reads.
 *
 * The controller therefore waits the threshold out rather than being dropped by
 * it. These two tests assert the two properties that wait has to have, both of
 * which it lacked when the g4 gate caught it reporting 2 996 ms — see
 * _build/reports/lead-silent-drop/root-cause-before-fix.md.
 */
test.describe('the minimum fill wait', () => {
  // No shared `beforeEach` navigation here: both tests need to arm the page
  // before it loads, or to timestamp the load from outside it.

  test('a backward wall-clock step during the wait cannot under-report the fill time', async ({ page }) => {
    // The wait is scheduled on the browser's monotonic timebase and, before the
    // fix, was MEASURED on `Date.now()` — the adjustable wall clock. A backward
    // adjustment between the two made the envelope report less time than the
    // controller had actually spent waiting, and the server dropped it.
    //
    // 400 ms rather than the 4 ms the gate observed: the same mechanism, at a
    // size that cannot be confused with scheduling noise in either direction.
    await page.addInitScript(() => {
      const real = Date.now.bind(Date);
      let offset = 0;
      Date.now = () => real() - offset;
      // Capture phase, so this is armed before the controller's own listener
      // computes the wait. The step lands 500 ms in — inside the wait, long
      // after it was scheduled and long before it fires.
      document.addEventListener('submit', () => {
        setTimeout(() => { offset += 400; }, 500);
      }, true);
    });

    await page.goto('/ugyfelszolgalat.html');
    // Taken AFTER the navigation resolves, so it is no earlier than the moment
    // the controller started its own window — which makes the interval measured
    // from it a LOWER bound on the time the controller really waited. Measured
    // out here, where the page's patched clock cannot reach it: the fix has to
    // make the report true, not merely large enough to pass.
    const readyAt = Date.now();

    const sent = await interceptLead(page);
    await fillContact(page);
    await page.getByRole('button', { name: 'Küldés' }).click();
    await expect(status(page)).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
    const realElapsed = Date.now() - readyAt;

    // One user submission, one request. A fix that retried would pass the
    // assertion below and create a second lead.
    expect(sent).toHaveLength(1);
    expect(sent[0].meta.attempt).toBe(1);
    expect(sent[0].submissionId).toMatch(UUID_RE);

    // The envelope must not carry a value the server will discard.
    expect(sent[0].meta.elapsedMs).toBeGreaterThanOrEqual(3000);
    // …and it must not be an inflated one either: the controller really did
    // wait that long, whatever the page's clock was told to say.
    expect(realElapsed).toBeGreaterThanOrEqual(3000);
  });

  test('the wait clears the drop threshold with headroom rather than landing on it', async ({ page }) => {
    await page.goto('/ugyfelszolgalat.html');
    // The second half of the defect, and the reason the first half was fatal:
    // the controller aimed at EXACTLY `MIN_FILL_MS`, so any shortfall of any
    // size crossed the threshold. `setTimeout` truncates its delay to whole
    // milliseconds, which is a shortfall of up to 1 ms on its own — before any
    // clock adjustment is involved.
    //
    // The floor asserted here is the contract, not the constant: it is spelled
    // out so that removing the headroom fails this test rather than silently
    // restoring a boundary-exact aim.
    const sent = await interceptLead(page);
    await fillContact(page);
    await page.getByRole('button', { name: 'Küldés' }).click();
    await expect(status(page)).toHaveAttribute('data-state', 'success', { timeout: 15_000 });

    expect(sent).toHaveLength(1);
    expect(sent[0].meta.elapsedMs).toBeGreaterThanOrEqual(3200);
  });
});

test.describe('newsletter', () => {
  test('subscribes with only an address, as its own source', async ({ page }) => {
    await page.goto('/rolunk.html');
    const sent = await interceptLead(page);

    await page.fill('#nl', 'reader@example.com');
    await page.getByRole('button', { name: 'Szóljatok' }).click();

    const note = page.locator('.form__note[data-state="success"]');
    await expect(note).toBeVisible({ timeout: 15_000 });
    expect(sent).toHaveLength(1);
    expectWellFormed(sent[0], 'newsletter', '/rolunk.html');
    expect(sent[0].fields).toEqual({ email: 'reader@example.com' });
    // No name to give, and none invented in the page: the endpoint owns that.
    expect(sent[0].fields.name).toBeUndefined();

    // What the visitor is told must be what happens. There is no newsletter
    // system: the address is stored and nothing is sent. The general success
    // message promises a reply, so the newsletter has its own — and the
    // assertion is that the reply promise is NOT what appears here.
    await expect(note).not.toContainText(/válaszolunk/i);
    await expect(note).toContainText(/hírlevelet még nem küldünk/i);
  });

  test('the blog signup posts to the same endpoint', async ({ page }) => {
    await page.goto('/blog.html');
    const sent = await interceptLead(page);

    await page.fill('#nl2', 'reader@example.com');
    await page.locator('form[data-lead="newsletter"]').first()
      .getByRole('button', { name: 'Szóljatok' }).click();

    await expect(page.locator('.form__note[data-state="success"]').first())
      .toBeVisible({ timeout: 15_000 });
    expectWellFormed(sent[0], 'newsletter', '/blog.html');
  });
});

test.describe('Impact Program application', () => {
  test('maps the application into the lead schema', async ({ page }) => {
    await page.goto('/impact-program.html');
    const sent = await interceptLead(page);

    await page.fill('#org', 'Példa Alapítvány');
    await page.fill('#kapcs', 'Nagy Anna');
    await page.fill('#mail', 'anna@example.org');
    await page.fill('#tel', '+36 30 111 2222');
    await page.fill('#web', 'https://pelda.hu');
    await page.selectOption('#terulet', { index: 1 });
    await page.fill('#mivel', 'Függőséggel élőket segítünk.');
    await page.fill('#hatas', 'Eddig 400 embert értünk el.');
    await page.fill('#miert', 'A jelenlegi oldal nem mobilbarát.');
    await page.check('input[name="adatkezeles_elfogadva"]');
    await page.getByRole('button', { name: 'Jelentkezés beküldése' }).click();

    await expect(page.locator('.form__status')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });

    const envelope = sent[0];
    expectWellFormed(envelope, 'impact', '/impact-program.html');
    expect(envelope.fields).toMatchObject({
      org: 'Példa Alapítvány',
      kapcs: 'Nagy Anna',
      mail: 'anna@example.org',
      tel: '+36 30 111 2222',
      web: 'https://pelda.hu',
      mivel: 'Függőséggel élőket segítünk.',
      hatas: 'Eddig 400 embert értünk el.',
      miert: 'A jelenlegi oldal nem mobilbarát.',
      adatkezeles_elfogadva: 'Igen',
    });
    expect(envelope.fields.terulet).toBeTruthy();
  });
});

test.describe('questionnaire', () => {
  test.setTimeout(120_000);

  /** Answer whatever the current step asks, then move on. */
  async function answerStep(page: Page) {
    const inp = page.locator('#inp');
    if (await inp.count()) {
      const kind = await inp.evaluate((el: HTMLInputElement) => `${el.tagName}:${el.type || ''}`);
      // The consent step paints its own box over the input, so the label is
      // the only thing a visitor can actually press.
      if (kind.includes('checkbox')) await page.locator('.opt').first().click();
      else if (kind.includes('email')) await inp.fill('teszt@example.com');
      else if (kind.includes('tel')) await inp.fill('+36 30 000 0000');
      else await inp.fill('Teszt válasz');
    } else {
      await page.locator('.opt').first().click();
    }
    await page.locator('#next').click();
  }

  test('the wizard submits to /api/lead and shows the success screen', async ({ page }) => {
    await page.goto('/arajanlat.html');
    const sent = await interceptLead(page);

    await page.locator('#start').click();
    for (let i = 0; i < 90; i += 1) {
      if (await page.locator('.quiz__done').count()) break;
      await answerStep(page);
    }

    await expect(page.locator('.quiz__done[data-state="success"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Köszönjük a kitöltést/)).toBeVisible();

    expect(sent).toHaveLength(1);
    const envelope = sent[0];
    expectWellFormed(envelope, 'questionnaire', '/arajanlat.html');
    expect(envelope.fields.email).toBe('teszt@example.com');
    expect(envelope.fields.cegnev).toBe('Teszt válasz');
    // The locale-invariant branch identifier, not the translated option label.
    expect(['kkv', 'nagyvallalat']).toContain(envelope.fields.agazat);

    // Every visible answer travels as structure, not as one prose blob. The
    // transcript that used to be built here is now built by the server from
    // exactly this array — see LEAD_MAPPERS.questionnaire.
    expect(Array.isArray(envelope.fields.answers)).toBe(true);
    expect(envelope.fields.answers.length).toBeGreaterThan(5);
    expect(envelope.fields.answers[0]).toHaveProperty('q');
    expect(envelope.fields.answers[0]).toHaveProperty('a');
    expect(envelope.fields.answers.map((x: any) => x.q)).toContain('Mi a vállalkozás neve?');
  });

  test('shows the rate-limited screen when the endpoint says 429', async ({ page }) => {
    await page.goto('/arajanlat.html');
    await interceptLead(page, {
      status: 429,
      body: { ok: false, code: 'RATE_LIMITED', message: 'Too many submissions.' },
    });

    await page.locator('#start').click();
    for (let i = 0; i < 90; i += 1) {
      if (await page.locator('.quiz__done').count()) break;
      await answerStep(page);
    }

    await expect(page.locator('.quiz__done[data-state="limited"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#retry')).toBeVisible();
  });
});

test.describe('the deployed bundle', () => {
  /** Every text file Netlify would publish. */
  async function emitted(dir = DIST, out: string[] = []) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await emitted(path, out);
      else if (/\.(html|js|mjs|css|json|txt|xml|map)$/i.test(entry.name)) out.push(path);
    }
    return out;
  }

  test('contains no Web3Forms endpoint, and no access key', async () => {
    const files = await emitted();
    expect(files.length, 'dist/ must be built before the suite runs').toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const file of files) {
      const body = await readFile(file, 'utf8');
      if (/web3forms|access_key/i.test(body)) offenders.push(file.replace(DIST, 'dist'));
      // The key that was published in the old bundle. Named in full so this
      // test fails loudly if it is ever pasted back in.
      if (body.includes('c29cba39-7b75-4a6d-a6e0-d37672745b4a')) {
        offenders.push(`${file.replace(DIST, 'dist')} (the exposed key)`);
      }
    }
    expect(offenders, `Web3Forms survives in:\n${offenders.join('\n')}`).toEqual([]);
  });

  /**
   * The merge-gate canary for the silent drop.
   *
   * The two behavioural tests above prove the corrected controller works; this
   * one proves the corrected controller is what actually SHIPPED. It reads the
   * built bundle, it is two assertions long, and it exists so the gate goes red
   * on the defect returning even if nothing ever runs a stress sweep again.
   *
   * Both assertions describe shape rather than behaviour, deliberately: a
   * canary that re-derives the behaviour is a slower copy of the tests above,
   * and what is being guarded here is a specific pair of lines that were wrong.
   */
  test('the shipped controller measures the fill window on a clock that cannot move', async () => {
    const src = await readFile(join(ROOT, 'assets/js/lead.js'), 'utf8');

    // `Date.now()` is the adjustable wall clock. Reading the fill window from it
    // while waiting on the monotonic one is what let a 4 ms backward adjustment
    // make a genuine enquiry report 2 996 ms — and be discarded for it, behind
    // an HTTP 200 and the success copy.
    expect(src, 'lead.js is reading the fill window off the wall clock again')
      .not.toMatch(/Date\.now\(\)\s*-\s*readyAt/);

    // And the wait must still finish PAST the server's threshold rather than on
    // it: measured headroom on the unfixed controller was 0-2 ms.
    expect(src, 'lead.js aims the fill wait at the drop threshold again')
      .toMatch(/MIN_FILL_MARGIN_MS\s*=\s*[1-9]\d+\s*;/);

    /* The two assertions above read the SOURCE, and that is a change.
     *
     * `scripts/assemble.mjs` now minifies the shared scripts on their way into
     * dist — they are unusually comment-dense and three of them are
     * render-blocking on every route. A minified `lead.js` contains neither the
     * identifier `readyAt` nor the constant `MIN_FILL_MARGIN_MS`, so against
     * dist those regexes would not have failed on the defect returning: they
     * would have stopped matching anything at all, which is worse than a red
     * gate because it is a green one.
     *
     * So the shape is asserted where the shape is written, and the SHIPPED file
     * is asserted below on the two properties minification cannot rename. */
    const shipped = await readFile(join(DIST, 'assets/js/lead.js'), 'utf8');

    expect(shipped, 'the shipped lead.js has no monotonic clock in it')
      .toMatch(/performance\.now\(\)/);

    // One, and it is the fallback for a browser with no `performance.now`. A
    // second one is a second reading of a clock that can move.
    expect(
      (shipped.match(/Date\.now\(\)/g) ?? []).length,
      'the shipped lead.js reads the adjustable clock more than once',
    ).toBe(1);
  });

  test('every public form posts to the internal endpoint', async () => {
    const pages = (await emitted()).filter((f) => f.endsWith('.html'));
    const withForms: string[] = [];

    for (const file of pages) {
      const body = await readFile(file, 'utf8');
      for (const match of body.matchAll(/<form[^>]*>/g)) {
        const tag = match[0];
        if (/data-lead=/.test(tag)) { withForms.push(file); continue; }
        // A form with an action pointing off-site is exactly what this migration
        // removed; anything left must be internal.
        expect(tag, `${file} has a form that is not wired to /api/lead`).not.toMatch(/action=/);
      }
    }
    expect(withForms.length, 'no forms found — the scan is looking in the wrong place')
      .toBeGreaterThan(30);
  });
});

/* ==========================================================================
   Phase 9, Workstreams K and S — the public copy must match what happens.

   The newsletter is the case where the two had drifted furthest apart. Three
   places promised email that no system sends: the footer signup ("subscribe to
   our newsletter", "Subscribe"), the blog signup, which additionally promised a
   FREQUENCY ("rarely, but with substance"), and the success message every form
   shares, which promises a reply.

   Nothing was broken. A visitor gave an address, the address was stored, and
   they were told they had subscribed to something. That is the kind of claim
   that costs nothing until someone asks why no newsletter ever arrived.

   These assertions are on the built pages in all three languages, because the
   promise has to be absent in each of them and a translation is exactly where
   one would survive.
   ========================================================================== */
test.describe('the newsletter does not claim to send anything', () => {
  const PAGES = [
    { route: '/rolunk.html', field: '#nl' },
    { route: '/en/about.html', field: '#nl' },
    { route: '/de/ueber-uns.html', field: '#nl' },
    { route: '/blog.html', field: '#nl2' },
    { route: '/en/blog.html', field: '#nl2' },
    { route: '/de/blog.html', field: '#nl2' },
  ];

  for (const { route, field } of PAGES) {
    test(`${route} offers the form without promising delivery`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator(field)).toBeVisible();

      const text = await page.locator('body').innerText();

      // Words that assert a subscription exists, or that mail will arrive, or
      // how often. Each of these was on the page before Phase 9.
      for (const claim of [
        /subscribe to our newsletter/i,
        /iratkozz fel a hírlevelünkre/i,
        /abonniere unseren newsletter/i,
        /elküldjük e-mailben/i,
        /we['’]ll send you .* by email/i,
        /senden wir .* per e-mail/i,
        /\britkán\b/i,          // a frequency claim
        /\brarely\b/i,
        /\bselten\b/i,
      ]) {
        expect(text, `${route} still claims: ${claim}`).not.toMatch(claim);
      }
    });
  }
});
