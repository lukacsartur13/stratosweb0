import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * GET /api/portal-analytics.
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
  __cache: { clear: () => void; ttlMs: number; realtimeTtlMs: number };
};

/**
 * Fixtures that are deliberately NOT shaped like the credentials they stand in
 * for.
 *
 * The first version of this file used a real-looking PEM block and an
 * `sb_secret_…` string, and `npm run scan:secrets` failed on both — correctly.
 * The fix was these values rather than an exception in the scanner: a rule that
 * skips test files is a rule that stops seeing the day a real key is pasted
 * into one, and a fixture that looks exactly like a credential is what makes a
 * real credential invisible next to it.
 *
 * Nothing here needs to be well-formed. The private key is never parsed except
 * by the one test that requires an unparseable key to become a 502, and the
 * Supabase key is only ever copied into a header that a mocked `identify`
 * never reads.
 */
const CONFIGURED = {
  GA4_PROPERTY_ID: '15392224433',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'reporting@example.iam.gserviceaccount.com',
  GOOGLE_PRIVATE_KEY: 'not-a-key-and-not-shaped-like-one',
};

const SUPABASE = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SECRET_KEY: 'test-server-key-not-shaped-like-one',
};

let serial = 0;

/** A fresh module instance with exactly the environment given. */
async function load(env: Record<string, string | undefined>): Promise<Handler> {
  // `GOOGLE_PRIVATE_KEY_BASE64` is cleared with the rest even though it is not
  // in CONFIGURED: it is the branch that WINS over `GOOGLE_PRIVATE_KEY`, so a
  // real one left in a developer's shell would silently take over every test
  // below and the suite would pass against a credential instead of a fixture.
  const keys = [
    ...Object.keys(CONFIGURED), ...Object.keys(SUPABASE),
    'GOOGLE_PRIVATE_KEY_BASE64', 'GA4_PRODUCTION_HOSTS',
  ];
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

/** A report with one undimensioned row of metric values. */
const totals = (values: number[]) => ({
  rows: [{ metricValues: values.map((v) => ({ value: String(v) })) }],
});

/** A report with dimension rows: `[[...dims], [...metrics]]`. */
const rows = (list: [string[], number[]][]) => ({
  rows: list.map(([dims, metrics]) => ({
    dimensionValues: dims.map((value) => ({ value })),
    metricValues: metrics.map((v) => ({ value: String(v) })),
  })),
});

/**
 * A complete, plausible set of Google responses.
 *
 * The three batches are told apart by the first request's first dimension,
 * which is unambiguous and — more usefully — fails loudly if the endpoint's
 * request shape changes underneath this file rather than quietly returning the
 * wrong report for the right index.
 *
 *   batch 1   no dimension on request 0        totals, trend, pages
 *   batch 2   `landingPagePlusQueryString`     landing, acquisition, devices, events
 *   batch 3   `deviceCategory` + eventCount    the lead-event joins
 *
 * The summary metric order is the endpoint's `SUMMARY_METRICS`:
 * activeUsers, sessions, screenPageViews, newUsers, engagedSessions,
 * userEngagementDuration.
 */
function googleFixture(overrides: {
  sessions?: number;
  leadEvents?: [string, number][];
  realtimeFails?: boolean;
  empty?: boolean;
} = {}) {
  const sessions = overrides.sessions ?? 400;
  const calls: string[] = [];
  const bodies: any[] = [];

  const funnel = overrides.leadEvents ?? [
    ['cta_click', 180],
    ['form_start', 64],
    ['form_submit_attempt', 21],
    ['form_submit_success', 9],
    ['questionnaire_submit_success', 3],
  ];

  return {
    calls,
    bodies,
    accessToken: async () => ({ token: 'ya29.fake-token', expiresIn: 3600 }),
    call: async (method: string, _token: string, body: any) => {
      calls.push(method);
      bodies.push(body);

      if (method === 'runRealtimeReport') {
        if (overrides.realtimeFails) throw new Error('realtime exploded');
        return body?.dimensions?.[0]?.name === 'eventName'
          ? rows([[['page_view'], [42]], [['cta_click'], [6]]])
          : rows([[['Stratos — homepage'], [4]], [['Munkáink'], [2]]]);
      }

      if (overrides.empty) return { reports: [{}, {}, {}, {}, {}] };

      const first = body?.requests?.[0]?.dimensions?.[0]?.name;

      if (!first) {
        return {
          reports: [
            totals([12, 15, 30, 8, 9, 450]),              // today
            totals([310, sessions, 1200, 210, 240, 19_200]), // the window
            totals([260, 350, 980, 180, 190, 15_400]),    // the window before it
            rows([                                        // the trend
              [['20260801'], [40, 55, 160]],
              [['20260802'], [51, 66, 190]],
            ]),
            rows([                                        // top pages
              [['/', 'Stratos — homepage'], [600, 300, 9000, 320]],
              [['/kkv.html', 'KKV'], [300, 140, 3600, 150]],
            ]),
          ],
        };
      }

      if (first === 'landingPagePlusQueryString') {
        return {
          reports: [
            rows([                                        // landing pages
              [['/'], [220, 190, 150, 0.31]],
              [['/kkv.html'], [80, 70, 44, 0.45]],
            ]),
            rows([                                        // acquisition
              [['google', 'organic', '(not set)'], [250, 210, 180, 120]],
              [['(direct)', '(none)', '(not set)'], [150, 130, 90, 80]],
              [['google', 'cpc', 'kkv-2026'], [40, 36, 30, 30]],
            ]),
            rows([                                        // devices
              [['mobile'], [260, 220, 170, 700]],
              [['desktop'], [120, 100, 90, 430]],
              [['tablet'], [20, 18, 12, 70]],
            ]),
            rows(funnel.map(([name, count]) => [[name], [count]])),
            rows(funnel.map(([name, count]) => [[name], [Math.round(count * 0.7)]])),
          ],
        };
      }

      // batch three — the lead-event joins.
      return {
        reports: [
          rows([[['mobile'], [4]], [['desktop'], [8]]]),  // leads by device
          rows([[['/kapcsolat.html'], [7]], [['/'], [5]]]), // leads by page
          rows([[['google', 'organic'], [8]], [['google', 'cpc'], [3]]]),
          rows([[['form_submit_success'], [2]]]),         // today
          rows([[['/'], [9]], [['/kkv.html'], [3]]]),     // leads by landing page
        ],
      };
    },
  };
}

const get = (h: Handler, url = 'https://stratosweb.hu/api/portal-analytics', token = 'jwt') =>
  h.default(new Request(url, { headers: token ? { authorization: `Bearer ${token}` } : {} }));

const ready = async (env: Record<string, string | undefined> = {}) => {
  const h = await load({ ...SUPABASE, ...CONFIGURED, ...env });
  h.__auth.identify = asRole('admin');
  const fixture = googleFixture();
  Object.assign(h.__google, fixture);
  return { h, fixture };
};

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
      const { h, fixture } = await ready();
      h.__auth.identify = asRole(role);

      const res = await get(h);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('FORBIDDEN');
      // The forbidden case must not have cost a Google call.
      expect(fixture.calls).toEqual([]);
    });
  }

  for (const role of ['super_admin', 'admin']) {
    test(`${role} may read it`, async () => {
      const { h } = await ready();
      h.__auth.identify = asRole(role);
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
  for (const range of ['today', '7d', '30d', '90d']) {
    test(`${range} is accepted`, async () => {
      const { h } = await ready();
      const res = await get(h, `https://x/api/portal-analytics?range=${range}`);
      expect(res.status).toBe(200);
      expect((await res.json()).data.range).toBe(range);
    });
  }

  for (const range of ['28d', '1d', 'all', '../etc', '2020-01-01', 'yesterday', '__proto__']) {
    test(`${JSON.stringify(range)} is refused before Google is touched`, async () => {
      const { h, fixture } = await ready();
      const res = await get(h, `https://x/api/portal-analytics?range=${encodeURIComponent(range)}`);
      expect(res.status).toBe(400);
      expect(fixture.calls).toEqual([]);
    });
  }

  test('an absent or empty range falls back to the default', async () => {
    const { h } = await ready();
    for (const url of [
      'https://x/api/portal-analytics',
      'https://x/api/portal-analytics?range=',
    ]) {
      const res = await get(h, url);
      expect(res.status).toBe(200);
      expect((await res.json()).data.range).toBe('30d');
    }
  });

  test('the comparison period is the same length, immediately before', async () => {
    const { h, fixture } = await ready();
    const body = await (await get(h, 'https://x/api/portal-analytics?range=7d')).json();

    expect(body.data.comparison).toEqual({ label: 'Previous 7 days', days: 7 });
    const sent = JSON.stringify(fixture.bodies);
    expect(sent).toContain('6daysAgo');     // the window: today back 7 days
    expect(sent).toContain('13daysAgo');    // the window before it: 2*7-1
    expect(sent).toContain('7daysAgo');
  });

  test('today is charted by hour and a longer range by day', async () => {
    const { h, fixture } = await ready();
    const today = await (await get(h, 'https://x/api/portal-analytics?range=today')).json();
    expect(today.data.trend.grain).toBe('dateHour');
    expect(JSON.stringify(fixture.bodies)).toContain('dateHour');

    const { h: h2 } = await ready();
    const month = await (await get(h2, 'https://x/api/portal-analytics?range=30d')).json();
    expect(month.data.trend.grain).toBe('date');
  });

  test('no date the caller supplies reaches Google', async () => {
    // The allow-list exists so that startDate/endDate are ours, not theirs.
    const { h, fixture } = await ready();
    await get(h, 'https://x/api/portal-analytics?range=7d&startDate=2000-01-01&endDate=2000-02-02');
    const sent = JSON.stringify(fixture.bodies);
    expect(sent).not.toContain('2000-01-01');
    expect(sent).not.toContain('2000-02-02');
    expect(sent).toContain('6daysAgo');
  });
});

/* ============================================ 4b. production vs staging ==== */

test.describe('environment', () => {
  test('production is the default, and it is a real filter on hostName', async () => {
    const { h, fixture } = await ready();
    const { data } = await (await get(h)).json();

    expect(data.environment).toBe('production');
    expect(data.environmentFilter.applied).toBe(true);
    expect(data.environmentFilter.by).toBe('hostName');
    expect(data.environmentFilter.hosts).toEqual(['stratosweb.hu', 'www.stratosweb.hu']);

    // Every reporting request carries it — not just the headline one. A
    // dashboard whose KPI cards are filtered and whose tables are not is worse
    // than one that filters nothing, because the two disagree silently.
    const requests = fixture.bodies.filter((b: any) => b?.requests).flatMap((b: any) => b.requests);
    expect(requests.length).toBeGreaterThan(10);
    for (const request of requests) {
      expect(JSON.stringify(request.dimensionFilter)).toContain('hostName');
    }
  });

  test('staging is the complement, not a second allow-list', async () => {
    const { h, fixture } = await ready();
    const { data } = await (await get(h, 'https://x/api/portal-analytics?environment=staging')).json();

    expect(data.environment).toBe('staging');
    expect(data.environmentFilter.applied).toBe(true);
    // `notExpression` is what makes "staging" mean "everything that is not the
    // real website" rather than "the one preview host somebody remembered".
    expect(JSON.stringify(fixture.bodies)).toContain('notExpression');
  });

  test('all combines them, and says so rather than implying a filter', async () => {
    const { h, fixture } = await ready();
    const { data } = await (await get(h, 'https://x/api/portal-analytics?environment=all')).json();

    expect(data.environment).toBe('all');
    expect(data.environmentFilter.applied).toBe(false);
    expect(data.environmentFilter.note).toMatch(/combined/i);

    const reporting = fixture.bodies.filter((b: any) => b?.requests).flatMap((b: any) => b.requests);
    for (const request of reporting) {
      // The funnel reports still filter by event name; none of them filters by
      // host.
      expect(JSON.stringify(request.dimensionFilter ?? {})).not.toContain('hostName');
    }
  });

  test('the production hosts are configurable without a deploy', async () => {
    const { h, fixture } = await ready({ GA4_PRODUCTION_HOSTS: ' example.com , WWW.Example.com ' });
    const { data } = await (await get(h)).json();
    expect(data.environmentFilter.hosts).toEqual(['example.com', 'www.example.com']);
    expect(JSON.stringify(fixture.bodies)).toContain('example.com');
  });

  for (const environment of ['prod', 'live', 'ALL', '../x', '']) {
    test(`${JSON.stringify(environment)} is refused before Google is touched`, async () => {
      const { h, fixture } = await ready();
      const res = await get(
        h, `https://x/api/portal-analytics?environment=${encodeURIComponent(environment)}`,
      );
      if (environment === '') {
        // An empty value is absent, which is the default rather than an error.
        expect(res.status).toBe(200);
      } else {
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('BAD_ENVIRONMENT');
        expect(fixture.calls).toEqual([]);
      }
    });
  }

  test('realtime is honest about not being filterable', async () => {
    // `hostName` is not in GA4's realtime dimension schema, so the realtime
    // panel is whole-property whatever the selector says. Claiming otherwise
    // would be the one dishonest number on the screen.
    const { h } = await ready();
    const { data } = await (await get(h)).json();
    expect(data.realtime.environmentFiltered).toBe(false);
  });

  test('each environment is cached separately', async () => {
    // One shared entry would serve production KPIs to someone who asked to see
    // staging, which is the exact confusion the selector exists to prevent.
    const { h, fixture } = await ready();
    await get(h);
    const afterProduction = fixture.calls.length;

    const staging = await (await get(h, 'https://x/api/portal-analytics?environment=staging')).json();
    expect(fixture.calls.length).toBeGreaterThan(afterProduction);
    expect(staging.cached).toBe(false);
    expect(staging.data.environment).toBe('staging');
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
    // But the screen may still say that the property is known, without saying
    // which property it is.
    expect(body.propertyConfigured).toBe(true);
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
  test('maps the headline figures, and a comparison period beside them', async () => {
    const { h } = await ready();
    const { data } = await (await get(h)).json();

    expect(data.overview.current.activeUsers).toBe(310);
    expect(data.overview.current.sessions).toBe(400);
    expect(data.overview.current.screenPageViews).toBe(1200);
    expect(data.overview.current.newUsers).toBe(210);
    expect(data.overview.previous.sessions).toBe(350);
    expect(data.overview.today.sessions).toBe(15);
  });

  test('engagement is per active user, which is how GA4 defines it', async () => {
    // 19 200 seconds over 310 active users. Dividing by SESSIONS instead is the
    // most common way to report a different number under GA4's own name.
    const { h } = await ready();
    const { data } = await (await get(h)).json();
    expect(data.overview.current.engagementPerUser).toBeCloseTo(61.9, 1);
    expect(data.overview.current.engagementRate).toBeCloseTo(240 / 400, 5);
  });

  test('counts lead events by name and divides by sessions', async () => {
    const { h } = await ready();
    const { data } = await (await get(h)).json();

    expect(data.overview.current.leadEvents).toBe(12);   // 9 + 3
    expect(data.overview.current.leadRate).toBeCloseTo(0.03, 5);
    expect(data.overview.today.leadEvents).toBe(2);
  });

  test('the funnel is built only from events the taxonomy defines', async () => {
    const { h } = await ready();
    const { data } = await (await get(h)).json();

    expect(data.funnel.map((s: any) => s.id)).toEqual([
      'session', 'cta', 'form_start', 'form_submit', 'lead',
    ]);
    expect(data.funnel[0].count).toBe(400);   // sessions, not an invented event
    expect(data.funnel[1].count).toBe(180);   // cta_click
    expect(data.funnel[2].count).toBe(64);    // form_start
    expect(data.funnel[3].count).toBe(21);    // form_submit_attempt
    expect(data.funnel[4].count).toBe(12);    // the two success events

    // Stage-to-stage and cumulative, both, because they answer different
    // questions: where people stop, and what the whole path is worth.
    expect(data.funnel[4].ofPrevious).toBeCloseTo(12 / 21, 5);
    expect(data.funnel[4].ofEntry).toBeCloseTo(12 / 400, 5);
    expect(data.funnel[0].ofPrevious).toBeNull();

    // And every event name it used is one that is actually sent.
    const taxonomy = fs.readFileSync(
      path.join(process.cwd(), 'assets', 'js', 'analytics.js'), 'utf8',
    );
    for (const name of data.events.map((e: any) => e.name)) {
      expect(taxonomy, `${name} is not sent by the site`).toContain(name);
    }
  });

  test('acquisition keeps source, medium and campaign apart', async () => {
    const { h } = await ready();
    const { data } = await (await get(h)).json();

    expect(data.acquisition[0]).toMatchObject({
      source: 'google', medium: 'organic', sessions: 250, activeUsers: 210,
    });
    expect(data.acquisition[2]).toMatchObject({ medium: 'cpc', campaign: 'kkv-2026' });
    // `(not set)` is GA4's own spelling for "no campaign". Rewriting it to a
    // friendlier word would be this endpoint inventing attribution.
    expect(data.acquisition[0].campaign).toBe('(not set)');
    // And the lead join is by source AND medium, not by source alone.
    expect(data.acquisition[0].leadEvents).toBe(8);
    expect(data.acquisition[2].leadEvents).toBe(3);
  });

  test('pages and landing pages are different questions with different joins', async () => {
    const { h } = await ready();
    const { data } = await (await get(h)).json();

    // Top pages: where views happened, joined to leads SENT from that path.
    expect(data.pages[0]).toMatchObject({ path: '/', views: 600, leadEvents: 5 });
    expect(data.pages[0].title).toBe('Stratos — homepage');

    // Landing pages: where sessions STARTED, joined to leads attributed to that
    // landing page. The same path carries a different number, and it must:
    // one says where the form was, the other says which page brought the
    // session that filled it in.
    expect(data.landingPages[0]).toMatchObject({ path: '/', sessions: 220, leadEvents: 9 });
    expect(data.landingPages[0].bounceRate).toBeCloseTo(0.31, 5);
  });

  test('devices carry their own conversion, which is the point of the split', async () => {
    const { h } = await ready();
    const { data } = await (await get(h)).json();

    const mobile = data.devices.find((d: any) => d.device === 'mobile');
    const desktop = data.devices.find((d: any) => d.device === 'desktop');
    expect(mobile).toMatchObject({ sessions: 260, leadEvents: 4 });
    expect(desktop).toMatchObject({ sessions: 120, leadEvents: 8 });
    expect(mobile.leadRate).toBeCloseTo(4 / 260, 5);
    expect(desktop.leadRate).toBeCloseTo(8 / 120, 5);
  });

  test('the trend is a series, in order, at the requested grain', async () => {
    const { h } = await ready();
    const { data } = await (await get(h)).json();
    expect(data.trend.points).toEqual([
      { at: '20260801', activeUsers: 40, sessions: 55, screenPageViews: 160 },
      { at: '20260802', activeUsers: 51, sessions: 66, screenPageViews: 190 },
    ]);
  });

  test('realtime reports pages and events for the last thirty minutes', async () => {
    const { h } = await ready();
    const { data } = await (await get(h)).json();

    expect(data.realtime.minutes).toBe(30);
    expect(data.realtime.activeUsersByPage).toBe(6);
    expect(data.realtime.byPage[0]).toEqual({ key: 'Stratos — homepage', value: 4 });
    expect(data.realtime.byEvent[0]).toEqual({ key: 'page_view', value: 42 });
  });

  test('a rate with no sessions is null, not zero and not Infinity', async () => {
    // 0/0 is the case that produces NaN and renders as "NaN%" on a dashboard.
    const { h } = await ready();
    Object.assign(h.__google, googleFixture({ sessions: 0, leadEvents: [] }));

    const { data } = await (await get(h)).json();
    expect(data.overview.current.leadEvents).toBe(0);
    expect(data.overview.current.leadRate).toBeNull();
    expect(data.overview.current.engagementRate).toBeNull();
  });

  test('says on every payload that the figures are consented traffic only', async () => {
    const { h } = await ready();
    expect((await (await get(h)).json()).data.basis).toBe('consented');
  });

  test('a completely empty property reads as zeroes rather than crashing', async () => {
    const { h } = await ready();
    Object.assign(h.__google, googleFixture({ empty: true }));

    const res = await get(h);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.overview.current.sessions).toBe(0);
    expect(data.overview.today.activeUsers).toBe(0);
    expect(data.pages).toEqual([]);
    expect(data.acquisition).toEqual([]);
    expect(data.devices).toEqual([]);
    expect(data.trend.points).toEqual([]);
    expect(data.funnel.every((s: any) => s.count === 0)).toBe(true);
  });

  test('a malformed response is absorbed rather than propagated', async () => {
    // Not "no data" — actively the wrong shape: nulls where objects belong,
    // strings where numbers belong, a report array that is not an array.
    const { h } = await ready();
    h.__google.call = async (method: string) =>
      method === 'runRealtimeReport'
        ? { rows: [{ dimensionValues: null, metricValues: [{ value: 'abc' }] }] }
        : {
          reports: [
            { rows: [{ metricValues: [{ value: 'not-a-number' }] }] },
            null,
            { rows: null },
            { rows: [{ dimensionValues: [], metricValues: [] }] },
            'this is not a report',
          ],
        };

    const res = await get(h);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Number.isFinite(data.overview.current.sessions)).toBe(true);
    expect(data.overview.current.sessions).toBe(0);
    expect(Array.isArray(data.pages)).toBe(true);
  });

  test('realtime failing does not take the rest of the dashboard with it', async () => {
    const { h } = await ready();
    Object.assign(h.__google, googleFixture({ realtimeFails: true }));

    const res = await get(h);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.realtime).toBeNull();
    expect(data.overview.current.sessions).toBe(400);
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
    expect(text.toLowerCase()).not.toContain('not-a-key');
    expect(text).not.toContain('at ');   // no stack frames
  });

  test('a failure clears the token so the next attempt is not stuck on it', async () => {
    // A revoked service account produces a token that authenticates and then
    // fails every report. Caching it would make the outage permanent for the
    // life of the warm instance.
    const { h, fixture } = await ready();
    let fails = true;
    h.__google.call = async (...args) => {
      if (fails) throw new Error('boom');
      return fixture.call(...(args as [string, string, any]));
    };

    expect((await get(h)).status).toBe(502);
    fails = false;
    expect((await get(h)).status).toBe(200);
    // Two tokens were minted, not one reused across the failure.
    expect(fixture.calls.length).toBeGreaterThan(0);
  });
});

/* ==================================================== 7b. the private key == */

/**
 * How the PEM gets in, which is the one thing about this endpoint that has
 * actually failed in production.
 *
 * `GOOGLE_PRIVATE_KEY` carries the key the way the JSON key file writes it —
 * one line, literal `\n` escapes — and it works until something between the
 * paste box and the running function rewrites the string. `\\n` stored for
 * `\n`, a swallowed backslash, a CRLF: each produces a value that still looks
 * like a key and dies inside OpenSSL as `DECODER routines::unsupported`.
 *
 * `GOOGLE_PRIVATE_KEY_BASE64` removes the class of failure rather than another
 * instance of it — the Base64 alphabet holds no backslash, quote or newline, so
 * there is nothing for an escaping layer to get wrong.
 *
 * The keys below are GENERATED, in the test, at run time. A PEM fixture in this
 * file would be a PEM fixture in the repository, `npm run scan:secrets` would
 * be right to fail on it, and a fake key that looks exactly like a real one is
 * what makes a real one invisible when it is pasted in beside it.
 */
test.describe('the private key', () => {
  const generate = () =>
    crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

  const withKeyVariable = async (variables: Record<string, string>) => {
    const h = await load({
      ...SUPABASE,
      GA4_PROPERTY_ID: CONFIGURED.GA4_PROPERTY_ID,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: CONFIGURED.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      ...variables,
    });
    h.__auth.identify = asRole('admin');
    // Only the reporting seam is replaced. `accessToken` is the REAL one, so
    // the key is parsed and signed with exactly as it would be in production —
    // which is the entire point of these tests.
    h.__google.call = googleFixture().call;
    return h;
  };

  /** Stand in for Google's token endpoint, and keep what was sent to it. */
  const interceptToken = async (h: Handler, run: () => Promise<Response>) => {
    const real = globalThis.fetch;
    const posted: string[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      posted.push(String(new URLSearchParams(String(init?.body)).get('assertion')));
      return new Response(JSON.stringify({ access_token: 'ya29.minted', expires_in: 3600 }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      return { res: await run(), posted };
    } finally {
      globalThis.fetch = real;
    }
  };

  test('a Base64 key is decoded and signs a JWT the public key verifies', async () => {
    const { privateKey, publicKey } = generate();
    const h = await withKeyVariable({
      GOOGLE_PRIVATE_KEY_BASE64: Buffer.from(privateKey, 'utf8').toString('base64'),
    });

    const { res, posted } = await interceptToken(h, () => get(h));
    expect(res.status).toBe(200);
    expect((await res.json()).configured).toBe(true);

    // Not "a token came back" — the assertion Google was handed carries a real
    // RS256 signature over its own header and claim, made by the key that went
    // in as Base64. That is the whole chain the production failure broke.
    const [header, claim, signature] = posted[0].split('.');
    expect(
      crypto.verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${claim}`),
        publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
    expect(JSON.parse(Buffer.from(claim, 'base64url').toString())).toMatchObject({
      iss: CONFIGURED.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
    });
  });

  test('Base64 survives newline mangling that defeats the escaped variable', async () => {
    // The production symptom, reproduced: the same key through both doors,
    // after the exact corruption that has been observed — the `\n` escapes
    // stored as `\\n`, which no `.replace(/\\n/g, …)` can undo.
    const { privateKey } = generate();
    const mangled = privateKey.replace(/\n/g, '\\\\n');

    const escaped = await withKeyVariable({ GOOGLE_PRIVATE_KEY: mangled });
    expect((await interceptToken(escaped, () => get(escaped))).res.status).toBe(502);

    const encoded = await withKeyVariable({
      GOOGLE_PRIVATE_KEY_BASE64: Buffer.from(privateKey, 'utf8').toString('base64'),
    });
    expect((await interceptToken(encoded, () => get(encoded))).res.status).toBe(200);
  });

  test('Base64 wins over the escaped variable when both are set', async () => {
    // Migration order: the new variable is added while the old, broken one is
    // still there. If the old one won, adding the new one would fix nothing.
    const { privateKey, publicKey } = generate();
    const h = await withKeyVariable({
      GOOGLE_PRIVATE_KEY: 'not-a-key-and-not-shaped-like-one',
      GOOGLE_PRIVATE_KEY_BASE64: Buffer.from(privateKey, 'utf8').toString('base64'),
    });

    const { res, posted } = await interceptToken(h, () => get(h));
    expect(res.status).toBe(200);
    const [header, claim, signature] = posted[0].split('.');
    expect(
      crypto.verify(
        'RSA-SHA256', Buffer.from(`${header}.${claim}`), publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
  });

  test('either variable alone is enough to count as configured', async () => {
    for (const variables of [
      { GOOGLE_PRIVATE_KEY: 'not-a-key-and-not-shaped-like-one' },
      { GOOGLE_PRIVATE_KEY_BASE64: Buffer.from('not-a-key-either').toString('base64') },
    ]) {
      const h = await withKeyVariable(variables);
      // Both reach Google and fail there (neither is a key) rather than
      // reporting the variable as absent — 502, not `configured: false`.
      expect((await interceptToken(h, () => get(h))).res.status).toBe(502);
    }

    const neither = await withKeyVariable({});
    const body = await (await get(neither)).json();
    expect(body.configured).toBe(false);
    expect(body.missing).toEqual(['GOOGLE_PRIVATE_KEY']);
  });

  test('an unusable key fails before anything is sent to Google', async () => {
    // Validation is ahead of the signature, so a mistyped variable costs one
    // log line rather than a request carrying a malformed assertion.
    const h = await withKeyVariable({
      GOOGLE_PRIVATE_KEY_BASE64: Buffer.from('this decodes cleanly and is still not a key')
        .toString('base64'),
    });

    const { res, posted } = await interceptToken(h, () => get(h));
    expect(res.status).toBe(502);
    expect(posted).toEqual([]);
  });

  test('nothing about either variable is logged, or answered', async () => {
    /**
     * The rule the whole feature is under: a key that fails to parse is a
     * configuration fault, and a configuration fault is a sentence — never a
     * prefix, a length, a fragment or an OpenSSL dump of the value.
     */
    const { privateKey } = generate();
    const encoded = Buffer.from(privateKey, 'utf8').toString('base64');
    // Truncated rather than appended to: extra bytes AFTER a PEM's footer are
    // ignored by the parser, so a "corrupted" key that still ends in
    // `-----END PRIVATE KEY-----` is a key. Cutting the tail off takes the
    // footer with it, which is the half-pasted value this is standing in for.
    const corrupted = encoded.slice(0, Math.floor(encoded.length / 2));
    const h = await withKeyVariable({ GOOGLE_PRIVATE_KEY_BASE64: corrupted });

    const real = console.error;
    const logged: string[] = [];
    console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };

    let text = '';
    try {
      const { res } = await interceptToken(h, () => get(h));
      expect(res.status).toBe(502);
      text = await res.text();
    } finally {
      console.error = real;
    }

    const said = logged.join('\n');
    expect(said).toContain('not valid PEM after normalization');
    for (const secret of [encoded, corrupted, privateKey, 'BEGIN PRIVATE KEY']) {
      expect(said, 'the log carries the credential').not.toContain(secret);
      expect(text, 'the response carries the credential').not.toContain(secret);
    }
    // Nor a fragment of one: sixteen characters of a Base64 key is still key
    // material, and is the shape a "just log the first few chars to debug it"
    // fix takes.
    expect(said).not.toContain(encoded.slice(0, 16));
    expect(JSON.parse(text).code).toBe('UPSTREAM_FAILED');
  });
});

/* =========================================================== 8. the cache == */

test.describe('the cache', () => {
  test('a second request inside the TTL does not call Google', async () => {
    const { h, fixture } = await ready();

    const first = await (await get(h)).json();
    const calls = fixture.calls.length;
    const second = await (await get(h)).json();

    expect(calls).toBeGreaterThan(0);
    expect(fixture.calls.length).toBe(calls);
    expect(second.cached).toBe(true);
    expect(first.cached).toBe(false);
    expect(second.data.overview).toEqual(first.data.overview);
  });

  test('nine sections cost four Google calls, not twelve', async () => {
    // The reason `collect` batches at all. A fetch per widget would be twelve
    // round trips and twelve times the property quota for one page load.
    const { h, fixture } = await ready();
    await get(h);

    expect(fixture.calls.filter((c) => c === 'batchRunReports').length).toBe(3);
    expect(fixture.calls.filter((c) => c === 'runRealtimeReport').length).toBe(2);
  });

  test('each range is cached separately', async () => {
    // One shared entry would serve 7-day figures to someone who asked for 90.
    const { h, fixture } = await ready();

    await get(h, 'https://x/api/portal-analytics?range=7d');
    const after7 = fixture.calls.length;
    const ninety = await (await get(h, 'https://x/api/portal-analytics?range=90d')).json();

    expect(fixture.calls.length).toBeGreaterThan(after7);
    expect(ninety.cached).toBe(false);
    expect(ninety.data.range).toBe('90d');
  });

  test('realtime has a shorter life than the report it travels with', async () => {
    /**
     * A realtime panel served from a five-minute cache is not realtime, and a
     * fresh realtime call on every report miss is a call the quota does not
     * need. So the two are cached apart: changing the range refetches the
     * report and reuses the realtime panel.
     */
    const { h, fixture } = await ready();
    await get(h, 'https://x/api/portal-analytics?range=7d');
    const realtimeCalls = fixture.calls.filter((c) => c === 'runRealtimeReport').length;

    const other = await (await get(h, 'https://x/api/portal-analytics?range=90d')).json();
    expect(other.cached).toBe(false);
    expect(other.realtimeCached).toBe(true);
    expect(fixture.calls.filter((c) => c === 'runRealtimeReport').length).toBe(realtimeCalls);
    expect(other.data.realtime.byPage.length).toBeGreaterThan(0);
  });

  test('an expired entry is refetched', async () => {
    const { h, fixture } = await ready();

    await get(h);
    const calls = fixture.calls.length;
    h.__cache.ttlMs = -1;          // everything written from here is already stale
    h.__cache.realtimeTtlMs = -1;
    h.__cache.clear();
    const again = await (await get(h)).json();

    expect(fixture.calls.length).toBeGreaterThan(calls);
    expect(again.cached).toBe(false);
  });

  test('a cached payload is still refused to an account that may not read it', async () => {
    // The cache must sit behind the guards, not in front of them.
    const { h } = await ready();
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
    const { h } = await ready();

    const bodies = [
      await (await get(h)).text(),
      await (await get(h, 'https://x/api/portal-analytics?range=7d')).text(),
      await (await get(h, 'https://x/api/portal-analytics?environment=all')).text(),
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

  test('the response carries no personal data, because it carries no rows', async () => {
    /**
     * The structural argument, asserted.
     *
     * Every field in this payload is a COUNT or a low-cardinality dimension
     * GA4 itself defines — a path, a medium, a device category. There is no
     * user id, no client id, no IP and no free text, because the endpoint never
     * asks for a dimension that could carry one: `userId`, `clientId`,
     * `streamId` and the geo dimensions below city are absent from every
     * request in `collect`.
     *
     * This test is the guard on that, and it is on the REQUESTS rather than on
     * the responses — a response can only contain what a request asked for, so
     * checking the requests is checking the whole surface rather than one
     * fixture's worth of it.
     */
    const { h, fixture } = await ready();
    await get(h);

    const asked = JSON.stringify(fixture.bodies);
    for (const forbidden of [
      'userId', 'clientId', 'userAgeBracket', 'userGender',
      'city', 'latitude', 'longitude', 'streamId',
    ]) {
      expect(asked, `the endpoint asked GA4 for ${forbidden}`).not.toContain(forbidden);
    }
  });

  test('the response is marked private and uncacheable', async () => {
    const { h } = await ready();
    const cc = (await get(h)).headers.get('cache-control') || '';
    expect(cc).toContain('private');
    expect(cc).toContain('no-store');
  });

  test('no request leaves this process when the seams are mocked', async () => {
    // The guarantee the whole file depends on, asserted rather than assumed.
    const { h } = await ready();

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
      expect(body, `${rel} names the service account variable`).not.toContain('GOOGLE_SERVICE_ACCOUNT_EMAIL');
      expect(body, `${rel} carries a service account address`).not.toContain('gserviceaccount');
      expect(body, `${rel} reaches the Data API directly`).not.toContain('analyticsdata.googleapis.com');
      expect(body, `${rel} reaches Google's token endpoint`).not.toContain('oauth2.googleapis.com');
    }
  });
});
