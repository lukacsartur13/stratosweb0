# Phase 9 — Workstream K: new-lead notification

Status: **Adapter implemented, wired, tested, and inert by default. No
production vendor chosen.**

The audit found that a submission was stored and nobody was told. That is now an
adapter with a transport switch rather than an absence, and the switch is off
until the site owner sets a URL.

---

## 1. What the audit found

| Channel | Before | Now |
|---|---|---|
| Email | **none** — the system has never sent a message | none. See `phase9-email-operations.md` |
| Slack | none | reachable via `webhook` |
| CRM | none | reachable via `webhook` |
| Webhook | none | **implemented, disabled by default** |
| Portal | yes — the lead appears in the Leads screen | unchanged, and still the source of truth |

The Portal was the only notification that existed, which means an enquiry was
seen when someone happened to log in. Against a footer that promises a reply
within a few hours, that was the most consequential operational gap in the
phase.

It is worth being precise about the kind of gap it was: **nothing was broken.**
No error was logged, no lead was lost, and every submission was safely in the
database. A missing capability that never fails is the kind that survives a test
suite indefinitely.

---

## 2. Why no vendor is chosen

Phase 9 forbids choosing a production notification vendor without approval, and
the prohibition is right. The choice carries cost, a data-processing
relationship, a processor entry in the privacy policy and — if the payload
contained personal data — a transfer question. None of those are decisions this
repository should make on the owner's behalf.

So the transport is an environment variable and the payload is a plain JSON
`POST`:

```
LEAD_NOTIFY_TRANSPORT   'none' (default) | 'webhook'
LEAD_NOTIFY_WEBHOOK_URL an https:// endpoint
```

A plain JSON POST is what Slack incoming webhooks, Discord webhooks, Zapier,
Make, most CRM intake endpoints and any self-hosted receiver already accept.
**Choosing a provider is setting a URL.** No adapter code changes, no
dependency is installed, and nothing has to be un-picked if the first choice
turns out to be wrong.

Setting the URL alone does **not** switch it on — the transport must also be
`webhook`. One variable set by accident should not start sending traffic to a
half-configured destination, and there is a test for that.

---

## 3. What it sends

```json
{
  "type": "lead.created",
  "leadId": "…", "submissionId": "…",
  "formType": "contact", "locale": "hu", "route": "/ugyfelszolgalat.html",
  "receivedAt": "2026-08-09T…Z",
  "portalUrl": "https://stratosweb.hu/portal/leads",
  "text": "New contact from /ugyfelszolgalat.html (hu). Open the Portal to read it — this message deliberately carries no personal data."
}
```

### And everything it does not send

**No personal data at all.** Not the name, not the email address, not the phone
number, not the message, not the company, and not one questionnaire answer.

The brief requires the full questionnaire payload be kept out. This goes
further and keeps everything out, for a reason worth stating: the destination is
an **unknown third party** — whichever one the owner eventually picks — with its
own retention schedule, its own access model and its own breach surface. A
notification is a doorbell. It does not need to read the letter, and the Portal,
which is authenticated and already described in the privacy policy, is where the
letter is read.

There is a second benefit. An endpoint that receives *"a contact form was
submitted from /kkv.html in Hungarian"* receives no personal data to process, so
this adapter does not by itself add a processor to the privacy policy or a
transfer to assess. If the owner later wants the name in the Slack message, that
is a deliberate decision with consequences, made once, rather than a default
nobody chose.

The field list is **closed, not filtered**. A deny-list would let the next new
field through by default; a test asserts the exact set of keys, so adding one
has to be deliberate.

`text` is a courtesy: Slack and Discord render a bare `text` field with no
mapping configuration at all, so the commonest destinations work with a URL and
nothing else.

---

## 4. The rule: never at the lead's expense

> **A notification failure must never roll back an already stored lead.**

Structurally, not by convention:

- it is called **after** the insert succeeded, in the success branch only;
- `notifyLeadCreated` **cannot throw and cannot reject** — every failure path
  returns `{ sent: false, reason }`;
- so there is no code path from a failed notification to a failed submission.

The failure this guards against is specific: a `throw` in the handler's success
path turns a stored lead into a 500 for the visitor, who submits again — and the
second submission is deduplicated by `submissionId`, or is not, if they reloaded
first. A doorbell that can eat the post is worse than no doorbell.

**An idempotent replay does not notify.** The call sits in the insert-succeeded
branch, not the `23505` branch, so a retry after a timeout does not ring the
doorbell twice for a lead that was already announced.

### Awaited, not fired and forgotten

A Netlify function stops executing when it returns; there is no reliable "after
the response" in this runtime, so a floating promise would be cancelled more
often than it completed. It is therefore awaited — and capped at **2 seconds**
by `AbortSignal.timeout`, because past that the visitor's success message
matters more than the doorbell. With the default transport it returns
immediately without touching the network.

### Also enforced

- **https only.** A misconfigured `http` endpoint would put the route, the
  locale and the lead id on the wire in clear.
- **An unknown transport is refused**, not guessed at.
- **Logs are redacted to scheme and host**, because a webhook URL commonly
  carries a token in its path.

---

## 5. Test coverage

**17 assertions**, `tests/lead-notify.spec.ts`, `node` project.

| Group | What it holds |
|---|---|
| default | sends nothing, makes no network call, and a URL alone does not enable it |
| payload | the identifiers are present; ten pieces of personal data pushed in are absent from the output; the key set is exact; the Portal link follows the deploy origin |
| webhook | POSTs JSON to the endpoint; refuses `http:`, a malformed URL and an unknown transport |
| never at the lead's expense | 500, 404, unreachable and a nonsense response all resolve `false` and never throw; a hang is abandoned in under 3 s; **and a full submission through the real handler still answers 200 with its `leadId` while the webhook is down** |

The last one is the end-to-end statement of the rule and is the test to keep if
any were ever dropped.

One case was deliberately **removed** rather than made to pass: a parametrised
"hangs past the timeout" whose stub slept and then resolved. A stub that ignores
the abort signal is not a hang, it is a slow success, and asserting
`sent === false` against it asserts nothing. The timeout is covered by the
dedicated test that supplies a fetch honouring the signal the way a real one
does.

---

## 6. Still required from the site owner

| # | Item | Status |
|---|---|---|
| 1 | **Choose a destination** and set the two variables | **REQUIRES USER DECISION** |
| 2 | Decide whether the notification may carry the enquirer's name | **REQUIRES USER DECISION** — currently no, deliberately |
| 3 | If a hosted service is chosen, add it to the processor list *only if* the payload is later widened to include personal data | **REQUIRES LEGAL REVIEW**, conditional |
| 4 | Confirm or soften *"a reply usually within a few hours"* | **REQUIRES USER DECISION** — see `phase9-content-trust.md` |

Item 4 is the one this workstream does not fix. An adapter makes the promise
*possible* to keep; it does not make it true. Until a destination is configured
and somebody is watching it, the only honest options are to configure one or to
soften the wording.

---

## 7. What was deliberately not built

- **An email sender.** The system sends no email, and adding one here would mean
  choosing a provider, a sending domain and an SPF/DKIM arrangement — all of
  which are the owner's, and all of which are documented in
  `phase9-email-operations.md`.
- **A retry queue.** A failed notification is logged and dropped. Retrying
  needs durable state this deployment does not have, and the Portal is the
  source of truth regardless — a missed doorbell costs latency, not a lead.
- **A digest.** No evidence yet about volume. One notification per lead is the
  simplest thing that answers the question.
