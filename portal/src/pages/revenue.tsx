import { useMemo, useState } from 'react';
import { BarList, Delta, Segmented, TrendChart } from '@/components/charts';
import { DataState, ErrorState, MetricCell, MetricStrip, Panel, SectionHeader, Skeleton } from '@/components/ui';
import { useScope } from '@/lib/scope';
import { money, moneyCompact } from '@/lib/money';
import { intlLocale, t } from '@/lib/i18n';
import { byMonth, currencies, monthOf, monthsBetween, ranking, useRevenueReport } from '@/lib/revenue';

/**
 * REVENUE — what came in, what the monthly contracts bring, who and what it
 * came from, and what the next six months look like. Owner-only, like the
 * payments it is made of. One currency at a time: amounts are never converted.
 */

const monthLabel = (m: string, long = false) =>
  new Date(`${m}T00:00:00Z`).toLocaleDateString(intlLocale('en-GB'), { month: long ? 'long' : 'short', year: long ? 'numeric' : '2-digit', timeZone: 'UTC' });

type Period = 'year' | '12m' | 'all';
type Split = 'client' | 'service';

export function RevenueScreen() {
  const { reloadToken } = useScope();
  const report = useRevenueReport(reloadToken);
  const found = currencies(report.rows);
  const [chosen, setChosen] = useState<string | null>(null);
  const currency = chosen && found.includes(chosen) ? chosen : (found[0] ?? 'HUF');

  if (report.state === 'loading') return <Skeleton className="h-64 w-full" />;
  if (report.state === 'unconfigured') return <Panel><DataState kind="unconfigured" title={t('Not connected')} /></Panel>;
  if (report.state === 'missing') return <Panel><DataState kind="empty" title={t('This feature is not installed on the database yet (20261016000100).')} /></Panel>;
  if (report.state === 'error') return <Panel><ErrorState message={t('The revenue report could not be read.')} onRetry={report.reload} /></Panel>;
  if (report.rows.length === 0) {
    return <Panel><DataState kind="empty" title={t('No revenue recorded yet')} body={t('Payments recorded in the projects\' payment schedules, and monthly contracts, appear here.')} /></Panel>;
  }

  return (
    <div className="grid gap-4">
      {found.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="t-note">{t('Currency')}</span>
          <Segmented label={t('Currency')} value={currency} options={found.map((c) => ({ id: c, label: c }))} onChange={setChosen} />
          <span className="t-note">{t('Amounts in different currencies are never added together.')}</span>
        </div>
      )}
      <Headline rows={report.rows} currency={currency} />
      <Collected rows={report.rows} currency={currency} />
      <Breakdown rows={report.rows} currency={currency} />
      <Forecast rows={report.rows} currency={currency} />
    </div>
  );
}

type Rows = ReturnType<typeof useRevenueReport>['rows'];

function Headline({ rows, currency }: { rows: Rows; currency: string }) {
  const now = new Date();
  const thisMonth = monthOf(now);
  const collected = byMonth(rows, 'collected', currency);
  const mrr = byMonth(rows, 'mrr', currency);
  const sum = (from: string, to: string) => [...collected.entries()].filter(([m]) => m >= from && m <= to).reduce((n, [, v]) => n + v, 0);
  const year = now.getFullYear();
  const ytd = sum(`${year}-01-01`, thisMonth);
  const lastYtd = sum(`${year - 1}-01-01`, monthOf(now, -12));
  const last12 = sum(monthOf(now, -11), thisMonth);
  const mrrNow = mrr.get(thisMonth) ?? 0;
  const mrrYearAgo = mrr.get(monthOf(now, -12)) ?? 0;
  const delta = (a: number, b: number) => (b > 0 ? (a - b) / b : null);
  return (
    <MetricStrip label={t('Key figures')} className="xl:grid-cols-4">
      <MetricCell label={t('This year so far')} value={moneyCompact(ytd, currency)} delta={<Delta value={delta(ytd, lastYtd)} />}
                  note={t('same period last year: {amount}', { amount: moneyCompact(lastYtd, currency) ?? '—' })} />
      <MetricCell label={t('Last 12 months')} value={moneyCompact(last12, currency)} />
      <MetricCell label={t('This month')} value={moneyCompact(collected.get(thisMonth) ?? 0, currency)} />
      <MetricCell label={t('Monthly fees now')} value={moneyCompact(mrrNow, currency)} delta={<Delta value={delta(mrrNow, mrrYearAgo)} />}
                  note={t('running monthly contracts')} />
    </MetricStrip>
  );
}

function Collected({ rows, currency }: { rows: Rows; currency: string }) {
  const [view, setView] = useState<'collected' | 'mrr'>('collected');
  const now = new Date();
  const months = monthsBetween(monthOf(now, -11), monthOf(now));
  const series = byMonth(rows, view, currency);
  const points = months.map((m) => series.get(m) ?? 0);
  const title = view === 'collected' ? t('Collected per month') : t('Monthly fees (MRR)');
  return (
    <Panel aria-label={t('Collected per month')}>
      <SectionHeader title={title} note={t('last 12 months')}
        action={<Segmented label={t('Series')} value={view} onChange={setView}
          options={[{ id: 'collected', label: t('Collected') }, { id: 'mrr', label: t('Monthly fees') }]} />} />
      <TrendChart points={points} labels={months.map((m) => monthLabel(m))} label={`${title} · ${currency}`} height={220} />
      <p className="t-note border-t border-hairline px-4 py-2">
        {view === 'collected'
          ? t('Money received, from the payments recorded in the projects\' payment schedules — not invoices issued.')
          : t('The monthly fee of every monthly contract running in that month.')}
      </p>
    </Panel>
  );
}

function Breakdown({ rows, currency }: { rows: Rows; currency: string }) {
  const [split, setSplit] = useState<Split>('client');
  const [period, setPeriod] = useState<Period>('year');
  const now = new Date();
  const to = monthOf(now);
  const from = period === 'year' ? `${now.getFullYear()}-01-01` : period === '12m' ? monthOf(now, -11) : '0000-01-01';
  const list = useMemo(() => ranking(rows, split, currency, from, to), [rows, split, currency, from, to]);
  const total = list.reduce((n, r) => n + r.value, 0);
  return (
    <Panel aria-label={t('Where it came from')}>
      <SectionHeader title={t('Where it came from')}
        action={
          <div className="flex flex-wrap gap-2">
            <Segmented label={t('By')} value={split} onChange={setSplit} options={[{ id: 'client', label: t('Clients') }, { id: 'service', label: t('Services') }]} />
            <Segmented label={t('Period')} value={period} onChange={setPeriod}
              options={[{ id: 'year', label: t('This year') }, { id: '12m', label: t('12 months') }, { id: 'all', label: t('3 years') }]} />
          </div>
        } />
      <BarList rows={list.slice(0, 15).map((r) => ({ key: r.label, value: r.value, note: total > 0 ? `${Math.round((r.value / total) * 100)}%` : undefined }))}
               empty={t('Nothing collected in this period.')} format={(v) => money(v, currency) ?? '—'} />
    </Panel>
  );
}

function Forecast({ rows, currency }: { rows: Rows; currency: string }) {
  const now = new Date();
  const months = monthsBetween(monthOf(now), monthOf(now, 5));
  const parts = {
    scheduled: byMonth(rows, 'forecast', currency, 'scheduled'),
    monthly: byMonth(rows, 'forecast', currency, 'monthly'),
    pipeline: byMonth(rows, 'forecast', currency, 'pipeline'),
  };
  const cell = (v: number | undefined) => (v ? money(Math.round(v), currency) : '—');
  const sure = (m: string) => (parts.scheduled.get(m) ?? 0) + (parts.monthly.get(m) ?? 0);
  return (
    <Panel aria-label={t('Forecast')}>
      <SectionHeader title={t('Forecast')} note={t('next 6 months')} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-left">
              <th className="label px-4 py-2 font-normal">{t('Month')}</th>
              <th className="label px-4 py-2 text-right font-normal">{t('Scheduled')}</th>
              <th className="label px-4 py-2 text-right font-normal">{t('Monthly fees')}</th>
              <th className="label px-4 py-2 text-right font-normal">{t('Expected')}</th>
              <th className="label px-4 py-2 text-right font-normal">{t('Deals (weighted)')}</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m} className="border-b border-hairline last:border-0" data-forecast={m}>
                <td className="px-4 py-2 text-paper">{monthLabel(m, true)}</td>
                <td className="num px-4 py-2 text-right text-haze">{cell(parts.scheduled.get(m))}</td>
                <td className="num px-4 py-2 text-right text-haze">{cell(parts.monthly.get(m))}</td>
                <td className="num px-4 py-2 text-right text-paper">{cell(sure(m))}</td>
                <td className="num px-4 py-2 text-right text-haze">{cell(parts.pipeline.get(m))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="t-note border-t border-hairline px-4 py-2">
        {t('Expected = unpaid instalments by due date (anything overdue counts this month) + monthly fees not already in a schedule. Deals: open deals × their probability, in their expected close month — not added to the expected figure.')}
      </p>
    </Panel>
  );
}
