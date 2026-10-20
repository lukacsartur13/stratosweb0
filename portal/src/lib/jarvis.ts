import { supabase } from '@/lib/supabase';
import { t } from '@/lib/i18n';

/**
 * Jarvis in the Portal (supabase/JARVIS.md): the client of /api/jarvis and
 * the reading of stored conversations.
 *
 * The server streams server-sent events (netlify/functions/jarvis.mjs). A
 * request may end with `continue` — the function's time is up but the work is
 * not — and `send()` then asks again on its own, so the panel sees one answer.
 * Conversations are read back from `jarvis_threads` / `jarvis_messages`
 * directly: RLS gives each person their own and nothing else.
 */

export type EntityType = 'lead' | 'opportunity' | 'client' | 'project';
export type Entity = { type: EntityType; id: string };

export type JarvisEvent =
  | { event: 'thread'; data: { id: string; title: string | null; model: string; over_budget: boolean } }
  | { event: 'notice'; data: { code: string; text: string } }
  | { event: 'step'; data: { n: number } }
  | { event: 'text'; data: { delta: string } }
  | { event: 'discard'; data: { n: number } }
  | { event: 'tool'; data: { id: string; name: string; status: 'running' | 'done' | 'error'; input?: Record<string, unknown> | null; label?: string } }
  | { event: 'action'; data: { tool_use_id: string; action: ActionState } }
  | { event: 'continue'; data: Record<string, never> }
  | { event: 'refusal'; data: { category: string | null } }
  | { event: 'done'; data: { stop_reason: string; model: string } }
  | { event: 'error'; data: { code: string } };

/** A write Jarvis made or proposes (jarvis_actions), as the server shows it (jarvis-writes.mjs publicAction). */
export type ActionState = {
  id: string; thread_id?: string | null; tool: string; risk: 'internal' | 'external';
  status: 'pending' | 'approved' | 'executed' | 'rejected' | 'failed' | 'reverted';
  summary: string; payload: Record<string, unknown>; reason: 'outside_text' | 'external' | null; error: string | null; undoable: boolean;
  /** Where the result is, in the person's own Google (a draft, an event), and its Meet link. */
  link?: string | null; meet?: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTEXT_MARK = '[Portál-kontextus';
const MAX_CONTINUES = 8;

/** The record a Portal screen is about, from its path (without the /portal base). */
export function entityFromPath(pathname: string): Entity | null {
  const m = /^\/(leads|sales|clients|projects)\/([^/]+)\/?$/.exec(pathname);
  if (!m || !UUID.test(m[2])) return null;
  const type = ({ leads: 'lead', sales: 'opportunity', clients: 'client', projects: 'project' } as const)[m[1] as 'leads'];
  return { type, id: m[2].toLowerCase() };
}

export const ENTITY_LABEL: Record<EntityType, string> = { lead: 'Lead', opportunity: 'Opportunity', client: 'Client', project: 'Project' };

/** What each read tool is, for rows read back from a stored conversation (the live rows carry the server's label). */
export const TOOL_LABEL: Record<string, string> = {
  crm_search: 'Search',
  get_record: 'Record opened',
  list_leads: 'Leads queried',
  list_opportunities: 'Deals queried',
  list_projects: 'Projects queried',
  pipeline_summary: 'Pipeline queried',
  revenue_report: 'Revenue report',
  payment_overview: 'Payments queried',
  open_alerts: 'Open alerts',
  email_search: 'E-mails searched',
  list_meetings: 'Calendar queried',
  time_summary: 'Hours queried',
  add_note: 'Note',
  log_interaction: 'Activity',
  update_lead_status: 'Lead status',
  create_opportunity: 'New deal',
  update_opportunity: 'Deal changed',
  create_task: 'Task',
  log_time: 'Hours',
  create_lead: 'New lead',
  calendar_free_slots: 'Free times',
  gmail_create_draft: 'Gmail draft',
  calendar_create_event: 'Calendar event',
  client_portal_message: 'Client message',
};
export const toolLabel = (name: string) => t(TOOL_LABEL[name] ?? 'Tool: {name}', { name });

/** What a failed request means, for the person. */
export function errorText(code: string): string {
  switch (code) {
    case 'UNAUTHORIZED': return t('Your session has expired. Sign in again.');
    case 'FORBIDDEN': return t('Jarvis is for the owner and admins.');
    case 'RATE_LIMIT': return t('Too many messages in a minute. Wait a moment, then send it again.');
    case 'ANTHROPIC_NOT_CONFIGURED': return t('Jarvis is not set up on this deployment: the Claude API key is missing.');
    case 'API_AUTH': return t('The Claude API refused the key. Check ANTHROPIC_API_KEY in Netlify.');
    case 'API_RATE_LIMIT':
    case 'API_OVERLOADED': return t('Claude is busy right now. Try again in a minute.');
    case 'TOO_MANY_STEPS': return t('This took too many steps. Ask a narrower question.');
    case 'THREAD_TOO_LONG': return t('This conversation is too long. Start a new one.');
    case 'TOO_LONG': return t('This is taking too long. Ask again, or ask a narrower question.');
    case 'THREAD': return t('This conversation is no longer available.');
    case 'OFFLINE': return t('The Portal could not be reached. Check the connection and try again.');
    default: return t('Something went wrong. Try again.');
  }
}

/** The events of one text/event-stream response, as they arrive. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<JarvisEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let cut = buffer.indexOf('\n\n');
    while (cut >= 0) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let event = '';
      let data = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (event) {
        try { yield { event, data: JSON.parse(data || '{}') } as JarvisEvent; } catch { /* a malformed event is skipped */ }
      }
      cut = buffer.indexOf('\n\n');
    }
    if (done) return;
  }
}

export type SendInput = { message: string; threadId: string | null; route: string; entity: Entity | null };

/** A failed request: its code, and whether the server had started (so the message is stored and can be resumed). */
export class JarvisError extends Error {
  constructor(readonly code: string, readonly started: boolean) { super(code); }
}

/**
 * One message, to the end of its answer: every event goes to `onEvent`,
 * including those of the follow-up requests a `continue` asks for. Resolves
 * with the thread id, or throws a JarvisError.
 */
export function send(input: SendInput, onEvent: (e: JarvisEvent) => void, signal?: AbortSignal): Promise<string> {
  return run({
    message: input.message,
    ...(input.threadId ? { thread_id: input.threadId } : {}),
    context: { route: input.route, ...(input.entity ? { entity_type: input.entity.type, entity_id: input.entity.id } : {}) },
  }, input.threadId, onEvent, signal);
}

/** Picks up a stored conversation whose answer was cut short (an error after the message was stored). */
export function resume(threadId: string, onEvent: (e: JarvisEvent) => void, signal?: AbortSignal): Promise<string> {
  return run({ thread_id: threadId, continue: true }, threadId, onEvent, signal);
}

async function run(first: Record<string, unknown>, knownThread: string | null, onEvent: (e: JarvisEvent) => void, signal?: AbortSignal) {
  let threadId = knownThread;
  let body = first;
  let started = false;
  for (let round = 0; round <= MAX_CONTINUES; round += 1) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new JarvisError('UNAUTHORIZED', started);
    let res: Response;
    try {
      res = await fetch('/api/jarvis', {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw new JarvisError('OFFLINE', started);
    }
    if (!res.ok || !res.body || !(res.headers.get('content-type') ?? '').startsWith('text/event-stream')) {
      const failed = await res.json().catch(() => null) as { code?: string } | null;
      throw new JarvisError(failed?.code ?? `HTTP_${res.status}`, started);
    }
    started = true;
    let again = false;
    try {
      for await (const e of readEvents(res.body)) {
        if (e.event === 'thread') threadId = e.data.id;
        if (e.event === 'continue') { again = true; continue; }
        if (e.event === 'error') throw new JarvisError(e.data.code, true);
        onEvent(e);
      }
    } catch (e) {
      if (e instanceof JarvisError || (e as Error)?.name === 'AbortError') throw e;
      throw new JarvisError('OFFLINE', true);
    }
    if (!again) return threadId ?? '';
    body = { thread_id: threadId, continue: true };
  }
  throw new JarvisError('TOO_LONG', true);
}

/* ======================================================== stored turns */

export type ToolPart = { type: 'tool'; id: string; name: string; status: 'running' | 'done' | 'error'; label: string; input: Record<string, unknown> | null; action?: ActionState };
export type TextPart = { type: 'text'; step: number; text: string };
export type Turn =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; parts: (TextPart | ToolPart)[]; model?: string; refusal?: boolean }
  | { kind: 'notice'; id: string; text: string; tone: 'warn' | 'danger' };

export type ThreadSummary = { id: string; title: string | null; updated_at: string; context_entity_type: EntityType | null };

type Block = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; is_error?: boolean };
type StoredMessage = { id: string; role: 'user' | 'assistant' | 'tool'; content: Block[]; model: string | null };

/** The person's conversations, newest first (RLS: their own). */
export async function listThreads(): Promise<ThreadSummary[]> {
  const { data, error } = await supabase.from('jarvis_threads')
    .select('id, title, updated_at, context_entity_type')
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(30);
  if (error) throw new Error('DB');
  return (data ?? []) as ThreadSummary[];
}

/** One stored conversation as the panel draws it, with the current state of its writes. */
export async function loadThread(threadId: string): Promise<Turn[]> {
  const [messages, writes] = await Promise.all([
    supabase.from('jarvis_messages').select('id, role, content, model').eq('thread_id', threadId)
      .order('created_at', { ascending: true }).limit(400),
    supabase.from('jarvis_actions').select(ACTION_COLUMNS).eq('thread_id', threadId).limit(200),
  ]);
  if (messages.error) throw new Error('DB');
  const byId = new Map(((writes.data ?? []) as StoredAction[]).map((a) => [a.id, toAction(a)]));
  return toTurns((messages.data ?? []) as StoredMessage[], byId);
}

/* ============================================================ actions */

type StoredAction = Omit<ActionState, 'reason' | 'undoable' | 'link' | 'meet'> & { result: { reason?: string; undo?: unknown; data?: { link?: string; meet?: string } } | null };

/** Only links to the person's own Gmail, Calendar or Meet are drawn as links (jarvis-writes.mjs googleLink). */
const GOOGLE_HOSTS = ['mail.google.com', 'calendar.google.com', 'www.google.com', 'meet.google.com'];
export function googleLink(v: unknown): string | null {
  try {
    const u = new URL(String(v ?? ''));
    return u.protocol === 'https:' && GOOGLE_HOSTS.includes(u.hostname) ? u.href : null;
  } catch { return null; }
}
const ACTION_COLUMNS = 'id, thread_id, tool, risk, status, summary, payload, result, error, created_at';

const toAction = (a: StoredAction): ActionState => ({
  id: a.id, thread_id: a.thread_id ?? null, tool: a.tool, risk: a.risk, status: a.status, summary: a.summary, payload: a.payload ?? {},
  reason: (a.result?.reason as ActionState['reason']) ?? null, error: a.error ?? null,
  undoable: a.status === 'executed' && a.risk === 'internal' && !!a.result?.undo,
  link: googleLink(a.result?.data?.link), meet: googleLink(a.result?.data?.meet),
});

/** Writes waiting for a decision (RLS: the owner sees all of them, an admin their own), newest first. */
export async function listPending(): Promise<ActionState[]> {
  const { data, error } = await supabase.from('jarvis_actions').select(ACTION_COLUMNS).eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(50);
  if (error) throw new Error('DB');
  return ((data ?? []) as StoredAction[]).map(toAction);
}

/** How many writes wait for a decision: the number on the Jarvis button. */
export async function pendingCount(): Promise<number> {
  const { count, error } = await supabase.from('jarvis_actions').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  return error ? 0 : count ?? 0;
}

export type Decision = { ok: true; action: ActionState; label?: string } | { ok: false; code: string; message?: string; action?: ActionState };

/** A decision on one action: approve (optionally edited), reject, or undo. Never throws. */
export async function decide(op: 'approve' | 'reject' | 'undo', actionId: string, payload?: Record<string, unknown>): Promise<Decision> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, code: 'UNAUTHORIZED' };
  try {
    const res = await fetch('/api/jarvis', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ op, action_id: actionId, ...(payload ? { payload } : {}) }),
    });
    const body = await res.json().catch(() => null) as { ok?: boolean; code?: string; message?: string; label?: string; action?: ActionState } | null;
    if (res.ok && body?.action) {
      return body.ok ? { ok: true, action: body.action, label: body.label } : { ok: false, code: 'FAILED', message: body.label, action: body.action };
    }
    return { ok: false, code: body?.code ?? `HTTP_${res.status}`, message: body?.message, action: body?.action };
  } catch {
    return { ok: false, code: 'OFFLINE' };
  }
}

/** Stored messages → turns: the Portal's context block is not shown; tool calls become rows, writes their cards. */
export function toTurns(rows: StoredMessage[], actions: Map<string, ActionState> = new Map()): Turn[] {
  const turns: Turn[] = [];
  let current: Extract<Turn, { kind: 'assistant' }> | null = null;
  const tools = new Map<string, ToolPart>();
  for (const row of rows) {
    const blocks = Array.isArray(row.content) ? row.content : [];
    if (row.role === 'user') {
      const said = blocks.filter((b) => b.type === 'text' && typeof b.text === 'string' && !b.text.startsWith(CONTEXT_MARK)).map((b) => b.text).join('\n\n');
      turns.push({ kind: 'user', id: row.id, text: said });
      current = null;
    } else if (row.role === 'assistant') {
      if (!current) {
        current = { kind: 'assistant', id: row.id, parts: [] };
        turns.push(current);
      }
      current.model = row.model ?? undefined;
      for (const b of blocks) {
        if (b.type === 'text' && b.text) current.parts.push({ type: 'text', step: 0, text: b.text });
        if (b.type === 'tool_use' && b.id && b.name) {
          const part: ToolPart = { type: 'tool', id: b.id, name: b.name, status: 'done', label: toolLabel(b.name), input: b.input ?? null };
          tools.set(b.id, part);
          current.parts.push(part);
        }
      }
    } else {
      for (const b of blocks) {
        const part = b.tool_use_id ? tools.get(b.tool_use_id) : undefined;
        if (!part) continue;
        if (b.is_error) part.status = 'error';
        // A write's result names its action: the card shows that action as it is now.
        let id: unknown = null;
        try { id = (JSON.parse(String((b as { content?: unknown }).content ?? '')) as { action_id?: unknown }).action_id; } catch { id = null; }
        const action = typeof id === 'string' ? actions.get(id) : undefined;
        if (action) part.action = action;
      }
    }
  }
  return turns;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** An instant on Budapest's clock, as an <input type="datetime-local"> holds it: "YYYY-MM-DDTHH:MM". */
export function budapestInput(iso: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export const isInstant = (v: unknown): v is string => typeof v === 'string' && ISO_INSTANT.test(v) && !Number.isNaN(Date.parse(v));

/** The parameters of a tool call, as short readable pairs (times on Budapest's clock). */
export function describeInput(input: Record<string, unknown> | null): string[] {
  if (!input) return [];
  return Object.entries(input).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ')
    : isInstant(v) ? `${budapestInput(v).replace('T', ' ')} (Budapest)`
      : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`);
}
