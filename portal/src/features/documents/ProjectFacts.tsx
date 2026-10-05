import { Link } from 'react-router-dom';
import { Badge, DataLine, NotRecorded, Panel, SectionHeader, Skeleton } from '@/components/ui';
import { money } from '@/lib/money';
import {
  PAYMENT_LABEL, isClosedProject, projectStatusLabel, trackerOf,
} from '@/lib/pipeline';
import { useProjectDetail } from '@/lib/operations';
import { t, tc } from '@/lib/i18n';

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
        <SectionHeader title={t('Project')} />
        <p className="px-4 py-3 text-xs text-haze">{t('The project could not be read.')}</p>
      </Panel>
    );
  }

  const closed = isClosedProject(project);
  const impact = project.program === 'impact';
  const summary = trackerOf(milestones, { target_date: project.target_date, closed });
  const status = project.archived_at
    ? `${closed ? t('Closed') : projectStatusLabel(project.status)} · ${t('archived')}`
    : closed ? t('Closed') : projectStatusLabel(project.status);

  return (
    <div className="grid gap-4">
      <Panel aria-label={t('Project facts')}>
        <SectionHeader
          title={t('Project')}
          action={<Link to={`/projects/${project.id}`} className="t-note underline underline-offset-4 hover:text-paper">{t('Open project')}</Link>}
        />
        <dl className="grid">
          <DataLine term={t('Project')} value={project.name} />
          <DataLine
            term={t('Client')}
            value={project.client
              ? <Link to={`/clients/${project.client.id}`} className="underline underline-offset-4 hover:text-signal">{project.client.name}</Link>
              : <NotRecorded what={t('Client')} />}
            note={t('company')}
          />
          <DataLine term={t('Service')} value={project.service || <NotRecorded what={t('Service')} />} />
          <DataLine term={t('Programme')} value={impact ? <Badge tone="good">{t('Impact · free')}</Badge> : tc('programme', 'Paid')} />
          <DataLine term={t('Status')} value={status} />
          <DataLine
            term={t('Checkpoint')}
            value={summary.total === 0 ? <NotRecorded what={t('Checkpoints')} />
              : summary.current ?? t('All done')}
            note={summary.total > 0 ? t('{done}/{total} done', { done: summary.done, total: summary.total }) : undefined}
          />
        </dl>
        {summary.blocked.length > 0 && (
          <div className="grid gap-2 border-t border-hairline px-4 py-3" data-signal="blocked">
            {summary.blocked.map((b) => (
              <div key={b.title}>
                <p className="text-xs text-paper"><Badge tone="bad">{t('Blocked')}</Badge> {b.title}</p>
                <p className="t-note mt-1">{t('Why: {reason}', { reason: b.reason ?? '—' })}</p>
                <p className="t-note">{t('Next: {next}', { next: b.next ?? '—' })}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel aria-label={t('Contacts')}>
        <SectionHeader title={t('Contacts')} note={contacts.length > 0 ? `${contacts.length}` : undefined} />
        {contacts.length === 0 ? (
          <p className="px-4 py-3 text-xs text-haze">{t('No contact recorded for this client.')}</p>
        ) : (
          <ul className="grid">
            {contacts.map((c) => (
              <li key={c.id} className="border-b border-hairline px-4 py-2 last:border-0">
                <p className="text-[13px] text-paper">
                  {c.name}{c.is_primary && <> <Badge tone="neutral">{t('Primary')}</Badge></>}
                </p>
                <p className="t-note break-all">
                  {[c.role, c.email, c.phone].filter(Boolean).join(' · ') || t('No details recorded')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel aria-label={impact ? t('Impact value') : t('Payment')}>
        <SectionHeader title={impact ? 'Impact' : t('Payment')} />
        <dl className="grid">
          {impact ? (
            <>
              <DataLine term={t('Fee')} value={t('Free')} note={t('no fee, invoice or payment')} />
              <DataLine
                term={t('Market value')}
                value={project.market_value !== null ? money(project.market_value, 'HUF') : <NotRecorded what={t('Market value')} />}
                note={t('what the work would have cost — not revenue')}
              />
            </>
          ) : (
            <>
              <DataLine
                term={t('Contract value')}
                value={project.value !== null ? money(project.value, project.currency) : <NotRecorded what={t('Contract value')} />}
              />
              <DataLine term={t('Payment state')} value={PAYMENT_LABEL[project.payment_state] ? t(PAYMENT_LABEL[project.payment_state]) : project.payment_state} />
              <DataLine
                term={t('Invoiced')}
                value={project.invoiced_amount !== null ? money(project.invoiced_amount, project.currency) : <NotRecorded what={t('Invoiced amount')} />}
              />
              <DataLine
                term={t('Paid')}
                value={project.paid_amount !== null ? money(project.paid_amount, project.currency) : <NotRecorded what={t('Paid amount')} />}
              />
            </>
          )}
        </dl>
        {!impact && (
          <p className="t-note border-t border-hairline px-4 py-2">
            {t('Only what is recorded on the project. No payment schedule is kept in the Portal yet.')}
          </p>
        )}
      </Panel>
    </div>
  );
}
