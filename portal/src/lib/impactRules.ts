// =============================================================================
// The Impact Program — vocabulary and pure rules.
//
// NO IMPORTS (but the pure ./i18n), like lib/money.ts and lib/pipeline.ts: tests/portal-impact.spec.ts
// imports this file directly. The enforcement is the database
// (20260929000300_impact_program.sql); everything here only decides what is
// drawn, and says the database's rules before the database has to.
// =============================================================================

import { t } from './i18n.ts';

/** The application pipeline, in the order an application moves through it. */
export const IMPACT_STATUSES = [
  'applied', 'review', 'consultation', 'accepted', 'project_started', 'rejected', 'deferred',
] as const;
export type ImpactStatus = (typeof IMPACT_STATUSES)[number];

// Labels and notes are English source text, translated where they are read
// (`impactStatusLabel`; a note with `t(note)`) — never here, at import.
export const IMPACT_STATUS: Record<ImpactStatus, {
  label: string; tone: 'neutral' | 'good' | 'warn' | 'bad'; note: string;
}> = {
  applied:         { label: 'Applied',         tone: 'warn',    note: 'Arrived through the Impact form.' },
  review:          { label: 'In review',       tone: 'neutral', note: 'Being assessed.' },
  consultation:    { label: 'Consultation',    tone: 'neutral', note: 'Talking it through with the applicant.' },
  accepted:        { label: 'Accepted',        tone: 'good',    note: 'A project can be started from it.' },
  project_started: { label: 'Project started', tone: 'good',    note: 'An Impact project exists.' },
  rejected:        { label: 'Rejected',        tone: 'bad',     note: 'Not taken on.' },
  deferred:        { label: 'Deferred',        tone: 'neutral', note: 'Not now — kept for a later round.' },
};

export const impactStatusLabel = (s: string) => {
  const label = IMPACT_STATUS[s as ImpactStatus]?.label;
  return label ? t(label) : s;
};
export const impactStatusTone = (s: string) => IMPACT_STATUS[s as ImpactStatus]?.tone ?? 'neutral';

/**
 * What the status control offers. `project_started` is not in it: only
 * `impact_start_project()` sets it, together with the project, and the
 * database refuses it by hand (`impact_applications_started_check`).
 */
export const SETTABLE_IMPACT_STATUSES = IMPACT_STATUSES.filter((s) => s !== 'project_started');

/** Mirrors `lead_is_impact()` in the migration. `service_interest` is deliberately not a signal. */
export function isImpactLead(lead: { form_type: string | null; source?: string | null }): boolean {
  if (lead.form_type === 'impact') return true;
  return lead.form_type === null && (lead.source ?? '').trim().toLowerCase() === 'impact';
}

/**
 * The Impact form's questions, in the order the form asks them, under the
 * wording the applicant saw (netlify/functions/lead-contract.mjs → FORMS.impact
 * and LEAD_MAPPERS.impact). Answers are shown under these, not re-worded.
 */
export const IMPACT_QUESTIONS: { key: string; label: string; contact?: boolean }[] = [
  { key: 'org', label: 'Szervezet', contact: true },
  { key: 'kapcs', label: 'Kapcsolattartó', contact: true },
  { key: 'mail', label: 'E-mail', contact: true },
  { key: 'tel', label: 'Telefon', contact: true },
  { key: 'web', label: 'Weboldal', contact: true },
  { key: 'terulet', label: 'Tevékenységi terület' },
  { key: 'mivel', label: 'Mivel foglalkozik a szervezet' },
  { key: 'hatas', label: 'Elért hatás' },
  { key: 'miert', label: 'Miért fontos az új weboldal' },
  { key: 'mit', label: 'Mit tudjon az új weboldal' },
  { key: 'adatkezeles_elfogadva', label: 'Adatkezelés elfogadva' },
];

/**
 * The stored answers as label/value pairs: the known questions first, in form
 * order, then anything else the payload holds under its own key — an answer
 * the UI was not taught about is still the applicant's answer.
 */
export function impactAnswers(payload: Record<string, unknown> | null | undefined): { label: string; value: string }[] {
  const data = payload && typeof payload === 'object' ? payload : {};
  const text = (v: unknown) => (v === true ? t('Igen') : v === false ? t('Nem') : String(v));
  const known = new Set(IMPACT_QUESTIONS.map((q) => q.key));
  const out: { label: string; value: string }[] = [];
  for (const q of IMPACT_QUESTIONS) {
    if (q.contact) continue;
    const v = data[q.key];
    if (v !== undefined && v !== null && v !== '') out.push({ label: t(q.label), value: text(v) });
  }
  for (const [key, v] of Object.entries(data)) {
    if (known.has(key) || v === undefined || v === null || v === '') continue;
    out.push({ label: key, value: typeof v === 'object' ? JSON.stringify(v) : text(v) });
  }
  return out;
}

/**
 * Parse a market value typed by a person: whole forints, spaces and dots as
 * thousands separators allowed ("1 250 000", "1.250.000"), nothing else.
 *
 *   ''            → { value: null }   — "not recorded", distinct from 0
 *   '0'           → { value: 0 }
 *   '1 250 000'   → { value: 1250000 }
 *   '12,5' / '-1' / 'abc' → { error }
 */
export function parseMarketValue(raw: string): { value: number | null } | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === '') return { value: null };
  const compact = trimmed.replace(/[\s ]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(/(Ft|HUF)$/i, '');
  if (!/^\d+$/.test(compact)) {
    return { error: t('The market value is a whole number of forints, e.g. 1 250 000. No decimals, no minus sign.') };
  }
  const value = Number(compact);
  if (!Number.isSafeInteger(value) || value > 1_000_000_000_000) {
    return { error: t('That market value is out of range.') };
  }
  return { value };
}

/**
 * Why an Impact project cannot be closed yet, in the order to fix it — or
 * null when it can. The same rules as `project_close_rules`; said first here
 * so the screen names what is missing rather than relaying a refusal.
 */
export function impactCloseBlockers(
  project: { market_value: number | null },
  checkpoints: { total: number; done: number },
): string[] {
  const out: string[] = [];
  if (checkpoints.total === 0) out.push(t('at least one checkpoint'));
  else if (checkpoints.done < checkpoints.total) {
    out.push(t('{open} of {total} checkpoints still open', {
      open: checkpoints.total - checkpoints.done, total: checkpoints.total,
    }));
  }
  if (project.market_value === null) out.push(t('the market value of the donated work'));
  return out;
}

/** The database's Impact refusals, as sentences. Null for anything else. */
export function impactRefusal(message: string | null | undefined): string | null {
  if (!message) return null;
  const map: [string, string][] = [
    ['stratos:impact_not_accepted', 'Only an accepted application can start a project.'],
    ['stratos:impact_application_started', 'A project has already been started from this application.'],
    ['impact_applications_started_check', '“Project started” is set by starting a project, not by hand.'],
    ['stratos:impact_not_sellable', 'An Impact application is free. It cannot become a paid opportunity.'],
    ['stratos:impact_client_missing', 'That client no longer exists. Choose another, or create a new one.'],
    ['stratos:impact_client_name_required', 'A new client needs a name.'],
    ['stratos:impact_project_name_required', 'The project needs a name.'],
    ['stratos:impact_application_missing', 'This application does not exist, or this account may not read it.'],
    ['stratos:owner_only', 'Only the portal owner can start an Impact project.'],
    ['stratos:impact_close_no_market_value', 'Record the market value of the donated work before closing — and a closed project keeps it.'],
    ['projects_impact_free_check', 'An Impact project is free: no fee, invoice, payment or opportunity can be put on it.'],
    ['stratos:lead_program_fixed', 'Whether a lead is an Impact application is decided by the form it came from.'],
  ];
  // English source text, translated on the way out.
  for (const [needle, sentence] of map) if (message.includes(needle)) return t(sentence);
  return null;
}
