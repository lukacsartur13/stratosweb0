import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { canAccess } from '@/lib/permissions';
import { useScope } from '@/lib/scope';
import { useRows } from '@/lib/useRows';
import { Grid } from '@/components/shell/PortalShell';
import {
  Badge, Button, Cell, DataLine, DataState, Dialog, ErrorState, Field, Input, NotRecorded,
  Panel, Row, SectionHeader, Select, Skeleton, StatusPill, Table, Textarea, cn,
} from '@/components/ui';
import { CURRENCIES, money, percent } from '@/lib/money';
import {
  COST_CATEGORIES, COST_LABEL, IMPACT_SETTABLE_STATES, MILESTONE_LABEL, MILESTONE_STATES, PAYMENT_LABEL,
  PROJECT_STATUS, SETTABLE_PROJECT_STATES, dueTone, financials, isClosedProject,
  matchTemplate, projectStatusLabel, projectStatusTone, shortDate, templateFor, trackerOf,
  type TrackerSummary,
} from '@/lib/pipeline';
import {
  costTotal, isMonthly, monthlyTotals, monthsRunning, uniqueSlug, useCheckpointTemplates, useClients, useOperationsMutations,
  useProjectDetail, useProjects, useTrackerRows,
  type CheckpointTemplate, type ClientContact, type Milestone, type Project,
} from '@/lib/operations';
import { buildRecordTimeline, useNoteMutation, useRecordDetail } from '@/lib/records';
import { formatWhen } from '@/lib/leads';
import { celebrate } from '@/lib/celebrate';
import { impactCloseBlockers, parseMarketValue } from '@/lib/impactRules';
import { safeUrl } from '@/pages/clients';
import { ProjectLibrary } from '@/features/documents/ProjectLibrary';
import { PaymentSchedule, Receivables } from '@/features/payments/PaymentSchedule';
import { budapestToday } from '@/lib/paymentRules';
import { ClientInbox, ClientViewPanel } from '@/features/client-view/ClientViewPanel';

/**
 * PROJECTS — the owner's private delivery tracker.
 *
 * Reachable only by the designated portal owner: the route guard checks
 * `canAccess(profile, 'view_projects')`, and every table behind this screen is
 * owner-only in the database (20260928000300_owner_lockdown.sql), which is the
 * part that actually decides.
 *
 * A project answers: who is it for, what is being delivered, which step is it
 * on, how many steps are done, when is it due — and, separately, is it late, is
 * it waiting on the client, is it blocked. Those last three are kept apart on
 * purpose; see `trackerOf` in lib/pipeline.ts.
 *
 * Active and Closed are the two halves of one list. Closed is `completed`,
 * which only the database's close rule can set; archiving (`archived_at`) is a
 * different thing and archived projects appear in neither.
 *
 * Monthly contracts (20261006000100_monthly_contracts.sql) are a third list of
 * their own: billed by the month, totalled by monthly fee, and never counted in
 * Active or Closed.
 */

type View = 'active' | 'closed' | 'monthly';
type Flag = 'all' | 'late' | 'waiting' | 'blocked';

export function ProjectsScreen() {
  const { profile } = useAuth();
  const { reloadToken } = useScope();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const mayEdit = canAccess(profile, 'manage_projects');

  const view: View = params.get('view') === 'closed' ? 'closed' : params.get('view') === 'monthly' ? 'monthly' : 'active';
  const { rows, state, message, reload } = useProjects(reloadToken);
  const [query, setQuery] = useState('');
  const [flag, setFlag] = useState<Flag>('all');
  const [creating, setCreating] = useState(false);

  const setView = (next: View) => {
    const updated = new URLSearchParams(params);
    if (next === 'active') updated.delete('view'); else updated.set('view', next);
    setParams(updated, { replace: true });
  };

  // Paid one-off projects. Impact projects have their own screen (/impact) and
  // their own counters; monthly contracts have their own view below. All three
  // share the detail screen, not this list.
  const present = useMemo(
    () => rows.filter((p) => !p.archived_at && p.program !== 'impact' && !isMonthly(p)),
    [rows],
  );
  const monthly = useMemo(() => rows.filter((p) => !p.archived_at && isMonthly(p)), [rows]);
  const runningMonthly = monthly.filter((p) => !isClosedProject(p)).length;
  const tracker = useTrackerRows(
    present.map((p) => p.id),
    [...new Set(present.map((p) => p.organization_id))],
    reloadToken,
  );

  const summaries = useMemo(() => {
    const out: Record<string, TrackerSummary> = {};
    for (const p of present) {
      out[p.id] = trackerOf(tracker.checkpoints[p.id] ?? [], {
        target_date: p.target_date, closed: isClosedProject(p),
      });
    }
    return out;
  }, [present, tracker.checkpoints]);

  const inView = useMemo(
    () => present.filter((p) => (view === 'closed' ? isClosedProject(p) : !isClosedProject(p))),
    [present, view],
  );

  const flagCounts = useMemo(() => {
    const active = present.filter((p) => !isClosedProject(p));
    return {
      late: active.filter((p) => summaries[p.id]?.late).length,
      waiting: active.filter((p) => (summaries[p.id]?.waiting.length ?? 0) > 0).length,
      blocked: active.filter((p) => (summaries[p.id]?.blocked.length ?? 0) > 0).length,
    };
  }, [present, summaries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inView
      .filter((p) => {
        if (view === 'closed' || flag === 'all') return true;
        const s = summaries[p.id];
        if (!s) return false;
        if (flag === 'late') return s.late;
        if (flag === 'waiting') return s.waiting.length > 0;
        return s.blocked.length > 0;
      })
      .filter((p) => !q || [
        p.name, p.client?.name, p.service, p.slug,
        tracker.contacts[p.organization_id]?.name, summaries[p.id]?.current,
      ].some((f) => String(f ?? '').toLowerCase().includes(q)));
  }, [inView, query, flag, view, summaries, tracker.contacts]);

  const closedCount = present.filter(isClosedProject).length;
  const activeCount = present.length - closedCount;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <nav aria-label="Project views" className="flex flex-wrap items-center gap-px">
          {([
            ['active', `Active (${activeCount})`],
            ['closed', `Closed (${closedCount})`],
            ['monthly', `Monthly contracts (${runningMonthly})`],
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
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/impact?view=active" className="t-note underline underline-offset-4 hover:text-paper">Impact projects</Link>
          <Link to="/projects/templates"><Button size="sm">Templates</Button></Link>
          {mayEdit && (
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus size={12} aria-hidden="true" /> New project
            </Button>
          )}
        </div>
      </div>

      {view === 'monthly' ? (
        <MonthlyContracts rows={monthly} state={state} message={message} onRetry={reload} />
      ) : (
      <Panel className="min-w-0">
        <SectionHeader
          title={view === 'closed' ? 'Closed projects' : 'Active projects'}
          note={state === 'ready' ? `${filtered.length} of ${inView.length}` : undefined}
          action={
            <div className="flex flex-wrap items-center gap-2">
              {view === 'active' && (
                <>
                  <label className="sr-only" htmlFor="project-flag">Show</label>
                  <Select id="project-flag" value={flag} onChange={(e) => setFlag(e.target.value as Flag)}>
                    <option value="all">Every active project</option>
                    <option value="late">Late ({flagCounts.late})</option>
                    <option value="waiting">Waiting on client ({flagCounts.waiting})</option>
                    <option value="blocked">Blocked ({flagCounts.blocked})</option>
                  </Select>
                </>
              )}
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Project, client, step…"
                aria-label="Search projects"
                className="h-7 w-44 py-1 text-xs sm:w-56"
              />
            </div>
          }
        />

        {state === 'loading' && (
          <div className="space-y-1.5 p-4" aria-busy="true">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        )}

        {state === 'unconfigured' && (
          <DataState
            kind="unconfigured"
            title="Not connected"
            body="Supabase credentials are not set in this environment, so there is nothing to read yet."
          />
        )}

        {state === 'error' && <ErrorState message={message} onRetry={reload} />}

        {state === 'ready' && filtered.length === 0 && (
          <DataState
            kind="empty"
            title={present.length === 0 ? 'No projects yet'
              : inView.length === 0
                ? (view === 'closed' ? 'No closed projects' : 'No active projects')
                : 'Nothing matches'}
            body={inView.length === 0
              ? (view === 'closed'
                ? 'A project lands here when it is closed — after its last checkpoint is done.'
                : 'A project is created from a won opportunity, or here for an existing client.')
              : 'Nothing in this view matches the search or the filter.'}
            action={inView.length > 0
              ? <Button size="sm" onClick={() => { setQuery(''); setFlag('all'); }}>Clear</Button>
              : undefined}
          />
        )}

        {state === 'ready' && filtered.length > 0 && (
          <Table
            head={view === 'closed'
              ? ['Project', 'Client', 'Company', 'Service', { label: 'Checkpoints', align: 'right' }, 'Deadline', 'Closed']
              : ['Project', 'Client', 'Company', 'Service', 'Current step',
                { label: 'Checkpoints', align: 'right' }, 'Deadline', 'Signals']}
            minWidth={840}
            sticky
          >
            {filtered.map((project) => {
              const s = summaries[project.id];
              const contact = tracker.contacts[project.organization_id];
              const tone = dueTone(project.target_date);
              return (
                <Row key={project.id} onClick={() => navigate(`/projects/${project.id}`)}>
                  <Cell className="min-w-0">
                    <Link to={`/projects/${project.id}`} className="text-[13px] text-paper hover:text-signal">
                      {project.name}
                    </Link>
                  </Cell>
                  <Cell className="truncate text-[11px] text-haze">{contact?.name ?? '—'}</Cell>
                  <Cell className="truncate text-[11px] text-haze">{project.client?.name ?? '—'}</Cell>
                  <Cell className="truncate text-[11px] text-haze">{project.service || '—'}</Cell>
                  {view === 'active' && (
                    <Cell className="truncate text-[11px] text-paper">
                      {s?.current ?? <span className="text-haze">{s && s.total > 0 ? 'All done — ready to close' : 'No checkpoints'}</span>}
                    </Cell>
                  )}
                  <Cell align="right" className="num text-xs text-haze">
                    {s && s.total > 0 ? `${s.done}/${s.total}` : '—'}
                  </Cell>
                  <Cell className={cn(
                    'num whitespace-nowrap text-[11px]',
                    view === 'active' && tone === 'overdue' ? 'text-danger'
                      : view === 'active' && tone === 'today' ? 'text-signal' : 'text-haze',
                  )}>
                    {shortDate(project.target_date)}
                  </Cell>
                  {view === 'active'
                    ? <Cell><Signals summary={s} /></Cell>
                    : <Cell className="num whitespace-nowrap text-[11px] text-haze">{shortDate(project.completed_at)}</Cell>}
                </Row>
              );
            })}
          </Table>
        )}
      </Panel>
      )}

      {/* Owner-only like the whole screen: the figures come from RLS-guarded
          rows, so any other account would see an empty panel anyway. */}
      {canAccess(profile, 'manage_client_accounts') && <ClientInbox reloadToken={reloadToken} />}

      <Receivables reloadToken={reloadToken} />

      {mayEdit && creating && (
        <NewProjectDialog
          monthly={view === 'monthly'}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); void reload(); navigate(`/projects/${id}`); }}
        />
      )}
    </div>
  );
}

/**
 * MONTHLY CONTRACTS — paid work billed by the month, kept apart from the
 * one-off projects.
 *
 * The top line is the monthly fee of every running contract, one figure per
 * currency (never added across currencies). A contract that has been ended
 * (closed) stays listed under it, with the date it ended, and is not counted.
 * What was actually received is the payment schedule's, per contract.
 */
function MonthlyContracts({
  rows, state, message, onRetry,
}: { rows: Project[]; state: string; message: string; onRetry: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const totals = monthlyTotals(rows);
  const today = budapestToday();
  const q = query.trim().toLowerCase();
  const sorted = [...rows]
    .filter((p) => !q || [p.name, p.client?.name, p.service].some((f) => String(f ?? '').toLowerCase().includes(q)))
    .sort((a, b) => Number(isClosedProject(a)) - Number(isClosedProject(b)) || a.name.localeCompare(b.name));

  return (
    <div className="grid gap-4">
      <Panel aria-label="Monthly revenue" className="grid grid-cols-1 divide-y divide-hairline sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {totals.length === 0 ? (
          <div className="px-4 py-3.5 sm:col-span-3">
            <p className="t-section">Monthly fees</p>
            <p className="t-note mt-1.5">No running monthly contract.</p>
          </div>
        ) : totals.map((t) => (
          <div key={t.currency} className="min-w-0 px-4 py-3.5" data-monthly-total={t.currency}>
            <p className="t-section">Monthly fees · {t.currency}</p>
            <p className="t-metric mt-1.5 num">{money(t.total, t.currency)}</p>
            <p className="t-note mt-1">
              per month · {t.contracts} running contract{t.contracts === 1 ? '' : 's'}
            </p>
          </div>
        ))}
      </Panel>

      <Panel className="min-w-0">
        <SectionHeader
          title="Monthly contracts"
          note={state === 'ready' ? `${sorted.length} of ${rows.length}` : undefined}
          action={
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Contract, client, service…"
              aria-label="Search monthly contracts"
              className="h-7 w-44 py-1 text-xs sm:w-56"
            />
          }
        />
        {state === 'loading' && (
          <div className="space-y-1.5 p-4" aria-busy="true">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        )}
        {state === 'error' && <ErrorState message={message} onRetry={onRetry} />}
        {state === 'ready' && sorted.length === 0 && (
          <DataState
            kind="empty"
            title={rows.length === 0 ? 'No monthly contracts yet' : 'Nothing matches'}
            body={rows.length === 0
              ? 'A monthly contract is ongoing work billed by the month — care, ads management, SEO. Create one with New project → Monthly contract.'
              : 'No contract matches the search.'}
          />
        )}
        {state === 'ready' && sorted.length > 0 && (
          <Table
            head={['Contract', 'Company', 'Service', { label: 'Monthly fee', align: 'right' }, 'Since',
              { label: 'Months', align: 'right' }, 'Ends', 'State']}
            minWidth={840}
            sticky
          >
            {sorted.map((p) => {
              const ended = isClosedProject(p);
              const months = monthsRunning(p.start_date, ended && p.completed_at ? p.completed_at : today);
              return (
                <Row key={p.id} onClick={() => navigate(`/projects/${p.id}`)}>
                  <Cell className="min-w-0">
                    <Link to={`/projects/${p.id}`} className={cn('text-[13px] hover:text-signal', ended ? 'text-haze' : 'text-paper')}>
                      {p.name}
                    </Link>
                  </Cell>
                  <Cell className="truncate text-[11px] text-haze">{p.client?.name ?? '—'}</Cell>
                  <Cell className="truncate text-[11px] text-haze">{p.service || '—'}</Cell>
                  <Cell align="right" className={cn('num text-xs', ended ? 'text-haze' : 'text-paper')}>
                    {p.monthly_fee === null ? '—' : money(p.monthly_fee, p.currency)}
                  </Cell>
                  <Cell className="num whitespace-nowrap text-[11px] text-haze">{shortDate(p.start_date)}</Cell>
                  <Cell align="right" className="num text-xs text-haze">{months ?? '—'}</Cell>
                  <Cell className="num whitespace-nowrap text-[11px] text-haze">
                    {ended ? shortDate(p.completed_at) : p.target_date ? shortDate(p.target_date) : 'open-ended'}
                  </Cell>
                  <Cell>
                    {ended
                      ? <Badge tone="neutral">Ended</Badge>
                      : p.status === 'on_hold' ? <Badge tone="warn">On hold</Badge>
                        : <Badge tone="good">Running</Badge>}
                  </Cell>
                </Row>
              );
            })}
          </Table>
        )}
      </Panel>
    </div>
  );
}

/**
 * Late, waiting and blocked — three separate marks, each with its reason in
 * the accessible name, so the list says which kind of attention a project needs.
 */
function Signals({ summary }: { summary: TrackerSummary | undefined }) {
  if (!summary) return <span className="text-haze">—</span>;
  const marks: { key: string; tone: 'bad' | 'warn'; label: string; title: string }[] = [];
  if (summary.late) marks.push({ key: 'late', tone: 'bad', label: 'Late', title: summary.lateBecause ?? 'Late' });
  if (summary.waiting.length > 0) {
    marks.push({ key: 'waiting', tone: 'warn', label: 'Waiting', title: `Waiting on the client: ${summary.waiting.join(', ')}` });
  }
  if (summary.blocked.length > 0) {
    marks.push({
      key: 'blocked', tone: 'bad', label: 'Blocked',
      title: summary.blocked.map((b) => `${b.title}: ${b.reason ?? 'no reason'} → ${b.next ?? 'no next step'}`).join('; '),
    });
  }
  if (marks.length === 0) return <span className="text-haze">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {marks.map((m) => (
        <span key={m.key} title={m.title} aria-label={`${m.label}: ${m.title}`} data-signal={m.key}>
          <Badge tone={m.tone}>{m.label}</Badge>
        </span>
      ))}
    </span>
  );
}

/* ============================================================= the detail */

/**
 * ONE PROJECT.
 *
 * HEADER  who it is for, what, where it has got to, when it is due
 * MAIN    status and the close, the checkpoints, links, notes, activity
 * SIDE    the money, the hours, the dates, the deal it came from
 *
 * ## The close
 *
 * The Close button is enabled only when every checkpoint is done — and that is
 * a courtesy, not the rule. The rule is `project_close_rules` in the database,
 * which refuses the same close from anywhere else. The confetti fires only on
 * the success of THIS action (`closeProject` returns true only when a row
 * actually went from open to closed), never from rendering a closed project.
 */
export function ProjectDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const { reloadToken } = useScope();
  const mayEdit = canAccess(profile, 'manage_projects');

  const { project, milestones, contacts, costs, links, state, reload } = useProjectDetail(id, reloadToken);
  const templates = useCheckpointTemplates(reloadToken);
  const detail = useRecordDetail('project', state === 'ready' ? id ?? null : null, reloadToken);
  const notes = useNoteMutation('project', () => { void detail.reload(); });
  const ops = useOperationsMutations(() => { void reload(); void detail.reload(); });

  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [addingCost, setAddingCost] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const [checkpoint, setCheckpoint] = useState<Partial<Milestone> | null>(null);
  const [templateId, setTemplateId] = useState('');

  if (state === 'loading') {
    return (
      <Grid>
        <div className="col-span-12 grid gap-4 lg:col-span-8" aria-busy="true">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
        <Skeleton className="col-span-12 h-96 lg:col-span-4" />
      </Grid>
    );
  }

  if (state !== 'ready' || !project) {
    return (
      <Panel>
        <DataState
          kind={state === 'error' ? 'unavailable' : state === 'unconfigured' ? 'unconfigured' : 'empty'}
          title={state === 'error' ? 'Unavailable' : state === 'unconfigured' ? 'Not connected' : 'No such project'}
          body={state === 'error'
            ? 'The project could not be read right now.'
            : state === 'unconfigured'
              ? 'Supabase credentials are not set in this environment.'
              : 'This project does not exist, or this account may not read it.'}
          action={<Link to="/projects"><Button size="sm">All projects</Button></Link>}
        />
      </Panel>
    );
  }

  const closed = isClosedProject(project);
  const mayChange = mayEdit && !closed;
  // Impact: free, never billed, closed only with a market value on record
  // (projects_impact_free_check and project_close_rules). Same checkpoints,
  // templates, signals and close as a paid project otherwise.
  const impact = project.program === 'impact';
  // A monthly contract: billed by the month, no one-off value, and "closing"
  // is ending the contract — no checkpoint rule (project_close_rules).
  const monthly = isMonthly(project);
  const cancelled = project.status === 'cancelled';
  const summary = trackerOf(milestones, { target_date: project.target_date, closed });
  const primary = contacts.find((c) => c.is_primary) ?? contacts[0] ?? null;
  const spend = costTotal(costs, project.currency);
  const fin = financials({
    value: project.value,
    currency: project.currency,
    costs: spend,
    estimated_hours: project.estimated_hours,
    actual_hours: project.actual_hours,
  });
  const timeline = buildRecordTimeline(
    { at: project.created_at, title: 'Project created', detail: project.service ?? undefined },
    detail.notes,
    detail.log,
  );
  const targetTone = closed ? 'none' : dueTone(project.target_date);
  const settable = impact ? IMPACT_SETTABLE_STATES : SETTABLE_PROJECT_STATES;
  const impactBlockers = impact ? impactCloseBlockers(project, summary) : [];
  const closable = impact ? impactBlockers.length === 0 : monthly ? true : summary.closable;
  const listPath = impact ? (closed || cancelled ? '/impact?view=closed' : '/impact?view=active')
    : monthly ? '/projects?view=monthly'
    : closed ? '/projects?view=closed' : '/projects';
  const matched = matchTemplate(templates.live, project.service);
  const chosen = templates.live.find((t) => t.id === templateId) ?? matched;

  const submitNote = async () => {
    const problem = await notes.addNote(project.id, draft);
    setError(problem);
    if (!problem) setDraft('');
  };

  const close = async () => {
    setCloseError(null);
    const result = await ops.closeProject(project.id);
    // A delivered project is celebrated; an ended monthly contract is not.
    if (result === true) { if (!monthly) celebrate('project_closed', project.name); }
    else setCloseError(result);
  };

  const reopen = async () => {
    setCloseError(await ops.reopenProject(project.id));
  };

  const changeState = async (m: Milestone, next: string) => {
    // Blocked needs a reason and a next step; the dialog asks for both rather
    // than letting the database refuse a bare state change.
    if (next === 'blocked') { setCheckpoint({ ...m, state: 'blocked' }); return; }
    setError(await ops.saveMilestone(project.id, { id: m.id, title: m.title, state: next }));
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to={listPath} className="t-note inline-flex items-center gap-1.5 underline underline-offset-4 hover:text-paper">
          <ArrowLeft size={11} aria-hidden="true" /> {impact ? 'Impact projects' : monthly ? 'Monthly contracts' : closed ? 'Closed projects' : 'All projects'}
        </Link>
        <StatusPill tone={closed ? 'good' : projectStatusTone(project.status)}>
          {closed ? (monthly ? 'Ended' : 'Closed') : projectStatusLabel(project.status)}
        </StatusPill>
      </div>

      {/* ----------------------------------------------------- header */}
      <Panel
        aria-label="Project summary"
        className="grid grid-cols-2 divide-x divide-y divide-hairline bg-panel sm:grid-cols-4 xl:divide-y-0"
      >
        <div className="col-span-2 min-w-0 px-4 py-3.5">
          <p className="t-section">{impact ? 'Impact project · free' : monthly ? 'Monthly contract' : 'Project'}</p>
          <p className="mt-1.5 break-words text-lg leading-tight text-paper">{project.name}</p>
          <p className="t-note mt-1">
            {project.client
              ? <Link to={`/clients/${project.client.id}`} className="underline underline-offset-4 hover:text-paper">
                  {project.client.name}
                </Link>
              : 'No client'}
            {project.service ? ` · ${project.service}` : ''}
          </p>
          <p className="t-note mt-1">
            {primary
              ? <>{primary.name}{primary.email ? ` · ${primary.email}` : ''}{primary.phone ? ` · ${primary.phone}` : ''}</>
              : 'No contact recorded for this client'}
          </p>
        </div>
        <div className="min-w-0 px-4 py-3.5">
          <p className="t-section">Checkpoints</p>
          {summary.total === 0 ? (
            <p className="mt-1.5"><NotRecorded what="Checkpoints" /></p>
          ) : (
            <>
              <p className="t-metric mt-1.5">{summary.done}/{summary.total}</p>
              <p className="t-note mt-1 truncate">
                {closed ? 'all done' : summary.current ? `now: ${summary.current}` : 'all done'}
              </p>
            </>
          )}
        </div>
        {monthly ? (
        <div className="min-w-0 px-4 py-3.5">
          <p className="t-section">Monthly fee</p>
          <p className="num mt-1.5 text-xl leading-none text-paper" data-figure="monthly-fee">
            {project.monthly_fee === null ? '—' : money(project.monthly_fee, project.currency)}
          </p>
          <p className="t-note mt-1">
            {closed
              ? `ended ${shortDate(project.completed_at)}`
              : `${project.start_date ? `since ${shortDate(project.start_date)}` : 'no start date'} · ${
                project.target_date ? `ends ${shortDate(project.target_date)}` : 'open-ended'}`}
          </p>
        </div>
        ) : (
        <div className="min-w-0 px-4 py-3.5">
          <p className="t-section">{closed ? 'Closed' : 'Deadline'}</p>
          <p className={cn(
            'num mt-1.5 text-xl leading-none',
            targetTone === 'overdue' ? 'text-danger' : targetTone === 'today' ? 'text-signal' : 'text-paper',
          )}>
            {closed ? shortDate(project.completed_at) : project.target_date ? shortDate(project.target_date) : '—'}
          </p>
          <p className="t-note mt-1">
            {closed
              ? `deadline was ${shortDate(project.target_date)}`
              : targetTone === 'overdue' ? 'this date has passed'
                : project.start_date ? `started ${shortDate(project.start_date)}` : 'no start date'}
          </p>
        </div>
        )}
      </Panel>

      <Grid>
        <div className="col-span-12 grid min-w-0 gap-4 lg:col-span-8">
          {/* ---------------------------------------------- the close */}
          <Panel aria-label="Delivery status">
            <SectionHeader
              title={closed ? (monthly ? 'Contract ended' : 'Closed') : monthly ? 'Contract status' : 'Delivery status'}
              note={closed ? `on ${shortDate(project.completed_at)}` : undefined}
              action={mayEdit ? (
                closed ? (
                  <Button size="sm" onClick={reopen} disabled={ops.busy === project.id}>
                    <RotateCcw size={11} aria-hidden="true" /> Reopen
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={close}
                    disabled={!closable || cancelled || ops.busy === project.id}
                    aria-describedby="close-rule"
                  >
                    <Check size={11} aria-hidden="true" /> {monthly ? 'End contract' : 'Close project'}
                  </Button>
                )
              ) : undefined}
            />
            <div className="grid gap-2 px-4 py-3">
              {closed && monthly ? (
                <p className="text-xs text-haze">
                  This monthly contract has ended and no longer counts in the monthly fees. Payments
                  that arrive later are still recorded in its payment schedule. Reopen it to resume it.
                </p>
              ) : closed ? (
                <p className="text-xs text-haze">
                  Every checkpoint was done when this project was closed. Reopen it to change its
                  checkpoints. Closing says nothing about payment, and does not archive it.
                </p>
              ) : (
                <>
                  <p id="close-rule" className="t-note">
                    {monthly
                      ? 'A monthly contract runs until it is ended. Ending it takes it out of the monthly fees; it can be reopened. Checkpoints are optional here — use them for recurring deliverables if they help.'
                      : impact && cancelled
                      ? 'This Impact project is cancelled: it counts as neither committed nor delivered support. Set another state to resume it.'
                      : impact && impactBlockers.length > 0
                      ? `Before this Impact project can be closed it needs: ${impactBlockers.join('; ')}.`
                      : impact
                      ? 'Every checkpoint is done and the market value is recorded. Closing moves it to delivered support; it can be reopened.'
                      : summary.closable
                      ? 'Every checkpoint is done. Closing moves the project to Closed; it can be reopened. Payment is tracked separately.'
                      : summary.total === 0
                        ? 'A project is closed after its last checkpoint is done. This one has no checkpoints yet — add at least one.'
                        : `${summary.total - summary.done} of ${summary.total} checkpoints still open. The project can be closed once they are all done.`}
                  </p>
                  {!summary.late && summary.waiting.length === 0 && summary.blocked.length === 0 && (
                    <p className="text-xs text-haze">Nothing late, nothing waiting, nothing blocked.</p>
                  )}
                  {summary.late && (
                    <p className="text-xs text-danger" data-signal="late"><Badge tone="bad">Late</Badge> {summary.lateBecause}</p>
                  )}
                  {summary.waiting.length > 0 && (
                    <p className="text-xs text-signal" data-signal="waiting">
                      <Badge tone="warn">Waiting on client</Badge> {summary.waiting.join(', ')}
                    </p>
                  )}
                  {summary.blocked.map((b) => (
                    <div key={b.title} className="rounded-sm border border-danger/30 px-3 py-2" data-signal="blocked">
                      <p className="text-xs text-paper"><Badge tone="bad">Blocked</Badge> {b.title}</p>
                      <p className="t-note mt-1">Why: {b.reason ?? '—'}</p>
                      <p className="t-note">Next: {b.next ?? '—'}</p>
                    </div>
                  ))}
                </>
              )}
              {closeError && <p role="alert" className="text-xs text-danger">{closeError}</p>}
            </div>
          </Panel>

          {/* ------------------------------------------- checkpoints */}
          <Panel className="min-w-0">
            <SectionHeader
              title="Checkpoints"
              note={summary.total > 0 ? `${summary.done}/${summary.total}` : 'none yet'}
              action={mayChange
                ? <Button size="sm" variant="quiet" onClick={() => setCheckpoint({ position: milestones.length, state: 'pending' })}>
                    <Plus size={11} aria-hidden="true" /> Add checkpoint
                  </Button>
                : undefined}
            />
            {milestones.length === 0 ? (
              <div className="grid gap-2 px-4 py-4">
                <p className="text-xs text-haze">
                  No checkpoints. Start from a template — its steps are copied into this project, so
                  editing the template later never changes them — or add them one by one.
                </p>
                {mayChange && templates.live.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor="apply-template">Template</label>
                    <Select id="apply-template" value={chosen?.id ?? ''} onChange={(e) => setTemplateId(e.target.value)}>
                      {templates.live.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.steps.length} steps){t.id === matched?.id ? ' — matches the service' : ''}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      disabled={!chosen || ops.busy === 'milestone'}
                      onClick={async () => { if (chosen) setError(await ops.applyTemplate(project.id, chosen.steps)); }}
                    >
                      Add these steps
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <ul className="grid">
                {milestones.map((m) => (
                  <CheckpointRow
                    key={m.id}
                    checkpoint={m}
                    mayEdit={mayChange}
                    onState={(next) => void changeState(m, next)}
                    onEdit={() => setCheckpoint(m)}
                    onRemove={async () => setError(await ops.removeMilestone(m.id))}
                  />
                ))}
              </ul>
            )}
            {closed && milestones.length > 0 && (
              <p className="t-note border-t border-hairline px-4 py-2">Checkpoints are frozen while the project is closed.</p>
            )}
            {error && <p role="alert" className="border-t border-hairline px-4 py-2 text-xs text-danger">{error}</p>}
          </Panel>

          {/* -------------------------------------------- documents */}
          {/* The project's folder in the document library — the same rows the
              Documents screen reads, not a copy. Closing, reopening or
              archiving the project never moves or removes a file. */}
          {canAccess(profile, 'view_documents') && (
            <div className="grid gap-1">
              <ProjectLibrary projectId={project.id} reloadToken={reloadToken} compact />
              <Link to={`/documents/${project.id}`} className="t-note justify-self-end underline underline-offset-4 hover:text-paper">
                Open in Documents
              </Link>
            </div>
          )}

          {/* ------------------------------------ client portal view */}
          {/* Demo links and meetings the project's assigned client sees. */}
          {canAccess(profile, 'manage_client_accounts') && (
            <ClientViewPanel projectId={project.id} projectName={project.name} />
          )}

          {/* ------------------------------------------------ links */}
          <Panel>
            <SectionHeader
              title="Links"
              action={mayEdit
                ? <Button size="sm" variant="quiet" onClick={() => setAddingLink(true)}>
                    <Plus size={11} aria-hidden="true" /> Add
                  </Button>
                : undefined}
            />
            {links.length === 0 ? (
              <p className="px-4 py-3 text-xs text-haze">
                No links. The live site, the staging URL, the repository, the design file — anything
                with an http or https address.
              </p>
            ) : (
              <ul className="grid">
                {links.map((link) => (
                  /*
                   * `safeUrl(...)` is called twice rather than hoisted into a
                   * local, and that is deliberate: `tests/portal.spec.ts` → "no
                   * link is built from a stored value without a fixed scheme" is
                   * a LEXICAL check of every `href={…}`, and a hoisted `const
                   * href` would hide the call from it. Same idiom as
                   * `pages/clients.tsx` and `pages/screens.tsx`.
                   */
                  <li key={link.id} className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2 last:border-0">
                      <div className="min-w-0">
                        <p className="text-[13px] text-paper">{link.label}</p>
                        {safeUrl(link.url) ? (
                          <a
                            href={safeUrl(link.url)!}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="block break-all text-[11px] text-haze underline underline-offset-4 hover:text-paper"
                          >
                            {link.url}
                          </a>
                        ) : (
                          <span className="block break-all text-[11px] text-danger">{link.url}</span>
                        )}
                      </div>
                      {mayEdit && (
                        <Button size="sm" variant="quiet" onClick={() => void ops.removeLink(link.id)}
                                aria-label={`Remove ${link.label}`}>
                          <Trash2 size={11} aria-hidden="true" />
                        </Button>
                      )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* ------------------------------------------------ notes */}
          <Panel>
            <SectionHeader title="Notes" note={detail.notes.length > 0 ? `${detail.notes.length}` : undefined} />
            {mayEdit && (
              <div className="border-b border-hairline px-4 py-3">
                <label className="sr-only" htmlFor="project-note">Add a note</label>
                <Textarea id="project-note" value={draft} onChange={(e) => setDraft(e.target.value)}
                          placeholder="What changed, what is blocked, what was agreed."
                          className="min-h-20 text-[13px]" />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span />
                  <Button size="sm" variant="primary" onClick={submitNote} disabled={notes.busy}>Add note</Button>
                </div>
              </div>
            )}
            {detail.notes.length === 0 ? (
              <p className="px-4 py-3 text-xs text-haze">No notes yet.</p>
            ) : (
              <ul className="grid">
                {detail.notes.map((note) => (
                  <li key={note.id} className="border-b border-hairline px-4 py-3 last:border-0">
                    <p className="whitespace-pre-wrap text-[13px] text-paper">{note.body}</p>
                    <p className="t-note mt-1">
                      {note.author?.full_name || note.author?.email || 'Unknown'} · {formatWhen(note.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* --------------------------------------------- activity */}
          <Panel>
            <SectionHeader title="Activity" note="only what was recorded" />
            <ol className="grid">
              {timeline.map((entry) => (
                <li key={entry.id} className="flex gap-3 border-b border-hairline px-4 py-2.5 last:border-0">
                  <span className={cn('mt-1.5 h-1 w-1 shrink-0 rounded-full',
                    entry.kind === 'money' ? 'bg-signal' : 'bg-chrome/40')} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-paper">{entry.title}</p>
                    {entry.detail && <p className="mt-0.5 break-words text-[11px] text-haze">{entry.detail}</p>}
                    <p className="t-note">{formatWhen(entry.at)}{entry.by ? ` · ${entry.by}` : ''}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        {/* ------------------------------------------------- the rail */}
        <div className="col-span-12 grid min-w-0 gap-4 lg:col-span-4">
          <ContactsPanel contacts={contacts} clientId={project.client?.id ?? null} />

          {impact
            ? <MarketValuePanel project={project} mayEdit={mayEdit} onSaved={() => { void reload(); void detail.reload(); }} />
            : <>
                {/* The schedule is the only place payment is recorded. It stays
                    editable on a closed project: money that arrives after the
                    handover is recorded like any other. */}
                <PaymentSchedule
                  projectId={project.id}
                  currency={project.currency}
                  contracted={project.value}
                  monthlyFee={monthly ? project.monthly_fee : null}
                  mayEdit={mayEdit}
                  onChanged={() => { void reload(); void detail.reload(); }}
                />
                {monthly
                  ? <MonthlyFeePanel project={project} spend={spend} costCount={costs.length} />
                  : <Profitability project={project} fin={fin} costCount={costs.length} />}
              </>}

          <Panel>
            <SectionHeader
              title="Costs"
              note={costs.length > 0 ? `${costs.length}` : undefined}
              action={mayEdit
                ? <Button size="sm" variant="quiet" onClick={() => setAddingCost(true)}>
                    <Plus size={11} aria-hidden="true" /> Add
                  </Button>
                : undefined}
            />
            {costs.length === 0 ? (
              <p className="px-4 py-3 text-xs text-haze">
                {impact
                  ? 'No internal costs recorded. Free to the client is not free to deliver — what it cost us to do goes here.'
                  : monthly
                  ? 'No direct costs recorded. Subcontractors, ad tools, software — whatever this contract costs to run goes here.'
                  : 'No direct costs recorded. Contribution cannot be calculated until at least one is — a project with no recorded costs is not a project that cost nothing.'}
              </p>
            ) : (
              <ul className="grid">
                {costs.map((cost) => (
                  <li key={cost.id} className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-2 last:border-0">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] text-paper">{cost.description}</p>
                      <p className="t-note">
                        {COST_LABEL[cost.category] ?? cost.category} · {shortDate(cost.incurred_on)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="num text-[12px] text-paper">{money(cost.amount, cost.currency)}</span>
                      {mayEdit && (
                        <Button size="sm" variant="quiet" onClick={() => void ops.removeCost(cost.id)}
                                aria-label={`Remove ${cost.description}`}>
                          <Trash2 size={11} aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <SectionHeader
              title="Project"
              action={mayEdit ? <Button size="sm" onClick={() => setEditing(true)}>Edit</Button> : undefined}
            />
            <dl className="grid">
              <DataLine
                term="Status"
                value={mayChange ? (
                  <>
                    <label className="sr-only" htmlFor="project-detail-status">Project status</label>
                    <Select
                      id="project-detail-status"
                      className="w-full"
                      value={(settable as readonly string[]).includes(project.status) ? project.status : ''}
                      onChange={(e) => void ops.updateProject(project.id, { status: e.target.value })}
                    >
                      {/* A pre-P2 phase value is offered as its own disabled
                          option so the control shows the truth rather than
                          silently claiming the project is "Planned". Closed is
                          not offered: it is the Close action's alone. */}
                      {!(settable as readonly string[]).includes(project.status) && (
                        <option value="" disabled>{projectStatusLabel(project.status)} (legacy)</option>
                      )}
                      {settable.map((s) => <option key={s} value={s}>{PROJECT_STATUS[s].label}</option>)}
                    </Select>
                  </>
                ) : closed ? 'Closed' : projectStatusLabel(project.status)}
              />
              {impact && <DataLine term="Programme" value={<Badge tone="good">Impact · free</Badge>} note="no fee, invoice or payment" />}
              {monthly && <DataLine term="Billing" value={<Badge tone="neutral">Monthly contract</Badge>} note="billed by the month" />}
              <DataLine term="Service" value={project.service || <NotRecorded />} />
              <DataLine
                term="Responsible"
                value={project.responsible?.full_name || project.responsible?.email
                  || <NotRecorded what="Responsible" />}
              />
              <DataLine term="Started" value={<span className="num text-[11px]">{shortDate(project.start_date)}</span>} />
              <DataLine
                term={monthly ? 'Contract end' : 'Deadline'}
                value={<span className="num text-[11px]">{monthly && !project.target_date ? 'open-ended' : shortDate(project.target_date)}</span>}
              />
              {project.completed_at && (
                <DataLine term={monthly ? 'Ended' : 'Closed'} value={<span className="num text-[11px]">{shortDate(project.completed_at)}</span>} />
              )}
              {!impact && <DataLine
                term="Opportunity"
                value={project.opportunity_id
                  ? <Link to={`/sales/${project.opportunity_id}`} className="underline underline-offset-4 hover:text-signal">
                      The deal that sold this
                    </Link>
                  : <span className="text-haze">Not linked</span>}
              />}
              {!impact && <DataLine
                term="Payment"
                value={<Badge tone={project.payment_state === 'paid' ? 'good' : 'neutral'}>
                  {PAYMENT_LABEL[project.payment_state] ?? project.payment_state}
                </Badge>}
                note={project.paid_amount !== null
                  ? `${money(project.paid_amount, project.currency)} received · from the payment schedule`
                  : 'from the payment schedule'}
              />}
            </dl>
            <p className="t-note border-t border-hairline px-4 py-2">
              {impact
                ? 'An Impact project is free, always: the database refuses a fee, an invoice, a payment or a sale on it.'
                : monthly
                ? 'The monthly fee is what was agreed, not cash received. Record each month as an instalment in the payment schedule, and the payments against it.'
                : 'Agreed value is not cash received. What has actually arrived is recorded in the payment schedule — the payment state follows it, and neither is required to close the project.'}
            </p>
          </Panel>
        </div>
      </Grid>

      {mayEdit && editing && (
        <EditProjectDialog project={project} onClose={() => setEditing(false)} onSaved={reload} />
      )}
      {mayEdit && addingCost && (
        <CostDialog project={project} onClose={() => setAddingCost(false)} onSaved={() => { setAddingCost(false); void reload(); }} />
      )}
      {mayEdit && addingLink && (
        <LinkDialog projectId={project.id} onClose={() => setAddingLink(false)} onSaved={() => { setAddingLink(false); void reload(); }} />
      )}
      {mayChange && checkpoint && (
        <CheckpointDialog
          projectId={project.id}
          initial={checkpoint}
          onClose={() => setCheckpoint(null)}
          onSaved={() => { setCheckpoint(null); void reload(); }}
        />
      )}
    </div>
  );
}

/** Who the project is for: every contact of its client, primary first. */
function ContactsPanel({ contacts, clientId }: { contacts: ClientContact[]; clientId: string | null }) {
  return (
    <Panel>
      <SectionHeader
        title="Contacts"
        note={contacts.length > 0 ? `${contacts.length}` : undefined}
        action={clientId ? <Link to={`/clients/${clientId}`} className="t-note underline underline-offset-4 hover:text-paper">Client</Link> : undefined}
      />
      {contacts.length === 0 ? (
        <p className="px-4 py-3 text-xs text-haze">No contacts recorded. Add them on the client.</p>
      ) : (
        <ul className="grid">
          {contacts.map((c) => (
            <li key={c.id} className="border-b border-hairline px-4 py-2 last:border-0">
              <p className="text-[13px] text-paper">
                {c.name} {c.is_primary && <Badge tone="good">Primary</Badge>}
              </p>
              <p className="t-note break-words">{[c.role, c.email, c.phone].filter(Boolean).join(' · ') || '—'}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* =========================================================== checkpoints == */

const STATE_DOT: Record<string, string> = {
  done: 'bg-good',
  blocked: 'bg-danger',
  waiting_client: 'bg-signal',
  in_progress: 'bg-paper',
  pending: 'bg-chrome/30',
};

function CheckpointRow({
  checkpoint: m, mayEdit, onState, onEdit, onRemove,
}: {
  checkpoint: Milestone;
  mayEdit: boolean;
  onState: (next: string) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const tone = m.state === 'done' ? 'none' : dueTone(m.due_on);
  const meta = [m.assignee, m.due_on ? `due ${shortDate(m.due_on)}` : null].filter(Boolean).join(' · ');

  return (
    <li className="border-b border-hairline px-4 py-2.5 last:border-0" data-checkpoint={m.state}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATE_DOT[m.state] ?? 'bg-chrome/30')} aria-hidden="true" />
        <span className={cn('min-w-0 flex-1 text-[13px]', m.state === 'done' ? 'text-haze line-through' : 'text-paper')}>
          {m.title}
        </span>
        {meta && (
          <span className={cn('num text-[10px]', tone === 'overdue' ? 'text-danger' : tone === 'today' ? 'text-signal' : 'text-haze')}>
            {meta}
          </span>
        )}
        {mayEdit ? (
          <>
            <label className="sr-only" htmlFor={`cp-${m.id}`}>State for {m.title}</label>
            <Select id={`cp-${m.id}`} value={m.state} onChange={(e) => onState(e.target.value)}>
              {MILESTONE_STATES.map((s) => <option key={s} value={s}>{MILESTONE_LABEL[s]}</option>)}
            </Select>
            <Button size="sm" variant="quiet" onClick={onEdit} aria-label={`Edit ${m.title}`}>
              <Pencil size={11} aria-hidden="true" />
            </Button>
            <Button size="sm" variant="quiet" onClick={onRemove} aria-label={`Remove ${m.title}`}>
              <Trash2 size={11} aria-hidden="true" />
            </Button>
          </>
        ) : (
          <Badge tone={m.state === 'done' ? 'good' : m.state === 'blocked' ? 'bad' : m.state === 'waiting_client' ? 'warn' : 'neutral'}>
            {MILESTONE_LABEL[m.state] ?? m.state}
          </Badge>
        )}
      </div>
      {m.state === 'blocked' && (
        <div className="ml-4 mt-1.5 rounded-sm border border-danger/30 px-3 py-1.5">
          <p className="text-[11px] text-paper">Why: {m.blocked_reason || '—'}</p>
          <p className="text-[11px] text-haze">Next: {m.next_step || '—'}</p>
        </div>
      )}
      {m.state !== 'blocked' && m.next_step && m.state !== 'done' && (
        <p className="ml-4 mt-1 text-[11px] text-haze">Next: {m.next_step}</p>
      )}
      {m.note && <p className="ml-4 mt-1 whitespace-pre-wrap text-[11px] text-haze">{m.note}</p>}
    </li>
  );
}

/**
 * Add or edit a checkpoint. Blocked asks for a reason and a next step and will
 * not save without both — the same rule the database enforces.
 */
function CheckpointDialog({
  projectId, initial, onClose, onSaved,
}: { projectId: string; initial: Partial<Milestone>; onClose: () => void; onSaved: () => void }) {
  const ops = useOperationsMutations(onSaved);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: initial.title ?? '',
    state: initial.state ?? 'pending',
    assignee: initial.assignee ?? '',
    due_on: initial.due_on ?? '',
    note: initial.note ?? '',
    blocked_reason: initial.blocked_reason ?? '',
    next_step: initial.next_step ?? '',
  });
  const blocked = form.state === 'blocked';
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((p) => ({ ...p, [key]: e.target.value }));

  const submit = async () => {
    if (blocked && (!form.blocked_reason.trim() || !form.next_step.trim())) {
      setError('A blocked checkpoint needs a reason and a next step.');
      return;
    }
    const problem = await ops.saveMilestone(projectId, {
      ...(initial.id ? { id: initial.id } : { position: initial.position ?? 0 }),
      title: form.title.trim(),
      state: form.state,
      assignee: form.assignee.trim() || null,
      due_on: form.due_on || null,
      note: form.note.trim() || null,
      blocked_reason: blocked ? form.blocked_reason.trim() : null,
      next_step: form.next_step.trim() || null,
    });
    if (problem) { setError(problem); return; }
    onSaved();
  };

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={initial.id ? 'Edit checkpoint' : 'Add a checkpoint'}
      footer={
        <>
          <Button size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={ops.busy === 'milestone'}>Save</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field id="cp-title" label="Checkpoint">
          <Input id="cp-title" value={form.title} onChange={set('title')} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="cp-state" label="State">
            <Select id="cp-state" className="w-full py-2.5 text-sm" value={form.state} onChange={set('state')}>
              {MILESTONE_STATES.map((s) => <option key={s} value={s}>{MILESTONE_LABEL[s]}</option>)}
            </Select>
          </Field>
          <Field id="cp-assignee" label="Responsible" hint="Stratos, the client, a collaborator.">
            <Input id="cp-assignee" value={form.assignee} onChange={set('assignee')} />
          </Field>
          <Field id="cp-due" label="Due">
            <Input id="cp-due" type="date" value={form.due_on} onChange={set('due_on')} />
          </Field>
        </div>
        {blocked && (
          <Field id="cp-reason" label="Why is it blocked? (required)">
            <Textarea id="cp-reason" value={form.blocked_reason} onChange={set('blocked_reason')}
                      aria-required="true" invalid={Boolean(error) && !form.blocked_reason.trim()} />
          </Field>
        )}
        <Field id="cp-next" label={blocked ? 'Next step (required)' : 'Next step'}>
          <Input id="cp-next" value={form.next_step} onChange={set('next_step')}
                 aria-required={blocked ? 'true' : undefined}
                 invalid={blocked && Boolean(error) && !form.next_step.trim()} />
        </Field>
        <Field id="cp-note" label="Note">
          <Textarea id="cp-note" value={form.note} onChange={set('note')} />
        </Field>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

/* ============================================================= templates == */

/**
 * The owner's checkpoint templates. Editing one changes what NEW projects start
 * from; the checkpoints of existing projects were copied and are untouched.
 */
export function ProjectTemplatesScreen() {
  const { reloadToken } = useScope();
  const { rows, state, message, reload } = useCheckpointTemplates(reloadToken);
  const ops = useOperationsMutations(() => { void reload(); });
  const [editing, setEditing] = useState<Partial<CheckpointTemplate> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = rows.filter((t) => !t.archived_at);
  const retired = rows.filter((t) => t.archived_at);

  const list = (items: CheckpointTemplate[], archived: boolean) => (
    <ul className="grid">
      {items.map((t) => (
        <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-4 py-3 last:border-0">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-paper">{t.name} <span className="t-note">· {t.steps.length} steps</span></p>
            <p className="t-note mt-0.5">
              {t.service_keywords.length > 0 ? `Matches: ${t.service_keywords.join(', ')}` : 'Fallback — used when no other template matches'}
            </p>
            <p className="mt-1 break-words text-[11px] text-haze">{t.steps.join(' → ')}</p>
          </div>
          <div className="flex shrink-0 gap-1">
            {!archived && <Button size="sm" onClick={() => setEditing(t)}>Edit</Button>}
            <Button size="sm" variant="quiet" onClick={async () => setError(await ops.archiveTemplate(t.id, !archived))}>
              {archived ? 'Restore' : 'Retire'}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/projects" className="t-note inline-flex items-center gap-1.5 underline underline-offset-4 hover:text-paper">
          <ArrowLeft size={11} aria-hidden="true" /> All projects
        </Link>
        <Button size="sm" variant="primary" onClick={() => setEditing({ position: (live[live.length - 1]?.position ?? 0) + 10 })}>
          <Plus size={12} aria-hidden="true" /> New template
        </Button>
      </div>
      <Panel>
        <SectionHeader title="Checkpoint templates" note="copied into a project when used — editing one never changes an existing project" />
        {state === 'loading' && <div className="p-4"><Skeleton className="h-24 w-full" /></div>}
        {state === 'error' && <ErrorState message={message} onRetry={reload} />}
        {state === 'unconfigured' && <DataState kind="unconfigured" title="Not connected" />}
        {state === 'ready' && live.length === 0 && <DataState kind="empty" title="No templates" body="Add one per kind of work you deliver." />}
        {state === 'ready' && live.length > 0 && list(live, false)}
        {error && <p role="alert" className="border-t border-hairline px-4 py-2 text-xs text-danger">{error}</p>}
      </Panel>
      {retired.length > 0 && (
        <Panel>
          <SectionHeader title="Retired" note={`${retired.length}`} />
          {list(retired, true)}
        </Panel>
      )}
      {editing && (
        <TemplateDialog
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }}
        />
      )}
    </div>
  );
}

function TemplateDialog({
  initial, onClose, onSaved,
}: { initial: Partial<CheckpointTemplate>; onClose: () => void; onSaved: () => void }) {
  const ops = useOperationsMutations(onSaved);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: initial.name ?? '',
    keywords: (initial.service_keywords ?? []).join(', '),
    steps: (initial.steps ?? []).join('\n'),
    position: String(initial.position ?? 0),
  });

  const submit = async () => {
    const steps = form.steps.split('\n').map((s) => s.trim()).filter(Boolean);
    const problem = await ops.saveTemplate({
      ...(initial.id ? { id: initial.id } : {}),
      name: form.name.trim(),
      service_keywords: form.keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean),
      steps,
      position: Number.parseInt(form.position, 10) || 0,
    });
    if (problem) { setError(problem); return; }
    onSaved();
  };

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={initial.id ? 'Edit template' : 'New template'}
      description="Projects that already started from this template keep their own checkpoints."
      footer={
        <>
          <Button size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={ops.busy === 'template'}>Save</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Field id="tpl-name" label="Name">
              <Input id="tpl-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            </Field>
          </div>
          <Field id="tpl-position" label="Order">
            <Input id="tpl-position" inputMode="numeric" value={form.position}
                   onChange={(e) => setForm((p) => ({ ...p, position: e.target.value }))} />
          </Field>
        </div>
        <Field id="tpl-keywords" label="Service keywords" hint="Comma-separated. Matched inside the project's service. Leave empty for a fallback.">
          <Input id="tpl-keywords" value={form.keywords} onChange={(e) => setForm((p) => ({ ...p, keywords: e.target.value }))} />
        </Field>
        <Field id="tpl-steps" label="Steps" hint="One per line, in order. 1–40 steps.">
          <Textarea id="tpl-steps" className="min-h-40" value={form.steps}
                    onChange={(e) => setForm((p) => ({ ...p, steps: e.target.value }))} />
        </Field>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

/* =============================================================== dialogs == */

/**
 * A project needs a client (§54). There is no orphan-project path.
 *
 * One-off or monthly is chosen here and fixed from then on
 * (`project_billing_fixed`). A monthly contract takes a monthly fee instead of
 * a project value, and starts without checkpoints unless one is chosen.
 */
function NewProjectDialog({
  onClose, onCreated, presetClient, monthly: startMonthly = false,
}: { onClose: () => void; onCreated: (id: string) => void; presetClient?: string; monthly?: boolean }) {
  const clients = useClients();
  const templates = useCheckpointTemplates();
  const ops = useOperationsMutations(() => {});
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    organization_id: presetClient ?? '',
    name: '',
    service: '',
    value: '',
    currency: 'HUF',
    status: 'planned',
    start_date: new Date().toISOString().slice(0, 10),
    target_date: '',
    estimated_hours: '',
    // '' = follow the service; 'none' = no checkpoints; otherwise a template id.
    template: startMonthly ? 'none' : '',
    billing: (startMonthly ? 'monthly' : 'one_off') as 'one_off' | 'monthly',
    monthly_fee: '',
  });
  const monthly = form.billing === 'monthly';

  const matched = matchTemplate(templates.live, form.service);
  const chosen = form.template === 'none' ? null
    : templates.live.find((t) => t.id === form.template) ?? matched;
  // If the templates could not be read, the shipped list is still a sane start.
  const steps = chosen?.steps ?? (form.template === 'none' || templates.state !== 'error' ? [] : templateFor(form.service).steps);

  const submit = async () => {
    if (!form.organization_id) { setError('A project needs a client.'); return; }
    if (!form.name.trim()) { setError('A project needs a name.'); return; }
    const raw = monthly ? '' : form.value.trim();
    const value = raw === '' ? null : Number(raw.replace(/\s/g, '').replace(',', '.'));
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setError('The value must be a number, and not a negative one.'); return;
    }
    const rawFee = form.monthly_fee.trim();
    const fee = monthly ? Number(rawFee.replace(/\s/g, '').replace(',', '.')) : null;
    if (monthly && (rawFee === '' || !Number.isFinite(fee) || (fee ?? 0) <= 0)) {
      setError('A monthly contract needs a monthly fee greater than zero.'); return;
    }
    const hours = form.estimated_hours.trim();
    const estimated = hours === '' ? null : Number(hours);
    if (estimated !== null && (!Number.isFinite(estimated) || estimated < 0)) {
      setError('Estimated hours must be a non-negative number.'); return;
    }

    const result = await ops.createProject({
      organization_id: form.organization_id,
      name: form.name.trim(),
      slug: uniqueSlug(form.name, []),
      service: form.service.trim() || null,
      status: form.status,
      value,
      currency: form.currency,
      start_date: form.start_date || null,
      target_date: form.target_date || null,
      estimated_hours: estimated,
      billing: form.billing,
      monthly_fee: fee,
    }, steps);

    if (typeof result === 'string') { setError(result); return; }
    onCreated(result.id);
  };

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={monthly ? 'New monthly contract' : 'New project'}
      description={monthly
        ? 'Ongoing work billed by the month. It is listed and totalled under Monthly contracts, apart from one-off projects.'
        : 'The preferred route is from a won opportunity, which keeps the delivery connected to what sold it. This is for work that did not come through the pipeline.'}
      footer={
        <>
          <Button size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={ops.busy === 'project'}>Create</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field id="np-client" label="Client">
          <Select id="np-client" className="w-full py-2.5 text-sm" value={form.organization_id}
                  onChange={(e) => setForm((p) => ({ ...p, organization_id: e.target.value }))}>
            <option value="">Choose a client…</option>
            {clients.rows.filter((c) => !c.archived_at).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>

        <Field id="np-billing" label="Billing" hint="Fixed once the project is created.">
          <Select id="np-billing" className="w-full py-2.5 text-sm" value={form.billing}
                  onChange={(e) => {
                    const next = e.target.value as 'one_off' | 'monthly';
                    setForm((p) => ({ ...p, billing: next, template: next === 'monthly' ? 'none' : '' }));
                  }}>
            <option value="one_off">One-off project — a price, delivered once</option>
            <option value="monthly">Monthly contract — a monthly fee, runs until ended</option>
          </Select>
        </Field>

        <Field id="np-name" label={monthly ? 'Contract name' : 'Project name'}>
          <Input id="np-name" value={form.name}
                 onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="np-service" label="Service">
            <Input id="np-service" value={form.service}
                   onChange={(e) => setForm((p) => ({ ...p, service: e.target.value }))}
                   placeholder="Website, Ads, Branding…" />
          </Field>
          {monthly ? (
            <Field id="np-fee" label="Monthly fee">
              <Input id="np-fee" inputMode="numeric" value={form.monthly_fee} aria-required="true"
                     onChange={(e) => setForm((p) => ({ ...p, monthly_fee: e.target.value }))}
                     placeholder="e.g. 150 000" />
            </Field>
          ) : (
            <Field id="np-value" label="Value">
              <Input id="np-value" inputMode="numeric" value={form.value}
                     onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))} />
            </Field>
          )}
          <Field id="np-currency" label="Currency">
            <Select id="np-currency" className="w-full py-2.5 text-sm" value={form.currency}
                    onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="np-start" label="Start">
            <Input id="np-start" type="date" value={form.start_date}
                   onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))} />
          </Field>
          <Field id="np-target" label={monthly ? 'Contract end' : 'Deadline'} hint={monthly ? 'Leave empty if open-ended.' : undefined}>
            <Input id="np-target" type="date" value={form.target_date}
                   onChange={(e) => setForm((p) => ({ ...p, target_date: e.target.value }))} />
          </Field>
          <Field id="np-hours" label="Estimated hours">
            <Input id="np-hours" inputMode="numeric" value={form.estimated_hours}
                   onChange={(e) => setForm((p) => ({ ...p, estimated_hours: e.target.value }))} />
          </Field>
        </div>

        <Field id="np-template" label="Checkpoints" hint="Copied into the project. Everything is editable afterwards.">
          <Select id="np-template" className="w-full py-2.5 text-sm" value={form.template}
                  onChange={(e) => setForm((p) => ({ ...p, template: e.target.value }))}>
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

/* ======================================================== profitability == */

/**
 * The management figures (§30, §31), and the labels are exact.
 *
 * `Contribution`, not profit. `Direct costs`, not costs. `Revenue per hour`, not
 * rate. §65 forbids claiming profit, EBITDA, net income or recognised revenue,
 * and nothing here comes close: there is no overhead, no salary and no tax in
 * this system, so a "profit" figure would be a value minus some of its costs
 * presented as if it were all of them.
 *
 * When the inputs are incomplete the whole block is drawn quietly and every
 * missing figure says `Not recorded`.
 */
function Profitability({
  project, fin, costCount,
}: { project: Project; fin: ReturnType<typeof financials>; costCount: number }) {
  const value = (amount: number | null, tone?: string) =>
    amount === null
      ? <NotRecorded />
      : <span className={cn('num', tone)}>{money(amount, project.currency)}</span>;

  return (
    <Panel className={cn(!fin.complete && 'opacity-95')}>
      <SectionHeader
        title="Contribution"
        note={fin.complete ? 'management figures' : 'incomplete'}
      />
      <dl className="grid">
        <DataLine term="Project value" value={value(fin.value)} />
        <DataLine
          term="Direct costs"
          value={value(fin.costs)}
          note={costCount > 0 ? `${costCount} recorded` : 'none recorded'}
        />
        <DataLine
          term="Contribution"
          value={value(fin.contribution, fin.contribution !== null && fin.contribution < 0 ? 'text-danger' : 'text-chrome')}
          note="value − direct costs"
        />
        <DataLine
          term="Margin"
          value={fin.margin === null ? <NotRecorded /> : <span className="num">{percent(fin.margin)}</span>}
        />
        <DataLine
          term="Estimated hours"
          value={fin.estimatedHours === null ? <NotRecorded /> : <span className="num">{fin.estimatedHours}</span>}
        />
        <DataLine
          term="Actual hours"
          value={fin.actualHours === null ? <NotRecorded /> : <span className="num">{fin.actualHours}</span>}
          note={fin.estimatedHours !== null && fin.actualHours !== null && fin.actualHours > fin.estimatedHours
            ? 'over the estimate'
            : undefined}
        />
        <DataLine term="Revenue / hour" value={value(fin.revenuePerHour)} />
        <DataLine term="Contribution / hour" value={value(fin.contributionPerHour)} />
      </dl>
      <p className="t-note border-t border-hairline px-4 py-2">
        Contribution is project value minus direct project costs. It is a management figure — not
        profit, and not an accounting result.
      </p>
    </Panel>
  );
}

/**
 * A monthly contract's figures. The fee is the agreement; "fees to date" is
 * that fee times the months the contract has run — at TODAY's fee, which is
 * said, because a fee changed mid-contract makes it an approximation. What was
 * actually received is the payment schedule's, above.
 */
function MonthlyFeePanel({
  project, spend, costCount,
}: { project: Project; spend: number | null; costCount: number }) {
  const ended = isClosedProject(project);
  const months = monthsRunning(project.start_date, ended && project.completed_at ? project.completed_at : budapestToday());
  const fee = project.monthly_fee === null ? null : Number(project.monthly_fee);
  const toDate = fee !== null && months !== null ? Math.round(fee * months * 100) / 100 : null;
  const value = (amount: number | null) =>
    amount === null ? <NotRecorded /> : <span className="num">{money(amount, project.currency)}</span>;

  return (
    <Panel aria-label="Monthly contract">
      <SectionHeader title="Monthly contract" note={ended ? 'ended' : 'running'} />
      <dl className="grid">
        <DataLine term="Monthly fee" value={value(fee)} note="per month · agreed, not received" />
        <DataLine
          term="Months"
          value={months === null ? <NotRecorded what="Start date" /> : <span className="num">{months}</span>}
          note={project.start_date ? `since ${shortDate(project.start_date)}` : 'needs a start date'}
        />
        <DataLine term="Fees to date" value={value(toDate)} note="months × the current fee" />
        <DataLine
          term="Direct costs"
          value={value(spend)}
          note={costCount > 0 ? `${costCount} recorded` : 'none recorded'}
        />
      </dl>
      <p className="t-note border-t border-hairline px-4 py-2">
        Monthly fees are counted apart from one-off project values, and never added to them.
      </p>
    </Panel>
  );
}

/**
 * An Impact project's market value: what the donated work would have cost, in
 * whole forints. NOT revenue, not owed, not a receivable — it feeds the two
 * support counters on the Impact screen and nothing else.
 *
 * Blank is "not recorded", which is not 0 and is not counted; the close needs
 * a value, and a closed project keeps one. Every change is logged old → new by
 * the database (`log_project_market_value`) and shows in Activity.
 */
function MarketValuePanel({ project, mayEdit, onSaved }: { project: Project; mayEdit: boolean; onSaved: () => void }) {
  const ops = useOperationsMutations(onSaved);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = draft ?? (project.market_value === null ? '' : String(project.market_value));

  const save = async () => {
    const parsed = parseMarketValue(shown);
    if ('error' in parsed) { setError(parsed.error); return; }
    if (parsed.value === project.market_value) { setDraft(null); setError(null); return; }
    const problem = await ops.updateProject(project.id, { market_value: parsed.value });
    setError(problem);
    if (!problem) setDraft(null);
  };

  return (
    <Panel aria-label="Market value">
      <SectionHeader title="Market value" note="Impact · not revenue" />
      <dl className="grid">
        <DataLine
          term="Market value"
          value={project.market_value === null
            ? <span className="text-signal" data-impact-missing>Not recorded</span>
            : <span className="num">{money(project.market_value, 'HUF')}</span>}
          note={project.market_value === null ? 'needed before closing' : undefined}
        />
        <DataLine term="Fee to the client" value={<span className="num">0 Ft</span>} note="always free" />
      </dl>
      {mayEdit && (
        <div className="grid gap-2 border-t border-hairline px-4 py-3">
          <Field id="impact-market-value" label="Whole forints" hint="Blank means not recorded yet — it is not the same as 0.">
            <Input id="impact-market-value" inputMode="numeric" value={shown}
                   onChange={(e) => setDraft(e.target.value)} placeholder="e.g. 1 250 000" />
          </Field>
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={draft === null || ops.busy === project.id}>Save value</Button>
          </div>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        </div>
      )}
      <p className="t-note border-t border-hairline px-4 py-2">
        What this work would have cost a paying client. It is counted as committed support while the
        project runs and as delivered support once it is closed. It is never invoiced or owed.
      </p>
    </Panel>
  );
}

function EditProjectDialog({
  project, onClose, onSaved,
}: { project: Project; onClose: () => void; onSaved: () => void }) {
  const ops = useOperationsMutations(onSaved);
  const impact = project.program === 'impact';
  const monthly = isMonthly(project);
  const staff = useRows<{ id: string; full_name: string | null; email: string; role: string }>(
    'profiles', 'id, full_name, email, role', 'created_at',
  );
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: project.name,
    service: project.service ?? '',
    description: project.description ?? '',
    value: project.value === null ? '' : String(project.value),
    monthly_fee: project.monthly_fee === null ? '' : String(project.monthly_fee),
    currency: project.currency,
    start_date: project.start_date ?? '',
    target_date: project.target_date ?? '',
    estimated_hours: project.estimated_hours === null ? '' : String(project.estimated_hours),
    actual_hours: project.actual_hours === null ? '' : String(project.actual_hours),
    responsible_id: project.responsible_id ?? '',
  });

  const number = (raw: string): number | null | 'bad' => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 'bad';
  };

  const submit = async () => {
    const value = number(form.value);
    const estimated = number(form.estimated_hours);
    const actual = number(form.actual_hours);
    const fee = number(form.monthly_fee);
    if ([value, estimated, actual, fee].includes('bad')) {
      setError('Amounts and hours must be numbers, and not negative ones.');
      return;
    }
    if (monthly && (fee === null || fee === 0)) {
      setError('A monthly contract needs a monthly fee greater than zero.');
      return;
    }

    const problem = await ops.updateProject(project.id, {
      name: form.name.trim(),
      service: form.service.trim() || null,
      description: form.description.trim() || null,
      start_date: form.start_date || null,
      target_date: form.target_date || null,
      estimated_hours: estimated as number | null,
      actual_hours: actual as number | null,
      responsible_id: form.responsible_id || null,
      // An Impact project is free: its fee and currency are not offered and
      // not sent (the database refuses a fee anyway). Payment state, invoiced
      // and paid amounts are never sent from here: they are derived from the
      // payment schedule, and the database refuses a write that disagrees.
      // The currency is only sent when it changed — it is fixed once the
      // project has a schedule.
      // A monthly contract sends its monthly fee and never a one-off value
      // (projects_monthly_shape_check refuses one).
      ...(impact ? {} : {
        ...(monthly ? { monthly_fee: fee as number } : { value: value as number | null }),
        ...(form.currency !== project.currency ? { currency: form.currency } : {}),
      }),
    });
    if (problem) { setError(problem); return; }
    onClose();
  };

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={monthly ? 'Edit monthly contract' : 'Edit project'}
      footer={
        <>
          <Button size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={ops.busy === project.id}>Save</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field id="ep-name" label="Name">
          <Input id="ep-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        </Field>

        <div className={cn('grid gap-3', impact ? 'sm:grid-cols-1' : 'sm:grid-cols-3')}>
          <Field id="ep-service" label="Service">
            <Input id="ep-service" value={form.service}
                   onChange={(e) => setForm((p) => ({ ...p, service: e.target.value }))} />
          </Field>
          {!impact && <>
          {monthly ? (
            <Field id="ep-fee" label="Monthly fee" hint="A change is logged in Activity.">
              <Input id="ep-fee" inputMode="numeric" value={form.monthly_fee}
                     onChange={(e) => setForm((p) => ({ ...p, monthly_fee: e.target.value }))} />
            </Field>
          ) : (
            <Field id="ep-value" label="Project value">
              <Input id="ep-value" inputMode="numeric" value={form.value}
                     onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))} />
            </Field>
          )}
          <Field id="ep-currency" label="Currency">
            <Select id="ep-currency" className="w-full py-2.5 text-sm" value={form.currency}
                    onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          </>}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="ep-start" label="Start">
            <Input id="ep-start" type="date" value={form.start_date}
                   onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))} />
          </Field>
          <Field id="ep-target" label={monthly ? 'Contract end' : 'Target'}>
            <Input id="ep-target" type="date" value={form.target_date}
                   onChange={(e) => setForm((p) => ({ ...p, target_date: e.target.value }))} />
          </Field>
          <Field id="ep-owner" label="Responsible">
            <Select id="ep-owner" className="w-full py-2.5 text-sm" value={form.responsible_id}
                    onChange={(e) => setForm((p) => ({ ...p, responsible_id: e.target.value }))}>
              <option value="">Nobody</option>
              {staff.rows.filter((s) => s.role !== 'client').map((s) => (
                <option key={s.id} value={s.id}>{s.full_name || s.email}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ep-est-hours" label="Estimated hours">
            <Input id="ep-est-hours" inputMode="numeric" value={form.estimated_hours}
                   onChange={(e) => setForm((p) => ({ ...p, estimated_hours: e.target.value }))} />
          </Field>
          <Field id="ep-act-hours" label="Actual hours" hint="Entered by hand — there is no timer.">
            <Input id="ep-act-hours" inputMode="numeric" value={form.actual_hours}
                   onChange={(e) => setForm((p) => ({ ...p, actual_hours: e.target.value }))} />
          </Field>
        </div>

        {!impact && (
          <p className="t-note" data-payment-moved>
            Invoicing and payments are recorded in the project's payment schedule, not here — the
            payment state follows what is recorded there. The currency is fixed once a schedule exists.
          </p>
        )}

        <Field id="ep-description" label="Description">
          <Textarea id="ep-description" value={form.description}
                    onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
        </Field>

        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

function CostDialog({
  project, onClose, onSaved,
}: { project: Project; onClose: () => void; onSaved: () => void }) {
  const ops = useOperationsMutations(onSaved);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    description: '',
    category: 'collaborator',
    amount: '',
    currency: project.currency,
    incurred_on: new Date().toISOString().slice(0, 10),
  });

  const submit = async () => {
    const amount = Number(form.amount.trim().replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount < 0) {
      setError('The amount must be a number, and not a negative one.'); return;
    }
    const problem = await ops.addCost(project.id, { ...form, amount });
    if (problem) { setError(problem); return; }
    onSaved();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a direct cost"
      description="A cost that belongs to this project. Not bookkeeping — this exists so contribution can be calculated."
      footer={
        <>
          <Button size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={ops.busy === 'cost'}>Add</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field id="cost-description" label="Description">
          <Input id="cost-description" value={form.description}
                 onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="cost-category" label="Category">
            <Select id="cost-category" className="w-full py-2.5 text-sm" value={form.category}
                    onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}>
              {COST_CATEGORIES.map((c) => <option key={c} value={c}>{COST_LABEL[c]}</option>)}
            </Select>
          </Field>
          <Field id="cost-date" label="Date">
            <Input id="cost-date" type="date" value={form.incurred_on}
                   onChange={(e) => setForm((p) => ({ ...p, incurred_on: e.target.value }))} />
          </Field>
          <Field id="cost-amount" label="Amount">
            <Input id="cost-amount" inputMode="numeric" value={form.amount}
                   onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} />
          </Field>
          <Field id="cost-currency" label="Currency">
            <Select id="cost-currency" className="w-full py-2.5 text-sm" value={form.currency}
                    onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </div>
        {form.currency !== project.currency && (
          <p className="t-note text-signal">
            This cost is in a different currency from the project. It will be listed but not
            subtracted — nothing here converts between currencies.
          </p>
        )}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

function LinkDialog({
  projectId, onClose, onSaved,
}: { projectId: string; onClose: () => void; onSaved: () => void }) {
  const ops = useOperationsMutations(onSaved);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ label: '', url: '' });

  const submit = async () => {
    const problem = await ops.addLink(projectId, form);
    if (problem) { setError(problem); return; }
    onSaved();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a link"
      description="Live site, staging, repository, design file, asset folder. A link, not an integration."
      footer={
        <>
          <Button size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={ops.busy === 'link'}>Add</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field id="link-label" label="Label">
          <Input id="link-label" value={form.label}
                 onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))}
                 placeholder="Staging" />
        </Field>
        <Field id="link-url" label="URL" hint="http and https only.">
          <Input id="link-url" value={form.url}
                 onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
                 placeholder="https://staging.example.hu" />
        </Field>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}
