import { useCallback, useEffect, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';
import { t } from '@/lib/i18n';

/**
 * Hours worked, per person per day (20261012000100_time_entries.sql).
 *
 * Every staff admin sees everybody's hours and writes their own; the owner may
 * correct anybody's. A line is on a project (any admin may choose any one, from
 * `time_projects()`: names only) or on something named in free text. A
 * project's logged hours are summed from these lines whenever they are shown.
 */

export interface TimeEntry {
  id: string;
  user_id: string;
  work_date: string;
  hours: number;
  project_id: string | null;
  label: string | null;
  note: string | null;
}

export interface Person { id: string; full_name: string | null; email: string; role: string }
export interface TimeProject { project_id: string; project_name: string; client_name: string | null; closed: boolean }

type State = 'loading' | 'ready' | 'error' | 'unconfigured';

/* ------------------------------------------------------------ the dates == */

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Today in Budapest, YYYY-MM-DD. */
export const todayIso = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(now);

/** `day` plus `n` days, as YYYY-MM-DD (calendar arithmetic, no time zone). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** The Monday of the week `day` is in. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}

/** The seven days of the week starting `monday`. */
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/** Hours as a person reads them: 6.5 → "6.5" (no trailing zeros). */
export const showHours = (h: number) => (Math.round(h * 100) / 100).toString();

/** A typed number of hours: decimal comma or point, quarter hours, 0.25–24. */
export function parseHours(raw: string): { value: number } | { error: string } {
  const v = Number(raw.trim().replace(',', '.'));
  if (!raw.trim() || !Number.isFinite(v)) return { error: t('Write the hours as a number, e.g. 6.5.') };
  if (v <= 0 || v > 24) return { error: t('Between 0.25 and 24 hours.') };
  if (Math.round(v * 4) !== v * 4) return { error: t('In quarter hours: .25, .5 or .75.') };
  return { value: v };
}

export function hoursRefusal(error: { code?: string; message?: string; details?: string | null } | null): string {
  const m = error?.message ?? '';
  if (m.includes('stratos:time_day_over_24')) return t('A day holds at most 24 hours. {detail}', { detail: error?.details ?? '' }).trim();
  if (error?.code === '42501' || /row-level security/.test(m)) return t('You can only change your own hours.');
  if (error?.code === '42P01' || error?.code === 'PGRST205') return t('Hours are not installed in the database yet (20261012000100).');
  if (error?.code === '23514') return t('The database refused those values. Check the hours and the date.');
  return t('The database refused that change.');
}

/* ------------------------------------------------------------- the reads == */

/** A week of everybody's hours, the people who log them, and the projects to choose from. */
export function useWeek(monday: string, reloadToken = 0) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [projects, setProjects] = useState<TimeProject[]>([]);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    const [e, p, pr] = await Promise.all([
      supabase.from('time_entries').select('id, user_id, work_date, hours, project_id, label, note')
        .gte('work_date', monday).lte('work_date', addDays(monday, 6))
        .order('work_date', { ascending: true }).order('created_at', { ascending: true }).limit(2000),
      supabase.from('profiles').select('id, full_name, email, role').in('role', ['super_admin', 'admin']).order('full_name'),
      supabase.rpc('time_projects'),
    ]);
    if (e.error) {
      console.error('[time_entries]', e.error);
      setMessage(hoursRefusal(e.error));
      setState('error');
      return;
    }
    if (p.error) console.error('[profiles.staff]', p.error);
    if (pr.error) console.error('[time_projects]', pr.error);
    setEntries(((e.data ?? []) as TimeEntry[]).map((x) => ({ ...x, hours: Number(x.hours) })));
    setPeople((p.data ?? []) as Person[]);
    setProjects((pr.data ?? []) as TimeProject[]);
    setState('ready');
  }, [monday, reloadToken]);

  useEffect(() => { void load(); }, [load]);
  return { entries, people, projects, state, message, reload: load };
}

/** The hours logged on one project, by everybody — summed now, never stored. */
export function useProjectLoggedHours(projectId: string | undefined, reloadToken = 0) {
  const [total, setTotal] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    if (!isConfigured || !projectId) return;
    void supabase.from('time_entries').select('hours').eq('project_id', projectId).limit(10000)
      .then(({ data, error }) => {
        if (!alive) return;
        // Before the migration the table is missing: show nothing, not a zero.
        if (error) { setTotal(null); return; }
        setTotal(((data ?? []) as { hours: number }[]).reduce((n, r) => n + Number(r.hours), 0));
      });
    return () => { alive = false; };
  }, [projectId, reloadToken]);
  return total;
}

/* ---------------------------------------------------------- the writes == */

export interface TimeDraft { work_date: string; hours: number; project_id: string | null; label: string | null; note: string | null }

export function useHoursMutations(onChanged: () => void) {
  const [busy, setBusy] = useState(false);

  const save = useCallback(async (draft: TimeDraft, id?: string): Promise<string | null> => {
    if (!draft.project_id && !draft.label?.trim()) return t('Choose a project, or write what it was.');
    setBusy(true);
    const row = { ...draft, label: draft.project_id ? null : draft.label?.trim() ?? null, note: draft.note?.trim() || null };
    const { error } = id
      ? await supabase.from('time_entries').update(row).eq('id', id)
      : await supabase.from('time_entries').insert(row);
    setBusy(false);
    if (error) {
      console.error('[time_entries.save]', error);
      return hoursRefusal(error);
    }
    onChanged();
    return null;
  }, [onChanged]);

  const remove = useCallback(async (id: string): Promise<string | null> => {
    setBusy(true);
    const { error } = await supabase.from('time_entries').delete().eq('id', id);
    setBusy(false);
    if (error) {
      console.error('[time_entries.delete]', error);
      return hoursRefusal(error);
    }
    onChanged();
    return null;
  }, [onChanged]);

  return { save, remove, busy };
}
