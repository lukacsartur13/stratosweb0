// =============================================================================
// /api/jarvis — the assistant's chat (JARVIS_SPEC.md §1, phase 3)
//
//   POST { message, thread_id?, context?: { route, entity_type, entity_id }, voice? }
//   POST { thread_id, continue: true }
//   Authorization: Bearer <the person's Supabase session>
//   → text/event-stream:
//       thread    { id, title, model, over_budget }
//       notice    { code, text }                  e.g. the daily budget is spent
//       step      { n }                           a model call begins
//       text      { delta }                       the reply, as it is written
//       discard   { n }                           drop step n's text (cut off by the time limit)
//       tool      { id, name, status, input?, label? }   running (with the input) → done | error (with a label)
//       continue  {}                              time is up: POST { thread_id, continue: true }
//       refusal   { category }
//       done      { stop_reason, model, usage }
//       error     { code }
//
// WHO: an admin (owner or admin), checked with GoTrue and is_admin() on every
// request. Everything Jarvis reads or writes goes through PostgREST with the
// person's own token: the Jarvis tables' RLS and every CRM table's RLS apply
// unchanged. No server key here.
//
// THE LOOP: Claude (Messages API, streaming, server-side) answers and calls
// the read tools (jarvis-tools.mjs) until it is done. Every step is stored the
// moment it is complete — the user's message, each assistant turn, each set of
// tool results — so the conversation is the database's, and a request that
// runs out of time loses nothing: a Netlify streaming function may run 60 s,
// so no model call starts after LIMITS.soft, one still running at LIMITS.hard
// is cut off (its text is discarded, it is not stored), and the client is told
// to `continue`. A turn whose tools were never run (the function stopped in
// between) has them run first on the next request.
//
// THE HISTORY IS APPEND-ONLY. The system prompt and the tool list are the same
// for every turn; what changes (time, screen, record, memory, voice) is the
// first block of each user message (jarvis-lib.mjs contextBlock). That keeps
// the prompt cache warm and the thinking blocks valid; a deploy that changes
// the prompt drops old thinking blocks instead of failing (block_binding).
//
// MODELS: claude-sonnet-5-5 at effort medium, with the server-side refusal
// fallback; once the day's token budget (jarvis_settings) is spent,
// claude-haiku-5-5 at effort low, and the person is told.
//
// Configuration (Netlify, Functions scope): ANTHROPIC_API_KEY; SUPABASE_URL
// and the public key, as for the other functions. Nothing personal is logged.
// =============================================================================
import Anthropic from '@anthropic-ai/sdk';
import {
  __net, cfg, rest, sessionUser, UUID, ENTITY_TYPES, budapestDate, systemPrompt, contextBlock,
  toApi, forReplay, toolUses, usageOf, spentToday,
} from './jarvis-lib.mjs';
import { toolsFor, runTool } from './jarvis-tools.mjs';

export { __net };

/** Time limits (ms from the start of the request) and step caps. The tests shorten them. */
export const LIMITS = { soft: 38_000, hard: 50_000, stepsPerRequest: 6, stepsPerMessage: 12 };

export const MODELS = {
  chat: {
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    betas: ['server-side-fallback-2026-07-01', 'thinking-binding-controls-2026-08-01'],
    extra: { fallbacks: 'default', thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } } },
  },
  budget: { model: 'claude-haiku-5-5', effort: 'low', betas: [], extra: {} },
};

const MAX_BODY = 64 * 1024;
const MAX_MESSAGE = 8000;
const MAX_HISTORY = 400;
const MAX_TOKENS = 16000;
const DEFAULTS = { daily_token_budget: 2_000_000, rate_limit_per_minute: 20, voice_enabled: true };
const ENTITY_WORD = { lead: 'lead', opportunity: 'deal', client: 'ügyfél', project: 'projekt' };

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store, max-age=0' },
});

class StopError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/* ============================================================== input */

function readInput(raw) {
  let b;
  try { b = JSON.parse(raw || '{}'); } catch { return null; }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const out = { continue: b.continue === true, voice: b.voice === true };
  if (b.thread_id !== undefined && b.thread_id !== null) {
    if (typeof b.thread_id !== 'string' || !UUID.test(b.thread_id)) return null;
    out.threadId = b.thread_id.toLowerCase();
  }
  if (!out.continue) {
    if (typeof b.message !== 'string') return null;
    out.message = b.message.trim();
    if (!out.message || out.message.length > MAX_MESSAGE) return null;
  } else if (!out.threadId) {
    return null;
  }
  const c = b.context;
  if (c && typeof c === 'object') {
    if (typeof c.route === 'string' && /^\/[^\s]{0,199}$/.test(c.route)) out.route = c.route;
    if (ENTITY_TYPES.includes(c.entity_type) && typeof c.entity_id === 'string' && UUID.test(c.entity_id)) {
      out.entity = { type: c.entity_type, id: c.entity_id.toLowerCase() };
    }
  }
  return out;
}

/* ================================================================= db */

async function rows(token, path, params) {
  const res = await rest(token, 'GET', path, { params });
  if (!res.ok) throw new StopError(res.status === 401 ? 'UNAUTHORIZED' : 'DB');
  return Array.isArray(res.body) ? res.body : [];
}

async function insert(token, table, row) {
  const res = await rest(token, 'POST', `/${table}`, { body: row, prefer: 'return=representation' });
  if (!res.ok || !Array.isArray(res.body) || !res.body[0]) {
    console.error('[jarvis] save', table, res.status);
    throw new StopError('SAVE_FAILED');
  }
  return res.body[0];
}

/** One line about a record for the context block: what it is, as this person sees it. */
async function describe(token, entity) {
  const q = {
    lead: ['/leads', 'name,company,status'], opportunity: ['/opportunities', 'title,company_name,stage'],
    client: ['/organizations', 'name,status'], project: ['/projects', 'name,status'],
  }[entity.type];
  const res = await rest(token, 'GET', q[0], { params: [['select', q[1]], ['id', `eq.${entity.id}`]] }).catch(() => null);
  const row = res?.ok && Array.isArray(res.body) ? res.body[0] : null;
  const word = ENTITY_WORD[entity.type];
  if (!row) return `${word} · id: ${entity.id} (ennek a fióknak nem látható)`;
  const name = row.name || row.title || '—';
  const extra = [row.company || row.company_name, row.status || row.stage ? `állapot: ${row.status || row.stage}` : null].filter(Boolean);
  return `${word} · ${name}${extra.length ? ` (${extra.join(', ')})` : ''} · id: ${entity.id}`;
}

/* ============================================================ handler */

export default async (request) => {
  if (request.method !== 'POST') return json(405, { ok: false, code: 'METHOD' });
  const c = cfg();
  if (!c.supabase || !c.publicKey) return json(503, { ok: false, code: 'NOT_CONFIGURED' });
  if (!c.anthropicKey) return json(503, { ok: false, code: 'ANTHROPIC_NOT_CONFIGURED' });

  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '')?.[1]?.trim();
  if (!token) return json(401, { ok: false, code: 'UNAUTHORIZED' });
  const raw = await request.text().catch(() => '');
  if (raw.length > MAX_BODY) return json(413, { ok: false, code: 'TOO_LARGE' });
  const input = readInput(raw);
  if (!input) return json(400, { ok: false, code: 'INPUT' });

  const started = Date.now();
  let me;
  let role;
  try {
    const [user, admin, owner] = await Promise.all([
      sessionUser(token),
      rest(token, 'POST', '/rpc/is_admin', { body: {} }),
      rest(token, 'POST', '/rpc/is_owner', { body: {} }),
    ]);
    if (!user) return json(401, { ok: false, code: 'UNAUTHORIZED' });
    if (!(admin.ok && admin.body === true)) return json(403, { ok: false, code: 'FORBIDDEN' });
    me = user;
    role = owner.ok && owner.body === true ? 'owner' : 'admin';
  } catch {
    return json(503, { ok: false, code: 'UNREACHABLE' });
  }

  let settings;
  let thread;
  let history;
  let profile;
  let spent;
  try {
    const [s, usage, p] = await Promise.all([
      rows(token, '/jarvis_settings', [['select', 'daily_token_budget,rate_limit_per_minute,voice_enabled']]),
      rows(token, '/jarvis_usage', [['select', 'input_tokens,output_tokens,cache_read_tokens,cache_write_tokens'], ['day', `eq.${budapestDate()}`]]),
      rows(token, '/profiles', [['select', 'full_name,email'], ['id', `eq.${me.id}`]]),
    ]);
    settings = { ...DEFAULTS, ...(s[0] ?? {}) };
    spent = spentToday(usage);
    profile = p[0] ?? {};

    if (input.message) {
      const since = new Date(started - 60_000).toISOString();
      const recent = await rows(token, '/jarvis_messages', [['select', 'id'], ['role', 'eq.user'], ['created_at', `gte.${since}`],
        ['limit', String(settings.rate_limit_per_minute)]]);
      if (recent.length >= settings.rate_limit_per_minute) return json(429, { ok: false, code: 'RATE_LIMIT' });
    }

    if (input.threadId) {
      [thread] = await rows(token, '/jarvis_threads', [['select', 'id,title,context_entity_type,context_entity_id,archived_at'], ['id', `eq.${input.threadId}`]]);
      if (!thread) return json(404, { ok: false, code: 'THREAD' });
      history = await rows(token, '/jarvis_messages', [['select', 'id,role,content'], ['thread_id', `eq.${thread.id}`],
        ['order', 'created_at.asc,id.asc'], ['limit', String(MAX_HISTORY + 1)]]);
      if (history.length > MAX_HISTORY) return json(409, { ok: false, code: 'THREAD_TOO_LONG' });
    } else {
      thread = await insert(token, 'jarvis_threads', {
        title: input.message.replace(/\s+/g, ' ').slice(0, 80),
        context_entity_type: input.entity?.type ?? null,
        context_entity_id: input.entity?.id ?? null,
      });
      history = [];
    }
  } catch (e) {
    return json(e instanceof StopError && e.code === 'UNAUTHORIZED' ? 401 : 503, { ok: false, code: e instanceof StopError ? e.code : 'UNREACHABLE' });
  }

  const overBudget = spent >= settings.daily_token_budget;
  const m = overBudget ? MODELS.budget : MODELS.chat;
  const voice = input.voice && settings.voice_enabled !== false;
  const tools = toolsFor(role);
  const system = systemPrompt({ fullName: profile.full_name || profile.email || me.email });
  const client = new Anthropic({ apiKey: c.anthropicKey, fetch: (...args) => __net.fetch(...args), maxRetries: 1 });
  const ctx = { token, role, userId: me.id };

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (event, data) => {
        if (!open) return;
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { open = false; }
      };
      const total = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };
      const stats = { steps: 0, tools: 0, stop: null, model: m.model };

      /** Runs the tool calls of an assistant turn and stores their results as one 'tool' message. */
      const runTools = async (calls) => {
        const results = await Promise.all(calls.map(async (call) => {
          // The parameters, so the Portal's tool row can show what was asked (the person's own query).
          const input = JSON.stringify(call.input ?? {});
          send('tool', { id: call.id, name: call.name, status: 'running', input: input.length <= 500 ? call.input : null });
          const r = await runTool(call.name, call.input, ctx);
          send('tool', { id: call.id, name: call.name, status: r.is_error ? 'error' : 'done', label: r.label });
          return { type: 'tool_result', tool_use_id: call.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) };
        }));
        stats.tools += calls.length;
        history.push(await insert(token, 'jarvis_messages', { thread_id: thread.id, role: 'tool', content: results }));
      };

      try {
        send('thread', { id: thread.id, title: thread.title, model: m.model, over_budget: overBudget });
        if (overBudget) send('notice', { code: 'BUDGET', text: 'A mai tokenkeret elfogyott: ma a kisebb modell (Haiku) válaszol.' });

        // A turn whose tools never ran: run them before anything else.
        const last = history[history.length - 1];
        if (last?.role === 'assistant' && toolUses(last.content).length > 0) await runTools(toolUses(last.content));

        if (input.message) {
          const entity = input.entity
            ?? (thread.context_entity_type ? { type: thread.context_entity_type, id: thread.context_entity_id } : null);
          let memory = [];
          if (history.length === 0) {
            const scopes = ['global', ...(entity ? [`"${entity.type}:${entity.id}"`] : [])];
            memory = await rows(token, '/jarvis_memory', [['select', 'scope,fact'], ['approved', 'is.true'], ['archived_at', 'is.null'],
              ['scope', `in.(${scopes.join(',')})`], ['order', 'created_at.asc'], ['limit', '50']]).catch(() => []);
          }
          const context = contextBlock({ route: input.route, entity: entity ? await describe(token, entity) : null, memory, voice });
          history.push(await insert(token, 'jarvis_messages', {
            thread_id: thread.id, role: 'user',
            content: [{ type: 'text', text: context }, { type: 'text', text: input.message }],
          }));
        } else if (history.length === 0 || history[history.length - 1].role === 'assistant') {
          // Nothing waits for an answer.
          send('done', { stop_reason: 'end_turn', model: m.model, usage: total });
          return;
        }

        const lastUser = history.map((r) => r.role).lastIndexOf('user');
        let stepsSinceUser = history.slice(lastUser + 1).filter((r) => r.role === 'assistant').length;
        let jsonRetries = 0;

        for (;;) {
          if (stepsSinceUser >= LIMITS.stepsPerMessage) throw new StopError('TOO_MANY_STEPS');
          if (stats.steps >= LIMITS.stepsPerRequest || Date.now() - started > LIMITS.soft) {
            send('continue', {});
            stats.stop = 'continue';
            break;
          }
          stats.steps += 1;
          send('step', { n: stats.steps });

          const abort = new AbortController();
          const timer = setTimeout(() => abort.abort(), Math.max(0, LIMITS.hard - (Date.now() - started)));
          const stream = client.beta.messages.stream({
            model: m.model,
            max_tokens: MAX_TOKENS,
            system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
            tools,
            messages: toApi(history),
            cache_control: { type: 'ephemeral' },
            output_config: { effort: m.effort },
            ...m.extra,
            ...(m.betas.length ? { betas: m.betas } : {}),
          }, { signal: abort.signal });
          stream.on('text', (delta) => send('text', { delta }));

          let msg;
          try {
            msg = await stream.finalMessage();
            jsonRetries = 0;
          } catch (e) {
            if (abort.signal.aborted) {
              send('discard', { n: stats.steps });
              send('continue', {});
              stats.stop = 'continue';
              break;
            }
            if (e instanceof Anthropic.APIError) throw e;
            // A tool input that could not be parsed at all (eager input streaming): ask again, twice at most.
            if (jsonRetries++ < 2) { send('discard', { n: stats.steps }); continue; }
            throw new StopError('BAD_TOOL_INPUT');
          } finally {
            clearTimeout(timer);
          }

          const content = forReplay(msg.content);
          const calls = toolUses(content);
          // A tool input cut off by max_tokens may still parse: never run it.
          if (msg.stop_reason === 'max_tokens' && calls.length > 0) throw new StopError('MAX_TOKENS');

          const used = usageOf(msg);
          for (const k of Object.keys(total)) total[k] += used[k];
          stats.model = msg.model;
          history.push(await insert(token, 'jarvis_messages', { thread_id: thread.id, role: 'assistant', content, model: msg.model, ...used }));
          stepsSinceUser += 1;

          if (msg.stop_reason === 'refusal') {
            send('refusal', { category: msg.stop_details?.category ?? null });
            send('done', { stop_reason: 'refusal', model: msg.model, usage: total });
            stats.stop = 'refusal';
            break;
          }
          if (msg.stop_reason === 'pause_turn') continue;
          if (calls.length === 0) {
            send('done', { stop_reason: msg.stop_reason, model: msg.model, usage: total });
            stats.stop = msg.stop_reason;
            break;
          }
          if (Date.now() - started > LIMITS.hard) {
            // Stored; its tools run first on the next request.
            send('continue', {});
            stats.stop = 'continue';
            break;
          }
          await runTools(calls);
        }
      } catch (e) {
        let code = 'ERROR';
        if (e instanceof StopError) code = e.code;
        else if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) code = 'API_AUTH';
        else if (e instanceof Anthropic.RateLimitError) code = 'API_RATE_LIMIT';
        else if (e instanceof Anthropic.APIError) code = e.status === 529 || e.status === 503 ? 'API_OVERLOADED' : 'API_ERROR';
        if (!(e instanceof StopError) && !(e instanceof Anthropic.APIError)) console.error('[jarvis] loop', e?.name ?? 'error');
        send('error', { code });
        stats.stop = code;
      } finally {
        console.log('[jarvis]', JSON.stringify({ role, ...stats, ms: Date.now() - started, ...total }));
        open = false;
        try { controller.close(); } catch { /* the client is gone */ }
      }
    },
  });

  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
  });
};

export const config = { path: '/api/jarvis' };
