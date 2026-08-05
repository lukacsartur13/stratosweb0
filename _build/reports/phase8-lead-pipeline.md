# Lead submission pipeline — repair and standardisation

Covers the replacement §6. The website does **not** use Netlify Forms and no
part of this work adds it: no `data-netlify`, no static blueprints, no hidden
`form-name`, no dependency on the Netlify Forms dashboard.

The architecture is, and remains:

```
browser form  →  JSON POST /api/lead  →  Netlify Function  →  Supabase `leads`  →  private Stratos Portal
```

---

## 1. Root cause

There was no single failure. There were four, and the first one is the reason
the others were invisible.

**1. There was never one pipeline — there were two implementations of one.**
`assets/js/main.js` carried a submission controller for `form[data-lead]`, and
each of `assets/js/quote.{hu,en,de}.js` carried its own, generated separately
per locale. Both posted to `/api/lead`, but they built the body independently,
mapped fields independently and reported failures independently. A fix to one
was not a fix to the other, and nothing asserted that the two agreed.

**2. The request had no envelope, and no identity.** The body was a flat object
whose keys were already database column names:

```json
{ "name": "…", "company": "…", "email": "…", "source": "contact",
  "locale": "hu", "message": "…", "company_website": "", "elapsed_ms": 42000 }
```

The consequences:

* **No idempotency.** Nothing identified a submission, so a retry after a
  timeout, a double-fired submit or a flaky connection created a second lead
  that was indistinguishable from a second enquiry.
* **The browser chose the columns.** `source` and every commercial column were
  taken from the request. The server re-validated their *values* but the
  client's field-to-column mapping was the only one there was, so a mapping bug
  in one locale's wizard wrote wrong data with no server-side check able to
  notice.
* **No provenance.** Nothing recorded which page a lead came from.
* **No per-form schema.** One validator ran for all four forms: name present,
  email well-formed, everything else capped. A contact submission missing its
  consent checkbox, an Impact application missing its impact statement and a
  questionnaire missing its company name were all accepted.

**3. The questionnaire answers arrived as prose.** The wizard flattened all 51
answers into an 8,000-character `message` string, client-side, three times over
— once per locale. The structure was destroyed before it left the browser, so
the portal could only ever show a wall of text, and the transcript's format was
decided in three places.

**4. Failures were reported inconsistently.** `{ ok: false, error }` for some
paths, `{ ok: false, errors: {…} }` for others, and no stable machine-readable
code anywhere. Both clients branched on HTTP status alone.

### What was *not* the cause

The server-side gates were sound and are preserved: POST-only, per-IP rate
limit, honeypot, minimum fill time, per-column caps, source allow-list, IP
hashing, explicit insert column list, and no Postgres text in any response.

---

## 2. Affected forms

| # | form | routes | previous handler | now |
|---|---|---|---|---|
| 1 | newsletter (footer) | all 33 | `main.js` | `assets/js/lead.js` |
| 2 | newsletter (blog body) | 3 | `main.js` | `assets/js/lead.js` |
| 3 | contact | 3 | `main.js` | `assets/js/lead.js` |
| 4 | Impact application | 3 | `main.js` | `assets/js/lead.js` |
| 5 | questionnaire wizard | 3 | `quote.{hu,en,de}.js`, one copy each | `assets/js/lead.js` |

All five now build the same envelope through the same function.

---

## 3. Canonical request contract

Stated once, in `netlify/functions/lead-contract.mjs`, and imported by both the
function and the tests so the contract and its assertions cannot drift.

```json
{
  "submissionId": "3f2b1c8a-…",
  "formType": "newsletter | contact | impact | questionnaire",
  "locale": "hu | en | de",
  "route": "/en/contact.html",
  "fields": { "…": "schema-approved names only" },
  "meta": { "elapsedMs": 42000, "referrerOrigin": "…", "viewport": "desktop",
            "attempt": 1, "botField": "" }
}
```

* **`submissionId`** — client-generated UUID v4, checked against a strict
  pattern. Generated once per submission *attempt sequence*: it survives a
  failed attempt so a retry is recognised, and is replaced after a success so
  the next enquiry is a new lead.
* **`formType`** — allow-list of exactly four values. Also constrained in the
  database.
* **`locale`** — allow-list of three. Chooses the language of every server
  message.
* **`route`** — a same-site path. A scheme, a host, a protocol-relative
  `//host` or a backslash is refused outright, because this value is stored and
  later rendered in the portal.
* **`fields`** — **closed**. Only names the form's schema declares survive;
  anything else is dropped before storage, logged as `fields.dropped`, and can
  never reach a column. An undeclared name does not fail the submission, so a
  browser autofill or a locale build that gains a field before the schema does
  cannot cost a visitor their whole enquiry.
* **`meta`** — closed and narrow. Timing and coarse attribution only. Never
  user-entered text, never a raw IP.
* **`meta.botField`** — the honeypot. It lives in `meta` rather than in
  `fields` precisely so no schema can declare it and no mapping can reach a
  column with it.

### Per-form schemas

| form | required | optional |
|---|---|---|
| newsletter | `email` | — |
| contact | `vezeteknev`, `keresztnev`, `email`, `telefon`, `ceg`, `megjegyzes`, `adatvedelem_elfogadva` | `hirlevel` |
| impact | `org`, `kapcs`, `mail`, `terulet`, `mivel`, `hatas`, `miert`, `adatkezeles_elfogadva` | `tel`, `web`, `mit` |
| questionnaire | `cegnev`, `email` | `kitolto`, `telefon`, `weboldal`, `weboldal_nagy`, `szegmens`, `agazat`, `koltsegkeret`, `koltsegkeret_nagy`, `havidij`, `hatarido`, `hatarido_nagy`, `konstrukcio`, `konzultacio`, `funkciok`, `answers` |

Field types are `text`, `email`, `tel`, `url`, `textarea`, `consent`, and
`answers` (a bounded list of `{q, a}` pairs, ≤80 items, ≤300/≤1200 characters
each).

`agazat` is new. The questionnaire branches between an SME and an enterprise
track, and the branch was previously inferred from which optional budget field
happened to be filled. `szegmens` holds the visitor-facing option label and is
translated per locale, so it cannot be compared against anything; `agazat`
carries the locale-invariant fact (`kkv` | `nagyvallalat`) and is checked
against that enum. `_build/i18n.py` is updated so the translator leaves those
two identifiers alone — a translated `nagyvallalat` would have failed
validation on the German questionnaire only.

`terulet` and `szegmens` are bounded text rather than enums for the same reason
in reverse: their option labels *are* translated, so an enum would need all
nine strings and would break on any rewording. Presence and length are enforced;
the option set is enforced by the markup.

### Response contract

```
200  { ok: true,  submissionId, leadId }
200  { ok: true,  submissionId, leadId, duplicate: true }     idempotent replay
422  { ok: false, code: "VALIDATION_FAILED", message, errors: { field: msg } }
4xx  { ok: false, code, message }
5xx  { ok: false, code, message }
```

Stable codes: `METHOD_NOT_ALLOWED`, `UNSUPPORTED_MEDIA_TYPE`, `BODY_TOO_LARGE`,
`MALFORMED_JSON`, `INVALID_SUBMISSION_ID`, `UNSUPPORTED_FORM_TYPE`,
`UNSUPPORTED_LOCALE`, `INVALID_ROUTE`, `VALIDATION_FAILED`, `RATE_LIMITED`,
`SERVICE_UNAVAILABLE`, `STORE_FAILED`.

`message` is safe to show a visitor and is written in their language.
No response ever carries a Postgres message, a column name, a constraint name,
a stack or the submitter's address. Asserted.

---

## 4. One client controller

`assets/js/lead.js`. Loaded from `<head>` with `defer`, which guarantees it has
defined `window.Stratos.lead` before any script in `<body>` runs — including the
generated wizard, which is a separate file and cannot import it.

`main.js` lost its 170-line form block; `quote.{hu,en,de}.js` lost their
submission code. Both now call the same `send()`.

| §6.4 requirement | how |
|---|---|
| preserve native constraint validation | the handler runs on `submit`, which the browser fires only once the form is constraint-valid |
| form-specific client validation | `REQUIRED`, `FIELD_MAX` and `EMAIL_FIELD` mirror the schema; the first failure names its own field and focuses it |
| JSON to `/api/lead` | `Content-Type: application/json`, one `fetch` |
| exactly one request | no retry loop; a retry is only ever a visitor action |
| prevent duplicate clicks | `form.dataset.state === 'submitting'` guards re-entry. The button is disabled too, but a disabled button does not stop an implicit submit from Enter in a text input — the form-level flag does. Asserted both ways |
| preserve values on failure | nothing resets the form except a success |
| re-enable controls after failure | `release()` restores the button and its label |
| success only after a successful response | the success state is set only on `res.ok && body.ok` |
| accessible loading/error/success | `.form__status` is `role="status" aria-live="polite"`; `data-state` carries the machine-readable state |
| hu / en / de | strings come from the page's `<script id="i18n">`; server messages arrive already translated |
| works after back/forward restoration | a `pageshow` handler with `event.persisted` clears a stale `submitting` state — a real in-flight request cannot survive the navigation, so anything still marked submitting is stale by definition |
| unaffected by Phase 7 transitions | `transitions.js` intercepts link clicks only, never `submit`. Verified by reading its click handler and by the passing form suite, which runs on pages with transitions active |

The request stays JSON. It is **not** converted to URL-encoded Netlify Forms
data.

---

## 5. Server-side validation

`netlify/functions/submit-lead.mjs`. Gates in order, cheapest and most certain
first, so a flood costs as little as possible:

| # | gate | status | code |
|---|---|---|---|
| 1 | method is POST | 405 | `METHOD_NOT_ALLOWED` |
| 2 | `content-type` is JSON | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 3 | declared `content-length` ≤ 64 KB | 413 | `BODY_TOO_LARGE` |
| 4 | per-IP rate limit | 429 | `RATE_LIMITED` |
| 5 | measured body ≤ 64 KB | 413 | `BODY_TOO_LARGE` |
| 6 | JSON parses | 400 | `MALFORMED_JSON` |
| 7 | envelope shape | 400 | `INVALID_SUBMISSION_ID` / `UNSUPPORTED_LOCALE` / `INVALID_ROUTE` |
| 8 | spam gates | 200 | — see below |
| 9 | form type, then field schema | 422 | `UNSUPPORTED_FORM_TYPE` / `VALIDATION_FAILED` |
| 10 | store | 200 / 500 / 503 | — |

Nothing in the request is trusted, including the locale — it is read once to
pick an error language and re-checked against the allow-list before storage.

---

## 6. Spam and abuse protection

* **Honeypot** — `meta.botField`, a CSS-hidden input, `tabindex="-1"`, inside an
  `aria-hidden` wrapper.
* **Minimum fill time** — three seconds. The client waits out the remainder for
  a genuinely fast one-field newsletter rather than being dropped by it.
* **Rate limit** — 5 per minute per IP, per warm instance. The outer ceiling is
  the Cloudflare rule in `CLOUDFLARE.md`, which sees every request first.
* **Bounded body** — 64 KB, checked twice (declared, then measured).
* **Per-field caps** — enforced client-side for the message, server-side for
  real, and again after mapping because a mapper can concatenate two valid
  fields into an over-long one.
* **Duplicate detection** — §7 below.
* **No third-party challenge.** Not added: the simpler controls above have not
  been shown insufficient, and a mandatory CAPTCHA is a cost paid by every
  legitimate visitor.

The two spam gates answer **200 with a well-formed success body**, byte-for-byte
the shape of a real success, including a `leadId` that is a fresh UUID matching
no row. A bot that can tell "rejected as spam" from "accepted" can tune against
the filter. This is asserted, and the gates deliberately run *before* the schema
verdict so a bot that also fills a field wrong still gets 200 rather than a 422
telling it which field to fix.

**Logging.** `audit()` records event, submission id, form type, locale, route,
field count and outcome — and never the answers. A questionnaire payload carries
a business's plans, budget and contact details; none of that belongs in a
function log.

---

## 7. Idempotency

`submissionId` is the key. The guarantee is Postgres's, not the function's:

```sql
create unique index leads_submission_id_key
  on leads (submission_id) where submission_id is not null;
```

Partial, so the rows written before this migration — which have no submission id
— stay valid, while two equal non-null ids cannot coexist.

The insert is attempted unconditionally. On `23505` (unique violation) the
function reads the existing row back and answers
`{ ok: true, submissionId, leadId, duplicate: true }`. Two concurrent instances
handling the same retry cannot both create a lead, whichever wins.

---

## 8. Supabase write path

The Netlify Function is the only public write path. The `leads` table has no
insert policy for anon or authenticated roles — see the note in
`20260801000200_rls.sql` — so the browser has no route to it at all.

Key handling: the function reads `SUPABASE_SECRET_KEY` first and falls back to
`SUPABASE_SERVICE_ROLE_KEY`. The current Supabase secret-key model is preferred
because it is revocable on its own rather than being a JWT that outlives a
rotation; the legacy variable is still read so an existing deployment keeps
working. **Migration requirement: move this project to `SUPABASE_SECRET_KEY` and
remove the service-role JWT.**

Secrets live only in Netlify environment variables with Functions runtime
access. They are absent from browser JavaScript, generated HTML, the repository,
`netlify.toml` and the public build output. `.env.example` documents both
variables with no values; `npm run scan:secrets` covers the repository.

---

## 9. Canonical lead record

`supabase/migrations/20260805000100_lead_envelope.sql`. Five columns added,
nothing existing changed, every one nullable or defaulted so existing rows stay
valid and the portal's current `select` lists keep working.

| column | type | purpose |
|---|---|---|
| `submission_id` | `uuid`, partial-unique | idempotency key |
| `form_type` | `text`, checked | the four forms plus the `website` fallback |
| `source_route` | `text` | the page it was sent from |
| `payload` | `jsonb` | the validated answers, as data |
| `meta` | `jsonb` | approved attribution and timing |

`source` is kept and written with the same value as `form_type`: the portal and
every pre-existing row read it, and dropping a column other code selects is a
break, not a compatibility change.

Mapping from form field names to commercial columns lives in one place,
`LEAD_MAPPERS`, and the questionnaire transcript that used to be built three
times in the browser is now built once on the server from `fields.answers`.

---

## 10. Portal

Minimal compatibility change only; the portal is not redesigned.

* `LeadsScreen` selects the five new columns.
* A **Form** column shows the form category as a badge.
* A per-row **Details** disclosure shows locale, source route, submission id,
  every scalar payload field, and the questionnaire's answers as a numbered
  question/answer list rather than as one prose blob.
* Rows written before the migration show an explicit note that their answers are
  in the message field, rather than an empty panel.
* `Cell` gained an optional `colSpan`. That is the whole UI-primitive change.

Access is unchanged: `leads_select_staff` still gates reads on `is_staff()`, and
an unauthenticated visitor still has no path to the table.

**Not yet verified against a live database** — see §12.

---

## 11. Tests

`tests/lead-endpoint.spec.ts` — 46 tests, in-process against the real handler.
`tests/lead-forms.spec.ts` — 23 tests, in a real browser against the built
`dist/`, with `/api/lead` intercepted.

| §6.12 case | where |
|---|---|
| valid newsletter / contact / Impact / questionnaire | endpoint, one per form |
| each locale | endpoint, hu/en/de accepted and each error message localised |
| missing required field | endpoint, named in `errors` |
| invalid email | endpoint, on all four forms |
| malformed JSON | endpoint |
| unsupported form type | endpoint |
| oversized body | endpoint, declared and measured |
| duplicate submission | endpoint, `23505` → original `leadId`, `duplicate: true` |
| honeypot submission | endpoint, 200 indistinguishable from success |
| rate limiting | endpoint, ceiling and isolation between addresses |
| Supabase insert failure | endpoint, 500 naming nothing |
| network failure | browser, failure state with every value preserved |
| duplicate click | browser, click and implicit-Enter, one POST each |
| portal compatibility | typecheck + `portal.spec.ts`; live data still pending |
| insert payload normalised | endpoint, asserts every column of the built row |

Additional cases beyond the list: envelope shape refusals, route refusals,
undeclared-field dropping, the enterprise branch identifier, retry re-using the
submission id, a fresh enquiry getting a new one, and that no response names a
column, table or address.

---

## 12. Production verification

**Not done.** It cannot be: it requires a deploy, and §36 of the Phase 8 brief
forbids deploying without explicit approval.

What is needed, per distinct form type, once deployed:

1. submit a clearly labelled test entry (e.g. name `ZZ Phase-8 test`);
2. confirm `/api/lead` received it — Netlify function log, `event: "stored"`;
3. confirm exactly one Supabase row, with the right `form_type`,
   `submission_id`, `locale`, `source_route` and `payload`;
4. confirm it appears in the portal with the right category and payload;
5. re-submit the same `submissionId` and confirm no second row;
6. confirm the failure states still read correctly.

Also required before that run: apply
`supabase/migrations/20260805000100_lead_envelope.sql` to the project. **Until
it is applied, the insert will fail** — the function writes five columns the
current table does not have.

---

## 13. Remaining limitations

1. **The migration is unapplied.** Blocking; see above.
2. **No live-database test.** The two store outcomes are covered through a
   documented seam (`__store`), not against Postgres. The unique index and the
   `form_type` check constraint are therefore asserted by reading the SQL, not
   by exercising it.
3. **Still on the legacy service-role key** unless `SUPABASE_SECRET_KEY` is set.
4. **The rate limit does not coordinate across instances.** Unchanged, and by
   design — Cloudflare is the real ceiling.
5. **The questionnaire is still 51 authored questions with no visible time
   estimate and no visual design questions.** That is §21 of the Phase 8 brief,
   a later workstream, and deliberately not touched here: the brief says to
   redesign the questionnaire only after its submission path works.
6. **`payload` has no size ceiling of its own** beyond the 64 KB body limit and
   the per-field caps. A full 80-answer questionnaire is roughly 12 KB of JSONB.
7. **No email notification.** A new lead is visible in the portal and nowhere
   else; nothing alerts anyone. Out of scope here, worth deciding on.
