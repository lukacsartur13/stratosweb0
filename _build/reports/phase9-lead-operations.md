# Phase 9 — Workstream K: form and lead operations

The pipeline is unchanged and is the accepted one:

```
browser → assets/js/lead.js → POST /api/lead → netlify/functions/submit-lead.mjs
        → Supabase `leads` → Portal
```

Nothing in this workstream altered it. What changed is what the pages **say**
about it.

---

## 1. The five form types

| Form | Where | Fields | Route |
|---|---|---|---|
| Newsletter | footer on every page; a second block on the blog index | `email` | `formType: newsletter` |
| Contact | contact page | name (two fields), email, phone, company, message, privacy consent, optional newsletter opt-in | `formType: contact` |
| Website / project enquiry | the questionnaire wizard | up to 51 questions across two branches | `formType: questionnaire` |
| Impact | Impact Program page | organisation, contact, email, phone, web, field, four free-text answers, consent | `formType: impact` |
| Questionnaire | same as the project enquiry — they are one form, not two | — | — |

The brief lists "website/project enquiry" and "questionnaire" separately. In
this implementation they are the same form: the quote wizard **is** the project
enquiry, and there is no second one. Recorded here so the count is not read as a
missing form.

All five reach `Stratos.lead.send()`, which builds one envelope. There is no
second submission path anywhere on the site.

---

## 2. Public wording versus actual behaviour

| The site said | The system does | Verdict |
|---|---|---|
| "Subscribe to our newsletter" / **Subscribe** | stores an address; sends nothing | **was false — corrected** |
| "We'll send you new articles and tips by email — rarely, but with substance" | no delivery, and no frequency to claim | **was false — corrected** |
| "We'll reply to the address you gave us shortly" *after a newsletter signup* | no reply is generated | **was false — corrected** (the newsletter now has its own message) |
| "We'll reply to the address you gave us shortly" *after a contact enquiry* | a human replies from their own mailbox | **true**, and deliberately vague about timing |
| Impact applications are *received and reviewed* | stored, read by a person | **true** — nothing claims acceptance, and there is no acceptance mechanism to claim |
| The questionnaire produces a quote | it produces an enquiry a person answers | **true** — no automatic pricing is claimed anywhere |
| Nothing claims automatic scheduling | there is no scheduling system | **true** — no booking widget, no calendar link, no "pick a time" |

### The one claim left standing, and flagged

The footer status block says **"A reply usually within a few hours"**
(`st_reply`, in all three languages).

That is a response-time commitment. It is not verifiable from the repository —
it is a statement about how the business operates — and it has not been changed,
because softening a business's own commercial commitment is not an implementer's
call.

> **REQUIRES USER FACTUAL INPUT** — confirm that "usually within a few hours" is
> true in practice, including at weekends. If it is not, the honest alternatives
> are "within one working day" or removing the timing entirely. This is the only
> unverified promise left on the site, and it is on every page.

It also interacts with §4: nothing notifies anyone that an enquiry arrived, so
the promise depends on somebody opening the Portal.

---

## 3. Notification behaviour — the audit

| Channel | Status |
|---|---|
| Email | **none** |
| Portal | **yes** — the lead appears in the Leads screen, newest first. This is the only notification that exists |
| Slack | none |
| CRM | none |
| Webhook | **implemented in the continuation, disabled by default** |
| SMS / push | none |

**A submission was stored and nobody was told.** Whoever was on duty had to open
the Portal to find out that an enquiry arrived. Given the footer's few-hours
promise, this was the most consequential operational gap in Phase 9.

**Closed in the continuation, as far as a repository can close it.**
`netlify/functions/lead-notify.mjs` is a provider-neutral adapter: a plain JSON
`POST` to an https endpoint, which Slack, Discord, Zapier, Make, a CRM intake or
a self-hosted receiver all accept. No vendor is chosen — choosing one is setting
`LEAD_NOTIFY_TRANSPORT=webhook` and a URL, and the default is `none`, so nothing
is sent until somebody decides.

The constraints this section asked for are the ones it was built under, and are
now asserted rather than intended: the lead is stored **before** anything is
attempted, the module **cannot throw**, a failure is logged and swallowed, a
hang is abandoned after 2 s, an idempotent replay does not notify twice, and the
payload carries **no personal data at all** — not the name, the address, the
message or any questionnaire answer.

→ [`phase9-lead-notification.md`](phase9-lead-notification.md) · 17 assertions
in `tests/lead-notify.spec.ts`

What the adapter does **not** fix is the promise itself: it makes a few-hours
reply *possible* to keep, not true. Until a destination is configured and
somebody watches it, that wording is still either to be confirmed or softened.

---

## 4. Internal procedures

Written down because "we will remember" is not a procedure, and because a
deletion request has a legal deadline attached to it.

### 4.1 Finding a lead

1. Portal → **Leads**. Newest first.
2. Search by name, company or email.
3. **Details** expands the full stored payload: every submitted field, the
   questionnaire transcript, and the `meta` block — locale, submission route,
   landing route, campaign labels, device class, time to fill.

If the Portal is unavailable, the same rows are readable in the Supabase
dashboard's table editor. Prefer the Portal: it is RLS-scoped to what the
account is allowed to see, and the dashboard is not.

### 4.2 Exporting a lead

Supabase dashboard → SQL editor:

```sql
select * from leads where id = '<lead-uuid>';
```

Export as CSV or JSON from the results panel.

**An export is a copy of someone's personal data leaving the system.** Send it
over something the recipient controls, delete the local file when the reason for
it is finished, and do not put it in a shared drive or a chat thread.

### 4.3 Deleting an approved lead — the safe procedure

**Never run a `delete` without seeing what it will delete first.** These four
steps exist so that a mistyped predicate cannot remove an unrelated row.

**Step 1 — identify by `id`, never by anything a person typed.** An email
address or a name can match more rows than intended; a UUID cannot.

```sql
-- 1. SELECT first. Read the result. Confirm it is exactly one row and the
--    right one.
select id, name, email, form_type, created_at
from leads
where id = '<lead-uuid>';
```

**Step 2 — count, as a second opinion.**

```sql
select count(*) from leads where id = '<lead-uuid>';   -- must be exactly 1
```

**Step 3 — delete, returning what was deleted.** `returning` turns a silent
statement into a receipt, and the receipt is what proves step 4.

```sql
delete from leads
where id = '<lead-uuid>'
returning id, email, form_type, created_at;
```

If more than one row comes back, the predicate was wrong. Do not run it again;
restore from the point-in-time backup first.

**Step 4 — confirm.**

```sql
select count(*) from leads where id = '<lead-uuid>';   -- must be 0
```

Record the date, the lead id and the reason wherever data-subject requests are
logged.

**Rules that make this safe:**

- one `id`, one statement, always with `returning`;
- never `delete from leads where email = …` — an address can appear on a
  newsletter row, a contact row and a questionnaire row, and the request may
  cover only one of them. If it covers all of them, run the `select` first and
  read every row it returns;
- never delete inside a transaction you intend to leave open;
- Supabase point-in-time recovery is the backstop. Know the retention window on
  the current plan **before** the first deletion, not after.

> **REQUIRES USER FACTUAL INPUT** — the Supabase plan's point-in-time recovery
> window. Without it, "restore from backup" in step 3 is not an available
> remedy and step 1 becomes the only protection.

### 4.4 What is deliberately not automated

**No automatic destructive retention.** Nothing deletes a lead on a schedule,
and the brief says not to build it. The privacy policy states "contact data: at
most 5 years", which is therefore a commitment fulfilled by the manual procedure
above, on a schedule somebody has to keep.

That is a real gap between the document and the machine, and it is named rather
than closed: an automatic deletion job that is wrong deletes leads that should
have been kept, which is worse and irreversible. Either the manual review
happens on a schedule, or the stated period changes to match what is done.

---

## 5. The legacy adapter

Its removal is analysed separately, in
`phase9-legacy-lead-adapter-removal.md`, with the telemetry available, the
removal criteria and the old-client risk.
