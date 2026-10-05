import { useEffect, useState, type ReactNode } from 'react';
import { useRows, useSearch, formatDate, type LoadState } from '@/lib/useRows';
import { useAuth } from '@/features/auth/AuthProvider';
import { useScope } from '@/lib/scope';
import { ROLE_LABELS, type Role } from '@/lib/permissions';
import { LanguageSwitch, useLanguage } from '@/features/i18n/LanguageGate';
import { intlLocale, t, tc } from '@/lib/i18n';
import { disablePush, enablePush, pushState, type PushState } from '@/lib/push';
import { canAccess } from '@/lib/permissions';
import { getEmailPref, notifyOwnerTest, setEmailPref } from '@/lib/notify';
import { useGoogleReviewUrl } from '@/lib/clientExperience';
import { useAutomationSettings, type AutomationSettings } from '@/lib/automations';
import { connectGoogle, disconnectGoogle, googleReturn, useGoogleAccount } from '@/lib/google';
import { useLocation } from 'react-router-dom';
import { isSafeHttpsUrl } from '@/lib/meetings';
import {
  Badge, Button, Cell, DataState, ErrorState, Input, Panel, Row, SectionHeader, Skeleton, Table,
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
              aria-label={t('Search {what}', { what: title.toLowerCase() })}
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
          title={t('Not connected')}
          body={t('Supabase credentials are not set in this environment, so there is nothing to read yet. See README.md for the setup steps.')}
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
      title={t('All case studies')}
      state={state} message={message} count={filtered.length} reload={reload}
      search={{ value: query, onChange: setQuery, placeholder: t('Title or client…') }}
      empty={{
        title: t('No case studies'),
        body: t('Rapidkert, Barbershop Győr and mentáliserő.hu are the references to start from.'),
      }}
    >
      <Table head={[t('Title'), t('Client'), t('State'), t('Order'), t('Updated')]}>
        {filtered.map((c) => (
          <Row key={c.id}>
            <Cell className="text-[13px] text-paper">{c.title}</Cell>
            <Cell className="text-xs text-haze">{c.client_name || '—'}</Cell>
            <Cell><Badge tone={c.published ? 'good' : 'neutral'}>{c.published ? t('Published') : t('Draft')}</Badge></Cell>
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
      title={t('Accounts')}
      state={state} message={message} count={filtered.length} reload={reload}
      search={{ value: query, onChange: setQuery, placeholder: t('Name or email…') }}
      empty={{ title: t('No users'), body: t('Accounts appear here once they have signed up or been invited.') }}
    >
      <Table head={[t('Name'), t('Email'), t('Role'), t('Joined')]}>
        {filtered.map((u) => (
          <Row key={u.id}>
            <Cell className="text-[13px] text-paper">{u.full_name || '—'}</Cell>
            <Cell className="break-all text-xs text-haze">{u.email}</Cell>
            <Cell>
              <Badge tone={u.role === 'super_admin' ? 'warn' : u.role === 'client' ? 'neutral' : 'good'}>
                {t(ROLE_LABELS[u.role])}
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
      title={t('Recent activity')}
      state={state} message={message} count={rows.length} reload={reload}
      empty={{ title: t('Nothing logged'), body: t('Writes made through the portal and the serverless functions are recorded here.') }}
    >
      <Table head={[tc('log', 'Action'), t('Entity'), t('When')]}>
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
        <SectionHeader title={t('This account')} />
        <dl className="grid px-4 py-3 text-sm">
          <Line term={t('Name')} value={profile?.full_name || '—'} />
          <Line term={t('Email')} value={profile?.email || '—'} />
          <Line term={t('Role')} value={profile ? t(ROLE_LABELS[profile.role]) : '—'} />
          <Line term={t('Organisation')} value={profile?.organization_id ?? t('Stratos (staff)')} />
        </dl>
      </Panel>
      <LanguageSettings />
      <NotificationSettings />
      {(profile?.role === 'super_admin' || profile?.role === 'admin') && <GoogleSettings />}
      {canAccess(profile, 'manage_projects') && <GoogleReviewSettings />}
      {canAccess(profile, 'manage_projects') && <AutomationSettingsPanel />}
      <p className="t-note">
        {t('Infrastructure, credentials and deploy context are on the System screen.')}
      </p>
    </div>
  );
}

/**
 * Notifications on THIS device (20261013000100_notifications.sql): push for
 * what clients do — uploads, feedback, new-time proposals — and the same by
 * e-mail. On an iPhone, push needs the portal on the Home Screen first.
 */
function NotificationSettings() {
  const { profile } = useAuth();
  // The owner and every admin get the same notifications (20261013000200).
  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState<boolean | null>(null);

  const refresh = () => { void pushState().then(setState).catch(() => setState('unsupported')); };
  useEffect(refresh, []);
  useEffect(() => { if (isAdmin && profile) void getEmailPref(profile.id).then(setEmail); }, [isAdmin, profile?.id]);
  const toggleEmail = async (on: boolean) => {
    if (!profile) return;
    setEmail(on);
    const problem = await setEmailPref(profile.id, on);
    if (problem) { setEmail(!on); setMessage(problem); }
  };

  const enable = async () => {
    setBusy(true);
    const problem = await enablePush();
    setBusy(false);
    setMessage(problem === 'denied'
      ? t('Notifications are blocked for this site. Allow them in the browser (or phone) settings, then try again.')
      : problem ? t('This device could not be registered. Try again.') : t('Notifications are on for this device.'));
    refresh();
  };
  const disable = async () => { setBusy(true); await disablePush(); setBusy(false); setMessage(null); refresh(); };
  const test = async () => {
    if (!profile) return;
    setBusy(true);
    setMessage((await notifyOwnerTest(profile.id)) ?? t('A test is on its way — it arrives within a minute.'));
    setBusy(false);
  };

  return (
    <Panel aria-label={t('Notifications')}>
      <SectionHeader title={t('Notifications')} note={t('this device')} />
      <div className="grid gap-2 px-4 py-3 text-[13px]" data-push-state={state}>
        <p className="t-note">
          {isAdmin
            ? t('When a client uploads a file, writes feedback on a demo or proposes a new meeting time, you get a push notification here and an e-mail.')
            : t('Push notifications from the portal, on this device.')}
        </p>
        {state === 'loading' && <Skeleton className="h-8 w-48" />}
        {state === 'needs-home-screen' && (
          <ol className="grid list-decimal gap-1 pl-5 text-paper">
            <li>{t('In Safari, tap the Share button (the square with an arrow).')}</li>
            <li>{t('Choose “Add to Home Screen”, then Add.')}</li>
            <li>{t('Open the portal from the new Stratos icon, sign in, and come back here to switch notifications on.')}</li>
          </ol>
        )}
        {state === 'unsupported' && <p className="text-haze">{t('This browser cannot receive push notifications. You still get the e-mails.')}</p>}
        {state === 'denied' && <p className="text-signal">{t('Notifications are blocked for this site. Allow them in the browser (or phone) settings, then reload.')}</p>}
        {state === 'off' && <Button size="sm" variant="primary" className="justify-self-start" onClick={enable} disabled={busy}>{t('Turn on notifications on this device')}</Button>}
        {state === 'on' && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="good">{t('On for this device')}</Badge>
            {isAdmin && <Button size="sm" onClick={test} disabled={busy}>{t('Send a test')}</Button>}
            <Button size="sm" variant="quiet" onClick={disable} disabled={busy}>{t('Turn off')}</Button>
          </div>
        )}
        {isAdmin && email !== null && (
          <label className="flex items-center gap-2 text-paper">
            <input type="checkbox" checked={email} onChange={(e) => void toggleEmail(e.target.checked)} className="h-4 w-4 accent-signal" data-notify-email />
            {t('Also by e-mail ({email})', { email: profile?.email ?? '' })}
          </label>
        )}
        {message && <p role="status" className="text-xs text-haze">{message}</p>}
      </div>
    </Panel>
  );
}

/**
 * The Google review link the satisfaction survey offers a client who scores 7
 * or more (20261014000100). The owner's; clients only ever see it next to
 * such an answer.
 */
function GoogleReviewSettings() {
  const review = useGoogleReviewUrl();
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const value = draft ?? review.url ?? '';
  const save = async () => {
    const next = value.trim() || null;
    if (next && !isSafeHttpsUrl(next)) return setMessage({ ok: false, text: t('The link must be a plain https:// address.') });
    const problem = await review.save(next);
    setMessage(problem ? { ok: false, text: problem } : { ok: true, text: t('Saved.') });
    if (!problem) setDraft(null);
  };
  return (
    <Panel aria-label={t('Google review link')}>
      <SectionHeader title={t('Google review link')} />
      <div className="grid gap-2 px-4 py-3 text-[13px]">
        <p className="t-note">
          {t('A client who answers the satisfaction survey with 7 or more is asked to write a Google review, with this link. In Google Business Profile: Ask for reviews → copy the link.')}
        </p>
        {review.state === 'loading' && <Skeleton className="h-8 w-full" />}
        {review.state === 'error' && <p className="text-haze">{t('This feature is not installed on the database yet (20261014000100).')}</p>}
        {review.state === 'ready' && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="google-review-url">{t('Google review link')}</label>
            <Input id="google-review-url" type="url" inputMode="url" className="min-w-0 flex-1" placeholder="https://g.page/r/…/review"
                   value={value} onChange={(e) => { setDraft(e.target.value); setMessage(null); }} />
            <Button size="sm" variant="primary" onClick={save} disabled={draft === null}>{t('Save')}</Button>
          </div>
        )}
        {review.state === 'ready' && !review.url && <p className="text-signal">{t('No link yet: clients are thanked, but not asked for a review.')}</p>}
        {message && <p role="status" className={message.ok ? 'text-xs text-good' : 'text-xs text-danger'}>{message.text}</p>}
      </div>
    </Panel>
  );
}

/**
 * This person's own Google account (20261017000100): the e-mails exchanged
 * with leads, clients and deals are read from it, and the meetings they make
 * go into its calendar. Read-only for mail; the token stays on the server.
 */
function GoogleSettings() {
  const { profile } = useAuth();
  const { search } = useLocation();
  const google = useGoogleAccount(profile?.id);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(() => googleReturn(search));
  const a = google.account;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(intlLocale('en-GB'), { dateStyle: 'medium', timeStyle: 'short' }) : t('not yet'));
  const connect = async () => { setBusy(true); const p = await connectGoogle(); if (p) { setMessage({ ok: false, text: p }); setBusy(false); } };
  const disconnect = async () => {
    setBusy(true);
    const p = await disconnectGoogle();
    setBusy(false);
    setMessage(p ? { ok: false, text: p } : { ok: true, text: t('Google is disconnected. Stored e-mails stay; nothing new is read.') });
    void google.reload();
  };
  return (
    <Panel aria-label={t('Google')}>
      <SectionHeader title={t('Google')} note={t('Gmail and Calendar')} />
      <div className="grid gap-2 px-4 py-3 text-[13px]" data-google={google.state === 'ready' ? (a ? 'connected' : 'off') : google.state}>
        <p className="t-note">
          {t('Connect your own Google account: the e-mails you exchange with leads, clients and deals appear on their pages (subject, date and a short snippet — read-only), and the meetings you make in the Portal go into your Google Calendar.')}
        </p>
        {google.state === 'loading' && <Skeleton className="h-8 w-48" />}
        {google.state === 'missing' && <p className="text-haze">{t('This feature is not installed on the database yet (20261017000100).')}</p>}
        {google.state === 'error' && <p className="text-haze">{t('The Google connection could not be read.')}</p>}
        {google.state === 'ready' && !a && (
          <Button size="sm" variant="primary" className="justify-self-start" onClick={connect} disabled={busy}>{t('Connect Google')}</Button>
        )}
        {google.state === 'ready' && a && (
          <>
            <p className="text-paper">
              <Badge tone={a.last_error === 'revoked' ? 'bad' : 'good'}>{a.last_error === 'revoked' ? t('Access revoked') : t('Connected')}</Badge>{' '}{a.google_email}
            </p>
            <p className="t-note">{t('E-mails last read: {when}', { when: when(a.gmail_synced_at) })}</p>
            {a.last_error === 'revoked' && <p className="text-danger">{t('Google no longer accepts this connection. Connect again.')}</p>}
            <div className="flex flex-wrap gap-2">
              {a.last_error === 'revoked' && <Button size="sm" variant="primary" onClick={connect} disabled={busy}>{t('Connect Google')}</Button>}
              <Button size="sm" variant="quiet" onClick={disconnect} disabled={busy}>{t('Disconnect')}</Button>
            </div>
          </>
        )}
        {message && <p role="status" className={message.ok ? 'text-xs text-good' : 'text-xs text-danger'}>{message.text}</p>}
      </div>
    </Panel>
  );
}

/**
 * The automations (20261015000100): which rules run and their thresholds. What
 * they raise shows on Today and is pushed and e-mailed to the owner and admins.
 */
function AutomationSettingsPanel() {
  const auto = useAutomationSettings();
  const [message, setMessage] = useState<string | null>(null);
  const v = auto.value;
  const save = async (patch: Partial<AutomationSettings>) => setMessage(await auto.save(patch));
  const number = (key: 'auto_lead_hours' | 'auto_deal_days' | 'auto_deadline_days', min: number, max: number, label: string) => (
    <Input type="number" min={min} max={max} aria-label={label} className="w-20" defaultValue={v?.[key]} key={`${key}-${v?.[key]}`}
           onBlur={(e) => { const n = Math.round(Number(e.target.value)); if (n >= min && n <= max && n !== v?.[key]) void save({ [key]: n }); }} />
  );
  const rule = (on: keyof AutomationSettings, title: string, body: ReactNode) => (
    <li className="flex items-start gap-2 border-b border-hairline py-2 last:border-0">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-signal" checked={Boolean(v?.[on])} aria-label={title}
             onChange={(e) => void save({ [on]: e.target.checked })} data-auto={on} />
      <div className="grid gap-1"><p className="text-paper">{title}</p><div className="t-note flex flex-wrap items-center gap-1">{body}</div></div>
    </li>
  );
  return (
    <Panel aria-label={t('Automations')}>
      <SectionHeader title={t('Automations')} />
      <div className="px-4 py-3 text-[13px]">
        <p className="t-note">{t('What these find shows under “Needs attention” on Today, once per case, and is pushed and e-mailed to you and the admins. It closes by itself when the cause is gone.')}</p>
        {auto.state === 'loading' && <Skeleton className="mt-2 h-24 w-full" />}
        {auto.state === 'error' && <p className="mt-2 text-haze">{t('This feature is not installed on the database yet (20261015000100).')}</p>}
        {v && (
          <ul className="mt-2 grid">
            {rule('auto_lead_on', t('A new lead with no reply'), <>{t('after')} {number('auto_lead_hours', 1, 720, t('Hours'))} {t('hours without a status change or a logged contact')}</>)}
            {rule('auto_deal_on', t('A stalled deal'), <>{t('no movement for')} {number('auto_deal_days', 1, 365, t('Days'))} {t('days and no next step ahead')}</>)}
            {rule('auto_won_on', t('A won deal without a project'), <>{t('until the project is created from it')}</>)}
            {rule('auto_overdue_on', t('An overdue payment'), <>{t('from the payment schedule')}</>)}
            {rule('auto_deadline_on', t('A project deadline coming up'), <>{t('within')} {number('auto_deadline_days', 1, 60, t('Days'))} {t('days')}</>)}
          </ul>
        )}
        {message && <p role="status" className="mt-2 text-xs text-danger">{message}</p>}
      </div>
    </Panel>
  );
}

/**
 * The portal language for THIS account — saved on the profile, so it follows
 * the account to every device. Clients choose theirs in the client portal's
 * header; nobody chooses for anybody else.
 */
function LanguageSettings() {
  const { lang } = useLanguage();
  return (
    <Panel aria-label={t('Language')}>
      <SectionHeader title={t('Language')} />
      <div className="grid gap-2 px-4 py-3">
        <LanguageSwitch className="justify-self-start" />
        <p className="t-note">
          {lang
            ? t('The whole portal is shown in this language for your account, on every device.')
            : t('Not chosen yet: the portal is shown in English. Your choice is saved on your account.')}
        </p>
        <p className="t-note">
          {t('Clients choose their own language in the client portal header (Magyar, English, Deutsch). Names, notes and other text you type are not translated.')}
        </p>
      </div>
    </Panel>
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
