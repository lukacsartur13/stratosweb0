import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Play } from 'lucide-react';
import { useScope } from '@/lib/scope';
import { Grid } from '@/components/shell/PortalShell';
import {
  Badge, Button, Cell, DataLine, DataState, Dialog, ErrorState, Field, Input, MetricCell, MetricStrip,
  NotRecorded, Panel, Row, SectionHeader, Select, Skeleton, StatusPill, Table, Textarea, cn,
} from '@/components/ui';
import { money } from '@/lib/money';
import { formatWhen } from '@/lib/leads';
import { isClosedProject, matchTemplate, shortDate, trackerOf, type TrackerSummary } from '@/lib/pipeline';
import {
  findClientMatches, uniqueSlug, useCheckpointTemplates, useClients, useTrackerRows, type Client, type Project,
} from '@/lib/operations';
import {
  IMPACT_STATUSES, SETTABLE_IMPACT_STATUSES, impactAnswers, impactStatusLabel, impactStatusTone,
} from '@/lib/impactRules';
import {
  useImpactApplication, useImpactApplications, useImpactConflicts, useImpactMutations, useImpactProjects,
  useImpactSummary, useUncapturedImpactLeads, type ImpactApplication, type StartProjectInput,
} from '@/lib/impact';
import { safeUrl } from '@/pages/clients';

/**
 * IMPACT — the free programme, kept apart from the paid business.
 *
 * Three views of one thing: the applications (its own pipeline, never the
 * sales pipeline), the Impact projects in progress and the ones delivered. The
 * two counters above them are computed from the projects every time
 * (`impact_support_summary()`); nothing on this screen is a stored total.
 *
 * Owner-only: the route needs `view_impact`, which only the designated owner
 * holds, and every table and function behind the screen answers to
 * `is_owner()` in the database (20260929000300_impact_program.sql).
 *
 * The projects themselves open in the SAME project screen as paid ones — same
 * checkpoints, templates, signals and close — which adapts to `program`.
 */

type View = 'applications' | 'active' | 'closed';

const huf = (value: number | null | undefined) => money(value, 'HUF');

export function ImpactScreen() {
  const { reloadToken } = useScope();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'active' ? 'active' : params.get('view') === 'closed' ? 'closed' : 'applications';
  const [statusFilter, setStatusFilter] = useState<string>('open');

  const applications = useImpactApplications(reloadToken);
  const projects = useImpactProjects(reloadToken);
  const { summary, state: summaryState } = useImpactSummary(reloadToken);
  const conflicts = useImpactConflicts(reloadToken);
  const uncaptured = useUncapturedImpactLeads(applications.rows, applications.state === 'ready', conflicts, reloadToken);

  const setView = (next: View) => {
    const updated = new URLSearchParams(params);
    if (next === 'applications') updated.delete('view'); else updated.set('view', next);
    setParams(updated, { replace: true });
  };

  // Archived is layout: hidden from the lists, still counted by the counters.
  const present = useMemo(() => projects.rows.filter((p) => !p.archived_at), [projects.rows]);
  const archivedCount = projects.rows.length - present.length;
  const active = present.filter((p) => !isClosedProject(p) && p.status !== 'cancelled');
  const closed = present.filter((p) => isClosedProject(p) || p.status === 'cancelled');
  const tracker = useTrackerRows(present.map((p) => p.id), [], reloadToken);
  const summaries = useMemo(() => {
    const out: Record<string, TrackerSummary> = {};
    for (const p of present) {
      out[p.id] = trackerOf(tracker.checkpoints[p.id] ?? [], { target_date: p.target_date, closed: isClosedProject(p) });
    }
    return out;
  }, [present, tracker.checkpoints]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of applications.rows) out[a.status] = (out[a.status] ?? 0) + 1;
    return out;
  }, [applications.rows]);
  const openCount = ['applied', 'review', 'consultation', 'accepted'].reduce((n, s) => n + (counts[s] ?? 0), 0);

  const shown = applications.rows.filter((a) => (statusFilter === 'all' ? true
    : statusFilter === 'open' ? ['applied', 'review', 'consultation', 'accepted'].includes(a.status)
      : a.status === statusFilter));

  const figure = (value: number | undefined) => (summaryState === 'loading'
    ? <Skeleton className="h-7 w-24" />
    : summaryState === 'error' || value === undefined ? <span className="text-haze">—</span> : huf(value));

  return (
    <div className="grid gap-4">
      {/* ---------------------------------------------------- the counters */}
      <MetricStrip label="Impact support" className="xl:grid-cols-4">
        <MetricCell
          label="Committed support"
          value={figure(summary?.committed)}
          note={summary
            ? (summary.committed_missing > 0
              ? <span className="text-signal" data-impact-missing>
                  {summary.committed_missing} in progress without a market value — not in this figure
                </span>
              : `${summary.committed_projects} ${summary.committed_projects === 1 ? 'project' : 'projects'} in progress`)
            : undefined}
        />
        <MetricCell
          label="Support delivered"
          value={figure(summary?.delivered)}
          note={summary ? `${summary.delivered_projects} closed ${summary.delivered_projects === 1 ? 'project' : 'projects'}` : undefined}
        />
        <MetricCell label="Open applications" value={applications.state === 'ready' ? openCount : <Skeleton className="h-7 w-10" />}
                    note={`${counts.accepted ?? 0} accepted, awaiting a project`} />
        <MetricCell label="Cancelled" value={summary ? summary.cancelled_projects : '—'} note="fell through · not counted" />
      </MetricStrip>
      <p className="t-note -mt-2">
        Impact is always free. Market value is what the donated work would have cost — not revenue,
        not an amount owed. Both figures are summed from the projects on every load; archiving changes neither.
      </p>

      {uncaptured.length > 0 && (
        <Panel className="border-danger/40 px-4 py-3" aria-label="Missing from the pipeline">
          <p role="alert" className="text-xs text-danger">
            {uncaptured.length} Impact {uncaptured.length === 1 ? 'submission is' : 'submissions are'} not in the pipeline.
            The leads are stored; their capture failed. Run <code>select * from impact_sync_applications();</code> in the
            SQL editor to add them — it never duplicates.
          </p>
        </Panel>
      )}

      {conflicts.length > 0 && (
        <Panel aria-label="Conflicts">
          <SectionHeader title="Conflicts to review" note={`${conflicts.length}`} />
          <p className="t-note px-4 pt-2">
            These came in through the Impact form but were already sold as paid deals before the Impact
            pipeline existed. Nothing was reclassified or deleted; decide each one by hand.
          </p>
          <ul className="grid px-4 py-2">
            {conflicts.map((c) => (
              <li key={c.opportunity_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline py-2 last:border-0">
                <span className="text-[13px] text-paper">{c.company || c.lead_name || 'Unknown applicant'}</span>
                <span className="flex flex-wrap items-center gap-3 text-[11px]">
                  {c.lead_id && <Link to={`/leads/${c.lead_id}`} className="underline underline-offset-4 hover:text-paper">Lead</Link>}
                  <Link to={`/sales/${c.opportunity_id}`} className="underline underline-offset-4 hover:text-paper">
                    Deal: {c.opportunity_title} ({c.stage})
                  </Link>
                  {c.project_ids.map((pid, i) => (
                    <Link key={pid} to={`/projects/${pid}`} className="underline underline-offset-4 hover:text-paper">Project {i + 1}</Link>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <nav aria-label="Impact views" className="flex flex-wrap items-center gap-px">
        {([
          ['applications', `Applications (${applications.rows.length})`],
          ['active', `Active projects (${active.length})`],
          ['closed', `Closed projects (${closed.length})`],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            aria-current={view === id ? 'page' : undefined}
            className={cn(
              'rounded-sm px-2.5 py-1.5 font-data text-[10px] uppercase tracking-[0.14em] transition-colors',
              view === id ? 'bg-flare text-paper' : 'text-haze hover:bg-flare hover:text-paper',
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      {view === 'applications' && (
        <Panel className="min-w-0">
          <SectionHeader
            title="Application pipeline"
            note={applications.state === 'ready' ? `${shown.length} of ${applications.rows.length}` : undefined}
            action={
              <>
                <label className="sr-only" htmlFor="impact-status">Show</label>
                <Select id="impact-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="open">Open ({openCount})</option>
                  {IMPACT_STATUSES.map((s) => <option key={s} value={s}>{impactStatusLabel(s)} ({counts[s] ?? 0})</option>)}
                  <option value="all">Every application</option>
                </Select>
              </>
            }
          />
          {applications.state === 'loading' && (
            <div className="space-y-1.5 p-4" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          )}
          {applications.state === 'unconfigured' && <DataState kind="unconfigured" title="Not connected" body="Supabase credentials are not set in this environment." />}
          {applications.state === 'error' && <ErrorState message={applications.message} onRetry={applications.reload} />}
          {applications.state === 'ready' && shown.length === 0 && (
            <DataState kind="empty"
              title={applications.rows.length === 0 ? 'No applications yet' : 'Nothing in this view'}
              body={applications.rows.length === 0
                ? 'An application appears here the moment the Impact form is submitted.'
                : 'No application has this status.'} />
          )}
          {applications.state === 'ready' && shown.length > 0 && (
            <Table head={['Organisation', 'Contact', 'Field', 'Received', 'Status', 'Project']} minWidth={720} sticky>
              {shown.map((a) => (
                <Row key={a.id} onClick={() => navigate(`/impact/applications/${a.id}`)}>
                  <Cell className="min-w-0">
                    <Link to={`/impact/applications/${a.id}`} className="text-[13px] text-paper hover:text-signal">
                      {applicantName(a)}
                    </Link>
                  </Cell>
                  <Cell className="truncate text-[11px] text-haze">{a.lead?.name ?? '—'}</Cell>
                  <Cell className="truncate text-[11px] text-haze">{String(a.lead?.payload?.terulet ?? '—')}</Cell>
                  <Cell className="num whitespace-nowrap text-[11px] text-haze">{shortDate(a.created_at)}</Cell>
                  <Cell><Badge tone={impactStatusTone(a.status)}>{impactStatusLabel(a.status)}</Badge></Cell>
                  <Cell className="truncate text-[11px]">
                    {a.project
                      ? <Link to={`/projects/${a.project.id}`} className="underline underline-offset-4 hover:text-signal">{a.project.name}</Link>
                      : <span className="text-haze">—</span>}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Panel>
      )}

      {view !== 'applications' && (
        <Panel className="min-w-0">
          <SectionHeader
            title={view === 'active' ? 'Active Impact projects' : 'Closed Impact projects'}
            note={archivedCount > 0 ? `${archivedCount} archived not shown — still counted` : undefined}
          />
          {projects.state === 'loading' && (
            <div className="space-y-1.5 p-4" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          )}
          {projects.state === 'error' && <ErrorState message="The Impact projects could not be read." onRetry={projects.reload} />}
          {projects.state === 'ready' && (view === 'active' ? active : closed).length === 0 && (
            <DataState kind="empty"
              title={view === 'active' ? 'No Impact project in progress' : 'No closed Impact project'}
              body={view === 'active'
                ? 'An Impact project is started from an accepted application.'
                : 'A project lands here when it is closed — every checkpoint done and a market value recorded.'} />
          )}
          {projects.state === 'ready' && (view === 'active' ? active : closed).length > 0 && (
            <ImpactProjectTable rows={view === 'active' ? active : closed} summaries={summaries} closedView={view === 'closed'} />
          )}
        </Panel>
      )}
    </div>
  );
}

const applicantName = (a: ImpactApplication) =>
  a.lead?.company || String(a.lead?.payload?.org ?? '') || a.lead?.name || 'Unnamed applicant';

function ImpactProjectTable({ rows, summaries, closedView }: {
  rows: Project[]; summaries: Record<string, TrackerSummary>; closedView: boolean;
}) {
  const navigate = useNavigate();
  return (
    <Table
      head={closedView
        ? ['Project', 'Organisation', 'State', 'Closed', { label: 'Market value', align: 'right' }]
        : ['Project', 'Organisation', 'Current step', { label: 'Checkpoints', align: 'right' }, 'Deadline',
          { label: 'Market value', align: 'right' }]}
      minWidth={720}
      sticky
    >
      {rows.map((p) => {
        const s = summaries[p.id];
        return (
          <Row key={p.id} onClick={() => navigate(`/projects/${p.id}`)}>
            <Cell className="min-w-0">
              <Link to={`/projects/${p.id}`} className="text-[13px] text-paper hover:text-signal">{p.name}</Link>
            </Cell>
            <Cell className="truncate text-[11px] text-haze">{p.client?.name ?? '—'}</Cell>
            {closedView ? (
              <>
                <Cell>{p.status === 'cancelled'
                  ? <Badge tone="bad">Cancelled · not counted</Badge>
                  : <Badge tone="good">Delivered</Badge>}</Cell>
                <Cell className="num whitespace-nowrap text-[11px] text-haze">{shortDate(p.completed_at)}</Cell>
              </>
            ) : (
              <>
                <Cell className="truncate text-[11px] text-paper">
                  {s?.current ?? <span className="text-haze">{s && s.total > 0 ? 'All done' : 'No checkpoints'}</span>}
                </Cell>
                <Cell align="right" className="num text-xs text-haze">{s && s.total > 0 ? `${s.done}/${s.total}` : '—'}</Cell>
                <Cell className="num whitespace-nowrap text-[11px] text-haze">{shortDate(p.target_date)}</Cell>
              </>
            )}
            <Cell align="right" className="num text-xs">
              {p.market_value === null
                ? <span className="text-signal" data-impact-missing>Not recorded</span>
                : <span className="text-paper">{huf(p.market_value)}</span>}
            </Cell>
          </Row>
        );
      })}
    </Table>
  );
}

/* ====================================================== one application == */

export function ImpactApplicationScreen() {
  const { id } = useParams<{ id: string }>();
  const { reloadToken } = useScope();
  const navigate = useNavigate();
  const { row: app, state, reload } = useImpactApplication(id, reloadToken);
  const ops = useImpactMutations(() => { void reload(); });
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  if (state === 'loading') {
    return <Grid><Skeleton className="col-span-12 h-64 lg:col-span-8" /><Skeleton className="col-span-12 h-64 lg:col-span-4" /></Grid>;
  }
  if (state !== 'ready' || !app) {
    return (
      <Panel>
        <DataState
          kind={state === 'error' ? 'unavailable' : state === 'unconfigured' ? 'unconfigured' : 'empty'}
          title={state === 'error' ? 'Unavailable' : state === 'unconfigured' ? 'Not connected' : 'No such application'}
          body={state === 'missing' ? 'This application does not exist, or this account may not read it.' : undefined}
          action={<Link to="/impact"><Button size="sm">All applications</Button></Link>}
        />
      </Panel>
    );
  }

  const lead = app.lead;
  const answers = impactAnswers(lead?.payload);
  const started = app.status === 'project_started';
  const draft = note ?? app.decision_note ?? '';
  const website = lead?.website ?? (typeof lead?.payload?.web === 'string' ? lead.payload.web : null);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/impact" className="t-note inline-flex items-center gap-1.5 underline underline-offset-4 hover:text-paper">
          <ArrowLeft size={11} aria-hidden="true" /> Impact applications
        </Link>
        <StatusPill tone={impactStatusTone(app.status)}>{impactStatusLabel(app.status)}</StatusPill>
      </div>

      <Panel aria-label="Application summary" className="px-4 py-3.5">
        <p className="t-section">Impact application · free</p>
        <p className="mt-1.5 break-words text-lg leading-tight text-paper">{applicantName(app)}</p>
        <p className="t-note mt-1">
          Received {formatWhen(app.created_at)}{app.origin === 'backfill' ? ' · brought across from the lead list' : ''}
        </p>
      </Panel>

      <Grid>
        <div className="col-span-12 grid min-w-0 gap-4 lg:col-span-8">
          <Panel aria-label="Answers">
            <SectionHeader title="Answers" note="as submitted" />
            {answers.length > 0 ? (
              <dl className="grid">
                {answers.map((a) => (
                  <div key={a.label} className="border-b border-hairline px-4 py-2.5 last:border-0">
                    <dt className="label">{a.label}</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words text-[13px] text-paper">{a.value}</dd>
                  </div>
                ))}
              </dl>
            ) : lead?.message ? (
              <p className="whitespace-pre-wrap break-words px-4 py-3 text-[13px] text-paper">{lead.message}</p>
            ) : (
              <p className="px-4 py-3 text-xs text-haze">This submission carries no stored answers.</p>
            )}
          </Panel>

          <Panel aria-label="Decision">
            <SectionHeader title="Decision" note={`since ${shortDate(app.status_changed_at)}`} />
            <div className="grid gap-3 px-4 py-3">
              {started ? (
                <p className="text-xs text-haze">
                  A project was started from this application. Its progress lives on the project:{' '}
                  {app.project
                    ? <Link to={`/projects/${app.project.id}`} className="underline underline-offset-4 hover:text-paper">{app.project.name}</Link>
                    : 'project'}.
                </p>
              ) : (
                <Field id="impact-app-status" label="Status">
                  <Select
                    id="impact-app-status"
                    className="w-full py-2.5 text-sm"
                    value={app.status}
                    disabled={ops.busy === app.id}
                    onChange={async (e) => setError(await ops.setStatus(app.id, e.target.value))}
                  >
                    {SETTABLE_IMPACT_STATUSES.map((s) => <option key={s} value={s}>{impactStatusLabel(s)}</option>)}
                  </Select>
                </Field>
              )}
              <Field id="impact-app-note" label="Decision note" hint="Why it was accepted, deferred or turned down. Owner-only.">
                <Textarea id="impact-app-note" value={draft} onChange={(e) => setNote(e.target.value)} className="min-h-20 text-[13px]" />
              </Field>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button size="sm" disabled={note === null || ops.busy === app.id}
                        onClick={async () => { const r = await ops.saveDecisionNote(app.id, draft); setError(r); if (!r) setNote(null); }}>
                  Save note
                </Button>
                {app.status === 'accepted' && (
                  <Button size="sm" variant="primary" onClick={() => setStarting(true)}>
                    <Play size={11} aria-hidden="true" /> Start Impact project
                  </Button>
                )}
              </div>
              {app.status !== 'accepted' && !started && (
                <p className="t-note">A project can be started once the application is accepted.</p>
              )}
              {error && <p role="alert" className="text-xs text-danger">{error}</p>}
            </div>
          </Panel>
        </div>

        <div className="col-span-12 grid min-w-0 gap-4 lg:col-span-4">
          <Panel>
            <SectionHeader title="Contact" />
            <dl className="grid">
              <DataLine term="Organisation" value={lead?.company || <NotRecorded />} />
              <DataLine term="Contact" value={lead?.name || <NotRecorded />} />
              <DataLine term="Email" value={lead?.email
                ? <a href={`mailto:${lead.email}`} className="underline underline-offset-4 hover:text-signal">{lead.email}</a>
                : <NotRecorded />} />
              <DataLine term="Phone" value={lead?.phone || <NotRecorded />} />
              <DataLine term="Website" value={safeUrl(website)
                ? <a href={safeUrl(website)!} target="_blank" rel="noreferrer noopener" className="break-all underline underline-offset-4 hover:text-signal">{website}</a>
                : website || <NotRecorded />} />
            </dl>
          </Panel>
          <Panel>
            <SectionHeader title="Record" />
            <dl className="grid">
              <DataLine term="Original lead" value={lead
                ? <Link to={`/leads/${lead.id}`} className="underline underline-offset-4 hover:text-signal">Open the lead</Link>
                : <NotRecorded />} />
              <DataLine term="Programme" value={<Badge tone="good">Impact · free</Badge>}
                        note="never a paid opportunity" />
              {app.legacy_lead_status && <DataLine term="Lead status when brought across" value={app.legacy_lead_status} />}
              {app.project && (
                <DataLine term="Market value" value={app.project.market_value === null
                  ? <NotRecorded what="Market value" />
                  : <span className="num">{huf(app.project.market_value)}</span>} />
              )}
            </dl>
          </Panel>
        </div>
      </Grid>

      {starting && app.status === 'accepted' && (
        <StartProjectDialog
          app={app}
          busy={ops.busy === 'start'}
          onClose={() => setStarting(false)}
          onStart={async (input) => {
            const result = await ops.startProject(input);
            if (typeof result === 'string') return result;
            setStarting(false);
            navigate(`/projects/${result.id}`);
            return null;
          }}
        />
      )}
    </div>
  );
}

/* ================================================= start a project == */

/**
 * Client first — the same duplicate check as a won deal (`findClientMatches`):
 * possible matches are SHOWN, never merged. Then the project and its starting
 * checkpoints. One call does all of it (`impact_start_project`), so a failure
 * leaves nothing half-made and a second click returns the same project.
 *
 * No login is created and no invitation is sent: the client is a record, not an
 * account.
 */
function StartProjectDialog({ app, busy, onClose, onStart }: {
  app: ImpactApplication;
  busy: boolean;
  onClose: () => void;
  onStart: (input: StartProjectInput) => Promise<string | null>;
}) {
  const clients = useClients();
  const templates = useCheckpointTemplates();
  const name = applicantName(app);
  const website = app.lead?.website ?? (typeof app.lead?.payload?.web === 'string' ? app.lead.payload.web : null);
  const matches = useMemo(
    () => findClientMatches(clients.rows, { name, email: app.lead?.email, website }),
    [clients.rows, name, app.lead?.email, website],
  );

  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState(name);
  const [projectName, setProjectName] = useState(`${name} — Impact`);
  const [service, setService] = useState('Website');
  const [templateId, setTemplateId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const matched = matchTemplate(templates.live, service);
  const chosen = templateId === 'none' ? null : templates.live.find((t) => t.id === templateId) ?? matched;

  const submit = async () => {
    setError(null);
    if (mode === 'existing' && !clientId) { setError('Choose the client this project is for.'); return; }
    const problem = await onStart({
      applicationId: app.id,
      organizationId: mode === 'existing' ? clientId : null,
      client: mode === 'new'
        ? { name: clientName.trim(), slug: uniqueSlug(clientName, clients.rows.map((c) => c.slug)), website }
        : null,
      project: {
        name: projectName.trim(),
        // Unique within the client. A brand-new client has no projects yet.
        slug: uniqueSlug(projectName, []),
        service: service.trim() || null,
      },
      steps: chosen?.steps ?? [],
    });
    if (problem) setError(problem);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Start an Impact project"
      description="Creates the project and marks the application as started, together. Free: no fee, invoice or payment can be recorded on it."
      footer={
        <>
          <Button size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={busy}>
            {busy ? 'Starting…' : 'Start project'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <fieldset className="grid gap-2">
          <legend className="label mb-1">Client</legend>
          {matches.length > 0 && (
            <div className="rounded-sm border border-signal/25 px-3 py-2.5">
              <p className="label mb-1.5 text-signal">Possible existing clients</p>
              <p className="t-note mb-2">Nothing is merged automatically. Attach to one of these if it is the same organisation.</p>
              <ul className="grid gap-1.5">
                {matches.map(({ client, why }) => (
                  <li key={client.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 text-[13px] text-paper">{client.name} <span className="t-note">— {why}</span></span>
                    <Button size="sm" onClick={() => { setMode('existing'); setClientId(client.id); }}>Use this client</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="flex items-center gap-2 text-[13px] text-paper">
            <input type="radio" name="impact-client-mode" checked={mode === 'new'} onChange={() => setMode('new')} />
            Create a new client
          </label>
          {mode === 'new' && (
            <Field id="impact-client-name" label="Client name">
              <Input id="impact-client-name" value={clientName} onChange={(e) => setClientName(e.target.value)} />
            </Field>
          )}
          <label className="flex items-center gap-2 text-[13px] text-paper">
            <input type="radio" name="impact-client-mode" checked={mode === 'existing'} onChange={() => setMode('existing')} />
            Attach to an existing client
          </label>
          {mode === 'existing' && (
            <Field id="impact-client" label="Existing client">
              <Select id="impact-client" className="w-full py-2.5 text-sm" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Choose a client…</option>
                {clients.rows.filter((c: Client) => !c.archived_at).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          )}
        </fieldset>

        <Field id="impact-project-name" label="Project name">
          <Input id="impact-project-name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
        </Field>
        <Field id="impact-service" label="Service">
          <Input id="impact-service" value={service} onChange={(e) => setService(e.target.value)} />
        </Field>
        <Field id="impact-template" label="Starting checkpoints" hint="Copied into the project — editing the template later never changes them.">
          <Select id="impact-template" className="w-full py-2.5 text-sm" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">{matched ? `Match the service — ${matched.name} (${matched.steps.length} steps)` : 'Match the service'}</option>
            {templates.live.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.steps.length} steps)</option>)}
            <option value="none">No checkpoints yet</option>
          </Select>
        </Field>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}
