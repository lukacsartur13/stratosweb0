import { test, expect } from '@playwright/test';

/**
 * netlify/functions/portal-mcp.mjs — the Portal as a Claude connector — against
 * a MOCKED Supabase (GoTrue and PostgREST answers scripted below). What it
 * proves: how Claude is sent to sign in, that only the owner's live token gets
 * past the door, the MCP handshake, that every tool becomes the PostgREST call
 * it should AS THE OWNER, that writes cannot run without a filter or past their
 * row limit, that the document tools take the Portal's own upload path through
 * Storage with the owner's token, that invite_client is portal-invite.mjs
 * itself, that a newsletter goes out only with confirm: true, and that the
 * server key never touches data. What it does not prove: that real Supabase
 * issues and accepts the tokens as scripted — that is the setup check in
 * supabase/CLAUDE_CONNECTOR.md §3 — nor real Storage's answers, which are
 * scripted here from DOCUMENTS.md §4–5.
 */

type Handler = {
  default: (r: Request) => Promise<Response>;
  __net: { fetch: typeof fetch };
  __functions: { invite: (r: Request) => Promise<Response> };
};

const ENV = {
  SUPABASE_URL: 'https://mock.supabase.invalid',
  SUPABASE_SECRET_KEY: 'server-key-that-must-never-be-echoed',
  SUPABASE_ANON_KEY: 'public-key',
};
const KEYS = [...Object.keys(ENV), 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PORTAL_ORIGIN', 'URL'];
const ORIGIN = 'https://stratosweb.hu';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [PROJECT, DOC, FOLDER, SUBFOLDER, CAMPAIGN, ORG, ACCOUNT, USER] = [201, 401, 501, 502, 601, 101, 301, 701].map(id);
const KEY = `${PROJECT}/${DOC}`;

let serial = 0;
async function load(env: Record<string, string | undefined> = ENV): Promise<Handler> {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  serial += 1;
  return (await import(`../netlify/functions/portal-mcp.mjs?case=${serial}`)) as unknown as Handler;
}

/**
 * portal-invite.mjs reads its environment once, when first imported — so the
 * copy portal-mcp imports holds whatever the first test in this worker set. The
 * invite tests give portal-mcp a fresh copy, loaded with an origin, through its
 * seam (the seam itself is checked to hold the real function).
 */
async function withInvite(h: Handler, w: World) {
  process.env.PORTAL_ORIGIN = ORIGIN;
  serial += 1;
  const inv = (await import(`../netlify/functions/portal-invite.mjs?mcp=${serial}`)) as unknown as Handler;
  inv.__net.fetch = backend(w);
  h.__functions.invite = inv.default;
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

interface Call { method: string; path: string; query: URLSearchParams; headers: Headers; auth: string; apikey: string; prefer: string; body: unknown }
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
      headers: h,
      auth: h.get('authorization') ?? '',
      apikey: h.get('apikey') ?? '',
      prefer: h.get('prefer') ?? '',
      // JSON for PostgREST and Storage's own API; raw bytes for an upload.
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body ?? undefined,
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

  test('tools/list: eleven tools, the reading ones read-only, the Portal\'s actions destructive', async () => {
    const h = await load();
    h.__net.fetch = backend(world());
    const { result } = await (await post(h, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json();
    const byName = Object.fromEntries(result.tools.map((t: { name: string }) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual([
      'call_function', 'delete', 'describe', 'insert', 'invite_client', 'list_documents', 'query', 'read_document',
      'send_newsletter_campaign', 'update', 'upload_document',
    ]);
    for (const name of ['describe', 'query', 'list_documents', 'read_document']) expect(byName[name].annotations.readOnlyHint).toBe(true);
    for (const name of ['delete', 'invite_client', 'send_newsletter_campaign']) expect(byName[name].annotations.destructiveHint).toBe(true);
    expect(byName.upload_document.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(byName.send_newsletter_campaign.inputSchema.properties.confirm.type).toBe('boolean');
    expect(byName.send_newsletter_campaign.inputSchema.required).toEqual(['campaign_id']);
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
    await tool(h, 'list_documents', { project_id: PROJECT });
    await tool(h, 'read_document', { document_id: DOC });
    await tool(h, 'upload_document', { project_id: PROJECT, name: 'a.txt', content: 'a' });
    await tool(h, 'send_newsletter_campaign', { campaign_id: CAMPAIGN });
    const notSchema = w.calls.filter((c) => c.path !== '/rest/v1/');
    expect(notSchema.length).toBeGreaterThan(20);
    for (const c of notSchema) {
      expect(c.auth).not.toContain(ENV.SUPABASE_SECRET_KEY);
      expect(c.apikey).not.toBe(ENV.SUPABASE_SECRET_KEY);
    }
  });
});

test.describe('the document library', () => {
  const DOC_ROW = {
    id: DOC, project_id: PROJECT, folder_id: SUBFOLDER, name: 'Jegyzet.md', byte_size: 12, content_kind: 'text',
    upload_state: 'ready', storage_path: KEY, created_at: '2026-10-19T10:00:00Z', trashed_at: null,
  };
  const bytesOf = (s: string) => new TextEncoder().encode(s);

  test('list_documents: the project\'s files with their folder paths, as the owner, the trash left out', async () => {
    const h = await load();
    const w = world({
      reply: (c) => {
        if (c.path === '/rest/v1/document_folders') {
          return reply(200, [
            { id: FOLDER, parent_id: null, name: 'Szerződések', trashed_at: null },
            { id: SUBFOLDER, parent_id: FOLDER, name: '2026', trashed_at: null },
            { id: id(503), parent_id: null, name: 'Régi', trashed_at: '2026-10-01T00:00:00Z' },
          ]);
        }
        if (c.path === '/rest/v1/project_documents') return reply(200, [{ ...DOC_ROW, storage_path: undefined }]);
        return undefined;
      },
    });
    h.__net.fetch = backend(w);
    const out = await tool(h, 'list_documents', { project_id: PROJECT });
    expect(out.data.documents).toBe(1);
    expect(out.data.rows[0]).toMatchObject({ id: DOC, name: 'Jegyzet.md', folder: 'Szerződések/2026' });
    expect(out.data.folders).toEqual([{ id: FOLDER, path: 'Szerződések' }, { id: SUBFOLDER, path: 'Szerződések/2026' }]);
    const docs = dataCalls(w).find((c) => c.path === '/rest/v1/project_documents')!;
    expect(docs).toMatchObject({ method: 'GET', auth: 'Bearer owner-jwt' });
    expect(docs.query.get('project_id')).toBe(`eq.${PROJECT}`);
    expect(docs.query.get('trashed_at')).toBe('is.null');

    await tool(h, 'list_documents', { project_id: PROJECT, include_trash: true });
    expect(dataCalls(w).filter((c) => c.path === '/rest/v1/project_documents')[1].query.has('trashed_at')).toBe(false);
    expect((await tool(h, 'list_documents', { project_id: 'x' })).isError).toBe(true);
  });

  test('read_document: a text file comes back as its text, read from Storage as the owner, in pages', async () => {
    const h = await load();
    const body = `# Jegyzet\n${'á'.repeat(150_000)}`;
    const w = world({
      reply: (c) => {
        if (c.path === '/rest/v1/project_documents') return reply(200, [DOC_ROW]);
        if (c.path === `/storage/v1/object/authenticated/project-documents/${KEY}`) return new Response(bytesOf(body));
        return undefined;
      },
    });
    h.__net.fetch = backend(w);
    const first = await tool(h, 'read_document', { document_id: DOC });
    expect(first.isError).toBe(false);
    expect(first.data.document).toMatchObject({ id: DOC, name: 'Jegyzet.md' });
    expect(first.data.document.storage_path).toBeUndefined();
    expect(first.data.text.startsWith('# Jegyzet\ná')).toBe(true);
    expect(first.data.text.length).toBe(100_000);
    expect(first.data.page).toContain('Continue with offset 100000');
    const rest = await tool(h, 'read_document', { document_id: DOC, offset: 100_000 });
    expect(rest.data.text.length).toBe(body.length - 100_000);
    const get = dataCalls(w).find((c) => c.path.startsWith('/storage/'))!;
    expect(get).toMatchObject({ method: 'GET', auth: 'Bearer owner-jwt', apikey: ENV.SUPABASE_ANON_KEY });
    expect(dataCalls(w).some((c) => c.path.includes('/object/sign/'))).toBe(false);
  });

  test('read_document: any other file is a five-minute download link, never read here', async () => {
    const h = await load();
    const pdf = { ...DOC_ROW, name: 'Ajánlat őszi.pdf', content_kind: 'pdf', byte_size: 90_000 };
    const w = world({
      reply: (c) => {
        if (c.path === '/rest/v1/project_documents') return reply(200, [pdf]);
        if (c.path === `/storage/v1/object/sign/project-documents/${KEY}`) {
          return reply(200, { signedURL: `/object/sign/project-documents/${KEY}?token=signed` });
        }
        return undefined;
      },
    });
    h.__net.fetch = backend(w);
    const out = await tool(h, 'read_document', { document_id: DOC });
    expect(out.data.download_url)
      .toBe(`${ENV.SUPABASE_URL}/storage/v1/object/sign/project-documents/${KEY}?token=signed&download=Ajanlat%20oszi.pdf`);
    expect(out.data.expires_in_seconds).toBe(300);
    expect(out.data.text).toBeUndefined();
    const sign = dataCalls(w).find((c) => c.path.startsWith('/storage/'))!;
    expect(sign).toMatchObject({ method: 'POST', auth: 'Bearer owner-jwt', body: { expiresIn: 300 } });
    expect(dataCalls(w).some((c) => c.path.includes('/object/authenticated/'))).toBe(false);
  });

  test('read_document: an unfinished upload or an unknown id is refused before Storage', async () => {
    const h = await load();
    let rows: unknown[] = [{ ...DOC_ROW, upload_state: 'pending' }];
    const w = world({ reply: (c) => (c.path === '/rest/v1/project_documents' ? reply(200, rows) : undefined) });
    h.__net.fetch = backend(w);
    expect((await tool(h, 'read_document', { document_id: DOC })).data.error).toContain('pending');
    rows = [];
    expect((await tool(h, 'read_document', { document_id: DOC })).isError).toBe(true);
    expect(dataCalls(w).some((c) => c.path.startsWith('/storage/'))).toBe(false);
  });

  test('upload_document: the Portal\'s four steps, as the owner — pending row, signed link, PUT, finish', async () => {
    const h = await load();
    const w = world({
      reply: (c) => {
        if (c.path === '/rest/v1/rpc/document_begin_upload') return reply(200, [{ id: DOC, name: 'Jegyzet (2).md', storage_path: KEY }]);
        if (c.path === `/storage/v1/object/upload/sign/project-documents/${KEY}`) {
          return reply(200, { url: `/object/upload/sign/project-documents/${KEY}?token=upload` });
        }
        if (c.method === 'PUT') return reply(200, { Key: `project-documents/${KEY}` });
        if (c.path === '/rest/v1/rpc/document_finish_upload') return reply(200, 'ready');
        return undefined;
      },
    });
    h.__net.fetch = backend(w);
    const content = 'Megbeszélés: árajánlat jövő hétre.\n';
    const out = await tool(h, 'upload_document', { project_id: PROJECT, folder_id: FOLDER, name: 'Jegyzet.md', content });
    expect(out.isError).toBe(false);
    expect(out.data.uploaded).toEqual({ id: DOC, name: 'Jegyzet (2).md', project_id: PROJECT, folder_id: FOLDER, byte_size: bytesOf(content).length });

    const [begin, sign, put, finish] = dataCalls(w);
    expect(begin).toMatchObject({ method: 'POST', path: '/rest/v1/rpc/document_begin_upload', auth: 'Bearer owner-jwt' });
    expect(begin.body).toEqual({
      p_project: PROJECT, p_folder: FOLDER, p_name: 'Jegyzet.md', p_size: bytesOf(content).length, p_type: 'text/markdown', p_kind: 'text',
    });
    expect(sign).toMatchObject({ method: 'POST', auth: 'Bearer owner-jwt' });
    expect(put.method).toBe('PUT');
    expect(put.path).toBe(`/storage/v1/object/upload/sign/project-documents/${KEY}`);
    expect(put.query.get('token')).toBe('upload');
    expect(put.auth).toBe('');
    expect(put.apikey).toBe(ENV.SUPABASE_ANON_KEY);
    expect(new TextDecoder().decode(put.body as Uint8Array)).toBe(content);
    expect(put.headers.get('content-type')).toBe('application/octet-stream');
    expect(put.headers.get('x-upsert')).toBe('false');
    expect(finish).toMatchObject({ method: 'POST', path: '/rest/v1/rpc/document_finish_upload', body: { p_id: DOC } });
  });

  test('upload_document: Storage\'s refusal leaves the row failed, as the Portal\'s uploader does', async () => {
    const h = await load();
    const w = world({
      reply: (c) => {
        if (c.path === '/rest/v1/rpc/document_begin_upload') return reply(200, [{ id: DOC, name: 'a.txt', storage_path: KEY }]);
        if (c.path.startsWith('/storage/v1/object/upload/sign/') && c.method === 'POST') {
          return reply(200, { url: `/object/upload/sign/project-documents/${KEY}?token=upload` });
        }
        if (c.method === 'PUT') return reply(400, { error: 'InvalidMimeType', message: 'mime type not supported' });
        return undefined;
      },
    });
    h.__net.fetch = backend(w);
    const out = await tool(h, 'upload_document', { project_id: PROJECT, name: 'a.txt', content: 'hello' });
    expect(out.isError).toBe(true);
    expect(out.data.error).toMatchObject({ status: 400, storage: 'InvalidMimeType' });
    const mark = dataCalls(w).find((c) => c.method === 'PATCH')!;
    expect(mark.path).toBe('/rest/v1/project_documents');
    expect(mark.body).toEqual({ upload_state: 'failed', failure_reason: 'storage_refused' });
    expect(mark.query.get('upload_state')).toBe('eq.pending');
    expect(dataCalls(w).some((c) => c.path === '/rest/v1/rpc/document_finish_upload')).toBe(false);
  });

  test('upload_document refuses what the Portal would — before any row exists', async () => {
    const h = await load();
    const w = world();
    h.__net.fetch = backend(w);
    // The same verdicts as the Portal's own check (sniffKind) on the same bytes.
    const { sniffKind } = await import('../portal/src/lib/documentRules');
    const refused = ['<!doctype html><p>hi', '  <svg onload=x>', '%PDF-1.7 fake', '{\\rtf1 x', 'GIF89a…', 'ID3 tag', '1234ftypisom'];
    for (const content of refused) {
      expect(sniffKind(bytesOf(content), 'txt'), content).not.toBe('text');
      expect((await tool(h, 'upload_document', { project_id: PROJECT, name: 'a.txt', content })).isError, content).toBe(true);
    }
    expect(sniffKind(bytesOf('név;összeg\nA;1'), 'csv')).toBe('text');
    for (const name of ['a.pdf', 'a.html', 'a.json', 'noextension']) {
      expect((await tool(h, 'upload_document', { project_id: PROJECT, name, content: 'x' })).isError, name).toBe(true);
    }
    expect((await tool(h, 'upload_document', { project_id: PROJECT, name: 'a.txt', content: 'x'.repeat(600 * 1024) })).isError).toBe(true);
    expect((await tool(h, 'upload_document', { project_id: 'nope', name: 'a.txt', content: 'x' })).isError).toBe(true);
    expect(dataCalls(w)).toHaveLength(0);
  });

  test('the steps of an upload cannot be run around the tool', async () => {
    const h = await load();
    const w = world();
    h.__net.fetch = backend(w);
    for (const name of ['document_begin_upload', 'document_finish_upload']) {
      const out = await tool(h, 'call_function', { name, args: {} });
      expect(out.data.error).toContain('upload_document');
    }
    expect(dataCalls(w)).toHaveLength(0);
  });
});

test.describe('the Portal\'s actions', () => {
  test('invite_client is portal-invite.mjs itself', async () => {
    const h = await load();
    const real = (await import('../netlify/functions/portal-invite.mjs')) as unknown as Handler;
    expect(h.__functions.invite).toBe(real.default);
  });

  test('invite_client: the invite flow with the owner\'s token, the one-time link back', async () => {
    const h = await load();
    const w = world({
      reply: (c) => {
        if (c.path === '/rest/v1/rpc/client_invite_prepare') return reply(200, [{ account_id: ACCOUNT, user_id: null }]);
        if (c.path === '/rest/v1/profiles') return reply(200, []);
        if (c.path === '/auth/v1/admin/generate_link') {
          return reply(200, { user: { id: USER }, properties: { hashed_token: 'hash123', verification_type: 'invite' } });
        }
        if (c.path === '/rest/v1/rpc/client_invite_attach') return reply(200, null);
        return undefined;
      },
    });
    h.__net.fetch = backend(w);
    await withInvite(h, w);
    const out = await tool(h, 'invite_client', {
      organization_id: ORG, full_name: 'Kert Elek', email: 'Elek@Rapidkert.hu', project_ids: [PROJECT],
    });
    expect(out.isError).toBe(false);
    expect(out.data).toMatchObject({ account_id: ACCOUNT, kind: 'invite', link: `${ORIGIN}/portal/accept-invite#token_hash=hash123&type=invite` });

    const prepare = w.calls.find((c) => c.path === '/rest/v1/rpc/client_invite_prepare')!;
    expect(prepare.auth).toBe('Bearer owner-jwt');
    expect(prepare.body).toEqual({ p_organization: ORG, p_contact: null, p_name: 'Kert Elek', p_email: 'elek@rapidkert.hu', p_projects: [PROJECT] });
    expect(w.calls.find((c) => c.path === '/rest/v1/rpc/client_invite_attach')).toMatchObject({ auth: 'Bearer owner-jwt', body: { p_account: ACCOUNT, p_user: USER } });
    // The server key only where portal-invite.mjs documents it: finding and creating the auth user.
    for (const c of w.calls.filter((x) => x.auth.includes(ENV.SUPABASE_SECRET_KEY))) {
      expect(['/rest/v1/profiles', '/auth/v1/admin/generate_link']).toContain(c.path);
    }
  });

  test('invite_client: a refusal comes back as portal-invite\'s own code, and no account is created', async () => {
    const h = await load();
    const w = world({
      reply: (c) => (c.path === '/rest/v1/rpc/client_invite_prepare'
        ? reply(409, { code: 'P0001', message: 'stratos:client_email_is_staff' })
        : undefined),
    });
    h.__net.fetch = backend(w);
    await withInvite(h, w);
    const out = await tool(h, 'invite_client', { organization_id: ORG, full_name: 'Kert Elek', email: 'hello@stratosweb.hu' });
    expect(out.isError).toBe(true);
    expect(out.data.error).toMatchObject({ status: 409, code: 'EMAIL_IS_STAFF' });
    expect(w.calls.some((c) => c.path.startsWith('/auth/v1/admin/'))).toBe(false);
  });

  const CAMPAIGN_ROW = { id: CAMPAIGN, subject: 'Őszi hírek', preheader: null, audience: 'hu', status: 'draft' };
  const newsletterWorld = (campaign: Record<string, unknown> = CAMPAIGN_ROW) => world({
    reply: (c) => {
      if (c.path === '/rest/v1/newsletter_campaigns') return reply(200, [campaign]);
      if (c.path === '/rest/v1/newsletter_subscribers') return reply(200, [{ id: 's' }], { 'content-range': '0-0/42' });
      if (c.path === '/rest/v1/rpc/newsletter_campaign_send') return reply(200, 42);
      return undefined;
    },
  });
  const sends = (w: World) => w.calls.filter((c) => c.path === '/rest/v1/rpc/newsletter_campaign_send');

  test('send_newsletter_campaign without confirm: what would go out, and nothing sent', async () => {
    const h = await load();
    const w = newsletterWorld();
    h.__net.fetch = backend(w);
    for (const confirm of [undefined, false, 'true', 'yes', 1]) {
      const out = await tool(h, 'send_newsletter_campaign', { campaign_id: CAMPAIGN, ...(confirm === undefined ? {} : { confirm }) });
      expect(out.data.sent).toBe(false);
      expect(out.data.would_send).toMatchObject({ subject: 'Őszi hírek', audience: 'hu', recipients: 42 });
    }
    expect(sends(w)).toHaveLength(0);
    const count = w.calls.find((c) => c.path === '/rest/v1/newsletter_subscribers')!;
    expect(count).toMatchObject({ auth: 'Bearer owner-jwt', prefer: 'count=exact' });
    expect(count.query.get('status')).toBe('eq.confirmed');
    expect(count.query.get('locale')).toBe('eq.hu');
  });

  test('send_newsletter_campaign with confirm: true queues it through the Portal\'s own function, as the owner', async () => {
    const h = await load();
    const w = newsletterWorld();
    h.__net.fetch = backend(w);
    const out = await tool(h, 'send_newsletter_campaign', { campaign_id: CAMPAIGN, confirm: true });
    expect(out.data).toMatchObject({ sent: true, queued: 42, campaign_id: CAMPAIGN });
    expect(sends(w)).toHaveLength(1);
    expect(sends(w)[0]).toMatchObject({ method: 'POST', auth: 'Bearer owner-jwt', body: { p_id: CAMPAIGN } });
  });

  test('send_newsletter_campaign: only a draft, and never through call_function', async () => {
    const h = await load();
    const w = newsletterWorld({ ...CAMPAIGN_ROW, status: 'sent' });
    h.__net.fetch = backend(w);
    expect((await tool(h, 'send_newsletter_campaign', { campaign_id: CAMPAIGN, confirm: true })).data.error).toContain('only a draft');
    const around = await tool(h, 'call_function', { name: 'newsletter_campaign_send', args: { p_id: CAMPAIGN } });
    expect(around.data.error).toContain('send_newsletter_campaign');
    for (const name of ['client_invite_prepare', 'client_invite_attach']) {
      expect((await tool(h, 'call_function', { name, args: {} })).data.error).toContain('invite_client');
    }
    expect(sends(w)).toHaveLength(0);
  });
});
