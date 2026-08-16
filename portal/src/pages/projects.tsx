import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { can } from '@/lib/permissions';
import { useScope } from '@/lib/scope';
import { useRows } from '@/lib/useRows';
import { Grid } from '@/components/shell/PortalShell';
import {
  Badge, Button, Cell, DataLine, DataState, Dialog, ErrorState, Field, Input, NotRecorded,
  Panel, Row, SectionHeader, Select, Skeleton, StatusPill, Table, Textarea, cn,
} from '@/components/ui';
import { CURRENCIES, money, percent } from '@/lib/money';
import {
  COST_CATEGORIES, COST_LABEL, MILESTONE_LABEL, MILESTONE_STATES, PAYMENT_LABEL,
  PAYMENT_STATES, PROJECT_STATES, PROJECT_STATUS, dueTone, financials, isLiveProject,
  progressOf, projectStatusLabel, projectStatusTone, shortDate, templateFor,
} from '@/lib/pipeline';
import {
  costTotal, uniqueSlug, useClients, useOpenMilestoneCounts, useOperationsMutations,
  useProjectDetail, useProjects, type Milestone, type Project,
} from '@/lib/operations';
import { buildRecordTimeline, useNoteMutation, useRecordDetail } from '@/lib/records';
import { formatWhen } from '@/lib/leads';
import { safeUrl } from '@/pages/clients';

/**
 * PROJECTS — the delivery tracker (§21).
 *
 * A lightweight one, and the constraint is the feature: no tasks, no
 * dependencies, no board, no burndown. A project answers five questions —
 * what are we delivering, where is it, what happens next, is anything blocked,
 * what is it worth — and every screen here exists to answer one of them.
 */

export function ProjectsScreen() {
  const { profile } = useAuth();
  const { reloadToken } = useScope();
  const navigate = useNavigate();
  const mayEdit = can(profile?.role, 'manage_projects');

  const { rows, state, message, reload } = useProjects(reloadToken);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('live');
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((p) => !p.archived_at)
      .filter((p) => (status === 'all' ? true : status === 'live' ? isLiveProject(p) : p.status === status))
      .filter((p) => !q || [p.name, p.client?.name, p.service, p.slug]
        .some((f) => String(f ?? '').toLowerCase().includes(q)));
  }, [rows, query, status]);

  // One query for every project on screen, not one per project (§70).
  const openMilestones = useOpenMilestoneCounts(filtered.map((p) => p.id), reloadToken);

  return (
    <div className="grid gap-4">
      <Panel className="min-w-0">
        <SectionHeader
          title="Projects"
          note={state === 'ready' ? `${filtered.length} of ${rows.length}` : undefined}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="project-status">Status</label>
              <Select id="project-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="live">Live only</option>
                <option value="all">Any status</option>
                {PROJECT_STATES.map((s) => (
                  <option key={s} value={s}>{PROJECT_STATUS[s].label}</option>
                ))}
              </Select>
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Project or client…"
                aria-label="Search projects"
                className="h-7 w-44 py-1 text-xs sm:w-56"
              />
              {mayEdit && (
                <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
                  <Plus size={12} aria-hidden="true" /> New
                </Button>
              )}
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
            title={rows.length === 0 ? 'No projects yet' : 'No active projects'}
            body={rows.length === 0
              ? 'A project is created from a won opportunity, which is what keeps the delivery work connected to what sold it. One can also be added for an existing client.'
              : 'Nothing matches these filters. Try "Any status".'}
            action={rows.length === 0
              ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Link to="/sales?stage=won"><Button size="sm">Open won deals</Button></Link>
                  {mayEdit && <Button size="sm" variant="primary" onClick={() => setCreating(true)}>Create project</Button>}
                </div>
              )
              : <Button size="sm" onClick={() => { setQuery(''); setStatus('all'); }}>Clear</Button>}
          />
        )}

        {state === 'ready' && filtered.length > 0 && (
          <Table
            head={[
              'Project', 'Client', 'Status', 'Service',
              { label: 'Value', align: 'right' },
              { label: 'Open steps', align: 'right' },
              'Target',
            ]}
            minWidth={840}
            sticky
          >
            {filtered.map((project) => {
              const tone = dueTone(project.target_date);
              return (
                <Row key={project.id} onClick={() => navigate(`/projects/${project.id}`)}>
                  <Cell className="min-w-0">
                    <Link to={`/projects/${project.id}`} className="text-[13px] text-paper hover:text-signal">
                      {project.name}
                    </Link>
                  </Cell>
                  <Cell className="truncate text-[11px] text-haze">
                    {project.client
                      ? <Link to={`/clients/${project.client.id}`} className="hover:text-paper">{project.client.name}</Link>
                      : '—'}
                  </Cell>
                  <Cell>
                    <StatusPill tone={projectStatusTone(project.status)}>
                      {projectStatusLabel(project.status)}
                    </StatusPill>
                  </Cell>
                  <Cell className="truncate text-[11px] text-haze">{project.service || '—'}</Cell>
                  <Cell align="right" className="num text-xs text-paper">
                    {money(project.value, project.currency) ?? <span className="text-haze">—</span>}
                  </Cell>
                  <Cell align="right" className="num text-xs text-haze">
                    {openMilestones[project.id] ?? '—'}
                  </Cell>
                  <Cell className={cn(
                    'num whitespace-nowrap text-[11px]',
                    tone === 'overdue' ? 'text-danger' : tone === 'today' ? 'text-signal' : 'text-haze',
                  )}>
                    {shortDate(project.target_date)}
                  </Cell>
                </Row>
              );
            })}
          </Table>
        )}
      </Panel>

      {mayEdit && creating && (
        <NewProjectDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); void reload(); navigate(`/projects/${id}`); }}
        />
      )}
    </div>
  );
}

/* ============================================================= the detail */

/**
 * ONE PROJECT (§24).
 *
 * HEADER  what it is, for whom, where it has got to, when it is due
 * MAIN    the milestones, the notes, the links, the activity
 * SIDE    the money, the hours, the dates, the deal it came from
 *
 * ## The financial block, and the rule it follows
 *
 * §31: where cost or hours are missing, the answer is `Not recorded` and NOT a
 * zero, and the block is drawn quietly rather than emphasised. A contribution
 * figure computed as "value minus no costs at all" is the project's whole value,
 * which reads like an excellent margin and means nothing.
 */
export function ProjectDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const { reloadToken } = useScope();
  const mayEdit = can(profile?.role, 'manage_projects');

  const { project, milestones, costs, links, state, reload } = useProjectDetail(id, reloadToken);
  const detail = useRecordDetail('project', state === 'ready' ? id ?? null : null, reloadToken);
  const notes = useNoteMutation('project', () => { void detail.reload(); });
  const ops = useOperationsMutations(() => { void reload(); void detail.reload(); });

  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [addingCost, setAddingCost] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const [addingMilestone, setAddingMilestone] = useState(false);

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

  const progress = progressOf(milestones);
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
  const targetTone = dueTone(project.target_date);

  const submitNote = async () => {
    const problem = await notes.addNote(project.id, draft);
    setError(problem);
    if (!problem) setDraft('');
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/projects" className="t-note inline-flex items-center gap-1.5 underline underline-offset-4 hover:text-paper">
          <ArrowLeft size={11} aria-hidden="true" /> All projects
        </Link>
        <StatusPill tone={projectStatusTone(project.status)}>{projectStatusLabel(project.status)}</StatusPill>
      </div>

      {/* ----------------------------------------------------- header */}
      <Panel
        aria-label="Project summary"
        className="grid grid-cols-2 divide-x divide-y divide-hairline bg-panel sm:grid-cols-4 xl:divide-y-0"
      >
        <div className="col-span-2 min-w-0 px-4 py-3.5">
          <p className="t-section">Project</p>
          <p className="mt-1.5 break-words text-lg leading-tight text-paper">{project.name}</p>
          <p className="t-note mt-1">
            {project.client
              ? <Link to={`/clients/${project.client.id}`} className="underline underline-offset-4 hover:text-paper">
                  {project.client.name}
                </Link>
              : 'No client'}
            {project.service ? ` · ${project.service}` : ''}
          </p>
        </div>
        <div className="min-w-0 px-4 py-3.5">
          <p className="t-section">Progress</p>
          {progress.percent === null ? (
            <p className="mt-1.5"><NotRecorded what="Progress" /></p>
          ) : (
            <>
              <p className="t-metric mt-1.5">{percent(progress.percent)}</p>
              <p className="t-note mt-1">{progress.done} of {progress.total} milestones</p>
            </>
          )}
        </div>
        <div className="min-w-0 px-4 py-3.5">
          <p className="t-section">Target</p>
          <p className={cn(
            'num mt-1.5 text-xl leading-none',
            targetTone === 'overdue' ? 'text-danger' : targetTone === 'today' ? 'text-signal' : 'text-paper',
          )}>
            {project.target_date ? shortDate(project.target_date) : '—'}
          </p>
          <p className="t-note mt-1">
            {targetTone === 'overdue' ? 'this date has passed' : project.start_date ? `started ${shortDate(project.start_date)}` : 'no start date'}
          </p>
        </div>
      </Panel>

      <Grid>
        <div className="col-span-12 grid min-w-0 gap-4 lg:col-span-8">
          {/* ------------------------------------------- milestones */}
          <Panel className="min-w-0">
            <SectionHeader
              title="Delivery"
              note={progress.total > 0 ? `${progress.done}/${progress.total}` : 'no milestones yet'}
              action={mayEdit
                ? <Button size="sm" variant="quiet" onClick={() => setAddingMilestone(true)}>
                    <Plus size={11} aria-hidden="true" /> Add step
                  </Button>
                : undefined}
            />
            {milestones.length === 0 ? (
              <div className="px-4 py-4">
                <p className="text-xs text-haze">
                  No milestones. A project without them still tracks value and status — the milestone
                  list is what answers &ldquo;where is it now&rdquo;.
                </p>
                {mayEdit && (
                  <Button
                    size="sm"
                    className="mt-2"
                    onClick={async () => {
                      const template = templateFor(project.service);
                      for (const [position, title] of template.steps.entries()) {
                        await ops.saveMilestone(project.id, { title, position });
                      }
                    }}
                  >
                    Start from the {templateFor(project.service).label.toLowerCase()} list
                  </Button>
                )}
              </div>
            ) : (
              <ul className="grid">
                {milestones.map((milestone) => (
                  <MilestoneRow
                    key={milestone.id}
                    milestone={milestone}
                    mayEdit={mayEdit}
                    projectId={project.id}
                    onChanged={reload}
                  />
                ))}
              </ul>
            )}
          </Panel>

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
                   * local, and that is deliberate.
                   *
                   * `tests/portal.spec.ts` → "no link is built from a stored
                   * value without a fixed scheme" is a LEXICAL check: it reads
                   * every `href={…}` in the source and requires the expression
                   * itself to be a literal scheme, a router path, or a
                   * `safeUrl()` call. Hoisting the result into `const href`
                   * hides that from it — the code stays safe and the check goes
                   * quiet, which is the worse of the two failure modes.
                   *
                   * The check could be taught to follow a variable. It should
                   * not be: a security assertion that everyone must remember to
                   * teach about is one that eventually gets taught wrong, and
                   * the cost of keeping it unfoolable is one extra call on a
                   * list that is never long. This is the same idiom
                   * `pages/clients.tsx` and P1's `pages/screens.tsx` use.
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
                          // Not a link. Rendered as text so the value is still
                          // visible and still copyable, and cannot be clicked.
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
                  {error ? <p role="alert" className="text-xs text-danger">{error}</p> : <span />}
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
          <Profitability project={project} fin={fin} costCount={costs.length} />

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
                No direct costs recorded. Contribution cannot be calculated until at least one is —
                a project with no recorded costs is not a project that cost nothing.
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
                value={mayEdit ? (
                  <>
                    <label className="sr-only" htmlFor="project-detail-status">Project status</label>
                    <Select
                      id="project-detail-status"
                      className="w-full"
                      value={(PROJECT_STATES as readonly string[]).includes(project.status) ? project.status : ''}
                      onChange={(e) => void ops.updateProject(project.id, { status: e.target.value })}
                    >
                      {/* A pre-P2 phase value is offered as its own disabled
                          option so the control shows the truth rather than
                          silently claiming the project is "Planned". */}
                      {!(PROJECT_STATES as readonly string[]).includes(project.status) && (
                        <option value="" disabled>{projectStatusLabel(project.status)} (legacy)</option>
                      )}
                      {PROJECT_STATES.map((s) => <option key={s} value={s}>{PROJECT_STATUS[s].label}</option>)}
                    </Select>
                  </>
                ) : projectStatusLabel(project.status)}
              />
              <DataLine term="Service" value={project.service || <NotRecorded />} />
              <DataLine
                term="Responsible"
                value={project.responsible?.full_name || project.responsible?.email
                  || <NotRecorded what="Responsible" />}
              />
              <DataLine term="Started" value={<span className="num text-[11px]">{shortDate(project.start_date)}</span>} />
              <DataLine term="Target" value={<span className="num text-[11px]">{shortDate(project.target_date)}</span>} />
              {project.completed_at && (
                <DataLine term="Completed" value={<span className="num text-[11px]">{shortDate(project.completed_at)}</span>} />
              )}
              <DataLine
                term="Opportunity"
                value={project.opportunity_id
                  ? <Link to={`/sales/${project.opportunity_id}`} className="underline underline-offset-4 hover:text-signal">
                      The deal that sold this
                    </Link>
                  : <span className="text-haze">Not linked</span>}
              />
              <DataLine
                term="Payment"
                value={<Badge tone={project.payment_state === 'paid' ? 'good' : 'neutral'}>
                  {PAYMENT_LABEL[project.payment_state] ?? project.payment_state}
                </Badge>}
                note={project.paid_amount !== null
                  ? `${money(project.paid_amount, project.currency)} received`
                  : undefined}
              />
            </dl>
            <p className="t-note border-t border-hairline px-4 py-2">
              Agreed value is not cash received. Payment state and the paid amount are the only
              record of what has actually arrived.
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
      {mayEdit && addingMilestone && (
        <MilestoneDialog
          projectId={project.id}
          position={milestones.length}
          onClose={() => setAddingMilestone(false)}
          onSaved={() => { setAddingMilestone(false); void reload(); }}
        />
      )}
    </div>
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

/* ============================================================ milestones == */

function MilestoneRow({
  milestone, mayEdit, projectId, onChanged,
}: { milestone: Milestone; mayEdit: boolean; projectId: string; onChanged: () => void }) {
  const ops = useOperationsMutations(onChanged);
  const tone = dueTone(milestone.due_on);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hairline px-4 py-2 last:border-0">
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          milestone.state === 'done' ? 'bg-good'
            : milestone.state === 'blocked' ? 'bg-danger'
              : milestone.state === 'in_progress' ? 'bg-signal' : 'bg-chrome/30',
        )}
        aria-hidden="true"
      />
      <span className={cn(
        'min-w-0 flex-1 text-[13px]',
        milestone.state === 'done' ? 'text-haze line-through' : 'text-paper',
      )}>
        {milestone.title}
      </span>

      {milestone.due_on && (
        <span className={cn(
          'num text-[10px]',
          tone === 'overdue' ? 'text-danger' : tone === 'today' ? 'text-signal' : 'text-haze',
        )}>
          {shortDate(milestone.due_on)}
        </span>
      )}

      {mayEdit ? (
        <>
          <label className="sr-only" htmlFor={`ms-${milestone.id}`}>State for {milestone.title}</label>
          <Select
            id={`ms-${milestone.id}`}
            value={milestone.state}
            onChange={(e) => void ops.saveMilestone(projectId, {
              id: milestone.id, title: milestone.title, state: e.target.value,
            })}
          >
            {MILESTONE_STATES.map((s) => <option key={s} value={s}>{MILESTONE_LABEL[s]}</option>)}
          </Select>
          <Button size="sm" variant="quiet" onClick={() => void ops.removeMilestone(milestone.id)}
                  aria-label={`Remove ${milestone.title}`}>
            <Trash2 size={11} aria-hidden="true" />
          </Button>
        </>
      ) : (
        <Badge tone={milestone.state === 'done' ? 'good' : milestone.state === 'blocked' ? 'bad' : 'neutral'}>
          {MILESTONE_LABEL[milestone.state] ?? milestone.state}
        </Badge>
      )}
    </li>
  );
}

/* =============================================================== dialogs == */

/** A project needs a client (§54). There is no orphan-project path. */
function NewProjectDialog({
  onClose, onCreated, presetClient,
}: { onClose: () => void; onCreated: (id: string) => void; presetClient?: string }) {
  const clients = useClients();
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
    seed: true,
  });

  const template = templateFor(form.service);

  const submit = async () => {
    if (!form.organization_id) { setError('A project needs a client.'); return; }
    if (!form.name.trim()) { setError('A project needs a name.'); return; }
    const raw = form.value.trim();
    const value = raw === '' ? null : Number(raw.replace(/\s/g, '').replace(',', '.'));
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setError('The value must be a number, and not a negative one.'); return;
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
    }, form.seed ? template.steps : []);

    if (typeof result === 'string') { setError(result); return; }
    onCreated(result.id);
  };

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="New project"
      description="The preferred route is from a won opportunity, which keeps the delivery connected to what sold it. This is for work that did not come through the pipeline."
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

        <Field id="np-name" label="Project name">
          <Input id="np-name" value={form.name}
                 onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="np-service" label="Service">
            <Input id="np-service" value={form.service}
                   onChange={(e) => setForm((p) => ({ ...p, service: e.target.value }))}
                   placeholder="Website, Ads, Branding…" />
          </Field>
          <Field id="np-value" label="Value">
            <Input id="np-value" inputMode="numeric" value={form.value}
                   onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))} />
          </Field>
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
          <Field id="np-target" label="Target">
            <Input id="np-target" type="date" value={form.target_date}
                   onChange={(e) => setForm((p) => ({ ...p, target_date: e.target.value }))} />
          </Field>
          <Field id="np-hours" label="Estimated hours">
            <Input id="np-hours" inputMode="numeric" value={form.estimated_hours}
                   onChange={(e) => setForm((p) => ({ ...p, estimated_hours: e.target.value }))} />
          </Field>
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-xs text-haze hover:text-paper">
          <input
            type="checkbox"
            checked={form.seed}
            onChange={(e) => setForm((p) => ({ ...p, seed: e.target.checked }))}
            className="mt-0.5 h-3 w-3 accent-signal"
          />
          <span>
            Start from the <span className="text-paper">{template.label.toLowerCase()}</span> milestone
            list ({template.steps.length} steps). Everything is editable afterwards.
          </span>
        </label>

        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

function EditProjectDialog({
  project, onClose, onSaved,
}: { project: Project; onClose: () => void; onSaved: () => void }) {
  const ops = useOperationsMutations(onSaved);
  const staff = useRows<{ id: string; full_name: string | null; email: string; role: string }>(
    'profiles', 'id, full_name, email, role', 'created_at',
  );
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: project.name,
    service: project.service ?? '',
    description: project.description ?? '',
    value: project.value === null ? '' : String(project.value),
    currency: project.currency,
    start_date: project.start_date ?? '',
    target_date: project.target_date ?? '',
    estimated_hours: project.estimated_hours === null ? '' : String(project.estimated_hours),
    actual_hours: project.actual_hours === null ? '' : String(project.actual_hours),
    responsible_id: project.responsible_id ?? '',
    payment_state: project.payment_state,
    invoiced_amount: project.invoiced_amount === null ? '' : String(project.invoiced_amount),
    paid_amount: project.paid_amount === null ? '' : String(project.paid_amount),
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
    const invoiced = number(form.invoiced_amount);
    const paid = number(form.paid_amount);
    if ([value, estimated, actual, invoiced, paid].includes('bad')) {
      setError('Amounts and hours must be numbers, and not negative ones.');
      return;
    }

    const problem = await ops.updateProject(project.id, {
      name: form.name.trim(),
      service: form.service.trim() || null,
      description: form.description.trim() || null,
      value: value as number | null,
      currency: form.currency,
      start_date: form.start_date || null,
      target_date: form.target_date || null,
      estimated_hours: estimated as number | null,
      actual_hours: actual as number | null,
      responsible_id: form.responsible_id || null,
      payment_state: form.payment_state,
      invoiced_amount: invoiced as number | null,
      paid_amount: paid as number | null,
    });
    if (problem) { setError(problem); return; }
    onClose();
  };

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Edit project"
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

        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="ep-service" label="Service">
            <Input id="ep-service" value={form.service}
                   onChange={(e) => setForm((p) => ({ ...p, service: e.target.value }))} />
          </Field>
          <Field id="ep-value" label="Project value">
            <Input id="ep-value" inputMode="numeric" value={form.value}
                   onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))} />
          </Field>
          <Field id="ep-currency" label="Currency">
            <Select id="ep-currency" className="w-full py-2.5 text-sm" value={form.currency}
                    onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="ep-start" label="Start">
            <Input id="ep-start" type="date" value={form.start_date}
                   onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))} />
          </Field>
          <Field id="ep-target" label="Target">
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

        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="ep-payment" label="Payment state">
            <Select id="ep-payment" className="w-full py-2.5 text-sm" value={form.payment_state}
                    onChange={(e) => setForm((p) => ({ ...p, payment_state: e.target.value }))}>
              {PAYMENT_STATES.map((s) => <option key={s} value={s}>{PAYMENT_LABEL[s]}</option>)}
            </Select>
          </Field>
          <Field id="ep-invoiced" label="Invoiced amount">
            <Input id="ep-invoiced" inputMode="numeric" value={form.invoiced_amount}
                   onChange={(e) => setForm((p) => ({ ...p, invoiced_amount: e.target.value }))} />
          </Field>
          <Field id="ep-paid" label="Paid amount">
            <Input id="ep-paid" inputMode="numeric" value={form.paid_amount}
                   onChange={(e) => setForm((p) => ({ ...p, paid_amount: e.target.value }))} />
          </Field>
        </div>

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

function MilestoneDialog({
  projectId, position, onClose, onSaved,
}: { projectId: string; position: number; onClose: () => void; onSaved: () => void }) {
  const ops = useOperationsMutations(onSaved);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', due_on: '' });

  const submit = async () => {
    const problem = await ops.saveMilestone(projectId, {
      title: form.title.trim(), due_on: form.due_on || null, position,
    });
    if (problem) { setError(problem); return; }
    onSaved();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a delivery step"
      footer={
        <>
          <Button size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={ops.busy === 'milestone'}>Add</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field id="ms-title" label="Step">
          <Input id="ms-title" value={form.title}
                 onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
        </Field>
        <Field id="ms-due" label="Due">
          <Input id="ms-due" type="date" value={form.due_on}
                 onChange={(e) => setForm((p) => ({ ...p, due_on: e.target.value }))} />
        </Field>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}
