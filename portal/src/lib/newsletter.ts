import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';
import { intlLocale } from '@/lib/i18n';

/**
 * The newsletter (20261019000100_newsletter.sql, netlify/functions/newsletter*):
 * double opt-in on the public site, a welcome e-mail, campaigns written here and
 * sent by a scheduled function through Resend. Admins only — every policy and
 * function behind it checks `is_admin()`.
 *
 * The subscriber list is read column by column: the tokens, the token hash and
 * the IP hash are not granted to anybody signed in, so `select('*')` fails.
 * No sentence lives in this file — the screen says things in its own words.
 *
 * The automatic e-mails (20261019000200) add the welcome series, the setting
 * for announcing new articles and case studies, and where a campaign came
 * from. The owner may apply the two migrations one at a time, so everything
 * here keeps working with only the first: the new tables answer 'missing', and
 * the campaign list falls back to the columns it had before.
 */

export type NewsletterLocale = 'hu' | 'en' | 'de';
export type Audience = 'all' | NewsletterLocale;
export type SubscriberStatus = 'pending' | 'confirmed' | 'unsubscribed' | 'bounced' | 'complained';
export type SubscriberSource = 'newsletter' | 'contact' | 'import' | 'portal';
export type CampaignStatus = 'draft' | 'sending' | 'sent' | 'cancelled';

export interface Subscriber {
  id: string; email: string; locale: NewsletterLocale; status: SubscriberStatus; source: SubscriberSource;
  source_route: string | null; confirm_requested_at: string | null; confirm_sent_at: string | null;
  confirm_error: string | null; confirmed_at: string | null; welcome_sent_at: string | null;
  unsubscribed_at: string | null; unsubscribe_source: 'link' | 'one_click' | 'portal' | 'bounce' | 'complaint' | null;
  created_at: string; updated_at: string;
}
// Exactly the granted columns, never '*'.
export const SUBSCRIBER_COLUMNS = 'id, email, locale, status, source, source_route, confirm_requested_at, confirm_sent_at, confirm_error, confirmed_at, welcome_sent_at, unsubscribed_at, unsubscribe_source, created_at, updated_at';
/** The newest this many are listed; the counts are exact whatever the size. */
export const SUBSCRIBER_CAP = 1000;

/** Written here ('manual'), or made by the server for a new article or case study ('announce'). */
export type CampaignKind = 'manual' | 'announce';

export interface Campaign {
  id: string; subject: string; preheader: string | null; body: string; audience: Audience; status: CampaignStatus;
  recipients: number; sent: number; failed: number; created_by: string | null; queued_at: string | null;
  queued_by: string | null; finished_at: string | null; created_at: string; updated_at: string;
  /** 'manual' and null while 20261019000200 is not applied. */
  kind: CampaignKind; source_key: string | null;
}
export const CAMPAIGN_COLUMNS = 'id, subject, preheader, body, audience, status, recipients, sent, failed, created_by, queued_at, queued_by, finished_at, created_at, updated_at';
/** With where it came from (20261019000200). */
const CAMPAIGN_COLUMNS_KIND = `${CAMPAIGN_COLUMNS}, kind, source_key`;

/** What an admin writes; the only columns a draft may be given. */
export interface CampaignDraft { subject: string; preheader: string; body: string; audience: Audience }

export interface DeliveryProblem {
  subscriber_id: string; status: 'failed' | 'skipped'; attempts: number; last_error: string | null;
  subscriber: { email: string } | null;
}

export interface SubscriberCounts {
  pending: number; confirmed: number; unsubscribed: number; bounced: number; complained: number;
  /** Confirmed subscribers per language: who a campaign's audience reaches. */
  confirmedBy: Record<NewsletterLocale, number>;
  /** The pre-launch requests nobody has asked to confirm yet. */
  oldUnasked: number;
}
const ZERO: SubscriberCounts = { pending: 0, confirmed: 0, unsubscribed: 0, bounced: 0, complained: 0, confirmedBy: { hu: 0, en: 0, de: 0 }, oldUnasked: 0 };

export const audienceSize = (counts: SubscriberCounts, audience: Audience) =>
  audience === 'all' ? counts.confirmedBy.hu + counts.confirmedBy.en + counts.confirmedBy.de : counts.confirmedBy[audience];

type State = 'loading' | 'ready' | 'error' | 'unconfigured' | 'missing';
const missing = (code?: string) => code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883';
/** A column the database does not have (yet): undefined_column, or PostgREST's schema cache. */
const noColumn = (code?: string) => code === '42703' || code === 'PGRST204';

/* ========================================================== reading */

/** The newest subscribers (every status), and the exact counts. */
export function useSubscribers(reloadToken = 0) {
  const [rows, setRows] = useState<Subscriber[]>([]);
  const [counts, setCounts] = useState<SubscriberCounts>(ZERO);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    // HEAD requests: a count, no rows. Exact past the list's cap.
    const count = () => supabase.from('newsletter_subscribers').select('id', { count: 'exact', head: true });
    const [list, pending, unsubscribed, bounced, complained, hu, en, de, old] = await Promise.all([
      supabase.from('newsletter_subscribers').select(SUBSCRIBER_COLUMNS).order('created_at', { ascending: false }).limit(SUBSCRIBER_CAP),
      count().eq('status', 'pending'),
      count().eq('status', 'unsubscribed'),
      count().eq('status', 'bounced'),
      count().eq('status', 'complained'),
      count().eq('status', 'confirmed').eq('locale', 'hu'),
      count().eq('status', 'confirmed').eq('locale', 'en'),
      count().eq('status', 'confirmed').eq('locale', 'de'),
      count().eq('status', 'pending').eq('source', 'import').is('confirm_requested_at', null),
    ]);
    const error = [list, pending, unsubscribed, bounced, complained, hu, en, de, old].find((r) => r.error)?.error;
    if (error) { console.error('[newsletter_subscribers]', error.code); setState(missing(error.code) ? 'missing' : 'error'); return; }
    const confirmedBy = { hu: hu.count ?? 0, en: en.count ?? 0, de: de.count ?? 0 };
    setRows((list.data ?? []) as unknown as Subscriber[]);
    setCounts({
      pending: pending.count ?? 0, unsubscribed: unsubscribed.count ?? 0, bounced: bounced.count ?? 0,
      complained: complained.count ?? 0, confirmed: confirmedBy.hu + confirmedBy.en + confirmedBy.de,
      confirmedBy, oldUnasked: old.count ?? 0,
    });
    setState('ready');
  }, [reloadToken]);
  useEffect(() => { void load(); }, [load]);
  return { rows, counts, state, reload: load, capped: rows.length >= SUBSCRIBER_CAP };
}

/**
 * Every campaign, newest first. While one is going out, read again every 10 s.
 * Asks for `kind` and `source_key` too; without 20261019000200 that fails
 * (42703 / PGRST204), and the list is read again without them — and, for as
 * long as the screen is open, never asked for them again.
 */
export function useCampaigns(reloadToken = 0) {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const withoutKind = useRef(false);
  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    const read = (columns: string) => supabase.from('newsletter_campaigns').select(columns)
      .order('created_at', { ascending: false }).limit(200);
    let { data, error } = await read(withoutKind.current ? CAMPAIGN_COLUMNS : CAMPAIGN_COLUMNS_KIND);
    if (error && !withoutKind.current && noColumn(error.code)) {
      withoutKind.current = true;
      ({ data, error } = await read(CAMPAIGN_COLUMNS));
    }
    if (error) { console.error('[newsletter_campaigns]', error.code); setState(missing(error.code) ? 'missing' : 'error'); return; }
    setRows(((data ?? []) as unknown as Array<Omit<Campaign, 'kind' | 'source_key'> & Partial<Campaign>>)
      .map((c) => ({ ...c, kind: c.kind ?? 'manual', source_key: c.source_key ?? null })));
    setState('ready');
  }, [reloadToken]);
  useEffect(() => { void load(); }, [load]);
  const sending = rows.some((c) => c.status === 'sending');
  useEffect(() => {
    if (!sending) return;
    const timer = window.setInterval(() => { void load(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [sending, load]);
  return { rows, state, reload: load, sending };
}

/** What did not reach whom in a campaign: refused for good, or skipped (they left first). */
export async function deliveryProblems(campaignId: string): Promise<DeliveryProblem[] | null> {
  const { data, error } = await supabase.from('newsletter_deliveries')
    .select('subscriber_id, status, attempts, last_error, subscriber:newsletter_subscribers(email)')
    .eq('campaign_id', campaignId).in('status', ['failed', 'skipped']).limit(200);
  if (error) { console.error('[newsletter_deliveries]', error.code); return null; }
  return (data ?? []) as unknown as DeliveryProblem[];
}

/* ========================================================== writing */

/**
 * Why a write did not happen. The screen turns each into a sentence.
 *   missing        the migration is not applied
 *   no_recipients  nobody confirmed is in the audience
 *   not_draft      it was sent (or deleted) meanwhile: drafts only
 *   forbidden      not an admin (42501)
 *   invalid        a check refused the values (23514)
 *   duplicate      a unique key is taken (23505): a series step's position
 *   gone           the row was deleted meanwhile (a series step)
 */
export type NewsletterFailure = 'missing' | 'no_recipients' | 'not_draft' | 'forbidden' | 'invalid' | 'duplicate' | 'gone' | 'error';
export type Outcome<T = null> = { ok: true; value: T } | { ok: false; failure: NewsletterFailure };

function failure(error: { code?: string; message?: string }, where: string): { ok: false; failure: NewsletterFailure } {
  console.error(`[${where}]`, error.code);
  const message = error.message ?? '';
  if (missing(error.code)) return { ok: false, failure: 'missing' };
  if (message.includes('stratos:newsletter_no_recipients')) return { ok: false, failure: 'no_recipients' };
  if (message.includes('stratos:newsletter_not_draft')) return { ok: false, failure: 'not_draft' };
  if (error.code === '42501') return { ok: false, failure: 'forbidden' };
  if (error.code === '23514') return { ok: false, failure: 'invalid' };
  if (error.code === '23505') return { ok: false, failure: 'duplicate' };
  return { ok: false, failure: 'error' };
}

export const LIMITS = { subject: 200, preheader: 200, body: 50000 } as const;

/** The database's checks, asked before the database is. A series step is checked the same way. */
export function draftProblem(d: Pick<CampaignDraft, 'subject' | 'preheader' | 'body'>): 'subject' | 'subject_long' | 'preheader_long' | 'body' | 'body_long' | null {
  const subject = d.subject.trim();
  const body = d.body.trim();
  if (!subject) return 'subject';
  if (subject.length > LIMITS.subject) return 'subject_long';
  if (d.preheader.trim().length > LIMITS.preheader) return 'preheader_long';
  if (!body) return 'body';
  if (body.length > LIMITS.body) return 'body_long';
  return null;
}

const columns = (d: CampaignDraft) => ({
  subject: d.subject.trim(), preheader: d.preheader.trim() || null, body: d.body, audience: d.audience,
});

/** A new draft (id null) or a change to one. Returns the draft's id. */
export async function saveDraft(id: string | null, d: CampaignDraft): Promise<Outcome<string>> {
  if (!id) {
    const { data, error } = await supabase.from('newsletter_campaigns').insert(columns(d)).select('id').single();
    if (error) return failure(error, 'newsletter_campaigns.insert');
    return { ok: true, value: (data as { id: string }).id };
  }
  const { data, error } = await supabase.from('newsletter_campaigns').update(columns(d)).eq('id', id).select('id');
  if (error) return failure(error, 'newsletter_campaigns.update');
  // The policy only lets a draft be changed: no row back means it is not one any more.
  return (data ?? []).length === 1 ? { ok: true, value: id } : { ok: false, failure: 'not_draft' };
}

export async function deleteDraft(id: string): Promise<Outcome> {
  const { data, error } = await supabase.from('newsletter_campaigns').delete().eq('id', id).select('id');
  if (error) return failure(error, 'newsletter_campaigns.delete');
  return (data ?? []).length === 1 ? { ok: true, value: null } : { ok: false, failure: 'not_draft' };
}

/** Queues a draft for every confirmed subscriber of its audience. Returns how many. */
export async function sendCampaign(id: string): Promise<Outcome<number>> {
  const { data, error } = await supabase.rpc('newsletter_campaign_send', { p_id: id });
  if (error) return failure(error, 'newsletter_campaign_send');
  return { ok: true, value: Number(data ?? 0) };
}

/** Stops a campaign that is going out. Returns how many were not sent. */
export async function cancelCampaign(id: string): Promise<Outcome<number>> {
  const { data, error } = await supabase.rpc('newsletter_campaign_cancel', { p_id: id });
  if (error) return failure(error, 'newsletter_campaign_cancel');
  return { ok: true, value: Number(data ?? 0) };
}

/** Asks the pre-launch requests, once, to confirm. Returns how many were asked. */
export async function requestConfirmations(): Promise<Outcome<number>> {
  const { data, error } = await supabase.rpc('newsletter_request_confirmations');
  if (error) return failure(error, 'newsletter_request_confirmations');
  return { ok: true, value: Number(data ?? 0) };
}

/** Someone asked by phone or by reply. */
export async function adminUnsubscribe(id: string): Promise<Outcome> {
  const { error } = await supabase.rpc('newsletter_admin_unsubscribe', { p_id: id });
  if (error) return failure(error, 'newsletter_admin_unsubscribe');
  return { ok: true, value: null };
}

/** Erasure on request: the address and what was sent to it, gone for good. */
export async function eraseSubscriber(id: string): Promise<Outcome> {
  const { data, error } = await supabase.from('newsletter_subscribers').delete().eq('id', id).select('id');
  if (error) return failure(error, 'newsletter_subscribers.delete');
  return (data ?? []).length === 1 ? { ok: true, value: null } : { ok: false, failure: 'forbidden' };
}

/* ============================== automatic e-mails (20261019000200) */

/**
 * A new article or case study on the site (the build's
 * assets/data/newsletter-feed.json, read by the dispatcher):
 *   send   announced at once to the confirmed subscribers of each language
 *   draft  a draft campaign per language, waiting under Campaigns
 *   off    only remembered
 */
export type AutoAnnounce = 'send' | 'draft' | 'off';

export interface Announced {
  key: string; type: 'post' | 'case'; first_seen_at: string;
  /** On the site's list the first time it was read: remembered, never announced. */
  baseline: boolean;
  /** How many campaigns (one per language) were made for it. */
  campaigns: number;
}
const ANNOUNCED_COLUMNS = 'key, type, first_seen_at, baseline, campaigns';
export const ANNOUNCED_SHOWN = 20;

/** The setting, and the newest articles and case studies the server has seen. */
export function useAnnouncements(reloadToken = 0) {
  const [mode, setMode] = useState<AutoAnnounce>('send');
  const [rows, setRows] = useState<Announced[]>([]);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    const [settings, seen] = await Promise.all([
      supabase.from('newsletter_settings').select('auto_announce').eq('singleton', true).maybeSingle(),
      supabase.from('newsletter_announced').select(ANNOUNCED_COLUMNS)
        .order('first_seen_at', { ascending: false }).order('key').limit(ANNOUNCED_SHOWN),
    ]);
    const error = settings.error ?? seen.error;
    if (error) { console.error('[newsletter_settings]', error.code); setState(missing(error.code) ? 'missing' : 'error'); return; }
    // No row is read by the server as 'send' too.
    setMode((settings.data as { auto_announce: AutoAnnounce } | null)?.auto_announce ?? 'send');
    setRows((seen.data ?? []) as Announced[]);
    setState('ready');
  }, [reloadToken]);
  useEffect(() => { void load(); }, [load]);
  return { mode, rows, state, reload: load, setMode };
}

export async function saveAutoAnnounce(mode: AutoAnnounce): Promise<Outcome> {
  const { data, error } = await supabase.from('newsletter_settings').update({ auto_announce: mode })
    .eq('singleton', true).select('auto_announce');
  if (error) return failure(error, 'newsletter_settings.update');
  // The policy hides the row from anybody but an admin: nothing back, nothing changed.
  return (data ?? []).length === 1 ? { ok: true, value: null } : { ok: false, failure: 'forbidden' };
}

/** One e-mail of the welcome series, sent `delay_days` after a subscriber confirmed. */
export interface SeriesStep {
  id: string; locale: NewsletterLocale; position: number; delay_days: number; subject: string;
  preheader: string | null; body: string; enabled: boolean; updated_at: string;
}
const SERIES_COLUMNS = 'id, locale, position, delay_days, subject, preheader, body, enabled, updated_at';
export const SERIES_LIMITS = { positions: 10, delayMin: 1, delayMax: 365 } as const;

/** Every step of every language, in order. */
export function useSeries(reloadToken = 0) {
  const [rows, setRows] = useState<SeriesStep[]>([]);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    const { data, error } = await supabase.from('newsletter_series').select(SERIES_COLUMNS)
      .order('locale').order('position');
    if (error) { console.error('[newsletter_series]', error.code); setState(missing(error.code) ? 'missing' : 'error'); return; }
    setRows((data ?? []) as SeriesStep[]);
    setState('ready');
  }, [reloadToken]);
  useEffect(() => { void load(); }, [load]);
  return { rows, state, reload: load };
}

/** What an admin writes; the language is the step's own and never changes. */
export interface StepDraft { position: number; delay_days: number; subject: string; preheader: string; body: string; enabled: boolean }

export type StepProblem = 'position' | 'delay' | NonNullable<ReturnType<typeof draftProblem>>;

export function stepProblem(d: StepDraft): StepProblem | null {
  if (!Number.isInteger(d.position) || d.position < 1 || d.position > SERIES_LIMITS.positions) return 'position';
  if (!Number.isInteger(d.delay_days) || d.delay_days < SERIES_LIMITS.delayMin || d.delay_days > SERIES_LIMITS.delayMax) return 'delay';
  return draftProblem(d);
}

const stepColumns = (d: StepDraft) => ({
  position: d.position, delay_days: d.delay_days, subject: d.subject.trim(),
  preheader: d.preheader.trim() || null, body: d.body, enabled: d.enabled,
});

/** A new step (id null) or a change to one. Returns the step as stored. */
export async function saveStep(id: string | null, locale: NewsletterLocale, d: StepDraft): Promise<Outcome<SeriesStep>> {
  if (!id) {
    const { data, error } = await supabase.from('newsletter_series').insert({ locale, ...stepColumns(d) })
      .select(SERIES_COLUMNS).single();
    if (error) return failure(error, 'newsletter_series.insert');
    return { ok: true, value: data as SeriesStep };
  }
  const { data, error } = await supabase.from('newsletter_series').update(stepColumns(d)).eq('id', id).select(SERIES_COLUMNS);
  if (error) return failure(error, 'newsletter_series.update');
  const row = (data ?? [])[0] as SeriesStep | undefined;
  return row ? { ok: true, value: row } : { ok: false, failure: 'gone' };
}

export async function deleteStep(id: string): Promise<Outcome> {
  const { data, error } = await supabase.from('newsletter_series').delete().eq('id', id).select('id');
  if (error) return failure(error, 'newsletter_series.delete');
  return (data ?? []).length === 1 ? { ok: true, value: null } : { ok: false, failure: 'gone' };
}

/** Where a new step goes: after the language's last one, else the first gap; null when all ten are taken. */
export function nextPosition(steps: Pick<SeriesStep, 'position'>[]): number | null {
  const used = new Set(steps.map((s) => s.position));
  const last = Math.max(0, ...used);
  if (last < SERIES_LIMITS.positions) return last + 1;
  for (let p = 1; p <= SERIES_LIMITS.positions; p++) if (!used.has(p)) return p;
  return null;
}

/* ============================================================ the API */

export interface ApiAnswer<T = Record<string, unknown>> { status: number; ok: boolean; code: string | null; body: T }
export interface PreviewAnswer { subject: string; html: string; text: string }
export interface TestAnswer { to: string }

/**
 * One call to /api/newsletter/{preview|test}, as the signed-in admin: the
 * e-mail rendered exactly as it is sent, or sent to their own address. Never throws.
 */
export async function newsletterApi<T = Record<string, unknown>>(
  action: 'preview' | 'test',
  payload: { subject: string; preheader: string; body: string; locale: NewsletterLocale },
): Promise<ApiAnswer<T>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  try {
    const res = await fetch(`/api/newsletter/${action}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({})) as T & { ok?: boolean; code?: string };
    return { status: res.status, ok: res.ok && json?.ok === true, code: json?.code ?? null, body: json };
  } catch {
    return { status: 0, ok: false, code: 'NETWORK', body: {} as T };
  }
}

/* ======================================================== presentation */

const ZONE = 'Europe/Budapest';

/** "18 Oct 2026" in the reader's language, Budapest time. */
export function formatDay(iso: string | null): string {
  if (!iso) return '';
  try { return new Intl.DateTimeFormat(intlLocale('en-GB'), { timeZone: ZONE, dateStyle: 'medium' }).format(new Date(iso)); } catch { return iso; }
}

/** "18 Oct 2026, 14:05". */
export function formatMoment(iso: string | null): string {
  if (!iso) return '';
  try { return new Intl.DateTimeFormat(intlLocale('en-GB'), { timeZone: ZONE, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); } catch { return iso; }
}

/** When an unconfirmed request is deleted (newsletter_purge): 30 days after its confirmation e-mail. */
export const purgeDate = (s: Pick<Subscriber, 'status' | 'confirm_sent_at'>): string | null =>
  s.status === 'pending' && s.confirm_sent_at ? new Date(Date.parse(s.confirm_sent_at) + 30 * 864e5).toISOString() : null;
