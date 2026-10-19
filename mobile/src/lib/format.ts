import type { LineKind } from './summary';

/** Dates as the Portal writes them: Hungarian, on Budapest's clock. */
const LOCALE = 'hu-HU';
const ZONE = 'Europe/Budapest';

/** A YYYY-MM-DD read at noon UTC, so no zone can move it to another day. */
const civil = (day: string) => new Date(`${day}T12:00:00Z`);

export const longDay = (day: string) =>
  new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(civil(day));

export const shortDay = (day: string) =>
  new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(civil(day));

export const clock = (iso: string) =>
  new Intl.DateTimeFormat(LOCALE, { timeZone: ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(iso));

/** "ma 14:00", "holnap 9:30" or "okt. 23. 10:00". */
export function when(iso: string, today: string): string {
  const day = dayOf(iso);
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const prefix = day === today ? 'ma' : day === tomorrow ? 'holnap' : shortDay(day);
  return `${prefix} ${clock(iso)}`;
}

/** The Portal's own words (portal/src/i18n/parts: pages.today, pages.sales; ClientApp.tsx). */
export const KIND: Record<LineKind, string> = {
  task: 'Teendő',
  followUp: 'Utánkövetés',
  checkpoint: 'Mérföldkő',
  meeting: 'Megbeszélés',
  alert: 'Figyelmeztetés',
  request: 'Kérés a Stratostól',
  approval: 'Jóváhagyásodra vár',
};
