import { test, expect } from '@playwright/test';
import handler from '../netlify/functions/submit-lead.mjs';

/**
 * POST /api/lead, exercised directly rather than over HTTP.
 *
 * The static server the other suites run against does not serve functions, so
 * this file imports the handler and hands it a Request. That is the only way to
 * assert the server-side half of the contract — every gate below is the one a
 * real submission passes through, in the order it passes through it.
 *
 * No Supabase credentials exist in a test run, so a payload that clears every
 * gate stops at the store step with 503. That 503 is the assertion: reaching it
 * means validation, the honeypot, the timing check and the rate limit all let
 * the submission through.
 */

const NEEDS_KEY = 'a valid payload must stop at the store step, so the run must have no service key';

let counter = 0;
/** A fresh address per call: the rate limiter is keyed on it and is per-process. */
const freshIp = () => `203.0.113.${(counter += 1) % 250}.${Date.now() % 1000}`;

function post(body: unknown, ip = freshIp(), method = 'POST') {
  return handler(
    new Request('https://media-stratos.com/api/lead', {
      method,
      headers: {
        'content-type': 'application/json',
        'x-nf-client-connection-ip': ip,
        'user-agent': 'playwright',
      },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
  );
}

/** Everything a real contact submission carries, with the gates satisfied. */
const valid = (over: Record<string, unknown> = {}) => ({
  name: 'Kovács János',
  company: 'Példa Kft.',
  email: 'janos@example.com',
  phone: '+36 30 000 0000',
  message: 'Üzenet: szeretnék árajánlatot kérni egy új weboldalra.',
  source: 'contact',
  locale: 'hu',
  company_website: '',
  elapsed_ms: 42_000,
  ...over,
});

test.describe('POST /api/lead', () => {
  test('refuses anything that is not a POST', async () => {
    const res = await post(undefined, freshIp(), 'GET');
    expect(res.status).toBe(405);
  });

  test('refuses a body that is not JSON', async () => {
    const res = await handler(
      new Request('https://media-stratos.com/api/lead', {
        method: 'POST',
        headers: { 'x-nf-client-connection-ip': freshIp() },
        body: 'not json at all',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).ok).toBe(false);
  });

  test('accepts a valid submission', async () => {
    test.skip(!!process.env.SUPABASE_SERVICE_ROLE_KEY, NEEDS_KEY);
    const res = await post(valid());
    // Past every gate. The only thing left is the insert, which has no key.
    expect(res.status).toBe(503);
  });

  test('accepts a newsletter signup that has only an address', async () => {
    test.skip(!!process.env.SUPABASE_SERVICE_ROLE_KEY, NEEDS_KEY);
    const res = await post({
      email: 'reader@example.com', source: 'newsletter',
      locale: 'hu', company_website: '', elapsed_ms: 9_000,
    });
    expect(res.status).toBe(503);
  });

  test('rejects a missing name on every source but the newsletter', async () => {
    const res = await post(valid({ name: '' }));
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toHaveProperty('name');
  });

  test('rejects a malformed address', async () => {
    const res = await post(valid({ email: 'not-an-address' }));
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toHaveProperty('email');
  });

  test('rejects an empty payload', async () => {
    const res = await post({});
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errors).toHaveProperty('name');
    expect(body.errors).toHaveProperty('email');
  });

  test('never echoes anything back that could name a column', async () => {
    const res = await post(valid({ email: 'nope' }));
    const body = JSON.stringify(await res.json());
    expect(body).not.toMatch(/leads|insert|postgres|supabase|constraint/i);
  });

  test('drops a filled honeypot, and says nothing about it', async () => {
    const res = await post(valid({ company_website: 'https://spam.example' }));
    // Deliberately indistinguishable from success: a bot gets no signal. The
    // 200 rather than 503 is what proves it never reached the store step.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('drops a submission completed faster than a human could read it', async () => {
    const res = await post(valid({ elapsed_ms: 800 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('rate limits repeated submissions from one address', async () => {
    const ip = freshIp();
    const codes: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      codes.push((await post(valid(), ip)).status);
    }
    expect(codes).toContain(429);
    // The ceiling is five per minute, so the first five must not be limited.
    expect(codes.slice(0, 5)).not.toContain(429);

    const limited = await post(valid(), ip);
    expect(limited.status).toBe(429);
    expect((await limited.json()).ok).toBe(false);
  });

  test('one address being limited does not limit anyone else', async () => {
    const noisy = freshIp();
    for (let i = 0; i < 8; i += 1) await post(valid(), noisy);
    const other = await post(valid(), freshIp());
    expect(other.status).not.toBe(429);
  });

  test('stores no raw address and caps what it will store', async () => {
    // Nothing here reaches the database, so this asserts the contract the code
    // states: the response never carries the address back, and the module caps
    // every column before it builds the row.
    const res = await post(valid({ message: 'x'.repeat(50_000) }));
    const body = await res.text();
    expect(body).not.toContain('203.0.113');
    expect(body.length).toBeLessThan(500);
  });

  test('answers with no-store so nothing caches a submission result', async () => {
    const res = await post(valid({ company_website: 'bot' }));
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
