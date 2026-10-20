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
const ENV = { SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: 'public-key', ANTHROPIC_API_KEY: 'sk-ant-test-key' };
const KEYS = [...Object.keys(ENV), 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
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
type World = { tables: Record<string, Row[]>; calls: Call[]; claude: Scripted[]; sent: Row[]; seq: number };

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
type Tools = { toolsFor: (r: string) => Row[]; runTool: (n: string, i: unknown, c: Row) => Promise<Row>; fit: (v: unknown) => string };

let h: Handler;
let lib: Lib;
let tools: Tools;
const DEFAULT_LIMITS = { soft: 38_000, hard: 50_000, stepsPerRequest: 6, stepsPerMessage: 12 };

test.beforeAll(async () => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, ENV);
  h = (await import('../netlify/functions/jarvis.mjs')) as unknown as Handler;
  lib = (await import('../netlify/functions/jarvis-lib.mjs')) as unknown as Lib;
  tools = (await import('../netlify/functions/jarvis-tools.mjs')) as unknown as Tools;
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
    calls: [], claude: [], sent: [], seq: 0,
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
      if (v.startsWith('gte.') && k === 'created_at') out = out.filter((r) => String(r[k]) >= v.slice(4));
    }
    const limit = Number(url.searchParams.get('limit'));
    if (limit) out = out.slice(0, limit);
    return reply(200, out);
  };
}

async function ask(w: World, body: Row, token = 'owner-token') {
  h.__net.fetch = backend(w) as typeof fetch;
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
    'revenue_report', 'payment_overview', 'open_alerts', 'email_search', 'list_meetings', 'time_summary',
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
