import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useScope } from '@/lib/scope';
import {
  Badge, Button, DataState, ErrorState, Field, Input, MetricCell, Panel, SectionHeader, Select, Skeleton, Textarea, cn,
  type Tone,
} from '@/components/ui';
import { t } from '@/lib/i18n';
import {
  ANNOUNCED_SHOWN, LIMITS, SERIES_LIMITS, SUBSCRIBER_CAP, adminUnsubscribe, audienceSize, cancelCampaign, deleteDraft,
  deleteStep, deliveryProblems, draftProblem, eraseSubscriber, formatDay, formatMoment, newsletterApi, nextPosition,
  purgeDate, requestConfirmations, saveAutoAnnounce, saveDraft, saveStep, sendCampaign, stepProblem, useAnnouncements,
  useCampaigns, useSeries, useSubscribers,
  type Announced, type ApiAnswer, type Audience, type AutoAnnounce, type Campaign, type CampaignDraft, type DeliveryProblem,
  type NewsletterFailure, type NewsletterLocale, type PreviewAnswer, type SeriesStep, type StepDraft, type StepProblem,
  type Subscriber, type SubscriberCounts, type TestAnswer,
} from '@/lib/newsletter';

/**
 * NEWSLETTER — the double opt-in list and the campaigns sent to it
 * (20261019000100). A visitor who signs up on the website is only a REQUEST
 * until they click the link in the confirmation e-mail; only confirmed
 * addresses get a campaign. A campaign is written here, queued here, and sent
 * by a scheduled function through Resend, a batch at a time.
 *
 * Top to bottom: the pre-launch requests (only while some were never asked to
 * confirm), the campaigns with the one being written, the automatic e-mails
 * (20261019000200: new articles announced, the welcome series), then the list
 * itself — last, because it is the longest thing on the screen.
 */

/* ============================================================ sentences */

const langLabel = (l: Audience) =>
  l === 'hu' ? t('Hungarian') : l === 'en' ? t('English') : l === 'de' ? t('German') : t('All languages');

const sourceLabel = (s: Subscriber['source']) =>
  s === 'newsletter' ? t('Newsletter form') : s === 'contact' ? t('Contact form') : s === 'import' ? t('Before launch') : t('Portal');

const SUBSCRIBER_BADGE: Record<Subscriber['status'], Tone> = {
  confirmed: 'good', pending: 'warn', unsubscribed: 'neutral', bounced: 'bad', complained: 'bad',
};
const subscriberStatus = (s: Subscriber['status']) =>
  s === 'confirmed' ? t('Confirmed') : s === 'pending' ? t('Pending') : s === 'unsubscribed' ? t('Unsubscribed')
    : s === 'bounced' ? t('Bounced') : t('Marked as spam');

const leftHow = (how: Subscriber['unsubscribe_source']) =>
  how === 'link' ? t('by the link in an e-mail') : how === 'one_click' ? t('with their mail app’s unsubscribe button')
    : how === 'portal' ? t('here in the portal') : how === 'bounce' ? t('the address bounced')
      : how === 'complaint' ? t('they marked an e-mail as spam') : '';

const CAMPAIGN_BADGE: Record<Campaign['status'], Tone> = { draft: 'neutral', sending: 'warn', sent: 'good', cancelled: 'neutral' };
const campaignStatus = (s: Campaign['status']) =>
  s === 'draft' ? t('Draft') : s === 'sending' ? t('Sending') : s === 'sent' ? t('Sent') : t('Stopped');

function failureText(f: NewsletterFailure): string {
  switch (f) {
    case 'missing': return t('This feature is not installed on the database yet (20261019000100).');
    case 'no_recipients': return t('Nobody in this audience has confirmed yet, so there is no one to send it to.');
    case 'not_draft': return t('This is no longer a draft: it was sent or deleted meanwhile.');
    case 'forbidden': return t('Your account may not do this.');
    case 'invalid': return t('The database refused these values. Check the lengths.');
    default: return t('That did not work. Try again.');
  }
}

/** The same, for the automatic e-mails: their tables come with 20261019000200. */
function automationFailureText(f: NewsletterFailure): string {
  switch (f) {
    case 'missing': return t('This feature is not installed on the database yet (20261019000200).');
    case 'duplicate': return t('There is already a step at this position.');
    case 'invalid': return t('These values are not allowed: the position is 1 to 10, the day 1 to 365.');
    case 'gone': return t('This step was deleted meanwhile.');
    default: return failureText(f);
  }
}

function problemText(p: NonNullable<ReturnType<typeof draftProblem>>): string {
  switch (p) {
    case 'subject': return t('Write a subject.');
    case 'subject_long': return t('The subject can be at most {n} characters.', { n: LIMITS.subject });
    case 'preheader_long': return t('The preheader can be at most {n} characters.', { n: LIMITS.preheader });
    case 'body': return t('Write the text of the e-mail.');
    default: return t('The text can be at most {n} characters.', { n: LIMITS.body });
  }
}

function stepProblemText(p: StepProblem): string {
  switch (p) {
    case 'position': return t('The position is a whole number from 1 to {max}.', { max: SERIES_LIMITS.positions });
    case 'delay': return t('The day is a whole number from {min} to {max}.', { min: SERIES_LIMITS.delayMin, max: SERIES_LIMITS.delayMax });
    default: return problemText(p);
  }
}

/** What /api/newsletter answered, as one sentence. */
function apiText(a: Pick<ApiAnswer, 'status' | 'code'>): string {
  switch (a.code) {
    case 'UNAUTHORIZED': return t('Your session has expired. Sign in again.');
    case 'FORBIDDEN': return t('Only admins may preview or send the newsletter.');
    case 'INVALID': return t('The server refused the e-mail: check the subject and the text.');
    case 'NOT_CONFIGURED': return t('E-mail is not set up on the server yet (RESEND_API_KEY).');
    case 'SEND_FAILED': return t('Resend did not accept the e-mail. Try again in a few minutes.');
    case 'NETWORK': return t('The server could not be reached. Check the connection and try again.');
    default: return a.status === 404
      ? t('The newsletter function is not on the server yet.')
      : t('The server could not do it. Try again.');
  }
}

/* =============================================================== screen */

interface Open { key: number; id: string | null; initial: Campaign | null }

export function NewsletterScreen() {
  const { reloadToken } = useScope();
  const [subsTick, setSubsTick] = useState(0);
  const [campTick, setCampTick] = useState(0);
  const subs = useSubscribers(reloadToken + subsTick);
  const camps = useCampaigns(reloadToken + campTick);
  const [editor, setEditor] = useState<Open | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [asked, setAsked] = useState<number | null>(null);
  const dirty = useRef(false);

  const open = (c: Campaign | null) => {
    if (editor && editor.id === (c?.id ?? null)) return;
    if (dirty.current && !window.confirm(t('Discard the changes you have not saved?'))) return;
    dirty.current = false;
    setNotice(null);
    setEditor({ key: Date.now(), id: c?.id ?? null, initial: c });
  };
  const close = () => { dirty.current = false; setEditor(null); };

  return (
    <div className="grid gap-4" data-newsletter>
      {subs.state === 'ready' && (subs.counts.oldUnasked > 0 || asked !== null) && (
        <OldRequests n={subs.counts.oldUnasked} asked={asked}
          onAsked={(n) => { setAsked(n); setSubsTick((x) => x + 1); }} />
      )}

      <CampaignsPanel camps={camps} openId={editor?.id ?? null} notice={notice}
        onNew={() => open(null)} onOpen={open} onChanged={() => setCampTick((x) => x + 1)} />

      {editor && (
        <Editor key={editor.key} initial={editor.initial} counts={subs.counts} countsReady={subs.state === 'ready'}
          onDirty={(d) => { dirty.current = d; }}
          onClose={close}
          onSaved={(id) => { setEditor((e) => (e ? { ...e, id } : e)); setCampTick((x) => x + 1); }}
          onDeleted={() => { close(); setNotice(t('The draft was deleted.')); setCampTick((x) => x + 1); }}
          onSent={(n) => {
            close();
            setNotice(n === 1
              ? t('Queued for 1 subscriber. It goes out over the next few minutes.')
              : t('Queued for {n} subscribers. It goes out over the next few minutes.', { n }));
            setCampTick((x) => x + 1);
          }} />
      )}

      <AnnouncementsPanel reloadToken={reloadToken} />

      <SeriesPanel reloadToken={reloadToken} />

      <SubscribersPanel subs={subs} onChanged={() => setSubsTick((x) => x + 1)} />
    </div>
  );
}

/* ======================================================== old requests */

function OldRequests({ n, asked, onAsked }: { n: number; asked: number | null; onAsked: (n: number) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async () => {
    if (!confirming) { setConfirming(true); return; }
    setBusy(true);
    setError(null);
    const r = await requestConfirmations();
    setBusy(false);
    setConfirming(false);
    if (r.ok) onAsked(r.value);
    else setError(failureText(r.failure));
  };
  return (
    <Panel aria-label={t('Old requests')}>
      <SectionHeader title={t('Old requests')} note={t('from before the newsletter existed')} />
      <div className="grid gap-2 px-4 py-3 text-[13px]" data-newsletter-old-requests>
        {asked !== null ? (
          <p role="status" className="text-good">
            {t('Confirmation requests queued: {n}. The e-mails go out within a few minutes; whoever does not confirm in 30 days is deleted.', { n: asked })}
          </p>
        ) : (
          <>
            <p className="text-paper"><Badge tone="warn">{t('Attention')}</Badge>{' '}{t('Addresses that asked for the newsletter before it existed: {n}.', { n })}</p>
            <p className="t-note">{t('They are not subscribers and get nothing until they confirm. Ask them once: each gets one e-mail with a confirmation link.')}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={ask} disabled={busy} data-newsletter-ask>
                {confirming ? t('Confirm: ask all {n}', { n }) : t('Ask them to confirm')}
              </Button>
              {confirming && !busy && <Button size="sm" variant="quiet" onClick={() => setConfirming(false)}>{t('Not now')}</Button>}
            </div>
            {confirming && <p className="t-note">{t('Whoever does not confirm within 30 days is deleted automatically.')}</p>}
            {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          </>
        )}
      </div>
    </Panel>
  );
}

/* =========================================================== campaigns */

function CampaignsPanel({ camps, openId, notice, onNew, onOpen, onChanged }: {
  camps: ReturnType<typeof useCampaigns>; openId: string | null; notice: string | null;
  onNew: () => void; onOpen: (c: Campaign) => void; onChanged: () => void;
}) {
  const note = camps.state !== 'ready' ? undefined
    : camps.sending ? t('Sending now · refreshed every 10 seconds')
      : camps.rows.length === 1 ? t('1 campaign') : t('{n} campaigns', { n: camps.rows.length });
  return (
    <Panel className="min-w-0" aria-label={t('Campaigns')}>
      <SectionHeader title={t('Campaigns')} note={note}
        action={camps.state === 'ready' ? (
          <Button size="sm" variant="primary" onClick={onNew} data-newsletter-new><Plus size={11} aria-hidden="true" /> {t('New campaign')}</Button>
        ) : undefined} />
      {notice && <p role="status" className="border-b border-hairline px-4 py-2 text-xs text-good">{notice}</p>}
      {camps.state === 'loading' && <div className="p-4"><Skeleton className="h-24 w-full" /></div>}
      {camps.state === 'unconfigured' && <DataState kind="unconfigured" title={t('Not connected')} />}
      {camps.state === 'missing' && <p className="px-4 py-3 text-[13px] text-haze">{t('This feature is not installed on the database yet (20261019000100).')}</p>}
      {camps.state === 'error' && <ErrorState message={t('The campaigns could not be read.')} onRetry={camps.reload} />}
      {camps.state === 'ready' && camps.rows.length === 0 && <p className="px-4 py-3 text-[13px] text-haze">{t('No campaigns yet.')}</p>}
      {camps.state === 'ready' && camps.rows.length > 0 && (
        <ul className="divide-y divide-hairline" data-newsletter-campaigns>
          {camps.rows.map((c) => <CampaignRow key={c.id} c={c} open={c.id === openId} onOpen={() => onOpen(c)} onChanged={onChanged} />)}
        </ul>
      )}
    </Panel>
  );
}

function CampaignRow({ c, open, onOpen, onChanged }: { c: Campaign; open: boolean; onOpen: () => void; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = async () => {
    if (!confirming) { setConfirming(true); return; }
    setBusy(true);
    setError(null);
    const r = await cancelCampaign(c.id);
    setBusy(false);
    setConfirming(false);
    if (r.ok) onChanged();
    else setError(failureText(r.failure));
  };
  const done = c.sent + c.failed;
  const pct = c.recipients > 0 ? Math.min(100, Math.round((done / c.recipients) * 100)) : 0;
  const meta = [
    langLabel(c.audience),
    c.source_key ? t('for {key}', { key: c.source_key }) : '',
    c.status === 'draft' ? t('edited {when}', { when: formatMoment(c.updated_at) }) : t('recipients: {n}', { n: c.recipients }),
    c.status === 'sent' || c.status === 'cancelled' ? t('{n} sent', { n: c.sent }) : '',
    (c.status === 'sent' || c.status === 'cancelled') && c.failed > 0 ? t('{n} not delivered', { n: c.failed }) : '',
    c.queued_at ? t('started {when}', { when: formatMoment(c.queued_at) }) : '',
    c.finished_at ? (c.status === 'cancelled' ? t('stopped {when}', { when: formatMoment(c.finished_at) }) : t('finished {when}', { when: formatMoment(c.finished_at) })) : '',
  ].filter(Boolean);
  return (
    <li className={cn('grid gap-2 px-4 py-3 text-[13px] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start', open && 'bg-flare')}
        data-newsletter-campaign={c.id} data-status={c.status} data-kind={c.kind}>
      <div className="grid min-w-0 gap-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-words text-paper">{c.subject}</span>
          <Badge tone={CAMPAIGN_BADGE[c.status]}>{campaignStatus(c.status)}</Badge>
          {c.kind === 'announce' && <Badge>{t('Automatic')}</Badge>}
        </p>
        <p className="break-words text-haze">{meta.join(' · ')}</p>
        {c.status === 'sending' && (
          <div className="grid gap-1" data-newsletter-progress>
            <div className="h-1 w-full rounded-full bg-flare" role="progressbar" aria-label={t('Sending progress')}
                 aria-valuemin={0} aria-valuemax={c.recipients} aria-valuenow={done}>
              <div className="h-full rounded-full bg-signal transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <p className="t-note">
              {t('{sent} of {total} sent', { sent: c.sent, total: c.recipients })}
              {c.failed > 0 && <> · {t('{n} not delivered', { n: c.failed })}</>}
            </p>
          </div>
        )}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <Button size="sm" onClick={onOpen} aria-pressed={open}>{c.status === 'draft' ? t('Edit') : t('View')}</Button>
        {c.status === 'sending' && (
          <Button size="sm" variant="danger" onClick={stop} disabled={busy} data-newsletter-stop>
            {confirming ? t('Confirm stop') : t('Stop sending')}
          </Button>
        )}
        {confirming && !busy && <Button size="sm" variant="quiet" onClick={() => setConfirming(false)}>{t('Keep sending')}</Button>}
      </div>
      {confirming && <p className="t-note sm:col-span-2">{t('Whoever has not got it yet will not get it. This cannot be undone.')}</p>}
    </li>
  );
}

/* ============================================================== editor */

const EMPTY: CampaignDraft = { subject: '', preheader: '', body: '', audience: 'all' };
const fromCampaign = (c: Campaign): CampaignDraft => ({ subject: c.subject, preheader: c.preheader ?? '', body: c.body, audience: c.audience });
const same = (a: CampaignDraft | null, b: CampaignDraft) =>
  !!a && a.subject === b.subject && a.preheader === b.preheader && a.body === b.body && a.audience === b.audience;
const AUDIENCES: Audience[] = ['all', 'hu', 'en', 'de'];
const LOCALES: NewsletterLocale[] = ['hu', 'en', 'de'];

function Editor({ initial, counts, countsReady, onDirty, onClose, onSaved, onDeleted, onSent }: {
  initial: Campaign | null; counts: SubscriberCounts; countsReady: boolean;
  onDirty: (dirty: boolean) => void; onClose: () => void; onSaved: (id: string) => void;
  onDeleted: () => void; onSent: (n: number) => void;
}) {
  const readOnly = !!initial && initial.status !== 'draft';
  const [id, setId] = useState<string | null>(initial?.id ?? null);
  const [draft, setDraft] = useState<CampaignDraft>(initial ? fromCampaign(initial) : EMPTY);
  const [saved, setSaved] = useState<CampaignDraft | null>(initial ? fromCampaign(initial) : null);
  const [savedAt, setSavedAt] = useState<string | null>(initial?.updated_at ?? null);
  const [lang, setLang] = useState<NewsletterLocale>(initial && initial.audience !== 'all' ? initial.audience : 'hu');
  const [busy, setBusy] = useState<null | 'save' | 'preview' | 'test' | 'send' | 'delete'>(null);
  const [confirming, setConfirming] = useState<null | 'send' | 'delete' | 'close'>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ answer: PreviewAnswer; of: CampaignDraft; lang: NewsletterLocale } | null>(null);
  const top = useRef<HTMLDivElement>(null);

  // A new, untouched form is not "unsaved changes"; an emptied draft is.
  const dirty = !readOnly && !same(saved, draft) && !(id === null && same(EMPTY, draft));
  const n = audienceSize(counts, draft.audience);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, []);

  const set = (patch: Partial<CampaignDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (patch.audience && patch.audience !== 'all') setLang(patch.audience);
    setMessage(null);
    setConfirming(null);
  };
  const problem = () => {
    const p = draftProblem(draft);
    if (p) setMessage({ ok: false, text: problemText(p) });
    return p !== null;
  };
  const payload = () => ({ subject: draft.subject.trim(), preheader: draft.preheader.trim(), body: draft.body, locale: lang });

  /** Saves when there is something to save. Returns the draft's id, or null (and says why). */
  const save = async (): Promise<string | null> => {
    if (id && !dirty) return id;
    if (problem()) return null;
    const r = await saveDraft(id, draft);
    if (!r.ok) { setMessage({ ok: false, text: failureText(r.failure) }); return null; }
    setId(r.value);
    setSaved(draft);
    setSavedAt(new Date().toISOString());
    onSaved(r.value);
    return r.value;
  };

  const runSave = async () => {
    setBusy('save');
    setMessage(null);
    const saidId = await save();
    setBusy(null);
    if (saidId) setMessage({ ok: true, text: t('Draft saved.') });
  };

  const runPreview = async () => {
    if (problem()) return;
    setBusy('preview');
    setMessage(null);
    const of = draft;
    const r = await newsletterApi<PreviewAnswer>('preview', payload());
    setBusy(null);
    if (r.ok && typeof r.body.html === 'string') setPreview({ answer: r.body, of, lang });
    else setMessage({ ok: false, text: apiText(r) });
  };

  const runTest = async () => {
    if (problem()) return;
    setBusy('test');
    setMessage(null);
    const r = await newsletterApi<TestAnswer>('test', payload());
    setBusy(null);
    setMessage(r.ok ? { ok: true, text: t('Sent to {to}.', { to: r.body.to }) } : { ok: false, text: apiText(r) });
  };

  const runSend = async () => {
    if (confirming !== 'send') {
      if (problem()) return;
      setMessage(null);
      setConfirming('send');
      return;
    }
    setBusy('send');
    setMessage(null);
    const savedId = await save();
    if (!savedId) { setBusy(null); setConfirming(null); return; }
    const r = await sendCampaign(savedId);
    setBusy(null);
    setConfirming(null);
    if (r.ok) onSent(r.value);
    else setMessage({ ok: false, text: failureText(r.failure) });
  };

  const runDelete = async () => {
    if (!id) return;
    if (confirming !== 'delete') { setMessage(null); setConfirming('delete'); return; }
    setBusy('delete');
    const r = await deleteDraft(id);
    setBusy(null);
    setConfirming(null);
    if (r.ok) onDeleted();
    else setMessage({ ok: false, text: failureText(r.failure) });
  };

  const runClose = () => {
    if (dirty && confirming !== 'close') { setConfirming('close'); return; }
    onClose();
  };

  const title = readOnly ? t('Campaign') : id ? t('Draft') : t('New campaign');
  const note = readOnly ? campaignStatus(initial!.status)
    : dirty ? t('Not saved yet')
      : savedAt && id ? t('Saved {when}', { when: formatMoment(savedAt) }) : undefined;
  const stale = preview && (!same(preview.of, draft) || preview.lang !== lang);
  const audienceHint = readOnly ? undefined
    : !countsReady ? undefined
      : n === 0 ? t('Nobody in this audience has confirmed yet.')
        : t('Confirmed subscribers in this audience: {n}', { n });

  return (
    <div ref={top} className="scroll-mt-20">
      <Panel aria-label={title}>
        <SectionHeader title={title} note={note}
          action={<Button size="sm" variant="quiet" onClick={runClose}>{confirming === 'close' ? t('Discard changes') : t('Close')}</Button>} />
        <div className="grid gap-4 px-4 py-3 text-[13px]" data-newsletter-editor={id ?? 'new'}>
          {confirming === 'close' && (
            <p role="status" className="text-xs text-signal">
              {t('The changes are not saved.')}{' '}
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => setConfirming(null)}>{t('Keep editing')}</button>
            </p>
          )}
          <Field id="nl-subject" label={t('Subject')} hint={readOnly ? undefined : t('{n} of {max} characters', { n: draft.subject.trim().length, max: LIMITS.subject })}>
            <Input id="nl-subject" value={draft.subject} maxLength={LIMITS.subject} readOnly={readOnly}
              onChange={(e) => set({ subject: e.target.value })} />
          </Field>
          <Field id="nl-preheader" label={t('Preheader (optional)')} hint={t('Shown after the subject in the inbox.')}>
            <Input id="nl-preheader" value={draft.preheader} maxLength={LIMITS.preheader} readOnly={readOnly}
              onChange={(e) => set({ preheader: e.target.value })} />
          </Field>
          <Field id="nl-audience" label={t('Audience')} hint={audienceHint}>
            <Select id="nl-audience" className="justify-self-start py-2" value={draft.audience} disabled={readOnly}
              onChange={(e) => set({ audience: e.target.value as Audience })}>
              {AUDIENCES.map((a) => <option key={a} value={a}>{langLabel(a)}</option>)}
            </Select>
          </Field>
          <Field id="nl-body" label={t('Text')}>
            <Textarea id="nl-body" rows={18} className="min-h-[24rem] font-data text-[12px] leading-relaxed" value={draft.body}
              readOnly={readOnly} spellCheck onChange={(e) => set({ body: e.target.value })} />
          </Field>
          {!readOnly && <FormatHelp />}

          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && (
              <Button size="sm" onClick={() => void runSave()} disabled={busy !== null || (!!id && !dirty)} data-newsletter-save>
                {busy === 'save' ? t('Saving…') : t('Save draft')}
              </Button>
            )}
            <label className="t-note ml-1" htmlFor="nl-lang">{t('Language')}</label>
            <Select id="nl-lang" value={lang} disabled={draft.audience !== 'all'} onChange={(e) => setLang(e.target.value as NewsletterLocale)}>
              {LOCALES.map((l) => <option key={l} value={l}>{langLabel(l)}</option>)}
            </Select>
            <Button size="sm" onClick={() => void runPreview()} disabled={busy !== null} data-newsletter-preview-button>
              {busy === 'preview' ? t('Rendering…') : t('Preview')}
            </Button>
            <Button size="sm" onClick={() => void runTest()} disabled={busy !== null} data-newsletter-test>
              {busy === 'test' ? t('Sending…') : t('Send a test to me')}
            </Button>
          </div>

          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
              <Button size="sm" variant="primary" onClick={() => void runSend()} disabled={busy !== null || !countsReady || n === 0} data-newsletter-send>
                {busy === 'send' ? t('Sending…') : confirming === 'send' ? t('Confirm: send to {n}', { n })
                  : n === 1 ? t('Send to 1 subscriber') : t('Send to {n} subscribers', { n })}
              </Button>
              {confirming === 'send' && busy === null && <Button size="sm" variant="quiet" onClick={() => setConfirming(null)}>{t('Not yet')}</Button>}
              {id && (
                <Button size="sm" variant="danger" className="sm:ml-auto" onClick={() => void runDelete()} disabled={busy !== null} data-newsletter-delete>
                  {confirming === 'delete' ? t('Confirm delete') : t('Delete draft')}
                </Button>
              )}
              {confirming === 'delete' && busy === null && <Button size="sm" variant="quiet" onClick={() => setConfirming(null)}>{t('Keep it')}</Button>}
            </div>
          )}
          {confirming === 'send' && (
            <p className="t-note">{t('It goes out over the next few minutes to every confirmed subscriber in the audience, and cannot be changed after. You can stop it while it is going out.')}</p>
          )}
          {message && <p role="status" className={message.ok ? 'text-xs text-good' : 'text-xs text-danger'}>{message.text}</p>}

          {preview && <div data-newsletter-preview><Preview answer={preview.answer} stale={!!stale} /></div>}

          {readOnly && initial && initial.failed > 0 && <Undelivered campaignId={initial.id} />}
        </div>
      </Panel>
    </div>
  );
}

/** The light markup a campaign or a series e-mail is written in. */
function FormatHelp() {
  return (
    <div className="t-note grid gap-1" data-newsletter-format-help>
      <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
        <li>{t('A blank line starts a new paragraph.')}</li>
        <li><code className="font-data text-paper">## </code>{' '}{t('at the start of a line makes a heading.')}</li>
        <li><code className="font-data text-paper">- </code>{' '}{t('at the start of a line makes a list item.')}</li>
        <li><code className="font-data text-paper">**…**</code>{' '}{t('makes it bold.')}</li>
        <li><code className="font-data text-paper">[…](https://…)</code>{' '}{t('makes a link.')}</li>
      </ul>
      <p>{t('The unsubscribe link and the company footer are added automatically.')}</p>
    </div>
  );
}

/** The e-mail as /api/newsletter/preview rendered it. */
function Preview({ answer, stale }: { answer: PreviewAnswer; stale: boolean }) {
  return (
    <div className="grid gap-2">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="label">{t('Subject')}</span>
        <span className="min-w-0 break-words text-paper">{answer.subject}</span>
      </p>
      {stale && <p className="t-note text-signal">{t('Changed since this preview: preview again to see it.')}</p>}
      <iframe title={t('E-mail preview')} sandbox="" srcDoc={answer.html}
        className="h-[600px] w-full rounded-sm border border-hair bg-white" />
      {answer.text && (
        <details className="t-note">
          <summary className="cursor-pointer">{t('Plain-text version')}</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words font-data text-[11px] text-haze">{answer.text}</pre>
        </details>
      )}
    </div>
  );
}

/** Who a sent campaign did not reach, and why. */
function Undelivered({ campaignId }: { campaignId: string }) {
  const [rows, setRows] = useState<DeliveryProblem[] | null | 'loading'>('loading');
  useEffect(() => {
    let live = true;
    void deliveryProblems(campaignId).then((r) => { if (live) setRows(r); });
    return () => { live = false; };
  }, [campaignId]);
  if (rows === 'loading') return <Skeleton className="h-10 w-full" />;
  if (rows === null) return <p className="text-xs text-danger">{t('Who it did not reach could not be read.')}</p>;
  if (rows.length === 0) return null;
  return (
    <div className="grid gap-1" data-newsletter-undelivered>
      <p className="label">{t('Not delivered')}</p>
      <ul className="grid gap-1 text-haze">
        {rows.map((d) => (
          <li key={d.subscriber_id} className="break-words">
            <span className="text-paper">{d.subscriber?.email ?? '—'}</span>
            {' · '}
            {d.status === 'skipped'
              ? t('skipped: they left before their turn')
              : t('refused after {n} tries', { n: d.attempts })}
            {d.status === 'failed' && d.last_error && <span className="t-note"> · {d.last_error}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ============================================ announcements (…000200) */

const modeHint = (m: AutoAnnounce) =>
  m === 'send' ? t('Each language with confirmed subscribers gets it at once. It shows under Campaigns, marked Automatic.')
    : m === 'draft' ? t('A draft per language waits under Campaigns, marked Automatic. Nothing goes out until you send it.')
      : t('New articles and case studies are only remembered: nothing is sent or drafted.');

function announcedOutcome(r: Announced): string {
  if (r.baseline) return t('Already on the site at launch — not announced');
  if (r.campaigns === 0) return t('no campaign');
  return r.campaigns === 1 ? t('1 campaign') : t('{n} campaigns', { n: r.campaigns });
}

/** New articles and case studies: announced, drafted or ignored, and what has been seen. */
function AnnouncementsPanel({ reloadToken }: { reloadToken: number }) {
  const a = useAnnouncements(reloadToken);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const change = async (next: AutoAnnounce) => {
    if (next === a.mode) return;
    const before = a.mode;
    a.setMode(next);
    setBusy(true);
    setStatus(null);
    const r = await saveAutoAnnounce(next);
    setBusy(false);
    if (r.ok) setStatus({ ok: true, text: t('Saved.') });
    else { a.setMode(before); setStatus({ ok: false, text: automationFailureText(r.failure) }); }
  };
  return (
    <Panel className="min-w-0" aria-label={t('Automatic announcements')}>
      <SectionHeader title={t('Automatic announcements')} note={t('new articles and case studies')} />
      {a.state === 'loading' && <div className="p-4"><Skeleton className="h-16 w-full" /></div>}
      {a.state === 'unconfigured' && <DataState kind="unconfigured" title={t('Not connected')} />}
      {a.state === 'missing' && <p className="px-4 py-3 text-[13px] text-haze">{t('This feature is not installed on the database yet (20261019000200).')}</p>}
      {a.state === 'error' && <ErrorState message={t('The announcement settings could not be read.')} onRetry={a.reload} />}
      {a.state === 'ready' && (
        <>
          <div className="grid gap-2 px-4 py-3 text-[13px]" data-newsletter-announce={a.mode}>
            <p className="t-note">{t('When a new article or case study is published on the site, it is announced to the subscribers of each language within ten minutes. What was already on the site when this started is only remembered, never announced.')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="label" htmlFor="nl-announce">{t('When something new is published')}</label>
              <Select id="nl-announce" value={a.mode} disabled={busy} onChange={(e) => void change(e.target.value as AutoAnnounce)}>
                <option value="send">{t('Send at once')}</option>
                <option value="draft">{t('Only make a draft')}</option>
                <option value="off">{t('Off')}</option>
              </Select>
              {busy && <span className="t-note">{t('Saving…')}</span>}
              {status && <span role="status" className={status.ok ? 'text-xs text-good' : 'text-xs text-danger'}>{status.text}</span>}
            </div>
            <p className="t-note">{modeHint(a.mode)}</p>
          </div>
          <div className="border-t border-hairline">
            <p className="label px-4 pt-3">{t('Seen on the site, newest first')}</p>
            {a.rows.length === 0
              ? <p className="px-4 py-3 text-[13px] text-haze">{t('Nothing seen yet. The site’s list is read every ten minutes; the first reading is only remembered.')}</p>
              : (
                <ul className="divide-y divide-hairline" data-newsletter-announced>
                  {a.rows.map((r) => (
                    <li key={r.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-[13px]" data-newsletter-announced-key={r.key}>
                      <Badge>{r.type === 'post' ? t('Article') : t('Case study')}</Badge>
                      <span className="min-w-0 break-all font-data text-[12px] text-paper">{r.key}</span>
                      <span className="text-haze">{t('first seen {when}', { when: formatMoment(r.first_seen_at) })}</span>
                      <span className="t-note">{announcedOutcome(r)}</span>
                    </li>
                  ))}
                </ul>
              )}
            {a.rows.length >= ANNOUNCED_SHOWN && <p className="px-4 pb-3 t-note">{t('The newest {n} are shown.', { n: ANNOUNCED_SHOWN })}</p>}
          </div>
        </>
      )}
    </Panel>
  );
}

/* =============================================== welcome series (…000200) */

interface StepForm { position: string; delay: string; subject: string; preheader: string; body: string; enabled: boolean }
const formOf = (s: SeriesStep): StepForm => ({
  position: String(s.position), delay: String(s.delay_days), subject: s.subject, preheader: s.preheader ?? '', body: s.body, enabled: s.enabled,
});
const sameForm = (a: StepForm | null, b: StepForm) =>
  !!a && a.position === b.position && a.delay === b.delay && a.subject === b.subject && a.preheader === b.preheader
  && a.body === b.body && a.enabled === b.enabled;
const draftOf = (f: StepForm): StepDraft => ({
  position: Number(f.position.trim() || NaN), delay_days: Number(f.delay.trim() || NaN),
  subject: f.subject, preheader: f.preheader, body: f.body, enabled: f.enabled,
});

/** A switched-on step whose day is not after the switched-on step before it: due before its turn comes. */
function earlySteps(steps: SeriesStep[]): Set<string> {
  const early = new Set<string>();
  let before: SeriesStep | null = null;
  for (const s of steps) {
    if (!s.enabled) continue;
    if (before && s.delay_days <= before.delay_days) early.add(s.id);
    before = s;
  }
  return early;
}

interface StepOpen { key: number; id: string | null; initial: SeriesStep | null; start: StepForm }

/** The e-mails after the welcome, per language, each on its day after the subscriber confirmed. */
function SeriesPanel({ reloadToken }: { reloadToken: number }) {
  const [tick, setTick] = useState(0);
  const series = useSeries(reloadToken + tick);
  const [lang, setLang] = useState<NewsletterLocale>('hu');
  const [editor, setEditor] = useState<StepOpen | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = useRef(false);
  const steps = useMemo(() => series.rows.filter((s) => s.locale === lang), [series.rows, lang]);
  const on = steps.filter((s) => s.enabled).length;
  const next = nextPosition(steps);
  const early = useMemo(() => earlySteps(steps), [steps]);

  /** May the open editor go? Asks when it has unsaved changes. */
  const mayLeave = () => {
    if (dirty.current && !window.confirm(t('Discard the changes you have not saved?'))) return false;
    dirty.current = false;
    return true;
  };
  const choose = (l: NewsletterLocale) => {
    if (l === lang || !mayLeave()) return;
    setEditor(null);
    setNotice(null);
    setLang(l);
  };
  const open = (s: SeriesStep | null) => {
    if (editor && s && editor.id === s.id) return;
    if (editor && !s && editor.id === null) return;
    if (!mayLeave()) return;
    setNotice(null);
    if (s) { setEditor({ key: Date.now(), id: s.id, initial: s, start: formOf(s) }); return; }
    if (next === null) return;
    const last = steps[steps.length - 1];
    const delay = Math.min(SERIES_LIMITS.delayMax, last ? last.delay_days + 7 : 3);
    setEditor({
      key: Date.now(), id: null, initial: null,
      start: { position: String(next), delay: String(delay), subject: '', preheader: '', body: '', enabled: false },
    });
  };
  const close = () => { dirty.current = false; setEditor(null); };

  const note = series.state !== 'ready' ? undefined
    : steps.length === 0 ? t('no steps in this language')
      : t('{on} of {n} switched on', { on, n: steps.length });

  return (
    <Panel className="min-w-0" aria-label={t('Welcome series')}>
      <SectionHeader title={t('Welcome series')} note={note}
        action={series.state === 'ready' ? (
          <Button size="sm" onClick={() => open(null)} disabled={next === null} data-newsletter-step-new
            title={next === null ? t('A series has at most {n} steps.', { n: SERIES_LIMITS.positions }) : undefined}>
            <Plus size={11} aria-hidden="true" /> {t('Add a step')}
          </Button>
        ) : undefined} />
      {series.state === 'loading' && <div className="p-4"><Skeleton className="h-24 w-full" /></div>}
      {series.state === 'unconfigured' && <DataState kind="unconfigured" title={t('Not connected')} />}
      {series.state === 'missing' && <p className="px-4 py-3 text-[13px] text-haze">{t('This feature is not installed on the database yet (20261019000200).')}</p>}
      {series.state === 'error' && <ErrorState message={t('The welcome series could not be read.')} onRetry={series.reload} />}
      {series.state === 'ready' && (
        <div data-newsletter-series={lang}>
          <div className="grid gap-2 border-b border-hairline px-4 py-3 text-[13px]">
            <div role="tablist" aria-label={t('Language of the series')} className="flex flex-wrap gap-px">
              {LOCALES.map((l) => {
                const of = series.rows.filter((s) => s.locale === l);
                const lit = of.filter((s) => s.enabled).length;
                return (
                  <button key={l} type="button" role="tab" aria-selected={l === lang} onClick={() => choose(l)}
                    title={t('{on} of {n} switched on', { on: lit, n: of.length })} data-newsletter-series-tab={l}
                    className={cn('rounded-sm px-2.5 py-1 text-[12px]', l === lang ? 'bg-flare text-paper' : 'text-haze hover:text-paper')}>
                    {langLabel(l)} <span className="font-data text-[10px] text-haze">{lit}/{of.length}</span>
                  </button>
                );
              })}
            </div>
            <p className="t-note">{t('Each confirmed subscriber gets the switched-on steps of their language in order, each on its day, counted from when they confirmed. A step more than 3 days overdue (one added later, say) is skipped, not sent late. Whoever had confirmed before the series existed gets none of it.')}</p>
          </div>
          {on === 0 && (
            <p role="status" className="border-b border-hairline px-4 py-2.5 text-[13px] text-paper" data-newsletter-series-off>
              <Badge tone="warn">{t('Off')}</Badge>{' '}
              {steps.length === 0
                ? t('The series is off in this language: it has no steps yet.')
                : t('The series is off in this language: no step is switched on. The drafts below are waiting to be read and switched on.')}
            </p>
          )}
          {notice && <p role="status" className="border-b border-hairline px-4 py-2 text-xs text-good">{notice}</p>}
          {steps.length > 0 && (
            <ul className="divide-y divide-hairline" data-newsletter-steps>
              {steps.map((s) => (
                <li key={s.id} className={cn('grid gap-2 px-4 py-3 text-[13px] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start', editor?.id === s.id && 'bg-flare')}
                    data-newsletter-step={s.id} data-enabled={s.enabled}>
                  <div className="grid min-w-0 gap-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-data text-[12px] text-haze">{s.position}.</span>
                      <span className="min-w-0 break-words text-paper">{s.subject}</span>
                      <Badge tone={s.enabled ? 'good' : 'neutral'}>{s.enabled ? t('Switched on') : t('Off')}</Badge>
                    </p>
                    <p className="break-words text-haze">
                      {t('day {n}', { n: s.delay_days })} · {t('edited {when}', { when: formatMoment(s.updated_at) })}
                    </p>
                    {early.has(s.id) && (
                      <p className="t-note text-signal">{t('Its day is not after the step before it, so it is already due when that one goes out: it follows right after, or is skipped if by then it is more than 3 days late.')}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <Button size="sm" onClick={() => open(s)} aria-pressed={editor?.id === s.id}>{t('Edit')}</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {editor && (
            <StepEditor key={editor.key} locale={lang} initial={editor.initial} start={editor.start}
              onDirty={(d) => { dirty.current = d; }}
              onClose={close}
              onSaved={(id) => { setEditor((e) => (e ? { ...e, id } : e)); setTick((x) => x + 1); }}
              onDeleted={() => { close(); setNotice(t('The step was deleted.')); setTick((x) => x + 1); }} />
          )}
        </div>
      )}
    </Panel>
  );
}

function StepEditor({ locale, initial, start, onDirty, onClose, onSaved, onDeleted }: {
  locale: NewsletterLocale; initial: SeriesStep | null; start: StepForm;
  onDirty: (dirty: boolean) => void; onClose: () => void; onSaved: (id: string) => void; onDeleted: () => void;
}) {
  const [id, setId] = useState<string | null>(initial?.id ?? null);
  const [form, setForm] = useState<StepForm>(start);
  const [saved, setSaved] = useState<StepForm | null>(initial ? start : null);
  const [savedAt, setSavedAt] = useState<string | null>(initial?.updated_at ?? null);
  const [busy, setBusy] = useState<null | 'save' | 'preview' | 'test' | 'delete'>(null);
  const [confirming, setConfirming] = useState<null | 'delete' | 'close'>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ answer: PreviewAnswer; of: StepForm } | null>(null);
  const top = useRef<HTMLDivElement>(null);

  // A new, untouched step is not "unsaved changes".
  const dirty = !sameForm(saved, form) && !(id === null && sameForm(start, form));
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, []);

  const set = (patch: Partial<StepForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setMessage(null);
    setConfirming(null);
  };
  const payload = () => ({ subject: form.subject.trim(), preheader: form.preheader.trim(), body: form.body, locale });
  /** Preview and test need only the e-mail itself. */
  const mailProblem = () => {
    const p = draftProblem(form);
    if (p) setMessage({ ok: false, text: problemText(p) });
    return p !== null;
  };

  const runSave = async () => {
    const p = stepProblem(draftOf(form));
    if (p) { setMessage({ ok: false, text: stepProblemText(p) }); return; }
    setBusy('save');
    setMessage(null);
    const r = await saveStep(id, locale, draftOf(form));
    setBusy(null);
    if (!r.ok) { setMessage({ ok: false, text: automationFailureText(r.failure) }); return; }
    setId(r.value.id);
    setSaved(form);
    setSavedAt(r.value.updated_at);
    onSaved(r.value.id);
    setMessage({ ok: true, text: r.value.enabled ? t('Saved. It is switched on.') : t('Saved. It stays switched off.') });
  };

  const runPreview = async () => {
    if (mailProblem()) return;
    setBusy('preview');
    setMessage(null);
    const of = form;
    const r = await newsletterApi<PreviewAnswer>('preview', payload());
    setBusy(null);
    if (r.ok && typeof r.body.html === 'string') setPreview({ answer: r.body, of });
    else setMessage({ ok: false, text: apiText(r) });
  };

  const runTest = async () => {
    if (mailProblem()) return;
    setBusy('test');
    setMessage(null);
    const r = await newsletterApi<TestAnswer>('test', payload());
    setBusy(null);
    setMessage(r.ok ? { ok: true, text: t('Sent to {to}.', { to: r.body.to }) } : { ok: false, text: apiText(r) });
  };

  const runDelete = async () => {
    if (!id) return;
    if (confirming !== 'delete') { setMessage(null); setConfirming('delete'); return; }
    setBusy('delete');
    const r = await deleteStep(id);
    setBusy(null);
    setConfirming(null);
    if (r.ok) onDeleted();
    else setMessage({ ok: false, text: automationFailureText(r.failure) });
  };

  const runClose = () => {
    if (dirty && confirming !== 'close') { setConfirming('close'); return; }
    onClose();
  };

  const title = id ? t('Step {n}', { n: saved?.position ?? form.position }) : t('New step');
  const note = dirty ? t('Not saved yet')
    : savedAt && id ? t('Saved {when}', { when: formatMoment(savedAt) }) : undefined;
  const stale = !!preview && !sameForm(preview.of, form);

  return (
    <div ref={top} className="scroll-mt-20 border-t border-hairline">
      <SectionHeader level={3} title={`${title} · ${langLabel(locale)}`} note={note}
        action={<Button size="sm" variant="quiet" onClick={runClose}>{confirming === 'close' ? t('Discard changes') : t('Close')}</Button>} />
      <div className="grid gap-4 px-4 py-3 text-[13px]" data-newsletter-step-editor={id ?? 'new'}>
        {confirming === 'close' && (
          <p role="status" className="text-xs text-signal">
            {t('The changes are not saved.')}{' '}
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => setConfirming(null)}>{t('Keep editing')}</button>
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="nl-step-position" label={t('Position')} hint={t('The order of the e-mails, 1 to {max}.', { max: SERIES_LIMITS.positions })}>
            <Input id="nl-step-position" type="number" inputMode="numeric" min={1} max={SERIES_LIMITS.positions} step={1}
              className="sm:w-32" value={form.position} onChange={(e) => set({ position: e.target.value })} />
          </Field>
          <Field id="nl-step-delay" label={t('Day')} hint={t('Days after they confirmed, {min} to {max}.', { min: SERIES_LIMITS.delayMin, max: SERIES_LIMITS.delayMax })}>
            <Input id="nl-step-delay" type="number" inputMode="numeric" min={SERIES_LIMITS.delayMin} max={SERIES_LIMITS.delayMax} step={1}
              className="sm:w-32" value={form.delay} onChange={(e) => set({ delay: e.target.value })} />
          </Field>
        </div>
        <Field id="nl-step-subject" label={t('Subject')} hint={t('{n} of {max} characters', { n: form.subject.trim().length, max: LIMITS.subject })}>
          <Input id="nl-step-subject" value={form.subject} maxLength={LIMITS.subject} onChange={(e) => set({ subject: e.target.value })} />
        </Field>
        <Field id="nl-step-preheader" label={t('Preheader (optional)')} hint={t('Shown after the subject in the inbox.')}>
          <Input id="nl-step-preheader" value={form.preheader} maxLength={LIMITS.preheader} onChange={(e) => set({ preheader: e.target.value })} />
        </Field>
        <Field id="nl-step-body" label={t('Text')}>
          <Textarea id="nl-step-body" rows={14} className="min-h-[18rem] font-data text-[12px] leading-relaxed" value={form.body}
            spellCheck onChange={(e) => set({ body: e.target.value })} />
        </Field>
        <FormatHelp />
        <div className="grid gap-1">
          <label className="flex items-center gap-2 text-paper">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })}
              className="h-3.5 w-3.5 accent-signal" data-newsletter-step-enabled />
            {t('Switched on')}
          </label>
          <p className="t-note">{t('Only switched-on steps are sent. Read it and send a test to yourself before you switch it on.')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={() => void runSave()} disabled={busy !== null || (!!id && !dirty)} data-newsletter-step-save>
            {busy === 'save' ? t('Saving…') : t('Save')}
          </Button>
          <Button size="sm" onClick={() => void runPreview()} disabled={busy !== null} data-newsletter-step-preview>
            {busy === 'preview' ? t('Rendering…') : t('Preview')}
          </Button>
          <Button size="sm" onClick={() => void runTest()} disabled={busy !== null} data-newsletter-step-test>
            {busy === 'test' ? t('Sending…') : t('Send a test to me')}
          </Button>
          {id && (
            <Button size="sm" variant="danger" className="sm:ml-auto" onClick={() => void runDelete()} disabled={busy !== null} data-newsletter-step-delete>
              {confirming === 'delete' ? t('Confirm delete') : t('Delete step')}
            </Button>
          )}
          {confirming === 'delete' && busy === null && <Button size="sm" variant="quiet" onClick={() => setConfirming(null)}>{t('Keep it')}</Button>}
        </div>
        {confirming === 'delete' && <p className="t-note">{t('Whoever has not got it yet will not get it. This cannot be undone.')}</p>}
        {message && <p role="status" className={message.ok ? 'text-xs text-good' : 'text-xs text-danger'}>{message.text}</p>}

        {preview && <div data-newsletter-step-preview-frame><Preview answer={preview.answer} stale={stale} /></div>}
      </div>
    </div>
  );
}

/* ========================================================= subscribers */

type Filter = 'confirmed' | 'pending' | 'unsubscribed' | 'bounced' | 'all';
const inFilter = (f: Filter, s: Subscriber) =>
  f === 'all' || s.status === f || (f === 'bounced' && s.status === 'complained');

function SubscribersPanel({ subs, onChanged }: { subs: ReturnType<typeof useSubscribers>; onChanged: () => void }) {
  const [filter, setFilter] = useState<Filter>('confirmed');
  const [query, setQuery] = useState('');
  const { counts } = subs;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return subs.rows.filter((s) => inFilter(filter, s) && (!q || s.email.includes(q)));
  }, [subs.rows, filter, query]);
  const total = counts.confirmed + counts.pending + counts.unsubscribed + counts.bounced + counts.complained;

  return (
    <Panel className="min-w-0" aria-label={t('Subscribers')}>
      <SectionHeader title={t('Subscribers')} note={t('Only confirmed addresses get campaigns')} />
      {subs.state === 'loading' && <div className="p-4"><Skeleton className="h-24 w-full" /></div>}
      {subs.state === 'unconfigured' && <DataState kind="unconfigured" title={t('Not connected')} />}
      {subs.state === 'missing' && <p className="px-4 py-3 text-[13px] text-haze">{t('This feature is not installed on the database yet (20261019000100).')}</p>}
      {subs.state === 'error' && <ErrorState message={t('The subscribers could not be read.')} onRetry={subs.reload} />}
      {subs.state === 'ready' && (
        <>
          <div className="grid grid-cols-2 divide-x divide-y divide-hairline border-b border-hairline sm:grid-cols-4 sm:divide-y-0" data-newsletter-counts>
            <MetricCell label={t('Confirmed')} value={counts.confirmed}
              note={`HU ${counts.confirmedBy.hu} · EN ${counts.confirmedBy.en} · DE ${counts.confirmedBy.de}`}
              selected={filter === 'confirmed'} onSelect={() => setFilter('confirmed')} />
            <MetricCell label={t('Pending')} value={counts.pending} note={t('not confirmed yet')}
              selected={filter === 'pending'} onSelect={() => setFilter('pending')} />
            <MetricCell label={t('Unsubscribed')} value={counts.unsubscribed}
              selected={filter === 'unsubscribed'} onSelect={() => setFilter('unsubscribed')} />
            <MetricCell label={t('Bounced or spam')} value={counts.bounced + counts.complained}
              selected={filter === 'bounced'} onSelect={() => setFilter('bounced')} />
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2.5">
            <label className="sr-only" htmlFor="nl-filter">{t('Status')}</label>
            <Select id="nl-filter" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="confirmed">{t('Confirmed')}</option>
              <option value="pending">{t('Pending')}</option>
              <option value="unsubscribed">{t('Unsubscribed')}</option>
              <option value="bounced">{t('Bounced or spam')}</option>
              <option value="all">{t('Everyone')}</option>
            </Select>
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Search e-mail…')} aria-label={t('Search subscribers')}
              className="h-7 w-full py-1 text-xs sm:w-56" />
            <span className="t-note">{t('{n} shown', { n: shown.length })}</span>
          </div>
          {subs.capped && (
            <p className="border-b border-hairline px-4 py-2 t-note">
              {t('The list holds the newest {n} of {total}; the counts cover everyone.', { n: SUBSCRIBER_CAP, total })}
            </p>
          )}
          {shown.length === 0
            ? <p className="px-4 py-3 text-[13px] text-haze">{query.trim() ? t('No address matches.') : t('Nobody here yet.')}</p>
            : (
              <ul className="divide-y divide-hairline" data-newsletter-subscribers>
                {shown.map((s) => <SubscriberRow key={s.id} s={s} onChanged={onChanged} />)}
              </ul>
            )}
        </>
      )}
    </Panel>
  );
}

/** For a pending address: where its confirmation e-mail is. */
function confirmation(s: Subscriber): { tone: 'bad' | 'note'; text: string } | null {
  if (s.status !== 'pending') return null;
  if (s.confirm_error && !s.confirm_sent_at) return { tone: 'bad', text: t('The confirmation e-mail failed: {error}', { error: s.confirm_error }) };
  if (s.confirm_sent_at) {
    return { tone: 'note', text: t('Confirmation e-mail sent {when}. Deleted on {date} unless they confirm.', {
      when: formatMoment(s.confirm_sent_at), date: formatDay(purgeDate(s)),
    }) };
  }
  if (s.confirm_requested_at) return { tone: 'note', text: t('Confirmation e-mail on its way (asked {when}).', { when: formatMoment(s.confirm_requested_at) }) };
  return { tone: 'note', text: t('Never asked to confirm: gets nothing.') };
}

function SubscriberRow({ s, onChanged }: { s: Subscriber; onChanged: () => void }) {
  const [confirming, setConfirming] = useState<null | 'unsubscribe' | 'erase'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canLeave = s.status === 'pending' || s.status === 'confirmed';
  const act = async (what: 'unsubscribe' | 'erase') => {
    if (confirming !== what) { setConfirming(what); setError(null); return; }
    setBusy(true);
    setError(null);
    const r = what === 'erase' ? await eraseSubscriber(s.id) : await adminUnsubscribe(s.id);
    setBusy(false);
    setConfirming(null);
    if (r.ok) onChanged();
    else setError(what === 'erase' && r.failure === 'forbidden' ? t('Not erased: it is gone already, or your account may not erase.') : failureText(r.failure));
  };
  const meta = [
    langLabel(s.locale),
    sourceLabel(s.source) + (s.source_route ? ` ${s.source_route}` : ''),
    t('signed up {date}', { date: formatDay(s.created_at) }),
    s.confirmed_at ? t('confirmed {date}', { date: formatDay(s.confirmed_at) }) : '',
    s.unsubscribed_at ? t('left {date}', { date: formatDay(s.unsubscribed_at) }) + (s.unsubscribe_source ? ` (${leftHow(s.unsubscribe_source)})` : '') : '',
  ].filter(Boolean);
  const c = confirmation(s);
  return (
    <li className="grid gap-2 px-4 py-3 text-[13px] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start" data-newsletter-subscriber={s.id} data-status={s.status}>
      <div className="grid min-w-0 gap-1">
        <p className="flex flex-wrap items-center gap-2">
          <a className="min-w-0 break-all text-paper hover:underline" href={`mailto:${s.email}`}>{s.email}</a>
          <Badge tone={SUBSCRIBER_BADGE[s.status]}>{subscriberStatus(s.status)}</Badge>
        </p>
        <p className="break-words text-haze">{meta.join(' · ')}</p>
        {c && <p className={c.tone === 'bad' ? 'break-words text-xs text-danger' : 't-note break-words'}>{c.text}</p>}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {canLeave && confirming !== 'erase' && (
          <Button size="sm" onClick={() => void act('unsubscribe')} disabled={busy} data-newsletter-unsubscribe>
            {confirming === 'unsubscribe' ? t('Confirm unsubscribe') : t('Unsubscribe')}
          </Button>
        )}
        {confirming !== 'unsubscribe' && (
          <Button size="sm" variant="danger" onClick={() => void act('erase')} disabled={busy} title={t('For erasure requests')} data-newsletter-erase>
            {confirming === 'erase' ? t('Confirm erase') : t('Erase')}
          </Button>
        )}
        {confirming && !busy && <Button size="sm" variant="quiet" onClick={() => setConfirming(null)}>{t('Keep it')}</Button>}
      </div>
      {confirming === 'unsubscribe' && (
        <p className="t-note sm:col-span-2">{t('They get nothing more, and anything queued for them is skipped. They can sign up again on the website.')}</p>
      )}
      {confirming === 'erase' && (
        <p className="t-note sm:col-span-2">{t('For an erasure request: the address and the record of what was sent to it are deleted for good. To only stop the e-mails, unsubscribe instead.')}</p>
      )}
    </li>
  );
}
