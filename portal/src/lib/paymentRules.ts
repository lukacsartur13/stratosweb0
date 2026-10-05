// =============================================================================
// The payment schedule's arithmetic — pure, no imports but `./i18n` (the rule `money.ts`,
// `pipeline.ts` and `dbError.ts` follow), so a test runs every branch without a
// browser.
//
// THE DATABASE IS THE SOURCE. `project_payment_overview()` computes the same
// figures in SQL, and `projects.payment_state` / `paid_amount` are derived by a
// trigger (20261002000100_payment_schedule.sql). This file only renders what
// those rows imply, per instalment, with the SAME rules — asserted equal in
// tests/portal-payments.spec.ts. Nothing here is written back.
//
// Every figure is in ONE currency: a schedule is in its project's currency, and
// that currency is fixed while a schedule exists. Totals across projects are
// grouped by currency, never added.
// =============================================================================

import { t } from './i18n.ts';

export interface Instalment {
  id: string;
  project_id: string;
  label: string;
  amount: number;
  due_on: string | null;
  invoiced: boolean;
  invoiced_on: string | null;
  note: string | null;
  position: number;
  origin: 'manual' | 'legacy';
}

export interface Payment {
  id: string;
  instalment_id: string;
  project_id: string;
  amount: number;
  paid_on: string | null;
  note: string | null;
  origin: 'manual' | 'legacy';
  created_at: string;
}

/** One row of `project_payment_overview()`. */
export interface PaymentOverview {
  project_id: string;
  project_name: string;
  client_name: string | null;
  status: string;
  archived: boolean;
  currency: string;
  contracted: number | null;
  scheduled: number;
  paid: number;
  remaining: number;
  overpaid: number;
  overdue: number;
  schedule_gap: number | null;
  next_due_on: string | null;
  instalments: number;
  payments: number;
  undated_payments: number;
  /** `one_off` | `monthly` (20261006000100). Absent before that migration. */
  billing?: string;
  /** Monthly contracts only: the agreed fee per month. */
  monthly_fee?: number | null;
}

/** The pre-schedule single-sum figures, kept verbatim by the migration. */
export interface LegacyFinance {
  project_id: string;
  currency: string;
  value: number | null;
  payment_state: string;
  invoiced_amount: number | null;
  paid_amount: number | null;
  outcome: 'carried' | 'review';
  issues: string[];
  derived_state: string | null;
  reviewed_at: string | null;
}

export type InstalmentState = 'open' | 'partial' | 'paid' | 'overpaid';

export interface InstalmentView extends Instalment {
  payments: Payment[];
  received: number;
  /** amount − received, never below 0. */
  outstanding: number;
  /** received − amount, never below 0. Shown, never absorbed. */
  over: number;
  state: InstalmentState;
  overdue: boolean;
}

/** Money is numeric(14,2): add in cents, so 0.1 + 0.2 is 0.3. */
const cents = (n: number) => Math.round(Number(n) * 100);
const fromCents = (c: number) => c / 100;
export const sumAmounts = (xs: { amount: number }[]) => fromCents(xs.reduce((s, x) => s + cents(x.amount), 0));

/** Today in Budapest as YYYY-MM-DD — the database's `portal_today()`. */
export function budapestToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(now);
}

export function instalmentView(inst: Instalment, payments: Payment[], today: string): InstalmentView {
  const mine = payments.filter((p) => p.instalment_id === inst.id)
    .sort((a, b) => (a.paid_on ?? '').localeCompare(b.paid_on ?? '') || a.created_at.localeCompare(b.created_at));
  const received = sumAmounts(mine);
  const diff = cents(inst.amount) - cents(received);
  const state: InstalmentState = diff > 0 ? (received > 0 ? 'partial' : 'open') : diff === 0 ? 'paid' : 'overpaid';
  return {
    ...inst,
    payments: mine,
    received,
    outstanding: fromCents(Math.max(diff, 0)),
    over: fromCents(Math.max(-diff, 0)),
    state,
    // Same rule as the SQL: due strictly before today, and not fully received.
    overdue: diff > 0 && inst.due_on !== null && inst.due_on < today,
  };
}

/**
 * The project's figures from its rows — the TypeScript twin of
 * `project_payment_overview()`. The panel shows the database's row when it has
 * one; this exists so the per-instalment list and the totals can never tell two
 * stories, and so the rules are testable here.
 */
export function scheduleTotals(contracted: number | null, instalments: Instalment[], payments: Payment[], today: string) {
  const views = instalments.map((i) => instalmentView(i, payments, today));
  const scheduled = sumAmounts(instalments);
  const paid = sumAmounts(payments);
  const basis = contracted ?? scheduled;
  const remaining = fromCents(Math.max(cents(basis) - cents(paid), 0));
  const overpaid = fromCents(Math.max(cents(paid) - cents(basis), 0));
  const lateShortfall = views.filter((v) => v.overdue).reduce((s, v) => s + cents(v.outstanding), 0);
  return {
    views,
    contracted,
    scheduled,
    paid,
    remaining,
    overpaid,
    // Capped at what is still owed: money over-paid on one instalment is not
    // owed again on another.
    overdue: fromCents(Math.min(lateShortfall, cents(remaining))),
    scheduleGap: contracted === null ? null : fromCents(cents(scheduled) - cents(contracted)),
    undated: payments.filter((p) => p.paid_on === null).length,
  };
}

/** What `projects.payment_state` will read — the SQL `project_payment_derived`. */
export function derivedPaymentState(contracted: number | null, instalments: Instalment[], payments: Payment[]) {
  const scheduled = sumAmounts(instalments);
  const paid = sumAmounts(payments);
  const target = contracted ?? scheduled;
  if (payments.length > 0 && target > 0 && cents(paid) >= cents(target)) return 'paid';
  if (payments.length > 0) return 'partially_paid';
  if (instalments.some((i) => i.invoiced)) return 'invoiced';
  return 'not_invoiced';
}

/**
 * Receivables across projects, one line per currency. Two currencies are two
 * lines; nothing converts or adds them.
 */
export function totalsByCurrency(rows: PaymentOverview[]) {
  const by = new Map<string, { currency: string; contracted: number; paid: number; remaining: number; overdue: number; overpaid: number; projects: number; mismatched: number }>();
  for (const r of rows) {
    const tot = by.get(r.currency) ?? { currency: r.currency, contracted: 0, paid: 0, remaining: 0, overdue: 0, overpaid: 0, projects: 0, mismatched: 0 };
    tot.contracted = fromCents(cents(tot.contracted) + cents(r.contracted ?? 0));
    tot.paid = fromCents(cents(tot.paid) + cents(r.paid));
    tot.remaining = fromCents(cents(tot.remaining) + cents(r.remaining));
    tot.overdue = fromCents(cents(tot.overdue) + cents(r.overdue));
    tot.overpaid = fromCents(cents(tot.overpaid) + cents(r.overpaid));
    tot.projects += 1;
    if (hasScheduleMismatch(r)) tot.mismatched += 1;
    by.set(r.currency, tot);
  }
  return [...by.values()].sort((a, b) => (a.currency === 'HUF' ? -1 : b.currency === 'HUF' ? 1 : a.currency.localeCompare(b.currency)));
}

/**
 * A schedule that exists and does not add up to the contract, or a contract
 * never recorded. A monthly contract has no total to add up to — one
 * instalment per month is its whole shape — so it is never a mismatch.
 */
export function hasScheduleMismatch(r: Pick<PaymentOverview, 'instalments' | 'schedule_gap' | 'contracted' | 'billing'>) {
  if (r.instalments === 0) return false;
  if (r.billing === 'monthly') return false;
  if (r.contracted === null) return true;
  return r.schedule_gap !== null && r.schedule_gap !== 0;
}

/** Parse a typed amount: spaces and a decimal comma allowed; > 0; two decimals at most. */
export function parseAmount(raw: string): { value: number } | { error: string } {
  const s = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return { error: t('Enter an amount.') };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: t('An amount is a positive number with at most two decimals.') };
  const value = Number(s);
  if (!(value > 0)) return { error: t('An amount must be more than 0.') };
  if (value > 1_000_000_000_000) return { error: t('That amount is too large.') };
  return { value };
}

export const INSTALMENT_STATE_LABEL: Record<InstalmentState, string> = {
  open: 'Not paid',
  partial: 'Partly paid',
  paid: 'Paid',
  overpaid: 'Over-paid',
};

/** The carry-over's findings, in words. `state_changed:a->b` is parameterised. */
export function legacyIssueText(issue: string): string {
  if (issue.startsWith('state_changed:')) {
    const [from, to] = issue.slice('state_changed:'.length).split('->');
    return t('The payment state read "{from}" before and now reads "{to}", because it follows the recorded payments.', { from: stateWord(from), to: stateWord(to) });
  }
  return ({
    payment_date_unknown: t('The paid amount was carried over without a date — none was ever recorded. Add the date if you know it.'),
    nothing_to_carry: t('A payment state was set, but no amount was ever recorded, so there was nothing to carry over.'),
    instalment_amount_from_contract_value: t('No invoiced amount was recorded; the carried instalment uses the contract value.'),
    marked_paid_without_amount: t('It was marked paid with no paid amount. Record the payment if it arrived.'),
    marked_paid_amount_short: t('It was marked paid, but the paid amount is less than the contract or invoiced amount.'),
    partial_without_amount: t('It was marked partly paid with no paid amount.'),
    state_contradicts_amounts: t('The old payment state contradicted the amounts recorded beside it.'),
    paid_exceeds_contract: t('More was recorded as paid than the contract value. The over-payment is kept and shown.'),
    invoiced_exceeds_contract: t('More was recorded as invoiced than the contract value.'),
    paid_exceeds_invoiced: t('More was recorded as paid than as invoiced.'),
  } as Record<string, string>)[issue] ?? issue;
}

function stateWord(s: string) {
  return ({ not_invoiced: t('Not invoiced'), invoiced: t('Invoiced'), partially_paid: t('Partially paid'), paid: t('Paid') } as Record<string, string>)[s] ?? s;
}

/** The database's refusals, as sentences. */
export function paymentRefusal(error: { code?: string | null; message?: string | null }): string {
  const m = error.message ?? '';
  const known: [string, string][] = [
    ['stratos:payment_impact_free', t('An Impact project is free: it has no payment schedule and takes no client payment.')],
    ['stratos:payment_future_date', t('A payment is recorded on the day it arrived — that date is in the future.')],
    ['stratos:payment_date_required', t('A payment with a date cannot lose it.')],
    ['stratos:payment_currency_fixed', t('This project has a payment schedule, so its currency cannot change.')],
    ['stratos:payment_derived', t('Payment state and paid amount follow the payment schedule. Record an instalment or a payment instead.')],
    ['stratos:payment_origin_fixed', t('Carried-over rows are written only by the migration.')],
    ['stratos:payment_project_fixed', t('An instalment or payment stays with its project.')],
    ['stratos:payment_legacy_fixed', t('The carried-over figures are a record and cannot be edited.')],
  ];
  for (const [key, text] of known) if (m.includes(key)) return text;
  if (error.code === '23001' || error.code === '23503') return t('This instalment has payments. Remove or move them first.');
  if (error.code === '23514') return t('The database refused those values. Check the amount and the dates.');
  if (error.code === 'PGRST205' || error.code === 'PGRST202' || error.code === '42P01') {
    return t('The payment schedule is not installed on this database yet (20261002000100_payment_schedule.sql).');
  }
  return t('The payment could not be saved. Check that this account is the portal owner, then try again.');
}

/**
 * The next month of a monthly contract: one month after the latest due date
 * (keeping its day of the month, clamped to the month's length), or today when
 * there is none. Named like "2026. október", at the current fee.
 */
export function nextMonth(dues: (string | null)[], fee: number, today: string): { label: string; amount: number; due_on: string } {
  const latest = dues.filter((d): d is string => Boolean(d)).sort().pop();
  let due = today;
  if (latest) {
    const [y, mo, d] = latest.split('-').map(Number);
    const ny = mo === 12 ? y + 1 : y;
    const nm = mo === 12 ? 1 : mo + 1;
    const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    due = `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  }
  const [y, mo] = due.split('-').map(Number);
  const label = new Intl.DateTimeFormat('hu-HU', { year: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, mo - 1, 1)));
  return { label, amount: fee, due_on: due };
}
