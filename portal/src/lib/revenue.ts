import { useCallback, useEffect, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';

/**
 * The revenue report (20261016000100_revenue_report.sql): one call, every
 * figure per currency (never converted), shaped here for the screen.
 * Months are 'YYYY-MM-01'.
 */

export interface RevenueRow {
  section: 'collected' | 'client' | 'service' | 'mrr' | 'forecast';
  month: string | null; key: string | null; label: string | null; currency: string; amount: number;
}

type State = 'loading' | 'ready' | 'error' | 'unconfigured' | 'missing';

export function useRevenueReport(reloadToken: number) {
  const [rows, setRows] = useState<RevenueRow[]>([]);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    const { data, error } = await supabase.rpc('portal_revenue_report');
    if (error) { console.error('[revenue]', error.code); setState(error.code === 'PGRST202' ? 'missing' : 'error'); return; }
    setRows(((data ?? []) as RevenueRow[]).map((r) => ({ ...r, month: r.month ? String(r.month).slice(0, 10) : null, amount: Number(r.amount) })));
    setState('ready');
  }, [reloadToken]);
  useEffect(() => { void load(); }, [load]);
  return { rows, state, reload: load };
}

/** 'YYYY-MM-01' of a date, n months away. */
export function monthOf(base: Date, offset = 0): string {
  const d = new Date(Date.UTC(base.getFullYear(), base.getMonth() + offset, 1));
  return d.toISOString().slice(0, 10);
}

/** The months from `from` to `to` inclusive, oldest first. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  while (d.toISOString().slice(0, 10) <= to) { out.push(d.toISOString().slice(0, 10)); d.setUTCMonth(d.getUTCMonth() + 1); }
  return out;
}

/** Sum of a section's rows in one currency, per month. */
export function byMonth(rows: RevenueRow[], section: RevenueRow['section'], currency: string, key?: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.section !== section || r.currency !== currency || !r.month) continue;
    if (key !== undefined && r.key !== key) continue;
    out.set(r.month, (out.get(r.month) ?? 0) + r.amount);
  }
  return out;
}

/** Totals per client or service over [from, to], largest first. */
export function ranking(rows: RevenueRow[], section: 'client' | 'service', currency: string, from: string, to: string) {
  const out = new Map<string, { label: string; value: number }>();
  for (const r of rows) {
    if (r.section !== section || r.currency !== currency || !r.month || r.month < from || r.month > to) continue;
    const k = r.key ?? '—';
    const e = out.get(k) ?? { label: r.label ?? '—', value: 0 };
    e.value += r.amount;
    out.set(k, e);
  }
  return [...out.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.value - a.value);
}

/** Every currency that appears, HUF first. */
export function currencies(rows: RevenueRow[]): string[] {
  const set = new Set(rows.map((r) => r.currency));
  return [...set].sort((a, b) => (a === 'HUF' ? -1 : b === 'HUF' ? 1 : a.localeCompare(b)));
}
