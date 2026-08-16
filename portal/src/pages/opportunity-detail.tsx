import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { can } from '@/lib/permissions';
import { useScope } from '@/lib/scope';
import { useRows } from '@/lib/useRows';
import { Grid } from '@/components/shell/PortalShell';
import {
  Button, DataLine, DataState, Dialog, Field, Input, NotRecorded, Panel, SectionHeader,
  Select, Skeleton, StatusPill, Textarea, cn,
} from '@/components/ui';
import {
  LOST_REASONS, LOST_REASON_LABEL, STAGE, STAGES, dueTone, isOpen,
  shortDate, stageLabel, stageTone, templateFor, weighted, type Stage,
} from '@/lib/pipeline';
import { CURRENCIES, money, percent } from '@/lib/money';
import {
  dealParty, dealSource, useOpportunity, useOpportunityMutations, type Opportunity,
} from '@/lib/sales';
import {
  findClientMatches, uniqueSlug, useClients, useOperationsMutations, type Client,
} from '@/lib/operations';
import { buildRecordTimeline, useNoteMutation, useRecordDetail } from '@/lib/records';
import { formatWhen } from '@/lib/leads';
import { supabase, isConfigured } from '@/lib/supabase';

/**
 * ONE OPPORTUNITY — the commercial detail (§13).
 *
 * ## The hierarchy, and why it is 8/4 rather than twelve equal cards
 *
 * The left column is the deal as a thing that happened: who it is with, what has
 * been said about it, where it came from and what it turned into. The right
 * column is the deal as a thing you CONTROL: one panel of commercial fields, and
 * every one of them is what the forecast is built from.
 *
 * Fifteen equal cards is what happens when every field gets its own box. Here
 * the right column is ONE panel with rules between its lines, so the eye reads
 * down a list of facts rather than across a grid of containers.
 *
 * ## Closing a deal is deliberate in both directions
 *
 * Winning offers to create the client and the project (§17) and does not do it
 * silently. Losing asks for a reason (§16) and lets it be skipped, because
 * "nobody knows why" is a real answer and a forced dropdown would only produce
 * "Other" on every row and no intelligence at all.
 */

export function OpportunityDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const { reloadToken } = useScope();
  const mayEdit = can(profile?.role, 'manage_sales');
  const [params, setParams] = useSearchParams();

  const { deal, state, reload } = useOpportunity(id, reloadToken);
  const detail = useRecordDetail('opportunity', state === 'ready' ? id ?? null : null, reloadToken);
  const mutate = useOpportunityMutations(() => { void reload(); void detail.reload(); });
  const notes = useNoteMutation('opportunity', () => { void detail.reload(); });

  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState<'won' | 'lost' | null>(null);

  // `?close=lost` is how the pipeline board hands a loss over to this screen,
  // which is the only place with room to ask why. Read once and cleared, so a
  // reload does not reopen the dialog somebody just dismissed.
  useEffect(() => {
    const request = params.get('close');
    if (request === 'lost' || request === 'won') {
      setClosing(request);
      const next = new URLSearchParams(params);
      next.delete('close');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  if (state === 'loading') {
    return (
      <Grid>
        <div className="col-span-12 grid gap-4 lg:col-span-8" aria-busy="true">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
        <Skeleton className="col-span-12 h-96 lg:col-span-4" />
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

  if (state === 'error' || state === 'missing' || !deal) {
    return (
      <Panel>
        <DataState
          kind={state === 'error' ? 'unavailable' : 'empty'}
          title={state === 'error' ? 'Unavailable' : 'No such opportunity'}
          body={state === 'error'
            ? 'The opportunity could not be read right now.'
            : 'This opportunity does not exist, or this account may not read it.'}
          action={<Link to="/sales"><Button size="sm">Back to Sales</Button></Link>}
        />
      </Panel>
    );
  }

  const timeline = buildRecordTimeline(
    {
      at: deal.created_at,
      title: 'Opportunity created',
      detail: deal.lead_id ? 'Converted from a lead' : 'Entered manually',
    },
    detail.notes,
    detail.log,
  );

  const submitNote = async () => {
    const problem = await notes.addNote(deal.id, draft);
    setError(problem);
    if (!problem) setDraft('');
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/sales"
          className="t-note inline-flex items-center gap-1.5 underline underline-offset-4 hover:text-paper"
        >
          <ArrowLeft size={11} aria-hidden="true" /> All opportunities
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {deal.archived_at && <StatusPill tone="neutral">Archived</StatusPill>}
          <StatusPill tone={stageTone(deal.stage)}>{stageLabel(deal.stage)}</StatusPill>
        </div>
      </div>

      <Grid>
        {/* ======================================== 8/12 — what this is */}
        <div className="col-span-12 grid min-w-0 gap-4 lg:col-span-8">
          <Panel>
            <SectionHeader
              title="Opportunity"
              note={`created ${formatWhen(deal.created_at)}`}
              action={mayEdit ? <Button size="sm" onClick={() => setEditing(true)}>Edit</Button> : undefined}
            />
            <div className="px-4 py-3.5">
              <h2 className="text-lg leading-snug text-paper">{deal.title}</h2>
              <p className="mt-1 text-xs text-haze">
                {deal.client
                  ? <Link to={`/clients/${deal.client.id}`} className="underline underline-offset-4 hover:text-paper">
                      {deal.client.name}
                    </Link>
                  : dealParty(deal)}
                {deal.contact_name && <span> · {deal.contact_name}</span>}
                {deal.contact_email && (
                  <>
                    {' · '}
                    {/* A literal scheme, and the address is the label. */}
                    <a className="underline underline-offset-4 hover:text-paper" href={`mailto:${deal.contact_email}`}>
                      {deal.contact_email}
                    </a>
                  </>
                )}
                {deal.contact_phone && <span> · {deal.contact_phone}</span>}
              </p>

              {deal.stage === 'lost' && deal.lost_reason && (
                <div className="mt-3 rounded-sm border border-danger/25 px-3 py-2">
                  <p className="label text-danger">Lost — {(LOST_REASON_LABEL as Record<string, string>)[deal.lost_reason] ?? deal.lost_reason}</p>
                  {deal.lost_note && (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-haze">{deal.lost_note}</p>
                  )}
                </div>
              )}
            </div>
          </Panel>

          {mayEdit && isOpen(deal.stage) && (
            <CloseBar
              onWin={() => setClosing('won')}
              onLose={() => setClosing('lost')}
              busy={mutate.busy === deal.id}
            />
          )}

          {deal.stage === 'won' && <WonPanel deal={deal} mayEdit={mayEdit} onChanged={reload} />}

          <RelatedLead deal={deal} />

          {/* ------------------------------------------------- notes */}
          <Panel>
            <SectionHeader title="Notes" note={detail.notes.length > 0 ? `${detail.notes.length}` : undefined} />
            {mayEdit && (
              <div className="border-b border-hairline px-4 py-3">
                <label className="sr-only" htmlFor="opp-note">Add a note</label>
                <Textarea
                  id="opp-note"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="What was said, what was agreed, what happens next."
                  className="min-h-20 text-[13px]"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  {error ? <p role="alert" className="text-xs text-danger">{error}</p> : <span />}
                  <Button size="sm" variant="primary" onClick={submitNote} disabled={notes.busy}>
                    Add note
                  </Button>
                </div>
              </div>
            )}
            {detail.notes.length === 0 ? (
              <p className="px-4 py-3 text-xs text-haze">No notes yet.</p>
            ) : (
              <ul className="grid">
                {detail.notes.map((note) => (
                  <li key={note.id} className="border-b border-hairline px-4 py-3 last:border-0">
                    {/* A text node. Notes are plain text in the database and are
                        rendered as text here — there is no markdown renderer and
                        no dangerouslySetInnerHTML anywhere in this file. */}
                    <p className="whitespace-pre-wrap text-[13px] text-paper">{note.body}</p>
                    <p className="t-note mt-1">
                      {note.author?.full_name || note.author?.email || 'Unknown'} · {formatWhen(note.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* ---------------------------------------------- activity */}
          <Panel>
            <SectionHeader title="Activity" note="only what was recorded" />
            <ol className="grid">
              {timeline.map((entry) => (
                <li key={entry.id} className="flex gap-3 border-b border-hairline px-4 py-2.5 last:border-0">
                  <span
                    className={cn(
                      'mt-1.5 h-1 w-1 shrink-0 rounded-full',
                      entry.kind === 'stage' || entry.kind === 'money' ? 'bg-signal' : 'bg-chrome/40',
                    )}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-paper">{entry.title}</p>
                    {entry.detail && (
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] text-haze">{entry.detail}</p>
                    )}
                    <p className="t-note">
                      {formatWhen(entry.at)}{entry.by ? ` · ${entry.by}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        {/* ================================= 4/12 — commercial control */}
        <div className="col-span-12 grid min-w-0 gap-4 lg:col-span-4">
          <CommercialPanel deal={deal} mayEdit={mayEdit} onChanged={reload} />
          <OriginPanel deal={deal} />
        </div>
      </Grid>

      {mayEdit && editing && (
        <EditDialog deal={deal} onClose={() => setEditing(false)} onSaved={reload} />
      )}

      {mayEdit && closing === 'lost' && (
        <LostDialog deal={deal} onClose={() => setClosing(null)} onSaved={reload} />
      )}

      {mayEdit && closing === 'won' && (
        <WonDialog deal={deal} onClose={() => setClosing(null)} onSaved={reload} />
      )}
    </div>
  );
}

/* ========================================================= the right rail */

/**
 * The commercial control panel — one surface, and every field the forecast uses.
 *
 * The stage `select` is here as well as on the board, and it is the same
 * control: reachable by keyboard, announced, and operable at 390px (§62).
 */
function CommercialPanel({
  deal, mayEdit, onChanged,
}: { deal: Opportunity; mayEdit: boolean; onChanged: () => void }) {
  const mutate = useOpportunityMutations(onChanged);
  const [error, setError] = useState<string | null>(null);
  const closeTone = dueTone(deal.expected_close_on);
  const actionTone = dueTone(deal.next_action_on);
  const staff = useStaff();

  const set = async (patch: Parameters<typeof mutate.update>[1]) => {
    setError(await mutate.update(deal.id, patch));
  };

  return (
    <Panel>
      <SectionHeader title="Commercial" />

      {mayEdit && (
        <div className="border-b border-hairline px-4 py-3">
          <label className="label mb-1.5 block" htmlFor="detail-stage">Stage</label>
          <Select
            id="detail-stage"
            value={deal.stage}
            className="w-full"
            disabled={mutate.busy === deal.id}
            onChange={async (e) => {
              setError(await mutate.setStage(deal.id, e.target.value as Stage, deal));
            }}
          >
            {STAGES.map((s) => <option key={s} value={s}>{STAGE[s].label}</option>)}
          </Select>
          <p className="t-note mt-1">{STAGE[deal.stage as Stage]?.note}</p>
          {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
        </div>
      )}

      <dl className="grid">
        <DataLine
          term="Estimated value"
          value={money(deal.estimated_value, deal.currency)
            ? <span className="num">{money(deal.estimated_value, deal.currency)}</span>
            : <NotRecorded what="Value" />}
        />
        <DataLine
          term="Probability"
          value={<span className="num">{percent(deal.probability)}</span>}
          note={deal.probability === STAGE[deal.stage as Stage]?.probability
            ? 'stage default — editable'
            : 'set for this deal'}
        />
        <DataLine
          term="Weighted"
          value={money(weighted(deal), deal.currency)
            ? <span className="num text-chrome">{money(weighted(deal), deal.currency)}</span>
            : <NotRecorded />}
          note="value × probability"
        />
        <DataLine
          term="Expected close"
          value={deal.expected_close_on
            ? <span className={cn('num', closeTone === 'overdue' ? 'text-danger' : closeTone === 'today' ? 'text-signal' : undefined)}>
                {shortDate(deal.expected_close_on)}
              </span>
            : <NotRecorded what="Expected close" />}
          note={closeTone === 'overdue' ? 'this date has passed' : undefined}
        />
        <DataLine
          term="Next action"
          value={deal.next_action || <NotRecorded what="Next action" />}
        />
        <DataLine
          term="Next action due"
          value={deal.next_action_on
            ? <span className={cn('num', actionTone === 'overdue' ? 'text-danger' : actionTone === 'today' ? 'text-signal' : undefined)}>
                {shortDate(deal.next_action_on)}
              </span>
            : <NotRecorded />}
        />
        <DataLine term="Service" value={deal.service || <NotRecorded what="Service" />} />
        <DataLine
          term="Responsible"
          value={mayEdit && staff.length > 0 ? (
            <>
              <label className="sr-only" htmlFor="detail-owner">Responsible person</label>
              <Select
                id="detail-owner"
                value={deal.owner_id ?? ''}
                className="w-full"
                onChange={(e) => void set({ owner_id: e.target.value || null })}
              >
                <option value="">Nobody</option>
                {staff.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                ))}
              </Select>
            </>
          ) : (deal.owner?.full_name || deal.owner?.email || <NotRecorded what="Responsible" />)}
        />
      </dl>
    </Panel>
  );
}

/**
 * Where this came from (§4, §33).
 *
 * Read-only, because every field here was recorded at the moment it happened.
 * An editable acquisition source is an acquisition source somebody can correct
 * after the fact, and a revenue attribution report built on corrected history is
 * a report about what we remember rather than about what occurred.
 */
function OriginPanel({ deal }: { deal: Opportunity }) {
  return (
    <Panel>
      <SectionHeader title="Origin" />
      <dl className="grid">
        <DataLine term="Source" value={dealSource(deal)} />
        <DataLine term="Campaign" value={deal.campaign || <span className="text-haze">—</span>} />
        <DataLine term="Landing page" value={deal.landing_route || <span className="text-haze">—</span>} />
        <DataLine term="Form" value={deal.form_type || <span className="text-haze">—</span>} />
        <DataLine term="Locale" value={deal.locale ? deal.locale.toUpperCase() : <span className="text-haze">—</span>} />
        <DataLine term="Updated" value={<span className="num text-[11px]">{formatWhen(deal.updated_at)}</span>} />
        {deal.won_at && <DataLine term="Won" value={<span className="num text-[11px]">{formatWhen(deal.won_at)}</span>} />}
        {deal.lost_at && <DataLine term="Lost" value={<span className="num text-[11px]">{formatWhen(deal.lost_at)}</span>} />}
      </dl>
    </Panel>
  );
}

/* ============================================================ the closes == */

function CloseBar({ onWin, onLose, busy }: { onWin: () => void; onLose: () => void; busy: boolean }) {
  return (
    <Panel className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <p className="text-xs text-haze">Closing this deal records the date and locks the probability.</p>
      <div className="flex gap-2">
        <Button size="sm" variant="danger" onClick={onLose} disabled={busy}>Mark lost</Button>
        <Button size="sm" variant="primary" onClick={onWin} disabled={busy}>Mark won</Button>
      </div>
    </Panel>
  );
}

/**
 * Losing a deal, with the reason that makes it worth something later (§16).
 *
 * The reason is optional and the dialog says so. A required dropdown would be
 * answered "Other" on every deal somebody was in a hurry with, which is a field
 * full of noise rather than the sales intelligence the requirement is after.
 */
function LostDialog({
  deal, onClose, onSaved,
}: { deal: Opportunity; onClose: () => void; onSaved: () => void }) {
  const mutate = useOpportunityMutations(onSaved);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const problem = await mutate.setStage(deal.id, 'lost', deal, {
      lost_reason: reason || null,
      lost_note: note.trim() || null,
    });
    if (problem) { setError(problem); return; }
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Mark this opportunity lost"
      description="The reason is optional — an honest blank is better than a guessed category. It is what makes lost deals countable a year from now."
      footer={
        <>
          <Button size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="danger" onClick={submit} disabled={mutate.busy === deal.id}>
            Mark lost
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field id="lost-reason" label="Reason">
          <Select id="lost-reason" className="w-full py-2.5 text-sm" value={reason}
                  onChange={(e) => setReason(e.target.value)}>
            <option value="">Not recorded</option>
            {LOST_REASONS.map((r) => <option key={r} value={r}>{LOST_REASON_LABEL[r]}</option>)}
          </Select>
        </Field>
        <Field id="lost-note" label="Note" hint="Anything worth remembering about why.">
          <Textarea id="lost-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

/**
 * Winning a deal, and then deliberately deciding what it becomes (§17).
 *
 * ## Two steps, never one
 *
 * The stage change happens immediately. Creating the client and the project does
 * NOT, because §17 asks for a deliberate conversion and §40 asks that possible
 * duplicates be presented for confirmation rather than merged. So this dialog
 * marks the deal won, and the panel that then appears on the screen offers the
 * conversion with any matching clients listed above it.
 */
function WonDialog({
  deal, onClose, onSaved,
}: { deal: Opportunity; onClose: () => void; onSaved: () => void }) {
  const mutate = useOpportunityMutations(onSaved);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const problem = await mutate.setStage(deal.id, 'won', deal);
    if (problem) { setError(problem); return; }
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Mark this opportunity won"
      description="The won date is stamped by the database and the probability becomes 100%. Creating the client and the project is the next step, and it is a separate one."
      footer={
        <>
          <Button size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={mutate.busy === deal.id}>
            Mark won
          </Button>
        </>
      }
    >
      <dl className="grid rounded-sm border border-hairline">
        <DataLine term="Value" value={money(deal.estimated_value, deal.currency) ?? <NotRecorded />} />
        <DataLine term="Company" value={dealParty(deal)} />
        <DataLine term="Service" value={deal.service || <NotRecorded />} />
      </dl>
      {!deal.estimated_value && (
        <p className="t-note mt-3">
          This deal has no value recorded, so it will count towards won deals but not towards won
          revenue. Add one before closing if it is known.
        </p>
      )}
      {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
    </Dialog>
  );
}

/* ================================================= won → client + project */

/**
 * What a won deal becomes (§17, §40, §54).
 *
 * ## The duplicate check, and why it asks rather than decides
 *
 * Before creating a client this looks for one that already exists, by
 * normalised company name and by email domain. What it does with a match is
 * SHOW IT: "Rapidkert Kft. already exists — attach to it?" Two clients can
 * genuinely share a name, and a system that silently merged them would have
 * merged two companies' revenue into one relationship with no way to tell.
 */
function WonPanel({
  deal, mayEdit, onChanged,
}: { deal: Opportunity; mayEdit: boolean; onChanged: () => void }) {
  const clients = useClients();
  const ops = useOperationsMutations(onChanged);
  const sales = useOpportunityMutations(onChanged);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string; status: string }[]>([]);

  // The projects this deal already produced. One filtered query on an indexed
  // column, run once — not a join on the list screen and not one per project.
  useEffect(() => {
    let cancelled = false;
    if (!isConfigured) return;
    void (async () => {
      const { data } = await supabase
        .from('projects').select('id, name, status').eq('opportunity_id', deal.id).limit(20);
      if (!cancelled) setProjects((data ?? []) as never);
    })();
    return () => { cancelled = true; };
  }, [deal.id, onChanged]);

  const matches = useMemo(
    () => findClientMatches(clients.rows, {
      name: deal.company_name ?? deal.contact_name,
      email: deal.contact_email,
    }),
    [clients.rows, deal.company_name, deal.contact_name, deal.contact_email],
  );

  const attach = async (client: Client) => {
    setBusy(true);
    setError(await sales.update(deal.id, { organization_id: client.id }));
    setBusy(false);
  };

  const createClient = async () => {
    const name = (deal.company_name || deal.contact_name || deal.title).trim();
    setBusy(true);
    const result = await ops.createClient({
      name,
      slug: uniqueSlug(name, clients.rows.map((c) => c.slug)),
      status: 'active',
      primary_service: deal.service,
      acquisition_source: deal.source,
      acquisition_medium: deal.medium,
      acquisition_campaign: deal.campaign,
    });
    if (typeof result === 'string') { setError(result); setBusy(false); return; }
    setError(await sales.update(deal.id, { organization_id: result.id }));
    setBusy(false);
  };

  const createProject = async () => {
    if (!deal.organization_id) return;
    setBusy(true);
    const template = templateFor(deal.service);
    const result = await ops.createProject({
      organization_id: deal.organization_id,
      name: deal.title,
      slug: uniqueSlug(deal.title, []),
      service: deal.service,
      status: 'planned',
      value: deal.estimated_value,
      currency: deal.currency,
      opportunity_id: deal.id,
      start_date: new Date().toISOString().slice(0, 10),
    }, template.steps);
    setBusy(false);
    if (typeof result === 'string') setError(result);
  };

  const done = Boolean(deal.organization_id) && projects.length > 0;

  return (
    <Panel>
      <SectionHeader
        title="Won"
        note={done ? 'client and project created' : 'what this deal became'}
      />
      <div className="grid gap-3 px-4 py-3.5">
        <dl className="grid rounded-sm border border-hairline">
          <DataLine
            term="Client"
            value={deal.client
              ? <Link to={`/clients/${deal.client.id}`} className="underline underline-offset-4 hover:text-signal">
                  {deal.client.name}
                </Link>
              : <NotRecorded what="Client" />}
          />
          <DataLine
            term="Projects"
            value={projects.length === 0
              ? <NotRecorded what="Project" />
              : (
                <span className="grid gap-0.5">
                  {projects.map((p) => (
                    <Link key={p.id} to={`/projects/${p.id}`}
                          className="underline underline-offset-4 hover:text-signal">
                      {p.name}
                    </Link>
                  ))}
                </span>
              )}
          />
          <DataLine
            term="Won value"
            value={money(deal.estimated_value, deal.currency)
              ? <span className="num">{money(deal.estimated_value, deal.currency)}</span>
              : <NotRecorded />}
          />
        </dl>

        {mayEdit && !deal.organization_id && (
          <div className="grid gap-2">
            {matches.length > 0 && (
              <div className="rounded-sm border border-signal/25 px-3 py-2.5">
                <p className="label mb-1.5 text-signal">Possible existing clients</p>
                <p className="t-note mb-2">
                  Nothing is merged automatically. Attach this deal to one of these, or create a new
                  client if none of them is the same company.
                </p>
                <ul className="grid gap-1.5">
                  {matches.map(({ client, why }) => (
                    <li key={client.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 text-[13px] text-paper">
                        {client.name} <span className="t-note">— matched on {why}</span>
                      </span>
                      <Button size="sm" onClick={() => void attach(client)} disabled={busy}>
                        Attach
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <Button size="sm" variant="primary" onClick={createClient} disabled={busy}>
                Create client from this deal
              </Button>
            </div>
          </div>
        )}

        {mayEdit && deal.organization_id && projects.length === 0 && (
          <div>
            <Button size="sm" variant="primary" onClick={createProject} disabled={busy}>
              Create project
            </Button>
            <p className="t-note mt-1.5">
              Starts from the {templateFor(deal.service).label.toLowerCase()} milestone list, at the
              deal&rsquo;s value. Everything is editable afterwards.
            </p>
          </div>
        )}

        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Panel>
  );
}

/* =========================================================== related lead */

function RelatedLead({ deal }: { deal: Opportunity }) {
  if (!deal.lead_id) return null;
  return (
    <Panel>
      <SectionHeader title="Source lead" note="the enquiry this came from" />
      <div className="px-4 py-3">
        <Link
          to={`/leads/${deal.lead_id}`}
          className="text-[13px] text-paper underline underline-offset-4 hover:text-signal"
        >
          Open the original enquiry
        </Link>
        <p className="t-note mt-1">
          The message, the questionnaire answers and the submission metadata stay on the lead — they
          are deliberately not copied here.
        </p>
      </div>
    </Panel>
  );
}

/* ================================================================= editing */

/**
 * Every commercial field, in one form.
 *
 * The stage is NOT here: it has its own control on the right rail and a
 * deliberate close flow, and a stage buried in an edit dialog is a stage that
 * gets changed by accident.
 */
function EditDialog({
  deal, onClose, onSaved,
}: { deal: Opportunity; onClose: () => void; onSaved: () => void }) {
  const mutate = useOpportunityMutations(onSaved);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: deal.title,
    company_name: deal.company_name ?? '',
    contact_name: deal.contact_name ?? '',
    contact_email: deal.contact_email ?? '',
    contact_phone: deal.contact_phone ?? '',
    service: deal.service ?? '',
    estimated_value: deal.estimated_value === null ? '' : String(deal.estimated_value),
    currency: deal.currency,
    probability: String(deal.probability),
    expected_close_on: deal.expected_close_on ?? '',
    next_action: deal.next_action ?? '',
    next_action_on: deal.next_action_on ?? '',
  });

  const field = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    const raw = form.estimated_value.trim();
    const value = raw === '' ? null : Number(raw.replace(/\s/g, '').replace(',', '.'));
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setError('The value must be a number, and not a negative one.'); return;
    }
    const probability = Number(form.probability);
    if (!Number.isInteger(probability) || probability < 0 || probability > 100) {
      // The database has the same constraint. Checking here means the operator
      // is told what is wrong instead of shown a refusal.
      setError('Probability must be a whole number between 0 and 100.'); return;
    }

    const problem = await mutate.update(deal.id, {
      title: form.title.trim(),
      company_name: form.company_name.trim() || null,
      contact_name: form.contact_name.trim() || null,
      contact_email: form.contact_email.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      service: form.service.trim() || null,
      estimated_value: value,
      currency: form.currency,
      probability,
      expected_close_on: form.expected_close_on || null,
      next_action: form.next_action.trim() || null,
      next_action_on: form.next_action_on || null,
    });
    if (problem) { setError(problem); return; }
    onClose();
  };

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Edit opportunity"
      footer={
        <>
          <Button size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={mutate.busy === deal.id}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field id="edit-title" label="Title">
          <Input id="edit-title" value={form.title} onChange={(e) => field('title', e.target.value)} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="edit-company" label="Company">
            <Input id="edit-company" value={form.company_name}
                   onChange={(e) => field('company_name', e.target.value)} />
          </Field>
          <Field id="edit-service" label="Service">
            <Input id="edit-service" value={form.service}
                   onChange={(e) => field('service', e.target.value)} />
          </Field>
          <Field id="edit-contact" label="Contact">
            <Input id="edit-contact" value={form.contact_name}
                   onChange={(e) => field('contact_name', e.target.value)} />
          </Field>
          <Field id="edit-email" label="Contact email">
            <Input id="edit-email" type="email" value={form.contact_email}
                   onChange={(e) => field('contact_email', e.target.value)} />
          </Field>
          <Field id="edit-phone" label="Contact phone">
            <Input id="edit-phone" value={form.contact_phone}
                   onChange={(e) => field('contact_phone', e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="edit-value" label="Estimated value">
            <Input id="edit-value" inputMode="numeric" value={form.estimated_value}
                   onChange={(e) => field('estimated_value', e.target.value)} />
          </Field>
          <Field id="edit-currency" label="Currency">
            <Select id="edit-currency" className="w-full py-2.5 text-sm" value={form.currency}
                    onChange={(e) => field('currency', e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field
            id="edit-probability"
            label="Probability %"
            hint={isOpen(deal.stage)
              ? `${STAGE[deal.stage as Stage]?.probability}% is the stage default`
              : 'Closed deals are fixed at 100 or 0'}
          >
            <Input id="edit-probability" inputMode="numeric" value={form.probability}
                   disabled={!isOpen(deal.stage)}
                   onChange={(e) => field('probability', e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="edit-close" label="Expected close">
            <Input id="edit-close" type="date" value={form.expected_close_on}
                   onChange={(e) => field('expected_close_on', e.target.value)} />
          </Field>
          <Field id="edit-action" label="Next action">
            <Input id="edit-action" value={form.next_action}
                   onChange={(e) => field('next_action', e.target.value)} />
          </Field>
          <Field id="edit-action-date" label="Next action date">
            <Input id="edit-action-date" type="date" value={form.next_action_on}
                   onChange={(e) => field('next_action_on', e.target.value)} />
          </Field>
        </div>

        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

/* ================================================================ helpers */

interface StaffRow { id: string; full_name: string | null; email: string; role: string }

/**
 * The people a deal can be assigned to (§39).
 *
 * Real `profiles` rows, staff only, and never a hard-coded name. On an account
 * with one person this is a list of one, which is the truth; the day there is a
 * second, the control means something without any change here.
 */
function useStaff(): StaffRow[] {
  const { rows } = useRows<StaffRow>('profiles', 'id, full_name, email, role', 'created_at');
  return useMemo(() => rows.filter((p) => p.role !== 'client'), [rows]);
}
