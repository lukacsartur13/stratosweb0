import { useCallback, useEffect, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';
import {
  paymentRefusal,
  type Instalment, type LegacyFinance, type Payment, type PaymentOverview,
} from '@/lib/paymentRules';

/**
 * The payment schedule of one project, and the owner's writes to it.
 *
 * Reads four things in parallel: the instalments, the payments, the database's
 * own figures (`project_payment_overview`) and the carry-over record, if any.
 * All four are owner-only by RLS; for anybody else they are empty, and the
 * panel is never rendered for them anyway (the project itself is owner-only).
 *
 * Writes go straight to the two tables. There is nothing to keep in step by
 * hand: the database derives `projects.payment_state` / `paid_amount` and logs
 * every change. So a refused write leaves nothing half-done, and `reload()`
 * after each write shows exactly what was stored.
 */

const INSTALMENT_COLUMNS = 'id, project_id, label, amount, due_on, invoiced, invoiced_on, note, position, origin';
const PAYMENT_COLUMNS = 'id, instalment_id, project_id, amount, paid_on, note, origin, created_at';

type State = 'loading' | 'ready' | 'error' | 'unconfigured';

const asNumber = <T extends Record<string, unknown>>(row: T, keys: string[]) => {
  const out: Record<string, unknown> = { ...row };
  for (const k of keys) if (out[k] !== null && out[k] !== undefined) out[k] = Number(out[k]);
  return out;
};

export function usePaymentSchedule(projectId: string | undefined, enabled = true) {
  const [instalments, setInstalments] = useState<Instalment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [overview, setOverview] = useState<PaymentOverview | null>(null);
  const [legacy, setLegacy] = useState<LegacyFinance | null>(null);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    if (!projectId || !enabled) return;
    const [i, p, o, l] = await Promise.all([
      supabase.from('project_instalments').select(INSTALMENT_COLUMNS).eq('project_id', projectId)
        .order('position', { ascending: true }).order('due_on', { ascending: true, nullsFirst: true }),
      supabase.from('project_payments').select(PAYMENT_COLUMNS).eq('project_id', projectId)
        .order('paid_on', { ascending: true, nullsFirst: true }),
      supabase.rpc('project_payment_overview', { p_project: projectId }),
      supabase.from('project_finance_legacy')
        .select('project_id, currency, value, payment_state, invoiced_amount, paid_amount, outcome, issues, derived_state, reviewed_at')
        .eq('project_id', projectId).maybeSingle(),
    ]);
    const failed = i.error ?? p.error ?? o.error ?? l.error;
    if (failed) {
      console.error('[payments.read]', failed.code, failed.message);
      setMessage(paymentRefusal(failed));
      setState('error');
      return;
    }
    setInstalments((i.data ?? []).map((r) => asNumber(r, ['amount']) as unknown as Instalment));
    setPayments((p.data ?? []).map((r) => asNumber(r, ['amount']) as unknown as Payment));
    const row = ((o.data ?? []) as Record<string, unknown>[])[0];
    setOverview(row
      ? asNumber(row, ['contracted', 'scheduled', 'paid', 'remaining', 'overpaid', 'overdue', 'schedule_gap', 'monthly_fee']) as unknown as PaymentOverview
      : null);
    setLegacy(l.data
      ? asNumber(l.data as Record<string, unknown>, ['value', 'invoiced_amount', 'paid_amount']) as unknown as LegacyFinance
      : null);
    setState('ready');
  }, [projectId, enabled]);

  useEffect(() => { void load(); }, [load]);

  return { instalments, payments, overview, legacy, state, message, reload: load };
}

/** Every paid project's figures — the receivables summary. Owner-only by RLS. */
export function usePaymentOverview(enabled = true, reloadToken = 0) {
  const [rows, setRows] = useState<PaymentOverview[]>([]);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');

  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    if (!enabled) return;
    setState('loading');
    const { data, error } = await supabase.rpc('project_payment_overview', { p_project: null });
    if (error) {
      console.error('[payments.overview]', error.code, error.message);
      setState('error');
      return;
    }
    setRows(((data ?? []) as Record<string, unknown>[]).map((r) =>
      asNumber(r, ['contracted', 'scheduled', 'paid', 'remaining', 'overpaid', 'overdue', 'schedule_gap', 'monthly_fee']) as unknown as PaymentOverview));
    setState('ready');
  }, [enabled, reloadToken]);

  useEffect(() => { void load(); }, [load]);
  return { rows, state, reload: load };
}

export interface InstalmentDraft {
  label: string; amount: number; due_on: string | null; invoiced: boolean; invoiced_on: string | null; note: string | null;
}
export interface PaymentDraft {
  instalment_id: string; amount: number; paid_on: string | null; note: string | null;
}

/**
 * The owner's writes. Each returns `null` on success or a sentence. `busy`
 * disables the button that started the write, so a double click sends once;
 * the database's rules (not this flag) are what make a stray second request
 * harmless — every write here is an insert of a new, distinct fact or an update
 * by id.
 */
export function usePaymentMutations(projectId: string, onChanged: () => void) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(async (key: string, what: string, op: () => PromiseLike<{ error: { code?: string; message?: string } | null }>) => {
    setBusy(key);
    const { error } = await op();
    setBusy(null);
    if (error) {
      console.error(`[${what}]`, error.code, error.message);
      return paymentRefusal(error);
    }
    onChanged();
    return null;
  }, [onChanged]);

  const saveInstalment = useCallback((draft: InstalmentDraft, id?: string, position = 0) =>
    run(id ?? 'instalment', 'project_instalments.save', () => (id
      ? supabase.from('project_instalments').update(draft).eq('id', id)
      : supabase.from('project_instalments').insert({ ...draft, project_id: projectId, position }))),
  [run, projectId]);

  const removeInstalment = useCallback((id: string) =>
    run(id, 'project_instalments.delete', () => supabase.from('project_instalments').delete().eq('id', id)),
  [run]);

  const savePayment = useCallback((draft: PaymentDraft, id?: string) =>
    run(id ?? 'payment', 'project_payments.save', () => (id
      ? supabase.from('project_payments').update({ amount: draft.amount, paid_on: draft.paid_on, note: draft.note, instalment_id: draft.instalment_id }).eq('id', id)
      : supabase.from('project_payments').insert({ ...draft, project_id: projectId }))),
  [run, projectId]);

  const removePayment = useCallback((id: string) =>
    run(id, 'project_payments.delete', () => supabase.from('project_payments').delete().eq('id', id)),
  [run]);

  const markLegacyReviewed = useCallback((reviewed: boolean) =>
    run('legacy', 'project_finance_legacy.review', () =>
      supabase.from('project_finance_legacy').update({ reviewed_at: reviewed ? new Date().toISOString() : null }).eq('project_id', projectId)),
  [run, projectId]);

  return { saveInstalment, removeInstalment, savePayment, removePayment, markLegacyReviewed, busy };
}
