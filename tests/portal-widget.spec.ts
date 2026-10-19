import { test, expect } from '@playwright/test';

/**
 * netlify/functions/portal-widget.mjs — the summary the Stratos app and its
 * widgets read — against a MOCKED Supabase (GoTrue and PostgREST answers
 * scripted below). What it proves: that only a live session gets in, that the
 * owner gets the Today page in brief and a client their own projects, that
 * every read runs as the caller with the public key (never the server key),
 * that "today" is Budapest's day, and that a failed read is a 502 rather than
 * a summary with holes. What it does not prove: that the real tables answer
 * these filters as scripted — the same reads are the Today page's
 * (portal/src/lib/notes.ts) and the client portal's functions.
 */

type Handler = {
  default: (r: Request) => Promise<Response>;
  __net: { fetch: typeof fetch };
  dayOf: (at: Date) => string;
  startOf: (day: string) => Date;
};

const ENV = {
  SUPABASE_URL: 'https://mock.supabase.invalid',
  SUPABASE_ANON_KEY: 'public-key',
  SUPABASE_SECRET_KEY: 'server-key-that-must-never-be-used',
};
const KEYS = [...Object.keys(ENV), 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const ORIGIN = 'https://stratosweb.hu';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [P1, P2, DEMO] = [201, 202, 401].map(id);

let serial = 0;
async function load(env: Record<string, string | undefined> = ENV): Promise<Handler> {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  serial += 1;
  return (await import(`../netlify/functions/portal-widget.mjs?case=${serial}`)) as unknown as Handler;
}

interface Call { method: string; path: string; query: URLSearchParams; auth: string; apikey: string; prefer: string }
type Rows = Record<string, unknown>[];
interface World { calls: Call[]; tables: Record<string, Rows | Response>; leads: number }

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const world = (tables: World['tables'] = {}, leads = 0): World => ({ calls: [], tables, leads });

function backend(w: World): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const h = new Headers(init?.headers);
    const c: Call = {
      method: init?.method ?? 'GET', path: url.pathname, query: url.searchParams,
      auth: h.get('authorization') ?? '', apikey: h.get('apikey') ?? '', prefer: h.get('prefer') ?? '',
    };
    w.calls.push(c);
    const who = { 'Bearer owner-jwt': 'owner', 'Bearer client-jwt': 'client', 'Bearer staff-jwt': 'staff' }[c.auth];
    if (c.path === '/auth/v1/user') return who ? reply(200, { id: 'u' }) : reply(401, { msg: 'invalid JWT' });
    if (!who) return reply(401, { message: 'JWT expired' });
    if (c.path === '/rest/v1/rpc/is_owner') return reply(200, who === 'owner');
    if (c.path === '/rest/v1/rpc/client_portal_me') {
      return reply(200, who === 'client' ? [{ full_name: 'Kiss Anna', company: 'Rapidkert Kft.' }] : []);
    }
    if (c.path === '/rest/v1/leads') return reply(200, [], { 'content-range': `0-0/${w.leads}` });
    const name = c.path.replace('/rest/v1/', '').replace('rpc/', '');
    // Two reads of project_meetings: today's list, and the next one (limit 1).
    const key = name === 'project_meetings' && c.query.get('limit') === '1' ? 'project_meetings.next' : name;
    const t = w.tables[key];
    if (t instanceof Response) return t;
    return reply(200, t ?? []);
  }) as typeof fetch;
}

const get = (h: Handler, token: string | null = 'owner-jwt', method = 'GET') =>
  h.default(new Request(`${ORIGIN}/api/widget`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} }));

test.describe('the door', () => {
  test('no token: 401, and Supabase is not asked', async () => {
    const h = await load();
    const w = world();
    h.__net.fetch = backend(w);
    const res = await get(h, null);
    expect(res.status).toBe(401);
    expect(w.calls).toHaveLength(0);
  });

  test('an expired or revoked token: 401, and no data is read', async () => {
    const h = await load();
    const w = world();
    h.__net.fetch = backend(w);
    const res = await get(h, 'stale-jwt');
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('UNAUTHENTICATED');
    const data = w.calls.filter((c) => !['/auth/v1/user', '/rest/v1/rpc/is_owner', '/rest/v1/rpc/client_portal_me'].includes(c.path));
    expect(data).toHaveLength(0);
  });

  test('staff who are not the owner: 403, and no data is read', async () => {
    const h = await load();
    const w = world();
    h.__net.fetch = backend(w);
    const res = await get(h, 'staff-jwt');
    expect(res.status).toBe(403);
    expect(w.calls.map((c) => c.path).sort()).toEqual(['/auth/v1/user', '/rest/v1/rpc/client_portal_me', '/rest/v1/rpc/is_owner']);
  });

  test('not configured: 503, never a crash', async () => {
    const h = await load({});
    expect((await get(h)).status).toBe(503);
  });

  test('only GET; OPTIONS answers the preflight of the web build', async () => {
    const h = await load();
    h.__net.fetch = backend(world());
    expect((await get(h, 'owner-jwt', 'POST')).status).toBe(405);
    const pre = await get(h, null, 'OPTIONS');
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toBe('authorization');
  });

  test('Supabase unreachable: 503', async () => {
    const h = await load();
    h.__net.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    expect((await get(h)).status).toBe(503);
  });
});

test.describe('the owner', () => {
  test('the Today page in brief: counts, late lines first, next meeting, new leads', async () => {
    const h = await load();
    const today = h.dayOf(new Date());
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const later = new Date(Date.now() + 86_400_000).toISOString();
    const w = world({
      note_items: [
        { id: 't1', text: 'Szövegek a Rapidkertnek', due_on: '2020-01-02', note: { title: 'Teendők', client: { name: 'Rapidkert' } } },
        { id: 't2', text: 'Számla kiküldése', due_on: today, note: { title: 'Teendők', client: null } },
      ],
      opportunities: [{ id: 'o1', title: 'Webshop', next_action: 'Visszahívni', next_action_on: today, company_name: 'Barbershop' }],
      project_milestones: [{ id: 'c1', title: 'Demó', due_on: '2020-01-01', project: { name: 'GoDataFusion' } }],
      project_meetings: [{ id: 'm1', title: 'Heti egyeztetés', starts_at: soon, project: { name: 'Mentáltréning' } }],
      automation_alerts: [{ id: 'a1', kind: 'lead', title: 'Válaszra vár egy lead', due_on: null, created_at: soon }],
      'project_meetings.next': [{ title: 'Heti egyeztetés', starts_at: soon, join_url: 'https://meet.google.com/abc-defg-hij', project: { name: 'Mentáltréning' } }],
      bookings: [{ guest_name: 'Nagy Péter', starts_at: later, meet_url: null }],
    }, 4);
    h.__net.fetch = backend(w);

    const res = await get(h);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true, kind: 'owner', day: today, newLeads: 4,
      today: { total: 6, late: 2, tasks: 2, followUps: 1, checkpoints: 1, meetings: 1, alerts: 1 },
      nextMeeting: { kind: 'meeting', title: 'Heti egyeztetés', detail: 'Mentáltréning', startsAt: soon },
    });
    expect(body.items.map((i: { kind: string }) => i.kind)).toEqual(['checkpoint', 'task', 'alert', 'task', 'followUp', 'meeting']);
    expect(body.items[1]).toMatchObject({ title: 'Szövegek a Rapidkertnek', detail: 'Rapidkert', late: true });
    // A quick task's checklist ("Teendők") is not worth a line of its own.
    expect(body.items[3]).toMatchObject({ kind: 'task', title: 'Számla kiküldése', detail: null });
    expect(body.items[4]).toMatchObject({ title: 'Visszahívni', detail: 'Barbershop', late: false });

    // Every read as the owner, with the public key; the server key never leaves the environment.
    for (const c of w.calls) {
      expect(c.apikey).toBe(ENV.SUPABASE_ANON_KEY);
      expect(c.auth).toBe('Bearer owner-jwt');
    }
    const tasks = w.calls.find((c) => c.path === '/rest/v1/note_items')!;
    expect(tasks.query.getAll('due_on')).toEqual(['not.is.null', `lte.${today}`]);
    const leads = w.calls.find((c) => c.path === '/rest/v1/leads')!;
    expect(leads.prefer).toBe('count=exact');
    expect(leads.query.get('trashed_at')).toBe('is.null');
  });

  test('a booked call sooner than any meeting is the next one', async () => {
    const h = await load();
    const soon = new Date(Date.now() + 600_000).toISOString();
    const later = new Date(Date.now() + 7_200_000).toISOString();
    h.__net.fetch = backend(world({
      'project_meetings.next': [{ title: 'Heti egyeztetés', starts_at: later, join_url: null, project: null }],
      bookings: [{ guest_name: 'Nagy Péter', starts_at: soon, meet_url: 'https://meet.google.com/abc-defg-hij' }],
    }));
    const body = await (await get(h)).json();
    expect(body.nextMeeting).toEqual({ kind: 'booking', title: 'Nagy Péter', detail: null, startsAt: soon, joinUrl: 'https://meet.google.com/abc-defg-hij' });
  });

  test('at most eight lines, with the totals still whole', async () => {
    const h = await load();
    const today = h.dayOf(new Date());
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, text: `Feladat ${i}`, due_on: today, note: null }));
    h.__net.fetch = backend(world({ note_items: many }));
    const body = await (await get(h)).json();
    expect(body.items).toHaveLength(8);
    expect(body.today.total).toBe(12);
  });

  test('before the alerts and bookings migrations: no alerts, no booked calls, not an error', async () => {
    const h = await load();
    const missing = () => reply(404, { code: 'PGRST205', message: 'Could not find the table' });
    h.__net.fetch = backend(world({ automation_alerts: missing(), bookings: missing() }));
    const res = await get(h);
    expect(res.status).toBe(200);
    expect((await res.json()).today.alerts).toBe(0);
  });

  test('any other failed read: 502, not a summary with holes', async () => {
    const h = await load();
    h.__net.fetch = backend(world({ opportunities: reply(500, { code: 'XX000', message: 'boom' }) }));
    const res = await get(h);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('boom');
  });
});

test.describe('a client', () => {
  test('their projects, what Stratos waits on them for, and their next meeting', async () => {
    const h = await load();
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const w = world({
      client_portal_projects: [{ project_id: P1, project_name: 'Rapidkert weboldal' }, { project_id: P2, project_name: 'Rapidkert webshop' }],
      client_portal_requests: [
        { request_id: 'r1', project_id: P1, title: 'Fotók feltöltése', due_on: '2020-01-01', done_at: null },
        { request_id: 'r2', project_id: P2, title: 'Szövegek', due_on: null, done_at: null },
        { request_id: 'r3', project_id: P1, title: 'Logó', due_on: null, done_at: past },
      ],
      client_portal_approvals: [
        { demo_id: DEMO, project_id: P1, requested_at: past, state: null },
        { demo_id: id(402), project_id: P1, requested_at: past, state: 'approved' },
      ],
      client_portal_demos: [{ demo_id: DEMO, project_id: P1, project_name: 'Rapidkert weboldal', title: 'Főoldal v2' }],
      client_portal_meetings: [
        { meeting_id: 'm0', project_name: 'Rapidkert weboldal', title: 'Lemondva', starts_at: soon, join_url: null, cancelled: true },
        { meeting_id: 'm1', project_name: 'Rapidkert weboldal', title: 'Átadás', starts_at: soon, join_url: 'https://meet.google.com/abc-defg-hij', cancelled: false },
      ],
      client_portal_bookings: [],
    });
    h.__net.fetch = backend(w);

    const res = await get(h, 'client-jwt');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true, kind: 'client',
      me: { name: 'Kiss Anna', company: 'Rapidkert Kft.' },
      projects: [{ id: P1, name: 'Rapidkert weboldal' }, { id: P2, name: 'Rapidkert webshop' }],
      waitingOnYou: { total: 3, requests: 2, approvals: 1 },
      nextMeeting: { kind: 'meeting', title: 'Átadás', detail: 'Rapidkert weboldal', joinUrl: 'https://meet.google.com/abc-defg-hij' },
    });
    expect(body.items).toEqual([
      { kind: 'approval', title: 'Főoldal v2', detail: 'Rapidkert weboldal', due: null, late: false },
      { kind: 'request', title: 'Fotók feltöltése', detail: 'Rapidkert weboldal', due: '2020-01-01', late: true },
      { kind: 'request', title: 'Szövegek', detail: 'Rapidkert webshop', due: null, late: false },
    ]);

    // Only the client portal's own functions, as the client: no table is read directly.
    for (const c of w.calls.filter((x) => x.path !== '/auth/v1/user')) {
      expect(c.path).toMatch(/^\/rest\/v1\/rpc\/(is_owner|client_portal_[a-z_]+)$/);
      expect(c.auth).toBe('Bearer client-jwt');
    }
  });
});

test.describe('the day', () => {
  test('is Budapest\'s, across both clock changes', async () => {
    const h = await load();
    // 23:30 UTC on 19 October is already the 20th in Budapest (CEST, +2).
    expect(h.dayOf(new Date('2026-10-19T23:30:00Z'))).toBe('2026-10-20');
    expect(h.startOf('2026-10-20').toISOString()).toBe('2026-10-19T22:00:00.000Z');
    // The clocks go back at 01:00 UTC on 25 October: that day starts in summer time, the next in winter time.
    expect(h.startOf('2026-10-25').toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(h.startOf('2026-10-26').toISOString()).toBe('2026-10-25T23:00:00.000Z');
    // And forward at 01:00 UTC on 29 March 2026.
    expect(h.startOf('2026-03-29').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(h.startOf('2026-03-30').toISOString()).toBe('2026-03-29T22:00:00.000Z');
  });
});
