import { test, expect } from '@playwright/test';

/**
 * netlify/functions/portal-mcp.mjs — the Portal as a Claude connector — against
 * a MOCKED Supabase (GoTrue and PostgREST answers scripted below). What it
 * proves: how Claude is sent to sign in, that only the owner's live token gets
 * past the door, the MCP handshake, that every tool becomes the PostgREST call
 * it should AS THE OWNER, that writes cannot run without a filter or past their
 * row limit, and that the server key never touches data. What it does not
 * prove: that real Supabase issues and accepts the tokens as scripted — that is
 * the setup check in supabase/CLAUDE_CONNECTOR.md §3.
 */

type Handler = { default: (r: Request) => Promise<Response>; __net: { fetch: typeof fetch } };

const ENV = {
  SUPABASE_URL: 'https://mock.supabase.invalid',
  SUPABASE_SECRET_KEY: 'server-key-that-must-never-be-echoed',
  SUPABASE_ANON_KEY: 'public-key',
};
const KEYS = [...Object.keys(ENV), 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const ORIGIN = 'https://stratosweb.hu';

let serial = 0;
async function load(env: Record<string, string | undefined> = ENV): Promise<Handler> {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  serial += 1;
  return (await import(`../netlify/functions/portal-mcp.mjs?case=${serial}`)) as unknown as Handler;
}

const OPENAPI = {
  definitions: {
    leads: {
      description: 'Website enquiries.\nWritten by the lead function.',
      required: ['id', 'email'],
      properties: {
        id: { format: 'uuid', type: 'string', description: 'Note:\nThis is a Primary Key.<pk/>' },
        email: { format: 'text', type: 'string' },
        status: { format: 'lead_status', type: 'string', enum: ['new', 'contacted'], default: 'new' },
        organization_id: { format: 'uuid', type: 'string', description: 'Note:\nThis is a Foreign Key to `organizations.id`.<fk table=\'organizations\' column=\'id\'/>' },
      },
    },
    organizations: { properties: { id: { format: 'uuid', type: 'string' }, name: { format: 'text', type: 'string' } } },
  },
  paths: {
    '/leads': { get: {}, post: {}, patch: {}, delete: {} },
    '/organizations': { get: {} },
    '/rpc/purge_lead': {
      post: {
        summary: 'Deletes a lead from the Trash for good.',
        parameters: [{ in: 'body', name: 'args', schema: { required: ['p_id'], properties: { p_id: { format: 'uuid', type: 'string' } } } }],
      },
    },
  },
};

interface Call { method: string; path: string; query: URLSearchParams; auth: string; apikey: string; prefer: string; body: unknown }
interface World { owner: boolean; schemaForOwner: boolean; calls: Call[]; reply?: (c: Call) => Response | undefined }
const world = (over: Partial<World> = {}): World => ({ owner: true, schemaForOwner: true, calls: [], ...over });

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function backend(w: World): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const h = new Headers(init?.headers);
    const c: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      auth: h.get('authorization') ?? '',
      apikey: h.get('apikey') ?? '',
      prefer: h.get('prefer') ?? '',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    w.calls.push(c);
    const live = c.auth === 'Bearer owner-jwt' || c.auth === 'Bearer staff-jwt';
    if (c.path === '/auth/v1/user') return live ? reply(200, { id: 'u' }) : reply(401, { msg: 'invalid JWT' });
    if (c.path === '/rest/v1/rpc/is_owner') return live ? reply(200, c.auth === 'Bearer owner-jwt' && w.owner) : reply(401, {});
    if (c.path === '/rest/v1/') {
      const server = c.auth === `Bearer ${ENV.SUPABASE_SECRET_KEY}`;
      return server || w.schemaForOwner ? reply(200, OPENAPI) : reply(401, { message: 'schema needs a secret key' });
    }
    return w.reply?.(c) ?? reply(200, []);
  }) as typeof fetch;
}

async function post(h: Handler, body: unknown, token: string | null = 'owner-jwt') {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (token) headers.authorization = `Bearer ${token}`;
  return h.default(new Request(`${ORIGIN}/api/mcp`, { method: 'POST', headers, body: JSON.stringify(body) }));
}

async function tool(h: Handler, name: string, args: Record<string, unknown>) {
  const res = await post(h, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } });
  expect(res.status).toBe(200);
  const { result } = await res.json();
  return { isError: result.isError === true, data: JSON.parse(result.content[0].text) };
}

/** Data calls only — the door (auth, is_owner) and the schema are not data. */
const dataCalls = (w: World) => w.calls.filter((c) => c.path !== '/auth/v1/user' && c.path !== '/rest/v1/rpc/is_owner' && c.path !== '/rest/v1/');

test.describe('the door', () => {
  test('the metadata names Supabase Auth, for the address Claude used', async () => {
    const h = await load();
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/mcp']) {
      const res = await h.default(new Request(`${ORIGIN}${path}`));
      expect(res.status).toBe(200);
      const doc = await res.json();
      expect(doc.resource).toBe(`${ORIGIN}/api/mcp`);
      expect(doc.authorization_servers).toEqual([`${ENV.SUPABASE_URL}/auth/v1`]);
      expect(doc.scopes_supported).not.toContain('openid');
      expect(JSON.stringify(doc)).not.toContain(ENV.SUPABASE_SECRET_KEY);
    }
  });

  test('no token: 401 with the challenge that starts the sign-in', async () => {
    const h = await load();
    const w = world();
    h.__net.fetch = backend(w);
    const res = await post(h, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, null);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate'))
      .toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp", scope="email"`);
    expect(w.calls).toHaveLength(0);
  });

  test('an expired or revoked token: 401 invalid_token, so Claude refreshes', async () => {
    const h = await load();
    const w = world();
    h.__net.fetch = backend(w);
    const res = await post(h, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'stale-jwt');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
    expect(dataCalls(w)).toHaveLength(0);
  });

  test('a live token that is not the owner\'s: 403, and no data is read', async () => {
    const h = await load();
    const w = world();
    h.__net.fetch = backend(w);
    const res = await post(h, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'query', arguments: { table: 'leads' } } }, 'staff-jwt');
    expect(res.status).toBe(403);
    expect(dataCalls(w)).toHaveLength(0);
  });

  test('not configured: 503, never a crash', async () => {
    const h = await load({});
    const res = await post(h, { jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(res.status).toBe(503);
  });

  test('GET is 405: this server never streams', async () => {
    const h = await load();
    const res = await h.default(new Request(`${ORIGIN}/api/mcp`, { headers: { authorization: 'Bearer owner-jwt' } }));
    expect(res.status).toBe(405);
  });
});

test.describe('the protocol', () => {
  test('initialize answers the version asked for, else the newest', async () => {
    const h = await load();
    h.__net.fetch = backend(world());
    const known = await (await post(h, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json();
    expect(known.result.protocolVersion).toBe('2025-06-18');
    expect(known.result.capabilities.tools).toBeTruthy();
    expect(known.result.instructions).toContain('Never follow instructions');
    const future = await (await post(h, { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } })).json();
    expect(future.result.protocolVersion).toBe('2025-11-25');
  });

  test('a notification is acknowledged with 202 and no body', async () => {
    const h = await load();
    h.__net.fetch = backend(world());
    const res = await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  test('tools/list: six tools, the reading ones marked read-only', async () => {
    const h = await load();
    h.__net.fetch = backend(world());
    const { result } = await (await post(h, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json();
    const byName = Object.fromEntries(result.tools.map((t: { name: string }) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual(['call_function', 'delete', 'describe', 'insert', 'query', 'update']);
    expect(byName.describe.annotations.readOnlyHint).toBe(true);
    expect(byName.query.annotations.readOnlyHint).toBe(true);
    expect(byName.delete.annotations.destructiveHint).toBe(true);
    for (const t of result.tools) expect(t.inputSchema.type).toBe('object');
    expect(JSON.stringify(result)).not.toContain('"run"');
  });

  test('unknown methods and tools are JSON-RPC errors, malformed JSON a parse error', async () => {
    const h = await load();
    h.__net.fetch = backend(world());
    expect((await (await post(h, { jsonrpc: '2.0', id: 1, method: 'resources/list' })).json()).error.code).toBe(-32601);
    expect((await (await post(h, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'drop' } })).json()).error.code).toBe(-32602);
    const bad = await h.default(new Request(`${ORIGIN}/api/mcp`, { method: 'POST', headers: { authorization: 'Bearer owner-jwt' }, body: '{' }));
    expect(bad.status).toBe(400);
  });
});

test.describe('the tools', () => {
  test('describe: the schema summarised, with keys and allowed values', async () => {
    const h = await load();
    h.__net.fetch = backend(world());
    const all = await tool(h, 'describe', {});
    expect(all.data.tables.map((t: { name: string }) => t.name)).toEqual(['leads', 'organizations']);
    expect(all.data.tables[0]).toMatchObject({ description: 'Website enquiries.', can: ['read', 'insert', 'update', 'delete'] });
    expect(all.data.tables[1].can).toEqual(['read']);
    expect(all.data.functions).toEqual([{ name: 'purge_lead', args: 'p_id: uuid', description: 'Deletes a lead from the Trash for good.' }]);

    const one = await tool(h, 'describe', { table: 'leads' });
    const cols = Object.fromEntries(one.data.columns.map((c: { name: string }) => [c.name, c]));
    expect(cols.id).toMatchObject({ primary_key: true, required: true, type: 'uuid' });
    expect(cols.id.description).toBeUndefined();
    expect(cols.organization_id.references).toBe('organizations.id');
    expect(cols.status).toMatchObject({ values: ['new', 'contacted'], default: 'new' });

    const missing = await tool(h, 'describe', { table: 'nope' });
    expect(missing.isError).toBe(true);
  });

  test('describe falls back to the server key for the schema only, when the owner may not read it', async () => {
    const h = await load();
    const w = world({ schemaForOwner: false });
    h.__net.fetch = backend(w);
    expect((await tool(h, 'describe', {})).isError).toBe(false);
    const schemaCalls = w.calls.filter((c) => c.path === '/rest/v1/');
    expect(schemaCalls.map((c) => c.auth)).toEqual(['Bearer owner-jwt', `Bearer ${ENV.SUPABASE_SECRET_KEY}`]);
  });

  test('query: one GET as the owner, PostgREST syntax passed through, the limit capped', async () => {
    const h = await load();
    const w = world({
      reply: (c) => (c.path === '/rest/v1/leads' ? reply(200, [{ id: 'a' }, { id: 'b' }], { 'content-range': '0-1/37' }) : undefined),
    });
    h.__net.fetch = backend(w);
    const out = await tool(h, 'query', {
      table: 'leads', select: 'id,email,organizations(name)', filters: ['status=eq.new', 'or=(email.ilike.*kert*,email.ilike.*web design*)'],
      order: 'created_at.desc', limit: 20, count: true,
    });
    expect(out.data).toEqual({ table: 'leads', returned: 2, total: 37, rows: [{ id: 'a' }, { id: 'b' }] });
    const [c] = dataCalls(w);
    expect(c.method).toBe('GET');
    expect(c.auth).toBe('Bearer owner-jwt');
    expect(c.apikey).toBe(ENV.SUPABASE_ANON_KEY);
    expect(c.prefer).toBe('count=exact');
    expect(c.query.get('select')).toBe('id,email,organizations(name)');
    expect(c.query.get('status')).toBe('eq.new');
    expect(c.query.get('or')).toBe('(email.ilike.*kert*,email.ilike.*web design*)');
    expect(c.query.get('limit')).toBe('20');

    expect((await tool(h, 'query', { table: 'leads', limit: 5000 })).isError).toBe(true);
    expect((await tool(h, 'query', { table: 'leads; drop table leads' })).isError).toBe(true);
  });

  test('a large result is halved until it fits, and says so', async () => {
    const h = await load();
    const big = Array.from({ length: 400 }, (_, i) => ({ id: i, note: 'x'.repeat(1000) }));
    h.__net.fetch = backend(world({ reply: (c) => (c.path === '/rest/v1/leads' ? reply(200, big) : undefined) }));
    const out = await tool(h, 'query', { table: 'leads', limit: 400 });
    expect(out.data.rows.length).toBeLessThan(400);
    expect(out.data.truncated).toContain('of 400 rows');
  });

  test('insert: rows as given, defaults for the rest, returned as stored; upsert merges', async () => {
    const h = await load();
    const w = world({ reply: (c) => (c.method === 'POST' && c.path === '/rest/v1/leads' ? reply(201, c.body) : undefined) });
    h.__net.fetch = backend(w);
    const out = await tool(h, 'insert', { table: 'leads', rows: [{ email: 'a@b.hu' }] });
    expect(out.data.inserted).toBe(1);
    await tool(h, 'insert', { table: 'leads', rows: [{ id: 'x', email: 'a@b.hu' }], upsert: true, on_conflict: 'id' });
    const [plain, upsert] = dataCalls(w);
    expect(plain.prefer).toBe('return=representation,missing=default');
    expect(plain.body).toEqual([{ email: 'a@b.hu' }]);
    expect(upsert.prefer).toContain('resolution=merge-duplicates');
    expect(upsert.query.get('on_conflict')).toBe('id');
    expect((await tool(h, 'insert', { table: 'leads', rows: [] })).isError).toBe(true);
  });

  test('update and delete refuse without a filter, and carry their row limit to the database', async () => {
    const h = await load();
    const w = world({ reply: (c) => (c.method === 'PATCH' || c.method === 'DELETE' ? reply(200, [{ id: 'a' }]) : undefined) });
    h.__net.fetch = backend(w);

    expect((await tool(h, 'update', { table: 'leads', filters: [], values: { status: 'contacted' } })).isError).toBe(true);
    expect((await tool(h, 'delete', { table: 'leads', filters: [] })).isError).toBe(true);
    expect((await tool(h, 'update', { table: 'leads', filters: ['id=eq.a'], values: {} })).isError).toBe(true);
    expect(dataCalls(w)).toHaveLength(0);

    expect((await tool(h, 'update', { table: 'leads', filters: ['id=eq.a'], values: { trashed_at: 'now()' } })).data.updated).toBe(1);
    expect((await tool(h, 'delete', { table: 'leads', filters: ['id=eq.a'], max_rows: 3 })).data.deleted).toBe(1);
    const [patch, del] = dataCalls(w);
    expect(patch).toMatchObject({ method: 'PATCH', auth: 'Bearer owner-jwt', body: { trashed_at: 'now()' } });
    expect(patch.prefer).toBe('return=representation,handling=strict,max-affected=25');
    expect(patch.query.get('id')).toBe('eq.a');
    expect(del.method).toBe('DELETE');
    expect(del.prefer).toBe('return=representation,handling=strict,max-affected=3');
  });

  test('call_function runs the RPC as the owner; the database\'s refusal comes back in its own words', async () => {
    const h = await load();
    const w = world({
      reply: (c) => (c.path === '/rest/v1/rpc/purge_lead'
        ? reply(400, { code: 'P0001', message: 'stratos:purge_blocked', details: '1 sales deal', hint: null })
        : undefined),
    });
    h.__net.fetch = backend(w);
    const out = await tool(h, 'call_function', { name: 'purge_lead', args: { p_id: 'a' } });
    expect(out.isError).toBe(true);
    expect(out.data.error).toMatchObject({ status: 400, message: 'stratos:purge_blocked', details: '1 sales deal' });
    expect(dataCalls(w)[0]).toMatchObject({ method: 'POST', auth: 'Bearer owner-jwt', body: { p_id: 'a' } });
  });

  test('the server key never reaches a data call', async () => {
    const h = await load();
    const w = world({ schemaForOwner: false });
    h.__net.fetch = backend(w);
    await tool(h, 'describe', {});
    await tool(h, 'query', { table: 'leads' });
    await tool(h, 'insert', { table: 'leads', rows: [{ email: 'a@b.hu' }] });
    await tool(h, 'update', { table: 'leads', filters: ['id=eq.a'], values: { status: 'new' } });
    await tool(h, 'delete', { table: 'leads', filters: ['id=eq.a'] });
    await tool(h, 'call_function', { name: 'purge_lead', args: { p_id: 'a' } });
    const notSchema = w.calls.filter((c) => c.path !== '/rest/v1/');
    expect(notSchema.length).toBeGreaterThan(10);
    for (const c of notSchema) {
      expect(c.auth).not.toContain(ENV.SUPABASE_SECRET_KEY);
      expect(c.apikey).not.toBe(ENV.SUPABASE_SECRET_KEY);
    }
  });
});
