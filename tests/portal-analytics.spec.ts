import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * GET /api/portal-analytics — Phase 9, Workstream M.
 *
 * Exercised in-process, like the lead endpoint: the static server the other
 * suites run against does not serve functions, and the gates below are all
 * server-side.
 *
 * NOTHING HERE EVER CONTACTS GOOGLE.
 * ---------------------------------
 * Every test replaces the `__google` seam with fixed responses. That is a hard
 * requirement rather than a convenience — a suite that queried the real
 * property would spend its quota, and would write test traffic into the
 * numbers the property exists to report. `no request leaves this process`
 * below asserts it rather than trusting it: `globalThis.fetch` is replaced with
 * a function that fails the test if anything calls it.
 *
 * The module reads its configuration from `process.env` at import time, which
 * is what lets the unconfigured state be a real state rather than a flag. So
 * each test imports a FRESH copy with the environment it wants, via a unique
 * query string on the specifier — the ESM cache is keyed on the whole URL.
 */

type Handler = {
  default: (request: Request) => Promise<Response>;
  __auth: { identify: (token: string) => Promise<{ id: string; role: string } | null> };
  __google: {
    accessToken: () => Promise<{ token: string; expiresIn: number }>;
    call: (method: string, token: string, body: unknown) => Promise<unknown>;
  };
  __cache: { clear: () => void; ttlMs: number };
};

const CONFIGURED = {
  GA4_PROPERTY_ID: '15392224433',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'reporting@example.iam.gserviceaccount.com',
  // Not a key. Never a key: no test in this repository needs a real one, and a
  // real one in a test file is a real one in the repository.
  GOOGLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nnot-a-key\\n-----END PRIVATE KEY-----',
};

const SUPABASE = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test_value_not_real',
};

let serial = 0;

/** A fresh module instance with exactly the environment given. */
async function load(env: Record<string, string | undefined>): Promise<Handler> {
  const keys = [...Object.keys(CONFIGURED), ...Object.keys(SUPABASE)];
  for (const key of keys) delete process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  serial += 1;
  return (await import(
    `../netlify/functions/portal-analytics.mjs?case=${serial}`
  )) as unknown as Handler;
}

/** Signed in, and allowed. */
const asRole = (role: string) => async () => ({ id: 'user-1', role });

/** The shape `batchRunReports` returns, with the values a test wants. */
const report = (metricRows: number[][], dimensionRows: [string, number][] = []) => ({
  rows: dimensionRows.length
    ? dimensionRows.map(([key, value]) => ({
      dimensionValues: [{ value: key }],
      metricValues: [{ value: String(value) }],
    }))
    : metricRows.map((values) => ({ metricValues: values.map((v) => ({ value: String(v) })) })),
});

/**
 * A complete, plausible set of Google responses.
 *
 * Order matters and mirrors `collect()`: today, 7 days, the window, top pages,
 * source/medium — then the lead events batch, then realtime.
 */
function googleFixture(overrides: {
  sessions?: number; leadEvents?: [string, number][]; realtimeFails?: boolean;
} = {}) {
  const sessions = overrides.sessions ?? 400;
  const calls: string[] = [];

  return {
    calls,
    accessToken: async () => ({ token: 'ya29.fake-token', expiresIn: 3600 }),
    call: async (method: string, _token: string, body: any) => {
      calls.push(method);
      if (method === 'runRealtimeReport') {
        if (overrides.realtimeFails) throw new Error('realtime exploded');
        return report([[7]]);
      }
      // The lead-event batch is the one whose single request carries a filter.
      if (body?.requests?.length === 1 && body.requests[0].dimensionFilter) {
        return {
          reports: [report([], overrides.leadEvents ?? [
            ['form_submit_success', 9], ['questionnaire_submit_success', 3],
          ])],
        };
      }
      return {
        reports: [
          report([[12, 15, 30, 8]]),                       // today
          report([[95, 120, 300, 60]]),                    // 7 days
          report([[310, sessions, 1200, 210]]),            // the window
          report([], [['/', 600], ['/kkv.html', 300]]),    // top pages
          report([], [['google / organic', 250], ['(direct) / (none)', 150]]),
        ],
      };
    },
  };
}

const get = (h: Handler, url = 'https://stratosweb.hu/api/portal-analytics', token = 'jwt') =>
  h.default(new Request(url, { headers: token ? { authorization: `Bearer ${token}` } : {} }));

/* ========================================================== 1. the method === */

test.describe('method', () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    test(`${method} is refused`, async () => {
      const h = await load({ ...SUPABASE, ...CONFIGURED });
      const res = await h.default(new Request('https://x/api/portal-analytics', { method }));
      expect(res.status).toBe(405);
      expect((await res.json()).code).toBe('METHOD_NOT_ALLOWED');
    });
  }
});

/* ================================================== 2. authentication ====== */

test.describe('authentication', () => {
  test('no Authorization header is 401', async () => {
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    const res = await h.default(new Request('https://x/api/portal-analytics'));
    expect(res.status).toBe(401);
  });

  for (const header of ['', 'Bearer', 'Bearer ', 'Basic abc', 'jwt-without-a-scheme']) {
    test(`a malformed header (${JSON.stringify(header)}) is 401`, async () => {
      const h = await load({ ...SUPABASE, ...CONFIGURED });
      const res = await h.default(
        new Request('https://x/api/portal-analytics', { headers: { authorization: header } }),
      );
      expect(res.status).toBe(401);
    });
  }

  test('a token Supabase rejects is 401', async () => {
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = async () => null;
    expect((await get(h)).status).toBe(401);
  });

  test('an identify() that throws is 401 and not a 500', async () => {
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = async () => { throw new Error('supabase unreachable'); };
    expect((await get(h)).status).toBe(401);
  });

  test('every authentication failure gives the same message', async () => {
    // A caller who can tell "no such token" from "token expired" from
    // "Supabase is down" learns something about the system; a caller who
    // cannot, cannot.
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    const messages = new Set<string>();

    messages.add((await (await h.default(new Request('https://x/api/portal-analytics'))).json()).message);
    h.__auth.identify = async () => null;
    messages.add((await (await get(h)).json()).message);
    h.__auth.identify = async () => { throw new Error('down'); };
    messages.add((await (await get(h)).json()).message);

    expect(messages.size, [...messages].join(' | ')).toBe(1);
  });
});

/* =================================================== 3. authorization ====== */

test.describe('authorization', () => {
  for (const role of ['team_member', 'client']) {
    test(`${role} holds a valid session and still cannot read the property`, async () => {
      const h = await load({ ...SUPABASE, ...CONFIGURED });
      h.__auth.identify = asRole(role);
      const fixture = googleFixture();
      Object.assign(h.__google, fixture);

      const res = await get(h);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('FORBIDDEN');
      // The forbidden case must not have cost a Google call.
      expect(fixture.calls).toEqual([]);
    });
  }

  for (const role of ['super_admin', 'admin']) {
    test(`${role} may read it`, async () => {
      const h = await load({ ...SUPABASE, ...CONFIGURED });
      h.__auth.identify = asRole(role);
      Object.assign(h.__google, googleFixture());
      expect((await get(h)).status).toBe(200);
    });
  }

  test('an unknown role is refused rather than allowed by default', async () => {
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = async () => ({ id: 'u', role: 'something_new' });
    expect((await get(h)).status).toBe(403);
  });
});

/* ========================================================== 4. the range === */

test.describe('range', () => {
  for (const range of ['7d', '28d', '90d']) {
    test(`${range} is accepted`, async () => {
      const h = await load({ ...SUPABASE, ...CONFIGURED });
      h.__auth.identify = asRole('admin');
      Object.assign(h.__google, googleFixture());
      const res = await get(h, `https://x/api/portal-analytics?range=${range}`);
      expect(res.status).toBe(200);
      expect((await res.json()).data.range).toBe(range);
    });
  }

  for (const range of ['1d', 'all', '../etc', '2020-01-01', 'yesterday', '__proto__']) {
    test(`${JSON.stringify(range)} is refused before Google is touched`, async () => {
      const h = await load({ ...SUPABASE, ...CONFIGURED });
      h.__auth.identify = asRole('admin');
      const fixture = googleFixture();
      Object.assign(h.__google, fixture);

      const res = await get(h, `https://x/api/portal-analytics?range=${encodeURIComponent(range)}`);
      expect(res.status).toBe(400);
      expect(fixture.calls).toEqual([]);
    });
  }

  test('an absent or empty range falls back to the default', async () => {
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = asRole('admin');
    Object.assign(h.__google, googleFixture());

    for (const url of [
      'https://x/api/portal-analytics',
      'https://x/api/portal-analytics?range=',
    ]) {
      const res = await get(h, url);
      expect(res.status).toBe(200);
      expect((await res.json()).data.range).toBe('28d');
    }
  });

  test('no date the caller supplies reaches Google', async () => {
    // The allow-list exists so that startDate/endDate are ours, not theirs.
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = asRole('admin');
    const bodies: any[] = [];
    h.__google.accessToken = async () => ({ token: 't', expiresIn: 3600 });
    h.__google.call = async (method, _t, body: any) => {
      bodies.push(body);
      return method === 'runRealtimeReport'
        ? report([[1]])
        : { reports: [report([[1, 1, 1, 1]]), report([[1, 1, 1, 1]]), report([[1, 1, 1, 1]]), report([]), report([])] };
    };

    await get(h, 'https://x/api/portal-analytics?range=7d&startDate=2000-01-01');
    const dates = JSON.stringify(bodies);
    expect(dates).not.toContain('2000-01-01');
    expect(dates).toContain('6daysAgo');
  });
});

/* ============================================= 5. the unconfigured state === */

test.describe('the unconfigured state', () => {
  test('is a 200 with configured:false, not an error', async () => {
    const h = await load({ ...SUPABASE });
    h.__auth.identify = asRole('admin');

    const res = await get(h);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.configured).toBe(false);
  });

  test('names the variables that are missing, and only their names', async () => {
    const h = await load({ ...SUPABASE, GA4_PROPERTY_ID: '15392224433' });
    h.__auth.identify = asRole('admin');

    const body = await (await get(h)).json();
    expect(body.missing).toEqual(['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY']);
    // The one that is set must not be echoed back with it.
    expect(JSON.stringify(body)).not.toContain('15392224433');
  });

  test('authentication is still required to learn it', async () => {
    // Which integrations a private admin has wired up is not public.
    const h = await load({ ...SUPABASE });
    const res = await h.default(new Request('https://x/api/portal-analytics'));
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('configured');
  });

  test('an unauthorised role learns it no more than an anonymous one', async () => {
    const h = await load({ ...SUPABASE });
    h.__auth.identify = asRole('client');
    expect((await get(h)).status).toBe(403);
  });
});

/* ============================================== 6. the report it produces == */

test.describe('the report', () => {
  test('maps every GA4 figure to the field the screen reads', async () => {
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = asRole('admin');
    Object.assign(h.__google, googleFixture({ sessions: 400 }));

    const { data } = await (await get(h)).json();

    expect(data.activeUsers).toEqual({ today: 12, last7Days: 95, inRange: 310 });
    expect(data.sessions).toBe(400);
    expect(data.screenPageViews).toBe(1200);
    expect(data.newUsers).toBe(210);
    expect(data.realtimeActiveUsers).toBe(7);
    expect(data.topPages).toEqual([
      { key: '/', value: 600 }, { key: '/kkv.html', value: 300 },
    ]);
    expect(data.trafficSources[0]).toEqual({ key: 'google / organic', value: 250 });
  });

  test('counts lead events by name and divides by sessions', async () => {
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = asRole('admin');
    Object.assign(h.__google, googleFixture({ sessions: 400 }));

    const { data } = await (await get(h)).json();
    expect(data.leadEvents.total).toBe(12);              // 9 + 3
    expect(data.leadEvents.perSession).toBeCloseTo(0.03, 5);
    expect(data.leadEvents.byName.map((r: any) => r.key)).toEqual([
      'form_submit_success', 'questionnaire_submit_success',
    ]);
  });

  test('a rate with no sessions is null, not zero and not Infinity', async () => {
    // 0/0 is the case that produces NaN and renders as "NaN%" on a dashboard.
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = asRole('admin');
    Object.assign(h.__google, googleFixture({ sessions: 0, leadEvents: [] }));

    const { data } = await (await get(h)).json();
    expect(data.leadEvents.total).toBe(0);
    expect(data.leadEvents.perSession).toBeNull();
  });

  test('says on every payload that the figures are consented traffic only', async () => {
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = asRole('admin');
    Object.assign(h.__google, googleFixture());
    expect((await (await get(h)).json()).data.basis).toBe('consented');
  });

  test('a missing metric reads as 0 rather than crashing the screen', async () => {
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = asRole('admin');
    h.__google.accessToken = async () => ({ token: 't', expiresIn: 3600 });
    // GA4 returns no `rows` at all for a property with no data in the window.
    h.__google.call = async (method) =>
      method === 'runRealtimeReport' ? {} : { reports: [{}, {}, {}, {}, {}] };

    const res = await get(h);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.sessions).toBe(0);
    expect(data.activeUsers.today).toBe(0);
    expect(data.topPages).toEqual([]);
  });

  test('realtime failing does not take the rest of the dashboard with it', async () => {
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = asRole('admin');
    Object.assign(h.__google, googleFixture({ realtimeFails: true }));

    const res = await get(h);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.realtimeActiveUsers).toBeNull();
    expect(data.sessions).toBe(400);
  });
});

/* ================================================== 7. failure upstream ==== */

test.describe('when Google fails', () => {
  test('the caller gets 502 and none of the detail', async () => {
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = asRole('admin');
    h.__google.accessToken = async () => ({ token: 't', expiresIn: 3600 });
    h.__google.call = async () => {
      throw new Error('PERMISSION_DENIED: reporting@example.iam.gserviceaccount.com lacks access to property 15392224433');
    };

    const res = await get(h);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('gserviceaccount');
    expect(text).not.toContain('15392224433');
    expect(text).not.toContain('PERMISSION_DENIED');
    expect(JSON.parse(text).code).toBe('UPSTREAM_FAILED');
  });

  test('a key that will not sign is a 502, not a stack trace', async () => {
    // GOOGLE_PRIVATE_KEY here is deliberately not a key, so the real
    // accessToken() throws inside node:crypto. That is the production failure
    // mode for a mistyped variable and it must not reach the browser.
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = asRole('admin');

    const res = await get(h);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text.toLowerCase()).not.toContain('private key');
    expect(text).not.toContain('at ');   // no stack frames
  });
});

/* =========================================================== 8. the cache == */

test.describe('the cache', () => {
  test('a second request inside the TTL does not call Google', async () => {
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = asRole('admin');
    const fixture = googleFixture();
    Object.assign(h.__google, fixture);

    const first = await (await get(h)).json();
    const calls = fixture.calls.length;
    const second = await (await get(h)).json();

    expect(calls).toBeGreaterThan(0);
    expect(fixture.calls.length).toBe(calls);
    expect(second.cached).toBe(true);
    expect(first.cached).toBe(false);
    expect(second.data).toEqual(first.data);
  });

  test('each range is cached separately', async () => {
    // One shared entry would serve 7-day figures to someone who asked for 90.
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = asRole('admin');
    const fixture = googleFixture();
    Object.assign(h.__google, fixture);

    await get(h, 'https://x/api/portal-analytics?range=7d');
    const after7 = fixture.calls.length;
    const ninety = await (await get(h, 'https://x/api/portal-analytics?range=90d')).json();

    expect(fixture.calls.length).toBeGreaterThan(after7);
    expect(ninety.cached).toBe(false);
    expect(ninety.data.range).toBe('90d');
  });

  test('an expired entry is refetched', async () => {
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = asRole('admin');
    const fixture = googleFixture();
    Object.assign(h.__google, fixture);

    await get(h);
    const calls = fixture.calls.length;
    h.__cache.ttlMs = -1;          // everything written from here is already stale
    h.__cache.clear();
    const again = await (await get(h)).json();

    expect(fixture.calls.length).toBeGreaterThan(calls);
    expect(again.cached).toBe(false);
  });

  test('a cached payload is still refused to an account that may not read it', async () => {
    // The cache must sit behind the guards, not in front of them.
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = asRole('admin');
    Object.assign(h.__google, googleFixture());
    expect((await get(h)).status).toBe(200);

    h.__auth.identify = asRole('client');
    const res = await get(h);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('sessions');
  });
});

/* ================================================= 9. what never leaks ===== */

test.describe('credentials', () => {
  test('no response body contains one', async () => {
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = asRole('admin');
    Object.assign(h.__google, googleFixture());

    const bodies = [
      await (await get(h)).text(),
      await (await get(h, 'https://x/api/portal-analytics?range=7d')).text(),
      await (await h.default(new Request('https://x/api/portal-analytics'))).text(),
    ].join('\n');

    for (const secret of [
      CONFIGURED.GOOGLE_PRIVATE_KEY, CONFIGURED.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      CONFIGURED.GA4_PROPERTY_ID, SUPABASE.SUPABASE_SECRET_KEY,
      'ya29.', 'BEGIN PRIVATE KEY', 'gserviceaccount',
    ]) {
      expect(bodies, `leaked ${secret.slice(0, 24)}`).not.toContain(secret);
    }
  });

  test('the response is marked private and uncacheable', async () => {
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = asRole('admin');
    Object.assign(h.__google, googleFixture());

    const cc = (await get(h)).headers.get('cache-control') || '';
    expect(cc).toContain('private');
    expect(cc).toContain('no-store');
  });

  test('no request leaves this process when the seams are mocked', async () => {
    // The guarantee the whole file depends on, asserted rather than assumed.
    const h = await load({ ...SUPABASE, ...CONFIGURED });
    h.__auth.identify = asRole('admin');
    Object.assign(h.__google, googleFixture());

    const real = globalThis.fetch;
    const reached: string[] = [];
    globalThis.fetch = (async (input: any) => {
      reached.push(String(input?.url ?? input));
      throw new Error('the suite must not make network requests');
    }) as typeof fetch;

    try {
      expect((await get(h)).status).toBe(200);
    } finally {
      globalThis.fetch = real;
    }
    expect(reached, reached.join(', ')).toEqual([]);
  });

  test('the built portal bundle carries no Google identifier', async () => {
    // The architectural claim, checked against the artefact that ships. The
    // Property ID is not a secret; it is also not the browser's business, and
    // finding it here would mean something calls the Data API from the client.
    const dir = path.join(process.cwd(), 'dist', 'portal');
    test.skip(!fs.existsSync(dir), 'run npm run build first');

    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(js|css|html)$/.test(e.name)) files.push(full);
      }
    };
    walk(dir);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const body = fs.readFileSync(file, 'utf8');
      const rel = path.relative(process.cwd(), file);
      expect(body, `${rel} carries the GA4 Property ID`).not.toContain('15392224433');
      expect(body, `${rel} names the service account variable`).not.toContain('GOOGLE_PRIVATE_KEY');
      expect(body, `${rel} carries a service account address`).not.toContain('gserviceaccount');
      expect(body, `${rel} reaches the Data API directly`).not.toContain('analyticsdata.googleapis.com');
    }
  });
});
