import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  budapestToday, derivedPaymentState, hasScheduleMismatch, instalmentView, legacyIssueText, parseAmount,
  paymentRefusal, scheduleTotals, totalsByCurrency, type Instalment, type Payment, type PaymentOverview,
} from '../portal/src/lib/paymentRules';

/**
 * Phase 5 — the payment schedule's pure rules and the structural contracts
 * (no database, no browser). The database half, including "the TypeScript
 * figures equal the SQL figures", is tests/portal-payments-db.spec.ts; the
 * rendered half is the `payments:` checks in scripts/portal-tracker-check.mjs.
 */

const ROOT = process.cwd();
const src = (...p: string[]) => fs.readFileSync(path.join(ROOT, 'portal', 'src', ...p), 'utf8');

const inst = (id: string, amount: number, due: string | null, extra: Partial<Instalment> = {}): Instalment => ({
  id, project_id: 'p', label: id, amount, due_on: due, invoiced: false, invoiced_on: null, note: null, position: 0, origin: 'manual', ...extra,
});
const pay = (id: string, instalment: string, amount: number, on: string | null = '2026-09-01'): Payment => ({
  id, instalment_id: instalment, project_id: 'p', amount, paid_on: on, note: null, origin: on ? 'manual' : 'legacy', created_at: '2026-09-01T00:00:00Z',
});
const TODAY = '2026-09-27';

test.describe('an instalment', () => {
  test('open, partly paid, paid, over-paid — from the payments alone', () => {
    const i = inst('a', 1000, '2026-10-01');
    expect(instalmentView(i, [], TODAY)).toMatchObject({ state: 'open', received: 0, outstanding: 1000, over: 0, overdue: false });
    expect(instalmentView(i, [pay('1', 'a', 300), pay('2', 'a', 200)], TODAY)).toMatchObject({ state: 'partial', received: 500, outstanding: 500 });
    expect(instalmentView(i, [pay('1', 'a', 1000)], TODAY)).toMatchObject({ state: 'paid', outstanding: 0, over: 0 });
    expect(instalmentView(i, [pay('1', 'a', 1250)], TODAY)).toMatchObject({ state: 'overpaid', outstanding: 0, over: 250 });
  });

  test('overdue: due strictly before today and not fully received; no due date is never overdue', () => {
    expect(instalmentView(inst('a', 10, '2026-09-26'), [], TODAY).overdue).toBe(true);
    expect(instalmentView(inst('a', 10, TODAY), [], TODAY).overdue).toBe(false);
    expect(instalmentView(inst('a', 10, '2026-09-26'), [pay('1', 'a', 10)], TODAY).overdue).toBe(false);
    expect(instalmentView(inst('a', 10, null, { origin: 'legacy' }), [], TODAY).overdue).toBe(false);
  });

  test('cents are exact: 0.1 + 0.2 pays 0.3', () => {
    expect(instalmentView(inst('a', 0.3, null), [pay('1', 'a', 0.1), pay('2', 'a', 0.2)], TODAY).state).toBe('paid');
  });
});

test.describe('a project\'s figures', () => {
  test('contracted, scheduled, paid, remaining, overdue; overdue never exceeds what is owed', () => {
    const t = scheduleTotals(900, [inst('a', 500, '2026-09-01'), inst('b', 400, '2026-09-20')], [pay('1', 'a', 700)], TODAY);
    expect(t).toMatchObject({ contracted: 900, scheduled: 900, paid: 700, remaining: 200, overpaid: 0, overdue: 200, scheduleGap: 0 });
  });

  test('over-payment is shown, not absorbed', () => {
    const t = scheduleTotals(100, [inst('a', 100, '2026-09-01')], [pay('1', 'a', 150)], TODAY);
    expect(t).toMatchObject({ paid: 150, remaining: 0, overpaid: 50 });
  });

  test('without a contract value, the schedule is the basis — and that is a mismatch to show', () => {
    const t = scheduleTotals(null, [inst('a', 100, '2026-10-01')], [], TODAY);
    expect(t).toMatchObject({ remaining: 100, scheduleGap: null });
    expect(hasScheduleMismatch({ instalments: 1, schedule_gap: null, contracted: null })).toBe(true);
    expect(hasScheduleMismatch({ instalments: 1, schedule_gap: -5, contracted: 100 })).toBe(true);
    expect(hasScheduleMismatch({ instalments: 1, schedule_gap: 0, contracted: 100 })).toBe(false);
    expect(hasScheduleMismatch({ instalments: 0, schedule_gap: null, contracted: null })).toBe(false);
  });

  test('the derived payment state follows payments; invoicing is separate', () => {
    expect(derivedPaymentState(100, [], [])).toBe('not_invoiced');
    expect(derivedPaymentState(100, [inst('a', 100, TODAY)], [])).toBe('not_invoiced');
    expect(derivedPaymentState(100, [inst('a', 100, TODAY, { invoiced: true })], [])).toBe('invoiced');
    expect(derivedPaymentState(100, [inst('a', 100, TODAY)], [pay('1', 'a', 40)])).toBe('partially_paid');
    expect(derivedPaymentState(100, [inst('a', 100, TODAY)], [pay('1', 'a', 100)])).toBe('paid');
    // Paid is measured against the contract, not the (short) schedule.
    expect(derivedPaymentState(200, [inst('a', 100, TODAY)], [pay('1', 'a', 100)])).toBe('partially_paid');
  });

  test('receivables are grouped per currency and never added across currencies', () => {
    const row = (currency: string, remaining: number): PaymentOverview => ({
      project_id: currency + remaining, project_name: 'x', client_name: null, status: 'active', archived: false, currency,
      contracted: remaining, scheduled: remaining, paid: 0, remaining, overpaid: 0, overdue: 0, schedule_gap: 0,
      next_due_on: null, instalments: 1, payments: 0, undated_payments: 0,
    });
    const t = totalsByCurrency([row('EUR', 10), row('HUF', 1000), row('HUF', 500)]);
    expect(t.map((x) => [x.currency, x.remaining, x.projects])).toEqual([['HUF', 1500, 2], ['EUR', 10, 1]]);
  });
});

test.describe('input and messages', () => {
  test('amounts: spaces and a decimal comma, > 0, two decimals at most', () => {
    expect(parseAmount('1 250 000')).toEqual({ value: 1250000 });
    expect(parseAmount('99,5')).toEqual({ value: 99.5 });
    for (const bad of ['', '0', '-5', 'abc', '1.234', '1e5']) expect('error' in parseAmount(bad), bad).toBe(true);
  });

  test('every database refusal has a sentence, and none leaks the database text', () => {
    for (const code of ['payment_impact_free', 'payment_future_date', 'payment_currency_fixed', 'payment_derived', 'payment_origin_fixed']) {
      const text = paymentRefusal({ message: `stratos:${code}` });
      expect(text, code).not.toContain('stratos:');
      expect(text.length).toBeGreaterThan(20);
    }
    expect(paymentRefusal({ code: '23001', message: 'update or delete on table "project_instalments" violates RESTRICT' }))
      .toContain('has payments');
  });

  test('every carry-over finding reads as a sentence', () => {
    for (const i of ['payment_date_unknown', 'nothing_to_carry', 'marked_paid_without_amount', 'paid_exceeds_contract', 'state_changed:paid->invoiced']) {
      expect(legacyIssueText(i), i).not.toBe(i);
    }
    expect(legacyIssueText('state_changed:paid->invoiced')).toContain('"Paid"');
  });

  test('today is Budapest\'s day', () => {
    expect(budapestToday(new Date('2026-09-27T22:30:00Z'))).toBe('2026-09-28');
    expect(budapestToday(new Date('2026-09-27T21:30:00Z'))).toBe('2026-09-27');
  });
});

test.describe('structural contracts', () => {
  test('one source: no screen edits payment state, invoiced or paid amount by hand', () => {
    const projects = src('pages', 'projects.tsx');
    expect(projects).not.toMatch(/payment_state:\s*form\./);
    expect(projects).not.toMatch(/(invoiced|paid)_amount:\s*(invoiced|paid)\b/);
    expect(projects).not.toMatch(/id="ep-payment"|id="ep-paid"|id="ep-invoiced"/);
    // The schedule panel never writes to projects.
    const panel = src('features', 'payments', 'PaymentSchedule.tsx') + src('lib', 'payments.ts');
    expect(panel).not.toMatch(/from\('projects'\)/);
  });

  test('the client portal never reads money', () => {
    const client = src('lib', 'clientPortal.ts') + src('features', 'client', 'ClientApp.tsx');
    expect(client).not.toMatch(/instalment|project_payments|payment_overview|paid_amount|invoiced/i);
    const migration = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261002000100_payment_schedule.sql'), 'utf8');
    expect(migration).not.toMatch(/client_portal_/);
  });

  test('"next action done" is one RPC; the screen writes no note of its own', () => {
    const sales = src('lib', 'sales.ts');
    const body = sales.slice(sales.indexOf('const completeAction'), sales.indexOf('return { create, update, setStage'));
    expect(body).toMatch(/rpc\('opportunity_complete_action'/);
    expect(body).not.toMatch(/from\('record_notes'\)|from\('opportunities'\)/);
    expect(body).toMatch(/p_expected: deal\.next_action/);
  });

  test('Sales opens on this month and the pipeline; Clear really clears', () => {
    const sales = src('lib', 'sales.ts');
    expect(sales).toMatch(/DEFAULT_FILTERS: SalesFilters = \{\s*query: '', stage: 'pipeline', owner: 'all', service: 'all', source: 'all', close: 'month',/);
    expect(sales).toMatch(/CLEARED_FILTERS: SalesFilters = \{\s*query: '', stage: 'all', owner: 'all', service: 'all', source: 'all', close: 'all',/);
    expect(sales).toMatch(/const reset = useCallback\(\(\) => setFilters\(CLEARED_FILTERS\), \[\]\);/);
    expect(sales).toMatch(/if \(filters\.stage === 'pipeline'\) out = out\.filter\(\(o\) => !isConverted\(o\)\);/);
    expect(sales).toMatch(/export const isConverted = \(o: Pick<Opportunity, 'stage' \| 'organization_id'>\): boolean =>\s*o\.stage === 'won' && Boolean\(o\.organization_id\);/);
  });
});
