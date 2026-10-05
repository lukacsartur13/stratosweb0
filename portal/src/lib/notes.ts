import { useCallback, useEffect, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';
import { t } from '@/lib/i18n';

/**
 * Notes, checklists, tasks and the activity log
 * (20261011000100_notes_tasks_activity.sql).
 *
 * A note is free text or a checklist, optionally about one client. A
 * checklist point with a due date is a TASK — the Today screen lists every
 * open one. There is no second task table to keep in step with this one.
 *
 * Staff admins only, by RLS; nothing here is shown to a client.
 */

export interface NoteItem {
  id: string;
  note_id: string;
  text: string;
  done: boolean;
  done_at: string | null;
  due_on: string | null;
  position: number;
  milestone_id: string | null;
}

export interface Note {
  id: string;
  kind: 'note' | 'checklist';
  title: string;
  body: string | null;
  organization_id: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  client?: { id: string; name: string } | null;
  items: NoteItem[];
}

export type InteractionKind = 'call' | 'email' | 'meeting' | 'message' | 'other';
export const INTERACTION_KINDS: InteractionKind[] = ['call', 'email', 'meeting', 'message', 'other'];
/** English source; translated where shown. */
export const INTERACTION_LABEL: Record<InteractionKind, string> = {
  call: 'Call', email: 'E-mail', meeting: 'Meeting', message: 'Message', other: 'Other',
};

export interface Interaction {
  id: string;
  kind: InteractionKind;
  occurred_at: string;
  summary: string;
  organization_id: string | null;
  lead_id: string | null;
  opportunity_id: string | null;
  created_at: string;
  author?: { full_name: string | null; email: string } | null;
}

type State = 'loading' | 'ready' | 'error' | 'unconfigured';

const NOTE_COLUMNS = 'id, kind, title, body, organization_id, pinned, archived_at, created_at, updated_at, client:organizations(id, name)';
const ITEM_COLUMNS = 'id, note_id, text, done, done_at, due_on, position, milestone_id';

export function notesRefusal(error: { code?: string; message?: string } | null): string {
  if (error?.code === '42P01' || error?.code === 'PGRST205') return t('Notes are not installed in the database yet (20261011000100).');
  if (error?.code === '42501') return t('This account may not change notes.');
  if (error?.code === '23514') return t('The database refused those values. Check the lengths.');
  return t('The database refused that change.');
}

/** Today in Budapest, YYYY-MM-DD — the day a task is due on. */
export const todayIso = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(now);

/** Every live note (or one client's), each with its points. Two queries. */
export function useNotes(reloadToken = 0, opts: { organizationId?: string; archived?: boolean } = {}) {
  const [rows, setRows] = useState<Note[]>([]);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    let q = supabase.from('notes').select(NOTE_COLUMNS);
    q = opts.archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null);
    if (opts.organizationId) q = q.eq('organization_id', opts.organizationId);
    const { data, error } = await q.order('pinned', { ascending: false }).order('updated_at', { ascending: false }).limit(300);
    if (error) {
      console.error('[notes]', error);
      setMessage(notesRefusal(error));
      setState('error');
      return;
    }
    const notes = (data ?? []) as unknown as Omit<Note, 'items'>[];
    const ids = notes.map((n) => n.id);
    let items: NoteItem[] = [];
    if (ids.length > 0) {
      const res = await supabase.from('note_items').select(ITEM_COLUMNS).in('note_id', ids)
        .order('position', { ascending: true }).limit(5000);
      if (res.error) console.error('[note_items]', res.error);
      items = (res.data ?? []) as NoteItem[];
    }
    setRows(notes.map((n) => ({ ...n, items: items.filter((i) => i.note_id === n.id) })));
    setState('ready');
  }, [reloadToken, opts.organizationId, opts.archived]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);
  return { rows, state, message, reload: load };
}

export function useNotesMutations(onChanged: () => void) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(async <T,>(key: string, fn: () => PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>):
  Promise<{ data: T | null } | string> => {
    setBusy(key);
    const { data, error } = await fn();
    setBusy(null);
    if (error) {
      console.error(`[notes.${key}]`, error);
      return notesRefusal(error);
    }
    onChanged();
    return { data };
  }, [onChanged]);

  const createNote = useCallback(async (draft: { kind: Note['kind']; title: string; organization_id?: string | null; body?: string | null }) => {
    if (!draft.title.trim()) return t('A note needs a title.');
    const r = await run<{ id: string }>('create', () =>
      supabase.from('notes').insert({ ...draft, title: draft.title.trim() }).select('id').single());
    return typeof r === 'string' ? r : { id: (r.data as { id: string }).id };
  }, [run]);

  const updateNote = useCallback(async (id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'organization_id' | 'pinned' | 'kind'>>) => {
    if (patch.title !== undefined && !patch.title.trim()) return t('A note needs a title.');
    const r = await run(id, () => supabase.from('notes').update(patch).eq('id', id));
    return typeof r === 'string' ? r : null;
  }, [run]);

  const archiveNote = useCallback(async (id: string, archived: boolean) => {
    const r = await run(id, () => supabase.from('notes').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id));
    return typeof r === 'string' ? r : null;
  }, [run]);

  const addItem = useCallback(async (noteId: string, text: string, position: number, dueOn: string | null = null) => {
    if (!text.trim()) return t('A point needs some text.');
    const r = await run('item', () => supabase.from('note_items').insert({ note_id: noteId, text: text.trim(), position, due_on: dueOn }));
    return typeof r === 'string' ? r : null;
  }, [run]);

  const updateItem = useCallback(async (id: string, patch: Partial<Pick<NoteItem, 'text' | 'done' | 'due_on' | 'position'>>) => {
    if (patch.text !== undefined && !patch.text.trim()) return t('A point needs some text.');
    const r = await run(id, () => supabase.from('note_items').update(patch).eq('id', id));
    return typeof r === 'string' ? r : null;
  }, [run]);

  const removeItem = useCallback(async (id: string) => {
    const r = await run(id, () => supabase.from('note_items').delete().eq('id', id));
    return typeof r === 'string' ? r : null;
  }, [run]);

  /** The point becomes a checkpoint of `projectId` (owner only, by RLS). */
  const toMilestone = useCallback(async (itemId: string, projectId: string) => {
    setBusy(itemId);
    const { error } = await supabase.rpc('note_item_to_milestone', { p_item: itemId, p_project: projectId });
    setBusy(null);
    if (error) {
      console.error('[notes.toMilestone]', error);
      return error.code === '42501' || /row-level security/.test(error.message ?? '')
        ? t('Only the portal owner can add checkpoints to a project.')
        : notesRefusal(error);
    }
    onChanged();
    return null;
  }, [onChanged]);

  return { createNote, updateNote, archiveNote, addItem, updateItem, removeItem, toMilestone, busy };
}

/** The activity log of one record: a client, a lead or a sales opportunity. */
export type InteractionTarget = { organization_id: string } | { lead_id: string } | { opportunity_id: string };

export function useInteractions(target: InteractionTarget | null, reloadToken = 0) {
  const [rows, setRows] = useState<Interaction[]>([]);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const key = target ? Object.entries(target)[0].join('=') : '';

  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    if (!target) return;
    const [column, value] = Object.entries(target)[0];
    const { data, error } = await supabase.from('interactions')
      .select('id, kind, occurred_at, summary, organization_id, lead_id, opportunity_id, created_at, author:profiles(full_name, email)')
      .eq(column, value).order('occurred_at', { ascending: false }).limit(200);
    if (error) {
      console.error('[interactions]', error);
      setState('error');
      return;
    }
    setRows((data ?? []) as unknown as Interaction[]);
    setState('ready');
  }, [key, reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);
  return { rows, state, reload: load };
}

export async function logInteraction(target: InteractionTarget, draft: { kind: InteractionKind; summary: string; occurred_at: string }) {
  if (!draft.summary.trim()) return t('Write what happened.');
  const { error } = await supabase.from('interactions').insert({ ...target, ...draft, summary: draft.summary.trim() });
  if (error) {
    console.error('[interactions.insert]', error);
    return notesRefusal(error);
  }
  return null;
}

export async function removeInteraction(id: string) {
  const { error } = await supabase.from('interactions').delete().eq('id', id);
  if (error) {
    console.error('[interactions.delete]', error);
    return notesRefusal(error);
  }
  return null;
}

/* ================================================================= today == */

export interface TodayTask extends NoteItem { note: { id: string; title: string; client: { id: string; name: string } | null } | null }
export interface TodayFollowUp { id: string; title: string; next_action: string | null; next_action_on: string; company_name: string | null }
export interface TodayCheckpoint { id: string; title: string; due_on: string; project: { id: string; name: string } | null }
export interface TodayMeeting { id: string; title: string; starts_at: string; project: { id: string; name: string } | null }

/**
 * What is due today or overdue, from four places, in four parallel reads:
 * tasks (checklist points with a date), deal follow-ups, project checkpoints
 * and today's meetings. A source this account may not read is not asked.
 */
export function useToday(reloadToken: number, may: { sales: boolean; projects: boolean }) {
  const [tasks, setTasks] = useState<TodayTask[]>([]);
  const [followUps, setFollowUps] = useState<TodayFollowUp[]>([]);
  const [checkpoints, setCheckpoints] = useState<TodayCheckpoint[]>([]);
  const [meetings, setMeetings] = useState<TodayMeeting[]>([]);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');

  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    const today = todayIso();
    const none = Promise.resolve({ data: [], error: null });
    const startOfDay = new Date(`${today}T00:00:00`);
    const endOfDay = new Date(startOfDay.getTime() + 86_400_000);
    const [tk, fu, cp, mt] = await Promise.all([
      supabase.from('note_items')
        .select(`${ITEM_COLUMNS}, note:notes!inner(id, title, archived_at, client:organizations(id, name))`)
        .eq('done', false).not('due_on', 'is', null).lte('due_on', today).is('note.archived_at', null)
        .order('due_on', { ascending: true }).limit(200),
      may.sales
        ? supabase.from('opportunities').select('id, title, next_action, next_action_on, company_name')
          .is('archived_at', null).not('next_action_on', 'is', null).lte('next_action_on', today)
          .not('stage', 'in', '("won","lost")').order('next_action_on', { ascending: true }).limit(100)
        : none,
      may.projects
        ? supabase.from('project_milestones').select('id, title, due_on, project:projects!inner(id, name, archived_at, status)')
          .neq('state', 'done').not('due_on', 'is', null).lte('due_on', today)
          .is('project.archived_at', null).neq('project.status', 'completed')
          .order('due_on', { ascending: true }).limit(100)
        : none,
      may.projects
        ? supabase.from('project_meetings').select('id, title, starts_at, project:projects(id, name)')
          .is('cancelled_at', null).gte('starts_at', startOfDay.toISOString()).lt('starts_at', endOfDay.toISOString())
          .order('starts_at', { ascending: true }).limit(50)
        : none,
    ]);
    const failed = tk.error;
    if (failed) {
      console.error('[today.tasks]', failed);
      setState('error');
      return;
    }
    for (const r of [fu, cp, mt]) if (r.error) console.error('[today]', r.error);
    setTasks((tk.data ?? []) as unknown as TodayTask[]);
    setFollowUps((fu.data ?? []) as unknown as TodayFollowUp[]);
    setCheckpoints((cp.data ?? []) as unknown as TodayCheckpoint[]);
    setMeetings((mt.data ?? []) as unknown as TodayMeeting[]);
    setState('ready');
  }, [reloadToken, may.sales, may.projects]);

  useEffect(() => { void load(); }, [load]);
  return { tasks, followUps, checkpoints, meetings, state, reload: load };
}

/**
 * The note quick tasks go into when they belong to no other note: one
 * checklist called "Tasks", made on first use.
 */
const INBOX_TITLES = ['Tasks', 'Teendők', 'Aufgaben'];
export async function inboxNoteId(): Promise<string | { error: string }> {
  // The title is written in the creator's language, so it is looked up in all three.
  const found = await supabase.from('notes').select('id').eq('kind', 'checklist').in('title', INBOX_TITLES)
    .is('organization_id', null).is('archived_at', null).order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (found.data) return (found.data as { id: string }).id;
  const made = await supabase.from('notes').insert({ kind: 'checklist', title: t('Tasks') }).select('id').single();
  if (made.error) return { error: notesRefusal(made.error) };
  return (made.data as { id: string }).id;
}
