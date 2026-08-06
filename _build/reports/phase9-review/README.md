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

**Not implemented:** the Portal Analytics screen does not exist. Its six
requirements are `not-applicable` rather than passing.

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
| 1 | **Export the old Wix URLs** | Unrecoverable after DNS moves |
| 2 | **Confirm Netlify 'Pretty URLs' is OFF** | If on, every canonical points at a 301, on all 60 routes |
| 3 | **Mark the custom domain PRIMARY**, not merely attached | `robots.txt` stays `Disallow: /` otherwise — silently |
| 4 | **Decide on HSTS preload** | Effectively irreversible once submitted |
| 5 | Verify the four curls | `phase9-seo-audit.md` §6 |
| 6 | Search Console and Bing property setup | Nothing to verify against until then |

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
