import { test, expect } from '@playwright/test';

/**
 * The lead notification adapter — Phase 9, Workstream K.
 *
 * Two things are being asserted here, and the second matters more than the
 * first:
 *
 *   1. that it sends what it should, to a destination nobody has chosen yet;
 *   2. that **no failure of it can affect a stored lead**. Every test in
 *      "never at the lead's expense" breaks the notification in a different way
 *      and requires the submission to succeed anyway.
 *
 * Like the other function suites this runs in-process. The module reads its
 * transport from `process.env` at import time, so each test loads a fresh copy
 * with the environment it wants.
 */

type Notify = {
  notifyLeadCreated: (s: Record<string, unknown>) => Promise<{ sent: boolean; reason: string }>;
  buildNotification: (s: Record<string, unknown>) => Record<string, unknown>;
};

let serial = 0;
async function load(env: Record<string, string | undefined>): Promise<Notify> {
  for (const key of ['LEAD_NOTIFY_TRANSPORT', 'LEAD_NOTIFY_WEBHOOK_URL', 'SITE_URL', 'URL']) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }
  serial += 1;
  return (await import(`../netlify/functions/lead-notify.mjs?case=${serial}`)) as unknown as Notify;
}

const SUMMARY = {
  leadId: 'a1b2c3d4-0000-4000-8000-000000000001',
  submissionId: 'sub-0001',
  formType: 'contact',
  locale: 'hu',
  route: '/ugyfelszolgalat.html',
};

/** Replace fetch, remember what it was handed, restore it afterwards. */
function captureFetch(impl: (url: string, init: any) => Promise<Response> | Response) {
  const real = globalThis.fetch;
  const calls: { url: string; init: any }[] = [];
  globalThis.fetch = (async (input: any, init: any) => {
    calls.push({ url: String(input), init });
    return impl(String(input), init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const ok = () => new Response('{}', { status: 200 });

/* ================================================= what it does by default = */

test.describe('with no transport configured', () => {
  test('sends nothing and says so', async () => {
    const notify = await load({});
    const probe = captureFetch(ok);
    try {
      expect(await notify.notifyLeadCreated(SUMMARY)).toEqual({ sent: false, reason: 'disabled' });
      // The default must cost nothing: no DNS, no socket, no delay.
      expect(probe.calls).toEqual([]);
    } finally {
      probe.restore();
    }
  });

  test('is the default, so an unconfigured deploy is silent rather than broken', async () => {
    const notify = await load({ LEAD_NOTIFY_WEBHOOK_URL: 'https://hooks.example.com/abc' });
    // A URL alone does not switch it on. Setting one variable by accident
    // should not start sending traffic to a half-configured destination.
    expect((await notify.notifyLeadCreated(SUMMARY)).reason).toBe('disabled');
  });
});

/* ============================================================ the payload == */

test.describe('the payload', () => {
  test('carries the identifiers and the route', async () => {
    const notify = await load({});
    const body = notify.buildNotification(SUMMARY);

    expect(body.type).toBe('lead.created');
    expect(body.leadId).toBe(SUMMARY.leadId);
    expect(body.submissionId).toBe(SUMMARY.submissionId);
    expect(body.formType).toBe('contact');
    expect(body.locale).toBe('hu');
    expect(body.route).toBe('/ugyfelszolgalat.html');
    expect(typeof body.receivedAt).toBe('string');
  });

  test('carries no personal data whatsoever', async () => {
    // The rule the module exists under: a notification is a doorbell, and a
    // doorbell does not read the letter. The destination is an unknown third
    // party with its own retention and its own breach surface.
    const notify = await load({});
    const hostile = {
      ...SUMMARY,
      name: 'Kovács János',
      email: 'janos@example.com',
      phone: '+36 30 000 0000',
      message: 'Szeretnék árajánlatot kérni.',
      company: 'Példa Kft.',
      answers: { budget: '2M', deadline: 'Q4' },
      fields: { email: 'janos@example.com' },
    };

    const serialised = JSON.stringify(notify.buildNotification(hostile));
    for (const secret of [
      'Kovács', 'János', 'janos@example.com', '+36 30 000 0000',
      'árajánlatot', 'Példa Kft.', 'budget', '2M', 'deadline', 'Q4',
    ]) {
      expect(serialised, `leaked ${secret}`).not.toContain(secret);
    }
  });

  test('the field list is closed, not a filtered copy of the input', async () => {
    // A deny-list would let the next new field through by default. This is the
    // shape assertion that catches that.
    const notify = await load({});
    const body = notify.buildNotification({ ...SUMMARY, surprise: 'new field' });
    expect(Object.keys(body).sort()).toEqual([
      'formType', 'leadId', 'locale', 'portalUrl', 'receivedAt',
      'route', 'submissionId', 'text', 'type',
    ]);
  });

  test('links to the Portal on the origin this deploy is serving', async () => {
    const notify = await load({ URL: 'https://stratosweb.hu' });
    expect(notify.buildNotification(SUMMARY).portalUrl).toBe('https://stratosweb.hu/portal/leads');
  });

  test('renders without configuration on a destination that only shows text', async () => {
    const notify = await load({});
    const text = String(notify.buildNotification(SUMMARY).text);
    expect(text).toContain('contact');
    expect(text).toContain('/ugyfelszolgalat.html');
    expect(text).toContain('no personal data');
  });
});

/* ============================================================ the webhook == */

test.describe('the webhook transport', () => {
  test('POSTs JSON to the configured endpoint', async () => {
    const notify = await load({
      LEAD_NOTIFY_TRANSPORT: 'webhook',
      LEAD_NOTIFY_WEBHOOK_URL: 'https://hooks.example.com/abc',
    });
    const probe = captureFetch(ok);
    try {
      expect(await notify.notifyLeadCreated(SUMMARY)).toEqual({ sent: true, reason: 'ok' });
      expect(probe.calls).toHaveLength(1);
      expect(probe.calls[0].url).toBe('https://hooks.example.com/abc');
      expect(probe.calls[0].init.method).toBe('POST');
      expect(probe.calls[0].init.headers['content-type']).toBe('application/json');
      expect(JSON.parse(probe.calls[0].init.body).leadId).toBe(SUMMARY.leadId);
    } finally {
      probe.restore();
    }
  });

  test('refuses a plain http endpoint', async () => {
    const notify = await load({
      LEAD_NOTIFY_TRANSPORT: 'webhook',
      LEAD_NOTIFY_WEBHOOK_URL: 'http://hooks.example.com/abc',
    });
    const probe = captureFetch(ok);
    try {
      expect((await notify.notifyLeadCreated(SUMMARY)).reason).toBe('not-https');
      expect(probe.calls).toEqual([]);
    } finally {
      probe.restore();
    }
  });

  test('refuses a URL that is not a URL', async () => {
    const notify = await load({
      LEAD_NOTIFY_TRANSPORT: 'webhook',
      LEAD_NOTIFY_WEBHOOK_URL: 'not a url',
    });
    expect((await notify.notifyLeadCreated(SUMMARY)).reason).toBe('bad-url');
  });

  test('refuses an unknown transport rather than guessing one', async () => {
    const notify = await load({
      LEAD_NOTIFY_TRANSPORT: 'slack',
      LEAD_NOTIFY_WEBHOOK_URL: 'https://hooks.example.com/abc',
    });
    expect((await notify.notifyLeadCreated(SUMMARY)).reason).toBe('unknown-transport');
  });
});

/* ================================================ never at the lead's cost = */

test.describe('never at the lead\'s expense', () => {
  const cases: [string, () => Promise<Response>][] = [
    ['the destination answers 500', async () => new Response('nope', { status: 500 })],
    ['the destination answers 404', async () => new Response('', { status: 404 })],
    ['the destination is unreachable', async () => { throw new Error('ECONNREFUSED'); }],
    ['the destination answers with nonsense', async () => new Response('<html>', { status: 502 })],
  ];
  // A hanging destination is NOT in this list. It belongs to the test below,
  // which supplies a fetch that honours the abort signal the way a real one
  // does — a stub that merely sleeps and then resolves is not a hang, it is a
  // slow success, and asserting `sent === false` against it asserts nothing
  // about the timeout.

  for (const [name, impl] of cases) {
    test(`${name}: resolves false, never throws`, async () => {
      const notify = await load({
        LEAD_NOTIFY_TRANSPORT: 'webhook',
        LEAD_NOTIFY_WEBHOOK_URL: 'https://hooks.example.com/abc',
      });
      const probe = captureFetch(impl as any);
      try {
        const result = await notify.notifyLeadCreated(SUMMARY);
        expect(result.sent).toBe(false);
        expect(typeof result.reason).toBe('string');
      } finally {
        probe.restore();
      }
    });
  }

  test('a hanging destination is abandoned rather than waited on', async () => {
    // The visitor's success message must not wait on someone else's outage.
    const notify = await load({
      LEAD_NOTIFY_TRANSPORT: 'webhook',
      LEAD_NOTIFY_WEBHOOK_URL: 'https://hooks.example.com/abc',
    });
    const probe = captureFetch(async (_url, init) => {
      // Honour the abort signal the way a real fetch does.
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 10_000);
        init.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
        });
      });
      return ok();
    });

    try {
      const started = Date.now();
      const result = await notify.notifyLeadCreated(SUMMARY);
      const elapsed = Date.now() - started;

      expect(result).toEqual({ sent: false, reason: 'timeout' });
      expect(elapsed, `waited ${elapsed}ms`).toBeLessThan(3000);
    } finally {
      probe.restore();
    }
  });

  test('a submission still succeeds when the notification fails', async () => {
    // The end-to-end version of the rule, through the real handler: the store
    // succeeds, the doorbell breaks, and the visitor is told their enquiry
    // arrived — because it did.
    process.env.LEAD_NOTIFY_TRANSPORT = 'webhook';
    process.env.LEAD_NOTIFY_WEBHOOK_URL = 'https://hooks.example.com/abc';
    serial += 1;
    const handler = await import(`../netlify/functions/submit-lead.mjs?case=${serial}`) as any;

    handler.__store.create = async () => ({
      insert: async () => ({ data: { id: 'lead-123' }, error: null }),
      findBySubmissionId: async () => ({ data: null }),
    });

    const probe = captureFetch(async () => { throw new Error('the webhook is down'); });
    try {
      const res = await handler.default(new Request('https://stratosweb.hu/api/lead', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': '198.51.100.7' },
        body: JSON.stringify({
          submissionId: crypto.randomUUID(),
          formType: 'newsletter',
          locale: 'hu',
          route: '/rolunk.html',
          fields: { email: 'reader@example.com' },
          meta: { elapsedMs: 9000, botField: '' },
        }),
      }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.leadId).toBe('lead-123');
    } finally {
      probe.restore();
      delete process.env.LEAD_NOTIFY_TRANSPORT;
      delete process.env.LEAD_NOTIFY_WEBHOOK_URL;
    }
  });
});
