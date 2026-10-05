import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge, Button, ErrorState, Input, Skeleton, Textarea, cn } from '@/components/ui';
import {
  saveExperience, useClientRequests, useProjectMessages, useSurveys, type ClientRequest, type Survey,
} from '@/lib/clientExperience';
import type { ClientNotice } from '@/lib/notify';
import { intlLocale, t } from '@/lib/i18n';

/**
 * The owner's side of the client experience (20261014000100): what Stratos is
 * waiting for from the client, the project's message thread, and the
 * satisfaction surveys. Rendered inside ClientViewPanel, which owns the
 * "E-mail the client" switch and passes it in as `send`.
 */

type Send = (kind: ClientNotice, payload: Record<string, unknown>, accountIds?: string[]) => Promise<string | null>;

const stamp = (iso: string | null | undefined) => (!iso ? '' : new Date(iso).toLocaleString(intlLocale('en-GB'), { dateStyle: 'medium', timeStyle: 'short' }));
const dayOf = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(intlLocale('en-GB'), { dateStyle: 'medium' });
const link = 'underline underline-offset-4 hover:text-paper';

/* ====================================================== waiting on them == */

export function WaitingOnClient({ projectId, tick, onChanged, send }: { projectId: string; tick: number; onChanged: () => void; send: Send }) {
  const requests = useClientRequests(projectId, tick);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', details: '', due: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = requests.rows.filter((r) => !r.cancelled_at);
  const open = live.filter((r) => !r.done_at);
  const done = live.filter((r) => r.done_at);

  const add = async () => {
    if (!form.title.trim()) return setError(t('Say what you need, e.g. "Logo as SVG".'));
    setBusy(true);
    const row = { project_id: projectId, title: form.title.trim(), details: form.details.trim() || null, due_on: form.due || null };
    const problem = await saveExperience('client_requests', row);
    setBusy(false);
    if (problem) return setError(problem);
    setError(await send('request_added', { title: row.title, due_on: row.due_on }));
    setForm({ title: '', details: '', due: '' });
    setAdding(false);
    onChanged();
  };
  const act = async (r: ClientRequest, patch: Record<string, unknown>) => { setError(await saveExperience('client_requests', patch, r.id)); onChanged(); };

  return (
    <section aria-label={t('Waiting on the client')} className="border-t border-hairline">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <h3 className="t-section text-chrome">{t('Waiting on the client')}</h3>
        <Button size="sm" onClick={() => { setAdding(!adding); setError(null); }}><Plus size={11} aria-hidden="true" /> {t('Request')}</Button>
      </div>
      <p className="t-note px-4 pb-2 pt-1">{t('The client sees these under “Rád várunk” and marks them done. Open approvals and surveys are listed there too.')}</p>
      {adding && (
        <div className="grid gap-2 px-4 pb-3" data-request-form>
          <label className="sr-only" htmlFor={`rq-title-${projectId}`}>{t('What do you need?')}</label>
          <Input id={`rq-title-${projectId}`} maxLength={200} value={form.title} placeholder={t('What do you need?')}
                 onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
          <label className="sr-only" htmlFor={`rq-details-${projectId}`}>{t('Details for the client (optional)')}</label>
          <Textarea id={`rq-details-${projectId}`} rows={2} maxLength={1000} value={form.details} placeholder={t('Details for the client (optional)')}
                    onChange={(e) => setForm((p) => ({ ...p, details: e.target.value }))} />
          <div className="flex flex-wrap items-center gap-2">
            <label className="t-note" htmlFor={`rq-due-${projectId}`}>{t('Due')}</label>
            <Input id={`rq-due-${projectId}`} type="date" className="w-auto" value={form.due} onChange={(e) => setForm((p) => ({ ...p, due: e.target.value }))} />
            <Button size="sm" variant="primary" disabled={busy} onClick={add}>{t('Add request')}</Button>
          </div>
        </div>
      )}
      {requests.state === 'loading' && <div className="px-4 pb-3"><Skeleton className="h-8 w-full" /></div>}
      {requests.state === 'error' && <ErrorState message={requests.message} onRetry={requests.reload} />}
      {requests.state === 'ready' && live.length === 0 && !adding && <p className="px-4 pb-3 text-xs text-haze">{t('Nothing requested.')}</p>}
      <ul className="grid">
        {[...open, ...done].map((r) => (
          <li key={r.id} className={cn('flex flex-wrap items-start justify-between gap-2 border-t border-hairline px-4 py-2', r.done_at && r.seen_at && 'opacity-70')} data-client-request={r.id}>
            <div className="min-w-0 text-[13px]">
              <p className="text-paper">
                {r.title}{' '}
                {r.done_at ? <Badge tone="good">{t('Done')}</Badge> : <Badge tone="warn">{t('Waiting')}</Badge>}
                {r.done_at && !r.seen_at && <> <Badge tone="neutral">{t('New')}</Badge></>}
              </p>
              {r.details && <p className="t-note whitespace-pre-line">{r.details}</p>}
              <p className="t-note">
                {r.due_on ? t('due {day}', { day: dayOf(r.due_on) }) : t('no due date')}
                {r.done_at ? ` · ${t('done by {name}, {when}', { name: r.done_account?.full_name ?? t('Client'), when: stamp(r.done_at) })}` : ''}
              </p>
              {r.done_note && <p className="mt-1 whitespace-pre-line border-l-2 border-signal/60 pl-2 text-haze">{r.done_note}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap gap-1 text-[11px] text-haze">
              {r.done_at && !r.seen_at && <button type="button" className={link} onClick={() => void act(r, { seen_at: new Date().toISOString() })}>{t('Mark seen')}</button>}
              {r.done_at && <button type="button" className={link} onClick={() => void act(r, { done_at: null })}>{t('Reopen')}</button>}
              {!r.done_at && <button type="button" className={link} onClick={() => void act(r, { cancelled_at: new Date().toISOString() })}>{t('Withdraw')}</button>}
            </div>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="px-4 py-2 text-xs text-danger">{error}</p>}
    </section>
  );
}

/* ============================================================= messages == */

export function Messages({ projectId, tick, onChanged, send }: { projectId: string; tick: number; onChanged: () => void; send: Send }) {
  const messages = useProjectMessages(projectId, tick);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unread = messages.rows.filter((m) => m.account_id && !m.read_at);

  const post = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    const problem = await saveExperience('project_messages', { project_id: projectId, body });
    setBusy(false);
    if (problem) return setError(problem);
    setDraft('');
    setError(await send('message_posted', { excerpt: body.slice(0, 300) }));
    onChanged();
  };
  const markRead = async () => { setError(await saveExperience('project_messages', { read_at: new Date().toISOString() }, unread.map((m) => m.id))); onChanged(); };

  return (
    <section aria-label={t('Messages')} className="border-t border-hairline">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <h3 className="t-section text-chrome">{t('Messages')} {unread.length > 0 && <Badge tone="warn">{t('{n} new', { n: unread.length })}</Badge>}</h3>
        {unread.length > 0 && <button type="button" className={cn('text-[11px] text-haze', link)} onClick={() => void markRead()}>{t('Mark read')}</button>}
      </div>
      <p className="t-note px-4 pb-2 pt-1">{t('One thread with the project\'s clients. Answering marks their messages read.')}</p>
      {messages.state === 'loading' && <div className="px-4 pb-3"><Skeleton className="h-8 w-full" /></div>}
      {messages.state === 'error' && <ErrorState message={messages.message} onRetry={messages.reload} />}
      {messages.state === 'ready' && messages.rows.length === 0 && <p className="px-4 pb-2 text-xs text-haze">{t('No message yet.')}</p>}
      {messages.rows.length > 0 && (
        <ol className="grid max-h-96 gap-1.5 overflow-y-auto px-4 pb-2" aria-label={t('Message thread')}>
          {messages.rows.slice(-50).map((m) => (
            <li key={m.id} className={cn('max-w-[85%] rounded-sm border px-3 py-2 text-[13px]',
              m.account_id ? cn('justify-self-start', m.read_at ? 'border-hairline' : 'border-signal/60') : 'justify-self-end border-hairline bg-flare')} data-message={m.id}>
              <p className="whitespace-pre-line text-paper">{m.body}</p>
              <p className="t-note mt-1">{m.account_id ? m.author_name || t('Client') : t('Stratos')} · {stamp(m.created_at)}</p>
            </li>
          ))}
        </ol>
      )}
      <div className="grid gap-1 px-4 pb-3">
        <label className="sr-only" htmlFor={`msg-${projectId}`}>{t('Message to the client')}</label>
        <Textarea id={`msg-${projectId}`} rows={2} maxLength={4000} value={draft} placeholder={t('Message to the client')}
                  onChange={(e) => setDraft(e.target.value)} />
        <div className="flex justify-end"><Button size="sm" variant="primary" disabled={busy || !draft.trim()} onClick={post}>{t('Send')}</Button></div>
      </div>
      {error && <p role="alert" className="px-4 pb-2 text-xs text-danger">{error}</p>}
    </section>
  );
}

/* ========================================================= satisfaction == */

const REASON: Record<Survey['reason'], string> = { closed: 'At closing', quarterly: 'Quarterly', manual: 'Asked by hand' };

export function Satisfaction({ projectId, tick, onChanged }: { projectId: string; tick: number; onChanged: () => void }) {
  const surveys = useSurveys(projectId, tick);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = surveys.rows.filter((s) => !s.cancelled_at).reverse();
  const ask = async () => {
    setBusy(true);
    const problem = await saveExperience('client_surveys', { project_id: projectId, reason: 'manual' });
    setBusy(false);
    setError(problem);
    onChanged();
  };
  const act = async (s: Survey, patch: Record<string, unknown>) => { setError(await saveExperience('client_surveys', patch, s.id)); onChanged(); };

  return (
    <section aria-label={t('Satisfaction')} className="border-t border-hairline">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <h3 className="t-section text-chrome">{t('Satisfaction')}</h3>
        <Button size="sm" disabled={busy} onClick={ask}>{t('Ask now')}</Button>
      </div>
      <p className="t-note px-4 pb-2 pt-1">
        {t('“How likely are you to recommend us?” 1–10. Asked automatically when the project is closed, and every quarter on a monthly contract; the client always gets an e-mail. From 7 up they are offered your Google review link (Settings).')}
      </p>
      {surveys.state === 'loading' && <div className="px-4 pb-3"><Skeleton className="h-8 w-full" /></div>}
      {surveys.state === 'error' && <ErrorState message={surveys.message} onRetry={surveys.reload} />}
      {surveys.state === 'ready' && rows.length === 0 && <p className="px-4 pb-3 text-xs text-haze">{t('Not asked yet.')}</p>}
      <ul className="grid">
        {rows.map((s) => (
          <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 border-t border-hairline px-4 py-2 text-[13px]" data-survey={s.id}>
            <div className="min-w-0">
              <p className="text-paper">
                {s.score != null
                  ? <><span className={cn('font-medium', s.score! >= 9 ? 'text-good' : s.score! >= 7 ? 'text-paper' : 'text-danger')}>{s.score}/10</span>{' '}</>
                  : <Badge tone="warn">{t('Waiting for the answer')}</Badge>}
                {s.answered_at && !s.seen_at && <> <Badge tone="neutral">{t('New')}</Badge></>}
              </p>
              <p className="t-note">
                {t(REASON[s.reason])}{s.period && s.reason === 'quarterly' ? ` ${s.period}` : ''} · {t('asked {when}', { when: stamp(s.created_at) })}
                {s.answered_at ? ` · ${t('answered by {name}', { name: s.account?.full_name ?? t('Client') })}` : ''}
                {s.google_clicked_at ? ` · ${t('opened the Google review page')}` : ''}
              </p>
              {s.comment && <p className="mt-1 whitespace-pre-line border-l-2 border-signal/60 pl-2 text-haze">{s.comment}</p>}
            </div>
            <div className="flex shrink-0 gap-1 text-[11px] text-haze">
              {s.answered_at && !s.seen_at && <button type="button" className={link} onClick={() => void act(s, { seen_at: new Date().toISOString() })}>{t('Mark seen')}</button>}
              {!s.answered_at && <button type="button" className={link} onClick={() => void act(s, { cancelled_at: new Date().toISOString() })}>{t('Withdraw')}</button>}
            </div>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="px-4 py-2 text-xs text-danger">{error}</p>}
    </section>
  );
}
