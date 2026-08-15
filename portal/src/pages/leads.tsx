import { Fragment, useState, type ReactNode } from 'react';
import { useRows } from '@/lib/useRows';
import { useAuth } from '@/features/auth/AuthProvider';
import { can } from '@/lib/permissions';
import { PageHead } from '@/pages/screens';
import {
  Badge, Button, Cell, EmptyState, ErrorState, Input, Panel, PanelHeader, Row, Skeleton,
  Table, Textarea, cn,
} from '@/components/ui';
import { BarList, Segmented } from '@/components/charts';
import {
  FACETS, FORM_LABEL, LEAD_COLUMNS, PIPELINE, STATUS, buildTimeline, formatWhen, groupBy,
  metaText, since, statusLabel, statusTone, today, useLeadDetail, useLeadFilter,
  useLeadMutations, type Lead, type Stage, type TimelineEntry,
} from '@/lib/leads';

/**
 * Leads — the pipeline, and the detail behind each row.
 *
 * ## What this screen is for
 *
 * Working a list, not admiring it. The table is the primary object; everything
 * else on the page either narrows it (the stage filter, the search, the sort)
 * or explains one row of it (the detail panel). There is no dashboard framing
 * around the leads, because the person opening this screen already knows why
 * they are here.
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
  const { profile } = useAuth();
  const mayEdit = can(profile?.role, 'manage_leads');
  const { rows, state, message, reload } = useRows<Lead>('leads', LEAD_COLUMNS);
  const filter = useLeadFilter(rows);
  const [open, setOpen] = useState<string | null>(null);
  const [facet, setFacet] = useState(FACETS[0].id);

  const active = FACETS.find((f) => f.id === facet)!;

  return (
    <>
      <PageHead
        title="Leads"
        lede="Every enquiry from the public site. Personal data — visible to signed-in staff only."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              value={filter.query}
              onChange={(e) => filter.setQuery(e.target.value)}
              placeholder="Name, company, email, message…"
              aria-label="Search leads"
              className="h-8 w-52 py-1 text-xs sm:w-64"
            />
            <Segmented
              label="Sort"
              value={filter.sort}
              options={[
                { id: 'newest' as const, label: 'Newest' },
                { id: 'oldest' as const, label: 'Oldest' },
                { id: 'name' as const, label: 'Name' },
                { id: 'status' as const, label: 'Stage' },
              ]}
              onChange={filter.setSort}
            />
          </div>
        }
      />

      {/* ------------------------------------------------------- pipeline -- */}
      <section aria-label="Pipeline" className="mb-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-7">
        <StageTile
          label="All"
          count={filter.counts.all ?? 0}
          active={filter.stage === 'all'}
          onClick={() => filter.setStage('all')}
        />
        {PIPELINE.map((stage) => (
          <StageTile
            key={stage}
            label={STATUS[stage].label}
            count={filter.counts[stage] ?? 0}
            tone={STATUS[stage].tone}
            active={filter.stage === stage}
            onClick={() => filter.setStage(filter.stage === stage ? 'all' : stage)}
          />
        ))}
      </section>

      {/*
        The attribution panel sits BESIDE the table only at 2xl, and that is a
        measurement rather than a taste.

        At 1440 the sidebar takes 240 and the page padding 64, so a 320px column
        beside the table leaves it about 800px for seven columns — and a
        seven-column table with a 40px cell gutter needs more than that, so it
        overflowed its own scroll container and the Name column ended up off the
        left edge whenever a control inside it took focus. Below 1536 the panel
        goes underneath, where it is just as readable and costs the table
        nothing.
      */}
      <div className="grid gap-4 2xl:grid-cols-[1fr_320px]">
        {/* ---------------------------------------------------- the table -- */}
        <Panel className="min-w-0">
          <PanelHeader
            title={filter.stage === 'all' ? 'All leads' : `${statusLabel(filter.stage)} leads`}
            action={
              <span className="label">
                {filter.filtered.length} of {rows.length}
                {' · '}
                {today(rows)} today · {since(rows, 7)} this week
              </span>
            }
          />

          {state === 'loading' && (
            <div className="space-y-2 p-5" aria-busy="true">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          )}

          {state === 'unconfigured' && (
            <EmptyState
              title="Not connected"
              body="Supabase credentials are not set in this environment, so there is nothing to read yet. See README.md for the setup steps."
            />
          )}

          {state === 'error' && <ErrorState message={message} onRetry={reload} />}

          {state === 'ready' && filter.filtered.length === 0 && (
            <EmptyState
              title={rows.length ? 'Nothing matches' : 'No leads yet'}
              body={rows.length
                ? 'Try a shorter search term, or clear the stage filter.'
                : 'The newsletter, contact form, Impact application and quote questionnaire all write here through the Netlify function.'}
            />
          )}

          {state === 'ready' && filter.filtered.length > 0 && (
            <Table head={['Name', 'Form', 'Company', 'Interest', 'Stage', 'Received', '']}>
              {filter.filtered.map((lead) => (
                <Fragment key={lead.id}>
                  <Row>
                    <Cell>
                      <span className="text-sm text-paper">{lead.name}</span>
                      <a
                        className="mt-0.5 block truncate text-[11px] text-haze underline underline-offset-4 hover:text-paper"
                        href={`mailto:${lead.email}`}
                      >
                        {lead.email}
                      </a>
                    </Cell>
                    <Cell><Badge>{FORM_LABEL[lead.form_type ?? ''] ?? lead.form_type ?? '—'}</Badge></Cell>
                    <Cell className="text-haze">{lead.company || '—'}</Cell>
                    <Cell className="text-haze">{lead.service_interest || '—'}</Cell>
                    <Cell><Badge tone={statusTone(lead.status)}>{statusLabel(lead.status)}</Badge></Cell>
                    <Cell className="num whitespace-nowrap text-xs text-haze">
                      {formatWhen(lead.created_at)}
                    </Cell>
                    <Cell>
                      <button
                        type="button"
                        className="label underline underline-offset-4 hover:text-paper"
                        aria-expanded={open === lead.id}
                        onClick={() => setOpen(open === lead.id ? null : lead.id)}
                      >
                        {open === lead.id ? 'Hide' : 'Open'}
                      </button>
                    </Cell>
                  </Row>
                  {open === lead.id && (
                    <LeadDetail lead={lead} columns={7} mayEdit={mayEdit} reload={reload} />
                  )}
                </Fragment>
              ))}
            </Table>
          )}
        </Panel>

        {/* ------------------------------------------------- attribution -- */}
        <Panel className="h-fit min-w-0">
          <PanelHeader
            title="Where they came from"
            action={<span className="label">{rows.length} leads</span>}
          />
          <div className="px-5 pt-3">
            <div className="flex flex-wrap gap-1">
              {FACETS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={facet === f.id}
                  onClick={() => setFacet(f.id)}
                  className={cn(
                    'rounded-sm border px-2 py-1 font-data text-[10px] uppercase tracking-[0.12em] transition-colors',
                    facet === f.id
                      ? 'border-signal/40 bg-white/[0.06] text-paper'
                      : 'border-hair text-haze hover:text-paper',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <BarList
            rows={groupBy(rows, active.of)}
            empty="No attribution recorded on these leads yet."
          />
          {/*
            The boundary, stated where the data is.

            These counts come from the Portal's OWN lead rows — the UTM
            parameters and landing route the browser sent with the submission —
            and never from GA4. No GA4 user is ever associated with a named
            lead, and no lead's personal data is ever sent to GA4. This panel is
            aggregate business analysis of records this Portal already holds.
          */}
          <p className="border-t border-hair px-5 py-3 text-[11px] leading-relaxed text-haze">
            From each lead&rsquo;s own submission, not from Google. Analytics is never joined to a
            named person in either direction.
          </p>
        </Panel>
      </div>
    </>
  );
}

/* =============================================================== the tiles == */

function StageTile({
  label, count, tone = 'neutral', active, onClick,
}: {
  label: string;
  count: number;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-lg border px-3 py-2 text-left transition-colors',
        active
          ? 'border-signal/40 bg-white/[0.06]'
          : 'border-hair bg-panel/60 hover:border-chrome/30 hover:bg-white/[0.03]',
      )}
    >
      <span className="label block truncate">{label}</span>
      <span
        className={cn(
          'num mt-0.5 block text-lg',
          count === 0 ? 'text-haze' : tone === 'warn' ? 'text-signal' : 'text-paper',
        )}
      >
        {count}
      </span>
    </button>
  );
}

/* ============================================================== the detail == */

/**
 * One lead, opened.
 *
 * Everything the operator needs in order to act, in the order they need it:
 * who and how to reach them, what they asked for, where they came from, what
 * has happened so far, and the two things that can be done about it.
 */
function LeadDetail({
  lead, columns, mayEdit, reload,
}: { lead: Lead; columns: number; mayEdit: boolean; reload: () => void }) {
  const detail = useLeadDetail(lead.id);
  const mutate = useLeadMutations(() => { reload(); void detail.reload(); });
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const payload = lead.payload && typeof lead.payload === 'object' ? lead.payload : {};
  const meta = lead.meta && typeof lead.meta === 'object' ? lead.meta : {};
  const answers = Array.isArray((payload as { answers?: unknown }).answers)
    ? (payload as { answers: { q: string; a: string }[] }).answers
    : [];
  const scalars = Object.entries(payload).filter(([k]) => k !== 'answers');

  const timeline = buildTimeline(lead, detail.notes, detail.log);

  const submit = async () => {
    const problem = await mutate.addNote(lead.id, draft);
    setError(problem);
    if (!problem) setDraft('');
  };

  return (
    <tr className="border-b border-hair/60 bg-white/[0.02] last:border-0">
      <Cell colSpan={columns} className="px-5 py-5">
        {/*
          `w-0 min-w-full`, and it is not a flourish.

          A `colSpan` cell participates in the table's width calculation like any
          other: its content's min-content width becomes a floor on the table,
          and this cell holds a two-column grid of forty fields. Measured, the
          expanded row pushed the table ~500px past its scroll container, which
          then scrolled sideways to keep the focused control visible and left the
          Name column off the left edge of the screen.

          Width zero removes this cell from that calculation entirely; the
          `min-width: 100%` then resolves against the width the table settled on
          without it. The detail is exactly as wide as the table and never a
          pixel wider.
        */}
        <div className="grid w-0 min-w-full gap-5 lg:grid-cols-[1.3fr_1fr]">
          {/* ------------------------------------------------- the enquiry */}
          <div className="grid min-w-0 gap-4">
            <Group title="Contact">
              <Fact label="Name" value={lead.name} />
              <Fact label="Email" value={lead.email} />
              <Fact label="Company" value={lead.company} />
              <Fact label="Budget" value={lead.budget_range} />
            </Group>

            <Group title="Context">
              <Fact label="Form" value={lead.form_type ? FORM_LABEL[lead.form_type] ?? lead.form_type : null} />
              <Fact label="Locale" value={lead.locale} />
              <Fact label="Submitted from" value={lead.source_route} />
              <Fact label="Landed on" value={metaText(lead, 'landingRoute')} />
              <Fact label="Came from" value={metaText(lead, 'landingReferrerHost')} />
              <Fact label="Received" value={formatWhen(lead.created_at)} />
            </Group>

            <Group title="Campaign">
              <Fact label="UTM source" value={metaText(lead, 'utmSource')} />
              <Fact label="UTM medium" value={metaText(lead, 'utmMedium')} />
              <Fact label="UTM campaign" value={metaText(lead, 'utmCampaign')} />
              <Fact label="UTM content" value={metaText(lead, 'utmContent')} />
              <Fact label="UTM term" value={metaText(lead, 'utmTerm')} />
              <Fact label="Submission id" value={lead.submission_id} />
            </Group>

            {/*
              EVERYTHING ELSE IN `meta`, AND THAT IS THE POINT.

              The three groups above are an authored reading order, not an
              allow-list. A lead written by an older client — or by a newer one
              — must not become partly invisible because this file has not
              caught up with it, so every remaining key renders under its own
              raw name. The label table is for readability; dropping what it
              does not recognise would make the detail screen quietly lossy,
              which is the one thing an operational record must never be.
            */}
            {Object.entries(meta).filter(([k]) => !SHOWN_META.has(k)).length > 0 && (
              <Group title="Other metadata">
                {Object.entries(meta)
                  .filter(([k]) => !SHOWN_META.has(k))
                  .map(([k, v]) => (
                    <Fact key={k} label={META_LABEL[k] ?? k} value={String(v ?? '')} />
                  ))}
              </Group>
            )}

            {lead.message && (
              <div>
                <p className="label mb-1">Message</p>
                {/* A text node inside `pre-wrap`. Whatever was typed, this
                    renders it as characters. */}
                <p className="whitespace-pre-wrap break-words rounded-sm border border-hair bg-black/25 p-3 text-xs leading-relaxed text-paper">
                  {lead.message}
                </p>
              </div>
            )}

            {scalars.length > 0 && (
              <Group title="Answers">
                {scalars.map(([k, v]) => (
                  <Fact
                    key={k}
                    label={k}
                    value={typeof v === 'boolean' ? (v ? 'Yes' : 'No') : Array.isArray(v) ? `${v.length} answers` : String(v ?? '')}
                  />
                ))}
              </Group>
            )}

            {answers.length > 0 && (
              <div>
                <p className="label mb-1.5">{answers.length} questionnaire answers</p>
                <ol className="grid gap-2">
                  {answers.map((entry, i) => (
                    <li key={`${i}-${entry.q}`} className="border-l border-hair pl-3">
                      <p className="text-[11px] text-haze">{entry.q}</p>
                      <p className="whitespace-pre-wrap break-words text-xs text-paper">{entry.a || '—'}</p>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {scalars.length === 0 && answers.length === 0 && !lead.message && (
              <p className="text-xs text-haze">
                This lead predates the structured payload and carries no message.
              </p>
            )}
          </div>

          {/* ------------------------------------------ stage, notes, time */}
          <div className="grid min-w-0 gap-4">
            <div>
              <p className="label mb-1.5">Stage</p>
              {mayEdit ? (
                <div className="flex flex-wrap gap-1">
                  {PIPELINE.map((stage) => (
                    <button
                      key={stage}
                      type="button"
                      disabled={mutate.busy === lead.id}
                      aria-pressed={lead.status === stage}
                      onClick={async () => setError(await mutate.setStatus(lead.id, stage as Stage))}
                      className={cn(
                        'rounded-sm border px-2.5 py-1 font-data text-[10px] uppercase tracking-[0.12em]',
                        'transition-colors disabled:opacity-45',
                        lead.status === stage
                          ? 'border-signal/50 bg-signal/10 text-paper'
                          : 'border-hair text-haze hover:border-chrome/40 hover:text-paper',
                      )}
                    >
                      {STATUS[stage].label}
                    </button>
                  ))}
                </div>
              ) : (
                <Badge tone={statusTone(lead.status)}>{statusLabel(lead.status)}</Badge>
              )}
              <p className="mt-1.5 text-[11px] text-haze">
                {STATUS[lead.status]?.note ?? 'A status this Portal does not draw.'}
              </p>
              {error && <p role="alert" className="mt-1.5 text-[11px] text-danger">{error}</p>}
            </div>

            {mayEdit && (
              <div>
                <label className="label mb-1.5 block" htmlFor={`note-${lead.id}`}>
                  Internal note
                </label>
                <Textarea
                  id={`note-${lead.id}`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={4000}
                  placeholder="Private to the team. Plain text."
                  className="min-h-16 text-xs"
                />
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="num text-[10px] text-haze">{draft.length}/4000</span>
                  <Button size="sm" disabled={!draft.trim() || mutate.busy === lead.id} onClick={() => void submit()}>
                    Add note
                  </Button>
                </div>
              </div>
            )}

            <div>
              <p className="label mb-2">Timeline</p>
              {detail.state === 'loading' ? (
                <Skeleton className="h-20 w-full" />
              ) : (
                <Timeline entries={timeline} />
              )}
              {/* The honest limit. Leads that predate the trigger and the audit
                  row have neither, and their timelines show only what they have
                  — which is better than inventing the rest. */}
              <p className="mt-2 text-[10px] leading-relaxed text-haze">
                Only recorded events appear here. Leads received before status changes were logged
                show the arrival and nothing else.
              </p>
            </div>
          </div>
        </div>
      </Cell>
    </tr>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="label mb-1.5">{title}</p>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="label truncate">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-xs text-paper">{value || '—'}</dd>
    </div>
  );
}

/**
 * The `meta` keys the three authored groups above already show.
 *
 * Anything not in this set falls through to "Other metadata" under its raw key.
 * Keeping the set here rather than deriving it from the JSX is deliberate: the
 * groups are a reading order chosen by a person, and a derivation would make
 * moving a field between groups silently change what is hidden.
 */
const SHOWN_META = new Set([
  'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm',
  'landingRoute', 'landingReferrerHost',
]);

/**
 * Readable names for the remaining `meta` keys, in no particular order.
 *
 * A fallback, not a filter: `META_LABEL[k] ?? k` is what guarantees an
 * unrecognised key still appears.
 */
const META_LABEL: Record<string, string> = {
  referrerOrigin: 'Referrer at submit',
  host: 'Served by',
  viewport: 'Device',
  elapsedMs: 'Time to fill (ms)',
  attempt: 'Attempts',
  legacyClient: 'Legacy client',
  submissionIdSource: 'Submission id source',
};

const KIND_TONE: Record<TimelineEntry['kind'], string> = {
  received: 'bg-signal',
  status: 'bg-chrome',
  note: 'bg-good',
  notified: 'bg-chrome/50',
  other: 'bg-hair',
};

function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-xs text-haze">Nothing recorded.</p>;
  }
  return (
    <ol className="relative grid gap-3 border-l border-hair pl-4">
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <span
            className={cn('absolute -left-[19px] top-1.5 h-1.5 w-1.5 rounded-full', KIND_TONE[entry.kind])}
            aria-hidden="true"
          />
          <p className="text-xs text-paper">{entry.title}</p>
          {entry.detail && (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-haze">
              {entry.detail}
            </p>
          )}
          <p className="num mt-0.5 text-[10px] text-haze">
            {formatWhen(entry.at)}
            {entry.by && <span> · {entry.by}</span>}
          </p>
        </li>
      ))}
    </ol>
  );
}
