// =============================================================================
// The payment schedule's arithmetic — pure, no imports (the rule `money.ts`,
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
    const t = by.get(r.currency) ?? { currency: r.currency, contracted: 0, paid: 0, remaining: 0, overdue: 0, overpaid: 0, projects: 0, mismatched: 0 };
    t.contracted = fromCents(cents(t.contracted) + cents(r.contracted ?? 0));
    t.paid = fromCents(cents(t.paid) + cents(r.paid));
    t.remaining = fromCents(cents(t.remaining) + cents(r.remaining));
    t.overdue = fromCents(cents(t.overdue) + cents(r.overdue));
    t.overpaid = fromCents(cents(t.overpaid) + cents(r.overpaid));
    t.projects += 1;
    if (hasScheduleMismatch(r)) t.mismatched += 1;
    by.set(r.currency, t);
  }
  return [...by.values()].sort((a, b) => (a.currency === 'HUF' ? -1 : b.currency === 'HUF' ? 1 : a.currency.localeCompare(b.currency)));
}

/** A schedule that exists and does not add up to the contract, or a contract never recorded. */
export function hasScheduleMismatch(r: Pick<PaymentOverview, 'instalments' | 'schedule_gap' | 'contracted'>) {
  if (r.instalments === 0) return false;
  if (r.contracted === null) return true;
  return r.schedule_gap !== null && r.schedule_gap !== 0;
}

/** Parse a typed amount: spaces and a decimal comma allowed; > 0; two decimals at most. */
export function parseAmount(raw: string): { value: number } | { error: string } {
  const t = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return { error: 'Enter an amount.' };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: 'An amount is a positive number with at most two decimals.' };
  const value = Number(t);
  if (!(value > 0)) return { error: 'An amount must be more than 0.' };
  if (value > 1_000_000_000_000) return { error: 'That amount is too large.' };
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
    return `The payment state read "${stateWord(from)}" before and now reads "${stateWord(to)}", because it follows the recorded payments.`;
  }
  return ({
    payment_date_unknown: 'The paid amount was carried over without a date — none was ever recorded. Add the date if you know it.',
    nothing_to_carry: 'A payment state was set, but no amount was ever recorded, so there was nothing to carry over.',
    instalment_amount_from_contract_value: 'No invoiced amount was recorded; the carried instalment uses the contract value.',
    marked_paid_without_amount: 'It was marked paid with no paid amount. Record the payment if it arrived.',
    marked_paid_amount_short: 'It was marked paid, but the paid amount is less than the contract or invoiced amount.',
    partial_without_amount: 'It was marked partly paid with no paid amount.',
    state_contradicts_amounts: 'The old payment state contradicted the amounts recorded beside it.',
    paid_exceeds_contract: 'More was recorded as paid than the contract value. The over-payment is kept and shown.',
    invoiced_exceeds_contract: 'More was recorded as invoiced than the contract value.',
    paid_exceeds_invoiced: 'More was recorded as paid than as invoiced.',
  } as Record<string, string>)[issue] ?? issue;
}

function stateWord(s: string) {
  return ({ not_invoiced: 'Not invoiced', invoiced: 'Invoiced', partially_paid: 'Partially paid', paid: 'Paid' } as Record<string, string>)[s] ?? s;
}

/** The database's refusals, as sentences. */
export function paymentRefusal(error: { code?: string | null; message?: string | null }): string {
  const m = error.message ?? '';
  const known: [string, string][] = [
    ['stratos:payment_impact_free', 'An Impact project is free: it has no payment schedule and takes no client payment.'],
    ['stratos:payment_future_date', 'A payment is recorded on the day it arrived — that date is in the future.'],
    ['stratos:payment_date_required', 'A payment with a date cannot lose it.'],
    ['stratos:payment_currency_fixed', 'This project has a payment schedule, so its currency cannot change.'],
    ['stratos:payment_derived', 'Payment state and paid amount follow the payment schedule. Record an instalment or a payment instead.'],
    ['stratos:payment_origin_fixed', 'Carried-over rows are written only by the migration.'],
    ['stratos:payment_project_fixed', 'An instalment or payment stays with its project.'],
    ['stratos:payment_legacy_fixed', 'The carried-over figures are a record and cannot be edited.'],
  ];
  for (const [key, text] of known) if (m.includes(key)) return text;
  if (error.code === '23001' || error.code === '23503') return 'This instalment has payments. Remove or move them first.';
  if (error.code === '23514') return 'The database refused those values. Check the amount and the dates.';
  if (error.code === 'PGRST205' || error.code === 'PGRST202' || error.code === '42P01') {
    return 'The payment schedule is not installed on this database yet (20261002000100_payment_schedule.sql).';
  }
  return 'The payment could not be saved. Check that this account is the portal owner, then try again.';
}
