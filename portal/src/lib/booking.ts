import { useCallback, useEffect, useState } from 'react';
import { supabase, isConfigured } from '@/lib/supabase';
import { intlLocale } from '@/lib/i18n';

/**
 * Booking (20261018000100_booking.sql, netlify/functions/booking.mjs): free
 * times come from the owner's Google Calendar through /api/booking; a booking
 * is an event in that calendar with a Meet link, and Google sends the
 * invitation. The owner reads the diary and the rules here; a client books,
 * moves and cancels their own. No sentence lives in this file — each screen
 * says things in its own source language.
 */

export interface Slot { start: string; end: string }

export interface BookingSettings {
  enabled: boolean; time_zone: string; weekdays: number[]; day_start: string; day_end: string;
  public_minutes: number; client_minutes: number[]; buffer_minutes: number; notice_hours: number;
  horizon_days: number; daily_max: number; change_hours: number; updated_at: string;
}
export const SETTINGS_COLUMNS = 'enabled, time_zone, weekdays, day_start, day_end, public_minutes, client_minutes, buffer_minutes, notice_hours, horizon_days, daily_max, change_hours, updated_at';
export type SettingsPatch = Partial<Omit<BookingSettings, 'time_zone' | 'updated_at'>>;

export interface Booking {
  id: string; kind: 'public' | 'client'; status: 'confirmed' | 'cancelled' | 'failed';
  starts_at: string; ends_at: string; time_zone: string; guest_name: string; guest_email: string;
  guest_company: string | null; guest_phone: string | null; topic: string | null; locale: string;
  lead_id: string | null; organization_id: string | null; project_id: string | null; meet_url: string | null;
  cancelled_at: string | null; cancelled_by: 'guest' | 'client' | 'owner' | null; moved_count: number; created_at: string;
  project: { name: string } | null;
}

export interface ClientBooking {
  booking_id: string; starts_at: string; ends_at: string; time_zone: string; status: 'confirmed' | 'cancelled';
  meet_url: string | null; project_id: string | null; project_name: string | null; topic: string | null; can_change: boolean;
}

type State = 'loading' | 'ready' | 'error' | 'unconfigured' | 'missing';
const missing = (code?: string) => code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883';

/* ================================================================ owner */

/** The diary: upcoming bookings and those of the last 30 days, every status but failed. */
export function useBookings(reloadToken = 0) {
  const [rows, setRows] = useState<Booking[]>([]);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const { data, error } = await supabase.from('bookings')
      .select('id, kind, status, starts_at, ends_at, time_zone, guest_name, guest_email, guest_company, guest_phone, topic, locale, lead_id, organization_id, project_id, meet_url, cancelled_at, cancelled_by, moved_count, created_at, project:projects(name)')
      .neq('status', 'failed').gt('ends_at', since).order('starts_at', { ascending: true }).limit(300);
    if (error) { console.error('[bookings]', error.code); setState(missing(error.code) ? 'missing' : 'error'); return; }
    setRows((data ?? []) as unknown as Booking[]);
    setState('ready');
  }, [reloadToken]);
  useEffect(() => { void load(); }, [load]);
  return { rows, state, reload: load };
}

export function useBookingSettings(reloadToken = 0) {
  const [settings, setSettings] = useState<BookingSettings | null>(null);
  const [state, setState] = useState<State>(isConfigured ? 'loading' : 'unconfigured');
  const load = useCallback(async () => {
    if (!isConfigured) return setState('unconfigured');
    const { data, error } = await supabase.from('booking_settings').select(SETTINGS_COLUMNS).eq('singleton', true).maybeSingle();
    if (error) { console.error('[booking_settings]', error.code); setState(missing(error.code) ? 'missing' : 'error'); return; }
    setSettings((data as BookingSettings | null) ?? null);
    setState(data ? 'ready' : 'missing');
  }, [reloadToken]);
  useEffect(() => { void load(); }, [load]);
  return { settings, state, reload: load };
}

/** Saves the owner's rules. Returns the database's error code, or null. */
export async function saveBookingSettings(patch: SettingsPatch): Promise<string | null> {
  const { data, error } = await supabase.from('booking_settings').update(patch).eq('singleton', true).select('singleton');
  if (error) { console.error('[booking_settings.save]', error.code); return error.code ?? 'error'; }
  return (data ?? []).length === 1 ? null : '42501';
}

/* ============================================================ the API */

export interface ApiAnswer<T = Record<string, unknown>> { status: number; ok: boolean; code: string | null; body: T }

/** One call to /api/booking, as the signed-in person. Never throws. */
export async function bookingApi<T = Record<string, unknown>>(method: 'GET' | 'POST', body?: Record<string, unknown>, query = ''): Promise<ApiAnswer<T>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  try {
    const res = await fetch(`/api/booking${query}`, {
      method,
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({})) as T & { ok?: boolean; code?: string };
    return { status: res.status, ok: res.ok && json?.ok === true, code: json?.code ?? null, body: json };
  } catch {
    return { status: 0, ok: false, code: 'NETWORK', body: {} as T };
  }
}

export interface SlotAnswer { timeZone: string; minutes: number; options: number[]; changeHours: number; slots: Slot[]; projects?: { id: string; name: string }[] }

/** The free times for `minutes` (as the signed-in person: a client sees the client lengths). */
export function useSlots(minutes: number | null, reloadToken = 0) {
  const [answer, setAnswer] = useState<ApiAnswer<SlotAnswer> | null>(null);
  const load = useCallback(async () => {
    setAnswer(null);
    setAnswer(await bookingApi<SlotAnswer>('GET', undefined, minutes ? `?minutes=${minutes}` : ''));
  }, [minutes, reloadToken]);
  useEffect(() => { void load(); }, [load]);
  return { answer, reload: load };
}

/* ======================================================== presentation */

/** The free times grouped by their day in `zone`, in order. */
export function groupByDay(slots: Slot[], zone: string): { key: string; first: string; slots: Slot[] }[] {
  const key = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const out: { key: string; first: string; slots: Slot[] }[] = [];
  for (const s of slots) {
    const k = key(s.start);
    const last = out.at(-1);
    if (last && last.key === k) last.slots.push(s);
    else out.push({ key: k, first: s.start, slots: [s] });
  }
  return out;
}

export function formatIn(iso: string, zone: string, opts: Intl.DateTimeFormatOptions, fallback = 'hu-HU') {
  try { return new Intl.DateTimeFormat(intlLocale(fallback), { timeZone: zone, ...opts }).format(new Date(iso)); } catch { return iso; }
}

/** "2026. november 2., hétfő, 09:00–09:30" in the reader's language. */
export function formatSpan(start: string, end: string, zone: string, fallback = 'hu-HU') {
  const day = formatIn(start, zone, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }, fallback);
  const hm = (iso: string) => formatIn(iso, zone, { hour: '2-digit', minute: '2-digit' }, fallback);
  return `${day}, ${hm(start)}–${hm(end)}`;
}

export const isUpcoming = (b: { ends_at: string }, now = Date.now()) => Date.parse(b.ends_at) > now;
