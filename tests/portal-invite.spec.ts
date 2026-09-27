import { test, expect } from '@playwright/test';

/**
 * netlify/functions/portal-invite.mjs against a MOCKED Supabase (GoTrue admin
 * and PostgREST answers scripted below). What it proves: the order of the
 * steps, who may call it, that a refusal happens before any auth user exists,
 * that a partial failure returns no link and a retry duplicates nothing, and
 * that the link is returned once and logged nowhere. What it does not prove:
 * that real GoTrue behaves as scripted — that is
 * scripts/client-portal-live-check.mjs, against a local Supabase.
 */

type Handler = { default: (r: Request) => Promise<Response>; __net: { fetch: typeof fetch } };

const ENV = {
  SUPABASE_URL: 'https://mock.supabase.invalid',
  SUPABASE_SECRET_KEY: 'server-key-that-must-never-be-echoed',
  SUPABASE_ANON_KEY: 'public-key',
  PORTAL_ORIGIN: 'https://stratosweb.hu',
};
const KEYS = [...Object.keys(ENV), 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'URL'];
const ORG = '00000000-0000-4000-8000-000000000101';
const PROJECT = '00000000-0000-4000-8000-000000000201';
const ACCOUNT = '00000000-0000-4000-8000-000000000301';

let serial = 0;
async function load(env: Record<string, string | undefined> = ENV): Promise<Handler> {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  serial += 1;
  return (await import(`../netlify/functions/portal-invite.mjs?case=${serial}`)) as unknown as Handler;
}

interface World {
  owner: boolean;
  profiles: { id: string; email: string; role: string; organization_id: string | null }[];
  confirmed: Set<string>;
  prepareError?: string;
  attachFailures: number;
  linkedUser: string | null;
  calls: string[];
  created: number;
}
const world = (over: Partial<World> = {}): World => ({
  owner: true, profiles: [], confirmed: new Set(), attachFailures: 0, linkedUser: null, calls: [], created: 0, ...over,
});

function backend(w: World): typeof fetch {
  const reply = (status: number, body: unknown) => (status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace(ENV.SUPABASE_URL, '');
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const auth = new Headers(init?.headers).get('authorization') ?? '';
    w.calls.push(`${init?.method ?? 'GET'} ${path.split('?')[0]}`);
    if (path === '/auth/v1/user') return auth === 'Bearer owner-jwt' || auth === 'Bearer other-jwt' ? reply(200, { id: 'u' }) : reply(401, {});
    if (path === '/rest/v1/rpc/is_owner') return reply(200, auth === 'Bearer owner-jwt' && w.owner);
    if (path === '/rest/v1/rpc/client_invite_prepare') {
      if (w.prepareError) return reply(400, { code: 'P0001', message: `stratos:${w.prepareError}` });
      return reply(200, [{ account_id: ACCOUNT, user_id: w.linkedUser, email: body.p_email }]);
    }
    if (path.startsWith('/rest/v1/profiles')) {
      const email = decodeURIComponent(path.split('email=ilike.')[1].split('&')[0]).replace(/\\(.)/g, '$1');
      return reply(200, w.profiles.filter((p) => p.email === email));
    }
    if (path === '/auth/v1/admin/generate_link') {
      let user = w.profiles.find((p) => p.email === body.email);
      if (!user) {
        if (body.type !== 'invite') return reply(404, { error_code: 'user_not_found' });
        user = { id: `user-${++w.created}`, email: body.email, role: 'client', organization_id: null };
        w.profiles.push(user);
      } else if (body.type === 'invite' && w.confirmed.has(user.id)) {
        return reply(422, { error_code: 'email_exists' });
      }
      return reply(200, { id: user.id, user: { id: user.id }, properties: { hashed_token: `hash-${w.calls.length}`, verification_type: body.type } });
    }
    if (path.startsWith('/auth/v1/admin/users/')) {
      const id = decodeURIComponent(path.split('/').pop()!);
      return reply(200, { id, email_confirmed_at: w.confirmed.has(id) ? '2026-09-01' : null });
    }
    if (path === '/rest/v1/rpc/client_invite_attach') {
      if (w.attachFailures > 0) { w.attachFailures -= 1; return reply(503, { message: 'connection failure' }); }
      const prof = w.profiles.find((p) => p.id === body.p_user);
      if (!prof || prof.role !== 'client') return reply(400, { code: 'P0001', message: 'stratos:client_email_is_staff' });
      w.linkedUser = body.p_user;
      return reply(204, null);
    }
    return reply(404, {});
  }) as typeof fetch;
}

const post = (h: Handler, body: unknown, token = 'owner-jwt') => h.default(new Request('https://stratosweb.hu/api/portal-invite', {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
}));
const INPUT = { organization_id: ORG, full_name: 'Kovács Anna', email: 'Anna@A.example', project_ids: [PROJECT] };

function captureConsole() {
  const lines: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(orig) as (keyof typeof orig)[]) console[k] = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  return { lines, restore: () => Object.assign(console, orig) };
}

test.describe('who may invite', () => {
  test('POST only, a token, and the owner', async () => {
    const h = await load();
    const w = world();
    h.__net.fetch = backend(w);
    expect((await h.default(new Request('https://x/api/portal-invite'))).status).toBe(405);
    expect((await post(h, INPUT, '')).status).toBe(401);
    expect((await post(h, INPUT, 'forged')).status).toBe(401);
    expect((await post(h, INPUT, 'other-jwt')).status).toBe(403);
    expect(w.calls.some((c) => c.includes('generate_link') || c.includes('prepare'))).toBe(false);
  });

  test('not configured → 503, and nothing is called', async () => {
    const h = await load({ ...ENV, SUPABASE_SECRET_KEY: undefined });
    const w = world();
    h.__net.fetch = backend(w);
    expect((await post(h, INPUT)).status).toBe(503);
    expect(w.calls).toEqual([]);
  });

  test('bad input is refused before anything is called', async () => {
    const h = await load();
    const w = world();
    h.__net.fetch = backend(w);
    for (const bad of [{ ...INPUT, email: 'nope' }, { ...INPUT, organization_id: 'x' }, { ...INPUT, full_name: '' },
      { ...INPUT, project_ids: ['not-a-uuid'] }]) {
      expect((await post(h, bad)).status).toBe(422);
    }
    expect(w.calls).toEqual([]);
  });
});

test.describe('the invite', () => {
  test('a new client: prepare → create → attach → one invite link, in the fragment', async () => {
    const h = await load();
    const w = world();
    h.__net.fetch = backend(w);
    const out = captureConsole();
    const res = await post(h, INPUT);
    out.restore();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(body.kind).toBe('invite');
    expect(body.link).toMatch(/^https:\/\/stratosweb\.hu\/portal\/accept-invite#token_hash=hash-\d+&type=invite$/);
    expect(w.linkedUser).toBe('user-1');
    const order = w.calls.filter((c) => /prepare|generate_link|attach/.test(c));
    expect(order).toEqual(['POST /rest/v1/rpc/client_invite_prepare', 'POST /auth/v1/admin/generate_link', 'POST /rest/v1/rpc/client_invite_attach']);
    expect(out.lines.join('\n')).not.toMatch(/hash-|token_hash|accept-invite|server-key/);
  });

  test('a refusal (staff address, other company) happens before any auth user is created', async () => {
    for (const reason of ['client_email_is_staff', 'client_other_company', 'invite_limit']) {
      const h = await load();
      const w = world({ prepareError: reason });
      h.__net.fetch = backend(w);
      const res = await post(h, INPUT);
      expect(res.status, reason).toBeGreaterThanOrEqual(400);
      expect((await res.json()).code, reason).toBe({ client_email_is_staff: 'EMAIL_IS_STAFF', client_other_company: 'OTHER_COMPANY', invite_limit: 'INVITE_LIMIT' }[reason]);
      expect(w.created, reason).toBe(0);
    }
  });

  test('an existing staff profile is never attached, even if prepare let it through', async () => {
    const h = await load();
    const w = world({ profiles: [{ id: 'staff-1', email: 'anna@a.example', role: 'admin', organization_id: null }] });
    h.__net.fetch = backend(w);
    const res = await post(h, INPUT);
    expect((await res.json()).code).toBe('EMAIL_IS_STAFF');
    expect(w.linkedUser).toBeNull();
    expect(w.calls.some((c) => c.includes('generate_link'))).toBe(false);
  });

  test('attach fails: no link is returned; the retry reuses the user and finishes', async () => {
    const h = await load();
    const w = world({ attachFailures: 1 });
    h.__net.fetch = backend(w);
    const first = await post(h, INPUT);
    const firstBody = await first.json();
    expect(first.status).toBe(502);
    expect(firstBody.code).toBe('PARTIAL');
    expect(firstBody.link).toBeUndefined();
    expect(w.created).toBe(1);

    const second = await post(h, INPUT);
    const secondBody = await second.json();
    expect(second.status).toBe(200);
    expect(w.created).toBe(1);                                // no second auth user
    expect(w.linkedUser).toBe('user-1');
    expect(secondBody.kind).toBe('invite');                  // still unconfirmed
  });

  test('inviting again: an unconfirmed user gets a new invite link, a confirmed one a password link', async () => {
    const h = await load();
    const w = world();
    h.__net.fetch = backend(w);
    await post(h, INPUT);
    const again = await (await post(h, INPUT)).json();
    expect(again.kind).toBe('invite');
    w.confirmed.add('user-1');
    const later = await (await post(h, INPUT)).json();
    expect(later.kind).toBe('recovery');
    expect(later.link).toContain('type=recovery');
    expect(w.created).toBe(1);
  });

  test('no response or log ever carries the server key', async () => {
    const h = await load();
    const w = world();
    h.__net.fetch = backend(w);
    const out = captureConsole();
    const texts = [await (await post(h, INPUT)).text(), await (await post(h, INPUT, 'other-jwt')).text()];
    out.restore();
    expect(texts.join(' ') + out.lines.join(' ')).not.toContain(ENV.SUPABASE_SECRET_KEY);
  });
});

test.describe('two invitations of one new address at once', () => {
  test('the one that loses the create race uses the user the other made, and succeeds', async () => {
    const h = await load();
    const w = world();
    const real = backend(w);
    // GoTrue as observed on a real local stack: the second create of the same
    // e-mail answers 500 (unique violation) — by then the user exists.
    h.__net.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/auth/v1/admin/generate_link') && w.created === 0 && w.profiles.length === 0) {
        w.profiles.push({ id: 'user-raced', email: 'anna@a.example', role: 'client', organization_id: null });
        return new Response(JSON.stringify({ code: '23505' }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
      return real(input, init);
    }) as typeof fetch;
    const res = await post(h, INPUT);
    expect(res.status).toBe(200);
    expect(w.linkedUser).toBe('user-raced');
    expect((await res.json()).link).toMatch(/#token_hash=/);
  });
});
