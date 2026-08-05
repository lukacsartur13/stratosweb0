import { test, expect } from '@playwright/test';
import handler from '../netlify/functions/submit-lead.mjs';
// The same module again, as a namespace, so the store seam it exports can be
// replaced. `import handler` above is the default export; this is the rest.
import * as handlerModule from '../netlify/functions/submit-lead.mjs';
import { MAX_BODY_BYTES, MAX_ANSWERS } from '../netlify/functions/lead-contract.mjs';

/**
 * POST /api/lead, exercised directly rather than over HTTP.
 *
 * The static server the other suites run against does not serve functions, so
 * this file imports the handler and hands it a Request. That is the only way to
 * assert the server-side half of the contract — every gate below is the one a
 * real submission passes through, in the order it passes through it.
 *
 * No Supabase credentials exist in a test run, so a payload that clears every
 * gate stops at the store step with 503 SERVICE_UNAVAILABLE. That 503 is the
 * assertion: reaching it means the envelope, the schema, the honeypot, the
 * timing check, the size ceiling and the rate limit all let it through.
 */

const NEEDS_NO_KEY =
  'a valid payload must stop at the store step, so the run must have no Supabase key';
const hasKey = () =>
  !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY);

let counter = 0;
/** A fresh address per call: the rate limiter is keyed on it and is per-process. */
const freshIp = () => `203.0.113.${(counter += 1) % 250}.${Date.now() % 1000}`;

const uuid = () => crypto.randomUUID();

function request(
  body: unknown,
  { ip = freshIp(), method = 'POST', contentType = 'application/json', raw = undefined as string | undefined,
    headers = {} as Record<string, string> } = {},
) {
  const init: RequestInit = {
    method,
    headers: {
      ...(contentType ? { 'content-type': contentType } : {}),
      'x-nf-client-connection-ip': ip,
      'user-agent': 'playwright',
      ...headers,
    },
  };
  if (method !== 'GET') init.body = raw ?? JSON.stringify(body);
  return handler(new Request('https://media-stratos.com/api/lead', init));
}

/** A complete, valid envelope for each form, with every gate satisfied. */
const envelopes = {
  newsletter: () => ({
    submissionId: uuid(),
    formType: 'newsletter',
    locale: 'hu',
    route: '/rolunk.html',
    fields: { email: 'reader@example.com' },
    meta: { elapsedMs: 9_000, botField: '' },
  }),

  contact: () => ({
    submissionId: uuid(),
    formType: 'contact',
    locale: 'hu',
    route: '/ugyfelszolgalat.html',
    fields: {
      vezeteknev: 'Kovács',
      keresztnev: 'János',
      email: 'janos@example.com',
      telefon: '+36 30 000 0000',
      ceg: 'Példa Kft.',
      megjegyzes: 'Szeretnék árajánlatot kérni egy új weboldalra.',
      adatvedelem_elfogadva: 'Igen',
      hirlevel: false,
    },
    meta: { elapsedMs: 42_000, botField: '' },
  }),

  impact: () => ({
    submissionId: uuid(),
    formType: 'impact',
    locale: 'en',
    route: '/en/impact-program.html',
    fields: {
      org: 'Példa Alapítvány',
      kapcs: 'Nagy Anna',
      mail: 'anna@example.org',
      tel: '+36 30 111 2222',
      web: 'https://pelda.hu',
      terulet: 'Függőség / mentális egészség',
      mivel: 'Függőséggel élőket segítünk.',
      hatas: 'Eddig 400 embert értünk el.',
      miert: 'A jelenlegi oldal nem mobilbarát.',
      adatkezeles_elfogadva: 'Igen',
    },
    meta: { elapsedMs: 120_000, botField: '' },
  }),

  questionnaire: () => ({
    submissionId: uuid(),
    formType: 'questionnaire',
    locale: 'de',
    route: '/de/angebot.html',
    fields: {
      cegnev: 'Beispiel GmbH',
      kitolto: 'Anna Muster',
      email: 'anna@beispiel.de',
      telefon: '+49 30 000000',
      agazat: 'kkv',
      koltsegkeret: '800 €',
      hatarido: '3 Monate',
      answers: [
        { q: 'Wie heißt das Unternehmen?', a: 'Beispiel GmbH' },
        { q: 'Was ist das Ziel der Website?', a: 'Mehr Anfragen' },
      ],
    },
    meta: { elapsedMs: 300_000, botField: '' },
  }),
} as const;

type FormName = keyof typeof envelopes;
const FORMS = Object.keys(envelopes) as FormName[];

test.describe('POST /api/lead — transport', () => {
  test('refuses anything that is not a POST', async () => {
    const res = await request(undefined, { method: 'GET' });
    expect(res.status).toBe(405);
    expect((await res.json()).code).toBe('METHOD_NOT_ALLOWED');
  });

  test('refuses a body that is not declared as JSON', async () => {
    const res = await request(envelopes.contact(), { contentType: 'text/plain' });
    expect(res.status).toBe(415);
    expect((await res.json()).code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  test('refuses a body that is not JSON', async () => {
    const res = await request(null, { raw: 'not json at all' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('MALFORMED_JSON');
  });

  test('refuses an oversized body on the declared length alone', async () => {
    const res = await request(envelopes.contact(), {
      headers: { 'content-length': String(MAX_BODY_BYTES + 1) },
    });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('BODY_TOO_LARGE');
  });

  test('refuses an oversized body that lied about its length', async () => {
    const res = await request(null, { raw: 'x'.repeat(MAX_BODY_BYTES + 100) });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('BODY_TOO_LARGE');
  });

  test('answers with no-store so nothing caches a submission result', async () => {
    const res = await request(envelopes.contact());
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

test.describe('POST /api/lead — the envelope', () => {
  test('refuses a submissionId that is not a UUID', async () => {
    const res = await request({ ...envelopes.contact(), submissionId: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_SUBMISSION_ID');
  });

  test('refuses a missing submissionId', async () => {
    const body: Record<string, unknown> = envelopes.contact();
    delete body.submissionId;
    const res = await request(body);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_SUBMISSION_ID');
  });

  test('refuses an unsupported form type', async () => {
    const res = await request({ ...envelopes.contact(), formType: 'invoice' });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('UNSUPPORTED_FORM_TYPE');
  });

  test('refuses an unsupported locale', async () => {
    const res = await request({ ...envelopes.contact(), locale: 'fr' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('UNSUPPORTED_LOCALE');
  });

  test('refuses a route that is not a same-site path', async () => {
    for (const route of ['https://evil.example/x', '//evil.example', 'contact.html']) {
      const res = await request({ ...envelopes.contact(), route });
      expect(res.status, `route ${route} must be refused`).toBe(400);
      expect((await res.json()).code).toBe('INVALID_ROUTE');
    }
  });

  test('accepts an absent route', async () => {
    test.skip(hasKey(), NEEDS_NO_KEY);
    const body: Record<string, unknown> = envelopes.contact();
    delete body.route;
    expect((await request(body)).status).toBe(503);
  });

  test('refuses fields that are not an object', async () => {
    const res = await request({ ...envelopes.contact(), fields: 'everything' });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('VALIDATION_FAILED');
  });
});

test.describe('POST /api/lead — per-form schemas', () => {
  for (const form of FORMS) {
    test(`accepts a valid ${form} submission`, async () => {
      test.skip(hasKey(), NEEDS_NO_KEY);
      const res = await request(envelopes[form]());
      // Past every gate. The only thing left is the insert, which has no key.
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe('SERVICE_UNAVAILABLE');
    });
  }

  for (const locale of ['hu', 'en', 'de']) {
    test(`accepts a contact submission in ${locale}`, async () => {
      test.skip(hasKey(), NEEDS_NO_KEY);
      const res = await request({ ...envelopes.contact(), locale });
      expect(res.status).toBe(503);
    });

    test(`answers in ${locale} when validation fails`, async () => {
      const body = envelopes.contact();
      const res = await request({
        ...body, locale, fields: { ...body.fields, email: 'nope' },
      });
      expect(res.status).toBe(422);
      const json = await res.json();
      const expected = { hu: /nem tűnik helyesnek/, en: /does not look right/, de: /sieht nicht richtig aus/ };
      expect(json.errors.email).toMatch(expected[locale as 'hu' | 'en' | 'de']);
    });
  }

  test('rejects a missing required field, and names it', async () => {
    const body = envelopes.contact();
    const res = await request({ ...body, fields: { ...body.fields, ceg: '   ' } });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION_FAILED');
    expect(json.errors).toHaveProperty('ceg');
  });

  test('rejects an invalid email on every form that asks for one', async () => {
    const bad: Record<FormName, Record<string, unknown>> = {
      newsletter: { email: 'nope' },
      contact: { email: 'nope@' },
      impact: { mail: 'no spaces @example.com' },
      questionnaire: { email: 'missing-at.example.com' },
    };
    for (const form of FORMS) {
      const body = envelopes[form]();
      const res = await request({ ...body, fields: { ...body.fields, ...bad[form] } });
      expect(res.status, `${form} must refuse a malformed address`).toBe(422);
      const json = await res.json();
      expect(Object.keys(json.errors)).toContain(form === 'impact' ? 'mail' : 'email');
    }
  });

  test('rejects an unchecked required consent', async () => {
    const body = envelopes.contact();
    const res = await request({
      ...body, fields: { ...body.fields, adatvedelem_elfogadva: undefined },
    });
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toHaveProperty('adatvedelem_elfogadva');
  });

  test('accepts an unchecked *optional* consent', async () => {
    test.skip(hasKey(), NEEDS_NO_KEY);
    const body = envelopes.contact();
    const res = await request({ ...body, fields: { ...body.fields, hirlevel: undefined } });
    expect(res.status).toBe(503);
  });

  test('rejects a field that is over its cap rather than truncating it', async () => {
    const body = envelopes.contact();
    const res = await request({ ...body, fields: { ...body.fields, ceg: 'x'.repeat(500) } });
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toHaveProperty('ceg');
  });

  test('rejects a questionnaire with more answers than the ceiling', async () => {
    const body = envelopes.questionnaire();
    const answers = Array.from({ length: MAX_ANSWERS + 5 }, (_, i) => ({ q: `Q${i}`, a: 'x' }));
    const res = await request({ ...body, fields: { ...body.fields, answers } });
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toHaveProperty('answers');
  });

  test('rejects an answers value that is not a list', async () => {
    const body = envelopes.questionnaire();
    const res = await request({ ...body, fields: { ...body.fields, answers: 'all of them' } });
    expect(res.status).toBe(422);
  });

  test('rejects an out-of-enum branch identifier', async () => {
    const body = envelopes.questionnaire();
    const res = await request({ ...body, fields: { ...body.fields, agazat: 'grossunternehmen' } });
    expect(res.status).toBe(422);
    expect((await res.json()).errors).toHaveProperty('agazat');
  });

  test('drops an undeclared field instead of losing the whole submission', async () => {
    test.skip(hasKey(), NEEDS_NO_KEY);
    const body = envelopes.contact();
    const res = await request({
      ...body,
      fields: { ...body.fields, is_admin: 'true', status: 'won', id: 'x' },
    });
    // Reaching the store step means the extra names were dropped, not refused —
    // and `toLeadRow` only ever reads declared names, so none of them could
    // have reached a column.
    expect(res.status).toBe(503);
  });
});

test.describe('POST /api/lead — spam and abuse', () => {
  test('drops a filled honeypot, and says nothing about it', async () => {
    const body = envelopes.contact();
    const res = await request({ ...body, meta: { ...body.meta, botField: 'https://spam.example' } });
    // Deliberately indistinguishable from success: a bot gets no signal. The
    // 200 rather than 503 is what proves it never reached the store step.
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.submissionId).toBe(body.submissionId);
    expect(json.leadId).toBeTruthy();
  });

  test('a dropped submission is shaped exactly like a stored one', async () => {
    const body = envelopes.contact();
    const dropped = await (await request({ ...body, meta: { ...body.meta, botField: 'bot' } })).json();
    expect(Object.keys(dropped).sort()).toEqual(['leadId', 'ok', 'submissionId']);
  });

  test('drops a submission completed faster than a human could read it', async () => {
    const body = envelopes.contact();
    const res = await request({ ...body, meta: { ...body.meta, elapsedMs: 800 } });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test('the spam gates run before validation, so a bot learns nothing', async () => {
    const body = envelopes.contact();
    const res = await request({
      ...body,
      fields: { ...body.fields, email: 'not-an-address' },
      meta: { ...body.meta, botField: 'bot' },
    });
    // A 422 here would tell the bot which field to fix. It must not get one.
    expect(res.status).toBe(200);
  });

  test('rate limits repeated submissions from one address', async () => {
    const ip = freshIp();
    const codes: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      codes.push((await request(envelopes.contact(), { ip })).status);
    }
    expect(codes).toContain(429);
    // The ceiling is five per minute, so the first five must not be limited.
    expect(codes.slice(0, 5)).not.toContain(429);

    const limited = await request(envelopes.contact(), { ip });
    expect(limited.status).toBe(429);
    expect((await limited.json()).code).toBe('RATE_LIMITED');
  });

  test('one address being limited does not limit anyone else', async () => {
    const noisy = freshIp();
    for (let i = 0; i < 8; i += 1) await request(envelopes.contact(), { ip: noisy });
    const other = await request(envelopes.contact(), { ip: freshIp() });
    expect(other.status).not.toBe(429);
  });
});

test.describe('POST /api/lead — what it never says', () => {
  test('never echoes anything back that could name a column or a table', async () => {
    const body = envelopes.contact();
    const res = await request({ ...body, fields: { ...body.fields, email: 'nope' } });
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/leads|insert|postgres|supabase|constraint|select/i);
  });

  test('never carries the submitter address back', async () => {
    const ip = '203.0.113.77.4242';
    const res = await request(envelopes.contact(), { ip });
    expect(await res.text()).not.toContain('203.0.113');
  });

  test('every failure carries a stable code and a safe message', async () => {
    const cases = [
      { res: await request(undefined, { method: 'GET' }), code: 'METHOD_NOT_ALLOWED' },
      { res: await request(null, { raw: '{' }), code: 'MALFORMED_JSON' },
      { res: await request({ ...envelopes.contact(), formType: 'x' }), code: 'UNSUPPORTED_FORM_TYPE' },
    ];
    for (const { res, code } of cases) {
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.code).toBe(code);
      expect(typeof json.message).toBe('string');
      expect(json.message.length).toBeGreaterThan(0);
      expect(json.message).not.toMatch(/at .*\.mjs|Error:|TypeError/);
    }
  });
});

/* -------------------------------------------------------------- the store */
/**
 * The two outcomes Postgres decides — a duplicate submissionId and a failed
 * insert — plus the shape of what is actually written.
 *
 * `__store` is the one seam in the handler (see the note on it). These tests
 * replace exactly the I/O: every gate above the store step still runs for real.
 */
type Row = Record<string, unknown>;

function fakeStore(behaviour: {
  onInsert: (row: Row) => { data?: { id: string } | null; error?: { code: string; message: string } | null };
  existing?: { id: string } | null;
}) {
  const inserted: Row[] = [];
  return {
    inserted,
    store: {
      async create() {
        return {
          async insert(row: Row) {
            inserted.push(row);
            const r = behaviour.onInsert(row);
            return { data: r.data ?? null, error: r.error ?? null };
          },
          async findBySubmissionId() {
            return { data: behaviour.existing ?? null, error: null };
          },
        };
      },
    },
  };
}

test.describe('POST /api/lead — the store', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const real = (handlerModule as any).__store.create;
  test.afterEach(() => { (handlerModule as any).__store.create = real; });

  test('writes a normalised row, with the payload as data', async () => {
    const fake = fakeStore({ onInsert: () => ({ data: { id: 'lead-1' } }) });
    (handlerModule as any).__store.create = fake.store.create;

    const body = envelopes.questionnaire();
    const res = await request(body);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true, submissionId: body.submissionId, leadId: 'lead-1',
    });

    expect(fake.inserted).toHaveLength(1);
    const row = fake.inserted[0] as Record<string, any>;

    // Envelope facts, stored as columns rather than inferred later.
    expect(row.submission_id).toBe(body.submissionId);
    expect(row.form_type).toBe('questionnaire');
    expect(row.source).toBe('questionnaire');       // kept in step for the portal
    expect(row.locale).toBe('de');
    expect(row.source_route).toBe('/de/angebot.html');

    // Commercial columns, mapped from the answers.
    expect(row.name).toBe('Anna Muster');
    expect(row.company).toBe('Beispiel GmbH');
    expect(row.email).toBe('anna@beispiel.de');
    expect(row.budget_range).toBe('800 €');
    expect(row.timeframe).toBe('3 Monate');
    expect(row.service_interest).toBe('Igényfelmérő – KKV');

    // The transcript is built server-side from the structured answers.
    expect(row.message).toContain('01. Wie heißt das Unternehmen?');
    expect(row.message).toContain('Mehr Anfragen');

    // The answers survive as data, not only as prose.
    expect(row.payload.answers).toHaveLength(2);
    expect(row.payload.cegnev).toBe('Beispiel GmbH');

    // Approved metadata only. The envelope sent `elapsedMs` and `botField`;
    // only the first is a declared key, so only the first survives.
    expect(row.meta).toEqual({ elapsedMs: 300_000 });
    expect(JSON.stringify(row)).not.toContain('botField');
    expect(row.ip_hash).toBeNull();                 // no IP_HASH_SALT in a test run
  });

  test('routes the enterprise branch by its locale-invariant identifier', async () => {
    const fake = fakeStore({ onInsert: () => ({ data: { id: 'lead-2' } }) });
    (handlerModule as any).__store.create = fake.store.create;

    const body = envelopes.questionnaire();
    await request({ ...body, fields: { ...body.fields, agazat: 'nagyvallalat' } });

    expect((fake.inserted[0] as Record<string, any>).service_interest)
      .toBe('Igényfelmérő – nagyvállalat');
  });

  test('newsletter gets the stand-in name the NOT NULL column needs', async () => {
    const fake = fakeStore({ onInsert: () => ({ data: { id: 'lead-3' } }) });
    (handlerModule as any).__store.create = fake.store.create;

    await request(envelopes.newsletter());
    const row = fake.inserted[0] as Record<string, any>;
    expect(row.name).toBe('Newsletter subscriber');
    expect(row.email).toBe('reader@example.com');
    expect(row.form_type).toBe('newsletter');
  });

  test('a duplicate submissionId returns the original lead, not a second one', async () => {
    const fake = fakeStore({
      onInsert: () => ({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } }),
      existing: { id: 'lead-original' },
    });
    (handlerModule as any).__store.create = fake.store.create;

    const body = envelopes.contact();
    const res = await request(body);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true, submissionId: body.submissionId, leadId: 'lead-original', duplicate: true,
    });
  });

  test('an insert failure is a 500 that names nothing', async () => {
    const fake = fakeStore({
      onInsert: () => ({ error: { code: '23502', message: 'null value in column "name" of relation "leads"' } }),
    });
    (handlerModule as any).__store.create = fake.store.create;

    const res = await request(envelopes.contact());
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.code).toBe('STORE_FAILED');
    expect(JSON.stringify(json)).not.toMatch(/leads|relation|null value|23502/i);
  });
});
