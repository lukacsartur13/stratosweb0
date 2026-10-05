import { createContext, useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, ExternalLink, Pencil, Plus } from 'lucide-react';
import {
  Badge, Button, DataState, Dialog, ErrorState, Field, Input, Panel, SectionHeader, Select, Skeleton, Textarea, cn,
} from '@/components/ui';
import {
  ownerDecideRequest, useClientInbox, useClientViewMutations, useDemoFeedback, useMeetingRequests, useProjectDemos, useProjectMeetings,
  type Demo, type DemoFeedback, type Meeting, type MeetingRequest,
} from '@/lib/clientView';
import { t, intlLocale } from '@/lib/i18n';
import { notifyClient, type ClientNotice } from '@/lib/notify';
import { formatMeetingTime, googleCalendarUrl, isSafeHttpsUrl, nextMeeting, safeHttpsUrl, timeZoneOptions, wallClock, zonedToUtc } from '@/lib/meetings';

/**
 * What the client portal shows of this project besides files: demo links and
 * meetings. The owner's side. Everything here is visible to the project's
 * assigned client accounts — demos only once published, meetings as soon as
 * they are saved — and to nobody else (client_portal_demos/meetings).
 */
/**
 * "E-mail the client": on by default, for this panel. Every change below that a
 * client would want to know about — a published demo, a meeting scheduled,
 * moved or cancelled, an answer to a proposal or to feedback — e-mails the
 * project's clients while it is on (20261013000100_notifications.sql).
 */
const NotifyCtx = createContext<(kind: ClientNotice, payload: Record<string, unknown>, accountIds?: string[]) => Promise<string | null>>(
  async () => null,
);

export function ClientViewPanel({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [tick, setTick] = useState(0);
  const [notify, setNotify] = useState(true);
  const reload = () => setTick((n) => n + 1);
  const send = async (kind: ClientNotice, payload: Record<string, unknown>, accountIds?: string[]) =>
    (notify ? notifyClient(kind, projectId, payload, accountIds) : null);
  return (
    <Panel aria-label={t('Client portal view')}>
      <SectionHeader title={t('Client portal')} note={t('demos and meetings the assigned client sees')}
        action={
          <label className="flex items-center gap-1.5 text-[11px] text-haze" title={t('While ticked, the project\'s clients get an e-mail about what you change here.')}>
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-3.5 w-3.5 accent-signal" data-notify-client />
            {t('E-mail the client')}
          </label>
        } />
      <NotifyCtx.Provider value={send}>
      <Demos projectId={projectId} tick={tick} onChanged={reload} />
      <Meetings projectId={projectId} projectName={projectName} tick={tick} onChanged={reload} />
      </NotifyCtx.Provider>
    </Panel>
  );
}

/* ================================================================ demos == */

function Demos({ projectId, tick, onChanged }: { projectId: string; tick: number; onChanged: () => void }) {
  const demos = useProjectDemos(projectId, tick);
  const feedback = useDemoFeedback(projectId, tick);
  const ops = useClientViewMutations(onChanged);
  const send = useContext(NotifyCtx);
  const [editing, setEditing] = useState<Partial<Demo> | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <section aria-label={t('Demo links')} className="border-b border-hairline">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <h3 className="t-section text-chrome">{t('Demo links')}</h3>
        <Button size="sm" onClick={() => setEditing({ published: false })}><Plus size={11} aria-hidden="true" /> {t('Demo link')}</Button>
      </div>
      <p className="t-note px-4 pb-2 pt-1" data-demo-public-warning>
        {t('The portal only decides who sees the LINK. The demo site itself is outside the portal: anyone who has its address can open it, unless the demo host protects it (e.g. with a password).')}
      </p>
      {demos.state === 'loading' && <div className="px-4 pb-3"><Skeleton className="h-10 w-full" /></div>}
      {demos.state === 'error' && <ErrorState message={demos.message} onRetry={demos.reload} />}
      {demos.state === 'ready' && demos.rows.length === 0 && <p className="px-4 pb-3 text-xs text-haze">{t('No demo link yet.')}</p>}
      <ul className="grid">
        {demos.rows.map((d) => (
          <li key={d.id} className={cn('flex flex-wrap items-start justify-between gap-2 border-t border-hairline px-4 py-2', d.revoked_at && 'opacity-60')} data-demo={d.id}>
            <div className="min-w-0">
              <p className="text-[13px] text-paper">
                {d.title}{' '}
                {d.revoked_at ? <Badge tone="neutral">{t('Revoked')}</Badge> : d.published ? <Badge tone="good">{t('Visible to the client')}</Badge> : <Badge tone="warn">{t('Not published')}</Badge>}
              </p>
              <a href={safeHttpsUrl(d.url)} target="_blank" rel="noopener noreferrer" className="t-note break-all underline underline-offset-4 hover:text-paper">
                {d.url} <ExternalLink size={10} aria-hidden="true" className="inline" />
              </a>
              {d.client_note && <p className="t-note">{d.client_note}</p>}
              <FeedbackList rows={feedback.rows.filter((f) => f.demo_id === d.id)}
                onRead={async (f) => setError(await ops.save('demo_feedback', { read_at: f.read_at ? null : new Date().toISOString() }, f.id))}
                onReply={async (f, reply) => {
                  const problem = await ops.save('demo_feedback', { owner_reply: reply }, f.id);
                  if (problem) return problem;
                  return send('feedback_replied', { reply: reply.slice(0, 300), title: d.title }, [f.account_id]);
                }} />
            </div>
            <div className="flex shrink-0 flex-wrap gap-1">
              {!d.revoked_at && (
                <Button size="sm" variant="quiet" disabled={ops.busy === d.id}
                        onClick={async () => {
                          const problem = await ops.save('project_demos', { published: !d.published }, d.id);
                          setError(problem ?? (!d.published ? await send('demo_published', { title: d.title }) : null));
                        }}>
                  {d.published ? t('Unpublish') : t('Publish')}
                </Button>
              )}
              <Button size="sm" variant="quiet" aria-label={t('Edit demo {title}', { title: d.title })} onClick={() => setEditing(d)}><Pencil size={11} aria-hidden="true" /></Button>
              <Button size="sm" variant="quiet" disabled={ops.busy === d.id}
                      onClick={async () => setError(await ops.save('project_demos', { revoked_at: d.revoked_at ? null : new Date().toISOString() }, d.id))}>
                {d.revoked_at ? t('Restore') : t('Revoke')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="px-4 py-2 text-xs text-danger">{error}</p>}
      {editing && (
        <DemoDialog initial={editing} busy={ops.busy !== null} onClose={() => setEditing(null)}
          onSave={async (row) => {
            const problem = await ops.save('project_demos', editing.id ? row : { ...row, project_id: projectId, position: demos.rows.length * 10 }, editing.id);
            if (problem) return problem;
            setEditing(null);
            // Newly visible to the client: a new published demo, or one just published in the dialog.
            if (row.published && !(editing.id && editing.published)) setError(await send('demo_published', { title: row.title }));
            return null;
          }} />
      )}
    </section>
  );
}

function DemoDialog({ initial, busy, onClose, onSave }: {
  initial: Partial<Demo>; busy: boolean; onClose: () => void;
  onSave: (row: { title: string; url: string; client_note: string | null; published: boolean }) => Promise<string | null>;
}) {
  const [form, setForm] = useState({ title: initial.title ?? '', url: initial.url ?? '', note: initial.client_note ?? '', published: initial.published ?? false });
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!form.title.trim()) return setError(t('A demo needs a title, e.g. "Weboldal demó".'));
    if (!isSafeHttpsUrl(form.url.trim())) return setError(t('Only a plain https:// address is accepted — no http, javascript:, data:, spaces or user:password@.'));
    setError(await onSave({ title: form.title.trim(), url: form.url.trim(), client_note: form.note.trim() || null, published: form.published }));
  };
  return (
    <Dialog open onClose={onClose} title={initial.id ? t('Edit demo link') : t('New demo link')}
            description={t('The client opens it in a new tab from the portal. The portal never loads or embeds it.')}
            footer={<><Button size="sm" onClick={onClose}>{t('Cancel')}</Button><Button size="sm" variant="primary" onClick={submit} disabled={busy}>{t('Save')}</Button></>}>
      <div className="grid gap-3">
        <Field id="demo-title" label={t('Title')}><Input id="demo-title" data-autofocus maxLength={120} value={form.title} placeholder={t('Weboldal demó')}
          onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} /></Field>
        <Field id="demo-url" label={t('HTTPS address')}><Input id="demo-url" type="url" inputMode="url" maxLength={2000} value={form.url} placeholder="https://"
          onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))} /></Field>
        <Field id="demo-note" label={t('Note for the client (Hungarian)')} hint={t('Short — shown on the client\'s card.')}>
          <Textarea id="demo-note" maxLength={500} value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} /></Field>
        <label className="flex items-center gap-2 text-[13px] text-paper">
          <input type="checkbox" checked={form.published} onChange={(e) => setForm((p) => ({ ...p, published: e.target.checked }))} />
          {t('Visible to the client')}
        </label>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

/* ============================================================= meetings == */

function Meetings({ projectId, projectName, tick, onChanged }: { projectId: string; projectName: string; tick: number; onChanged: () => void }) {
  const meetings = useProjectMeetings(projectId, tick);
  const requests = useMeetingRequests(projectId, tick);
  const ops = useClientViewMutations(onChanged);
  const send = useContext(NotifyCtx);
  const about = (m: { title?: string; starts_at?: string; time_zone?: string }) => ({ title: m.title, starts_at: m.starts_at, time_zone: m.time_zone });
  const [editing, setEditing] = useState<Partial<Meeting> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();
  const upcoming = meetings.rows.filter((m) => new Date(m.ends_at) > now);
  const past = meetings.rows.filter((m) => new Date(m.ends_at) <= now);
  const next = nextMeeting(upcoming.map((m) => ({ ...m, cancelled: m.cancelled_at !== null })), now);

  const row = (m: Meeting) => (
    <li key={m.id} className={cn('flex flex-wrap items-start justify-between gap-2 border-t border-hairline px-4 py-2', m.cancelled_at && 'opacity-60')} data-meeting={m.id}>
      <div className="min-w-0">
        <p className="text-[13px] text-paper">
          {m.title}{' '}
          {m.cancelled_at ? <Badge tone="bad">{t('Cancelled')}</Badge> : next?.meeting.id === m.id ? <Badge tone="good">{next.inProgress ? t('Now') : t('Next')}</Badge> : null}
        </p>
        <p className="t-note">{formatMeetingTime(m)}</p>
        <p className="t-note break-all">{m.location ?? ''}{m.location && m.join_url ? ' · ' : ''}{m.join_url ?? ''}</p>
        <RequestList rows={requests.rows.filter((r) => r.meeting_id === m.id)} meetingTitle={m.title} onDecided={onChanged} onError={setError} />
      </div>
      <div className="flex shrink-0 flex-wrap gap-1">
        <Button size="sm" variant="quiet" aria-label={t('Edit meeting {title}', { title: m.title })} onClick={() => setEditing(m)}><Pencil size={11} aria-hidden="true" /></Button>
        <Button size="sm" variant="quiet" disabled={ops.busy === m.id}
                onClick={async () => {
                  const problem = await ops.save('project_meetings', { cancelled_at: m.cancelled_at ? null : new Date().toISOString() }, m.id);
                  setError(problem ?? await send(m.cancelled_at ? 'meeting_scheduled' : 'meeting_cancelled', about(m)));
                }}>
          {m.cancelled_at ? t('Reinstate') : t('Cancel meeting')}
        </Button>
        {!m.cancelled_at && (
          <a className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-haze underline-offset-4 hover:text-paper hover:underline"
             href={googleCalendarUrl({ ...m, note: m.client_note, project_name: projectName })} target="_blank" rel="noopener noreferrer">
            <CalendarPlus size={11} aria-hidden="true" /> Google Calendar
          </a>
        )}
      </div>
    </li>
  );

  return (
    <section aria-label={t('Meetings')}>
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <h3 className="t-section text-chrome">{t('Meetings')}</h3>
        <Button size="sm" onClick={() => setEditing({ time_zone: 'Europe/Budapest' })}><Plus size={11} aria-hidden="true" /> {t('Meeting')}</Button>
      </div>
      <p className="t-note px-4 pb-2 pt-1">
        {t('Shown to the assigned client in the portal; with “E-mail the client” ticked they also get an e-mail. No calendar invitation is sent: a time changed here does not update a copy the client already saved to Google Calendar — the client portal says so.')}
      </p>
      {meetings.state === 'loading' && <div className="px-4 pb-3"><Skeleton className="h-10 w-full" /></div>}
      {meetings.state === 'error' && <ErrorState message={meetings.message} onRetry={meetings.reload} />}
      {meetings.state === 'ready' && upcoming.length === 0 && <DataState kind="empty" title={t('No upcoming meeting')} />}
      <ul className="grid">{upcoming.map(row)}</ul>
      {past.length > 0 && (
        <details className="border-t border-hairline px-4 py-2">
          <summary className="t-note cursor-pointer">{t('Past meetings ({n})', { n: past.length })}</summary>
          <ul className="mt-1 grid">{past.map((m) => <li key={m.id} className="t-note py-1">{m.title} · {formatMeetingTime(m)}{m.cancelled_at ? ` · ${t('cancelled')}` : ''}</li>)}</ul>
        </details>
      )}
      {error && <p role="alert" className="px-4 py-2 text-xs text-danger">{error}</p>}
      {editing && (
        <MeetingDialog initial={editing} busy={ops.busy !== null} onClose={() => setEditing(null)}
          onSave={async (r) => {
            const problem = await ops.save('project_meetings', editing.id ? r : { ...r, project_id: projectId }, editing.id);
            if (problem) return problem;
            const moved = editing.id && (r.starts_at !== editing.starts_at || r.ends_at !== editing.ends_at);
            setEditing(null);
            if (!editing.id) setError(await send('meeting_scheduled', about(r)));
            else if (moved && !editing.cancelled_at) setError(await send('meeting_changed', about(r)));
            return null;
          }} />
      )}
    </section>
  );
}

function MeetingDialog({ initial, busy, onClose, onSave }: {
  initial: Partial<Meeting>; busy: boolean; onClose: () => void;
  onSave: (row: Record<string, unknown>) => Promise<string | null>;
}) {
  const zone0 = initial.time_zone ?? 'Europe/Budapest';
  const start0 = initial.starts_at ? wallClock(zone0, new Date(initial.starts_at)) : '';
  const end0 = initial.ends_at ? wallClock(zone0, new Date(initial.ends_at)) : '';
  const [form, setForm] = useState({
    title: initial.title ?? '', date: start0.slice(0, 10), start: start0.slice(11, 16), end: end0.slice(11, 16),
    zone: zone0, join: initial.join_url ?? '', location: initial.location ?? '', note: initial.client_note ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const zones = timeZoneOptions();

  const submit = async () => {
    if (!form.title.trim()) return setError(t('A meeting needs a title.'));
    if (form.join.trim() && !isSafeHttpsUrl(form.join.trim())) return setError(t('The join link must be a plain https:// address.'));
    if (!form.join.trim() && !form.location.trim()) return setError(t('Give a join link or a place.'));
    const s = zonedToUtc(form.date, form.start, form.zone);
    const e = zonedToUtc(form.date, form.end, form.zone);
    if ('error' in s || 'error' in e) {
      const gap = ('error' in s && s.error === 'nonexistent') || ('error' in e && e.error === 'nonexistent');
      return setError(gap ? t('That time does not exist in this time zone (the clocks skip it when summer time starts). Choose another.') : t('Give a date and both times.'));
    }
    let end = e.iso;
    // An end earlier than the start is on the next day.
    if (new Date(end) <= new Date(s.iso)) end = new Date(new Date(end).getTime() + 24 * 3600e3).toISOString();
    // A time that occurs twice (summer time ending): say so and ask for a
    // second Save, rather than saving silently.
    if ((s.ambiguous || e.ambiguous) && !warning) {
      return setWarning(t('That time occurs twice when summer time ends; the first (summer-time) occurrence will be used. Save again to confirm, or choose another time.'));
    }
    setError(await onSave({
      title: form.title.trim(), starts_at: s.iso, ends_at: end, time_zone: form.zone,
      join_url: form.join.trim() || null, location: form.location.trim() || null, client_note: form.note.trim() || null,
    }));
  };

  return (
    <Dialog open onClose={onClose} title={initial.id ? t('Edit meeting') : t('New meeting')}
            description={t('Times are read in the time zone you choose. The client sees them in the same zone.')}
            footer={<><Button size="sm" onClick={onClose}>{t('Cancel')}</Button><Button size="sm" variant="primary" onClick={submit} disabled={busy}>{t('Save')}</Button></>}>
      <div className="grid gap-3">
        <Field id="mt-title" label={t('Title')}><Input id="mt-title" data-autofocus maxLength={160} value={form.title} placeholder={t('Egyeztetés a demóról')}
          onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="mt-date" label={t('Date')}><Input id="mt-date" type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} /></Field>
          <Field id="mt-start" label={t('Start')}><Input id="mt-start" type="time" value={form.start} onChange={(e) => setForm((p) => ({ ...p, start: e.target.value }))} /></Field>
          <Field id="mt-end" label={t('End')}><Input id="mt-end" type="time" value={form.end} onChange={(e) => setForm((p) => ({ ...p, end: e.target.value }))} /></Field>
        </div>
        <Field id="mt-zone" label={t('Time zone')}>
          <Select id="mt-zone" className="w-full py-2.5 text-sm" value={form.zone} onChange={(e) => setForm((p) => ({ ...p, zone: e.target.value }))}>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </Select>
        </Field>
        <Field id="mt-join" label={t('Online join link (https)')}><Input id="mt-join" type="url" inputMode="url" maxLength={2000} value={form.join} placeholder="https://meet.google.com/…"
          onChange={(e) => setForm((p) => ({ ...p, join: e.target.value }))} /></Field>
        <Field id="mt-location" label={t('or place')}><Input id="mt-location" maxLength={300} value={form.location}
          onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} /></Field>
        <Field id="mt-note" label={t('Note for the client (Hungarian)')}><Textarea id="mt-note" maxLength={1000} value={form.note}
          onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} /></Field>
        {warning && <p role="status" className="text-xs text-signal">{warning}</p>}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

/* ============================================ client feedback, requests == */

function FeedbackList({ rows, onRead, onReply }: {
  rows: DemoFeedback[]; onRead: (f: DemoFeedback) => void; onReply: (f: DemoFeedback, reply: string) => Promise<string | null>;
}) {
  const [answering, setAnswering] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (rows.length === 0) return null;
  return (
    <ul className="mt-2 grid gap-1" aria-label={t('Client feedback')}>
      {rows.map((f) => (
        <li key={f.id} className={cn('rounded-sm border px-3 py-2 text-[12px]', f.read_at ? 'border-hairline' : 'border-signal/50')} data-feedback={f.id}>
          <p className="whitespace-pre-line text-paper">{f.body}</p>
          <p className="t-note mt-1">
            {f.account?.full_name ?? t('Client')} · {new Date(f.created_at).toLocaleString(intlLocale('en-GB'), { dateStyle: 'medium', timeStyle: 'short' })}
            {' · '}{f.read_at ? t('read') : <Badge tone="warn">{t('New')}</Badge>}{' '}
            <button type="button" className="underline underline-offset-4 hover:text-paper" onClick={() => onRead(f)}>{f.read_at ? t('Mark unread') : t('Mark read')}</button>
            {' · '}
            <button type="button" className="underline underline-offset-4 hover:text-paper"
                    onClick={() => { setAnswering(f.id); setDraft(f.owner_reply ?? ''); setError(null); }}>
              {f.owner_reply ? t('Edit the answer') : t('Answer')}
            </button>
          </p>
          {f.owner_reply && answering !== f.id && (
            <p className="mt-1 whitespace-pre-line border-l-2 border-signal/60 pl-2 text-haze" data-feedback-reply>{f.owner_reply}</p>
          )}
          {answering === f.id && (
            <div className="mt-2 grid gap-1">
              <label className="sr-only" htmlFor={`reply-${f.id}`}>{t('Answer')}</label>
              <Textarea id={`reply-${f.id}`} rows={2} maxLength={2000} value={draft} onChange={(e) => setDraft(e.target.value)}
                        placeholder={t('Your answer — the client sees it under their feedback.')} />
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="quiet" onClick={() => setAnswering(null)}>{t('Cancel')}</Button>
                <Button size="sm" variant="primary" disabled={!draft.trim()}
                        onClick={async () => { const p = await onReply(f, draft.trim()); setError(p); if (!p) setAnswering(null); }}>
                  {t('Send the answer')}
                </Button>
              </div>
              {error && <p role="alert" className="text-xs text-danger">{error}</p>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function RequestList({ rows, meetingTitle, onDecided, onError }: { rows: MeetingRequest[]; meetingTitle: string; onDecided: () => void; onError: (e: string | null) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const send = useContext(NotifyCtx);
  const shown = rows.filter((r) => r.status === 'pending' || Date.now() - new Date(r.decided_at ?? r.created_at).getTime() < 14 * 864e5);
  if (shown.length === 0) return null;
  const decide = async (r: MeetingRequest, accept: boolean) => {
    const note = accept ? null : window.prompt(t('Optional note to the client (Hungarian):')) ?? null;
    setBusy(r.id);
    const problem = await ownerDecideRequest(r.id, accept, note);
    onError(problem ?? await send('reschedule_decided', {
      decision: accept ? 'accepted' : 'declined', title: meetingTitle,
      ...(accept ? { starts_at: r.proposed_starts_at, time_zone: r.time_zone } : {}),
    }, [r.account_id]));
    setBusy(null);
    onDecided();
  };
  return (
    <ul className="mt-2 grid gap-1" aria-label={t('Proposed new times')}>
      {shown.map((r) => (
        <li key={r.id} className={cn('rounded-sm border px-3 py-2 text-[12px]', r.status === 'pending' ? 'border-signal/50' : 'border-hairline')} data-request={r.id}>
          <p className="text-paper">
            {t('{name} proposes: {time}', { name: r.account?.full_name ?? t('Client'), time: formatMeetingTime({ starts_at: r.proposed_starts_at, ends_at: r.proposed_ends_at, time_zone: r.time_zone }) })}
            {' '}{r.status === 'pending' ? <Badge tone="warn">{t('Pending')}</Badge> : <Badge tone="neutral">{t(r.status)}</Badge>}
          </p>
          {r.message && <p className="t-note whitespace-pre-line">„{r.message}”</p>}
          {r.status === 'pending' && (
            <div className="mt-1 flex gap-1">
              <Button size="sm" variant="primary" disabled={busy === r.id} onClick={() => void decide(r, true)}>{t('Accept — move the meeting')}</Button>
              <Button size="sm" variant="quiet" disabled={busy === r.id} onClick={() => void decide(r, false)}>{t('Decline')}</Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The owner's inbox on the projects list: every unread demo feedback and every
 * pending time proposal, across projects. Nothing is e-mailed; this is where
 * they show up.
 */
export function ClientInbox({ reloadToken = 0 }: { reloadToken?: number }) {
  const inbox = useClientInbox(true, reloadToken);
  if (inbox.state !== 'ready' || inbox.items.length === 0) return null;
  return (
    <Panel aria-label={t('Client inbox')}>
      <SectionHeader title={t('Client inbox')} note={t('{n} waiting', { n: inbox.items.length })} />
      <ul className="grid">
        {inbox.items.map((i) => (
          <li key={`${i.kind}-${i.id}`} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline px-4 py-2 last:border-0">
            <Link to={`/projects/${i.project_id}`} className="min-w-0 text-[13px] text-paper underline-offset-4 hover:underline">
              <Badge tone={i.kind === 'request' ? 'warn' : 'neutral'}>{i.kind === 'request' ? t('New time') : t('Feedback')}</Badge>{' '}
              {i.project} · <span className="text-haze">{i.who}</span>
            </Link>
            <span className="t-note max-w-full truncate">{i.text}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
