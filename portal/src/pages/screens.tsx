import type { ReactNode } from 'react';
import { useRows, useSearch, formatDate, type LoadState } from '@/lib/useRows';
import { useAuth } from '@/features/auth/AuthProvider';
import { useScope } from '@/lib/scope';
import { ROLE_LABELS, type Role } from '@/lib/permissions';
import {
  Badge, Cell, DataState, ErrorState, Input, Panel, Row, SectionHeader, Skeleton, Table,
} from '@/components/ui';

/**
 * The record tables.
 *
 * Everything here is a real table with a real RLS policy behind it, reachable
 * from the Records group in the sidebar. They are not one of the Portal's
 * products — Dashboard, Analytics, Leads, Sales, Clients, Projects, System —
 * and they are drawn at that weight: one panel, one table, no dashboard
 * framing.
 *
 * What used to live here and now does not:
 *
 *   pages/dashboard.tsx          the Dashboard (was OverviewScreen)
 *   pages/leads.tsx              the lead list, its strip and its filters
 *   pages/lead-detail.tsx        one lead, its notes and its timeline
 *   pages/system.tsx             the health readout that was duplicated here
 *   pages/sales.tsx              the pipeline, added in P2
 *   pages/clients.tsx            Clients — was a read-only table in this file,
 *                                and is now a relationship hub with a detail
 *                                route, contacts and a won-value rollup
 *   pages/projects.tsx           Projects — same story, plus milestones, costs
 *                                and a contribution figure
 *
 * The three that left in P2 left for one reason: they stopped being lists of
 * rows and became answers to questions, which is what separates a product from
 * a record in this Portal's information architecture. What remains here is what
 * is genuinely still a table.
 */

/**
 * One place that decides what a data screen shows: skeletons, an error, an
 * empty state, or the table. Every screen in this file goes through it, so
 * loading and failure look the same everywhere and no screen forgets a case.
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
    <Panel className="min-w-0">
      <SectionHeader
        title={title}
        action={
          search && state === 'ready' ? (
            <Input
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              aria-label={`Search ${title.toLowerCase()}`}
              className="h-7 w-44 py-1 text-xs sm:w-56"
            />
          ) : null
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
          body="Supabase credentials are not set in this environment, so there is nothing to read yet. See README.md for the setup steps."
        />
      )}

      {state === 'error' && <ErrorState message={message} onRetry={reload} />}

      {state === 'ready' && count === 0 && (
        <DataState kind="empty" title={empty.title} body={empty.body} />
      )}
      {state === 'ready' && count > 0 && children}
    </Panel>
  );
}

/* ----------------------------------------------------------- case studies */
interface CaseStudy {
  id: string; title: string; slug: string; client_name: string | null;
  published: boolean; sort_order: number; updated_at: string;
}

export function CaseStudiesScreen() {
  const { reloadToken } = useScope();
  const { rows, state, message, reload } = useRows<CaseStudy>(
    'case_studies', 'id, title, slug, client_name, published, sort_order, updated_at', 'sort_order', reloadToken,
  );
  const { query, setQuery, filtered } = useSearch(rows, ['title', 'client_name']);

  return (
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
            <Cell className="text-[13px] text-paper">{c.title}</Cell>
            <Cell className="text-xs text-haze">{c.client_name || '—'}</Cell>
            <Cell><Badge tone={c.published ? 'good' : 'neutral'}>{c.published ? 'Published' : 'Draft'}</Badge></Cell>
            <Cell className="num text-xs text-haze">{c.sort_order}</Cell>
            <Cell className="num text-xs text-haze">{formatDate(c.updated_at)}</Cell>
          </Row>
        ))}
      </Table>
    </DataPanel>
  );
}

/* ------------------------------------------------------------------ users */
interface UserRow { id: string; email: string; full_name: string | null; role: Role; created_at: string }

export function UsersScreen() {
  const { reloadToken } = useScope();
  const { rows, state, message, reload } = useRows<UserRow>(
    'profiles', 'id, email, full_name, role, created_at', 'created_at', reloadToken,
  );
  const { query, setQuery, filtered } = useSearch(rows, ['email', 'full_name']);

  return (
    <DataPanel
      title="Accounts"
      state={state} message={message} count={filtered.length} reload={reload}
      search={{ value: query, onChange: setQuery, placeholder: 'Name or email…' }}
      empty={{ title: 'No users', body: 'Accounts appear here once they have signed up or been invited.' }}
    >
      <Table head={['Name', 'Email', 'Role', 'Joined']}>
        {filtered.map((u) => (
          <Row key={u.id}>
            <Cell className="text-[13px] text-paper">{u.full_name || '—'}</Cell>
            <Cell className="break-all text-xs text-haze">{u.email}</Cell>
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
  );
}

/* --------------------------------------------------------------- activity */
interface LogRow { id: string; action: string; entity_type: string | null; created_at: string }

export function ActivityScreen() {
  const { reloadToken } = useScope();
  const { rows, state, message, reload } = useRows<LogRow>(
    'activity_logs', 'id, action, entity_type, created_at', 'created_at', reloadToken,
  );
  return (
    <DataPanel
      title="Recent activity"
      state={state} message={message} count={rows.length} reload={reload}
      empty={{ title: 'Nothing logged', body: 'Writes made through the portal and the serverless functions are recorded here.' }}
    >
      <Table head={['Action', 'Entity', 'When']}>
        {rows.map((l) => (
          <Row key={l.id}>
            <Cell className="num break-all text-xs text-paper">{l.action}</Cell>
            <Cell className="text-xs text-haze">{l.entity_type || '—'}</Cell>
            <Cell className="num text-xs text-haze">{formatDate(l.created_at)}</Cell>
          </Row>
        ))}
      </Table>
    </DataPanel>
  );
}

/* --------------------------------------------------------------- settings */

/**
 * The account, and only the account.
 *
 * The environment and health blocks that used to sit here are on `/system`.
 * Two copies of the same readout were two things to keep in step, and the one
 * that got out of date would have been the one somebody read.
 */
export function SettingsScreen() {
  const { profile } = useAuth();
  return (
    <div className="grid gap-4 lg:max-w-xl">
      <Panel>
        <SectionHeader title="This account" />
        <dl className="grid px-4 py-3 text-sm">
          <Line term="Name" value={profile?.full_name || '—'} />
          <Line term="Email" value={profile?.email || '—'} />
          <Line term="Role" value={profile ? ROLE_LABELS[profile.role] : '—'} />
          <Line term="Organisation" value={profile?.organization_id ?? 'Stratos (staff)'} />
        </dl>
      </Panel>
      <p className="t-note">
        Infrastructure, credentials and deploy context are on the System screen.
      </p>
    </div>
  );
}

function Line({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline py-2 last:border-0">
      <dt className="label">{term}</dt>
      <dd className="truncate text-right text-[13px] text-paper">{value}</dd>
    </div>
  );
}
