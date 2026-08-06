# Phase 9 — Workstream J: legal and data governance

Every public legal document, in HU, EN and DE, checked against **what the system
actually does** rather than against what it was written to say.

Nothing was invented. Where a fact is missing it is marked, in the source, as
`REQUIRES USER FACTUAL INPUT` or `REQUIRES LEGAL REVIEW`, and those markers are
**not visible to visitors** — a public "this policy has not been reviewed"
banner would be worse than the problem it records.

---

## 1. The documents

| Document | HU | EN | DE | State |
|---|---|---|---|---|
| Imprint | `impresszum.html` | `en/imprint.html` | `de/impressum.html` | Complete, factual, unchanged |
| Privacy policy | `adatkezelesi-tajekoztato.html` | `en/privacy-policy.html` | `de/datenschutz.html` | **Corrected in this phase** |
| Cookie information | inside the privacy policy | same | same | Accurate |
| Consent wording | `consent.js` + the three dictionaries | same | same | Accurate |
| Contact-form privacy text | contact page + consent checkbox | same | same | Accurate |
| Newsletter wording | footer + blog | same | same | **Corrected in this phase** |
| Impact application wording | `impact-program.html` | same | same | Accurate — see §4 |
| Questionnaire wording | `arajanlat.html` | same | same | Accurate |
| Portal privacy statements | inside the privacy policy | same | same | Accurate |

---

## 2. What the documents now describe, and whether it is true

| Claim in the documents | Reality | Verdict |
|---|---|---|
| Netlify hosts the site | Yes — `netlify.toml`, `publish = "dist"` | **true** |
| Netlify Functions receive form submissions | Yes — `netlify/functions/submit-lead.mjs` | **true** |
| Supabase stores enquiries and serves the private Portal | Yes | **true** |
| The Portal is private | Yes — auth, RLS, `no-store`, `noindex` | **true** |
| `/api/lead` is the write path | Yes, and the only one | **true** |
| Questionnaire answers are stored | Yes, in `payload.answers` | **true** — now listed as collected data, which it was not |
| Newsletter requests are stored, not delivered | Correct as of this phase | **true** — see §3 |
| GA4 runs only after consent | Yes — `gtag.js` is not injected before it | **true** |
| `_ga` cookies exist only after consent | Yes | **true** |
| `stratos.consent` is local storage, not a cookie, and is not sent to a server | Yes | **true** |
| Consent can be withdrawn, and withdrawal deletes the cookies | Yes — `unloadGa4()` | **true** |
| Search Console is not visitor tracking | Correct | **true** |
| No Meta Pixel or social tracker | Correct — none in the codebase, asserted | **true** |
| Hostname/environment separation | Yes — allow-list plus `traffic_type` | **true** |
| Salted IP hashing | Yes — SHA-256 over `IP_HASH_SALT:ip`, and the raw IP is never stored | **true** — now described accurately; the policy previously said "IP address" |

---

## 3. What was corrected, and why each was wrong

### 3.1 The IP address

**Was:** "IP-cím" listed among the personal data processed.
**Is:** a salted, irreversible fingerprint of the IP address, with an explicit
statement that the address itself is not stored.

`hashIp()` computes SHA-256 over `${IP_HASH_SALT}:${ip}` and stores only the
digest. The old wording described a **worse** practice than the one implemented,
which is an unusual direction to be wrong in and still worth fixing: a privacy
notice that overstates collection is inaccurate, and it gives away a real
protection for nothing.

### 3.2 The attribution data — a new disclosure

Workstream D added campaign attribution to the lead envelope. That is new
personal-data-adjacent collection and it was not described anywhere. Added, in
all three languages, including the parts that are limits rather than
collection:

- the five UTM parameters, named individually;
- the landing route and the submission route;
- the referring **domain**, explicitly without the full referring address;
- that every other value in the link is ignored;
- that no advertising click identifier (`gclid`, `fbclid`) is read or stored;
- that these values live in browser session storage until the tab closes and
  reach us only if a form is actually submitted.

### 3.3 The questionnaire answers

**Was:** absent from the list of processed data.
**Is:** its own subsection.

The questionnaire is the highest-intent form on the site and collects the most:
a business's plans, budget range and timeframe. Omitting it from a list that
included "name, email, phone" was the most material of the gaps.

### 3.4 The newsletter

**Was, in three places:** "subscribe to our newsletter" / "iratkozz fel a
hírlevelünkre", a **Subscribe** button, a blog block promising "we'll send you
new articles and practical tips by email — **rarely**, but with substance", and
a shared success message promising a reply.

**Is:** the newsletter is described as not yet running; the address is stored;
no confirmation email is sent; no newsletter is sent; the request stays on
record until deletion is requested.

Nothing was broken. A visitor gave an address, the address was stored, and they
were told they had subscribed to something that does not exist — including a
**frequency claim**, which the brief specifically forbids inventing. Asserted
now, on the built pages, in all three languages, by
`the newsletter does not claim to send anything`, which checks for the absence
of each of the nine phrasings that made the claim.

### 3.5 The email provider

**Was:** "Email provider: the provider of the mail system (**e.g. Google
Workspace or another email provider**)".

Naming a processor by guess, in a document whose entire purpose is to be exact.
**Removed rather than replaced with a different guess.** The replacement states
what is verifiable: the website itself sends no email, and the Controller
replies from their own mailbox.

> **REQUIRES USER FACTUAL INPUT** — the actual email provider's legal entity and
> address, to be listed in the same shape as Netlify and Supabase.

---

## 4. Statements checked and left alone

- **Controller identity** — `Lukács Artúr e.v.`, `9151 Abda, Arany János utca
  13.`, tax number `91381611-2-28`, registering authority NAV, chamber
  Győr-Moson-Sopron. Specific, consistent between the imprint and the privacy
  policy, and not something an implementer may edit. Verified only for
  *internal consistency*, which holds.
- **Supervisory authority** — NAIH, with the correct current address
  (1055 Budapest, Falk Miksa utca 9–11.) and contact.
- **Data-subject rights** — the seven GDPR rights, correctly enumerated.
- **The Impact Program** — the application wording says applications are
  *received and reviewed*, never that they are accepted. Correct: there is no
  acceptance mechanism, no automated scoring and no scheduling system.
- **Billing retention, 8 years** — a statutory period under the Hungarian
  Accounting Act, not an invented one.

---

## 5. Open items

Each is recorded as a source comment at the point in the document where it
belongs, so it is found by the next person editing that section rather than only
by whoever reads this file.

| # | Item | Marker | Why it cannot be closed here |
|---|---|---|---|
| 1 | **Legal basis per purpose.** The policy names six purposes and no Article 6 basis for any of them. | `REQUIRES LEGAL REVIEW` | Consent, contract and legitimate interest are each defensible for different rows. Choosing wrongly is worse than omitting, because the chosen basis is the one the Controller is held to. |
| 2 | **Third-country transfer mechanism.** Netlify is in the US, Supabase Pte. Ltd. in Singapore. Both are named; neither transfer names its Article 46 mechanism. | `REQUIRES LEGAL REVIEW` | Which applies — SCCs, adequacy, the Data Privacy Framework — is a fact about the contracts, not about the code. |
| 3 | **The email provider.** | `REQUIRES USER FACTUAL INPUT` | §3.5. |
| 4 | **Retention is a commitment, not a mechanism.** "Contact data: at most 5 years" is stated; nothing deletes a lead automatically, by design. | Source comment | Automatic destructive retention is explicitly out of Phase 9's scope. Either the manual review happens on a schedule — the procedure is in `phase9-lead-operations.md` — or the stated period changes to match what is done. |
| 5 | **GA4 data-retention period.** | Not stated, deliberately | The brief forbids writing a concrete period into the public policy until the configured period is confirmed in the GA4 Console. The policy says nothing about it, which is correct. |
| 6 | **The whole document, in three languages.** | `REQUIRES HUMAN LEGAL TRANSLATION REVIEW` | The corrections above were written and translated by an implementer. The German and English are faithful to the Hungarian and neither has been read by a lawyer. Already marked in the source and asserted by `is flagged for legal review before launch`. |

**None of these markers is visible to a visitor.** They are source comments and
this report. Telling the public that the privacy policy is unreviewed would be a
worse outcome than the state it records.
