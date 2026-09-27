import { Link } from 'react-router-dom';
import { Badge, DataLine, NotRecorded, Panel, SectionHeader, Skeleton } from '@/components/ui';
import { money } from '@/lib/money';
import {
  PAYMENT_LABEL, isClosedProject, projectStatusLabel, trackerOf,
} from '@/lib/pipeline';
import { useProjectDetail } from '@/lib/operations';

/**
 * Beside a project's folder: who it is for and where it stands — read from the
 * records that already exist, never typed twice.
 *
 * Money is what is recorded on the project and nothing more: the agreed value,
 * the payment state and the invoiced/paid amounts. There is no payment schedule
 * in the Portal yet, so none is shown — not an estimated one, not a placeholder.
 * An Impact project says it is free and shows its market value.
 */
export function ProjectFacts({ projectId, reloadToken = 0 }: { projectId: string; reloadToken?: number }) {
  const { project, milestones, contacts, state } = useProjectDetail(projectId, reloadToken);

  if (state === 'loading') return <Skeleton className="h-80 w-full" />;
  if (state !== 'ready' || !project) {
    return (
      <Panel>
        <SectionHeader title="Project" />
        <p className="px-4 py-3 text-xs text-haze">The project could not be read.</p>
      </Panel>
    );
  }

  const closed = isClosedProject(project);
  const impact = project.program === 'impact';
  const summary = trackerOf(milestones, { target_date: project.target_date, closed });
  const status = project.archived_at
    ? `${closed ? 'Closed' : projectStatusLabel(project.status)} · archived`
    : closed ? 'Closed' : projectStatusLabel(project.status);

  return (
    <div className="grid gap-4">
      <Panel aria-label="Project facts">
        <SectionHeader
          title="Project"
          action={<Link to={`/projects/${project.id}`} className="t-note underline underline-offset-4 hover:text-paper">Open project</Link>}
        />
        <dl className="grid">
          <DataLine term="Project" value={project.name} />
          <DataLine
            term="Client"
            value={project.client
              ? <Link to={`/clients/${project.client.id}`} className="underline underline-offset-4 hover:text-signal">{project.client.name}</Link>
              : <NotRecorded what="Client" />}
            note="company"
          />
          <DataLine term="Service" value={project.service || <NotRecorded what="Service" />} />
          <DataLine term="Programme" value={impact ? <Badge tone="good">Impact · free</Badge> : 'Paid'} />
          <DataLine term="Status" value={status} />
          <DataLine
            term="Checkpoint"
            value={summary.total === 0 ? <NotRecorded what="Checkpoints" />
              : summary.current ?? 'All done'}
            note={summary.total > 0 ? `${summary.done}/${summary.total} done` : undefined}
          />
        </dl>
        {summary.blocked.length > 0 && (
          <div className="grid gap-2 border-t border-hairline px-4 py-3" data-signal="blocked">
            {summary.blocked.map((b) => (
              <div key={b.title}>
                <p className="text-xs text-paper"><Badge tone="bad">Blocked</Badge> {b.title}</p>
                <p className="t-note mt-1">Why: {b.reason ?? '—'}</p>
                <p className="t-note">Next: {b.next ?? '—'}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel aria-label="Contacts">
        <SectionHeader title="Contacts" note={contacts.length > 0 ? `${contacts.length}` : undefined} />
        {contacts.length === 0 ? (
          <p className="px-4 py-3 text-xs text-haze">No contact recorded for this client.</p>
        ) : (
          <ul className="grid">
            {contacts.map((c) => (
              <li key={c.id} className="border-b border-hairline px-4 py-2 last:border-0">
                <p className="text-[13px] text-paper">
                  {c.name}{c.is_primary && <> <Badge tone="neutral">Primary</Badge></>}
                </p>
                <p className="t-note break-all">
                  {[c.role, c.email, c.phone].filter(Boolean).join(' · ') || 'No details recorded'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel aria-label={impact ? 'Impact value' : 'Payment'}>
        <SectionHeader title={impact ? 'Impact' : 'Payment'} />
        <dl className="grid">
          {impact ? (
            <>
              <DataLine term="Fee" value="Free" note="no fee, invoice or payment" />
              <DataLine
                term="Market value"
                value={project.market_value !== null ? money(project.market_value, 'HUF') : <NotRecorded what="Market value" />}
                note="what the work would have cost — not revenue"
              />
            </>
          ) : (
            <>
              <DataLine
                term="Contract value"
                value={project.value !== null ? money(project.value, project.currency) : <NotRecorded what="Contract value" />}
              />
              <DataLine term="Payment state" value={PAYMENT_LABEL[project.payment_state] ?? project.payment_state} />
              <DataLine
                term="Invoiced"
                value={project.invoiced_amount !== null ? money(project.invoiced_amount, project.currency) : <NotRecorded what="Invoiced amount" />}
              />
              <DataLine
                term="Paid"
                value={project.paid_amount !== null ? money(project.paid_amount, project.currency) : <NotRecorded what="Paid amount" />}
              />
            </>
          )}
        </dl>
        {!impact && (
          <p className="t-note border-t border-hairline px-4 py-2">
            Only what is recorded on the project. No payment schedule is kept in the Portal yet.
          </p>
        )}
      </Panel>
    </div>
  );
}
