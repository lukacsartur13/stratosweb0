import { test, expect } from '@playwright/test';

/**
 * netlify/functions/jarvis.mjs — the assistant's chat — against a MOCKED
 * Supabase (GoTrue, PostgREST: a small in-memory store below) and a MOCKED
 * Claude API (scripted server-sent events, parsed by the real Anthropic SDK).
 * What it proves: who gets in; that every Supabase call carries the person's
 * own token; what is sent to Claude (model, prompt caching, fallback, the
 * fixed tool list, the append-only history with the Portal's context block);
 * the tool loop and what each read tool asks PostgREST for; that every step is
 * stored as it completes; the time limit and `continue`; tools left unrun by a
 * stopped request; the daily budget; the rate limit; refusals and API errors.
 * What it does not prove: real Claude answers, or real RLS (that is
 * tests/portal-jarvis-db.spec.ts).
 */

test.describe.configure({ mode: 'serial' });

const SUPA = 'https://mock.supabase.invalid';
const ENV = {
  SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: 'public-key', ANTHROPIC_API_KEY: 'sk-ant-test-key',
  // Phase 6: the one server-key read (the caller's own sealed Google token).
  SUPABASE_SECRET_KEY: 'server-key-for-google-only', GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret',
  GOOGLE_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64'),
};
const KEYS = [...Object.keys(ENV), 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), admin: id(3), client: id(6) };
const TOKENS: Record<string, { user: string; admin: boolean; owner: boolean }> = {
  'owner-token': { user: U.owner, admin: true, owner: true },
  'admin-token': { user: U.admin, admin: true, owner: false },
  'client-token': { user: U.client, admin: false, owner: false },
};
const LEAD = id(401);

type Row = Record<string, unknown>;
type Call = { method: string; path: string; params: URLSearchParams; auth: string | null; body: unknown };
type Scripted = { content: Row[]; stop_reason: string; model?: string; usage?: Row; stop_details?: Row; hang?: boolean; status?: number };
type World = { tables: Record<string, Row[]>; calls: Call[]; claude: Scripted[]; sent: Row[]; seq: number; google: Call[] };

type Handler = {
  default: (r: Request) => Promise<Response>;
  __net: { fetch: typeof fetch };
  LIMITS: { soft: number; hard: number; stepsPerRequest: number; stepsPerMessage: number };
};
type Lib = {
  forReplay: (c: Row[]) => Row[];
  usageOf: (m: Row) => Row;
  spentToday: (r: Row[]) => number;
  budapestMidnight: (d: string) => string;
  budapestDate: (at?: Date, days?: number) => string;
  contextBlock: (a: Row) => string;
};
type Tools = {
  toolsFor: (r: string) => Row[]; runTool: (n: string, i: unknown, c: Row) => Promise<Row>; fit: (v: unknown) => string;
  __functions: { booking: (r: Request) => Promise<Response> };
};
type GoogleLib = { __net: { fetch: typeof fetch }; sealToken: (s: string) => string };

let h: Handler;
let lib: Lib;
let tools: Tools;
let googleLib: GoogleLib;
const DEFAULT_LIMITS = { soft: 38_000, hard: 50_000, stepsPerRequest: 6, stepsPerMessage: 12 };

let savedEnv: Record<string, string | undefined> = {};
test.beforeAll(async () => {
  savedEnv = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, ENV);
  h = (await import('../netlify/functions/jarvis.mjs')) as unknown as Handler;
  lib = (await import('../netlify/functions/jarvis-lib.mjs')) as unknown as Lib;
  tools = (await import('../netlify/functions/jarvis-tools.mjs')) as unknown as Tools;
  googleLib = (await import('../netlify/functions/google-lib.mjs')) as unknown as GoogleLib;
  realFetch = { jarvis: h.__net.fetch, google: googleLib.__net.fetch };
});

// google-lib.mjs is shared with every other file this worker runs (booking, google-sync):
// its fetch goes back to what it was, or their "real" fetch would be this file's fake.
let realFetch: { jarvis: typeof fetch; google: typeof fetch };
test.afterAll(() => {
  h.__net.fetch = realFetch.jarvis;
  googleLib.__net.fetch = realFetch.google;
  // And the environment: GOOGLE_TOKEN_KEY above all, which other files seal their tokens with.
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

function world(tables: Record<string, Row[]> = {}): World {
  return {
    tables: {
      jarvis_settings: [{ daily_token_budget: 2_000_000, rate_limit_per_minute: 20, voice_enabled: true }],
      jarvis_usage: [], jarvis_threads: [], jarvis_messages: [], jarvis_memory: [],
      profiles: [{ id: U.owner, full_name: 'Lukács Artúr', email: 'owner@example.invalid' }, { id: U.admin, full_name: 'Admin Anna', email: 'admin@example.invalid' }],
      leads: [{ id: LEAD, name: 'Kiss Péter', company: 'Kiss Kft.', status: 'new' }],
      ...tables,
    },
    calls: [], claude: [], sent: [], seq: 0, google: [],
  };
}

/** The SSE a Claude streaming response would send for one message. */
function sse(msg: Scripted) {
  const usage = { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...(msg.usage ?? {}) };
  const ev: [string, Row][] = [['message_start', { type: 'message_start', message: {
    id: 'msg_x', type: 'message', role: 'assistant', model: msg.model ?? 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null,
    usage: { ...usage, output_tokens: 1 },
  } }]];
  msg.content.forEach((b, index) => {
    if (b.type === 'text') {
      ev.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }]);
      ev.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } }]);
    } else if (b.type === 'tool_use') {
      ev.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } }]);
      ev.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } }]);
    } else if (b.type === 'thinking') {
      ev.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } }]);
      ev.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: b.signature } }]);
    }
    ev.push(['content_block_stop', { type: 'content_block_stop', index }]);
  });
  ev.push(['message_delta', { type: 'message_delta', delta: { stop_reason: msg.stop_reason, stop_sequence: null, ...(msg.stop_details ? { stop_details: msg.stop_details } : {}) }, usage: { output_tokens: usage.output_tokens } }]);
  ev.push(['message_stop', { type: 'message_stop' }]);
  return ev.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A PostgREST stand-in: eq./is./in. filters, limit, and inserts; every call recorded. */
function backend(w: World) {
  return async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init.headers);
    const method = (init.method ?? 'GET').toUpperCase();

    if (url.hostname === 'oauth2.googleapis.com' || url.hostname.endsWith('googleapis.com')) {
      const body = init.body ? (url.hostname === 'oauth2.googleapis.com' ? Object.fromEntries(new URLSearchParams(String(init.body))) : JSON.parse(String(init.body))) : undefined;
      w.google.push({ method, path: url.pathname, params: url.searchParams, auth: headers.get('authorization'), body });
      if (url.pathname === '/token') return reply(200, { access_token: 'ya29.test-access', expires_in: 3600 });
      if (url.pathname.endsWith('/drafts')) return reply(200, { id: 'r-draft-1', message: { id: 'm-1', threadId: 't-1' } });
      if (url.pathname.endsWith('/events')) {
        return reply(200, { id: 'ev-1', htmlLink: 'https://www.google.com/calendar/event?eid=ZXYtMQ', hangoutLink: (body as Row)?.conferenceData ? 'https://meet.google.com/abc-defg-hij' : undefined });
      }
      return reply(404, {});
    }
    if (url.hostname === 'api.anthropic.com') {
      const body = JSON.parse(String(init.body));
      w.sent.push(body);
      const next = w.claude.shift();
      if (!next) throw new Error('no scripted Claude response left');
      if (next.status) {
        return new Response(JSON.stringify({ type: 'error', error: { type: 'x', message: 'scripted' } }), {
          status: next.status, headers: { 'content-type': 'application/json', 'retry-after-ms': '1' },
        });
      }
      if (next.hang) {
        const stream = new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(sse({ content: [], stop_reason: 'end_turn' }).split('event: message_delta')[0]));
            init.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
          },
        });
        return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(sse(next), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }

    const auth = headers.get('authorization');
    const token = auth?.replace(/^Bearer\s+/, '') ?? '';
    const path = url.pathname.replace('/rest/v1', '');
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    w.calls.push({ method, path, params: url.searchParams, auth, body });

    if (url.pathname === '/auth/v1/user') {
      const t = TOKENS[token];
      return t ? reply(200, { id: t.user, email: 'x@example.invalid' }) : reply(401, { msg: 'invalid' });
    }
    if (path === '/rpc/is_admin') return reply(200, TOKENS[token]?.admin ?? false);
    if (path === '/rpc/is_owner') return reply(200, TOKENS[token]?.owner ?? false);
    if (path.startsWith('/rpc/')) return reply(200, w.tables[path.slice(5)] ?? []);

    const table = path.slice(1);
    const list = (w.tables[table] ??= []);
    if (method === 'PATCH' || method === 'DELETE') {
      const idq = url.searchParams.get('id');
      const hit = list.filter((r) => idq && String(r.id) === idq.slice(3));
      if (method === 'DELETE') { w.tables[table] = list.filter((r) => !hit.includes(r)); return new Response(null, { status: 204 }); }
      for (const r of hit) Object.assign(r, body);
      return reply(200, hit);
    }
    if (method === 'POST') {
      w.seq += 1;
      const row = { id: id(9000 + w.seq), created_at: new Date(Date.now() + w.seq).toISOString(), ...body };
      if (table === 'jarvis_threads') row.user_id = TOKENS[token]?.user;
      list.push(row);
      return reply(201, [row]);
    }
    let out = [...list];
    for (const [k, v] of url.searchParams) {
      if (['select', 'order', 'limit', 'or'].includes(k)) continue;
      if (v.startsWith('eq.')) out = out.filter((r) => !(k in r) || String(r[k]) === v.slice(3));
      if (v === 'is.null') out = out.filter((r) => r[k] === null || r[k] === undefined);
      if (v.startsWith('ilike.') && !v.includes('*')) out = out.filter((r) => k in r && String(r[k]).toLowerCase() === v.slice(6).toLowerCase());
      if (v.startsWith('gte.') && k === 'created_at') out = out.filter((r) => String(r[k]) >= v.slice(4));
    }
    const limit = Number(url.searchParams.get('limit'));
    if (limit) out = out.slice(0, limit);
    return reply(200, out);
  };
}

async function ask(w: World, body: Row, token = 'owner-token') {
  h.__net.fetch = backend(w) as typeof fetch;
  googleLib.__net.fetch = backend(w) as typeof fetch;
  const res = await h.default(new Request('https://stratosweb.hu/api/jarvis', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  if (!(res.headers.get('content-type') ?? '').startsWith('text/event-stream')) return { status: res.status, json: await res.json(), events: [] as { event: string; data: Row }[] };
  const text = await res.text();
  const events = text.trim().split('\n\n').filter(Boolean).map((chunk) => {
    const [e, d] = chunk.split('\n');
    return { event: e.slice(7), data: JSON.parse(d.slice(6)) as Row };
  });
  return { status: res.status, json: null, events };
}
const names = (events: { event: string }[]) => events.map((e) => e.event);
const messages = (w: World) => w.tables.jarvis_messages;
const text = (s: string): Scripted => ({ content: [{ type: 'text', text: s }], stop_reason: 'end_turn' });
const toolCall = (calls: [string, string, Row][]): Scripted => ({ content: calls.map(([cid, name, input]) => ({ type: 'tool_use', id: cid, name, input })), stop_reason: 'tool_use' });

test.afterEach(() => { Object.assign(h.LIMITS, DEFAULT_LIMITS); });

test('the door: a live admin session, a valid body, and the Claude key set on the deployment', async () => {
  const w = world();
  expect((await ask(w, { message: 'Szia' }, 'nobody')).status).toBe(401);
  expect((await ask(w, { message: 'Szia' }, 'client-token')).json).toEqual({ ok: false, code: 'FORBIDDEN' });
  expect((await ask(w, { message: '' })).status).toBe(400);
  expect((await ask(w, { message: 'x'.repeat(8001) })).status).toBe(400);
  expect((await ask(w, { continue: true })).status).toBe(400);
  expect((await ask(w, { message: 'Szia', thread_id: 'nope' })).status).toBe(400);
  expect((await ask(w, { message: 'Szia', thread_id: id(77) })).json).toEqual({ ok: false, code: 'THREAD' });
  h.__net.fetch = backend(w) as typeof fetch;
  expect((await h.default(new Request('https://stratosweb.hu/api/jarvis'))).status).toBe(405);

  delete process.env.ANTHROPIC_API_KEY;
  expect((await ask(w, { message: 'Szia' })).json).toEqual({ ok: false, code: 'ANTHROPIC_NOT_CONFIGURED' });
  process.env.ANTHROPIC_API_KEY = ENV.ANTHROPIC_API_KEY;
  expect(w.sent).toHaveLength(0);
  expect(w.tables.jarvis_threads).toHaveLength(0);
});

test('a first message: a new thread, the context block, one cached and fallback-protected Claude call, every step stored', async () => {
  const w = world({ jarvis_memory: [{ scope: 'global', fact: 'Az ajánlatok nettó árral mennek.', approved: true, archived_at: null }] });
  w.claude.push({ ...text('Kiss Péter új lead, még nem kerestük.'), usage: { input_tokens: 1200, output_tokens: 40, cache_creation_input_tokens: 3000 } });
  const r = await ask(w, { message: 'Erről mit tudunk?', context: { route: `/portal/leads/${LEAD}`, entity_type: 'lead', entity_id: LEAD }, voice: true });
  expect(r.status).toBe(200);
  expect(names(r.events)).toEqual(['thread', 'step', 'text', 'done']);
  expect(r.events[0].data).toMatchObject({ title: 'Erről mit tudunk?', model: 'claude-sonnet-5-5', over_budget: false });
  expect(r.events[2].data).toEqual({ delta: 'Kiss Péter új lead, még nem kerestük.' });

  const [thread] = w.tables.jarvis_threads;
  expect(thread).toMatchObject({ context_entity_type: 'lead', context_entity_id: LEAD, user_id: U.owner });
  const [user, assistant] = messages(w);
  expect(user.role).toBe('user');
  const [ctxBlock, said] = user.content as { text: string }[];
  expect(said.text).toBe('Erről mit tudunk?');
  expect(ctxBlock.text).toContain('[Portál-kontextus — a Portál írta, nem a felhasználó]');
  expect(ctxBlock.text).toContain(`Képernyő: /portal/leads/${LEAD}`);
  expect(ctxBlock.text).toContain('Rekord: lead · Kiss Péter (Kiss Kft., állapot: new)');
  expect(ctxBlock.text).toContain('Hangmód: be');
  expect(ctxBlock.text).toContain('- Az ajánlatok nettó árral mennek.');
  expect(assistant).toMatchObject({ role: 'assistant', model: 'claude-sonnet-5-5', input_tokens: 1200, output_tokens: 40, cache_write_tokens: 3000, cache_read_tokens: 0 });

  const [req] = w.sent as Row[];
  expect(req).toMatchObject({
    model: 'claude-sonnet-5-5', max_tokens: 16000, stream: true, fallbacks: 'default',
    cache_control: { type: 'ephemeral' }, output_config: { effort: 'medium' },
    thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
  });
  const system = req.system as Row[];
  expect(system).toHaveLength(1);
  expect(system[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } });
  expect(String(system[0].text)).toContain('A felhasználó: Lukács Artúr.');
  expect(String(system[0].text)).not.toMatch(/\d{4}\. \w+ \d/); // no date in the stable prompt
  expect((req.tools as Row[]).map((t) => t.name)).toEqual([
    'crm_search', 'get_record', 'list_leads', 'list_opportunities', 'list_projects', 'pipeline_summary',
    'revenue_report', 'payment_overview', 'open_alerts', 'email_search', 'list_meetings', 'calendar_free_slots', 'time_summary',
    'add_note', 'log_interaction', 'update_lead_status', 'create_opportunity', 'update_opportunity', 'create_task', 'log_time', 'create_lead',
    'gmail_create_draft', 'calendar_create_event', 'client_portal_message',
  ]);
  expect((req.tools as Row[]).every((t) => t.eager_input_streaming === true)).toBe(true);
  expect(req.messages).toEqual([{ role: 'user', content: user.content }]);

  // Every Supabase call as the person: their token, never another key.
  expect(w.calls.every((c) => c.auth === 'Bearer owner-token')).toBe(true);
});

test('the betas the fallback and the block binding need are sent', async () => {
  const w = world();
  w.claude.push(text('Rendben.'));
  let betas = '';
  const base = backend(w);
  h.__net.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('api.anthropic.com')) betas = new Headers(init.headers).get('anthropic-beta') ?? '';
    return base(input, init);
  }) as typeof fetch;
  await h.default(new Request('https://stratosweb.hu/api/jarvis', { method: 'POST', headers: { authorization: 'Bearer owner-token' }, body: JSON.stringify({ message: 'Szia' }) })).then((r) => r.text());
  expect(betas.split(',').sort()).toEqual(['server-side-fallback-2026-07-01', 'thinking-binding-controls-2026-08-01']);
});

test('the tool loop: tools run with the person\'s token, results are stored, Claude gets them back, then answers', async () => {
  const w = world({ portal_sales_summary: [{ bucket: 'proposal', currency: 'HUF', items: 3, value: 900000, weighted: 450000 }] });
  w.claude.push(toolCall([['tu_1', 'pipeline_summary', {}], ['tu_2', 'list_leads', { status: 'new', limit: 5 }]]));
  w.claude.push(text('Három deal van ajánlati szakaszban, egy új lead.'));
  const r = await ask(w, { message: 'Hol tart a pipeline?' }, 'admin-token');
  expect(names(r.events)).toEqual(['thread', 'step', 'tool', 'tool', 'tool', 'tool', 'step', 'text', 'done']);
  const done = r.events.filter((e) => e.event === 'tool' && e.data.status === 'done').map((e) => e.data.label);
  expect(done.sort()).toEqual(['Leadek lekérdezve · 1 lead', 'Pipeline lekérdezve · 3 deal']);

  const leadsCall = w.calls.find((c) => c.path === '/leads' && c.params.get('status') === 'eq.new');
  expect(leadsCall?.params.get('trashed_at')).toBe('is.null');
  expect(leadsCall?.params.get('limit')).toBe('5');
  expect(leadsCall?.auth).toBe('Bearer admin-token');

  expect(messages(w).map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  const results = messages(w)[2].content as Row[];
  expect(results.map((b) => [b.type, b.tool_use_id, b.is_error ?? false])).toEqual([['tool_result', 'tu_1', false], ['tool_result', 'tu_2', false]]);
  expect(JSON.parse(String(results[0].content))).toEqual({ pipeline: [{ bucket: 'proposal', currency: 'HUF', items: 3, value: 900000, weighted: 450000 }] });

  const second = w.sent[1] as Row;
  expect((second.messages as Row[]).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  expect((second.messages as Row[])[2].content).toEqual(results);
  // The prefix Claude saw the first time is unchanged the second time (cache, thinking blocks).
  expect(JSON.stringify((second.messages as Row[]).slice(0, 1))).toBe(JSON.stringify((w.sent[0] as Row).messages));
  expect(JSON.stringify(second.system)).toBe(JSON.stringify((w.sent[0] as Row).system));
  expect(JSON.stringify(second.tools)).toBe(JSON.stringify((w.sent[0] as Row).tools));
});

test('a bad tool input or an unknown tool is an error result Claude can correct, not a crash', async () => {
  const w = world();
  w.claude.push(toolCall([['tu_1', 'list_leads', { status: 'hot' }], ['tu_2', 'delete_everything', {}], ['tu_3', 'get_record', { entity_type: 'lead', id: id(999) }]]));
  w.claude.push(text('Nem találtam.'));
  const r = await ask(w, { message: 'x' });
  expect(names(r.events).at(-1)).toBe('done');
  const results = messages(w)[2].content as Row[];
  expect(results.every((b) => b.is_error === true)).toBe(true);
  expect(String(results[0].content)).toContain('INVALID_INPUT: status must be one of');
  expect(String(results[1].content)).toContain('No tool named delete_everything');
  expect(String(results[2].content)).toContain('No such record');
});

test('out of steps for this request: `continue`, and the next request picks up from the stored tool results', async () => {
  h.LIMITS.stepsPerRequest = 1;
  const w = world();
  w.claude.push(toolCall([['tu_1', 'open_alerts', {}]]));
  const first = await ask(w, { message: 'Mi a helyzet?' });
  expect(names(first.events)).toEqual(['thread', 'step', 'tool', 'tool', 'continue']);
  expect(messages(w).map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);

  w.claude.push(text('Nincs nyitott figyelmeztetés.'));
  const thread = String(first.events[0].data.id);
  const second = await ask(w, { thread_id: thread, continue: true });
  expect(names(second.events)).toEqual(['thread', 'step', 'text', 'done']);
  expect(((w.sent[1] as Row).messages as Row[]).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  expect(messages(w).map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);

  // Nothing waits for an answer now: a continue is a no-op.
  const third = await ask(w, { thread_id: thread, continue: true });
  expect(names(third.events)).toEqual(['thread', 'done']);
  expect(w.sent).toHaveLength(2);
});

test('a model call still running at the hard limit is cut off: its text is discarded, nothing is stored, `continue`', async () => {
  h.LIMITS.hard = 300;
  const w = world();
  w.claude.push({ content: [], stop_reason: 'end_turn', hang: true });
  const r = await ask(w, { message: 'Hosszú kérdés' });
  expect(names(r.events)).toEqual(['thread', 'step', 'discard', 'continue']);
  expect(messages(w).map((m) => m.role)).toEqual(['user']);
});

test('tools an earlier request never ran are run first; the new message follows their results', async () => {
  const w = world({
    jarvis_threads: [{ id: id(50), user_id: U.owner, title: 'Régi', context_entity_type: null, context_entity_id: null, archived_at: null }],
    jarvis_messages: [
      { id: id(51), thread_id: id(50), role: 'user', content: [{ type: 'text', text: 'ctx' }, { type: 'text', text: 'Riasztások?' }], created_at: '2026-10-01T08:00:00.000Z' },
      { id: id(52), thread_id: id(50), role: 'assistant', content: [{ type: 'tool_use', id: 'tu_9', name: 'open_alerts', input: {} }], created_at: '2026-10-01T08:00:01.000Z' },
    ],
  });
  w.claude.push(text('Nincs riasztás. A pipeline-t is megnézzem?'));
  const r = await ask(w, { thread_id: id(50), message: 'És a pipeline?' });
  expect(names(r.events)).toEqual(['thread', 'tool', 'tool', 'step', 'text', 'done']);
  expect(messages(w).map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user', 'assistant']);
  const sent = (w.sent[0] as Row).messages as Row[];
  expect(sent.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'user']);
  expect((sent[2].content as Row[])[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_9' });
  // An existing thread's first message carried the memory; later ones do not ask for it again.
  expect(w.calls.some((c) => c.path === '/jarvis_memory')).toBe(false);
});

test('the daily budget: once spent, the small model answers, without the Sonnet-only options, and the person is told', async () => {
  const w = world({ jarvis_usage: [{ input_tokens: 1_500_000, output_tokens: 400_000, cache_write_tokens: 100_000, cache_read_tokens: 0 }] });
  w.claude.push({ ...text('Rendben.'), model: 'claude-haiku-5-5' });
  const r = await ask(w, { message: 'Szia' });
  expect(names(r.events)).toEqual(['thread', 'notice', 'step', 'text', 'done']);
  expect(r.events[1].data).toMatchObject({ code: 'BUDGET' });
  const req = w.sent[0] as Row;
  expect(req).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'low' } });
  expect(req.fallbacks).toBeUndefined();
  expect(req.thinking).toBeUndefined();
  expect(lib.spentToday([{ input_tokens: 10, output_tokens: 5, cache_write_tokens: 3, cache_read_tokens: 100 }])).toBe(28);
});

test('the rate limit counts the person\'s own messages of the last minute', async () => {
  const now = new Date().toISOString();
  const w = world({
    jarvis_settings: [{ daily_token_budget: 2_000_000, rate_limit_per_minute: 2, voice_enabled: true }],
    jarvis_messages: [{ id: id(61), role: 'user', created_at: now }, { id: id(62), role: 'user', created_at: now }],
  });
  const r = await ask(w, { message: 'Szia' });
  expect(r).toMatchObject({ status: 429, json: { ok: false, code: 'RATE_LIMIT' } });
  expect(w.sent).toHaveLength(0);
});

test('a refusal is stored and reported; API errors become an error event', async () => {
  const w = world();
  w.claude.push({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null } });
  const r = await ask(w, { message: 'x' });
  expect(names(r.events)).toEqual(['thread', 'step', 'refusal', 'done']);
  expect(r.events[2].data).toEqual({ category: 'cyber' });

  const w2 = world();
  w2.claude.push({ content: [], stop_reason: 'end_turn', status: 401 });
  const bad = await ask(w2, { message: 'x' });
  expect(bad.events.at(-1)).toEqual({ event: 'error', data: { code: 'API_AUTH' } });
  expect(messages(w2).map((m) => m.role)).toEqual(['user']);
});

test('after a server-side fallback, only what may be echoed is stored; usage counts every attempt', () => {
  const content = [
    { type: 'thinking', thinking: '', signature: 's1' }, { type: 'text', text: 'Rész' }, { type: 'tool_use', id: 't', name: 'x', input: {} },
    { type: 'fallback', from: { model: 'claude-sonnet-5-5' }, to: { model: 'claude-sonnet-5' } },
    { type: 'thinking', thinking: '', signature: 's2' }, { type: 'text', text: 'Válasz' },
  ];
  expect(lib.forReplay(content)).toEqual([content[1], content[4], content[5]]);
  expect(lib.forReplay([content[0], content[1]])).toEqual([content[0], content[1]]);
  expect(lib.usageOf({ usage: { input_tokens: 5, output_tokens: 1, iterations: [
    { type: 'message', input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 50 },
    { type: 'fallback_message', input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  ] } })).toEqual({ input_tokens: 105, output_tokens: 11, cache_read_tokens: 0, cache_write_tokens: 50 });
});

test('the read tools ask PostgREST for what they say, with the caller\'s token', async () => {
  const w = world({
    time_entries: [
      { work_date: '2026-10-01', hours: 2.5, project_id: id(201), label: null, note: null, user_id: U.owner },
      { work_date: '2026-10-02', hours: 1, project_id: null, label: 'Admin', note: null, user_id: U.owner },
    ],
    projects: [{ id: id(201), name: 'Web' }],
  });
  h.__net.fetch = backend(w) as typeof fetch;
  const ctx = { token: 'owner-token', role: 'owner' };

  await tools.runTool('crm_search', { text: 'Kiss, (Péter)*' }, ctx);
  const leads = w.calls.find((c) => c.path === '/leads');
  expect(leads?.params.get('or')).toBe('(name.ilike."*Kiss, (Péter)*",company.ilike."*Kiss, (Péter)*",email.ilike."*Kiss, (Péter)*",website.ilike."*Kiss, (Péter)*")');
  expect(w.calls.filter((c) => c.method === 'GET').map((c) => c.path).sort()).toEqual(['/client_contacts', '/leads', '/opportunities', '/organizations', '/projects']);

  const t = await tools.runTool('time_summary', { from: '2026-10-01', to: '2026-10-31' }, ctx);
  expect(JSON.parse(String(t.content))).toMatchObject({ total_hours: 3.5, by_work: { Web: 2.5, Admin: 1 }, by_person: { 'Lukács Artúr': 3.5 } });
  expect(t.label).toBe('Munkaidő · 3,5 óra');

  w.calls.length = 0;
  await tools.runTool('list_meetings', { from: '2026-10-25', to: '2026-10-25' }, ctx);
  const bookings = w.calls.find((c) => c.path === '/bookings');
  // 25 October 2026 is the day Budapest leaves summer time: it begins at +02:00 and ends at +01:00.
  expect(bookings?.params.getAll('starts_at')).toEqual(['gte.2026-10-24T22:00:00.000Z', 'lt.2026-10-25T23:00:00.000Z']);
  expect(bookings?.params.get('status')).toBe('eq.confirmed');

  w.calls.length = 0;
  await tools.runTool('list_opportunities', { next_action_overdue: true }, ctx);
  const deals = w.calls.find((c) => c.path === '/opportunities');
  expect(deals?.params.get('stage')).toBe('not.in.(won,lost)');
  expect(deals?.params.get('next_action_on')).toBe(`lt.${lib.budapestDate()}`);

  expect(w.calls.every((c) => c.auth === 'Bearer owner-token')).toBe(true);
  expect((await tools.runTool('payment_overview', { project_id: 'x' }, ctx)).is_error).toBe(true);
  expect((await tools.runTool('crm_search', { text: '***' }, ctx)).is_error).toBe(true);
});

test('every role\'s tool list is fixed; a long result is cut to fit and says so', () => {
  expect(tools.toolsFor('admin').map((t) => t.name)).toEqual(tools.toolsFor('owner').map((t) => t.name));
  expect(tools.toolsFor('client')).toEqual([]);
  const big = { rows: Array.from({ length: 2000 }, (_, i) => ({ i, text: 'x'.repeat(40) })) };
  const out = tools.fit(big);
  expect(out.length).toBeLessThanOrEqual(20_000);
  expect(JSON.parse(out).truncated.rows).toMatch(/^showing \d+/);
});

test('Budapest dates: midnight carries the right offset on both sides of a clock change', () => {
  expect(lib.budapestMidnight('2026-10-20')).toBe('2026-10-19T22:00:00.000Z');
  expect(lib.budapestMidnight('2026-11-02')).toBe('2026-11-01T23:00:00.000Z');
  // The clock changes at 02:00/03:00: both days still begin on the old offset.
  expect(lib.budapestMidnight('2026-03-29')).toBe('2026-03-28T23:00:00.000Z');
  expect(lib.budapestMidnight('2026-03-30')).toBe('2026-03-29T22:00:00.000Z');
  expect(lib.budapestMidnight('2026-10-25')).toBe('2026-10-24T22:00:00.000Z');
  expect(lib.budapestMidnight('2026-10-26')).toBe('2026-10-25T23:00:00.000Z');
  expect(lib.budapestDate(new Date('2026-10-19T22:30:00Z'))).toBe('2026-10-20');
  expect(lib.budapestDate(new Date('2026-10-30T12:00:00Z'), 3)).toBe('2026-11-02');
  const block = lib.contextBlock({ now: new Date('2026-10-20T07:14:00Z'), route: '/portal/today' });
  expect(block).toContain('09:14');
  expect(block).toContain('Képernyő: /portal/today');
});


/* ================================================================ writes (phase 5) */

async function op(w: World, body: Row, token = 'owner-token') {
  h.__net.fetch = backend(w) as typeof fetch;
  googleLib.__net.fetch = backend(w) as typeof fetch;
  const res = await h.default(new Request('https://stratosweb.hu/api/jarvis', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() as Row };
}
const actions = (w: World) => w.tables.jarvis_actions ?? [];
const writes = (w: World, path: string) => w.calls.filter((c) => c.path === path && c.method !== 'GET');

test('an internal write runs at once, is stored as an executed action with its undo, and the panel hears of it', async () => {
  const w = world();
  w.claude.push(toolCall([['tu_1', 'add_note', { entity_type: 'lead', entity_id: LEAD, body: '  Holnap visszahívni.  ' }]]));
  w.claude.push(text('Felírtam.'));
  const r = await ask(w, { message: 'Írd fel, hogy holnap visszahívom.' });
  expect(names(r.events)).toEqual(['thread', 'step', 'tool', 'tool', 'action', 'step', 'text', 'done']);

  const [note] = writes(w, '/lead_notes');
  expect(note.body).toEqual({ lead_id: LEAD, author_id: U.owner, body: 'Holnap visszahívni.' });
  expect(note.auth).toBe('Bearer owner-token');
  const [a] = actions(w);
  expect(a).toMatchObject({ tool: 'add_note', risk: 'internal', status: 'executed', summary: 'Jegyzet · lead: „Holnap visszahívni.”',
    payload: { entity_type: 'lead', entity_id: LEAD, body: 'Holnap visszahívni.' } });
  expect((a.result as Row).undo).toEqual({ table: 'lead_notes', id: (w.tables.lead_notes[0] as Row).id });
  expect(a.thread_id).toBe(w.tables.jarvis_threads[0].id);

  const action = r.events.find((e) => e.event === 'action')!.data as { tool_use_id: string; action: Row };
  expect(action.tool_use_id).toBe('tu_1');
  expect(action.action).toMatchObject({ tool: 'add_note', status: 'executed', undoable: true, reason: null });
  expect(action.action.result).toBeUndefined(); // the undo plan stays on the server
  const result = JSON.parse(String((messages(w)[2].content as Row[])[0].content));
  expect(result).toMatchObject({ status: 'done', action_id: a.id });
});

test('after the turn read outsiders\' text, an internal write waits for a person — but not one chosen side by side with that read', async () => {
  const w = world();
  w.claude.push(toolCall([['tu_1', 'get_record', { entity_type: 'lead', id: LEAD }], ['tu_2', 'add_note', { entity_type: 'lead', entity_id: LEAD, body: 'Egyszerre.' }]]));
  w.claude.push(toolCall([['tu_3', 'update_lead_status', { lead_id: LEAD, status: 'spam' }]]));
  w.claude.push(text('A státusz jóváhagyásra vár.'));
  const r = await ask(w, { message: 'Nézd meg, és kezeld le.' });
  expect(names(r.events).at(-1)).toBe('done');

  const [sideBySide, later] = actions(w);
  expect(sideBySide).toMatchObject({ tool: 'add_note', status: 'executed' });
  expect(later).toMatchObject({ tool: 'update_lead_status', status: 'pending', result: { reason: 'outside_text' }, summary: 'Lead státusza → spam' });
  expect(writes(w, '/leads')).toEqual([]);
  const result = JSON.parse(String((messages(w).at(-2)!.content as Row[])[0].content));
  expect(result).toMatchObject({ status: 'waiting_for_approval', action_id: later.id });
  const card = r.events.filter((e) => e.event === 'action').at(-1)!.data as { action: Row };
  expect(card.action).toMatchObject({ status: 'pending', reason: 'outside_text', undoable: false });
});

test('approve runs what was approved — the edited payload, checked again; reject and a second approve are refused', async () => {
  const w = world({ jarvis_actions: [
    { id: id(700), thread_id: id(50), user_id: U.owner, tool: 'add_note', risk: 'internal', status: 'pending', summary: 'Jegyzet · lead: „x”',
      payload: { entity_type: 'lead', entity_id: LEAD, body: 'Eredeti' }, result: { reason: 'outside_text' } },
    { id: id(701), thread_id: id(50), user_id: U.owner, tool: 'log_time', risk: 'internal', status: 'pending', summary: 'x',
      payload: { hours: 1, work_date: '2026-10-20', project_id: null, label: 'Admin', note: null }, result: { reason: 'outside_text' } },
  ] });
  const bad = await op(w, { op: 'approve', action_id: id(701), payload: { hours: 0.3, label: 'Admin' } });
  expect(bad).toMatchObject({ status: 422, json: { code: 'INVALID_INPUT', message: 'hours must be in quarter hours' } });
  expect(actions(w)[1].status).toBe('pending');

  const r = await op(w, { op: 'approve', action_id: id(700), payload: { entity_type: 'lead', entity_id: LEAD, body: 'Javított szöveg' } });
  expect(r.status).toBe(200);
  expect(r.json).toMatchObject({ ok: true, label: 'Jegyzet mentve' });
  const patches = writes(w, '/jarvis_actions').map((c) => c.body as Row);
  expect(patches[0]).toMatchObject({ status: 'approved', payload: { body: 'Javított szöveg' }, summary: 'Jegyzet · lead: „Javított szöveg”' });
  expect(patches[1]).toMatchObject({ status: 'executed', result: { reason: 'outside_text', undo: { table: 'lead_notes' } } });
  expect((writes(w, '/lead_notes')[0].body as Row).body).toBe('Javított szöveg');

  expect((await op(w, { op: 'approve', action_id: id(700) })).status).toBe(409);
  expect((await op(w, { op: 'reject', action_id: id(700) })).status).toBe(409);
  const rej = await op(w, { op: 'reject', action_id: id(701) });
  expect(rej).toMatchObject({ status: 200, json: { ok: true, action: { status: 'rejected' } } });
  expect(writes(w, '/time_entries')).toEqual([]);

  expect((await op(w, { op: 'approve', action_id: id(799) })).status).toBe(404);
  expect((await op(w, { op: 'delete', action_id: id(700) })).status).toBe(400);
  expect((await op(w, { op: 'approve', action_id: id(700) }, 'client-token')).status).toBe(403);
  expect(w.calls.every((c) => c.auth !== 'Bearer client-token' || ['/auth/v1/user', '/rpc/is_admin', '/rpc/is_owner'].includes(c.path))).toBe(true);
});

test('undo: a note is removed, a status is put back, a created lead goes to the Trash; only executed internal writes', async () => {
  const w = world({
    leads: [{ id: LEAD, name: 'Kiss Péter', company: 'Kiss Kft.', status: 'contacted' }],
    lead_notes: [{ id: id(801), lead_id: LEAD, body: 'x' }],
    jarvis_actions: [
      { id: id(710), tool: 'add_note', risk: 'internal', status: 'executed', summary: 's', payload: {}, result: { undo: { table: 'lead_notes', id: id(801) } } },
      { id: id(711), tool: 'update_lead_status', risk: 'internal', status: 'executed', summary: 's', payload: {}, result: { undo: { table: 'leads', id: LEAD, set: { status: 'new' } } } },
      { id: id(712), tool: 'create_lead', risk: 'internal', status: 'executed', summary: 's', payload: {}, result: { undo: { table: 'leads', id: LEAD, set: { trashed_at: { $now: true } } } } },
      { id: id(713), tool: 'add_note', risk: 'internal', status: 'pending', summary: 's', payload: {}, result: null },
    ],
  });
  expect((await op(w, { op: 'undo', action_id: id(710) })).json).toMatchObject({ ok: true, action: { status: 'reverted' } });
  expect(w.tables.lead_notes).toEqual([]);
  await op(w, { op: 'undo', action_id: id(711) });
  expect(w.tables.leads[0].status).toBe('new');
  await op(w, { op: 'undo', action_id: id(712) });
  expect(String(w.tables.leads[0].trashed_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect((actions(w)[2].result as Row).reverted_at).toBeTruthy();
  expect((await op(w, { op: 'undo', action_id: id(713) })).status).toBe(409);
  expect((await op(w, { op: 'undo', action_id: id(710) })).status).toBe(409);
});

test('the write tools check their input and the records they touch', async () => {
  const w = world({ leads: [{ id: LEAD, name: 'Kiss Péter', email: 'peter@example.invalid', status: 'new', trashed_at: null }] });
  h.__net.fetch = backend(w) as typeof fetch;
  const ctx = { token: 'owner-token', role: 'owner', userId: U.owner, threadId: null, tainted: false };
  const run = async (name: string, input: Row) => tools.runTool(name, input, ctx);

  const status = await run('update_lead_status', { lead_id: LEAD, status: 'contacted' });
  expect(status.label).toBe('Lead státusza: new → contacted');
  expect((actions(w).at(-1)!.result as Row).undo).toEqual({ table: 'leads', id: LEAD, set: { status: 'new' } });
  expect((await run('update_lead_status', { lead_id: id(999), status: 'won' })).is_error).toBe(true);

  const twin = await run('create_lead', { name: 'Másik Péter', email: 'PETER@example.invalid' });
  expect(twin.is_error).toBe(true);
  expect(String(twin.content)).toContain('exists already');
  const fresh = await run('create_lead', { name: 'Nagy Éva', email: 'eva@example.invalid', message: 'Weboldalt keres.' });
  expect(fresh.is_error).toBe(false);
  expect(writes(w, '/leads').at(-1)!.body).toMatchObject({ source: 'jarvis', status: 'new', meta: { jarvis_review: true, created_by: U.owner } });

  for (const [name, input, msg] of [
    ['log_time', { hours: 0.3, label: 'Admin' }, 'quarter hours'],
    ['log_time', { hours: 1 }, 'project_id or label is required'],
    ['log_interaction', { kind: 'call', summary: 'x' }, 'one of lead_id'],
    ['create_opportunity', { title: 'Web' }, 'organization_id or company_name'],
    ['update_opportunity', { id: id(5) }, 'nothing to change'],
    ['add_note', { entity_type: 'lead', entity_id: LEAD, body: 'x'.repeat(4001) }, 'longer than 4000'],
  ] as [string, Row, string][]) {
    const r = await run(name, input);
    expect(r.is_error, name).toBe(true);
    expect(String(r.content), name).toContain(msg);
  }

  // A task goes into the person's own Jarvis checklist, made the first time.
  const task = await run('create_task', { title: 'Ajánlatot küldeni', due_on: '2026-10-22' });
  expect(task.is_error).toBe(false);
  expect(writes(w, '/notes').at(-1)!.body).toEqual({ kind: 'checklist', title: 'Jarvis feladatai' });
  expect(writes(w, '/note_items').at(-1)!.body).toMatchObject({ text: 'Ajánlatot küldeni', due_on: '2026-10-22', position: 0 });
});

test('the next message tells Jarvis what the person decided meanwhile', async () => {
  const w = world({
    jarvis_threads: [{ id: id(50), user_id: U.owner, title: 'Régi', context_entity_type: null, context_entity_id: null, archived_at: null }],
    jarvis_messages: [
      { id: id(51), thread_id: id(50), role: 'user', content: [{ type: 'text', text: 'ctx' }, { type: 'text', text: 'Kezeld le.' }], created_at: '2026-10-01T08:00:00.000Z' },
      { id: id(52), thread_id: id(50), role: 'assistant', content: [{ type: 'text', text: 'Jóváhagyásra vár.' }], created_at: '2026-10-01T08:00:01.000Z' },
    ],
    jarvis_actions: [
      { id: id(720), thread_id: id(50), tool: 'update_lead_status', status: 'rejected', summary: 'Lead státusza → spam', error: null, decided_at: '2026-10-01T09:00:00.000Z' },
      { id: id(721), thread_id: id(50), tool: 'add_note', status: 'executed', summary: 'Jegyzet · lead: „x”', error: null, decided_at: '2026-10-01T09:01:00.000Z' },
    ],
  });
  w.claude.push(text('Rendben.'));
  await ask(w, { thread_id: id(50), message: 'Mi a helyzet?' });
  const block = String(((messages(w).at(-2)!.content as Row[])[0]).text);
  expect(block).toContain('A felhasználó döntései az előző üzenet óta:');
  expect(block).toContain('- Elvetve: Lead státusza → spam');
  expect(block).toContain('- Jóváhagyva, lefutott: Jegyzet · lead: „x”');
  const q = w.calls.find((c) => c.path === '/jarvis_actions' && c.method === 'GET');
  expect(q?.params.get('or')).toBe('(decided_at.gt."2026-10-01T08:00:00.000Z",result->>reverted_at.gt."2026-10-01T08:00:00.000Z")');
});


/* ================================================================ external (phase 6) */

const GOOGLE_ACCOUNT = (scopes: string) => ({
  user_id: U.owner, google_email: 'owner@stratos.example', scopes, last_error: null,
  refresh_token_enc: googleLib.sealToken('1//refresh-token'),
});
const ALL_SCOPES = 'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/gmail.compose';
const pendingExternal = (n: number, tool: string, payload: Row) => ({
  id: id(n), thread_id: id(50), user_id: U.owner, tool, risk: 'external', status: 'pending', summary: 's', payload, result: { reason: 'external' },
});

test('an external tool always waits — even in a turn that read nothing from outside — and proposing touches no Google', async () => {
  const w = world({ google_accounts: [GOOGLE_ACCOUNT(ALL_SCOPES)] });
  w.claude.push(toolCall([['tu_1', 'gmail_create_draft', { to: ['peter@example.invalid'], subject: 'Ajánlat', body: 'Kedves Péter,\n\ncsatolom.' }]]));
  w.claude.push(text('A piszkozat jóváhagyásra vár.'));
  await ask(w, { message: 'Írj neki e-mailt.' });
  const [a] = actions(w);
  expect(a).toMatchObject({ tool: 'gmail_create_draft', risk: 'external', status: 'pending', result: { reason: 'external' },
    summary: 'Gmail-piszkozat → peter@example.invalid: „Ajánlat”' });
  expect(w.google).toEqual([]);
  expect(w.calls.some((c) => c.auth === `Bearer ${ENV.SUPABASE_SECRET_KEY}`)).toBe(false);
});

test('approving a Gmail draft: the server key reads only the approver\'s own sealed token; the draft is plain UTF-8, never sent', async () => {
  const w = world({
    google_accounts: [GOOGLE_ACCOUNT(ALL_SCOPES)],
    jarvis_actions: [pendingExternal(730, 'gmail_create_draft', {
      to: ['peter@example.invalid'], cc: [], subject: 'Árajánlat — weboldal\r\nBcc: evil@example.invalid', body: 'Kedves Péter!\n\nÜdv,\nArtúr',
      lead_id: LEAD, organization_id: null, opportunity_id: null,
    })],
  });
  const r = await op(w, { op: 'approve', action_id: id(730) });
  expect(r.json).toMatchObject({ ok: true, label: 'Piszkozat a Gmailben · Árajánlat — weboldal Bcc: evil@example.…',
    action: { status: 'executed', link: 'https://mail.google.com/mail/u/0/#drafts', undoable: false } });

  const keyed = w.calls.filter((c) => c.auth === `Bearer ${ENV.SUPABASE_SECRET_KEY}`);
  expect(keyed.map((c) => `${c.method} ${c.path} ${c.params.get('user_id')}`)).toEqual([`GET /google_accounts eq.${U.owner}`]);
  const [token, draft] = w.google;
  expect(token.body).toMatchObject({ grant_type: 'refresh_token', refresh_token: '1//refresh-token', client_id: 'gid' });
  expect(draft).toMatchObject({ method: 'POST', path: '/gmail/v1/users/me/drafts', auth: 'Bearer ya29.test-access' });
  expect(w.google.some((c) => c.path.includes('/send'))).toBe(false);

  const mime = Buffer.from(String(((draft.body as Row).message as Row).raw), 'base64url').toString('utf8');
  const [head, body64] = mime.split('\r\n\r\n');
  expect(head.split('\r\n')).toEqual([
    'To: peter@example.invalid',
    `Subject: =?UTF-8?B?${Buffer.from('Árajánlat — weboldal Bcc: evil@example.invalid').toString('base64')}?=`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64',
  ]);
  expect(Buffer.from(body64.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe('Kedves Péter!\r\n\r\nÜdv,\r\nArtúr');
});

test('without the drafts permission the approval fails and says how to fix it; no token is fetched', async () => {
  const w = world({
    google_accounts: [GOOGLE_ACCOUNT('openid email https://www.googleapis.com/auth/gmail.readonly')],
    jarvis_actions: [pendingExternal(731, 'gmail_create_draft', { to: ['a@example.invalid'], cc: [], subject: 'x', body: 'y', lead_id: null, organization_id: null, opportunity_id: null })],
  });
  const r = await op(w, { op: 'approve', action_id: id(731) });
  expect(r.json).toMatchObject({ ok: false, action: { status: 'failed' } });
  expect(String(r.json.label)).toContain('connect Google again in Settings and allow it to manage Gmail drafts');
  expect(w.google).toEqual([]);
});

test('a project meeting goes through the Portal\'s own path: the meeting row (synced to Google within minutes) and the client notice', async () => {
  const w = world({ jarvis_actions: [pendingExternal(732, 'calendar_create_event', {
    title: 'Demó átbeszélése', start: '2026-12-01T09:00:00.000Z', minutes: 45, project_id: id(201), location: null, note: 'Hozd a kérdéseidet.',
    meet: true, invite_clients: true, attendees: [],
  })] });
  const r = await op(w, { op: 'approve', action_id: id(732) });
  expect(r.json).toMatchObject({ ok: true, label: 'Projektmeeting felvéve · 2026. 12. 01. 10:00' });
  const [meeting] = writes(w, '/project_meetings');
  expect(meeting.body).toEqual({
    project_id: id(201), title: 'Demó átbeszélése', starts_at: '2026-12-01T09:00:00.000Z', ends_at: '2026-12-01T09:45:00.000Z',
    time_zone: 'Europe/Budapest', location: 'Google Meet', client_note: 'Hozd a kérdéseidet.', google_meet: true, google_invite_clients: true,
  });
  expect(meeting.auth).toBe('Bearer owner-token');
  expect(writes(w, '/notification_outbox')[0].body).toEqual({ audience: 'client', kind: 'meeting_scheduled', project_id: id(201),
    payload: { title: 'Demó átbeszélése', starts_at: '2026-12-01T09:00:00.000Z', time_zone: 'Europe/Budapest' } });
  expect(w.google).toEqual([]);
});

test('an event without a project goes into the approver\'s own Google Calendar; attendees are e-mailed by Google', async () => {
  const w = world({
    google_accounts: [GOOGLE_ACCOUNT(ALL_SCOPES)],
    jarvis_actions: [pendingExternal(733, 'calendar_create_event', {
      title: 'Bemutatkozó hívás', start: '2026-12-02T13:30:00.000Z', minutes: 30, project_id: null, location: null, note: null,
      meet: true, invite_clients: false, attendees: ['peter@example.invalid'],
    })],
  });
  const r = await op(w, { op: 'approve', action_id: id(733) });
  expect(r.json).toMatchObject({ ok: true, action: { status: 'executed', link: 'https://www.google.com/calendar/event?eid=ZXYtMQ', meet: 'https://meet.google.com/abc-defg-hij' } });
  const event = w.google.find((c) => c.path.endsWith('/events'))!;
  expect(event.params.get('sendUpdates')).toBe('all');
  expect(event.params.get('conferenceDataVersion')).toBe('1');
  expect(event.body).toMatchObject({
    summary: 'Bemutatkozó hívás', start: { dateTime: '2026-12-02T13:30:00.000Z', timeZone: 'Europe/Budapest' },
    end: { dateTime: '2026-12-02T14:00:00.000Z' }, attendees: [{ email: 'peter@example.invalid' }],
    conferenceData: { createRequest: { conferenceSolutionKey: { type: 'hangoutsMeet' } } },
  });
  expect(writes(w, '/project_meetings')).toEqual([]);
});

test('a client message: the Portal\'s message and its notice; the calendar input rules', async () => {
  const w = world({ jarvis_actions: [pendingExternal(734, 'client_portal_message', { project_id: id(201), body: 'Elkészült a demó, várjuk a visszajelzést.' })] });
  expect((await op(w, { op: 'approve', action_id: id(734) })).json).toMatchObject({ ok: true, label: 'Üzenet elküldve a kliensportálon' });
  expect(writes(w, '/project_messages')[0].body).toEqual({ project_id: id(201), body: 'Elkészült a demó, várjuk a visszajelzést.' });
  expect(writes(w, '/notification_outbox')[0].body).toEqual({ audience: 'client', kind: 'message_posted', project_id: id(201),
    payload: { excerpt: 'Elkészült a demó, várjuk a visszajelzést.' } });

  h.__net.fetch = backend(w) as typeof fetch;
  const ctx = { token: 'owner-token', role: 'owner', userId: U.owner, threadId: null, tainted: false };
  for (const [input, msg] of [
    [{ title: 'x', start: '2020-01-01T10:00', meet: true }, 'in the future'],
    [{ title: 'x', start: 'jövő kedd', meet: true }, 'YYYY-MM-DDTHH:MM'],
    [{ title: 'x', start: '2026-12-01T10:00' }, 'give a location, or meet: true'],
    [{ title: 'x', start: '2026-12-01T10:00', meet: true, project_id: id(201), attendees: ['a@b.hu'] }, 'invite_clients'],
    [{ title: 'x', start: '2026-12-01T10:00', meet: true, invite_clients: true }, 'needs project_id'],
  ] as [Row, string][]) {
    const res = await tools.runTool('calendar_create_event', input, ctx);
    expect(res.is_error, msg).toBe(true);
    expect(String(res.content), msg).toContain(msg);
  }
  // 10:00 on Budapest's clock in December is 09:00 UTC.
  const ok = await tools.runTool('calendar_create_event', { title: 'Hívás', start: '2026-12-01T10:00', meet: true }, ctx);
  expect(JSON.parse(String(ok.content))).toMatchObject({ status: 'waiting_for_approval' });
  expect((actions(w).at(-1)!.payload as Row).start).toBe('2026-12-01T09:00:00.000Z');
});

test('free times come from the booking function itself, as the person, grouped by Budapest day', async () => {
  const seen: Request[] = [];
  const real = tools.__functions.booking;
  tools.__functions.booking = async (req: Request) => {
    seen.push(req);
    return reply(200, { ok: true, timeZone: 'Europe/Budapest', minutes: 30, slots: [
      { start: '2026-10-22T07:00:00.000Z', end: '2026-10-22T07:30:00.000Z' }, { start: '2026-10-22T07:30:00.000Z', end: '2026-10-22T08:00:00.000Z' },
      { start: '2026-10-23T12:00:00.000Z', end: '2026-10-23T12:30:00.000Z' }, { start: '2026-10-26T08:00:00.000Z', end: '2026-10-26T08:30:00.000Z' },
    ] });
  };
  try {
    const ctx = { token: 'owner-token', role: 'owner', userId: U.owner };
    const r = await tools.runTool('calendar_free_slots', { days: 2 }, ctx);
    expect(seen[0].headers.get('authorization')).toBe('Bearer owner-token');
    expect(JSON.parse(String(r.content))).toEqual({ time_zone: 'Europe/Budapest', minutes: 30, days: [
      { date: '2026-10-22', starts: ['09:00', '09:30'] }, { date: '2026-10-23', starts: ['14:00'] },
    ] });
    expect(r.label).toBe('Szabad időpontok · 3 kezdés, 2 nap');
    tools.__functions.booking = async () => reply(503, { ok: false, code: 'CALENDAR_RECONNECT' });
    const bad = await tools.runTool('calendar_free_slots', {}, ctx);
    expect(bad.is_error).toBe(true);
    expect(String(bad.content)).toContain('Google must be connected again in Settings');
  } finally {
    tools.__functions.booking = real;
  }
});
