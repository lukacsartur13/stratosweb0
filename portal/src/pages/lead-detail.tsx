import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Target } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { can } from '@/lib/permissions';
import { useScope } from '@/lib/scope';
import { Grid } from '@/components/shell/PortalShell';
import {
  Button, DataState, Panel, SectionHeader, Skeleton, StatusPill, Textarea, cn,
} from '@/components/ui';
import {
  FORM_LABEL, PIPELINE, STATUS, buildTimeline, formatWhen, leadSource, metaText, statusLabel,
  statusTone, useLead, useLeadDetail, useLeadMutations, type Lead, type Stage, type TimelineEntry,
} from '@/lib/leads';
import { draftFromLead } from '@/lib/business';
// The conversion dialog is a form nobody sees until they press a button, on a
// screen that IS in the entry bundle. Lazy, so opening a lead does not download
// a dialog most lead views never open.
const NewOpportunity = lazy(() =>
  import('@/features/sales/OpportunityForm').then((m) => ({ default: m.NewOpportunity })));
import { StageBadge } from '@/features/sales/bits';
import { supabase, isConfigured } from '@/lib/supabase';

/**
 * ONE LEAD — a route, not an accordion.
 *
 * ## Why this stopped being a table row
 *
 * It used to be an expanded `<tr colSpan={7}>` inside the leads table, and that
 * was load-bearing in the wrong direction: a `colSpan` cell participates in the
 * table's width calculation, so forty fields of metadata set a floor on the
 * table's min-content width and pushed it past its own scroll container. The
 * previous implementation carried a `w-0 min-w-full` hack whose only job was to
 * remove the cell from that calculation.
 *
 * A route has no such fight. It also gets the three things the accordion could
 * never have: a URL somebody can send to a colleague, a back button that means
 * something, and the 8/4 split this screen actually wants — the enquiry on the
 * left at reading width, the operational metadata on the right in a column that
 * never competes with it.
 *
 * ## Hierarchy
 *
 * Not twenty equal blocks stacked vertically. Left: who they are and what they
 * said, then what they answered, then what has happened. Right: the one control
 * that changes anything (the stage), then the facts that never change. The
 * message is the largest text on the screen because it is the thing a human
 * wrote to another human.
 *
 * ## Personal data
 *
 * Same rules as the list. Every stored value is a text node; the only `href`
 * built from data is `mailto:` with a literal scheme.
 */

export function LeadDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const { reloadToken } = useScope();
  const mayEdit = can(profile?.role, 'manage_leads');
  const mayConvert = can(profile?.role, 'manage_sales');

  const { lead, state, reload } = useLead(id, reloadToken);
  const detail = useLeadDetail(state === 'ready' ? id ?? null : null);
  const mutate = useLeadMutations(() => { void reload(); void detail.reload(); });
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  if (state === 'loading') {
    return (
      <Grid>
        <div className="col-span-12 grid gap-4 lg:col-span-8" aria-busy="true">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
        <Skeleton className="col-span-12 h-72 lg:col-span-4" />
      </Grid>
    );
  }

  if (state === 'unconfigured') {
    return (
      <Panel>
        <DataState
          kind="unconfigured"
          title="Not connected"
          body="Supabase credentials are not set in this environment, so there is nothing to read yet."
        />
      </Panel>
    );
  }

  if (state === 'error' || state === 'missing' || !lead) {
    return (
      <Panel>
        <DataState
          kind={state === 'error' ? 'unavailable' : 'empty'}
          title={state === 'error' ? 'Unavailable' : 'No such lead'}
          body={state === 'error'
            ? 'The lead could not be read right now.'
            : 'This lead does not exist, or this account may not read it.'}
          action={<Button size="sm" onClick={() => window.history.back()}>Back</Button>}
        />
      </Panel>
    );
  }

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
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/leads"
          className="t-note inline-flex items-center gap-1.5 underline underline-offset-4 hover:text-paper"
        >
          <ArrowLeft size={11} aria-hidden="true" /> All leads
        </Link>
        <StatusPill tone={statusTone(lead.status)}>{statusLabel(lead.status)}</StatusPill>
      </div>

      <Grid>
        {/* ============================================ 8/12 — the enquiry */}
        <div className="col-span-12 grid min-w-0 gap-4 lg:col-span-8">
          <Panel>
            <SectionHeader title="Enquiry" note={formatWhen(lead.created_at)} />
            <div className="px-4 py-3.5">
              <h2 className="text-lg text-paper">{lead.company || lead.name}</h2>
              <p className="mt-0.5 text-xs text-haze">
                {lead.company ? `${lead.name} · ` : ''}
                {/* A literal scheme. The address is the label. */}
                <a className="underline underline-offset-4 hover:text-paper" href={`mailto:${lead.email}`}>
                  {lead.email}
                </a>
              </p>

              {lead.message && (
                // A text node inside `pre-wrap`. Whatever was typed, this
                // renders it as characters.
                <p className="mt-3 whitespace-pre-wrap break-words rounded-sm border border-hairline bg-ink/60 p-3 text-[13px] leading-relaxed text-paper">
                  {lead.message}
                </p>
              )}

              <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-3">
                <Fact label="Service interest" value={lead.service_interest} />
                <Fact label="Budget" value={lead.budget_range} />
                <Fact label="Form" value={lead.form_type ? FORM_LABEL[lead.form_type] ?? lead.form_type : null} />
              </dl>
            </div>
          </Panel>

          {(answers.length > 0 || scalars.length > 0) && (
            <Panel>
              <SectionHeader
                title="Answers"
                note={answers.length > 0 ? `${answers.length} questions` : undefined}
              />
              {scalars.length > 0 && (
                <dl className="grid gap-x-6 gap-y-2 border-b border-hairline px-4 py-3 sm:grid-cols-3">
                  {scalars.map(([k, v]) => (
                    <Fact
                      key={k}
                      label={k}
                      value={typeof v === 'boolean' ? (v ? 'Yes' : 'No')
                        : Array.isArray(v) ? `${v.length} answers` : String(v ?? '')}
                    />
                  ))}
                </dl>
              )}
              {answers.length > 0 && (
                <ol className="grid gap-3 px-4 py-3">
                  {answers.map((entry, i) => (
                    <li key={`${i}-${entry.q}`} className="border-l border-hair pl-3">
                      <p className="text-[11px] text-haze">{entry.q}</p>
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-paper">{entry.a || '—'}</p>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          )}

          <Panel>
            <SectionHeader title="Activity" />
            {mayEdit && (
              <div className="border-b border-hairline px-4 py-3">
                <label className="label mb-1.5 block" htmlFor={`note-${lead.id}`}>Internal note</label>
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
            <div className="px-4 py-3">
              {detail.state === 'loading' ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <Timeline entries={timeline} />
              )}
              {/* The honest limit. Leads that predate the trigger and the audit
                  row have neither, and their timelines show only what they have
                  — which is better than inventing the rest. */}
              <p className="t-note mt-2.5">
                Only recorded events appear here. Leads received before status changes were logged
                show the arrival and nothing else.
              </p>
            </div>
          </Panel>
        </div>

        {/* =========================================== 4/12 — the metadata */}
        <div className="col-span-12 grid min-w-0 gap-4 lg:col-span-4">
          <Conversion lead={lead} mayConvert={mayConvert} />

          <Panel>
            <SectionHeader title="Stage" />
            <div className="px-4 py-3">
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
                        'rounded-sm border px-2 py-1 font-data text-[10px] uppercase tracking-[0.12em]',
                        'transition-colors disabled:opacity-45',
                        lead.status === stage
                          ? 'border-signal/50 bg-signal/10 text-paper'
                          : 'border-hair text-haze hover:bg-flare hover:text-paper',
                      )}
                    >
                      {STATUS[stage].label}
                    </button>
                  ))}
                </div>
              ) : (
                <StatusPill tone={statusTone(lead.status)}>{statusLabel(lead.status)}</StatusPill>
              )}
              <p className="t-note mt-2">
                {STATUS[lead.status]?.note ?? 'A status this Portal does not draw.'}
              </p>
              {error && <p role="alert" className="mt-1.5 text-[11px] text-danger">{error}</p>}
            </div>
          </Panel>

          <Panel>
            <SectionHeader title="Origin" />
            <dl className="grid px-4 py-3">
              <Line label="Received" value={formatWhen(lead.created_at)} />
              <Line label="Source" value={leadSource(lead)} />
              <Line label="Medium" value={metaText(lead, 'utmMedium')} />
              <Line label="Campaign" value={metaText(lead, 'utmCampaign')} />
              <Line label="Content" value={metaText(lead, 'utmContent')} />
              <Line label="Term" value={metaText(lead, 'utmTerm')} />
              <Line label="Landed on" value={metaText(lead, 'landingRoute')} />
              <Line label="Submitted from" value={lead.source_route} />
              <Line label="Locale" value={lead.locale} />
              <Line label="Submission id" value={lead.submission_id} />
            </dl>
          </Panel>

          {/*
            EVERYTHING ELSE IN `meta`, AND THAT IS THE POINT.

            The block above is an authored reading order, not an allow-list. A
            lead written by an older client — or by a newer one — must not become
            partly invisible because this file has not caught up with it, so
            every remaining key renders under its own raw name. The label table
            is for readability; dropping what it does not recognise would make
            the detail screen quietly lossy, which is the one thing an
            operational record must never be.
          */}
          {Object.entries(meta).filter(([k]) => !SHOWN_META.has(k)).length > 0 && (
            <Panel>
              <SectionHeader title="Other metadata" />
              <dl className="grid px-4 py-3">
                {Object.entries(meta)
                  .filter(([k]) => !SHOWN_META.has(k))
                  .map(([k, v]) => (
                    <Line key={k} label={META_LABEL[k] ?? k} value={String(v ?? '')} />
                  ))}
              </dl>
            </Panel>
          )}
        </div>
      </Grid>
    </div>
  );
}

/* ================================================================= pieces == */

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="label truncate">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-xs text-paper">{value || '—'}</dd>
    </div>
  );
}

/** A metadata row in the right-hand column: label left, value right, hairline. */
function Line({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline py-1.5 last:border-0">
      <dt className="label shrink-0">{label}</dt>
      <dd className="num min-w-0 whitespace-pre-wrap break-words text-right text-[11px] text-paper">
        {value || '—'}
      </dd>
    </div>
  );
}

/**
 * The `meta` keys the Origin block already shows.
 *
 * Anything not in this set falls through to "Other metadata" under its raw key.
 * Keeping the set here rather than deriving it from the JSX is deliberate: the
 * block is a reading order chosen by a person, and a derivation would make
 * moving a field silently change what is hidden.
 *
 * `utmSource` and `landingReferrerHost` are both here because `leadSource()`
 * draws them: the Source line is one or the other, and showing whichever it
 * used again below would be the same fact twice.
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
  if (entries.length === 0) return <p className="text-xs text-haze">Nothing recorded.</p>;
  return (
    <ol className="relative grid gap-3 border-l border-hairline pl-4">
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

/* ========================================================= lead → deal == */

/**
 * Convert to opportunity (§3).
 *
 * ## Why this is a deliberate action and not automatic
 *
 * §3 is explicit: "Do NOT automatically convert every lead." Most enquiries are
 * not commercial possibilities — a newsletter sign-up is not a deal — and a
 * system that made one out of every submission would have a pipeline whose total
 * meant nothing.
 *
 * ## What crossing this line does and does not do
 *
 * It creates an opportunity carrying the company, the contact and the whole of
 * the attribution, and it leaves the lead exactly where it is. The enquiry is
 * never deleted (§41), the message and the questionnaire answers are never
 * copied (§3), and the two records stay joined by `opportunities.lead_id` so the
 * chain from a channel to revenue survives the conversion.
 */
function Conversion({ lead, mayConvert }: { lead: Lead; mayConvert: boolean }) {
  const [existing, setExisting] = useState<{ id: string; title: string; stage: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(0);

  // One filtered read on an indexed column. The lead detail screen knows about
  // its own deals and asks about nothing else.
  useEffect(() => {
    let cancelled = false;
    if (!isConfigured) return;
    void (async () => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('id, title, stage')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
        .limit(10);
      // A missing table means the P2 migration has not been applied. The rest of
      // the lead screen is entirely usable without this panel.
      if (error) { console.error('[opportunities.byLead]', error); return; }
      if (!cancelled) setExisting((data ?? []) as never);
    })();
    return () => { cancelled = true; };
  }, [lead.id, token]);

  return (
    <Panel>
      <SectionHeader title="Pipeline" note={existing.length > 0 ? `${existing.length}` : undefined} />
      <div className="px-4 py-3">
        {existing.length > 0 ? (
          <ul className="grid gap-2">
            {existing.map((deal) => (
              <li key={deal.id} className="flex items-center justify-between gap-2">
                <Link to={`/sales/${deal.id}`} className="min-w-0 truncate text-[13px] text-paper hover:text-signal">
                  {deal.title}
                </Link>
                <StageBadge stage={deal.stage} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-haze">
            No opportunity yet. Converting is deliberate — an opportunity is a qualified commercial
            possibility, not every enquiry that arrives.
          </p>
        )}

        {mayConvert && (
          <Button size="sm" variant={existing.length > 0 ? 'ghost' : 'primary'} className="mt-2.5"
                  onClick={() => setOpen(true)}>
            <Target size={12} aria-hidden="true" />
            {existing.length > 0 ? 'Convert again' : 'Convert to opportunity'}
          </Button>
        )}

        {existing.length > 0 && mayConvert && (
          <p className="t-note mt-1.5">
            A second opportunity is legitimate — a client can come back for different work — and is
            never created by accident.
          </p>
        )}
      </div>

      {mayConvert && open && (
        <Suspense fallback={null}>
          <NewOpportunity
            open
            lockedLead
            initial={draftFromLead(lead)}
            onClose={() => setOpen(false)}
            onCreated={() => setToken((n) => n + 1)}
          />
        </Suspense>
      )}
    </Panel>
  );
}
