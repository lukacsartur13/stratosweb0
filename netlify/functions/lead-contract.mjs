// =============================================================================
// The lead submission contract.
//
// One envelope, four forms, one place where the shape is stated. Both halves of
// the pipeline read this file: the Netlify function imports it to validate, and
// `tests/lead-contract.spec.ts` imports it to assert the contract itself rather
// than a re-description of it.
//
// It has no dependencies and touches no I/O on purpose — importing it costs
// nothing, so the handler can reject a malformed request without paying for the
// Supabase SDK, and a test can exercise every rule in-process.
//
//
// THE ENVELOPE
// ------------
//
//     {
//       submissionId: "3f2b1c8a-…",     RFC 4122 UUID, client-generated
//       formType:     "contact",        allow-list, see FORMS
//       locale:       "hu" | "en" | "de",
//       route:        "/en/contact.html",  same-site path, no scheme, no host
//       fields:       { … },            only names the form's schema declares
//       meta:         { … }             only keys META declares
//     }
//
// `submissionId` is generated once when the visitor starts a submission and
// re-sent unchanged on every retry of that same submission. It is the
// idempotency key: the unique index in 20260805000100_lead_envelope.sql makes a
// duplicate insert impossible, and the function answers a retry with the
// original lead id rather than with an error.
//
// `fields` is closed. A name the schema does not declare is dropped before
// anything is stored, so no browser payload can reach a column it was not meant
// to and no unexpected key can survive into `payload`.
//
// `meta` is closed for the same reason and is additionally *narrow*: timing and
// coarse attribution only. It never carries user-entered text, and it never
// carries a raw IP — `ip_hash` is computed server-side from the connection.
//
//
// THE RESPONSE
// ------------
//
//   200  { ok: true,  submissionId, leadId }
//   422  { ok: false, code: "VALIDATION_FAILED", message, errors: { field: msg } }
//   4xx  { ok: false, code, message }
//   5xx  { ok: false, code, message }
//
// `code` is stable and safe to branch on. `message` is safe to show a visitor.
// Neither ever carries a Postgres message, a column name, a constraint name or
// a stack — those go to the function log.
// =============================================================================

export const LOCALES = ['hu', 'en', 'de'];

/** Every column cap the leads table and the UI actually rely on. */
export const COLUMN_MAX = {
  name: 120, company: 160, email: 254, phone: 40, website: 300,
  service_interest: 80, budget_range: 60, timeframe: 60, message: 8000,
};

/** Hard ceiling on the raw request body. Well above the largest real
 *  questionnaire (about 12 KB of answers) and far below anything worth
 *  parsing from a client that is not a browser filling in a form. */
export const MAX_BODY_BYTES = 64 * 1024;

/** Bounds on the questionnaire transcript, which is the only list-shaped field
 *  in the contract. 51 questions are authored today; the ceiling leaves room
 *  without letting a caller post an unbounded array. */
export const MAX_ANSWERS = 80;
export const MAX_ANSWER_Q = 300;
export const MAX_ANSWER_A = 1200;

/** Nothing renders, reads and completes one of these forms this fast. */
export const MIN_FILL_MS = 3000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
// Deliberately permissive: international numbers are written a dozen ways and a
// strict pattern rejects real people. It refuses text, not formatting.
const PHONE_RE = /^[+()\d][\d\s\-()./]{5,}$/;
const URL_RE = /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i;

// ---------------------------------------------------------------- form schemas
//
// `type` drives validation. `max` caps length before storage. `required` is
// checked after trimming, so a field of spaces is empty.
//
// Field *names* are the ones in the markup — Hungarian, matching their labels
// — because that is what the browser posts. The mapping from these names to
// lead columns is `LEAD_MAPPERS` below, and it is the only place that
// translation happens.
//
// `terulet` (Impact) and `szegmens` (questionnaire) are radio/select values
// whose option labels are *translated per locale*. An enum here would have to
// hold all nine strings and would break the moment a translation is reworded,
// so they are bounded text: the option set is enforced by the markup, and the
// server enforces presence and length. Every genuinely locale-invariant choice
// is declared as an enum and checked.

/** @type {Record<string, {fields: Record<string, object>, consent?: string[]}>} */
export const FORMS = {
  newsletter: {
    fields: {
      email: { type: 'email', required: true, max: 254 },
    },
  },

  contact: {
    fields: {
      vezeteknev:            { type: 'text',     required: true,  max: 80 },
      keresztnev:            { type: 'text',     required: true,  max: 80 },
      email:                 { type: 'email',    required: true,  max: 254 },
      telefon:               { type: 'tel',      required: true,  max: 40 },
      ceg:                   { type: 'text',     required: true,  max: 160 },
      megjegyzes:            { type: 'textarea', required: true,  max: 4000 },
      adatvedelem_elfogadva: { type: 'consent',  required: true },
      hirlevel:              { type: 'consent',  required: false },
    },
  },

  impact: {
    fields: {
      org:                    { type: 'text',     required: true,  max: 160 },
      kapcs:                  { type: 'text',     required: true,  max: 120 },
      mail:                   { type: 'email',    required: true,  max: 254 },
      tel:                    { type: 'tel',      required: false, max: 40 },
      web:                    { type: 'url',      required: false, max: 300 },
      terulet:                { type: 'text',     required: true,  max: 120 },
      mivel:                  { type: 'textarea', required: true,  max: 2000 },
      hatas:                  { type: 'textarea', required: true,  max: 2000 },
      miert:                  { type: 'textarea', required: true,  max: 2000 },
      mit:                    { type: 'textarea', required: false, max: 2000 },
      adatkezeles_elfogadva:  { type: 'consent',  required: true },
    },
  },

  questionnaire: {
    fields: {
      cegnev:            { type: 'text',    required: true,  max: 160 },
      kitolto:           { type: 'text',    required: false, max: 120 },
      email:             { type: 'email',   required: true,  max: 254 },
      telefon:           { type: 'tel',     required: false, max: 40 },
      weboldal:          { type: 'text',    required: false, max: 300 },
      weboldal_nagy:     { type: 'text',    required: false, max: 300 },
      szegmens:          { type: 'text',    required: false, max: 120 },
      // Which branch of the wizard the visitor took. `szegmens` holds the
      // visitor-facing option label and is translated per locale, so it cannot
      // be compared against anything; this is the locale-invariant fact behind
      // it, and it is what decides the service_interest below.
      agazat:            { type: 'text',    required: false, max: 20,
                           enum: ['kkv', 'nagyvallalat'] },
      koltsegkeret:      { type: 'text',    required: false, max: 60 },
      koltsegkeret_nagy: { type: 'text',    required: false, max: 60 },
      havidij:           { type: 'text',    required: false, max: 60 },
      hatarido:          { type: 'text',    required: false, max: 60 },
      hatarido_nagy:     { type: 'text',    required: false, max: 60 },
      konstrukcio:       { type: 'text',    required: false, max: 80 },
      konzultacio:       { type: 'text',    required: false, max: 80 },
      funkciok:          { type: 'text',    required: false, max: 600 },
      answers:           { type: 'answers', required: false },
    },
  },
};

export const FORM_TYPES = Object.keys(FORMS);

/** Meta keys the server will store. Everything else in `meta` is dropped. */
export const META = {
  // Milliseconds between the form being ready and the visitor submitting.
  // Used by the timing gate and kept because it is the single most useful
  // signal when triaging a suspicious row later.
  elapsedMs: { type: 'int', max: 86_400_000 },
  // Origin only, never the full referring URL — a full referrer can carry
  // query strings that belong to someone else's analytics, not in our table.
  referrerOrigin: { type: 'text', max: 200 },
  // 'portrait' | 'landscape' | 'desktop'. Coarse on purpose; it answers "was
  // this filled on a phone" without fingerprinting anybody.
  viewport: { type: 'text', max: 20 },
  // How many attempts this submissionId has made. A retry is normal; ten is
  // worth seeing.
  attempt: { type: 'int', max: 100 },

  // -------------------------------------------------------------- attribution
  //
  // Phase 9, Workstream D. Design and the decisions behind it:
  // _build/reports/phase9-attribution-design.md.
  //
  // These are stored in `meta`, which is jsonb, so nothing here needed a
  // migration and the leads table is unchanged. They are declared HERE and
  // nowhere else — `normaliseMeta` copies only keys in this object, so a
  // request that invents `utm_id`, `gclid`, `email` or any other name has
  // exactly no route into the row, whatever the browser was asked to send.
  //
  // The client's allow-list in assets/js/lead.js is the first of the two, and
  // this one is the one that holds: a hand-written POST never passed through
  // it. Both lists are asserted against each other by tests/attribution.spec.ts.
  //
  // NO ADVERTISING CLICK IDENTIFIER IS DECLARED, deliberately. `gclid`,
  // `fbclid`, `msclkid` and their relatives are per-click identifiers a vendor
  // can join back to a person; the five UTM parameters are campaign labels that
  // cannot. Nothing on this site runs advertising, so storing one would be
  // collecting an identifier for a purpose that does not exist.
  utmSource: { type: 'text', max: 100 },
  utmMedium: { type: 'text', max: 100 },
  utmCampaign: { type: 'text', max: 100 },
  utmContent: { type: 'text', max: 100 },
  utmTerm: { type: 'text', max: 100 },
  // Path only, checked by `normaliseRoute` rather than by `clean` — it is
  // rendered in the portal, so it is held to the same rule as `source_route`
  // and cannot carry a scheme, a host or a query string.
  landingRoute: { type: 'route', max: 300 },
  // Host only. A full referrer URL can carry someone else's query string, and
  // a search referrer can carry the query someone typed; neither belongs in
  // our table. Lower-cased so `Google.com` and `google.com` group.
  landingReferrerHost: { type: 'host', max: 120 },
  // Which of our own hosts served the page. Not visitor data: it is how a
  // pre-cutover netlify.app submission is told from a real one afterwards.
  host: { type: 'host', max: 120 },
};

// ------------------------------------------------------------------- helpers

/** Trim, drop control characters, cap. Never throws, always returns a string. */
export function clean(value, limit = 1000) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (Array.isArray(value)) return clean(value.filter((v) => v != null).join(', '), limit);
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, limit);
}

/** A consent checkbox is "true" only for values a checkbox can actually post. */
function isAffirmative(value) {
  if (value === true) return true;
  const v = clean(value, 20).toLowerCase();
  return v === 'igen' || v === 'yes' || v === 'ja' || v === 'true' || v === 'on' || v === '1';
}

/**
 * A same-site path, or null.
 *
 * Accepts `/kkv.html`, `/en/contact.html`, `/`. Refuses a scheme, a host, a
 * protocol-relative `//evil.example`, and anything with a control character —
 * this value is stored and later rendered in the portal, so it is treated as
 * hostile input rather than as a fact about our own site.
 */
export function normaliseRoute(value) {
  const raw = clean(value, 300);
  if (!raw) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  if (/[:\\]/.test(raw)) return null;
  return raw;
}

// ---------------------------------------------------------------- validation

/**
 * Validate one declared field.
 * @returns {{ value: unknown, error?: string }}
 */
function validateField(name, spec, raw, t) {
  if (spec.type === 'answers') return validateAnswers(raw, t);

  if (spec.type === 'consent') {
    const given = isAffirmative(raw);
    if (spec.required && !given) return { value: false, error: t.consent };
    return { value: given };
  }

  const value = clean(raw, spec.max);

  // Length is checked against the *uncapped* input so that "too long" is
  // reported rather than silently truncated. `clean` above caps for storage;
  // this compares what arrived.
  if (typeof raw === 'string' && raw.trim().length > spec.max) {
    return { value, error: t.tooLong };
  }

  if (!value) {
    return spec.required ? { value, error: t.required } : { value: '' };
  }

  if (spec.type === 'email' && !EMAIL_RE.test(value)) return { value, error: t.email };
  if (spec.type === 'tel' && !PHONE_RE.test(value)) return { value, error: t.phone };
  if (spec.type === 'url' && !URL_RE.test(value)) return { value, error: t.url };
  if (spec.enum && !spec.enum.includes(value)) return { value, error: t.choice };

  return { value };
}

/** The questionnaire transcript: a bounded list of bounded question/answer pairs. */
function validateAnswers(raw, t) {
  if (raw === undefined || raw === null || raw === '') return { value: [] };
  if (!Array.isArray(raw)) return { value: [], error: t.shape };
  if (raw.length > MAX_ANSWERS) return { value: [], error: t.tooLong };

  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const q = clean(item.q, MAX_ANSWER_Q);
    const a = clean(item.a, MAX_ANSWER_A);
    if (q) out.push({ q, a });
  }
  return { value: out };
}

/**
 * A hostname, or ''.
 *
 * Refuses anything that is not a bare host: no scheme, no port, no path, no
 * credentials, no spaces. These values are rendered in the portal, so they are
 * treated as hostile input rather than as a fact about who linked to us.
 */
export function normaliseHost(value) {
  const raw = clean(value, 120).toLowerCase();
  if (!raw) return '';
  if (!/^[a-z0-9.-]+$/.test(raw)) return '';
  if (raw.startsWith('.') || raw.endsWith('.') || raw.includes('..')) return '';
  return raw;
}

/** Keep only the declared meta keys, coerced to their declared type. */
export function normaliseMeta(meta) {
  const out = {};
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return out;
  for (const [key, spec] of Object.entries(META)) {
    const raw = meta[key];
    if (raw === undefined || raw === null) continue;
    if (spec.type === 'int') {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) out[key] = Math.min(Math.round(n), spec.max);
    } else if (spec.type === 'host') {
      const v = normaliseHost(raw);
      if (v) out[key] = v;
    } else if (spec.type === 'route') {
      // Dropped rather than rejected: a malformed landing route is a fact we
      // would like to have and can do without, and it must never be the reason
      // a real enquiry fails.
      const v = normaliseRoute(raw);
      if (v) out[key] = v.slice(0, spec.max);
    } else {
      const v = clean(raw, spec.max);
      if (v) out[key] = v;
    }
  }
  return out;
}

/**
 * Validate a whole envelope.
 *
 * Returns either `{ ok: true, envelope }` with everything normalised, or
 * `{ ok: false, code, message, errors? }` ready to be serialised as the
 * response body. It never throws on hostile input; that is the point.
 */
export function validateEnvelope(body, messages = MESSAGES.en) {
  const t = messages;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, code: 'MALFORMED_JSON', message: t.malformed };
  }

  const submissionId = clean(body.submissionId, 64);
  if (!UUID_RE.test(submissionId)) {
    return { ok: false, code: 'INVALID_SUBMISSION_ID', message: t.malformed };
  }

  const formType = clean(body.formType, 40);
  if (!FORM_TYPES.includes(formType)) {
    return { ok: false, code: 'UNSUPPORTED_FORM_TYPE', message: t.unsupportedForm };
  }

  const locale = LOCALES.includes(clean(body.locale, 5)) ? clean(body.locale, 5) : null;
  if (!locale) {
    return { ok: false, code: 'UNSUPPORTED_LOCALE', message: t.malformed };
  }

  const route = normaliseRoute(body.route);
  if (body.route !== undefined && body.route !== null && body.route !== '' && route === null) {
    return { ok: false, code: 'INVALID_ROUTE', message: t.malformed };
  }

  const raw = body.fields;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'VALIDATION_FAILED', message: t.invalid, errors: { _form: t.shape } };
  }

  const schema = FORMS[formType].fields;
  const fields = {};
  const errors = {};

  for (const [name, spec] of Object.entries(schema)) {
    const { value, error } = validateField(name, spec, raw[name], t);
    if (error) errors[name] = error;
    // Store falsy-but-meaningful values (false consent, empty optional string)
    // only when they carry information: an unchecked optional consent is a fact,
    // an empty optional text field is not.
    if (spec.type === 'consent' || value !== '') fields[name] = value;
  }

  // Unknown names are dropped rather than rejected. A browser that autofills an
  // extra field, or a locale build that gains one before the schema does,
  // should not lose the visitor's whole submission — and because the loop above
  // only ever reads *declared* names, nothing undeclared can reach storage.
  const dropped = Object.keys(raw).filter((k) => !(k in schema));

  if (Object.keys(errors).length) {
    return { ok: false, code: 'VALIDATION_FAILED', message: t.invalid, errors };
  }

  return {
    ok: true,
    envelope: {
      submissionId: submissionId.toLowerCase(),
      formType,
      locale,
      route,
      fields,
      meta: normaliseMeta(body.meta),
      dropped,
    },
  };
}

// -------------------------------------------------------------- lead mapping
//
// One function per form, turning validated `fields` into the flat commercial
// columns the team and the portal read. This is the only translation from
// markup names to database columns; when a form gains a field, it changes here
// and nowhere else.

/** Labelled block for answers the leads table has no column of its own for. */
const lines = (pairs) =>
  pairs.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');

const transcript = (answers) =>
  (answers || [])
    .map((x, i) => `${String(i + 1).padStart(2, '0')}. ${x.q}\n${x.a || '—'}`)
    .join('\n\n');

export const LEAD_MAPPERS = {
  // One field and no name to give. `name` is filled with a stand-in rather than
  // left empty, because the column is NOT NULL — see the leads table.
  newsletter: (f) => ({
    name: 'Newsletter subscriber',
    email: f.email,
  }),

  contact: (f) => ({
    name: [f.vezeteknev, f.keresztnev].filter(Boolean).join(' '),
    company: f.ceg,
    email: f.email,
    phone: f.telefon,
    message: lines([
      ['Üzenet', f.megjegyzes],
      ['Adatvédelmi nyilatkozat elfogadva', f.adatvedelem_elfogadva ? 'Igen' : 'Nem'],
      ['Hírlevelet kér', f.hirlevel ? 'Igen' : 'Nem'],
    ]),
  }),

  impact: (f) => ({
    name: f.kapcs,
    company: f.org,
    email: f.mail,
    phone: f.tel,
    website: f.web,
    service_interest: 'Impact Program',
    message: lines([
      ['Tevékenységi terület', f.terulet],
      ['Mivel foglalkozik a szervezet', f.mivel],
      ['Elért hatás', f.hatas],
      ['Miért fontos az új weboldal', f.miert],
      ['Mit tudjon az új weboldal', f.mit],
      ['Adatkezelés elfogadva', f.adatkezeles_elfogadva ? 'Igen' : 'Nem'],
    ]),
  }),

  questionnaire: (f) => {
    // The enterprise branch asks its own budget, timeframe and website
    // questions; which pair is meaningful depends on the branch the visitor
    // took, and the answer that exists is the one they gave. `agazat` states
    // the branch outright; the fallback covers an older client that predates
    // that field and would otherwise land in the SME copy by default.
    const enterprise = f.agazat
      ? f.agazat === 'nagyvallalat'
      : Boolean(f.koltsegkeret_nagy || f.hatarido_nagy || f.weboldal_nagy);
    return {
      // The contact name is optional and only stands in for the company name
      // when it is usable on its own — a one-character answer is not.
      name: (f.kitolto || '').length >= 2 ? f.kitolto : f.cegnev,
      company: f.cegnev,
      email: f.email,
      phone: f.telefon,
      website: f.weboldal_nagy || f.weboldal,
      service_interest: enterprise
        ? 'Igényfelmérő – nagyvállalat'
        : 'Igényfelmérő – KKV',
      budget_range: f.koltsegkeret_nagy || f.koltsegkeret || f.havidij,
      timeframe: f.hatarido_nagy || f.hatarido,
      message: transcript(f.answers),
    };
  },
};

/**
 * Build the row. Every column is capped again here, after mapping, because a
 * mapper can concatenate two valid fields into one that is over the limit.
 */
export function toLeadRow(envelope) {
  // A legacy body is already column-shaped and already allow-listed by
  // LEGACY_FIELDS; running it through a per-form mapper would map it twice.
  // Remove this branch with the adapter — see its dated banner above.
  const mapped = envelope.legacy
    ? envelope.fields
    : LEAD_MAPPERS[envelope.formType](envelope.fields);
  const row = {
    submission_id: envelope.submissionId,
    form_type: envelope.formType,
    // Kept in step with form_type: the portal and every pre-existing row read
    // `source`, and leaving it behind would quietly split the same fact in two.
    source: envelope.formType,
    locale: envelope.locale,
    source_route: envelope.route,
    payload: envelope.fields,
    meta: envelope.meta,
  };
  for (const [col, limit] of Object.entries(COLUMN_MAX)) {
    const v = clean(mapped[col], limit);
    row[col] = v || null;
  }
  // NOT NULL in the schema, and a mapper can only fail to fill it if validation
  // let an empty required field through. Belt and braces.
  if (!row.name) row.name = 'Ismeretlen';
  return row;
}

// =============================================================================
// LEGACY COMPATIBILITY ADAPTER
//
//                REMOVE ON OR AFTER 2026-09-05.
//
// Why it exists
// -------------
// A deploy is atomic on the server and is not atomic in the browser. When the
// new function goes live there will be visitors holding the previous
// assets/js/main.js — in an open tab, and from cache: netlify.toml serves
// /assets/* with `max-age=604800`, so a seven-day-old copy of the old client
// is a correct cache hit, not a stale one. Those clients post the pre-envelope
// flat body. Without this adapter every one of them gets a 400 and loses their
// submission, and neither they nor we would see why.
//
// What the old client sent
// ------------------------
//     { source, locale, name, company, email, phone, website,
//       service_interest, budget_range, timeframe, message,
//       company_website, elapsed_ms }
//
// The keys are already database column names. That was the original defect,
// and it is exactly why this adapter does NOT pass the body through: it reads
// only the names in LEGACY_FIELDS below and drops everything else, so a legacy
// request has no more reach into the table than a canonical one.
//
// Removal
// -------
// The window is seven days of asset cache plus a margin for long-lived tabs.
// On or after 2026-09-05, delete: LEGACY_FIELDS, normaliseLegacy, the 'legacy'
// branch of detectFormat and toLeadRow, and the legacy describe block in
// tests/lead-endpoint.spec.ts. Nothing else depends on any of it. After
// removal a legacy body falls through to MALFORMED_JSON, which by then is the
// correct answer.
// =============================================================================

/**
 * The only legacy keys that may reach a column, and their caps.
 *
 * These are column names, so the list is closed and is checked against
 * COLUMN_MAX — a legacy key that is not here cannot be written, and nothing
 * iterates the request body.
 *
 * Values are TRUNCATED rather than rejected when over-long, because that is
 * what the old server did (`clean(value, limit)` sliced). An old client that
 * was succeeding before the deploy must not start failing because of it.
 */
export const LEGACY_FIELDS = {
  name:             { max: COLUMN_MAX.name },
  company:          { max: COLUMN_MAX.company },
  email:            { max: COLUMN_MAX.email, type: 'email', required: true },
  phone:            { max: COLUMN_MAX.phone },
  website:          { max: COLUMN_MAX.website },
  service_interest: { max: COLUMN_MAX.service_interest },
  budget_range:     { max: COLUMN_MAX.budget_range },
  timeframe:        { max: COLUMN_MAX.timeframe },
  message:          { max: COLUMN_MAX.message },
};

/**
 * Which contract a body is written in.
 *
 * This routes; it does not validate. A body that shows any canonical marker is
 * *claiming* to be canonical and is sent to `validateEnvelope`, which can say
 * precisely what is wrong with it — answering "malformed JSON" to an envelope
 * whose `fields` is a string would be true but useless. Only a body with no
 * marker from either contract is unknown.
 *
 * Both sides are recognised positively, by names only that contract uses:
 * `formType`/`fields` exist solely in the envelope, and the old client sent
 * `source` on every form including the one-field newsletter (see `toLead` in
 * the pre-Phase-8 main.js). Nothing is inferred from absence alone.
 */
export function detectFormat(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'unknown';

  const claimsEnvelope = body.formType !== undefined || body.fields !== undefined;
  if (claimsEnvelope) return 'canonical';

  if (typeof body.source === 'string') return 'legacy';

  return 'unknown';
}

/**
 * Turn a legacy flat body into the canonical internal envelope.
 *
 * The result is marked `legacy: true`, which makes `toLeadRow` skip the
 * per-form mappers: a legacy body arrives already mapped to columns, so
 * running it through a mapper would map it twice.
 *
 * Validation deliberately reproduces the OLD server's rules, not the new
 * per-form schemas. The new schemas require fields the old client never sent
 * — a contact submission carries `name`, not `vezeteknev` and `keresztnev` —
 * so holding a legacy request to them would reject every one of them.
 * Canonical requests are unaffected and stay strict.
 */
export function normaliseLegacy(body, messages = MESSAGES.en) {
  const t = messages;

  const formType = FORM_TYPES.includes(clean(body.source, 40))
    ? clean(body.source, 40)
    : 'website';
  const locale = LOCALES.includes(clean(body.locale, 5)) ? clean(body.locale, 5) : 'hu';

  const fields = {};
  for (const [name, spec] of Object.entries(LEGACY_FIELDS)) {
    const value = clean(body[name], spec.max);      // truncates, never rejects
    if (value) fields[name] = value;
  }

  const errors = {};
  // The old server's two rules, kept verbatim so behaviour does not change
  // under a client that cannot be updated.
  if (formType === 'newsletter') {
    if (!fields.name) fields.name = 'Newsletter subscriber';
  } else if ((fields.name || '').length < 2) {
    errors.name = t.required;
  }
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(fields.email || '')) errors.email = t.email;

  if (Object.keys(errors).length) {
    return { ok: false, code: 'VALIDATION_FAILED', message: t.invalid, errors };
  }

  const elapsed = Number(body.elapsed_ms);

  return {
    ok: true,
    envelope: {
      // Server-generated, because the old client has no concept of one. See
      // the idempotency note below — this is NOT an idempotency key.
      submissionId: crypto.randomUUID(),
      formType,
      locale,
      route: null,                    // the old client did not report one
      fields,
      meta: {
        ...normaliseMeta({ elapsedMs: Number.isFinite(elapsed) ? elapsed : undefined }),
        // Set here, after normaliseMeta, and never accepted from a request:
        // normaliseMeta copies only the keys META declares, so a canonical
        // client cannot mislabel itself as legacy. `meta.legacyClient === true`
        // is therefore a reliable marker of a row this adapter produced.
        legacyClient: true,
        // IDEMPOTENCY LIMITATION, recorded on the row itself.
        //
        // The id above is minted per REQUEST, not per submission. A legacy
        // client that retries after a timeout sends no id and gets a new one,
        // so the retry becomes a second lead. There is no fix that does not
        // guess: deriving an id from the content would silently merge two
        // genuine enquiries that happen to look alike, which is a worse
        // failure than a visible duplicate. Duplicates from legacy clients are
        // findable with `where meta->>'submissionIdSource' = 'server'`.
        submissionIdSource: 'server',
      },
      legacy: true,
      dropped: Object.keys(body).filter(
        (k) => !(k in LEGACY_FIELDS) &&
               !['source', 'locale', 'company_website', 'elapsed_ms'].includes(k),
      ),
    },
  };
}

// ------------------------------------------------------------------ messages
//
// Server-side copy, in the visitor's language. The client has its own strings
// for the states it owns (sending, sent); these are the ones only the server
// can decide.

export const MESSAGES = {
  hu: {
    required: 'Ezt a mezőt kötelező kitölteni.',
    email: 'Ez az e-mail cím nem tűnik helyesnek.',
    phone: 'Ez a telefonszám nem tűnik helyesnek.',
    url: 'Ez a webcím nem tűnik helyesnek.',
    choice: 'Válassz a felkínált lehetőségek közül.',
    consent: 'A továbblépéshez el kell fogadnod a feltételeket.',
    tooLong: 'Ez a mező túl hosszú — kérjük, rövidítsd le.',
    shape: 'A beküldés formátuma hibás.',
    invalid: 'Kérjük, ellenőrizd a kiemelt mezőket.',
    malformed: 'A beküldést nem sikerült értelmezni.',
    unsupportedForm: 'Ismeretlen űrlaptípus.',
    tooLarge: 'A beküldés túl nagy.',
    method: 'Ez a végpont csak POST kérést fogad.',
    mediaType: 'A beküldést JSON formátumban várjuk.',
    limited: 'Túl sok beküldés egymás után. Kérlek, várj egy percet.',
    unavailable: 'Az űrlap átmenetileg nem elérhető. Írj a lukacs.artur@media-stratos.com címre.',
    storeFailed: 'Nem sikerült elmenteni. Írj a lukacs.artur@media-stratos.com címre.',
  },
  en: {
    required: 'This field is required.',
    email: 'That email address does not look right.',
    phone: 'That phone number does not look right.',
    url: 'That web address does not look right.',
    choice: 'Please choose one of the options offered.',
    consent: 'You need to accept the terms to continue.',
    tooLong: 'This field is too long — please shorten it.',
    shape: 'The submission is malformed.',
    invalid: 'Please check the highlighted fields.',
    malformed: 'We could not read the submission.',
    unsupportedForm: 'Unknown form type.',
    tooLarge: 'The submission is too large.',
    method: 'This endpoint only accepts POST.',
    mediaType: 'This endpoint expects JSON.',
    limited: 'Too many submissions in a row. Please wait a minute.',
    unavailable: 'The form is temporarily unavailable. Please email lukacs.artur@media-stratos.com.',
    storeFailed: 'We could not save that. Please email lukacs.artur@media-stratos.com.',
  },
  de: {
    required: 'Dieses Feld ist erforderlich.',
    email: 'Diese E-Mail-Adresse sieht nicht richtig aus.',
    phone: 'Diese Telefonnummer sieht nicht richtig aus.',
    url: 'Diese Webadresse sieht nicht richtig aus.',
    choice: 'Bitte wähle eine der angebotenen Optionen.',
    consent: 'Bitte akzeptiere die Bedingungen, um fortzufahren.',
    tooLong: 'Dieses Feld ist zu lang — bitte kürze es.',
    shape: 'Die Übermittlung hat ein fehlerhaftes Format.',
    invalid: 'Bitte überprüfe die markierten Felder.',
    malformed: 'Die Übermittlung konnte nicht gelesen werden.',
    unsupportedForm: 'Unbekannter Formulartyp.',
    tooLarge: 'Die Übermittlung ist zu groß.',
    method: 'Dieser Endpunkt akzeptiert nur POST.',
    mediaType: 'Dieser Endpunkt erwartet JSON.',
    limited: 'Zu viele Übermittlungen hintereinander. Bitte warte eine Minute.',
    unavailable: 'Das Formular ist vorübergehend nicht verfügbar. Schreib an lukacs.artur@media-stratos.com.',
    storeFailed: 'Wir konnten das nicht speichern. Schreib an lukacs.artur@media-stratos.com.',
  },
};

/** The message table for a request, chosen before the body is trusted. */
export function messagesFor(locale) {
  return MESSAGES[locale] || MESSAGES.en;
}
