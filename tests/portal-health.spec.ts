import { test, expect } from '@playwright/test';

/**
 * GET /api/portal-health.
 *
 * The system-health block on the Portal's Command Center reads this. It exists
 * separately from the analytics endpoint because system health is not
 * analytics: `/api/portal-analytics` answers `configured: false` and stops when
 * Google is not set up, which is exactly the moment somebody most needs to know
 * whether Supabase, the lead API and the notification adapter are fine.
 *
 * THE PROPERTY THIS FILE EXISTS TO GUARD
 * --------------------------------------
 * Every field in the response is a boolean, an enum or a variable NAME. Not one
 * of them is a value. `never returns a value, only whether one exists` below is
 * the assertion, and it is written against deliberately distinctive fixtures so
 * that a leak would be unmistakable in the diff rather than plausible.
 *
 * Exercised in-process, like the other function suites, with `globalThis.fetch`
 * replaced so nothing can reach a real Supabase project.
 */

type Handler = {
  default: (request: Request) => Promise<Response>;
  __auth: { identify: (token: string) => Promise<{ id: string; role: string } | null> };
};

/**
 * Values that are obviously not credentials, and are distinctive enough to find.
 *
 * `npm run scan:secrets` reads this file. A fixture shaped like a real key is
 * what makes a real key invisible next to it, so these read as sentences.
 */
const ENV = {
  SUPABASE_URL: 'https://project-name-that-is-not-secret.supabase.co',
  SUPABASE_SECRET_KEY: 'the-service-key-value-that-must-never-be-echoed',
  IP_HASH_SALT: 'the-ip-salt-value-that-must-never-be-echoed',
  GA4_PROPERTY_ID: '15392224433',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'reporting@example.iam.gserviceaccount.com',
  GOOGLE_PRIVATE_KEY: 'the-private-key-value-that-must-never-be-echoed',
  LEAD_NOTIFY_TRANSPORT: 'webhook',
  LEAD_NOTIFY_WEBHOOK_URL: 'https://hooks.example.invalid/the-secret-path-that-must-never-be-echoed',
  CONTEXT: 'production',
};

const KEYS = [...Object.keys(ENV), 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

let serial = 0;

async function load(env: Record<string, string | undefined>): Promise<Handler> {
  for (const key of KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  serial += 1;
  return (await import(
    `../netlify/functions/portal-health.mjs?case=${serial}`
  )) as unknown as Handler;
}

const asRole = (role: string) => async () => ({ id: 'user-1', role });

const get = (h: Handler, token = 'jwt') =>
  h.default(new Request('https://stratosweb.hu/api/portal-health', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }));

/**
 * Nothing in this suite may touch the network.
 *
 * The endpoint's Supabase reachability probe is a real `fetch`. Every test that
 * exercises it goes through this, which answers without leaving the process and
 * records what was asked for.
 */
function offline(ok = true) {
  const real = globalThis.fetch;
  const reached: string[] = [];
  globalThis.fetch = (async (input: any) => {
    reached.push(String(input?.url ?? input));
    if (!ok) throw new Error('network is down');
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { reached, restore: () => { globalThis.fetch = real; } };
}

/* =================================================================== gates == */

test.describe('gates', () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    test(`${method} is refused`, async () => {
      const h = await load(ENV);
      const res = await h.default(new Request('https://x/api/portal-health', { method }));
      expect(res.status).toBe(405);
    });
  }

  test('an anonymous caller learns nothing at all', async () => {
    // Which integrations exist, and which are broken, is a map of the system's
    // soft spots. It is not public.
    const h = await load(ENV);
    const res = await h.default(new Request('https://x/api/portal-health'));
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain('supabase');
    expect(text).not.toContain('services');
  });

  test('a token Supabase rejects is 401', async () => {
    const h = await load(ENV);
    h.__auth.identify = async () => null;
    expect((await get(h)).status).toBe(401);
  });

  for (const role of ['team_member', 'client']) {
    test(`${role} holds a valid session and still cannot read it`, async () => {
      const h = await load(ENV);
      h.__auth.identify = asRole(role);
      const res = await get(h);
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain('services');
    });
  }

  for (const role of ['super_admin', 'admin']) {
    test(`${role} may read it`, async () => {
      const h = await load(ENV);
      h.__auth.identify = asRole(role);
      const net = offline();
      try {
        expect((await get(h)).status).toBe(200);
      } finally {
        net.restore();
      }
    });
  }
});

/* ================================================================ the shape == */

test.describe('what it reports', () => {
  test('a fully configured deployment is green across the board', async () => {
    const h = await load(ENV);
    h.__auth.identify = asRole('admin');
    const net = offline();
    let body: any;
    try {
      body = await (await get(h)).json();
    } finally {
      net.restore();
    }

    expect(body.ok).toBe(true);
    expect(body.environment).toBe('production');
    expect(body.services.supabase.state).toBe('ok');
    expect(body.services.leadApi.state).toBe('ok');
    expect(body.services.leadApi.ipSaltConfigured).toBe(true);
    expect(body.services.ga4.state).toBe('ok');
    expect(body.services.ga4.missing).toEqual([]);
    expect(body.services.notifications.state).toBe('ok');
    expect(body.services.notifications.transport).toBe('webhook');
    expect(body.services.notifications.destinationConfigured).toBe(true);

    // The probe went to PostgREST's root, which touches no table.
    expect(net.reached.some((u) => u.endsWith('/rest/v1/'))).toBe(true);
  });

  test('a missing Google service account is unconfigured, not broken', async () => {
    // The difference matters: one is a setup step nobody has done yet, the
    // other is something that used to work and stopped.
    const { GOOGLE_PRIVATE_KEY, GOOGLE_SERVICE_ACCOUNT_EMAIL, ...rest } = ENV;
    const h = await load(rest);
    h.__auth.identify = asRole('admin');
    const net = offline();
    let body: any;
    try {
      body = await (await get(h)).json();
    } finally {
      net.restore();
    }

    expect(body.services.ga4.state).toBe('unconfigured');
    expect(body.services.ga4.missing).toEqual([
      'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY',
    ]);
    // And nothing else went red because of it.
    expect(body.services.supabase.state).toBe('ok');
    expect(body.services.leadApi.state).toBe('ok');
  });

  test('a Supabase that is configured and not answering is unreachable', async () => {
    const h = await load(ENV);
    h.__auth.identify = asRole('admin');
    const net = offline(false);
    let body: any;
    try {
      body = await (await get(h)).json();
    } finally {
      net.restore();
    }
    expect(body.services.supabase.state).toBe('unreachable');
    expect(body.services.supabase.urlConfigured).toBe(true);
  });

  test('no Supabase configuration at all is unconfigured, and costs no request', async () => {
    const { SUPABASE_URL, SUPABASE_SECRET_KEY, ...rest } = ENV;
    const h = await load(rest);
    // `identify` needs Supabase too, so it is mocked — the point of this test is
    // the probe, not the gate.
    h.__auth.identify = asRole('admin');
    const net = offline();
    let body: any;
    try {
      body = await (await get(h)).json();
    } finally {
      net.restore();
    }
    expect(body.services.supabase.state).toBe('unconfigured');
    expect(body.services.leadApi.state).toBe('degraded');
    expect(net.reached).toEqual([]);
  });

  test('notifications being off is neutral, not a fault', async () => {
    // The adapter defaults to sending nothing and leads land in the Portal
    // regardless. Painting a deliberate configuration red trains whoever reads
    // this screen to ignore the colour.
    const { LEAD_NOTIFY_TRANSPORT, LEAD_NOTIFY_WEBHOOK_URL, ...rest } = ENV;
    const h = await load(rest);
    h.__auth.identify = asRole('admin');
    const net = offline();
    let body: any;
    try {
      body = await (await get(h)).json();
    } finally {
      net.restore();
    }
    expect(body.services.notifications.state).toBe('disabled');
    expect(body.services.notifications.transport).toBe('none');
  });

  test('a transport with nowhere to send is degraded', async () => {
    const { LEAD_NOTIFY_WEBHOOK_URL, ...rest } = ENV;
    const h = await load(rest);
    h.__auth.identify = asRole('admin');
    const net = offline();
    let body: any;
    try {
      body = await (await get(h)).json();
    } finally {
      net.restore();
    }
    expect(body.services.notifications.state).toBe('degraded');
    expect(body.services.notifications.destinationConfigured).toBe(false);
  });

  test('running outside Netlify reports the environment as local', async () => {
    const { CONTEXT, ...rest } = ENV;
    const h = await load(rest);
    h.__auth.identify = asRole('admin');
    const net = offline();
    try {
      expect((await (await get(h)).json()).environment).toBe('local');
    } finally {
      net.restore();
    }
  });
});

/* ============================================================ what never leaks */

test.describe('credentials', () => {
  test('never returns a value, only whether one exists', async () => {
    /**
     * The guarantee the whole endpoint is built around.
     *
     * Every fixture above is a distinctive sentence rather than a random
     * string, so this assertion fails with a readable message naming exactly
     * which variable escaped — and so that a leak is unmistakable in a diff
     * rather than looking like noise.
     *
     * The webhook URL is the one worth naming separately: it is a capability,
     * not a configuration. Anyone holding it can post into the channel it
     * addresses, and even its HOST names the service.
     */
    const h = await load(ENV);
    h.__auth.identify = asRole('admin');
    const net = offline();
    let text: string;
    try {
      text = await (await get(h)).text();
    } finally {
      net.restore();
    }

    for (const [name, value] of Object.entries(ENV)) {
      // The Property ID is a number the endpoint never echoes; the CONTEXT is
      // the deploy context and IS meant to be reported.
      if (name === 'CONTEXT' || name === 'LEAD_NOTIFY_TRANSPORT') continue;
      expect(text, `${name} leaked into the response`).not.toContain(value);
    }

    expect(text).not.toContain('hooks.example.invalid');
    expect(text).not.toContain('supabase.co');
    expect(text).not.toContain('gserviceaccount');
    expect(text).not.toContain('15392224433');
    expect(text).not.toContain('the-secret-path');
  });

  test('the response is marked private and uncacheable', async () => {
    const h = await load(ENV);
    h.__auth.identify = asRole('admin');
    const net = offline();
    try {
      const cc = (await get(h)).headers.get('cache-control') || '';
      expect(cc).toContain('private');
      expect(cc).toContain('no-store');
    } finally {
      net.restore();
    }
  });

  test('the probe never reads a table', async () => {
    // A health check that selects from `leads` to prove the database is up is a
    // health check that reads personal data on every page load.
    const h = await load(ENV);
    h.__auth.identify = asRole('admin');
    const net = offline();
    try {
      await get(h);
    } finally {
      net.restore();
    }
    for (const url of net.reached) {
      expect(url, `the probe read ${url}`).not.toMatch(/\/rest\/v1\/\w/);
    }
  });
});
