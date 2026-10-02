import { useCallback, useEffect, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';

/**
 * The Trash — deleting projects, clients and leads from the Portal
 * (20261007000100_trash.sql).
 *
 * Two steps, on purpose. MOVE TO TRASH hides the record from every list and
 * figure and can be undone (a column write: `archived_at` on projects and
 * clients, `trashed_at` on leads). DELETE PERMANENTLY happens from the Trash
 * only, through one database function per kind, which refuses while anything
 * that must not vanish silently hangs off the record — and says what.
 */

export type TrashKind = 'project' | 'client' | 'lead';

const TABLE: Record<TrashKind, { table: string; column: string }> = {
  project: { table: 'projects', column: 'archived_at' },
  client: { table: 'organizations', column: 'archived_at' },
  lead: { table: 'leads', column: 'trashed_at' },
};
const PURGE: Record<TrashKind, string> = { project: 'purge_project', client: 'purge_client', lead: 'purge_lead' };

export const TRASH_NOUN: Record<TrashKind, string> = { project: 'project', client: 'client', lead: 'lead' };

/** A refusal from the Trash's functions, in a sentence. */
export function trashRefusal(error: { code?: string; message?: string; details?: string | null }): string {
  console.error('[trash]', error.code, error.message);
  const m = error.message ?? '';
  if (m.includes('stratos:purge_blocked')) {
    return `It cannot be deleted permanently while it has: ${error.details ?? 'linked records'}. Keep it in the Trash, or remove those first.`;
  }
  if (m.includes('stratos:purge_not_trashed')) return 'Move it to the Trash first.';
  if (error.code === '23503' || error.code === '23001') {
    return 'It is still linked to another record (for example an Impact application), so it cannot be deleted permanently. Keep it in the Trash.';
  }
  if (m.includes('stratos:purge_missing')) return 'It no longer exists — it may have been deleted already.';
  if (m.includes('stratos:purge_forbidden') || error.code === '42501') return 'This account may not delete it permanently.';
  if (error.code === 'PGRST202' || error.code === '42883') {
    return 'The Trash is not installed in the database yet (20261007000100_trash.sql).';
  }
  return 'The database refused that change. Check that your account may edit this data.';
}

export function useTrashMutations(onChanged: () => void) {
  const [busy, setBusy] = useState<string | null>(null);

  /** Hide it everywhere; reversible. `null` on success, else a sentence. */
  const moveToTrash = useCallback(async (kind: TrashKind, id: string): Promise<string | null> => {
    const { table, column } = TABLE[kind];
    setBusy(id);
    const { data, error } = await supabase.from(table)
      .update({ [column]: new Date().toISOString() }).eq('id', id).is(column, null).select('id');
    setBusy(null);
    if (error) return trashRefusal(error);
    if (!data || data.length === 0) return 'It is already in the Trash, or this account may not change it.';
    onChanged();
    return null;
  }, [onChanged]);

  const restore = useCallback(async (kind: TrashKind, id: string): Promise<string | null> => {
    const { table, column } = TABLE[kind];
    setBusy(id);
    const { error } = await supabase.from(table).update({ [column]: null }).eq('id', id);
    setBusy(null);
    if (error) return trashRefusal(error);
    onChanged();
    return null;
  }, [onChanged]);

  /** From the Trash only. The database decides; this reports what it said. */
  const purge = useCallback(async (kind: TrashKind, id: string): Promise<string | null> => {
    setBusy(id);
    const { error } = await supabase.rpc(PURGE[kind], { p_id: id });
    setBusy(null);
    if (error) return trashRefusal(error);
    onChanged();
    return null;
  }, [onChanged]);

  return { moveToTrash, restore, purge, busy };
}

export interface TrashRow {
  kind: TrashKind;
  id: string;
  name: string;
  detail: string | null;
  trashed_at: string;
}

type State = 'loading' | 'ready' | 'error' | 'unconfigured';

/**
 * Everything in the Trash this account may see. A kind it may not see is not
 * asked for at all, rather than asked and answered with an empty list.
 */
export function useTrash(reloadToken: number, may: Record<TrashKind, boolean>) {
  const [rows, setRows] = useState<TrashRow[]>([]);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');

  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    setState('loading');
    const none = Promise.resolve({ data: [], error: null });
    const [p, c, l] = await Promise.all([
      may.project
        ? supabase.from('projects').select('id, name, archived_at, client:organizations(name)')
          .not('archived_at', 'is', null).order('archived_at', { ascending: false }).limit(200)
        : none,
      may.client
        ? supabase.from('organizations').select('id, name, archived_at')
          .not('archived_at', 'is', null).order('archived_at', { ascending: false }).limit(200)
        : none,
      may.lead
        ? supabase.from('leads').select('id, name, company, email, trashed_at')
          .not('trashed_at', 'is', null).order('trashed_at', { ascending: false }).limit(200)
        : none,
    ]);
    const failed = p.error ?? c.error ?? l.error;
    if (failed) {
      console.error('[trash.read]', failed);
      setState('error');
      return;
    }
    type R = Record<string, unknown>;
    setRows([
      ...((p.data ?? []) as R[]).map((r) => ({
        kind: 'project' as const, id: String(r.id), name: String(r.name),
        detail: (r.client as { name?: string } | null)?.name ?? null, trashed_at: String(r.archived_at),
      })),
      ...((c.data ?? []) as R[]).map((r) => ({
        kind: 'client' as const, id: String(r.id), name: String(r.name), detail: null, trashed_at: String(r.archived_at),
      })),
      ...((l.data ?? []) as R[]).map((r) => ({
        kind: 'lead' as const, id: String(r.id), name: String(r.name),
        detail: [r.company, r.email].filter(Boolean).join(' · ') || null, trashed_at: String(r.trashed_at),
      })),
    ]);
    setState('ready');
  }, [reloadToken, may.project, may.client, may.lead]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);
  return { rows, state, reload: load };
}
