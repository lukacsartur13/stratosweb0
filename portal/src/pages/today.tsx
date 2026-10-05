import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { can, canAccess } from '@/lib/permissions';
import { useScope } from '@/lib/scope';
import { Badge, Button, DataState, ErrorState, Input, Panel, SectionHeader, Skeleton, cn } from '@/components/ui';
import { shortDate } from '@/lib/pipeline';
import { intlLocale, t } from '@/lib/i18n';
import { inboxNoteId, todayIso, useNotesMutations, useToday } from '@/lib/notes';
import { alertLink, markAlertDone, useAlerts, type AlertKind, type AutomationAlert } from '@/lib/automations';

/**
 * TODAY — everything due today or already late, in one list, from four places:
 * tasks (checklist points with a date), deal follow-ups, project checkpoints
 * and today's meetings. Each line links to where it is dealt with; a task can
 * be ticked off here.
 *
 * "Add a task" puts a dated point in the Tasks checklist (made on first use).
 */
export function TodayScreen() {
  const { profile } = useAuth();
  const { reloadToken } = useScope();
  const [tick, setTick] = useState(0);
  const may = { sales: can(profile?.role, 'view_sales'), projects: canAccess(profile, 'view_projects') };
  const today = useToday(reloadToken + tick, may);
  const alerts = useAlerts(reloadToken + tick);
  const ops = useNotesMutations(() => setTick((n) => n + 1));
  const [draft, setDraft] = useState('');
  const [due, setDue] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const day = todayIso();

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    const inbox = await inboxNoteId();
    if (typeof inbox !== 'string') { setError(inbox.error); return; }
    // Seconds since 1970: later tasks sort last without reading the list first.
    const problem = await ops.addItem(inbox, draft, Math.floor(Date.now() / 1000), due || null);
    setError(problem);
    if (!problem) setDraft('');
  };

  const late = (d: string) => d < day;
  const when = (iso: string) => new Date(iso).toLocaleTimeString(intlLocale('en-GB'), { hour: '2-digit', minute: '2-digit' });
  const count = today.tasks.length + today.followUps.length + today.checkpoints.length + today.meetings.length + alerts.rows.length;

  return (
    <div className="grid gap-4 lg:max-w-4xl">
      <Panel aria-label={t('Add a task')}>
        <form onSubmit={add} className="flex flex-wrap items-center gap-2 px-4 py-3">
          <label className="sr-only" htmlFor="today-task">{t('Task')}</label>
          <Input id="today-task" value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)}
                 placeholder={t('Add a task — e.g. Call Rapidkert about the texts')} className="min-w-0 flex-1" />
          <label className="sr-only" htmlFor="today-due">{t('Due')}</label>
          <Input id="today-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-40" />
          <Button type="submit" size="sm" variant="primary" disabled={!draft.trim()}><Plus size={11} aria-hidden="true" /> {t('Add')}</Button>
        </form>
        {error && <p role="alert" className="border-t border-hairline px-4 py-2 text-xs text-danger">{error}</p>}
      </Panel>

      {today.state === 'loading' && <Skeleton className="h-40 w-full" />}
      {today.state === 'unconfigured' && <Panel><DataState kind="unconfigured" title={t('Not connected')} /></Panel>}
      {today.state === 'error' && <Panel><ErrorState message={t('Today could not be read.')} onRetry={today.reload} /></Panel>}
      {today.state === 'ready' && count === 0 && (
        <Panel><DataState kind="empty" title={t('Nothing due today')} body={t('No task, follow-up, checkpoint or meeting is due today or late.')} /></Panel>
      )}

      {alerts.rows.length > 0 && (
        <Panel aria-label={t('Needs attention')}>
          <SectionHeader title={t('Needs attention')} note={String(alerts.rows.length)} />
          <ul className="grid">
            {alerts.rows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2 last:border-0" data-alert={a.kind}>
                <Badge tone={ALERT_TONE[a.kind]}>{t(ALERT_LABEL[a.kind])}</Badge>
                <Link to={alertLink(a)} className="min-w-0 flex-1 text-[13px] text-paper hover:text-signal">
                  {a.title}{a.detail ? <span className="t-note"> · {a.detail}</span> : null}
                </Link>
                <span className="t-note">{alertNote(a)}</span>
                <Button size="sm" variant="quiet" onClick={async () => { setError(await markAlertDone(a.id)); setTick((n) => n + 1); }}>{t('Done')}</Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {today.state === 'ready' && today.meetings.length > 0 && (
        <Panel aria-label={t('Meetings today')}>
          <SectionHeader title={t('Meetings today')} note={String(today.meetings.length)} />
          <ul className="grid">
            {today.meetings.map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline px-4 py-2 last:border-0">
                <span className="text-[13px] text-paper"><span className="num text-signal">{when(m.starts_at)}</span> {m.title}</span>
                {m.project && <Link to={`/projects/${m.project.id}`} className="t-note underline underline-offset-4 hover:text-paper">{m.project.name}</Link>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {today.state === 'ready' && today.tasks.length > 0 && (
        <Panel aria-label={t('Tasks')}>
          <SectionHeader title={t('Tasks')} note={String(today.tasks.length)} action={<Link to="/notes" className="t-note underline underline-offset-4 hover:text-paper">{t('All notes')}</Link>} />
          <ul className="grid">
            {today.tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2 last:border-0" data-task={task.id}>
                <input type="checkbox" checked={false} aria-label={t('Done: {text}', { text: task.text })}
                       onChange={async () => setError(await ops.updateItem(task.id, { done: true }))} className="h-4 w-4 accent-signal" />
                <span className="min-w-0 flex-1 text-[13px] text-paper">{task.text}</span>
                <span className={cn('num text-[11px]', late(task.due_on ?? day) ? 'text-danger' : 'text-haze')}>
                  {late(task.due_on ?? day) ? t('late · {date}', { date: shortDate(task.due_on) }) : t('today')}
                </span>
                {task.note && (
                  <Link to={`/notes?note=${task.note.id}`} className="t-note underline underline-offset-4 hover:text-paper">
                    {task.note.client ? `${task.note.client.name} · ${task.note.title}` : task.note.title}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {today.state === 'ready' && today.followUps.length > 0 && (
        <Panel aria-label={t('Follow-ups')}>
          <SectionHeader title={t('Follow-ups')} note={String(today.followUps.length)} />
          <ul className="grid">
            {today.followUps.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline px-4 py-2 last:border-0">
                <Link to={`/sales/${d.id}`} className="text-[13px] text-paper hover:text-signal">
                  {d.title}{d.company_name ? <span className="t-note"> · {d.company_name}</span> : null}
                </Link>
                <span className="text-[12px]">
                  {d.next_action && <span className="text-haze">{d.next_action} · </span>}
                  <span className={cn('num', late(d.next_action_on) ? 'text-danger' : 'text-haze')}>{shortDate(d.next_action_on)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {today.state === 'ready' && today.checkpoints.length > 0 && (
        <Panel aria-label={t('Checkpoints due')}>
          <SectionHeader title={t('Checkpoints due')} note={String(today.checkpoints.length)} />
          <ul className="grid">
            {today.checkpoints.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline px-4 py-2 last:border-0">
                <span className="text-[13px] text-paper">{c.title}{' '}
                  {late(c.due_on) && <Badge tone="bad">{t('Late')}</Badge>}
                </span>
                {c.project && <Link to={`/projects/${c.project.id}`} className="t-note underline underline-offset-4 hover:text-paper">{c.project.name} · {shortDate(c.due_on)}</Link>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

const ALERT_LABEL: Record<AlertKind, string> = {
  lead_unanswered: 'No reply yet', deal_stale: 'Stalled', deal_won: 'Won — start the project',
  instalment_overdue: 'Overdue payment', deadline_soon: 'Deadline soon',
};
const ALERT_TONE: Record<AlertKind, 'warn' | 'bad' | 'good' | 'neutral'> = {
  lead_unanswered: 'warn', deal_stale: 'neutral', deal_won: 'good', instalment_overdue: 'bad', deadline_soon: 'warn',
};

/** The figure or day that matters for this alert. */
function alertNote(a: AutomationAlert): string {
  if (a.kind === 'instalment_overdue' && a.amount !== null) {
    const money = new Intl.NumberFormat(intlLocale('en-GB'), { style: 'currency', currency: a.currency ?? 'HUF', maximumFractionDigits: 0 }).format(a.amount);
    return a.due_on ? t('{amount} · due {date}', { amount: money, date: shortDate(a.due_on) }) : money;
  }
  if (a.kind === 'deadline_soon' && a.due_on) return shortDate(a.due_on);
  return shortDate(a.created_at.slice(0, 10));
}
