import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Plus, X } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { can } from '@/lib/permissions';
import { useScope } from '@/lib/scope';
import {
  Button, Cell, DataLine, DataState, ErrorState, Input, NotRecorded,
  Panel, Row, SectionHeader, Select, Skeleton, StatusPill, Table, cn,
} from '@/components/ui';
import { Meter } from '@/components/charts';
import { NewOpportunity } from '@/features/sales/OpportunityForm';
import {
  STAGE, STAGES, averageWonDeal, bucket, count, dueTone, shortDate, stageDistribution,
  stageLabel, stageTone, weighted, winRate, type Stage,
} from '@/lib/pipeline';
import { money, moneyCompact, percent, primaryTotal, sumByCurrency } from '@/lib/money';
import {
  CLOSE_OPTIONS, dealParty, dealSource, followUps, useOpportunities, useOpportunityMutations,
  useSalesFilter, type Opportunity,
} from '@/lib/sales';
import { useSalesSummary } from '@/lib/business';
import { t } from '@/lib/i18n';

/**
 * SALES — the commercial workspace.
 *
 * ## Why this is one screen with four views and not four screens
 *
 * Pipeline, Table, Follow-ups and Performance are four ways of reading ONE list.
 * They share the same fetch, the same filters and the same records; splitting
 * them into four routes would mean four loads of the same data and a sidebar
 * with four children under Sales, which §45 asks not to do for small features.
 *
 * The view lives in the URL (`/sales?view=table`), so a colleague can be sent
 * "the table, filtered to overdue" and land on it.
 *
 * ## Why the board has no drag-and-drop
 *
 * §62 requires that if a stage can be changed by dragging, a non-drag control
 * must exist too. Read forwards, that is an argument for building the keyboard
 * control first — and once every card carries a stage `select` that works with a
 * keyboard, a touch, a screen reader and a 390px phone, drag is a SECOND way to
 * do the same thing whose only advantage is that it feels nice on a desktop
 * mouse. It also cannot be made to work on the phone layout, where the columns
 * are stacked.
 *
 * So: one control, on every card, in every view, at every width. The board is a
 * board because seeing the shape of the pipeline is worth having; the stage is
 * changed the same way everywhere.
 */

type View = 'pipeline' | 'table' | 'followups' | 'performance';

// English source text; translated where it is rendered (`t(v.label)`).
const VIEWS: { id: View; label: string }[] = [
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'table', label: 'Table' },
  { id: 'followups', label: 'Follow-ups' },
  { id: 'performance', label: 'Performance' },
];

export function SalesScreen() {
  const { profile } = useAuth();
  const { reloadToken } = useScope();
  const [params, setParams] = useSearchParams();
  const mayEdit = can(profile?.role, 'manage_sales');

  const view = (VIEWS.find((v) => v.id === params.get('view'))?.id ?? 'pipeline') as View;
  const list = useOpportunities(reloadToken);
  const summary = useSalesSummary(true, reloadToken);
  const filter = useSalesFilter(list.rows, params.get('stage') ?? undefined);
  const [creating, setCreating] = useState(false);

  const setView = (next: View) => {
    const updated = new URLSearchParams(params);
    updated.set('view', next);
    setParams(updated, { replace: true });
  };

  const reload = () => { void list.reload(); void summary.reload(); };

  return (
    <div className="grid gap-4">
      <PipelineStrip
        rows={summary.rows}
        state={summary.state}
        message={summary.message}
        onRetry={summary.reload}
      />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <nav aria-label={t('Sales views')} className="flex flex-wrap items-center gap-px">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              aria-current={view === v.id ? 'page' : undefined}
              className={cn(
                'rounded-sm px-2.5 py-1.5 font-data text-[10px] uppercase tracking-[0.14em] transition-colors',
                view === v.id ? 'bg-flare text-paper' : 'text-haze hover:bg-flare hover:text-paper',
              )}
            >
              {t(v.label)}
            </button>
          ))}
        </nav>

        {mayEdit && (
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            <Plus size={12} aria-hidden="true" /> {t('New opportunity')}
          </Button>
        )}
      </div>

      {list.state === 'loading' && (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {list.state === 'unconfigured' && (
        <Panel>
          <DataState
            kind="unconfigured"
            title={t('Not connected')}
            body={t('Supabase credentials are not set in this environment, so there is nothing to read yet.')}
          />
        </Panel>
      )}

      {list.state === 'error' && <Panel><ErrorState message={list.message} onRetry={list.reload} /></Panel>}

      {list.state === 'ready' && list.rows.length === 0 && <NothingYet mayEdit={mayEdit} onCreate={() => setCreating(true)} />}

      {list.state === 'ready' && list.rows.length > 0 && (
        <>
          {view === 'pipeline' && <Board rows={filter.filtered} filter={filter} mayEdit={mayEdit} onChanged={reload} />}
          {view === 'table' && <TableView filter={filter} capped={list.capped} limit={list.limit} />}
          {view === 'followups' && <FollowUpView rows={list.rows} mayEdit={mayEdit} onChanged={reload} />}
          {view === 'performance' && (
            <Performance
              rows={summary.rows}
              state={summary.state}
              message={summary.message}
              onRetry={summary.reload}
            />
          )}
        </>
      )}

      {mayEdit && (
        <NewOpportunity open={creating} onClose={() => setCreating(false)} onCreated={reload} />
      )}
    </div>
  );
}

/* ============================================================ the strip == */

/**
 * What the business has in motion, in four figures (§7).
 *
 * Every one is derived by the database from real rows. `Total pipeline` and
 * `Weighted` are open deals only — a won deal is not "in motion" and counting it
 * here would make the pipeline grow every time something closed.
 *
 * When a bucket spans two currencies the cell prints the largest and says how
 * many records are not in it. Nothing here adds two currencies together,
 * because nothing in this system knows a rate (§4).
 */
function PipelineStrip({
  rows, state, message, onRetry,
}: {
  rows: ReturnType<typeof useSalesSummary>['rows'];
  state: string;
  message: string;
  onRetry: () => void;
}) {
  const open = sumByCurrency(bucket(rows, 'open'));
  const closing = sumByCurrency(bucket(rows, 'closing_month'));
  const wonMtd = sumByCurrency(bucket(rows, 'won_mtd'));

  const cells: { label: string; total: ReturnType<typeof primaryTotal>; weighted?: boolean; note: string }[] = [
    { label: t('Total pipeline'), total: primaryTotal(open), note: t('open opportunities') },
    { label: t('Weighted'), total: primaryTotal(open), weighted: true, note: t('value × probability') },
    { label: t('Closing this month'), total: primaryTotal(closing), note: t('expected close date') },
    { label: t('Won this month'), total: primaryTotal(wonMtd), note: t('marked won') },
  ];

  return (
    <>
    <Panel
      aria-label={t('Pipeline value')}
      className="grid grid-cols-2 divide-x divide-y divide-hairline bg-panel xl:grid-cols-4 xl:divide-y-0"
    >
      {cells.map((cell) => {
        const figure = cell.total.total;
        const amount = figure ? (cell.weighted ? figure.weighted : figure.value) : null;
        return (
          <div key={cell.label} className="min-w-0 px-4 py-3.5">
            <p className="t-section truncate">{cell.label}</p>
            <p className="t-metric mt-1.5">
              {state === 'loading'
                ? <Skeleton className="h-7 w-24" />
                : figure && figure.items > 0
                  ? moneyCompact(amount, figure.currency)
                  : <span className="text-haze">—</span>}
            </p>
            <div className="mt-1 flex min-h-[14px] flex-wrap items-baseline gap-x-2">
              <span className="t-note">
                {figure && figure.items > 0 ? `${figure.items} · ${cell.note}` : cell.note}
              </span>
              {cell.total.others > 0 && (
                <span className="t-note text-signal">
                  {t('+{n} in {currencies}', { n: cell.total.others, currencies: cell.total.otherCurrencies.join(', ') })}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </Panel>

    {/*
      Four `—` cells are what "nothing has been recorded yet" looks like, and
      until this line they were also what "the aggregate function does not
      exist" looked like. One is a new business; the other is a broken one. The
      strip keeps its layout — this is a sibling line, not a fifth cell — and
      says which.
    */}
    {state === 'error' && (
      <p role="status" className="t-note flex flex-wrap items-baseline gap-x-2 text-danger">
        <span>{message}</span>
        <button
          type="button"
          onClick={onRetry}
          className="underline underline-offset-2 hover:text-paper"
        >
          {t('Retry')}
        </button>
      </p>
    )}
    </>
  );
}

/* ============================================================= the board == */

/**
 * The pipeline as columns. Compact cards, and deliberately so (§11).
 *
 * A card carries the six things that decide whether to open it — what it is, who
 * it is with, what it is worth, how likely, when it closes and what happens next
 * — and nothing else. A Trello-sized card with a description, an avatar row and
 * three labels shows four deals per screen, which is the opposite of what a
 * pipeline view is for.
 *
 * Horizontal scroll BELOW `xl`, inside the board's own container. At phone width
 * the columns stack, because six columns at 390px is six unreadable columns.
 */
function Board({
  rows, filter, mayEdit, onChanged,
}: {
  rows: Opportunity[];
  filter: ReturnType<typeof useSalesFilter>;
  mayEdit: boolean;
  onChanged: () => void;
}) {
  const columns = [...STAGES];

  return (
    <div className="grid gap-3">
      <FilterBar filter={filter} shown={rows.length} />
      <div className="overflow-x-auto pb-1">
        <div className="grid min-w-[280px] gap-3 sm:grid-cols-2 lg:min-w-[900px] lg:grid-cols-3 xl:grid-cols-6">
          {columns.map((stage) => {
            const inStage = rows.filter((o) => o.stage === stage);
            const totals = primaryTotal(sumByCurrency(
              inStage.map((o) => ({ currency: o.currency, value: o.estimated_value ?? 0, weighted: weighted(o) ?? 0 })),
            ));
            return (
              <section key={stage} aria-label={t(STAGE[stage].label)} className="min-w-0">
                <header className="mb-2 flex items-baseline justify-between gap-2 border-b border-hairline pb-1.5">
                  <h2 className="t-section text-chrome">{t(STAGE[stage].label)}</h2>
                  <span className="num text-[11px] text-haze">{inStage.length}</span>
                </header>
                <p className="t-note mb-2 min-h-[15px]">
                  {totals.total && totals.total.value > 0
                    ? moneyCompact(totals.total.value, totals.total.currency)
                    : ''}
                </p>
                <div className="grid gap-2">
                  {inStage.length === 0 && (
                    <p className="rounded-sm border border-dashed border-hairline px-3 py-4 text-center text-[10px] text-haze">
                      {t('Nothing here')}
                    </p>
                  )}
                  {inStage.map((deal) => (
                    <DealCard key={deal.id} deal={deal} mayEdit={mayEdit} onChanged={onChanged} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DealCard({
  deal, mayEdit, onChanged,
}: { deal: Opportunity; mayEdit: boolean; onChanged: () => void }) {
  const navigate = useNavigate();
  const mutate = useOpportunityMutations(onChanged);
  const [error, setError] = useState<string | null>(null);
  const closeTone = dueTone(deal.expected_close_on);

  return (
    <article className="rounded-sm border border-hair bg-deck px-3 py-2.5 transition-colors hover:bg-flare">
      <Link to={`/sales/${deal.id}`} className="block text-[13px] leading-snug text-paper hover:text-signal">
        {deal.title}
      </Link>
      <p className="mt-0.5 truncate text-[11px] text-haze">{dealParty(deal)}</p>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="num text-[12px] text-paper">
          {money(deal.estimated_value, deal.currency) ?? <span className="text-haze">{t('no value')}</span>}
        </span>
        <span className="num text-[10px] text-haze">{deal.probability}%</span>
      </div>

      {deal.expected_close_on && (
        <p className={cn(
          'num mt-1 text-[10px]',
          closeTone === 'overdue' ? 'text-danger' : closeTone === 'today' ? 'text-signal' : 'text-haze',
        )}>
          {closeTone === 'overdue' ? t('overdue · ') : ''}{shortDate(deal.expected_close_on)}
        </p>
      )}

      {deal.next_action && (
        <p className="mt-1 truncate text-[10px] text-haze" title={deal.next_action}>
          → {deal.next_action}
        </p>
      )}

      {mayEdit && (
        <>
          {/*
            THE accessible stage control (§62). A native select: it is reachable
            by Tab, operable by arrow keys, announced by every screen reader, and
            works identically under a finger at 390px. There is no drag
            alternative to provide because there is no drag.
          */}
          <label className="sr-only" htmlFor={`stage-${deal.id}`}>
            {t('Stage for {title}', { title: deal.title })}
          </label>
          <Select
            id={`stage-${deal.id}`}
            value={deal.stage}
            disabled={mutate.busy === deal.id}
            className="mt-2 w-full"
            onChange={async (e) => {
              const next = e.target.value as Stage;
              // Losing a deal asks for a reason, and the reason belongs on the
              // detail screen where there is room to say it. A dropdown that
              // silently records a loss with no reason is how §16's future sales
              // intelligence never gets collected.
              if (next === 'lost') { navigate(`/sales/${deal.id}?close=lost`); return; }
              setError(await mutate.setStage(deal.id, next, deal));
            }}
          >
            {STAGES.map((s) => <option key={s} value={s}>{t(STAGE[s].label)}</option>)}
          </Select>
          {error && <p role="alert" className="mt-1 text-[10px] text-danger">{error}</p>}
        </>
      )}
    </article>
  );
}

/* ============================================================= the table == */

/**
 * The same records as a table, which is more useful than the board for
 * everything except seeing the shape (§12).
 */
function TableView({
  filter, capped, limit,
}: { filter: ReturnType<typeof useSalesFilter>; capped: boolean; limit: number }) {
  const navigate = useNavigate();
  const rows = filter.filtered;

  return (
    <Panel className="min-w-0">
      <div className="border-b border-hairline px-4 py-2.5">
        <FilterBar filter={filter} shown={rows.length} inline />
      </div>

      {rows.length === 0 ? (
        <DataState
          kind="empty"
          title={t('Nothing matches')}
          body={filter.filters.close === 'month'
            ? t('No opportunity matches every filter above. The view opens on deals closing this month — clear the filters to see every deal, including won deals that became clients.')
            : t('No opportunity matches every filter above.')}
          action={<Button size="sm" onClick={filter.reset}>{t('Clear filters')}</Button>}
        />
      ) : (
        <>
          <Table
            head={[
              t('Opportunity'), t('Company'), t('Stage'),
              { label: t('Value'), align: 'right' },
              { label: t('Prob.'), align: 'right' },
              { label: t('Weighted'), align: 'right' },
              t('Expected close'), t('Next action'), t('Source'),
            ]}
            minWidth={840}
            sticky
          >
            {rows.map((deal) => {
              const tone = dueTone(deal.expected_close_on);
              return (
                <Row key={deal.id} onClick={() => navigate(`/sales/${deal.id}`)}>
                  <Cell className="min-w-0">
                    <Link to={`/sales/${deal.id}`} className="text-[13px] text-paper hover:text-signal">
                      {deal.title}
                    </Link>
                  </Cell>
                  <Cell className="truncate text-[11px] text-haze">{dealParty(deal)}</Cell>
                  <Cell><StatusPill tone={stageTone(deal.stage)}>{stageLabel(deal.stage)}</StatusPill></Cell>
                  <Cell align="right" className="num text-xs text-paper">
                    {money(deal.estimated_value, deal.currency) ?? <span className="text-haze">—</span>}
                  </Cell>
                  <Cell align="right" className="num text-xs text-haze">{deal.probability}%</Cell>
                  <Cell align="right" className="num text-xs text-chrome">
                    {money(weighted(deal), deal.currency) ?? <span className="text-haze">—</span>}
                  </Cell>
                  <Cell className={cn(
                    'num whitespace-nowrap text-[11px]',
                    tone === 'overdue' ? 'text-danger' : tone === 'today' ? 'text-signal' : 'text-haze',
                  )}>
                    {shortDate(deal.expected_close_on)}
                  </Cell>
                  <Cell className="max-w-[180px] truncate text-[11px] text-haze">
                    {deal.next_action || '—'}
                  </Cell>
                  <Cell className="break-words text-[11px] text-haze">{dealSource(deal)}</Cell>
                </Row>
              );
            })}
          </Table>

          {capped && (
            <p className="t-note border-t border-hairline px-4 py-2">
              {t('Showing the {limit} most recently updated opportunities. Narrow the filters to reach older records.', { limit })}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

/**
 * One control row (§12). Every option list is built from the values the rows
 * actually carry, and the owner filter is absent entirely while one account owns
 * everything — a filter with one option is a control that does nothing.
 */
function FilterBar({
  filter, shown, inline = false,
}: { filter: ReturnType<typeof useSalesFilter>; shown: number; inline?: boolean }) {
  const { filters, set, options } = filter;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', !inline && 'px-0')}>
      <Input
        type="search"
        value={filters.query}
        onChange={(e) => set('query', e.target.value)}
        placeholder={t('Opportunity or company…')}
        aria-label={t('Search opportunities')}
        className="h-7 w-full py-1 text-xs sm:w-52"
      />

      <label className="sr-only" htmlFor="sales-stage">{t('Stage')}</label>
      <Select id="sales-stage" value={filters.stage} onChange={(e) => set('stage', e.target.value)}>
        {/*
          `In the pipeline` is the default and is not "everything": a won deal
          that has become a client has left the pipeline (see `isConverted` in
          lib/sales.ts) and is shown only under `Everything` or `Won`.
        */}
        <option value="pipeline">{t('In the pipeline ({n})', { n: filter.counts.pipeline ?? 0 })}</option>
        <option value="open">{t('Open only ({n})', { n: filter.counts.open ?? 0 })}</option>
        <option value="all">{t('Everything ({n})', { n: filter.counts.all ?? 0 })}</option>
        {STAGES.map((s) => (
          <option key={s} value={s}>{t(STAGE[s].label)} ({filter.counts[s] ?? 0})</option>
        ))}
      </Select>

      <label className="sr-only" htmlFor="sales-close">{t('Close date')}</label>
      <Select id="sales-close" value={filters.close} onChange={(e) => set('close', e.target.value)}>
        {CLOSE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{t(o.label)}</option>)}
      </Select>

      {options.services.length > 0 && (
        <>
          <label className="sr-only" htmlFor="sales-service">{t('Service')}</label>
          <Select id="sales-service" value={filters.service} onChange={(e) => set('service', e.target.value)}>
            <option value="all">{t('Any service')}</option>
            {options.services.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </>
      )}

      {options.sources.length > 0 && (
        <>
          <label className="sr-only" htmlFor="sales-source">{t('Source')}</label>
          <Select id="sales-source" value={filters.source} onChange={(e) => set('source', e.target.value)}>
            <option value="all">{t('Any source')}</option>
            {options.sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </>
      )}

      {/* Only when there is genuinely more than one owner (§12, §39). */}
      {options.owners.length > 1 && (
        <>
          <label className="sr-only" htmlFor="sales-owner">{t('Responsible')}</label>
          <Select id="sales-owner" value={filters.owner} onChange={(e) => set('owner', e.target.value)}>
            <option value="all">{t('Anyone')}</option>
            {options.owners.map((o) => (
              <option key={o.id} value={o.id}>{o.full_name || o.email}</option>
            ))}
          </Select>
        </>
      )}

      <label className="sr-only" htmlFor="sales-sort">{t('Sort')}</label>
      <Select id="sales-sort" value={filter.sort} onChange={(e) => filter.setSort(e.target.value as never)}>
        <option value="updated">{t('Recently updated')}</option>
        <option value="value">{t('By value')}</option>
        <option value="close">{t('By close date')}</option>
        <option value="company">{t('By company')}</option>
      </Select>

      {filter.narrowed && (
        <Button size="sm" variant="quiet" onClick={filter.reset}>
          <X size={11} aria-hidden="true" /> {t('Clear')}
        </Button>
      )}

      <span className="t-note ml-auto whitespace-nowrap">{t('{n} shown', { n: shown })}</span>
    </div>
  );
}

/* ========================================================== the follow-ups */

/**
 * The morning list (§38). Three groups, one row each.
 *
 * `Done` clears the action on the deal — it does not tick a box beside it. The
 * row leaves the list because the data no longer puts it there, which is the
 * same reason it leaves when the action is changed on the deal, and the deal
 * then asks for its next step on the Dashboard rather than pretending to have
 * one.
 */
function FollowUpView({
  rows, mayEdit, onChanged,
}: { rows: Opportunity[]; mayEdit: boolean; onChanged: () => void }) {
  const mutate = useOpportunityMutations(onChanged);
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => {
    const all = followUps(rows);
    return [
      { id: 'overdue' as const, title: t('Overdue'), items: all.filter((f) => f.group === 'overdue') },
      { id: 'today' as const, title: t('Today'), items: all.filter((f) => f.group === 'today') },
      { id: 'upcoming' as const, title: t('Upcoming'), items: all.filter((f) => f.group === 'upcoming') },
    ];
  }, [rows]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  if (total === 0) {
    return (
      <Panel>
        <SectionHeader title={t('Follow-ups')} />
        <DataState
          kind="empty"
          title={t('Nothing scheduled')}
          body={t('Follow-ups appear here when an open opportunity has a next action with a date on it.')}
        />
      </Panel>
    );
  }

  return (
    <div className="grid gap-4">
      {groups.map((group) => (
        <Panel key={group.id} className="min-w-0">
          <SectionHeader
            title={group.title}
            note={group.items.length > 0 ? `${group.items.length}` : undefined}
          />
          {group.items.length === 0 ? (
            <p className="px-4 py-3 text-xs text-haze">
              {group.id === 'overdue' ? t('Nothing overdue.') : group.id === 'today' ? t('Nothing today.') : t('Nothing upcoming.')}
            </p>
          ) : (
            <Table
              head={[t('Action'), t('Opportunity'), t('Company'), t('Due'), t('Stage'), t('Responsible'), ...(mayEdit ? [''] : [])]}
              minWidth={mayEdit ? 840 : 720}
            >
              {group.items.map(({ deal }) => (
                <Row key={deal.id}>
                  <Cell className="min-w-0 text-[13px] text-paper">{deal.next_action}</Cell>
                  <Cell className="min-w-0">
                    <Link to={`/sales/${deal.id}`} className="text-[12px] text-chrome hover:text-signal">
                      {deal.title}
                    </Link>
                  </Cell>
                  <Cell className="truncate text-[11px] text-haze">{dealParty(deal)}</Cell>
                  <Cell className={cn(
                    'num whitespace-nowrap text-[11px]',
                    group.id === 'overdue' ? 'text-danger' : group.id === 'today' ? 'text-signal' : 'text-haze',
                  )}>
                    {shortDate(deal.next_action_on)}
                  </Cell>
                  <Cell><StatusPill tone={stageTone(deal.stage)}>{stageLabel(deal.stage)}</StatusPill></Cell>
                  <Cell className="truncate text-[11px] text-haze">
                    {deal.owner?.full_name || deal.owner?.email || '—'}
                  </Cell>
                  {mayEdit && (
                    <Cell align="right" className="whitespace-nowrap">
                      <Button
                        size="sm"
                        disabled={mutate.busy === deal.id}
                        aria-label={t('Mark done: {action}', { action: deal.next_action })}
                        onClick={async () => setError(await mutate.completeAction(deal))}
                      >
                        <Check size={11} aria-hidden="true" /> {t('Done')}
                      </Button>
                    </Cell>
                  )}
                </Row>
              ))}
            </Table>
          )}
        </Panel>
      ))}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/* ========================================================= the performance */

/**
 * PERFORMANCE (§32) — the aggregate view, from real records only.
 *
 * Not a separate Finance module: §32 asks for a compact page inside Sales unless
 * the architecture strongly requires otherwise, and it does not. Every figure
 * here comes from `portal_sales_summary()`, which means every one of them is the
 * database's answer rather than a client-side sum over a truncated list.
 *
 * `Win rate` is null — not `0%` — until at least one deal has closed. A rate
 * computed from no closed deals is unknown, and printing `0%` would be the first
 * number somebody read on a new account and the first one that was wrong.
 */
function Performance({
  rows, state, message, onRetry,
}: {
  rows: ReturnType<typeof useSalesSummary>['rows'];
  state: string;
  message: string;
  onRetry: () => void;
}) {
  if (state === 'loading') return <Skeleton className="h-64 w-full" />;
  if (state === 'error') {
    // Was: "It may need the P2 migration." A guess, hedged, and printed whether
    // the cause was a missing function, an expired session or an unplugged
    // network cable. `classify` knows which; this prints what it knows.
    return (
      <Panel>
        <ErrorState message={message} onRetry={onRetry} />
      </Panel>
    );
  }

  const open = primaryTotal(sumByCurrency(bucket(rows, 'open')));
  const wonMtd = primaryTotal(sumByCurrency(bucket(rows, 'won_mtd')));
  const wonYtd = primaryTotal(sumByCurrency(bucket(rows, 'won_ytd')));
  const average = averageWonDeal(rows);
  const rate = winRate(rows);
  const stages = stageDistribution(rows);
  const maxStage = Math.max(...stages.map((s) => s.value), 1);

  const figure = (total: ReturnType<typeof primaryTotal>, weightedValue = false) => {
    const t = total.total;
    if (!t || t.items === 0) return <NotRecorded />;
    return <span className="num">{money(weightedValue ? t.weighted : t.value, t.currency)}</span>;
  };

  return (
    <div className="grid gap-4">
      <Panel>
        <SectionHeader title={t('Commercial performance')} note={t('from recorded opportunities only')} />
        <dl className="grid sm:grid-cols-2">
          <div className="border-b border-hairline sm:border-r">
            <DataLine term={t('Won this month')} value={figure(wonMtd)} note={t('{n} deals', { n: wonMtd.total?.items ?? 0 })} />
            <DataLine term={t('Won this year')} value={figure(wonYtd)} note={t('{n} deals', { n: wonYtd.total?.items ?? 0 })} />
            <DataLine
              term={t('Average won deal')}
              value={average.length > 0
                ? <span className="num">{money(average[0].value, average[0].currency)}</span>
                : <NotRecorded />}
              note={average.length > 1 ? t('and {n} other currency', { n: average.length - 1 }) : undefined}
            />
          </div>
          <div>
            <DataLine term={t('Open pipeline')} value={figure(open)} note={t('{n} open', { n: open.total?.items ?? 0 })} />
            <DataLine term={t('Weighted pipeline')} value={figure(open, true)} note={t('value × probability')} />
            <DataLine
              term={t('Win rate')}
              value={rate === null
                ? <NotRecorded what={t('Win rate')} />
                : <span className="num">{percent(rate)}</span>}
              note={rate === null
                ? t('no deal has closed yet')
                : t('{won} won of {closed} closed', { won: count(rows, 'won_all'), closed: count(rows, 'won_all') + count(rows, 'lost_all') })}
            />
          </div>
        </dl>
      </Panel>

      <Panel>
        <SectionHeader title={t('Open pipeline by stage')} />
        {stages.every((s) => s.items === 0) ? (
          <DataState kind="empty" title={t('No open opportunities')} body={t('Nothing is in the pipeline right now.')} />
        ) : (
          <Table
            head={[t('Stage'), { label: t('Deals'), align: 'right' }, { label: t('Value'), align: 'right' },
              { label: t('Weighted'), align: 'right' }]}
            minWidth={560}
          >
            {stages.map((s) => (
              <Row key={s.stage}>
                <Cell className="min-w-0">
                  <span className="text-[13px] text-paper">{t(STAGE[s.stage].label)}</span>
                  <span className="mt-1 block"><Meter value={s.value} max={maxStage} /></span>
                </Cell>
                <Cell align="right" className="num text-xs text-paper">{s.items}</Cell>
                <Cell align="right" className="num text-xs text-paper">
                  {s.items === 0 ? '—' : moneyCompact(s.value, s.currency ?? 'HUF')}
                </Cell>
                <Cell align="right" className="num text-xs text-chrome">
                  {s.items === 0 ? '—' : moneyCompact(s.weighted, s.currency ?? 'HUF')}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
        <p className="t-note border-t border-hairline px-4 py-2.5">
          {t('Weighted is')} <span className="text-paper">{t('estimated value × probability')}</span>
          {t('. The stage probabilities are operational defaults, editable per opportunity — they are not measured Stratos win rates.')}
        </p>
      </Panel>
    </div>
  );
}

/* ======================================================== the empty state */

function NothingYet({ mayEdit, onCreate }: { mayEdit: boolean; onCreate: () => void }) {
  return (
    <Panel>
      <DataState
        kind="empty"
        title={t('No opportunities yet')}
        body={t('An opportunity is a qualified commercial possibility. Convert a qualified lead from the Leads screen, or create one directly for a conversation that started somewhere else.')}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link to="/leads?status=qualified">
              <Button size="sm">{t('Convert a qualified lead')}</Button>
            </Link>
            {mayEdit && <Button size="sm" variant="primary" onClick={onCreate}>{t('Create opportunity')}</Button>}
          </div>
        }
      />
    </Panel>
  );
}
