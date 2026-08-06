# Phase 9 — Workstream D: attribution design

What is recorded about where an enquiry came from, what is deliberately not, and
where each rule is enforced.

Implementation:

| Half | File | What it is |
|---|---|---|
| Client capture | `assets/js/lead.js` | Reads the allow-listed parameters, keeps them for the session, attaches them to the envelope. |
| Server allow-list | `netlify/functions/lead-contract.mjs` (`META`, `normaliseMeta`) | The boundary. Anything not declared here cannot be stored, whatever the browser sent. |
| Tests | `tests/attribution.spec.ts` | Both halves, including the negative cases. |

---

## 1. The question this answers, and the one it does not

**Answers:** *which campaign, channel or referring site produced this enquiry.*

**Does not answer, and is not built to:** which pages a particular person read
before enquiring, whether the same person came back a week later, or anything
about a visitor who never submitted a form.

That second list is not a limitation to be lifted later. It is the design: there
is no visitor identifier anywhere in this system, in storage or on the wire, so
the second set of questions is not merely unanswered — it is unanswerable from
what is collected.

---

## 2. The allow-list

### 2.1 Query parameters read

Exactly five, and the full set is `PARAMS` in `assets/js/lead.js`:

| Parameter | Stored as | Cap |
|---|---|---|
| `utm_source` | `meta.utmSource` | 100 |
| `utm_medium` | `meta.utmMedium` | 100 |
| `utm_campaign` | `meta.utmCampaign` | 100 |
| `utm_content` | `meta.utmContent` | 100 |
| `utm_term` | `meta.utmTerm` | 100 |

Everything else in the query string is **not read** — not sanitised, not
truncated, not hashed, not counted. The URL is accessed only through
`URLSearchParams.get()` on those five names.

This is the distinction the brief asks for and it is worth being precise about,
because "we strip the dangerous ones" and "we read only these" fail differently.
A filter fails open on the parameter nobody anticipated. An allow-list fails
closed on it. Real URLs accumulate other people's parameters — `mc_eid` from a
mailing list, `_ga` from a linker, a session token in a link somebody pasted into
a group chat, and occasionally an address in a `?email=` from a badly built form
elsewhere. Under an allow-list, none of those is ever in a position to be
mishandled.

### 2.2 Context recorded alongside

| Field | Source | Why it is safe |
|---|---|---|
| `meta.landingRoute` | `location.pathname` of the first page of the session that had any attribution | Path only. The query string that produced it is not carried. Validated server-side by `normaliseRoute`, the same function that guards `source_route`. |
| `meta.landingReferrerHost` | `new URL(document.referrer).hostname`, lower-cased | Host only. A full referrer can carry another site's query string, and a search referrer can carry the words somebody typed. Neither is recorded. Same-origin referrers resolve to `''` and are not stored. |
| `meta.host` | `location.hostname` | One of **our** hosts, not visitor data. It is how a pre-cutover `netlify.app` submission is told apart from a real one afterwards. |
| `envelope.route` | already existed | The submission route. |
| `envelope.locale` | already existed | `hu` / `en` / `de`. |
| `meta.referrerOrigin` | already existed | The referrer of the *submission* page, as an origin. Pre-dates this workstream. |

Environment (staging vs production) is **derived from `meta.host` in reporting**
rather than stored as a second field. One fact, one place: a second copy of the
production-host list would be a second thing to keep in step with the one in the
analytics config, and the failure mode of that drift is silent mislabelling.

### 2.3 Value sanitising

`attrValue()` keeps `[A-Za-z0-9 ._+-]`, drops everything else, trims, caps at
100. Campaign tags are machine-authored labels; a UTM value that needs escaping
is not a campaign label, it is somebody using the field for something else, and
this is not a free-text channel into the database. `<script>alert(1)</script>`
survives as `scriptalert1script` — inert, and visibly not a campaign, which is
more useful than a silent drop when someone is debugging a link.

The server caps again after arrival, because the client is a convenience and the
server is the boundary.

---

## 3. What is never stored

Asserted by `tests/attribution.spec.ts`, not merely intended:

- arbitrary or unknown query parameters;
- full URLs of any kind;
- form fields — attribution lives in `meta`, and `meta` and `fields` are
  separate closed sets;
- questionnaire answers;
- fingerprinting signals: no canvas, no font enumeration, no screen metrics, no
  hardware concurrency, no timezone, no language list. `meta.viewport` is one of
  three words (`portrait` / `landscape` / `desktop`) and pre-dates this
  workstream;
- any cross-session identifier;
- any cookie. Attribution sets none.

---

## 4. Advertising click identifiers — the decision

**None is read, stored, or declared.** `gclid`, `gbraid`, `wbraid`, `fbclid`,
`msclkid`, `ttclid`, `li_fat_id` and `dclid` are all absent from both allow-lists
and both are asserted against by name in the test suite.

The brief permits "approved advertising click identifiers **only where genuinely
required**". Nothing on this site requires one:

- there is no advertising account connected to this property;
- Google Ads tracking is explicitly prohibited by the Phase 9 brief §2;
- `ad_storage`, `ad_user_data` and `ad_personalization` are permanently denied in
  the GA4 configuration and Google Signals is off;
- no advertising origin appears in the CSP.

The difference from a UTM parameter is not one of degree. `utm_campaign=spring`
labels a campaign and describes no person. A `gclid` identifies **one click by
one person** and is designed to be joined back to a profile held by the vendor
that issued it. Storing one would be collecting a personal identifier for a
purpose that does not exist here.

**To revisit this**, all of the following would have to become true, and each is
a decision for the site owner rather than for an implementer: an advertising
account is actually running; the privacy policy names it, the processor and the
legal basis; the identifier is placed behind the same consent gate as GA4 rather
than in the lead envelope, which is not consent-gated. Until then this section is
the record that the omission is a choice.

---

## 5. Storage: session-scoped, and usually absent

`sessionStorage['stratos.attribution']`, written **only** when the page view has
at least one allow-listed parameter or an external referrer.

| Property | Value |
|---|---|
| Mechanism | `sessionStorage` — first-party, cleared when the tab closes |
| Cookies | none |
| Lifetime | the tab |
| Cross-session | none. A returning visitor is a new session with no memory of the previous one. |
| Written for a direct visitor (typed the address, no referrer) | **nothing at all** |
| First-write-wins | yes — a campaign landing followed by internal navigation keeps the campaign rather than being overwritten by the last hop |
| Read by `analytics.js` | no, in either direction |
| Sent to GA4 | no |

The "only when there is something to record" rule is what keeps this
proportionate: the ordinary visitor who types the address or follows an internal
link causes zero bytes of device storage, and that is most visitors.

### Why this is not behind the consent banner

The consent banner gates GA4, which is measurement of people who are only
reading. Attribution is not sent anywhere until a visitor fills in a form and
presses send — and at that moment they are deliberately sending us their name,
their address, their phone number and their message. Which link brought them is
the least of what that request carries, and it is carried under the same basis
and the same privacy notice as the rest of the enquiry.

The session storage itself is a different question from the transmission, and it
is flagged rather than asserted: see `phase9-consent-inventory.md` §3. It stores
no identifier and expires with the tab, but whether campaign-attribution storage
is "strictly necessary" under ePrivacy is a legal reading, not an engineering
one.

> **REQUIRES LEGAL REVIEW** — whether `sessionStorage['stratos.attribution']`,
> which holds only campaign labels for the duration of one tab and identifies
> nobody, may be set without prior consent. If the answer is no, the fallback is
> already available and costs one campaign attribution per multi-page session:
> read the five parameters at submission time from the current URL only, and
> store nothing. The change is confined to `attribution()` in `lead.js`.

---

## 6. Database impact

**No migration.** `meta` is a `jsonb` column that already exists and already
carries `elapsedMs`, `referrerOrigin`, `viewport` and `attempt`. The eight new
keys are declared in `META` and stored in that same column.

No Supabase schema change was prepared, because none is required. The brief's
"prepare it, document it, stop before applying it" branch does not apply.

The portal reads `meta` as an object; new keys appear as new rows in the
existing detail view. Nothing in the portal needs to change to display them, and
nothing breaks on a lead that has none — which is every lead stored before this
change.

---

## 7. Enforcement summary

| Rule | Enforced where | Test |
|---|---|---|
| Only five UTM parameters are read | `PARAMS`, `assets/js/lead.js` | `reads nothing else in the query string` |
| Only declared keys are stored | `META` + `normaliseMeta` | `drops every key it does not declare` |
| No click identifier | absent from both lists | `reads no advertising click identifier`, `declares the five UTM parameters and no click identifier` |
| Values are bounded and inert | `attrValue`, `clean` | `strips characters a campaign label cannot contain, and caps length`, `caps every attribution value at its declared length` |
| Hosts are bare hostnames | `normaliseHost` | `refuses a host that is not a bare hostname` |
| Landing route is a same-site path | `normaliseRoute` | `refuses a landing route that is not a same-site path` |
| Nothing survives the session | `sessionStorage` | `nothing survives the session` |
| No storage without attribution | `readAttribution` returns `null` | `writes nothing for a visitor with no campaign and no referrer` |
| A bad value never costs an enquiry | drop, never reject | `a malformed attribution value never fails the submission` |
