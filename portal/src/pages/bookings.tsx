import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Video } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useScope } from '@/lib/scope';
import { Badge, Button, DataState, ErrorState, Field, Input, Panel, SectionHeader, Select, Skeleton, cn } from '@/components/ui';
import { t } from '@/lib/i18n';
import { safeHttpsUrl } from '@/lib/meetings';
import {
  bookingApi, formatIn, formatSpan, isUpcoming, saveBookingSettings, useBookingSettings, useBookings,
  type Booking, type BookingSettings, type SettingsPatch, type SlotAnswer,
} from '@/lib/booking';

/**
 * BOOKINGS — the calls booked from the public page (/idopontfoglalas) and by
 * clients in their portal (20261018000100). Each one is already an event in
 * the owner's Google Calendar with a Meet link; Google sent the invitation.
 *
 * Three panels: whether the booking page can take bookings right now (asked of
 * /api/booking itself, so it reflects the server, the Google connection and the
 * rules at once), the diary, and the rules — which only the owner edits.
 */

const ZONE = 'Europe/Budapest';
// ISO weekdays, named by the browser in the reader's language (2026-11-02 is a Monday).
const weekdays = (): [number, string][] => [1, 2, 3, 4, 5, 6, 7].map((v) => [v, formatIn(`2026-11-0${v + 1}T12:00:00Z`, 'UTC', { weekday: 'short' }, 'en-GB')]);

/** What /api/booking's answer means for the owner, as one sentence and a tone. */
function readiness(a: { status: number; ok: boolean; code: string | null; body: Partial<SlotAnswer> } | null): { tone: 'good' | 'warn' | 'bad' | 'neutral'; text: string; settings?: boolean } {
  if (!a) return { tone: 'neutral', text: t('Checking…') };
  if (a.ok) {
    const n = a.body.slots?.length ?? 0;
    return n > 0
      ? { tone: 'good', text: t('Taking bookings: {n} free times in the coming weeks.', { n }) }
      : { tone: 'warn', text: t('Taking bookings, but there is no free time in the coming weeks.') };
  }
  switch (a.code) {
    case 'CALENDAR_NOT_CONNECTED': return { tone: 'bad', text: t('Not taking bookings: connect your Google account in Settings.'), settings: true };
    case 'CALENDAR_RECONNECT': return { tone: 'bad', text: t('Not taking bookings: connect Google again in Settings, so the booking page may see when you are busy.'), settings: true };
    case 'NOT_CONFIGURED': return { tone: 'bad', text: t('Not taking bookings: Google is not set up on the server yet (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKEN_KEY).') };
    case 'NOT_INSTALLED': return { tone: 'bad', text: t('Not taking bookings: this feature is not installed on the database yet (20261018000100).') };
    case 'BOOKING_OFF': return { tone: 'warn', text: t('Switched off: the booking page says online booking is not available.') };
    case 'CALENDAR_UNREACHABLE': return { tone: 'bad', text: t('Not taking bookings: Google Calendar could not be reached. Try again in a few minutes.') };
    default: return { tone: 'bad', text: t('The booking page could not be checked.') };
  }
}

function cancelRefusal(code: string | null): string {
  if (code === 'NOT_ACTIVE') return t('This booking is no longer active.');
  if (code === 'CALENDAR_FAILED' || code === 'CALENDAR_UNREACHABLE') return t('Google Calendar refused the change. Nothing was cancelled; try again.');
  if (code === 'CALENDAR_RECONNECT' || code === 'CALENDAR_NOT_CONNECTED') return t('Connect Google again in Settings, then cancel.');
  return t('The booking could not be cancelled. Try again.');
}

export function BookingsScreen() {
  const { profile } = useAuth();
  const { reloadToken } = useScope();
  const [tick, setTick] = useState(0);
  const diary = useBookings(reloadToken + tick);
  const rules = useBookingSettings(reloadToken + tick);
  const [check, setCheck] = useState<Awaited<ReturnType<typeof bookingApi<SlotAnswer>>> | null>(null);
  const [showPast, setShowPast] = useState(false);
  const isOwner = profile?.is_owner === true;

  useEffect(() => {
    let live = true;
    setCheck(null);
    void bookingApi<SlotAnswer>('GET').then((a) => { if (live) setCheck(a); });
    return () => { live = false; };
  }, [reloadToken, tick]);

  const ready = readiness(check);
  const upcoming = useMemo(() => diary.rows.filter((b) => b.status === 'confirmed' && isUpcoming(b)), [diary.rows]);
  const past = useMemo(() => diary.rows.filter((b) => !(b.status === 'confirmed' && isUpcoming(b))).reverse(), [diary.rows]);
  const publicUrl = `${window.location.origin}/idopontfoglalas`;

  return (
    <div className="grid gap-4">
      <Panel aria-label={t('Booking page')}>
        <SectionHeader title={t('Booking page')} note={t('Free Google Meet calls from your live calendar')} />
        <div className="grid gap-2 px-4 py-3 text-[13px]" data-booking-ready={check ? (check.ok ? 'ready' : check.code ?? 'error') : 'checking'}>
          <p className="text-paper"><Badge tone={ready.tone}>{ready.tone === 'good' ? t('Live') : ready.tone === 'neutral' ? t('Checking') : ready.tone === 'warn' ? t('Attention') : t('Off')}</Badge>{' '}{ready.text}</p>
          {ready.settings && <p><Link className="text-signal underline-offset-2 hover:underline" to="/settings">{t('Open Settings → Google')}</Link></p>}
          <p className="t-note">
            {t('Public page:')}{' '}
            <a className="text-paper underline-offset-2 hover:underline" href="/idopontfoglalas" target="_blank" rel="noopener noreferrer">{publicUrl} <ExternalLink size={10} className="inline" aria-hidden="true" /></a>
            {' · '}{t('Clients book in their portal, under {tab}.', { tab: '„Időpont”' })}
          </p>
          <p className="t-note">{t('Change a booking here, not by dragging it in Google Calendar: the portal and the free times follow what is booked here.')}</p>
        </div>
      </Panel>

      <Panel className="min-w-0" aria-label={t('Upcoming bookings')}>
        <SectionHeader title={t('Upcoming bookings')} note={diary.state === 'ready' ? t('{n} booked', { n: upcoming.length }) : undefined} />
        {diary.state === 'loading' && <div className="p-4"><Skeleton className="h-24 w-full" /></div>}
        {diary.state === 'unconfigured' && <DataState kind="unconfigured" title={t('Not connected')} />}
        {diary.state === 'missing' && <p className="px-4 py-3 text-[13px] text-haze">{t('This feature is not installed on the database yet (20261018000100).')}</p>}
        {diary.state === 'error' && <ErrorState message={t('The bookings could not be read.')} onRetry={diary.reload} />}
        {diary.state === 'ready' && upcoming.length === 0 && <p className="px-4 py-3 text-[13px] text-haze">{t('Nothing booked yet.')}</p>}
        {diary.state === 'ready' && upcoming.length > 0 && (
          <ul className="divide-y divide-hairline" data-bookings-upcoming>
            {upcoming.map((b) => <BookingRow key={b.id} b={b} onChanged={() => setTick((n) => n + 1)} />)}
          </ul>
        )}
      </Panel>

      {diary.state === 'ready' && past.length > 0 && (
        <Panel className="min-w-0" aria-label={t('Past and cancelled')}>
          <SectionHeader title={t('Past and cancelled')} note={t('the last 30 days')}
            action={<Button size="sm" variant="quiet" onClick={() => setShowPast((v) => !v)} aria-expanded={showPast}>{showPast ? t('Hide') : t('Show')}</Button>} />
          {showPast && <ul className="divide-y divide-hairline" data-bookings-past>{past.map((b) => <BookingRow key={b.id} b={b} />)}</ul>}
        </Panel>
      )}

      <RulesPanel state={rules.state} settings={rules.settings} editable={isOwner} onSaved={() => setTick((n) => n + 1)} />
    </div>
  );
}

function BookingRow({ b, onChanged }: { b: Booking; onChanged?: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = b.status === 'confirmed' && isUpcoming(b);
  const cancel = async () => {
    if (!confirming) { setConfirming(true); return; }
    setBusy(true);
    setError(null);
    const r = await bookingApi('POST', { action: 'cancel', id: b.id });
    setBusy(false);
    setConfirming(false);
    if (r.ok) onChanged?.();
    else setError(cancelRefusal(r.code));
  };
  const status = b.status === 'cancelled'
    ? t('Cancelled by {who}', { who: b.cancelled_by === 'owner' ? t('you') : b.cancelled_by === 'client' ? t('the client') : t('the guest') })
    : (isUpcoming(b) ? null : t('Took place'));
  return (
    <li className="grid gap-2 px-4 py-3 text-[13px] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start" data-booking-row={b.id}>
      <div className="grid min-w-0 gap-1">
        <p className={cn('text-paper', b.status === 'cancelled' && 'line-through decoration-haze')}>
          {formatSpan(b.starts_at, b.ends_at, b.time_zone || ZONE, 'en-GB')}
        </p>
        <p className="min-w-0 break-words">
          <span className="text-paper">{b.guest_name}</span>
          {b.guest_company && <span className="text-haze"> · {b.guest_company}</span>}
          <span className="text-haze"> · <a className="hover:text-paper" href={`mailto:${b.guest_email}`}>{b.guest_email}</a></span>
          {b.guest_phone && <span className="text-haze"> · {b.guest_phone}</span>}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-haze">
          <Badge tone="neutral">{b.kind === 'client' ? t('Client') : t('Public')}</Badge>
          {b.kind === 'client' && b.project_id && <Link className="hover:text-paper" to={`/projects/${b.project_id}`}>{b.project?.name ?? t('Project')}</Link>}
          {b.kind === 'public' && b.lead_id && <Link className="hover:text-paper" to={`/leads/${b.lead_id}`}>{t('Lead')}</Link>}
          {b.moved_count > 0 && <span>{t('moved {n}×', { n: b.moved_count })}</span>}
          {status && <span>{status}</span>}
        </p>
        {b.topic && <p className="t-note whitespace-pre-line break-words">{b.topic}</p>}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
      {live && (
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {b.meet_url && (
            <a className="inline-flex items-center gap-1.5 rounded-sm border border-hair px-2.5 py-1.5 font-data text-[10px] uppercase tracking-[0.14em] text-paper hover:bg-flare"
               href={safeHttpsUrl(b.meet_url)} target="_blank" rel="noopener noreferrer"><Video size={11} aria-hidden="true" /> {t('Join')}</a>
          )}
          <Button size="sm" variant="danger" onClick={cancel} disabled={busy} data-booking-cancel>
            {confirming ? t('Confirm cancel') : t('Cancel')}
          </Button>
          {confirming && !busy && <Button size="sm" variant="quiet" onClick={() => setConfirming(false)}>{t('Keep it')}</Button>}
        </div>
      )}
    </li>
  );
}

/* ================================================================ rules */

const hhmm = (time: string) => time.slice(0, 5);

function RulesPanel({ state, settings, editable, onSaved }: {
  state: string; settings: BookingSettings | null; editable: boolean; onSaved: () => void;
}) {
  const [draft, setDraft] = useState<SettingsPatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!settings) return;
    setDraft({
      enabled: settings.enabled, weekdays: [...settings.weekdays], day_start: hhmm(settings.day_start), day_end: hhmm(settings.day_end),
      public_minutes: settings.public_minutes, client_minutes: [...settings.client_minutes], buffer_minutes: settings.buffer_minutes,
      notice_hours: settings.notice_hours, horizon_days: settings.horizon_days, daily_max: settings.daily_max, change_hours: settings.change_hours,
    });
  }, [settings]);

  if (state === 'loading') return <Panel><div className="p-4"><Skeleton className="h-24 w-full" /></div></Panel>;
  if (state !== 'ready' || !settings || !draft) return null;
  const set = (patch: SettingsPatch) => { setDraft((d) => ({ ...d, ...patch })); setMessage(null); };
  const toggle = (list: number[] = [], v: number) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v].sort((a, b) => a - b));
  const num = (v: string) => Number.parseInt(v, 10);

  const save = async () => {
    const d = draft;
    if (!d.weekdays?.length) return setMessage({ ok: false, text: t('Choose at least one day.') });
    if (!d.client_minutes?.length) return setMessage({ ok: false, text: t('Choose at least one length for clients.') });
    if (!d.day_start || !d.day_end || d.day_end <= d.day_start) return setMessage({ ok: false, text: t('The day must end after it starts.') });
    setBusy(true);
    const code = await saveBookingSettings(d);
    setBusy(false);
    if (code === null) { setMessage({ ok: true, text: t('Saved. The booking page uses the new rules at once.') }); onSaved(); return; }
    setMessage({ ok: false, text: code === '23514' ? t('These values are not allowed: times on the quarter hour, sensible limits.') : code === '42501' ? t('Only the portal owner can change the rules.') : t('The rules could not be saved. Try again.') });
  };

  const disabled = !editable || busy;
  return (
    <Panel aria-label={t('Rules')}>
      <SectionHeader title={t('Rules')} note={editable ? t('Budapest time') : t('Only the portal owner changes these')} />
      <div className="grid gap-4 px-4 py-3 text-[13px]" data-booking-rules>
        <label className="flex items-center gap-2 text-paper">
          <input type="checkbox" checked={!!draft.enabled} disabled={disabled} onChange={(e) => set({ enabled: e.target.checked })} />
          {t('Online booking is on')}
        </label>
        <fieldset className="grid gap-1.5">
          <legend className="label">{t('Days')}</legend>
          <div className="flex flex-wrap gap-3">
            {weekdays().map(([v, label]) => (
              <label key={v} className="flex items-center gap-1.5">
                <input type="checkbox" checked={draft.weekdays?.includes(v) ?? false} disabled={disabled} onChange={() => set({ weekdays: toggle(draft.weekdays, v) })} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="bk-start" label={t('From')}><Input id="bk-start" type="time" step={900} value={draft.day_start ?? ''} disabled={disabled} onChange={(e) => set({ day_start: e.target.value })} /></Field>
          <Field id="bk-end" label={t('Until')}><Input id="bk-end" type="time" step={900} value={draft.day_end ?? ''} disabled={disabled} onChange={(e) => set({ day_end: e.target.value })} /></Field>
          <Field id="bk-public" label={t('Public call length')}>
            <Select id="bk-public" value={String(draft.public_minutes)} disabled={disabled} onChange={(e) => set({ public_minutes: num(e.target.value) })}>
              {[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{t('{n} minutes', { n: m })}</option>)}
            </Select>
          </Field>
          <fieldset className="grid gap-1.5">
            <legend className="label">{t('Client call lengths')}</legend>
            <div className="flex flex-wrap gap-3">
              {[15, 30, 45, 60, 90].map((m) => (
                <label key={m} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={draft.client_minutes?.includes(m) ?? false} disabled={disabled} onChange={() => set({ client_minutes: toggle(draft.client_minutes, m) })} />
                  {t('{n} min', { n: m })}
                </label>
              ))}
            </div>
          </fieldset>
          <Field id="bk-buffer" label={t('Gap between bookings (minutes)')}><Input id="bk-buffer" type="number" min={0} max={120} value={draft.buffer_minutes ?? 0} disabled={disabled} onChange={(e) => set({ buffer_minutes: num(e.target.value) })} /></Field>
          <Field id="bk-notice" label={t('Earliest: hours ahead')}><Input id="bk-notice" type="number" min={0} max={336} value={draft.notice_hours ?? 0} disabled={disabled} onChange={(e) => set({ notice_hours: num(e.target.value) })} /></Field>
          <Field id="bk-horizon" label={t('Latest: days ahead')}><Input id="bk-horizon" type="number" min={1} max={180} value={draft.horizon_days ?? 1} disabled={disabled} onChange={(e) => set({ horizon_days: num(e.target.value) })} /></Field>
          <Field id="bk-daily" label={t('Most bookings a day')}><Input id="bk-daily" type="number" min={1} max={20} value={draft.daily_max ?? 1} disabled={disabled} onChange={(e) => set({ daily_max: num(e.target.value) })} /></Field>
          <Field id="bk-change" label={t('Guests may cancel or move until (hours before)')}><Input id="bk-change" type="number" min={0} max={168} value={draft.change_hours ?? 0} disabled={disabled} onChange={(e) => set({ change_hours: num(e.target.value) })} /></Field>
        </div>
        <p className="t-note">
          {t('Only your primary Google calendar counts as busy. An all-day event counts only if it is set to “Busy” in Google Calendar (all-day events are “Free” by default).')}
          {' '}{t('Last changed: {when}', { when: formatIn(settings.updated_at, ZONE, { dateStyle: 'medium', timeStyle: 'short' }, 'en-GB') })}
        </p>
        {editable && <Button size="sm" variant="primary" className="justify-self-start" onClick={save} disabled={busy}>{t('Save rules')}</Button>}
        {message && <p role="status" className={message.ok ? 'text-xs text-good' : 'text-xs text-danger'}>{message.text}</p>}
      </div>
    </Panel>
  );
}
