import { useCallback, useEffect, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';
import { useRpc } from '@/lib/clientPortal';
import type { HelpArticle } from '@/lib/helpMatcher';

/**
 * What a client sees of a project beyond files: demo links and meetings — and
 * the help centre's articles. 20261004000100_client_demos_meetings_help.sql.
 *
 * OWNER side: the tables, owner-only by RLS. Nothing is ever deleted: a demo is
 * revoked, a meeting cancelled, an article set back to draft.
 * CLIENT side: only the `client_*` functions, which return fixed columns for
 * the caller's CURRENT assignments (published demos, meetings not yet over,
 * published articles). No table is read from the client.
 */

export interface Demo {
  id: string; project_id: string; title: string; url: string; client_note: string | null;
  published: boolean; revoked_at: string | null; position: number; updated_at: string;
}
export interface Meeting {
  id: string; project_id: string; title: string; starts_at: string; ends_at: string; time_zone: string;
  join_url: string | null; location: string | null; client_note: string | null; cancelled_at: string | null; updated_at: string;
}
export interface OwnerHelpArticle {
  id: string; slug: string | null; question: string; answer: string; topic: string; alt_questions: string[];
  source: string | null; status: 'published' | 'draft'; review_note: string | null; position: number; updated_at: string;
}

type State = 'loading' | 'ready' | 'error' | 'unconfigured';

/** The database's refusals for this phase, in words. Never the raw text. */
export function clientViewRefusal(error: { code?: string | null; message?: string | null } | null): string {
  const m = error?.message ?? '';
  if (/portal_safe_https_url|project_demos_url_check|join_url/.test(m)) return 'The link must be a plain https:// address (no spaces, no user name or password in it).';
  if (/stratos:meeting_time_zone/.test(m)) return 'Unknown time zone.';
  if (/project_meetings_check|ends_at/.test(m)) return 'The end must be after the start, within 24 hours, and a join link or a place is needed.';
  if (error?.code === '23514') return 'The database refused those values. Check the lengths and the link.';
  if (error?.code === '42501') return 'Only the portal owner can change this.';
  if (error?.code === 'PGRST205' || error?.code === 'PGRST202') return 'This feature is not installed on the database yet (20261004000100).';
  return 'The change could not be saved. Try again.';
}

function useOwnerRows<T>(table: string, columns: string, projectId: string | undefined, order: string, reloadToken: number) {
  const [rows, setRows] = useState<T[]>([]);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    let q = supabase.from(table).select(columns).order(order, { ascending: true });
    if (projectId) q = q.eq('project_id', projectId);
    const { data, error } = await q;
    if (error) { console.error(`[${table}]`, error.code); setMessage(clientViewRefusal(error)); setState('error'); return; }
    setRows((data ?? []) as T[]);
    setState('ready');
  }, [table, columns, projectId, order, reloadToken]);
  useEffect(() => { void load(); }, [load]);
  return { rows, state, message, reload: load };
}

export const useProjectDemos = (projectId: string, t = 0) => useOwnerRows<Demo>('project_demos',
  'id, project_id, title, url, client_note, published, revoked_at, position, updated_at', projectId, 'position', t);
export const useProjectMeetings = (projectId: string, t = 0) => useOwnerRows<Meeting>('project_meetings',
  'id, project_id, title, starts_at, ends_at, time_zone, join_url, location, client_note, cancelled_at, updated_at', projectId, 'starts_at', t);
export const useHelpArticlesOwner = (t = 0) => useOwnerRows<OwnerHelpArticle>('help_articles',
  'id, slug, question, answer, topic, alt_questions, source, status, review_note, position, updated_at', undefined, 'position', t);

/** Writes: insert or update by id. Returns null or a sentence. */
export function useClientViewMutations(onChanged: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const save = useCallback(async (table: 'project_demos' | 'project_meetings' | 'help_articles' | 'demo_feedback', row: Record<string, unknown>, id?: string) => {
    setBusy(id ?? table);
    const { error } = id
      ? await supabase.from(table).update(row).eq('id', id)
      : await supabase.from(table).insert(row);
    setBusy(null);
    if (error) { console.error(`[${table}.save]`, error.code); return clientViewRefusal(error); }
    onChanged();
    return null;
  }, [onChanged]);
  return { save, busy };
}

/* ------------------------------------------------------------ the client */

export interface ClientDemo { demo_id: string; project_id: string; project_name: string; title: string; url: string; note: string | null; updated_at: string }
export interface ClientMeeting {
  meeting_id: string; project_id: string; project_name: string; title: string; starts_at: string; ends_at: string;
  time_zone: string; join_url: string | null; location: string | null; note: string | null; cancelled: boolean;
}

export const useClientDemos = (t = 0) => useRpc<ClientDemo>('client_portal_demos', t);
export const useClientMeetings = (t = 0) => useRpc<ClientMeeting>('client_portal_meetings', t);
export const useClientHelp = (t = 0) => useRpc<HelpArticle>('client_help_articles', t);

/* ------------------------------------------- phase 8: feedback, reschedule */

export interface DemoFeedback { id: string; demo_id: string; project_id: string; body: string; created_at: string; read_at: string | null;
  account?: { full_name: string; email: string } | null }
export interface MeetingRequest {
  id: string; meeting_id: string; project_id: string; proposed_starts_at: string; proposed_ends_at: string; time_zone: string;
  message: string | null; status: 'pending' | 'accepted' | 'declined' | 'withdrawn'; owner_note: string | null; created_at: string;
  decided_at: string | null; account?: { full_name: string; email: string } | null;
}

export const useDemoFeedback = (projectId: string | undefined, t = 0) => useOwnerRows<DemoFeedback>('demo_feedback',
  'id, demo_id, project_id, body, created_at, read_at, account:client_accounts(full_name, email)', projectId, 'created_at', t);
export const useMeetingRequests = (projectId: string | undefined, t = 0) => useOwnerRows<MeetingRequest>('meeting_change_requests',
  'id, meeting_id, project_id, proposed_starts_at, proposed_ends_at, time_zone, message, status, owner_note, created_at, decided_at, account:client_accounts(full_name, email)',
  projectId, 'created_at', t);

/** The owner's inbox across projects: unread feedback, pending time proposals. */
export function useClientInbox(enabled: boolean, t = 0) {
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const [items, setItems] = useState<{ kind: 'feedback' | 'request'; id: string; project_id: string; project: string; at: string; text: string; who: string }[]>([]);
  const load = useCallback(async () => {
    if (!isConfigured || !enabled) return;
    const [f, r] = await Promise.all([
      supabase.from('demo_feedback').select('id, project_id, body, created_at, project:projects(name), demo:project_demos(title), account:client_accounts(full_name)')
        .is('read_at', null).order('created_at', { ascending: false }).limit(50),
      supabase.from('meeting_change_requests').select('id, project_id, created_at, proposed_starts_at, proposed_ends_at, time_zone, project:projects(name), meeting:project_meetings(title), account:client_accounts(full_name)')
        .eq('status', 'pending').order('created_at', { ascending: false }).limit(50),
    ]);
    if (f.error || r.error) { console.error('[client_inbox]', (f.error ?? r.error)?.code); setState('error'); return; }
    type Row = Record<string, unknown> & { project?: { name: string } | null; account?: { full_name: string } | null };
    setItems([
      ...((f.data ?? []) as unknown as Row[]).map((x) => ({ kind: 'feedback' as const, id: x.id as string, project_id: x.project_id as string, project: x.project?.name ?? '—',
        at: x.created_at as string, text: `${(x.demo as { title: string } | null)?.title ?? 'Demó'}: ${x.body as string}`, who: x.account?.full_name ?? '' })),
      ...((r.data ?? []) as unknown as Row[]).map((x) => ({ kind: 'request' as const, id: x.id as string, project_id: x.project_id as string, project: x.project?.name ?? '—',
        at: x.created_at as string, text: `${(x.meeting as { title: string } | null)?.title ?? 'Megbeszélés'} — new time proposed`, who: x.account?.full_name ?? '' })),
    ].sort((a, b) => b.at.localeCompare(a.at)));
    setState('ready');
  }, [enabled, t]);
  useEffect(() => { void load(); }, [load]);
  return { items, state, reload: load };
}

export async function ownerDecideRequest(id: string, accept: boolean, note: string | null): Promise<string | null> {
  const { error } = await supabase.rpc('owner_decide_meeting_request', { p_request: id, p_accept: accept, p_note: note });
  if (!error) return null;
  console.error('[owner_decide_meeting_request]', error.code);
  if (/meeting_request_decided/.test(error.message ?? '')) return 'This proposal was already decided.';
  return clientViewRefusal(error);
}

/* the client */
export interface ClientFeedback { feedback_id: string; demo_id: string; body: string; created_at: string; seen: boolean }
export interface ClientMeetingRequest {
  request_id: string; meeting_id: string; proposed_starts_at: string; proposed_ends_at: string; time_zone: string; message: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn'; owner_note: string | null; created_at: string; decided_at: string | null;
}
export const useClientFeedback = (t = 0) => useRpc<ClientFeedback>('client_portal_demo_feedback', t);
export const useClientMeetingRequests = (t = 0) => useRpc<ClientMeetingRequest>('client_portal_meeting_requests', t);

/** The client's two writes. Returns null or a Hungarian sentence. */
export function clientWriteRefusal(error: { code?: string | null; message?: string | null }): string {
  const m = error.message ?? '';
  if (/feedback_limit/.test(m)) return 'Ma már sok üzenetet küldtél. Holnap újra írhatsz, vagy keresd a Stratost e-mailben.';
  if (/feedback_empty/.test(m)) return 'Írj valamit az üzenetbe.';
  if (/meeting_request_pending/.test(m)) return 'Erre a megbeszélésre már van függőben lévő javaslatod. Vond vissza, ha másikat küldenél.';
  if (/meeting_request_past/.test(m)) return 'A javasolt időpont már elmúlt.';
  if (/meeting_closed/.test(m)) return 'Ez a megbeszélés már lezajlott vagy le lett mondva.';
  if (/client_no_access/.test(m) || error.code === '42501') return 'Ehhez már nincs hozzáférésed.';
  if (error.code === '23514') return 'A befejezésnek a kezdés után kell lennie, legfeljebb 24 órával.';
  return 'Nem sikerült elküldeni. Próbáld újra.';
}

export async function sendDemoFeedback(demoId: string, body: string): Promise<string | null> {
  const { error } = await supabase.rpc('client_send_demo_feedback', { p_demo: demoId, p_body: body });
  if (error) { console.error('[client.feedback]', error.code); return clientWriteRefusal(error); }
  return null;
}
export async function requestMeetingChange(meetingId: string, starts: string, ends: string, zone: string, message: string | null): Promise<string | null> {
  const { error } = await supabase.rpc('client_request_meeting_change', { p_meeting: meetingId, p_starts: starts, p_ends: ends, p_time_zone: zone, p_message: message });
  if (error) { console.error('[client.reschedule]', error.code); return clientWriteRefusal(error); }
  return null;
}
export async function withdrawMeetingRequest(requestId: string): Promise<string | null> {
  const { error } = await supabase.rpc('client_withdraw_meeting_request', { p_request: requestId });
  if (error) { console.error('[client.withdraw]', error.code); return clientWriteRefusal(error); }
  return null;
}
