import { useCallback, useEffect, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';

/**
 * Notes and timelines, for the three record types P2 adds.
 *
 * ## Why this is one module and `lib/leads.ts` still has its own
 *
 * A lead's note lives in `lead_notes`, with a hard foreign key and a cascade,
 * and that is genuinely the better design — it is worth keeping and it is not
 * worth reproducing three more times for rows that differ only in which id they
 * point at. So opportunities, clients and projects share `record_notes`, keyed
 * by `(entity_type, entity_id)`, and share this module.
 *
 * ## What is in a timeline
 *
 * Only what was recorded. `activity_logs` rows written by the database triggers
 * in the P2 migration, plus the notes, plus the record's own creation date.
 * Nothing is inferred: a deal that reached Proposal before the trigger existed
 * shows no stage change, because none was stored, and §37's "do not reconstruct
 * fake historical activity" is a rule about exactly that temptation.
 */

export type RecordKind = 'opportunity' | 'client' | 'project';

export interface RecordNote {
  id: string;
  body: string;
  created_at: string;
  author_id: string | null;
  author: { full_name: string | null; email: string } | null;
}

export interface LogRow {
  id: string;
  action: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
  actor: { full_name: string | null; email: string } | null;
}

export interface TimelineEntry {
  id: string;
  at: string;
  kind: 'created' | 'stage' | 'note' | 'status' | 'money' | 'action' | 'other';
  title: string;
  detail?: string;
  by?: string | null;
}

/**
 * A record's notes and its log, in one round trip pair.
 *
 * Together because they are one panel, and because the timeline is partly
 * assembled FROM the notes — reading them separately would let the two disagree
 * about whether a note exists.
 *
 * A missing table is logged and rendered as an empty panel rather than as a
 * crash: the migration may not have been applied yet, and the rest of the screen
 * is still useful.
 */
export function useRecordDetail(kind: RecordKind, id: string | null, reloadToken = 0) {
  const [notes, setNotes] = useState<RecordNote[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const load = useCallback(async () => {
    if (!id || !isConfigured) return;
    setState('loading');

    const [noteRes, logRes] = await Promise.all([
      supabase
        .from('record_notes')
        .select('id, body, created_at, author_id, author:profiles(full_name, email)')
        .eq('entity_type', kind)
        .eq('entity_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('activity_logs')
        .select('id, action, created_at, metadata, actor:profiles(full_name, email)')
        .eq('entity_type', kind)
        .eq('entity_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    if (noteRes.error) console.error('[record_notes]', noteRes.error);
    if (logRes.error) console.error('[activity_logs]', logRes.error);

    setNotes((noteRes.data ?? []) as unknown as RecordNote[]);
    setLog((logRes.data ?? []) as unknown as LogRow[]);
    setState(noteRes.error && logRes.error ? 'error' : 'ready');
  }, [kind, id, reloadToken]);

  useEffect(() => { void load(); }, [load]);

  return { notes, log, state, reload: load };
}

/** Add a note. The author is the signed-in profile and the policy requires it. */
export function useNoteMutation(kind: RecordKind, onChanged: () => void) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState(false);

  const addNote = useCallback(async (id: string, body: string) => {
    const text = body.trim();
    if (!text) return 'Write something first.';
    if (!profile) return 'Your session has expired. Sign in again.';

    setBusy(true);
    // `author_id` is set from the signed-in profile, and
    // `record_notes_insert_admin` requires it to equal `auth.uid()`. This cannot
    // be used to write in someone else's name even by editing the request.
    const { error } = await supabase
      .from('record_notes')
      .insert({ entity_type: kind, entity_id: id, author_id: profile.id, body: text });
    setBusy(false);

    if (error) {
      console.error('[record_notes.insert]', error);
      return error.code === '42P01'
        ? 'Notes are not set up in this database yet. Run the migrations in supabase/migrations.'
        : 'The database refused that note.';
    }
    onChanged();
    return null;
  }, [kind, onChanged, profile]);

  return { addNote, busy };
}

/* ================================================================ timeline */

const who = (row: { full_name: string | null; email: string } | null) =>
  row ? row.full_name || row.email : null;

const asText = (value: unknown): string | undefined =>
  value === null || value === undefined || value === '' ? undefined : String(value);

/**
 * Turn what was recorded into what is read.
 *
 * The `action` strings are the ones the triggers in the P2 migration write.
 * Anything this function does not recognise is shown as itself rather than
 * dropped — an event nobody has taught the UI about is still evidence that
 * something happened, and hiding it would make the timeline claim a quiet period
 * that was not quiet.
 */
export function buildRecordTimeline(
  created: { at: string; title: string; detail?: string },
  notes: RecordNote[],
  log: LogRow[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    { id: 'created', at: created.at, kind: 'created', title: created.title, detail: created.detail },
  ];

  for (const note of notes) {
    entries.push({
      id: `note-${note.id}`,
      at: note.created_at,
      kind: 'note',
      title: 'Note added',
      detail: note.body,
      by: who(note.author),
    });
  }

  for (const row of log) {
    const meta = row.metadata ?? {};
    const by = who(row.actor);
    const push = (kind: TimelineEntry['kind'], title: string, detail?: string) =>
      entries.push({ id: `log-${row.id}`, at: row.created_at, kind, title, detail, by });

    switch (row.action) {
      case 'opportunity.created':
        push('created', 'Opportunity created', asText(meta.title));
        break;
      case 'opportunity.stage_changed':
        push('stage', `Stage ${asText(meta.from) ?? '?'} → ${asText(meta.to) ?? '?'}`,
          asText(meta.reason) ? `Reason: ${asText(meta.reason)}` : undefined);
        break;
      case 'opportunity.value_changed':
        push('money', 'Value changed',
          `${asText(meta.from) ?? 'not set'} → ${asText(meta.to) ?? 'not set'} ${asText(meta.currency) ?? ''}`.trim());
        break;
      case 'opportunity.next_action_changed':
        push('action', 'Next action changed',
          [asText(meta.action), asText(meta.due)].filter(Boolean).join(' · ') || 'Cleared');
        break;
      case 'opportunity.client_linked':
        push('status', 'Linked to a client');
        break;
      case 'client.created':
        push('created', 'Client created', asText(meta.name));
        break;
      case 'client.status_changed':
        push('status', `Status ${asText(meta.from) ?? '?'} → ${asText(meta.to) ?? '?'}`);
        break;
      case 'project.created':
        push('created', 'Project created', asText(meta.name));
        break;
      case 'project.status_changed':
        push('status', `Status ${asText(meta.from) ?? '?'} → ${asText(meta.to) ?? '?'}`);
        break;
      case 'project.value_changed':
        push('money', 'Project value changed',
          `${asText(meta.from) ?? 'not set'} → ${asText(meta.to) ?? 'not set'} ${asText(meta.currency) ?? ''}`.trim());
        break;
      case 'project.cost_added':
        push('money', 'Cost added',
          `${asText(meta.description) ?? ''} · ${asText(meta.amount) ?? ''} ${asText(meta.currency) ?? ''}`.trim());
        break;
      case 'project.cost_removed':
        push('money', 'Cost removed', asText(meta.description));
        break;
      default:
        push('other', row.action);
    }
  }

  return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
