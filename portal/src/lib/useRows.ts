import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';

export type LoadState = 'loading' | 'ready' | 'error' | 'unconfigured';

/**
 * Read a table through RLS.
 *
 * There is no role filtering here on purpose. Every one of these selects is
 * unqualified — `select * from leads` — and comes back containing exactly the
 * rows the signed-in user's policies allow. A client running this against
 * `projects` gets their own organisation's rows because the database said so,
 * not because the frontend remembered to add a `where`.
 */
export function useRows<T>(table: string, columns = '*', orderBy = 'created_at') {
  const [rows, setRows] = useState<T[]>([]);
  const [state, setState] = useState<LoadState>(isConfigured ? 'loading' : 'unconfigured');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    setState('loading');
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderBy, { ascending: false })
      .limit(200);

    if (error) {
      setState('error');
      // Postgres error text can name columns and constraints. Useful in the
      // console, not something to paint across the screen.
      console.error(`[${table}]`, error);
      setMessage(
        error.code === '42P01'
          ? 'That table does not exist yet. Run the migrations in supabase/migrations.'
          : 'The database refused the request. Check that you have permission for this data.',
      );
      return;
    }
    setRows((data ?? []) as T[]);
    setState('ready');
  }, [table, columns, orderBy]);

  useEffect(() => { void load(); }, [load]);

  return useMemo(() => ({ rows, state, message, reload: load }), [rows, state, message, load]);
}

/** Client-side filter for the search boxes above each table. */
export function useSearch<T>(rows: T[], keys: (keyof T)[]) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      keys.some((k) => String(r[k] ?? '').toLowerCase().includes(q)),
    );
  }, [rows, keys, query]);
  return { query, setQuery, filtered };
}

export function formatDate(value: string | null | undefined, locale = 'hu-HU') {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: '2-digit' });
}
