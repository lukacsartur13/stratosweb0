# Phase 9 — Workstream R: email operations

**The system sends no email. None. Not one message, to anyone, ever.**

That is the whole finding, and it is worth stating first because three places on
the site said otherwise until this phase.

---

## 1. Status of each capability

| Capability | Status | What actually happens |
|---|---|---|
| Lead notification email to the team | **not implemented** | A submission is stored in Supabase and appears in the Portal. Nobody is told it arrived. |
| Visitor confirmation email | **not implemented** | The visitor sees an on-page success message and receives nothing. |
| Newsletter delivery | **not implemented** | Addresses are stored as `form_type = 'newsletter'` rows. There is no sending system, no list, no template, no schedule. |
| Sender domain | **not configured** | No SPF, DKIM or DMARC record has been set up for sending, because nothing sends. |
| Reply-to behaviour | **not applicable** | Replies are written by hand from the Controller's own mailbox. |
| Unsubscribe | **not implemented** | There is nothing to unsubscribe from. A stored request is removed by asking. |
| Bounce handling | **not implemented** | No delivery, no bounces. |
| Double opt-in | **not implemented** | **This is the one that matters if a newsletter is ever launched** — see §3. |
| Password-reset email | **provided by Supabase**, requires configuration | `resetPasswordForEmail()` is called by the Portal. Supabase Auth sends it, from Supabase's own sending infrastructure, to Portal staff only. It never touches a public visitor. |

The single exception is the password reset, and it is worth naming precisely
because it makes "the system sends no email" almost, but not exactly, true:
Supabase's Auth service sends it, not this application, and it goes only to
someone who already has a staff account.

> **REQUIRES USER FACTUAL INPUT** — the Portal's password-reset flow depends on
> two Supabase project settings that are invisible from this repository: the
> configured **Redirect URLs** (the portal calls
> `${window.location.origin}/portal/reset-password`, and Supabase refuses any
> redirect not on its allow-list), and whether the project still uses Supabase's
> default shared SMTP, which is heavily rate-limited and unsuitable for anything
> beyond development.

---

## 2. What was corrected in this phase

Three places claimed email that does not exist:

1. **The footer signup** — "subscribe to our newsletter", button **Subscribe**.
2. **The blog signup** — "we'll send you new articles and practical tips by
   email — **rarely**, but with substance". A delivery promise *and* a frequency
   claim.
3. **The shared success message** — "we'll reply to the address you gave us
   shortly", shown after a newsletter submission as well as after a contact
   enquiry.

All three now say what happens: the address is recorded, the newsletter is not
running yet, and nothing is sent until it is. The newsletter has its own success
message so the reply promise is not made to someone who will not get a reply.

Asserted by `the newsletter does not claim to send anything` in
`tests/lead-forms.spec.ts`, across six built pages in three languages, by
checking for the **absence** of each of the nine phrasings that made the claim.

---

## 3. If a newsletter is launched — what must be true first

Not a recommendation to launch. A list of what would have to exist, so that the
decision is made with the cost visible.

| # | Requirement | Why |
|---|---|---|
| 1 | **A provider.** | None is chosen, and the brief forbids adding one without approval. |
| 2 | **Double opt-in.** | The stored addresses were collected by a form that promised a subscription that did not exist. Mailing them on the strength of that consent is not defensible. Every existing row would have to be re-confirmed, and any address that does not confirm is not a subscriber. |
| 3 | **One-click unsubscribe**, in every message and as a `List-Unsubscribe` header. | Required by GDPR and by every major mailbox provider's bulk-sender rules. |
| 4 | **SPF, DKIM and DMARC** on the sending domain. | Without them the mail is filtered, and the sending domain's reputation is damaged in the process. |
| 5 | **Bounce and complaint handling.** | A list that keeps mailing dead addresses stops being delivered to live ones. |
| 6 | **The privacy policy updated** with the provider as a processor, the legal basis, and the retention period for subscription data. | It currently describes storage, correctly, and no delivery. |

The `newsletter` form type, the schema, the endpoint and the storage all already
work. **The gap is entirely operational and legal, not technical** — which is
the reason the wording had to change now, rather than waiting for the newsletter
to be built.

---

## 4. Lead notification — the operational gap

A submission is stored and nobody is told. Whoever is watching has to open the
Portal to know that an enquiry arrived. For a business whose footer says a reply
usually comes within a few hours, that is the most consequential missing piece
in this report.

Three ways to close it, cheapest first. **None has been implemented**, because
the brief forbids adding a vendor without approval:

| Option | Cost | Trade-off |
|---|---|---|
| **Supabase Database Webhook → an existing inbox** | lowest. No new vendor if the target is a webhook the Controller already has | Delivery is best-effort; a failed hook is silent unless it is monitored |
| **A transactional email provider** called from `submit-lead.mjs` after a successful insert | one vendor, one API key, ~20 lines | Needs a sending domain and its DNS records; the send must not be able to fail the submission |
| **A Supabase scheduled function** polling for new rows | no new vendor | Adds latency and a second thing that can stop working quietly |

**Whatever is chosen must not be able to fail a submission.** The lead is stored
before any notification is attempted, and a notification failure is logged and
swallowed. A visitor's enquiry must never be lost because a mail server was
slow.

> **REQUIRES USER FACTUAL INPUT** — which of the three, and which provider. This
> is the item most worth closing before launch.
