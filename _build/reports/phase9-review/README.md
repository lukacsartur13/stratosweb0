# Phase 9 — human review package

Everything a person needs to decide whether this phase ships, in the order it is
worth reading. Each section is a summary and a pointer; the detail is in the
linked report.

**This package contains no secrets, no credentials and no lead data.** It is
text, and it is committed, unlike the Phase 7 and 8 screenshot packages.

**Read §22 first if you only read one thing.** It is the list of things that
cannot be closed from inside the repository, and the first of them is
time-sensitive: the old Wix URL inventory has to be exported before DNS moves,
and cannot be recovered afterwards.

| | |
|---|---|
| Branch | `phase-9-conversion-seo-production-finalisation` |
| Frozen at | `a3af8b7` |
| Gates | **9 of 9 green**, all in the same build state — see the table at the end |
| Readiness | 119 items — 68 pass, 14 warning, 34 blocked, 3 not-applicable |
| Not pushed, not deployed | correct |

---

## 1. Conversion map

Every CTA on all 69 routes, with the page's own separated from the chrome's, and
a mid-page conversion path added to 36 routes.

→ [`phase9-conversion-map.md`](../phase9-conversion-map.md) ·
[`phase9-conversion-audit.json`](../phase9-conversion-audit.json)
· gate: `npm run audit:conversion:check`

## 2. Event taxonomy

Provider-neutral by construction — nothing in it names a vendor, and every event
survives choosing one, or none. `cta_id` carries a placement segment on purpose,
so the mid-page CTAs from §1 are measurable separately from the closing band.

→ [`phase9-event-taxonomy.md`](../phase9-event-taxonomy.md)

## 3. GA4 behaviour

Basic Consent Mode read strictly: `gtag.js` is **not injected** until the visitor
agrees, so a refusal causes no contact with Google at all — not a cookieless
ping. Three independent gates: consent, a hostname allow-list checked in the
browser against the real host, and the presence of a Measurement ID.

Advertising is off and structurally hard to turn on: `ad_storage`,
`ad_user_data` and `ad_personalization` permanently denied, Google Signals off,
and **no advertising host in the CSP**.

→ `assets/js/analytics.js` · 62 assertions in `tests/analytics.spec.ts`

## 4. Consent behaviour

Two cookies, both from one vendor, both consent-gated, neither existing until
the visitor says yes. Accept and refuse are the same element with identical
computed styling; refusing is one click; there is no close control that means
yes; Escape does not answer for you. Withdrawal lives in the footer of every
page and **deletes** the `_ga` cookies rather than only stopping new ones.

Complete storage inventory: 2 cookies, 2 `localStorage` keys, 1 `sessionStorage`
key, 2 third-party origins. With consent refused or unanswered the public site
makes **zero** cross-origin requests.

→ [`phase9-consent-inventory.md`](../phase9-consent-inventory.md)

## 5. Prohibited analytics fields

Derived from the lead schema rather than written down twice: the guard reads
`FORMS` from `lead-contract.mjs`, so **adding a form field fails the suite until
the field is listed as prohibited**. An event carrying a prohibited key is
dropped whole — a partially-scrubbed event is worse than none, because it looks
like it worked.

→ `PROHIBITED` in `assets/js/analytics.js` ·
`every field the lead schema declares is refused as a parameter key`

## 6. Attribution design

An allow-list of five UTM parameters, not a filter. Everything else in the URL is
never read. **No advertising click identifier** is read, stored or declared —
eight are asserted absent by name. Session-scoped, and a visitor who types the
address causes zero bytes of storage.

No Supabase schema change: `meta` is an existing `jsonb` column.

→ [`phase9-attribution-design.md`](../phase9-attribution-design.md) ·
32 assertions in `tests/attribution.spec.ts`

## 7. SEO summary

72 documents, 21 checks each, **0 hard failures**. 60 distinct titles and 60
distinct descriptions for 60 indexable routes; hreflang reciprocal in both
directions on 69/69; `og:url` equal to the canonical on 69/69; 0 orphans.

Two duplication risks closed: the homepage had two addresses, and the Impact
Program description was shipping in Hungarian on the English and German pages.

→ [`phase9-seo-audit.md`](../phase9-seo-audit.md) ·
[`phase9-seo-audit.json`](../phase9-seo-audit.json) ·
gate: `npm run audit:seo:check`

## 8. Structured-data summary

One generator, all 69 content routes including the three React homepage shells.
The rule was *emit nothing the page does not already say to a human being* —
which ruled out `legalName`, `taxID`, `address`, `foundingDate`,
`numberOfEmployees`, `award`, `review`, `aggregateRating`, `Offer`, `price`,
`areaServed`, `SearchAction`, and `datePublished` on the six articles.

The dates are the interesting omission: rich results need one, the fragments
carry none, and a plausible date from git or the build clock would be a
fabricated fact published in a format designed to be trusted without checking.

→ `build_structured_data()` in `_build/build.py` ·
16 assertions in `tests/structured-data.spec.ts`

## 9. Sitemap and indexing summary

60 indexable = 60 sitemap entries, asserted in **both** directions. `<lastmod>`
removed — it was `new Date()`, a build date rather than a modification date,
telling every crawler that all 60 pages changed on every deploy.

→ [`phase9-seo-audit.md`](../phase9-seo-audit.md) §4

## 10. Redirect map

Seven rules, no loops, no chains, locale preserved, query strings preserved, and
**no catch-all to the homepage**. Three new 301s retire `/index.html` and its two
locale siblings.

A real 404 in three languages: no auto-redirect, no fake search field, no WebGL,
and no canonical, hreflang, Open Graph or JSON-LD — all four are statements
about a page, and there is no page.

→ [`phase9-redirect-map.md`](../phase9-redirect-map.md) ·
36 assertions in `tests/not-found.spec.ts`

## 11. Legal factual changes

Four corrections, all of them the document catching up with the code: the IP
address (we store a salted hash, the policy said we store the address), the
attribution collection (new this week, undisclosed), the questionnaire answers
(absent from a list that included name, email and phone), and the email provider
(named by guess as "e.g. Google Workspace").

→ [`phase9-legal-data-audit.md`](../phase9-legal-data-audit.md)

## 12. Missing legal inputs

Four, none of which an implementer may invent:

1. **Legal basis per purpose** (Art. 6) — `REQUIRES LEGAL REVIEW`
2. **Third-country transfer mechanism** (Art. 46) for Netlify (US) and Supabase
   (SG) — `REQUIRES LEGAL REVIEW`
3. **The email provider's legal entity** — `REQUIRES USER FACTUAL INPUT`
4. **Legal translation review**, HU/EN/DE — `REQUIRES HUMAN LEGAL TRANSLATION REVIEW`

All four are marked in the source at the point they belong. **None is visible to
a visitor** — a public "this policy is unreviewed" banner would be worse than
the state it records.

→ [`phase9-legal-data-audit.md`](../phase9-legal-data-audit.md) §5

## 13. Security headers

One source of truth, `netlify.toml`. No `_headers` file anywhere.

→ [`phase9-security-headers.md`](../phase9-security-headers.md)

**One item flagged:** HSTS `preload` is present, pre-dates this phase, and is
effectively irreversible if acted on. Recommendation: drop the token until the
domain has been live and stable, then submit deliberately if wanted.

## 14. CSP changes

Every Google origin is named with its directive, its reason, and whether it is
consent-gated. What is deliberately absent: `stats.g.doubleclick.net` and every
other advertising host, `'unsafe-eval'`, `'wasm-unsafe-eval'`, `'unsafe-inline'`
on `script-src`, and any wildcard that is not a subdomain wildcard on a named
vendor domain.

The two allowances that **are** weakenings are named rather than buried:
`'unsafe-inline'` on `style-src`, and `blob:` on `worker-src`.

→ [`phase9-security-headers.md`](../phase9-security-headers.md) §3

## 15. Portal security

**One real vulnerability, found and fixed.** `href={o.website}` rendered a
stored, client-supplied address straight into a link, and the public form's URL
check refuses text rather than schemes — `javascript:alert(1).co` satisfies it.
Stored, then rendered, then one click from executing inside a session that can
read every lead.

→ [`phase9-portal-api-security.md`](../phase9-portal-api-security.md) §1.4

**Superseded:** the Portal Analytics screen now exists. See §15a.

### 15a. Portal Analytics

Built in the continuation. GA4 → Data API → an authenticated Netlify function →
the Portal. **No Google credential is in the browser**, and that is asserted
against the built bundle rather than described: no private key, no
service-account address, no Property ID, and no reference to the Data API host
anywhere in `dist/portal`.

Reading a GA4 property needs a service account, which is a private RSA key.
There is no browser-safe way to hold one — any key the portal could sign with is
a key anyone who opens the bundle can sign with, against the same property,
until somebody notices.

- authentication before everything, including before the "is it configured"
  answer, because which integrations a private admin has wired up is not public;
- the role comes from `profiles`, never from user metadata, which is
  user-writable — `team_member` and `client` hold valid sessions and are refused;
- **no test ever contacts Google.** One test replaces `globalThis.fetch` with a
  function that fails if anything calls it;
- GA4's own words: active users, sessions, views. Nothing is called "visitors";
- the consent caveat renders **with** the numbers — Basic Consent Mode means
  every figure is a floor, not a count.

**Nothing works until the site owner does four things**, and step 3 is the one
that gets missed: the service account is *created* in Google Cloud and *granted
access* in Google Analytics, which is a different product. Skip it and you get
an account that authenticates perfectly and is refused by the property.

→ [`phase9-portal-analytics.md`](../phase9-portal-analytics.md) ·
49 assertions in `tests/portal-analytics.spec.ts`

## 16. API protections

Eight gates in order, cheapest and most certain first. Honeypot and timing gate
answer with a byte-identical success, so a bot cannot tune against the filter.
Idempotency is Postgres's guarantee, not the function's.

**Stated accurately rather than claimed:** the in-memory rate limiter is not
durable — it does not survive a cold start and does not coordinate across
instances — and whether Cloudflare is in front of this site is not knowable from
the repository.

→ [`phase9-portal-api-security.md`](../phase9-portal-api-security.md) §2

## 17. Dependency findings

0 vulnerabilities in root and `experiments`. 3 moderate `react-router`
advisories in the portal, **analysed rather than patched**: two need
attacker-controlled navigation targets and every target here is a literal string
(the full five-line list is in the report); one needs SSR and the portal is
client-only. The fix is react-router 7 — a major version — so it is scheduled as
its own change. `npm audit fix --force` was not run.

Secret scan clean, 553 files, 12 rules, five of them added **before** the
credentials they look for exist.

→ [`phase9-dependency-audit.md`](../phase9-dependency-audit.md)

## 18. Media-rights blockers

`FORRASOK.md` — the media-rights audit itself — was being published at a
guessable URL, along with the font manifest. Fixed. Same mechanism that nearly
published the Gulfstream press photo in Phase 8: publication is a function of
the directory, not of the link.

Three items need the owner: `cruise-jet.jpg` permission or deletion, written
permission for the seven organisation marks, and consent for the two team
photographs.

→ [`phase9-media-rights.md`](../phase9-media-rights.md)

## 19. Search Console and Bing requirements

**No verification token was added anywhere** — a fake one makes a property look
configured and fails silently.

→ [`phase9-search-platform-setup.md`](../phase9-search-platform-setup.md)

**Time-sensitive:** export the old Wix URL inventory from Search Console or the
Wix sitemap **before DNS moves**. Afterwards that site is unreadable and its URL
structure is gone.

## 20. Email status

**The system sends no email. None.** Not a lead notification, not a visitor
confirmation, not a newsletter. The one exception is Supabase Auth's password
reset, which goes to staff only.

Three places said otherwise and now do not.

→ [`phase9-email-operations.md`](../phase9-email-operations.md)

### 20a. New-lead notification

Was: a lead is stored and **nobody is told**, so an enquiry is seen when someone
happens to open the Portal — against a footer promising a reply within a few
hours. It is worth being clear about the kind of gap that was: nothing was
broken, nothing logged an error, and no lead was ever lost. That is why it
survived a test suite.

Now: a provider-neutral adapter, wired and **off by default**.

- **No vendor is chosen.** The payload is a plain JSON `POST`, which Slack,
  Discord, Zapier, Make, a CRM intake and a self-hosted receiver all accept.
  Choosing one is setting a URL. Setting the URL alone does not switch it on.
- **It carries no personal data at all** — not the name, email, phone, message
  or any questionnaire answer. The brief asks for the questionnaire payload to
  be kept out; everything is kept out, because the destination is an unknown
  third party with its own retention and its own breach surface. A doorbell does
  not need to read the letter. It also keeps the adapter out of the processor
  argument entirely.
- **It cannot cost a lead.** It runs only after the insert succeeded, cannot
  throw, and abandons a hang after 2 s. Asserted end-to-end through the real
  handler with the webhook down: the submission still answers 200.

**Still the owner's:** choose a destination, and decide whether the message may
ever carry the enquirer's name. The adapter makes a few-hours reply *possible*
to keep — it does not make the promise true.

→ [`phase9-lead-notification.md`](../phase9-lead-notification.md) ·
17 assertions in `tests/lead-notify.spec.ts`

## 21. GA4 Console settings still required

Reported separately from what the code does, because
`traffic_type: staging` being sent **does not prove staging traffic is excluded
from production reports**:

| | Status |
|---|---|
| Event labelling implemented in code | **done** |
| GA4 property filter configured by the user | **blocked** |
| GA4 property filter tested | **blocked** |
| Portal production-host filter tested | **not applicable** — the screen does not exist |
| Data-retention period configured | **blocked** |
| Service-account access for Portal reporting | **blocked** |
| Analytics Data API enabled | **blocked** |
| Portal metrics compared against the GA4 interface | **not applicable** |

→ [`phase9-readiness.json`](../phase9-readiness.json) → `analytics`

## 22. Domain-cutover dependencies

| # | Item | Why it cannot wait |
|---|---|---|
| 1 | ~~Export the old Wix URLs~~ | **DONE.** 20 URLs captured while the Wix site was still live; see §22a |
| 2 | **Confirm Netlify 'Pretty URLs' is OFF** | If on, every canonical points at a 301, on all 60 routes |
| 3 | **Mark the custom domain PRIMARY**, not merely attached | `robots.txt` stays `Disallow: /` otherwise — silently |
| 4 | **Decide on HSTS preload** | Effectively irreversible once submitted |
| 5 | Verify the four curls | `phase9-seo-audit.md` §6 |
| 6 | Search Console and Bing property setup | Nothing to verify against until then |

### 22a. The Wix migration — collected

The phase's one unrecoverable item, and it is done.

**The previous report had the old site on the wrong host.** `media-stratos.com`
301s to `https://www.stratosweb.hu`, and **`www.stratosweb.hu` is the Wix site**.
The final production domain *is* the legacy domain, so the cutover changes what
answers on one name rather than moving between two.

20 URLs, from the live Wix sitemap set, each fetched so the status, title and
language are observed rather than assumed. **All 20 answered 200; all are
Hungarian**, so no locale is lost by any rule.

**Only 8 get a redirect, and the 12 that do not are the finding.** Those twelve
are extensionless paths this build already answers 200 for. Writing
`/kkv → /kkv.html` would look like the thorough thing to do and would compose
with Netlify's **Pretty URLs** setting — which 301s the other way — into an
**infinite redirect loop**. Today that setting being on costs a canonical
pointing at a redirect: a real defect, a recoverable one. With those rules it
would cost the page, at cutover, on the busiest routes. The duplication is
already handled by the canonical tag.

The 8 are the six Wix blog posts, whose slugs genuinely differ and which carry
the link equity, and the two Wix Bookings pages — which go to contact, claim no
appointment, and are flagged for a decision because a 404 is defensible.

→ [`phase9-wix-url-export.csv`](../phase9-wix-url-export.csv) ·
[`phase9-redirect-map.md`](../phase9-redirect-map.md) §5

## 23. Phase 10 prerequisites

1. Everything in §22.
2. The four legal inputs in §12.
3. A lead-notification mechanism (§20) — the most consequential operational gap.
4. Durable rate limiting on `/api/lead`, or an accurate statement that there is
   none.
5. A seeded staging user, so the three manual Portal checks become automated.
6. The react-router 6 → 7 migration, as its own change with its own test run.
7. Real publication dates for the six articles, if Article rich results are
   wanted.
8. Re-evaluate the legacy lead adapter on or after **2026-09-05**, with the
   telemetry query result attached.

---

## Gate results, on the frozen commit

| Gate | Result |
|---|---|
| `npm run typecheck` | **0** |
| `npm run build` | **0** |
| `npm run fingerprint:check` | **0** |
| `npm run draco:check` | **0** |
| `npm run scan:secrets` | **0** — 566 files, 12 rules, clean |
| `npm run audit:conversion:check` | **0** — no CTA integrity failures |
| `npm run audit:seo:check` | **0** — 72 documents, 0 failures, 43 warnings |
| `npm test` | **0** — 796 collected, 40 skipped, **756 passed, 0 failed** |
| `node scripts/route-audit.mjs --quick` | **0** — 132 checks, 0 failing, 0 broken internal links |
| `npm run validate:full` | **0** — 185 collected, 97 skipped, **88 passed, 0 failed** |

→ [`phase9-test-reconciliation.md`](../phase9-test-reconciliation.md) for how the
contradictory 607/605 totals were resolved — and, in §6, for a **second**
order-dependence found while running these gates: the SEO audit and the
structured-data suite disagreed with themselves depending on whether
`npm run build` or `npm run validate:full` had run last, because neither
excluded the `noindex` benchmark route under `dist/experiments/`. A third check,
`fingerprint:check`, had the same defect and is the only one that pre-dates this
phase. Same class of problem as the one the document exists to resolve, in the
gates written to close it. Fixed in `8fcc7da` and `a3af8b7`.

**Every gate in the table above ran against the same `dist/`** — the state
`validate:full` leaves behind, which is the harder of the two and is what
exposed all three.

---

## Gate results, on the CONTINUATION's frozen commit `2154c77`

The tree is not the one above. Nine commits of mobile-3D-altimeter work — 68
files, ~17 000 insertions, almost all in `experiments/` — landed between the
Phase 9 freeze and this branch's base.

| Gate | Result |
|---|---|
| `npm run typecheck` | **0** |
| `npm run build` | **0** |
| `npm run fingerprint:check` | **0** — 72 pages, 24 assets, 0 unstamped |
| `npm run draco:check` | **0** |
| `npm run scan:secrets` | **0** — 640 files, 12 rules, clean |
| `npm run audit:conversion:check` | **0** |
| `npm run audit:seo:check` | **0** — 72 documents, 0 failures, 43 warnings |
| `node scripts/route-audit.mjs --quick` | **0** — 132 checks, 0 failing, 0 broken links |
| `npm audit` ×3 | 4 advisories, **none applicable** |
| `npm test` | **987 collected, 115 skipped, 864 passed, 8 failed** |
| `npm run validate:full` | **185 collected, 97 skipped, 57 passed, 31 failed** |

### The 39 failures, and why they do not block this phase

**Every Phase 9 suite is green** — analytics, attribution, consent, structured
data, 404, forms, the lead endpoint, the portal, and the two new suites.

**Every failure is in code this continuation did not touch.** The complete diff
`9ccbe05..HEAD` is 18 files and contains nothing under `experiments/`, no
`assets/`, no `_build/build.py`, and not `tests/homepage-chrome.spec.ts`. The
homepage, its header, the journey and their specs are byte-identical to the
branch base.

- **31 journey failures** — 30 are ten tests asserting the *old* portrait
  architecture on the three portrait projects. The portrait path deliberately
  dropped the WebGL scene and the scroll-driven clock; the same file already
  skips those tests on `reduced-motion` for that exact reason and the skips were
  never extended. The 31st is a build assertion that names the chunk
  `JourneyScene*` where it means "three.js is lazy" — three.js is now in a
  shared `Gltf` chunk because desktop and mobile both need it, which is better,
  not worse.
- **8 deterministic failures** — all `homepage-chrome.spec.ts` on `desktop-1920`
  and `reduced-motion`. A stable core of **three** (reproduced twice in
  isolation) plus a tail that tracks machine load: the same command on the same
  commit gave 56 failures on a saturated machine, 3 on a quiet one, and the 41
  tests behind 27 of those timeouts pass in 48 seconds when run alone.

**The menu is not broken.** On the stable three, `click({force:true})` opens it
and `aria-expanded` flips to `true`; `click({trial:true})` — every actionability
check, no input — passes; the burger's box is identical across 90 frames with no
animations running. What hangs is Playwright's non-forced input path at 1920.
The cause is not yet identified and is recorded as such rather than guessed at.

**Nothing was made green.** Extending a `test.skip` to three more projects would
have taken a minute. Six of the ten portrait tests are provably stale; four
assert properties a portrait page arguably *should* still satisfy — real HTML
content, a working skip link, no scroll trap, stages announced in order — and
skipping those would convert an open question into a silent assumption. No
timeout was raised and no assertion weakened, in either direction.

→ [`phase9-test-reconciliation.md`](../phase9-test-reconciliation.md) Part 2
