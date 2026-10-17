import { useMemo, useState } from 'react';
import { Video } from 'lucide-react';
import { Badge, Button, DataState, ErrorState, Panel, SectionHeader, Select, Skeleton, cn } from '@/components/ui';
import { useRpc } from '@/lib/clientPortal';
import { bookingApi, formatIn, formatSpan, groupByDay, useSlots, type ClientBooking, type Slot } from '@/lib/booking';
import { t } from '@/lib/i18n';
import { safeHttpsUrl } from '@/lib/meetings';

/**
 * IDŐPONT — a client books a Google Meet call with us, as themselves, for
 * their project (20261018000100). The free times come live from our calendar
 * (/api/booking); a booking lands in our Google Calendar and Google sends the
 * invitation to the client's account address. Their own bookings are listed
 * above, with "move" and "cancel" while there is still time.
 */

const TOUCH = 'max-sm:min-h-10 max-sm:min-w-10';
const DAYS_SHOWN = 10;

/** /api/booking's refusal as a sentence for the client. */
function refusal(code: string | null, status: number): string {
  switch (code) {
    case 'TAKEN': return t('Ezt az időpontot közben lefoglalták. Válassz egy másikat.');
    case 'UNAVAILABLE': return t('Ez az időpont már nem foglalható. Válassz egy másikat.');
    case 'CLIENT_LIMIT': return t('Egyszerre legfeljebb három nyitott foglalásod lehet.');
    case 'TOO_LATE': return t('Ez már túl közel van ahhoz, hogy online módosítsd. Írj nekünk.');
    case 'NOT_ACTIVE': return t('Ez a foglalás már nem él.');
    case 'FORBIDDEN': return t('Ehhez már nincs hozzáférésed.');
    case 'RATE_LIMITED': return t('Túl sok próbálkozás. Várj néhány percet, és próbáld újra.');
    default:
      if (status === 503) return t('Az online foglalás most nem elérhető. Írj nekünk, és egyeztetünk időpontot.');
      return t('Nem sikerült. Próbáld újra.');
  }
}

export function BookingPage() {
  const [tick, setTick] = useState(0);
  const mine = useRpc<ClientBooking>('client_portal_bookings', tick);
  const [moving, setMoving] = useState<ClientBooking | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const changed = (text: string) => { setDone(text); setMoving(null); setTick((n) => n + 1); };
  const upcoming = mine.rows.filter((b) => Date.parse(b.ends_at) > Date.now());

  return (
    <>
      <Panel aria-label={t('Foglalásaid')}>
        <SectionHeader title={t('Foglalásaid')} />
        {mine.state === 'loading' && <div className="p-4"><Skeleton className="h-16 w-full" /></div>}
        {mine.state === 'unconfigured' && <DataState kind="unconfigured" title={t('Nincs kapcsolat')} />}
        {mine.state === 'error' && <ErrorState message={t('A foglalásaid nem tölthetők be.')} onRetry={mine.reload} />}
        {mine.state === 'ready' && upcoming.length === 0 && <p className="px-4 py-3 text-[13px] text-haze">{t('Még nincs foglalásod. Lent választhatsz időpontot.')}</p>}
        {mine.state === 'ready' && upcoming.length > 0 && (
          <ul className="divide-y divide-hairline" data-client-bookings>
            {upcoming.map((b) => <MyBooking key={b.booking_id} b={b} onMove={() => { setDone(null); setMoving(b); }} onChanged={changed} />)}
          </ul>
        )}
        {done && <p role="status" className="px-4 pb-3 text-xs text-good">{done}</p>}
      </Panel>
      <NewBooking moving={moving} onCancelMove={() => setMoving(null)} onDone={changed} />
    </>
  );
}

function MyBooking({ b, onMove, onChanged }: { b: ClientBooking; onMove: () => void; onChanged: (text: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = async () => {
    if (!confirming) { setConfirming(true); return; }
    setBusy(true);
    setError(null);
    const r = await bookingApi('POST', { action: 'cancel', id: b.booking_id });
    setBusy(false);
    setConfirming(false);
    if (r.ok) onChanged(t('Lemondtuk. A Google értesítést küld róla.'));
    else setError(refusal(r.code, r.status));
  };
  const cancelled = b.status === 'cancelled';
  return (
    <li className="grid gap-2 px-4 py-3 text-[13px]" data-client-booking={b.booking_id}>
      <p className={cn('text-paper', cancelled && 'line-through decoration-haze')}>{formatSpan(b.starts_at, b.ends_at, b.time_zone)}</p>
      <p className="flex flex-wrap items-center gap-2 text-haze">
        {cancelled && <Badge tone="warn">{t('Lemondva')}</Badge>}
        {b.project_name && <span>{b.project_name}</span>}
        {b.topic && <span className="break-words">· {b.topic}</span>}
      </p>
      {!cancelled && (
        <div className="flex flex-wrap gap-2">
          {b.meet_url && (
            <a className={cn('inline-flex items-center gap-1.5 rounded-sm border border-hair px-2.5 py-1.5 font-data text-[10px] uppercase tracking-[0.14em] text-paper hover:bg-flare', TOUCH)}
               href={safeHttpsUrl(b.meet_url)} target="_blank" rel="noopener noreferrer"><Video size={11} aria-hidden="true" /> {t('Csatlakozás')}</a>
          )}
          {b.can_change && <Button size="sm" className={TOUCH} onClick={onMove} disabled={busy}>{t('Áthelyezés')}</Button>}
          {b.can_change && (
            <Button size="sm" variant="danger" className={TOUCH} onClick={cancel} disabled={busy} data-client-booking-cancel>
              {confirming ? t('Biztosan lemondod?') : t('Lemondás')}
            </Button>
          )}
          {!b.can_change && <p className="t-note">{t('Ez már nem módosítható online. Ha közbejött valami, írj nekünk.')}</p>}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </li>
  );
}

function NewBooking({ moving, onCancelMove, onDone }: { moving: ClientBooking | null; onCancelMove: () => void; onDone: (text: string) => void }) {
  const [minutes, setMinutes] = useState<number | null>(null);
  const length = moving ? Math.round((Date.parse(moving.ends_at) - Date.parse(moving.starts_at)) / 60000) : minutes;
  const [tick, setTick] = useState(0);
  const { answer } = useSlots(length, tick);
  const [day, setDay] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [chosen, setChosen] = useState<Slot | null>(null);
  const [project, setProject] = useState('');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zone = answer?.body.timeZone ?? 'Europe/Budapest';
  const days = useMemo(() => groupByDay(answer?.ok ? answer.body.slots ?? [] : [], zone), [answer, zone]);
  const current = days.find((d) => d.key === day) ?? days[0];
  const projects = answer?.body.projects ?? [];
  const options = answer?.body.options ?? [];

  const book = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    const r = moving
      ? await bookingApi('POST', { action: 'move', id: moving.booking_id, start: chosen.start })
      : await bookingApi('POST', { action: 'book', start: chosen.start, minutes: length ?? options[0], topic, projectId: project || undefined, locale: 'hu' });
    setBusy(false);
    if (r.ok) {
      const span = formatSpan(chosen.start, chosen.end, zone);
      setChosen(null);
      setTopic('');
      setTick((n) => n + 1);
      onDone(moving ? t('Áthelyeztük: {when}. A Google elküldi a frissített meghívót.', { when: span }) : t('Lefoglaltuk: {when}. A Google-meghívót a Meet-linkkel elküldtük a fiókod e-mail-címére.', { when: span }));
      return;
    }
    setError(refusal(r.code, r.status));
    if (r.code === 'TAKEN' || r.code === 'UNAVAILABLE') { setChosen(null); setTick((n) => n + 1); }
  };

  return (
    <Panel aria-label={moving ? t('Áthelyezés') : t('Új időpont')}>
      <SectionHeader title={moving ? t('Áthelyezés') : t('Új időpont')}
        note={moving ? formatSpan(moving.starts_at, moving.ends_at, moving.time_zone) : t('Google Meet, budapesti idő szerint')}
        action={moving ? <Button size="sm" variant="quiet" className={TOUCH} onClick={onCancelMove}>{t('Mégse')}</Button> : undefined} />
      <div className="grid gap-4 px-4 py-3 text-[13px]" data-client-booking-new={moving ? 'move' : 'book'}>
        {!moving && <p className="t-note">{t('Csak azokat az időpontokat látod, amikor ráérünk. A meghívót a Google küldi a fiókod e-mail-címére, Meet-linkkel.')}</p>}
        {!answer && <Skeleton className="h-24 w-full" />}
        {answer && !answer.ok && <p className="text-haze" data-client-booking-off>{refusal(answer.code, answer.status)}</p>}
        {answer?.ok && (
          <>
            {!moving && options.length > 1 && (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('Hossz')}>
                <span className="label">{t('Hossz')}</span>
                {options.map((m) => (
                  <Button key={m} size="sm" className={TOUCH} variant={(length ?? options[0]) === m ? 'primary' : 'ghost'} aria-pressed={(length ?? options[0]) === m}
                    onClick={() => { setMinutes(m); setChosen(null); }}>{t('{n} perc', { n: m })}</Button>
                ))}
              </div>
            )}
            {days.length === 0 && <p className="text-haze">{t('A következő hetekben most nincs szabad időpont. Írj nekünk, és egyeztetünk.')}</p>}
            {days.length > 0 && (
              <>
                <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label={t('Napok')}>
                  {(all ? days : days.slice(0, DAYS_SHOWN)).map((d) => (
                    <button key={d.key} type="button" aria-pressed={d.key === current?.key} onClick={() => { setDay(d.key); setChosen(null); }}
                      className={cn('grid shrink-0 gap-0.5 rounded-sm border px-3 py-2 text-left', TOUCH,
                        d.key === current?.key ? 'border-signal bg-signal text-black' : 'border-hair text-paper hover:bg-flare')}>
                      <span className="text-[11px] capitalize opacity-80">{formatIn(d.first, zone, { weekday: 'short' })}</span>
                      <span className="whitespace-nowrap text-[13px]">{formatIn(d.first, zone, { month: 'short', day: 'numeric' })}</span>
                    </button>
                  ))}
                  {!all && days.length > DAYS_SHOWN && (
                    <button type="button" className={cn('shrink-0 rounded-sm border border-hair px-3 py-2 text-haze hover:bg-flare', TOUCH)} onClick={() => setAll(true)}>{t('További napok')}</button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6" role="group" aria-label={t('Időpontok')}>
                  {current?.slots.map((s) => (
                    <button key={s.start} type="button" aria-pressed={chosen?.start === s.start} onClick={() => { setChosen(s); setError(null); }}
                      className={cn('num rounded-sm border px-2 py-2', TOUCH,
                        chosen?.start === s.start ? 'border-signal bg-signal text-black' : 'border-hair text-paper hover:bg-flare')}>
                      {formatIn(s.start, zone, { hour: '2-digit', minute: '2-digit' })}
                    </button>
                  ))}
                </div>
              </>
            )}
            {chosen && (
              <div className="grid gap-3 rounded-sm border border-hair p-3" data-client-booking-chosen>
                <p className="text-paper">{formatSpan(chosen.start, chosen.end, zone)}</p>
                {!moving && projects.length > 1 && (
                  <label className="grid gap-1.5">
                    <span className="label">{t('Melyik projektről?')}</span>
                    <Select value={project} onChange={(e) => setProject(e.target.value)}>
                      <option value="">{t('Általános')}</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </label>
                )}
                {!moving && (
                  <label className="grid gap-1.5">
                    <span className="label">{t('Miről beszélgetnénk? (nem kötelező)')}</span>
                    <textarea className="min-h-20 rounded-sm border border-hair bg-field px-3 py-2 text-paper" maxLength={1000} value={topic} onChange={(e) => setTopic(e.target.value)} />
                  </label>
                )}
                <Button size="sm" variant="primary" className={cn('justify-self-start', TOUCH)} onClick={book} disabled={busy}>
                  {moving ? t('Áthelyezem ide') : t('Lefoglalom')}
                </Button>
              </div>
            )}
          </>
        )}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Panel>
  );
}
