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

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

type Reply = { status?: number; body?: unknown; delayMs?: number };

/** Intercept /api/lead, record what was posted, answer with `reply`. */
async function interceptLead(page: Page, reply: Reply = {}) {
  const sent: any[] = [];
  await page.route('**/api/lead', async (route) => {
    sent.push(JSON.parse(route.request().postData() || '{}'));
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    await route.fulfill({
      status: reply.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(reply.body ?? { ok: true }),
    });
  });
  return sent;
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

    const lead = sent[0];
    expect(lead.name).toBe('Kovács János');
    expect(lead.email).toBe('janos@example.com');
    expect(lead.phone).toBe('+36 30 000 0000');
    expect(lead.company).toBe('Példa Kft.');
    expect(lead.source).toBe('contact');
    expect(lead.locale).toBe('hu');

    // Fields the leads table has no column for still travel, labelled, in the
    // message — nothing the visitor filled in is dropped on the floor.
    expect(lead.message).toContain('Szeretnék árajánlatot kérni');
    expect(lead.message).toContain('Adatvédelmi nyilatkozat elfogadva: Igen');
    expect(lead.message).toContain('Hírlevelet kér: Nem');

    // The honeypot always travels, empty, so the server decides what a filled
    // one means; and the timing gate is satisfied rather than tripped.
    expect(lead.company_website).toBe('');
    expect(lead.elapsed_ms).toBeGreaterThanOrEqual(3000);

    // Nothing that used to be sent to a third party goes out any more.
    expect(JSON.stringify(lead)).not.toMatch(/access_key|web3forms/i);
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
    await interceptLead(page, { status: 429, body: { ok: false, error: 'Too many submissions.' } });
    await fillContact(page);
    await page.getByRole('button', { name: 'Küldés' }).click();

    await expect(status(page)).toHaveAttribute('data-state', 'limited', { timeout: 15_000 });
    await expect(status(page)).toHaveText(/várj egy percet/i);
    await expect(page.getByRole('button', { name: 'Küldés' })).toBeEnabled();
  });

  test('shows a generic server-error state on 500', async ({ page }) => {
    await interceptLead(page, { status: 500, body: { ok: false, error: 'We could not save that.' } });
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
      body: { ok: false, errors: { email: 'That email address does not look right.' } },
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
    expect(sent[0].company_website).toBe('https://spam.example');
  });

  test('the honeypot is hidden from sight and from the tab order', async ({ page }) => {
    const hp = page.locator('#hp-contact');
    await expect(hp).not.toBeInViewport();
    await expect(hp).toHaveAttribute('tabindex', '-1');
    await expect(hp.locator('xpath=..')).toHaveAttribute('aria-hidden', 'true');
  });
});

test.describe('newsletter', () => {
  test('subscribes with only an address, as its own source', async ({ page }) => {
    await page.goto('/rolunk.html');
    const sent = await interceptLead(page);

    await page.fill('#nl', 'reader@example.com');
    await page.getByRole('button', { name: 'Feliratkozom' }).click();

    await expect(page.locator('.form__note[data-state="success"]')).toBeVisible({ timeout: 15_000 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ email: 'reader@example.com', source: 'newsletter' });
    // No name to give, and none invented in the page: the endpoint owns that.
    expect(sent[0].name).toBeUndefined();
    expect(sent[0].elapsed_ms).toBeGreaterThanOrEqual(3000);
  });

  test('the blog signup posts to the same endpoint', async ({ page }) => {
    await page.goto('/blog.html');
    const sent = await interceptLead(page);

    await page.fill('#nl2', 'reader@example.com');
    await page.locator('form[data-lead="newsletter"]').first()
      .getByRole('button', { name: 'Feliratkozom' }).click();

    await expect(page.locator('.form__note[data-state="success"]').first())
      .toBeVisible({ timeout: 15_000 });
    expect(sent[0].source).toBe('newsletter');
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

    const lead = sent[0];
    expect(lead).toMatchObject({
      name: 'Nagy Anna',
      company: 'Példa Alapítvány',
      email: 'anna@example.org',
      website: 'https://pelda.hu',
      service_interest: 'Impact Program',
      source: 'impact',
    });
    expect(lead.message).toContain('Eddig 400 embert értünk el.');
    expect(lead.message).toContain('Adatkezelés elfogadva: Igen');
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
    const lead = sent[0];
    expect(lead.source).toBe('questionnaire');
    expect(lead.email).toBe('teszt@example.com');
    expect(lead.company).toBe('Teszt válasz');
    expect(lead.name.length).toBeGreaterThanOrEqual(2);
    expect(lead.service_interest).toContain('Igényfelmérő');
    // Every visible answer, labelled, in one field.
    expect(lead.message).toContain('Mi a vállalkozás neve?');
    expect(lead.message.length).toBeLessThanOrEqual(8000);
    expect(lead.company_website).toBe('');
    expect(JSON.stringify(lead)).not.toMatch(/access_key|web3forms/i);
  });

  test('shows the rate-limited screen when the endpoint says 429', async ({ page }) => {
    await page.goto('/arajanlat.html');
    await interceptLead(page, { status: 429, body: { ok: false, error: 'Too many submissions.' } });

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
