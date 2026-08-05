import { Fragment, useState, type ReactNode } from 'react';
import { useRows, useSearch, formatDate, type LoadState } from '@/lib/useRows';
import { useAuth } from '@/features/auth/AuthProvider';
import { ROLE_LABELS, type Role } from '@/lib/permissions';
import {
  Badge, Cell, EmptyState, ErrorState, Input, Panel, PanelHeader, Row, Skeleton, Table,
} from '@/components/ui';

/* ---------------------------------------------------------------- shared */
export function PageHead({ title, lede, right }: { title: string; lede?: string; right?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl tracking-wide text-paper">{title}</h1>
        {lede && <p className="mt-1 max-w-prose text-sm text-haze">{lede}</p>}
      </div>
      {right}
    </header>
  );
}

/**
 * One place that decides what a data screen shows: skeletons, an error, an
 * empty state, or the table. Every screen goes through it, so loading and
 * failure look the same everywhere and no screen forgets to handle a case.
 */
function DataPanel({
  title, state, message, count, empty, search, children, reload,
}: {
  title: string; state: LoadState; message: string; count: number;
  empty: { title: string; body: string };
  search?: { value: string; onChange: (v: string) => void; placeholder: string };
  children: ReactNode; reload: () => void;
}) {
  return (
    <Panel>
      <PanelHeader
        title={title}
        action={
          search && state === 'ready' ? (
            <Input
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              aria-label={`Search ${title.toLowerCase()}`}
              className="h-8 w-44 py-1 text-xs sm:w-56"
            />
          ) : null
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

      {state === 'ready' && count === 0 && <EmptyState title={empty.title} body={empty.body} />}
      {state === 'ready' && count > 0 && children}
    </Panel>
  );
}

/* -------------------------------------------------------------- overview */
interface Lead { id: string; name: string; company: string | null; status: string; created_at: string }

export function OverviewScreen() {
  const { profile } = useAuth();
  const leads = useRows<Lead>('leads', 'id, name, company, status, created_at');
  const projects = useRows<{ id: string; status: string }>('projects', 'id, status');

  const newLeads = leads.rows.filter((l) => l.status === 'new').length;
  const liveProjects = projects.rows.filter((p) => p.status !== 'archived').length;

  return (
    <>
      <PageHead
        title={`Good to see you${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`}
        lede="Everything below is filtered by what your account is allowed to see."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="New leads" value={leads.state === 'ready' ? newLeads : null} state={leads.state} />
        <Stat label="Leads total" value={leads.state === 'ready' ? leads.rows.length : null} state={leads.state} />
        <Stat label="Live projects" value={projects.state === 'ready' ? liveProjects : null} state={projects.state} />
        <Stat label="Your role" text={profile ? ROLE_LABELS[profile.role] : '—'} state="ready" />
      </div>

      <DataPanel
        title="Latest leads"
        state={leads.state}
        message={leads.message}
        count={leads.rows.length}
        reload={leads.reload}
        empty={{ title: 'No leads yet', body: 'Submissions from the public contact form and the quote questionnaire land here.' }}
      >
        <Table head={['Name', 'Company', 'Status', 'Received']}>
          {leads.rows.slice(0, 8).map((l) => (
            <Row key={l.id}>
              <Cell>{l.name}</Cell>
              <Cell className="text-haze">{l.company || '—'}</Cell>
              <Cell><LeadStatus status={l.status} /></Cell>
              <Cell className="num text-xs text-haze">{formatDate(l.created_at)}</Cell>
            </Row>
          ))}
        </Table>
      </DataPanel>
    </>
  );
}

function Stat({ label, value, text, state }: { label: string; value?: number | null; text?: string; state: LoadState }) {
  return (
    <Panel className="p-4">
      <p className="label">{label}</p>
      {state === 'loading' ? (
        <Skeleton className="mt-2 h-7 w-16" />
      ) : (
        <p className="num mt-1.5 text-2xl text-paper">
          {text ?? (value === null || value === undefined ? '—' : value)}
        </p>
      )}
    </Panel>
  );
}

function LeadStatus({ status }: { status: string }) {
  const tone = status === 'won' ? 'good' : status === 'lost' || status === 'spam' ? 'bad' : status === 'new' ? 'warn' : 'neutral';
  return <Badge tone={tone}>{status}</Badge>;
}

/* ------------------------------------------------------------------ leads */
interface FullLead extends Lead {
  email: string; service_interest: string | null; budget_range: string | null;
  // Written by the canonical envelope — see netlify/functions/lead-contract.mjs.
  // Every one is nullable because rows created before that migration have none.
  form_type: string | null;
  locale: string | null;
  source_route: string | null;
  submission_id: string | null;
  payload: Record<string, unknown> | null;
}

/** Human label for the four public forms, plus the pre-envelope fallback. */
const FORM_LABEL: Record<string, string> = {
  newsletter: 'Newsletter',
  contact: 'Contact',
  impact: 'Impact',
  questionnaire: 'Questionnaire',
  website: 'Website',
};

/**
 * One submitted answer.
 *
 * The questionnaire's `answers` is an array of `{ q, a }`; everything else is a
 * flat scalar. Both are rendered here rather than in two components, because
 * the difference is one branch and a second component would drift.
 */
function PayloadEntry({ label, value }: { label: string; value: unknown }) {
  const text =
    typeof value === 'boolean' ? (value ? 'Yes' : 'No')
      : Array.isArray(value) ? `${value.length} answers`
        : String(value ?? '—');
  return (
    <div className="grid gap-0.5">
      <span className="label">{label}</span>
      <span className="whitespace-pre-wrap break-words text-xs text-paper">{text || '—'}</span>
    </div>
  );
}

function LeadDetail({ lead, columns }: { lead: FullLead; columns: number }) {
  const payload = lead.payload && typeof lead.payload === 'object' ? lead.payload : {};
  const answers = Array.isArray((payload as { answers?: unknown }).answers)
    ? ((payload as { answers: { q: string; a: string }[] }).answers)
    : [];
  const scalars = Object.entries(payload).filter(([k]) => k !== 'answers');

  return (
    <tr className="border-b border-hair/60 bg-white/[0.02] last:border-0">
      <Cell colSpan={columns} className="px-5 py-4">
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <PayloadEntry label="Locale" value={lead.locale} />
            <PayloadEntry label="Submitted from" value={lead.source_route} />
            <PayloadEntry label="Submission id" value={lead.submission_id} />
          </div>

          {scalars.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {scalars.map(([k, v]) => <PayloadEntry key={k} label={k} value={v} />)}
            </div>
          )}

          {answers.length > 0 && (
            <div className="grid gap-2">
              <span className="label">{answers.length} questionnaire answers</span>
              <ol className="grid gap-2">
                {answers.map((entry, i) => (
                  <li key={`${i}-${entry.q}`} className="border-l border-hair pl-3">
                    <p className="text-xs text-haze">{entry.q}</p>
                    <p className="whitespace-pre-wrap break-words text-xs text-paper">{entry.a || '—'}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {scalars.length === 0 && answers.length === 0 && (
            <p className="text-xs text-haze">
              This lead predates the structured payload. Its answers are in the message field.
            </p>
          )}
        </div>
      </Cell>
    </tr>
  );
}

export function LeadsScreen() {
  const { rows, state, message, reload } = useRows<FullLead>(
    'leads',
    'id, name, company, email, service_interest, budget_range, status, created_at, form_type, locale, source_route, submission_id, payload',
  );
  const { query, setQuery, filtered } = useSearch(rows, ['name', 'company', 'email']);
  const [open, setOpen] = useState<string | null>(null);

  const head = ['Name', 'Form', 'Company', 'Email', 'Interest', 'Budget', 'Status', 'Received', ''];

  return (
    <>
      <PageHead title="Leads" lede="Every enquiry from the public site, newest first." />
      <DataPanel
        title="All leads"
        state={state} message={message} count={filtered.length} reload={reload}
        search={{ value: query, onChange: setQuery, placeholder: 'Name, company, email…' }}
        empty={{
          title: rows.length ? 'Nothing matches' : 'No leads yet',
          body: rows.length
            ? 'Try a shorter search term.'
            : 'The newsletter, contact form, Impact application and quote questionnaire all write here through the Netlify function.',
        }}
      >
        <Table head={head}>
          {filtered.map((l) => (
            <Fragment key={l.id}>
              <Row>
                <Cell>{l.name}</Cell>
                <Cell><Badge>{FORM_LABEL[l.form_type ?? ''] ?? l.form_type ?? '—'}</Badge></Cell>
                <Cell className="text-haze">{l.company || '—'}</Cell>
                <Cell className="text-haze">
                  <a className="underline underline-offset-4 hover:text-paper" href={`mailto:${l.email}`}>{l.email}</a>
                </Cell>
                <Cell className="text-haze">{l.service_interest || '—'}</Cell>
                <Cell className="num text-xs text-haze">{l.budget_range || '—'}</Cell>
                <Cell><LeadStatus status={l.status} /></Cell>
                <Cell className="num text-xs text-haze">{formatDate(l.created_at)}</Cell>
                <Cell>
                  <button
                    type="button"
                    className="label underline underline-offset-4 hover:text-paper"
                    aria-expanded={open === l.id}
                    onClick={() => setOpen(open === l.id ? null : l.id)}
                  >
                    {open === l.id ? 'Hide' : 'Details'}
                  </button>
                </Cell>
              </Row>
              {open === l.id && <LeadDetail lead={l} columns={head.length} />}
            </Fragment>
          ))}
        </Table>
      </DataPanel>
    </>
  );
}

/* --------------------------------------------------------------- projects */
interface Project {
  id: string; name: string; slug: string; status: string;
  start_date: string | null; target_date: string | null;
}

export function ProjectsScreen() {
  const { rows, state, message, reload } = useRows<Project>(
    'projects', 'id, name, slug, status, start_date, target_date, created_at',
  );
  const { query, setQuery, filtered } = useSearch(rows, ['name', 'slug']);

  return (
    <>
      <PageHead title="Projects" lede="Client work in flight. Team members see only what they are assigned to." />
      <DataPanel
        title="All projects"
        state={state} message={message} count={filtered.length} reload={reload}
        search={{ value: query, onChange: setQuery, placeholder: 'Project name…' }}
        empty={{ title: 'No projects', body: 'Projects you can see will appear here once they are created.' }}
      >
        <Table head={['Project', 'Status', 'Started', 'Target']}>
          {filtered.map((p) => (
            <Row key={p.id}>
              <Cell>
                {p.name}
                <span className="num ml-2 text-[10px] text-haze">/{p.slug}</span>
              </Cell>
              <Cell><Badge tone={p.status === 'archived' ? 'neutral' : 'warn'}>{p.status}</Badge></Cell>
              <Cell className="num text-xs text-haze">{formatDate(p.start_date)}</Cell>
              <Cell className="num text-xs text-haze">{formatDate(p.target_date)}</Cell>
            </Row>
          ))}
        </Table>
      </DataPanel>
    </>
  );
}

/* ---------------------------------------------------------------- clients */
interface Org { id: string; name: string; slug: string; website: string | null; status: string; created_at: string }

export function ClientsScreen() {
  const { rows, state, message, reload } = useRows<Org>('organizations', 'id, name, slug, website, status, created_at');
  const { query, setQuery, filtered } = useSearch(rows, ['name', 'slug']);

  return (
    <>
      <PageHead title="Clients" lede="Organisations. Each one is the boundary a client account can see across." />
      <DataPanel
        title="Organisations"
        state={state} message={message} count={filtered.length} reload={reload}
        search={{ value: query, onChange: setQuery, placeholder: 'Client name…' }}
        empty={{ title: 'No clients', body: 'Add an organisation to give a client account something to belong to.' }}
      >
        <Table head={['Name', 'Website', 'Status', 'Added']}>
          {filtered.map((o) => (
            <Row key={o.id}>
              <Cell>{o.name}</Cell>
              <Cell className="text-haze">
                {o.website ? (
                  <a href={o.website} target="_blank" rel="noreferrer noopener"
                     className="underline underline-offset-4 hover:text-paper">{o.website}</a>
                ) : '—'}
              </Cell>
              <Cell><Badge tone={o.status === 'active' ? 'good' : 'neutral'}>{o.status}</Badge></Cell>
              <Cell className="num text-xs text-haze">{formatDate(o.created_at)}</Cell>
            </Row>
          ))}
        </Table>
      </DataPanel>
    </>
  );
}

/* ----------------------------------------------------------- case studies */
interface CaseStudy {
  id: string; title: string; slug: string; client_name: string | null;
  published: boolean; sort_order: number; updated_at: string;
}

export function CaseStudiesScreen() {
  const { rows, state, message, reload } = useRows<CaseStudy>(
    'case_studies', 'id, title, slug, client_name, published, sort_order, updated_at', 'sort_order',
  );
  const { query, setQuery, filtered } = useSearch(rows, ['title', 'client_name']);

  return (
    <>
      <PageHead
        title="Case studies"
        lede="Published entries are readable by the public site; drafts are not."
      />
      <DataPanel
        title="All case studies"
        state={state} message={message} count={filtered.length} reload={reload}
        search={{ value: query, onChange: setQuery, placeholder: 'Title or client…' }}
        empty={{
          title: 'No case studies',
          body: 'Rapidkert, Barbershop Győr and mentáliserő.hu are the references to start from.',
        }}
      >
        <Table head={['Title', 'Client', 'State', 'Order', 'Updated']}>
          {filtered.map((c) => (
            <Row key={c.id}>
              <Cell>{c.title}</Cell>
              <Cell className="text-haze">{c.client_name || '—'}</Cell>
              <Cell><Badge tone={c.published ? 'good' : 'neutral'}>{c.published ? 'Published' : 'Draft'}</Badge></Cell>
              <Cell className="num text-xs text-haze">{c.sort_order}</Cell>
              <Cell className="num text-xs text-haze">{formatDate(c.updated_at)}</Cell>
            </Row>
          ))}
        </Table>
      </DataPanel>
    </>
  );
}

/* ------------------------------------------------------------------ users */
interface UserRow { id: string; email: string; full_name: string | null; role: Role; created_at: string }

export function UsersScreen() {
  const { rows, state, message, reload } = useRows<UserRow>('profiles', 'id, email, full_name, role, created_at');
  const { query, setQuery, filtered } = useSearch(rows, ['email', 'full_name']);

  return (
    <>
      <PageHead
        title="Users"
        lede="Only a super admin can reach this screen, and only a super admin can change a role — the database enforces both."
      />
      <DataPanel
        title="Accounts"
        state={state} message={message} count={filtered.length} reload={reload}
        search={{ value: query, onChange: setQuery, placeholder: 'Name or email…' }}
        empty={{ title: 'No users', body: 'Accounts appear here once they have signed up or been invited.' }}
      >
        <Table head={['Name', 'Email', 'Role', 'Joined']}>
          {filtered.map((u) => (
            <Row key={u.id}>
              <Cell>{u.full_name || '—'}</Cell>
              <Cell className="text-haze">{u.email}</Cell>
              <Cell>
                <Badge tone={u.role === 'super_admin' ? 'warn' : u.role === 'client' ? 'neutral' : 'good'}>
                  {ROLE_LABELS[u.role]}
                </Badge>
              </Cell>
              <Cell className="num text-xs text-haze">{formatDate(u.created_at)}</Cell>
            </Row>
          ))}
        </Table>
      </DataPanel>
    </>
  );
}

/* --------------------------------------------------------------- activity */
interface LogRow { id: string; action: string; entity_type: string | null; created_at: string }

export function ActivityScreen() {
  const { rows, state, message, reload } = useRows<LogRow>('activity_logs', 'id, action, entity_type, created_at');
  return (
    <>
      <PageHead title="Activity" lede="An append-only record of what changed and when." />
      <DataPanel
        title="Recent activity"
        state={state} message={message} count={rows.length} reload={reload}
        empty={{ title: 'Nothing logged', body: 'Writes made through the portal and the serverless functions are recorded here.' }}
      >
        <Table head={['Action', 'Entity', 'When']}>
          {rows.map((l) => (
            <Row key={l.id}>
              <Cell className="num text-xs">{l.action}</Cell>
              <Cell className="text-haze">{l.entity_type || '—'}</Cell>
              <Cell className="num text-xs text-haze">{formatDate(l.created_at)}</Cell>
            </Row>
          ))}
        </Table>
      </DataPanel>
    </>
  );
}

/* --------------------------------------------------------------- settings */
export function SettingsScreen() {
  const { profile, configured } = useAuth();
  return (
    <>
      <PageHead title="Settings" lede="Environment and account. Secrets are never shown here." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="This account" />
          <dl className="grid gap-3 p-5 text-sm">
            <Line term="Name" value={profile?.full_name || '—'} />
            <Line term="Email" value={profile?.email || '—'} />
            <Line term="Role" value={profile ? ROLE_LABELS[profile.role] : '—'} />
            <Line term="Organisation" value={profile?.organization_id ?? 'Stratos (staff)'} />
          </dl>
        </Panel>
        <Panel>
          <PanelHeader title="Environment" />
          <dl className="grid gap-3 p-5 text-sm">
            <Line term="Supabase" value={configured ? 'Connected' : 'Not configured'} />
            <Line term="Origin" value={window.location.origin} />
            {/* The anon key is public by design but there is no reason to paint
                it on a screen someone might screenshot, and the service role key
                does not exist in this bundle at all. */}
            <Line term="Service role key" value="Server-side only — never in this bundle" />
          </dl>
        </Panel>
      </div>
    </>
  );
}

function Line({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hair/60 pb-2 last:border-0">
      <dt className="label">{term}</dt>
      <dd className="truncate text-right text-paper">{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------- not found */
export function NotFoundScreen() {
  return (
    <div className="grid min-h-[60dvh] place-items-center text-center">
      <div>
        <p className="num text-4xl text-signal">404</p>
        <p className="mt-2 text-sm text-haze">That screen does not exist in the portal.</p>
        <a href="/portal/" className="mt-4 inline-block text-xs underline underline-offset-4 hover:text-paper">
          Back to overview
        </a>
      </div>
    </div>
  );
}
