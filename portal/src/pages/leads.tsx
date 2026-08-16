import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { useRows } from '@/lib/useRows';
import { useScope } from '@/lib/scope';
import { useLeadConversions } from '@/lib/business';
import { StageBadge } from '@/features/sales/bits';
import {
  Button, Cell, DataState, ErrorState, Input, Panel, Row, Select, Skeleton,
  StatusPill, Table, cn,
} from '@/components/ui';
import {
  DAY_OPTIONS, FORM_LABEL, LEAD_COLUMNS, PIPELINE, STATUS, formatWhen, leadSource, statusLabel,
  statusTone, useLeadFilter, type Lead,
} from '@/lib/leads';

/**
 * LEADS — work.
 *
 * ## The question this screen answers
 *
 * "Who needs action?" — and nothing else. It is not a report on lead volume and
 * it is not an attribution study; both of those are Analytics' job and moving
 * them there is what let this become one excellent table instead of a table
 * with two dashboards bolted to it.
 *
 * The shape is: what the pipeline looks like (one strip), how to narrow it (one
 * row), and the list itself (everything below). A row is a link into the lead,
 * not an accordion — see the note on `LeadDetailScreen` for why that changed.
 *
 * ## Personal data
 *
 * Every row on this screen is somebody's name, address and message. It is
 * readable only by an authenticated staff account and only because RLS said so
 * — `useRows` issues an unqualified select and the database decides what comes
 * back. Nothing here is sent anywhere: no analytics event carries a field from
 * this page, no value becomes a URL, and the one `mailto:` link is built from
 * the address it is labelled with.
 *
 * Everything the visitor typed is rendered as a TEXT NODE. There is no
 * `dangerouslySetInnerHTML` in this file, no markdown renderer, and no stored
 * value that becomes an `href` except through `mailto:`.
 */

export function LeadsScreen() {
  const { reloadToken } = useScope();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { rows, state, message, reload } = useRows<Lead>('leads', LEAD_COLUMNS, 'created_at', reloadToken);
  // Which enquiries already became opportunities. ONE bounded query for the
  // whole list rather than one per row — see `useLeadConversions`. A lead that
  // has been converted is marked here so nobody converts it twice.
  const converted = useLeadConversions(reloadToken);

  // `?status=new` is how the Dashboard's attention items arrive. Read once, as
  // the filter's initial value, rather than kept in sync with the URL: the
  // operator narrowing further should not be fighting the address bar.
  const filter = useLeadFilter(rows, params.get('status') ?? 'all');

  return (
    <div className="grid gap-4">
      <StatusStrip
        counts={filter.counts}
        active={filter.filters.stage}
        onPick={(stage) => filter.set('stage', stage)}
        loading={state === 'loading'}
      />

      <Panel className="min-w-0">
        <FilterBar filter={filter} shown={filter.filtered.length} total={rows.length} />

        {state === 'loading' && (
          <div className="space-y-1.5 p-4" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        )}

        {state === 'unconfigured' && (
          <DataState
            kind="unconfigured"
            title="Not connected"
            body="Supabase credentials are not set in this environment, so there is nothing to read yet. See README.md for the setup steps."
          />
        )}

        {state === 'error' && <ErrorState message={message} onRetry={reload} />}

        {state === 'ready' && filter.filtered.length === 0 && (
          <DataState
            kind="empty"
            title={rows.length ? 'Nothing matches' : 'No leads yet'}
            body={rows.length
              ? 'No lead matches every filter above.'
              : 'The newsletter, contact form, Impact application and quote questionnaire all write here through the Netlify function.'}
            action={rows.length ? <Button size="sm" onClick={filter.reset}>Clear filters</Button> : undefined}
          />
        )}

        {state === 'ready' && filter.filtered.length > 0 && (
          <Table
            head={['Date', 'Company / person', 'Form', 'Source', 'Status', 'Pipeline', 'Locale']}
            minWidth={840}
            sticky
          >
            {filter.filtered.map((lead) => (
              <Row key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)}>
                <Cell className="num whitespace-nowrap text-[11px] text-haze">
                  {formatWhen(lead.created_at)}
                </Cell>
                <Cell className="min-w-0">
                  {/* The real affordance. The row click is an enhancement; this
                      is what a keyboard reaches and a middle click opens. */}
                  <Link to={`/leads/${lead.id}`} className="text-[13px] text-paper hover:text-signal">
                    {lead.company || lead.name}
                  </Link>
                  <span className="block truncate text-[11px] text-haze">
                    {lead.company ? lead.name : lead.email}
                  </span>
                </Cell>
                <Cell className="text-[11px] text-haze">
                  {FORM_LABEL[lead.form_type ?? ''] ?? lead.form_type ?? '—'}
                </Cell>
                <Cell className="break-words text-[11px] text-haze">{leadSource(lead)}</Cell>
                <Cell><StatusPill tone={statusTone(lead.status)}>{statusLabel(lead.status)}</StatusPill></Cell>
                <Cell>
                  {converted[lead.id]
                    ? (
                      // A link into the deal, not a badge that only says one
                      // exists: the next thing anyone wants after "this became
                      // an opportunity" is that opportunity.
                      <Link
                        to={`/sales/${converted[lead.id].id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:opacity-80"
                        aria-label={`Open the opportunity for ${lead.company || lead.name}`}
                      >
                        <StageBadge stage={converted[lead.id].stage} />
                      </Link>
                    )
                    : <span className="t-note">—</span>}
                </Cell>
                <Cell className="num text-[11px] uppercase text-haze">{lead.locale || '—'}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}

/* ============================================================ status strip */

/**
 * The pipeline, as one surface.
 *
 * Seven bordered tiles became seven cells of one bounded strip, for the same
 * reason the Dashboard's KPIs did: seven cards is seven objects, and the reader
 * wants one object with seven readings. Each cell is a toggle — pressing the
 * active one clears it — and `aria-pressed` says which is on.
 */
function StatusStrip({
  counts, active, onPick, loading,
}: {
  counts: Record<string, number>;
  active: string;
  onPick: (stage: string) => void;
  loading: boolean;
}) {
  const cells: { id: string; label: string }[] = [
    { id: 'all', label: 'All' },
    ...PIPELINE.map((stage) => ({ id: stage as string, label: STATUS[stage].label })),
  ];

  return (
    <Panel
      aria-label="Pipeline"
      className="grid grid-cols-2 divide-x divide-y divide-hairline bg-panel sm:grid-cols-4 xl:grid-cols-7 xl:divide-y-0"
    >
      {cells.map(({ id, label }) => {
        const count = counts[id] ?? 0;
        const selected = active === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={selected}
            onClick={() => onPick(selected && id !== 'all' ? 'all' : id)}
            className={cn(
              'min-w-0 px-4 py-3 text-left transition-colors',
              selected ? 'bg-flare' : 'hover:bg-flare',
            )}
          >
            <span className="t-section block truncate">{label}</span>
            {loading ? (
              <Skeleton className="mt-1.5 h-5 w-8" />
            ) : (
              <span className={cn(
                'num mt-1 block text-xl leading-none',
                count === 0 ? 'text-haze' : selected ? 'text-signal' : 'text-paper',
              )}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </Panel>
  );
}

/* =============================================================== filter bar */

/**
 * One control row, five dropdowns and a search box.
 *
 * Native `select`s, and every option list is built from the values the rows
 * actually carry — a "Source" menu offering `linkedin` when no lead ever came
 * from LinkedIn is a menu that teaches the operator to distrust it. Reset only
 * appears when something is narrowed, because a permanently visible "Clear"
 * next to an untouched form is a control that does nothing.
 */
function FilterBar({
  filter, shown, total,
}: { filter: ReturnType<typeof useLeadFilter>; shown: number; total: number }) {
  const { filters, set, options } = filter;

  return (
    <div className="border-b border-hairline px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={filters.query}
          onChange={(e) => set('query', e.target.value)}
          placeholder="Name, company, email, message…"
          aria-label="Search leads"
          className="h-7 w-full py-1 text-xs sm:w-56"
        />

        <label className="sr-only" htmlFor="filter-days">Date</label>
        <Select id="filter-days" value={filters.days} onChange={(e) => set('days', e.target.value)}>
          {DAY_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select>

        <label className="sr-only" htmlFor="filter-form">Form</label>
        <Select id="filter-form" value={filters.form} onChange={(e) => set('form', e.target.value)}>
          <option value="all">Any form</option>
          {options.forms.map((f) => (
            <option key={f} value={f}>{FORM_LABEL[f] ?? f}</option>
          ))}
        </Select>

        <label className="sr-only" htmlFor="filter-source">Source</label>
        <Select id="filter-source" value={filters.source} onChange={(e) => set('source', e.target.value)}>
          <option value="all">Any source</option>
          {options.sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>

        <label className="sr-only" htmlFor="filter-locale">Locale</label>
        <Select id="filter-locale" value={filters.locale} onChange={(e) => set('locale', e.target.value)}>
          <option value="all">Any locale</option>
          {options.locales.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
        </Select>

        <label className="sr-only" htmlFor="filter-sort">Sort</label>
        <Select id="filter-sort" value={filter.sort} onChange={(e) => filter.setSort(e.target.value as never)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">By name</option>
          <option value="status">By stage</option>
        </Select>

        {filter.narrowed && (
          <Button size="sm" variant="quiet" onClick={filter.reset}>
            <X size={11} aria-hidden="true" /> Clear
          </Button>
        )}

        <span className="t-note ml-auto whitespace-nowrap">
          {shown === total ? `${total} leads` : `${shown} of ${total}`}
        </span>
      </div>
    </div>
  );
}
