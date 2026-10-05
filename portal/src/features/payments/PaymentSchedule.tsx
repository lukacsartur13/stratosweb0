import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Badge, Button, DataLine, DataState, Dialog, ErrorState, Field, Input, Panel, SectionHeader, Select, Skeleton, Textarea, cn,
} from '@/components/ui';
import { money } from '@/lib/money';
import { shortDate } from '@/lib/pipeline';
import { t } from '@/lib/i18n';
import { usePaymentMutations, usePaymentOverview, usePaymentSchedule } from '@/lib/payments';
import {
  INSTALMENT_STATE_LABEL, budapestToday, hasScheduleMismatch, legacyIssueText, nextMonth, parseAmount, scheduleTotals, totalsByCurrency,
  type InstalmentView, type Payment,
} from '@/lib/paymentRules';

/**
 * A paid project's payment schedule — instalments, the payments received
 * against each, and the figures they imply.
 *
 * ## One source
 *
 * Nothing on this panel sets "paid". A payment is a row with an amount and a
 * date; an instalment's state, the project's payment state and its paid total
 * are all derived from those rows (by the database, and shown here with the
 * same rules). Invoicing is a separate fact on the instalment.
 *
 * ## Money is never merged across currencies
 *
 * Every figure here is in the project's currency, which the database fixes
 * once a schedule exists.
 *
 * ## Closing
 *
 * Closed projects keep this panel fully editable: a payment that arrives after
 * the handover is recorded like any other, and what is still owed stays in
 * view. Closing never reads it.
 *
 * ## Monthly contracts
 *
 * With a `monthlyFee` the schedule is one instalment per month. "+ Month"
 * pre-fills the next one — the month after the latest, at the current fee —
 * and there is no contract total to check the schedule against.
 */
export function PaymentSchedule({
  projectId, currency, contracted, monthlyFee = null, mayEdit, onChanged,
}: {
  projectId: string; currency: string; contracted: number | null; monthlyFee?: number | null;
  mayEdit: boolean; onChanged: () => void;
}) {
  const monthly = monthlyFee !== null;
  const s = usePaymentSchedule(projectId);
  const reloadAll = () => { void s.reload(); onChanged(); };
  const ops = usePaymentMutations(projectId, reloadAll);
  const [error, setError] = useState<string | null>(null);
  const [instalmentDraft, setInstalmentDraft] = useState<Partial<InstalmentView> | null>(null);
  const [paymentDraft, setPaymentDraft] = useState<{ instalment: InstalmentView; payment?: Payment } | null>(null);

  const today = budapestToday();
  const tot = scheduleTotals(contracted, s.instalments, s.payments, today);
  // The database's figures are authoritative; the local ones (same rules) cover
  // the moment between a write and the reload.
  const o = s.overview;
  const fig = {
    scheduled: o?.scheduled ?? tot.scheduled,
    paid: o?.paid ?? tot.paid,
    remaining: o?.remaining ?? tot.remaining,
    overpaid: o?.overpaid ?? tot.overpaid,
    overdue: o?.overdue ?? tot.overdue,
    gap: o ? o.schedule_gap : tot.scheduleGap,
  };
  const m = (n: number | null) => (n === null ? '—' : money(n, currency));
  const mismatch = s.instalments.length > 0 && hasScheduleMismatch({
    instalments: s.instalments.length, schedule_gap: fig.gap, contracted, billing: monthly ? 'monthly' : 'one_off',
  });

  const remove = async (what: 'instalment' | 'payment', id: string) => {
    if (!window.confirm(what === 'payment'
      ? t('Remove this payment? The removal is logged with its amount.')
      : t('Remove this instalment? Only an instalment without payments can be removed.'))) return;
    setError(what === 'payment' ? await ops.removePayment(id) : await ops.removeInstalment(id));
  };

  return (
    <Panel aria-label={t('Payment schedule')}>
      <SectionHeader
        title={t('Payment schedule')}
        note={t('{currency} · from recorded payments', { currency })}
        action={mayEdit && s.state === 'ready' ? (
          <Button size="sm" onClick={() => setInstalmentDraft(monthly
            ? nextMonth(s.instalments.map((i) => i.due_on), monthlyFee, today)
            : { label: s.instalments.length === 0 ? 'Előleg' : '' })}>
            <Plus size={11} aria-hidden="true" /> {monthly ? t('Month') : t('Instalment')}
          </Button>
        ) : undefined}
      />

      {s.state === 'loading' && <div className="p-4" aria-busy="true"><Skeleton className="h-24 w-full" /></div>}
      {s.state === 'error' && <ErrorState message={s.message} onRetry={s.reload} />}
      {s.state === 'unconfigured' && <DataState kind="unconfigured" title={t('Not connected')} />}

      {s.state === 'ready' && (
        <>
          <dl className="grid" data-payment-figures>
            {monthly ? (
              <DataLine term={t('Monthly fee')} value={<span className="num">{m(monthlyFee)}</span>} note={t('per month')} />
            ) : (
              <DataLine term={t('Contracted')} value={contracted === null ? <span className="text-haze">{t('Not recorded')}</span> : <span className="num">{m(contracted)}</span>}
                        note={t('the project value')} />
            )}
            <DataLine term={t('Scheduled')} value={<span className="num">{m(fig.scheduled)}</span>}
                      note={t(s.instalments.length === 1 ? '{n} instalment' : '{n} instalments', { n: s.instalments.length })} />
            <DataLine term={t('Paid')} value={<span className="num" data-figure="paid">{m(fig.paid)}</span>}
                      note={tot.undated > 0
                        ? t(tot.undated === 1 ? '{n} payment without a date' : '{n} payments without a date', { n: tot.undated })
                        : t(s.payments.length === 1 ? '{n} payment' : '{n} payments', { n: s.payments.length })} />
            <DataLine term={t('Remaining')} value={<span className="num" data-figure="remaining">{m(fig.remaining)}</span>}
                      note={monthly || contracted === null ? t('against the scheduled months') : t('against the contract')} />
            <DataLine term={t('Overdue')} value={<span className={cn('num', fig.overdue > 0 && 'text-danger')} data-figure="overdue">{m(fig.overdue)}</span>}
                      note={fig.overdue > 0 ? t('due date passed, not received') : undefined} />
            {fig.overpaid > 0 && (
              <DataLine term={t('Over-paid')} value={<span className="num text-signal" data-figure="overpaid">{m(fig.overpaid)}</span>}
                        note={t('received beyond the amount due — kept, not absorbed')} />
            )}
          </dl>

          {mismatch && (
            <p className="border-t border-hairline px-4 py-2 text-xs text-signal" role="status" data-signal="schedule-mismatch">
              <Badge tone="warn">{t('Mismatch')}</Badge>{' '}
              {contracted === null
                ? t('No contract value is recorded for this project, so the schedule cannot be checked against it.')
                : (fig.gap ?? 0) < 0
                  ? t('The instalments add up to {scheduled}, {gap} less than the contract.', { scheduled: m(fig.scheduled), gap: m(-(fig.gap ?? 0)) })
                  : t('The instalments add up to {scheduled}, {gap} more than the contract.', { scheduled: m(fig.scheduled), gap: m(fig.gap) })}
            </p>
          )}

          {s.legacy && (
            <div className={cn('border-t border-hairline px-4 py-3', s.legacy.outcome === 'review' && !s.legacy.reviewed_at && 'bg-signal/5')}
                 data-legacy={s.legacy.outcome}>
              <p className="text-xs text-paper">
                <Badge tone={s.legacy.outcome === 'review' && !s.legacy.reviewed_at ? 'warn' : 'neutral'}>{t('Carried over')}</Badge>{' '}
                {t('Before the schedule, this project recorded: {state}', { state: s.legacy.payment_state.replace('_', ' ') })}
                {s.legacy.invoiced_amount !== null ? ` · ${t('invoiced {amount}', { amount: m(s.legacy.invoiced_amount) })}` : ''}
                {s.legacy.paid_amount !== null ? ` · ${t('paid {amount}', { amount: m(s.legacy.paid_amount) })}` : ''}.
              </p>
              <ul className="t-note mt-1 grid gap-0.5">
                {s.legacy.issues.map((i) => <li key={i}>{legacyIssueText(i)}</li>)}
              </ul>
              {mayEdit && s.legacy.outcome === 'review' && (
                <Button size="sm" variant="quiet" className="mt-2" disabled={ops.busy === 'legacy'}
                        onClick={async () => setError(await ops.markLegacyReviewed(!s.legacy!.reviewed_at))}>
                  {s.legacy.reviewed_at ? t('Mark as not reviewed') : t('Mark as reviewed')}
                </Button>
              )}
            </div>
          )}

          {tot.views.length === 0 ? (
            <p className="border-t border-hairline px-4 py-3 text-xs text-haze">
              {monthly
                ? t('No months yet. Add each month as it is billed — + Month fills in the next one at the current fee. Payments are then recorded against it.')
                : t('No instalments yet. Add the parts of the price — e.g. an advance and a final invoice — with their due dates. Payments are then recorded against them.')}
            </p>
          ) : (
            <ul className="grid border-t border-hairline" aria-label={t('Instalments')}>
              {tot.views.map((v) => (
                <li key={v.id} className="border-b border-hairline px-4 py-3 last:border-0" data-instalment={v.state}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] text-paper">
                        {v.label}{' '}
                        <Badge tone={v.state === 'paid' ? 'good' : v.overdue ? 'bad' : v.state === 'overpaid' ? 'warn' : 'neutral'}>
                          {v.overdue ? t('Overdue') : t(INSTALMENT_STATE_LABEL[v.state])}
                        </Badge>{' '}
                        {v.invoiced ? <Badge tone="neutral">{t('Invoiced')}{v.invoiced_on ? ` ${shortDate(v.invoiced_on)}` : ''}</Badge>
                          : <span className="t-note">{t('not invoiced')}</span>}
                      </p>
                      <p className="t-note mt-0.5">
                        <span className="num">{m(v.amount)}</span> · {t('due {date}', { date: v.due_on ? shortDate(v.due_on) : t('not recorded') })}
                        {' · '}{t('received')} <span className="num">{m(v.received)}</span>
                        {v.outstanding > 0 && <> · <span className={cn(v.overdue && 'text-danger')}>{t('outstanding {amount}', { amount: m(v.outstanding) })}</span></>}
                        {v.over > 0 && <> · <span className="text-signal">{t('over-paid {amount}', { amount: m(v.over) })}</span></>}
                      </p>
                      {v.note && <p className="t-note mt-0.5 break-words">{v.note}</p>}
                    </div>
                    {mayEdit && (
                      <div className="flex shrink-0 gap-1">
                        <Button size="sm" onClick={() => setPaymentDraft({ instalment: v })}>
                          <Plus size={11} aria-hidden="true" /> {t('Payment')}
                        </Button>
                        <Button size="sm" variant="quiet" aria-label={t('Edit instalment {label}', { label: v.label })} onClick={() => setInstalmentDraft(v)}>
                          <Pencil size={11} aria-hidden="true" />
                        </Button>
                        {v.payments.length === 0 && (
                          <Button size="sm" variant="quiet" aria-label={t('Remove instalment {label}', { label: v.label })}
                                  disabled={ops.busy === v.id} onClick={() => void remove('instalment', v.id)}>
                            <Trash2 size={11} aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  {v.payments.length > 0 && (
                    <ul className="mt-2 grid gap-1 border-l border-hairline pl-3" aria-label={t('Payments for {label}', { label: v.label })}>
                      {v.payments.map((p) => (
                        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span>
                            <span className="num text-paper">{m(p.amount)}</span>{' '}
                            <span className={cn('t-note', p.paid_on === null && 'text-signal')}>
                              {p.paid_on ? t('on {date}', { date: shortDate(p.paid_on) }) : t('date not recorded')}
                            </span>
                            {p.origin === 'legacy' && <span className="t-note"> · {t('carried over')}</span>}
                            {p.note && <span className="t-note"> · {p.note}</span>}
                          </span>
                          {mayEdit && (
                            <span className="flex gap-1">
                              <Button size="sm" variant="quiet" aria-label={t('Edit payment')} onClick={() => setPaymentDraft({ instalment: v, payment: p })}>
                                <Pencil size={11} aria-hidden="true" />
                              </Button>
                              <Button size="sm" variant="quiet" aria-label={t('Remove payment')} disabled={ops.busy === p.id}
                                      onClick={() => void remove('payment', p.id)}>
                                <Trash2 size={11} aria-hidden="true" />
                              </Button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          {error && <p role="alert" className="border-t border-hairline px-4 py-2 text-xs text-danger">{error}</p>}
          <p className="t-note border-t border-hairline px-4 py-2">
            {t('Paid is only what is recorded here as received. Invoicing is marked per instalment and is not payment. Closing the project does not depend on it.')}
          </p>
        </>
      )}

      {mayEdit && instalmentDraft && (
        <InstalmentDialog
          currency={currency}
          initial={instalmentDraft}
          busy={ops.busy !== null}
          onClose={() => setInstalmentDraft(null)}
          onSave={async (draft) => {
            const problem = await ops.saveInstalment(draft, instalmentDraft.id, instalmentDraft.position ?? s.instalments.length * 10);
            if (!problem) setInstalmentDraft(null);
            return problem;
          }}
        />
      )}
      {mayEdit && paymentDraft && (
        <PaymentDialog
          currency={currency}
          instalment={paymentDraft.instalment}
          instalments={tot.views}
          initial={paymentDraft.payment}
          today={today}
          busy={ops.busy !== null}
          onClose={() => setPaymentDraft(null)}
          onSave={async (draft) => {
            const problem = await ops.savePayment(draft, paymentDraft.payment?.id);
            if (!problem) setPaymentDraft(null);
            return problem;
          }}
        />
      )}
    </Panel>
  );
}

function InstalmentDialog({
  currency, initial, busy, onClose, onSave,
}: {
  currency: string;
  initial: Partial<InstalmentView>;
  busy: boolean;
  onClose: () => void;
  onSave: (d: { label: string; amount: number; due_on: string | null; invoiced: boolean; invoiced_on: string | null; note: string | null }) => Promise<string | null>;
}) {
  const [form, setForm] = useState({
    label: initial.label ?? '',
    amount: initial.amount === undefined ? '' : String(initial.amount),
    due_on: initial.due_on ?? '',
    invoiced: initial.invoiced ?? false,
    invoiced_on: initial.invoiced_on ?? '',
    note: initial.note ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const legacy = initial.origin === 'legacy';

  const submit = async () => {
    if (!form.label.trim()) return setError(t('An instalment needs a name, e.g. "Előleg" or "Végszámla".'));
    const amount = parseAmount(form.amount);
    if ('error' in amount) return setError(amount.error);
    if (!form.due_on && !legacy) return setError(t('An instalment needs a due date.'));
    setError(await onSave({
      label: form.label.trim(),
      amount: amount.value,
      due_on: form.due_on || null,
      invoiced: form.invoiced,
      invoiced_on: form.invoiced && form.invoiced_on ? form.invoiced_on : null,
      note: form.note.trim() || null,
    }));
  };

  return (
    <Dialog open onClose={onClose} title={initial.id ? t('Edit instalment') : t('New instalment')}
            description={t('Amounts are in {currency}, the project\'s currency.', { currency })}
            footer={<>
              <Button size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={submit} disabled={busy}>Save</Button>
            </>}>
      <div className="grid gap-3">
        <Field id="pi-label" label={t('Name')}>
          <Input id="pi-label" data-autofocus value={form.label} maxLength={120}
                 onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))} placeholder="Előleg" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="pi-amount" label={t('Amount ({currency})', { currency })}>
            <Input id="pi-amount" inputMode="decimal" value={form.amount}
                   onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} />
          </Field>
          <Field id="pi-due" label={t('Due')} hint={legacy ? t('Carried over without a due date; add one if known.') : undefined}>
            <Input id="pi-due" type="date" value={form.due_on}
                   onChange={(e) => setForm((p) => ({ ...p, due_on: e.target.value }))} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="pi-invoiced" label={t('Invoiced')}>
            <Select id="pi-invoiced" className="w-full py-2.5 text-sm" value={form.invoiced ? 'yes' : 'no'}
                    onChange={(e) => setForm((p) => ({ ...p, invoiced: e.target.value === 'yes' }))}>
              <option value="no">{t('Not invoiced')}</option>
              <option value="yes">{t('Invoiced')}</option>
            </Select>
          </Field>
          {form.invoiced && (
            <Field id="pi-invoiced-on" label={t('Invoice date')} hint={t('Optional.')}>
              <Input id="pi-invoiced-on" type="date" value={form.invoiced_on}
                     onChange={(e) => setForm((p) => ({ ...p, invoiced_on: e.target.value }))} />
            </Field>
          )}
        </div>
        <Field id="pi-note" label="Note">
          <Textarea id="pi-note" value={form.note} maxLength={2000}
                    onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} />
        </Field>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

function PaymentDialog({
  currency, instalment, instalments, initial, today, busy, onClose, onSave,
}: {
  currency: string;
  instalment: InstalmentView;
  instalments: InstalmentView[];
  initial?: Payment;
  today: string;
  busy: boolean;
  onClose: () => void;
  onSave: (d: { instalment_id: string; amount: number; paid_on: string | null; note: string | null }) => Promise<string | null>;
}) {
  const [form, setForm] = useState({
    instalment_id: initial?.instalment_id ?? instalment.id,
    amount: initial ? String(initial.amount) : instalment.outstanding > 0 ? String(instalment.outstanding) : '',
    paid_on: initial?.paid_on ?? '',
    note: initial?.note ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const target = instalments.find((i) => i.id === form.instalment_id) ?? instalment;
  const parsed = parseAmount(form.amount);
  const before = target.received - (initial && initial.instalment_id === target.id ? initial.amount : 0);
  const willOver = 'value' in parsed && before + parsed.value > target.amount;

  const submit = async () => {
    if ('error' in parsed) return setError(parsed.error);
    // A carried-over payment was never dated; it may stay undated (no date is
    // invented). Every other payment needs the day it arrived.
    const keepUndated = !form.paid_on && initial !== undefined && initial.paid_on === null;
    if (!form.paid_on && !keepUndated) return setError(t('Enter the day the money arrived.'));
    if (form.paid_on > today) return setError(t('A payment is recorded on the day it arrived — that date is in the future.'));
    setError(await onSave({ instalment_id: form.instalment_id, amount: parsed.value, paid_on: form.paid_on || null, note: form.note.trim() || null }));
  };

  return (
    <Dialog open onClose={onClose} title={initial ? t('Edit payment') : t('Record a payment')}
            description={t('Money received, in {currency}. A part payment is fine; record each transfer separately.', { currency })}
            footer={<>
              <Button size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={submit} disabled={busy}>Save</Button>
            </>}>
      <div className="grid gap-3">
        <Field id="pp-instalment" label={t('Instalment')}>
          <Select id="pp-instalment" className="w-full py-2.5 text-sm" value={form.instalment_id}
                  onChange={(e) => setForm((p) => ({ ...p, instalment_id: e.target.value }))}>
            {instalments.map((i) => (
              <option key={i.id} value={i.id}>{i.label} — {t('outstanding {amount}', { amount: money(i.outstanding, currency) })}</option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="pp-amount" label={t('Amount ({currency})', { currency })}>
            <Input id="pp-amount" data-autofocus inputMode="decimal" value={form.amount}
                   onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} />
          </Field>
          <Field id="pp-date" label={t('Received on')} hint={initial && initial.paid_on === null ? t('Carried over without a date. Enter it only if you know it.') : undefined}>
            <Input id="pp-date" type="date" max={today} value={form.paid_on}
                   onChange={(e) => setForm((p) => ({ ...p, paid_on: e.target.value }))} />
          </Field>
        </div>
        {willOver && (
          <p className="text-xs text-signal" role="status">
            {t('This takes “{label}” over its amount by {amount}. It will be saved and shown as over-paid — split it across instalments if part of it belongs to another one.', {
              label: target.label, amount: money(before + ('value' in parsed ? parsed.value : 0) - target.amount, currency),
            })}
          </p>
        )}
        <Field id="pp-note" label="Note">
          <Textarea id="pp-note" value={form.note} maxLength={2000}
                    onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} />
        </Field>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

/**
 * Money still to come, across every paid project that is not archived — open
 * AND closed, because closing a project does not settle it. One line per
 * currency: two currencies are never added into one figure.
 */
export function Receivables({ reloadToken = 0 }: { reloadToken?: number }) {
  const { rows, state, reload } = usePaymentOverview(true, reloadToken);
  const live = rows.filter((r) => !r.archived && (r.instalments > 0 || r.paid > 0));
  const totals = totalsByCurrency(live);
  // Everything still owed (overdue first), plus over-payments and schedules
  // that do not match their contract.
  const attention = live
    .filter((r) => r.remaining > 0 || r.overpaid > 0 || hasScheduleMismatch(r))
    .sort((a, b) => b.overdue - a.overdue || b.remaining - a.remaining);

  return (
    <Panel aria-label={t('Receivables')}>
      <SectionHeader title={t('Receivables')} note={t('from recorded payments · per currency')} />
      {state === 'loading' && <div className="p-4" aria-busy="true"><Skeleton className="h-16 w-full" /></div>}
      {state === 'error' && <ErrorState message={t('The payment figures could not be read.')} onRetry={reload} />}
      {state === 'ready' && totals.length === 0 && (
        <p className="px-4 py-3 text-xs text-haze">{t('No payment schedule has been recorded on any project yet.')}</p>
      )}
      {state === 'ready' && totals.length > 0 && (
        <>
          <dl className="grid sm:grid-cols-2">
            {totals.map((c) => (
              <div key={c.currency} className="border-b border-hairline sm:border-r" data-currency={c.currency}>
                <p className="t-section px-4 pt-2.5">{c.currency} · {t(c.projects === 1 ? '{n} project' : '{n} projects', { n: c.projects })}</p>
                <DataLine term={t('Contracted')} value={<span className="num">{money(c.contracted, c.currency)}</span>} />
                <DataLine term={t('Paid')} value={<span className="num">{money(c.paid, c.currency)}</span>} />
                <DataLine term={t('Remaining')} value={<span className="num">{money(c.remaining, c.currency)}</span>} />
                <DataLine term={t('Overdue')} value={<span className={cn('num', c.overdue > 0 && 'text-danger')}>{money(c.overdue, c.currency)}</span>} />
                {c.overpaid > 0 && <DataLine term={t('Over-paid')} value={<span className="num text-signal">{money(c.overpaid, c.currency)}</span>} />}
              </div>
            ))}
          </dl>
          {attention.length > 0 && (
            <ul className="grid" aria-label={t('Outstanding by project')}>
              {attention.map((r) => (
                <li key={r.project_id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline px-4 py-2 last:border-0">
                  <Link to={`/projects/${r.project_id}`} className="text-[13px] text-paper underline-offset-4 hover:underline">
                    {r.project_name}{r.client_name ? <span className="t-note"> · {r.client_name}</span> : null}
                    {r.status === 'completed' && <span className="t-note"> · {t('closed')}</span>}
                  </Link>
                  <span className="text-xs">
                    {r.remaining > 0 && <span className="num">{t('owes {amount}', { amount: money(r.remaining, r.currency) })}</span>}
                    {r.overdue > 0 && <span className="num text-danger"> · {t('overdue {amount}', { amount: money(r.overdue, r.currency) })}</span>}
                    {r.overpaid > 0 && <span className="num text-signal"> {t('over-paid {amount}', { amount: money(r.overpaid, r.currency) })}</span>}
                    {hasScheduleMismatch(r) && <span className="text-signal"> · {t('schedule ≠ contract')}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
