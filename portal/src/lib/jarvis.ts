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
  | { event: 'continue'; data: Record<string, never> }
  | { event: 'refusal'; data: { category: string | null } }
  | { event: 'done'; data: { stop_reason: string; model: string } }
  | { event: 'error'; data: { code: string } };

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

export type ToolPart = { type: 'tool'; id: string; name: string; status: 'running' | 'done' | 'error'; label: string; input: Record<string, unknown> | null };
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

/** One stored conversation as the panel draws it. */
export async function loadThread(threadId: string): Promise<Turn[]> {
  const { data, error } = await supabase.from('jarvis_messages')
    .select('id, role, content, model')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(400);
  if (error) throw new Error('DB');
  return toTurns((data ?? []) as StoredMessage[]);
}

/** Stored messages → turns: the Portal's context block is not shown; tool calls become rows. */
export function toTurns(rows: StoredMessage[]): Turn[] {
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
        if (part && b.is_error) part.status = 'error';
      }
    }
  }
  return turns;
}

/** The parameters of a tool call, as short readable pairs. */
export function describeInput(input: Record<string, unknown> | null): string[] {
  if (!input) return [];
  return Object.entries(input).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`);
}
