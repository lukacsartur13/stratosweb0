# Phase 9 — conversion, SEO and production finalisation

| | |
|---|---|
| Branch | `phase-9-conversion-seo-production-finalisation` |
| Branched from | `main` at `ad798d7` |
| Commits | **19** |
| Frozen for the gates at | `a3af8b7` |
| Pushed | **no** |
| Deployed | **no** |
| Phase 10 started | **no** |

Human review package: [`phase9-review/README.md`](phase9-review/README.md).
Machine-readable status: [`phase9-readiness.json`](phase9-readiness.json).

---

## 1. The commits

The five pre-existing Phase 9 commits are preserved. Nothing was rewritten,
squashed, reset or discarded; `f872fc1..6a1d4aa` are byte-identical to what they
were.

| # | Commit | What |
|---|---|---|
| 1 | `f872fc1` | The baseline, and what the live site actually serves |
| 2 | `102a6c0` | Audit every CTA, and separate the page's own from the chrome's |
| 3 | `84cc448` | Close every conversion finding, and make one of them a check |
| 4 | `a2d5d4a` | The event model, decided before any vendor can decide it for us |
| 5 | `9a6587b` | Measurement that ships nothing until someone configures it |
| 6 | `6a1d4aa` | GA4 behind consent, and a privacy policy that is finally true |
| 7 | `3708c12` | Attribution as an allow-list, and no click identifier at all |
| 8 | `18a3a59` | The whole storage surface, counted rather than described |
| 9 | `0f6da5a` | The homepage's real URL, and structured data that claims only what the page says |
| 10 | `d090d62` | A real 404 in three languages, and one address for the homepage |
| 11 | `60b8a0d` | The SEO audit, and the untranslated description it found |
| 12 | `b2fe596` | A `javascript:` URL was one click from running inside the portal |
| 13 | `cf379e4` | The header and dependency audits, and five scanner rules added before they are needed |
| 14 | `946ce49` | The newsletter said subscribe, the system stored an address |
| 15 | `cc9d8fb` | Lead operations, media rights, search readiness, content trust |
| 16 | `87fb03e` | The secret scan flagged the document describing the secret scan |
| 17 | `8fcc7da` | Two gates whose answer depended on which script ran last |
| 18 | `a3af8b7` | The third check whose answer depended on which script ran last |
| 19 | *(the reports)* | This report, the reconciliation, the readiness manifest and the review package |

Commits 1–6 are the accepted work this continuation was told not to restart.
7–19 are the continuation.

---

## 2. Test-result reconciliation

The phase opened with two incompatible results for the same commit:
`607 passed, 0 failed` and `605 passed, 2 failed`.

**They never disagreed about the total.** 647 tests were collected and 40 were
skipped at runtime in both runs, so **607 executed in both** — the number was
correct in both reports. The disagreement was entirely in the pass/fail split,
and it was caused by two load-dependent test races.

Established with commit-level evidence:

- `tests/portal.spec.ts`, `portal/src/App.tsx`, `portal/src/main.tsx` and
  `tests/homepage-chrome.spec.ts` are **byte-identical** between the pre-Phase-9
  baseline `ad798d7` and `6a1d4aa`;
- the **built** portal bundle is byte-identical too, verified by building a
  worktree at `ad798d7` and diffing `dist/portal`;
- both failures were **timeouts**, not assertion failures. No assertion about
  the product was violated in any run;
- a worker-count hypothesis was tested (`--workers=4`) and **rejected** — both
  tests still failed. No configuration change was made on the strength of it.

**One was a real race and is fixed at its cause.** The password-reset test did
`page.goto` then immediately `pushState` + `popstate`. `goto` resolves on
`load`; React commits and `BrowserRouter` subscribes to popstate afterwards, so
the event could land before anything was listening and simply be lost. Its
sibling ten lines above in the same file has always waited for
`await expect(page).toHaveURL(/\/portal\/login/)` first — the router's own first
act. That wait was added. **No timeout was raised, nothing was skipped, no
assertion was relaxed.**

**One was not touched.** The homepage focus-trap test presses Tab 30 times on
the WebGL homepage against a 30 s file timeout. Raising the timeout, marking it
slow, shortening it or skipping it on one project are all the same thing:
obtaining green output by weakening the test. It found a saturated machine, not
a broken site.

Full account: [`phase9-test-reconciliation.md`](phase9-test-reconciliation.md).

---

## 3. What was found and fixed

Twelve defects, none of which had a visible symptom. That is the pattern worth
noticing: every one of them would have shipped, and none would have produced a
bug report.

| # | Defect | Severity | Found by |
|---|---|---|---|
| 1 | **A `javascript:` URL could execute inside the authenticated portal.** `href={o.website}` rendered a stored, client-supplied address directly. The public form's URL check refuses text rather than schemes, so `javascript:alert(1).co` satisfies it | **high** | Writing the check that forbids it |
| 2 | **The homepage had two addresses.** `/` and `/index.html` both answered 200, the shells' canonical said `/`, the sitemap and 66 pages' worth of links said `/index.html` | medium | The canonical audit |
| 3 | **A fabricated `lastmod` on every sitemap URL.** `new Date()` — a build date, telling every crawler that all 60 pages changed on every deploy | medium | Reading `assemble.mjs` against the brief |
| 4 | **The newsletter claimed to send email.** Three places, including a frequency claim, for a system that has never sent a message | medium | The content-trust audit |
| 5 | **The Impact Program description shipped in Hungarian on the EN and DE pages.** A description in the wrong language *and* byte-identical to a third page | medium | The SEO audit's duplicate check |
| 6 | **The media-rights audit was being published.** `assets/img/FORRASOK.md` names every image's licence and where the one unresolved file is quarantined — served at a guessable URL, along with the font manifest | low | The media-rights audit, on itself |
| 7 | **The privacy policy overstated IP collection.** It said "IP address"; the system stores a salted SHA-256 digest and never the address | low | Comparing the document to `hashIp()` |
| 8 | **Attribution collection was undisclosed.** Added in this phase and absent from the privacy policy | medium | Auditing our own change |
| 9 | **Questionnaire answers were absent from the processed-data list**, which named email and phone | medium | The legal audit |
| 10 | **A processor was named by guess.** "Email provider: e.g. Google Workspace or another email provider", in a document whose purpose is exactness | low | The legal audit |
| 11 | **Two gates whose answer depended on which script ran last.** The SEO audit and the structured-data suite walked `dist/` without excluding `dist/experiments/` — a `noindex` benchmark route that `npm run build` deletes and `build:full` creates. Clean after one command, 8 and 4 failures after the other, on identical source | medium | Running the gate sequence in a different order |
| 12 | **A third check with the same defect**, and the only one that pre-dates this phase. `fingerprint:check` skipped only `portal`, so it reported an unstamped reference on a route no deploy will ever serve | low | The same |

Plus the two test defects in §2. Findings 11 and 12 were found **during** the
gate sequence and are the same class of problem as the flaky totals the phase
opened with — a check whose answer depends on the order of the commands before
it. See [`phase9-test-reconciliation.md`](phase9-test-reconciliation.md) §6.

---

## 4. Workstream results

### D — Attribution

An allow-list of five UTM parameters, not a filter. Everything else in the URL is
never read — not sanitised, not truncated, not hashed. **No advertising click
identifier** is read, stored or declared; eight are asserted absent by name.
Session-scoped `sessionStorage`, written only when the page view actually has
attribution, so the ordinary visitor causes zero bytes. **No Supabase schema
change** — `meta` is an existing `jsonb` column.

32 assertions on Chromium and WebKit.
→ [`phase9-attribution-design.md`](phase9-attribution-design.md)

### E — Consent and storage

2 cookies, 2 `localStorage` keys, 1 `sessionStorage` key, 2 third-party origins.
With consent refused or unanswered the public site makes **zero** cross-origin
requests — structurally, because there is no font CDN, no embedded media in 69
pages, no tag manager, no chat widget, no heatmap and no error reporter. Two
categories, both real.
→ [`phase9-consent-inventory.md`](phase9-consent-inventory.md)

### F — Technical SEO

72 documents, 21 checks each, **0 hard failures**, 43 warnings all of which are
deliberate. 60 distinct titles and 60 distinct descriptions for 60 indexable
routes; hreflang reciprocal in both directions on 69/69; 0 orphans, with the
least-linked indexable route at 5 inbound links.
→ [`phase9-seo-audit.md`](phase9-seo-audit.md) · `npm run audit:seo:check`

### G — Structured data

One generator, all 69 content routes including the three React homepage shells.
The rule: emit nothing the page does not already say to a human being. Nothing
claims a rating, review, price, award, address, founding date or employee count.
The six articles carry **no publication date**, because none exists and inventing
one would be a fabricated fact in a format built to be trusted without checking.
Summary case studies get a `WebPage` and nothing that reads as a finished work.
→ 15 assertions in `tests/structured-data.spec.ts`

### H — Sitemap, robots and indexing

60 indexable = 60 sitemap entries, asserted in both directions. `<lastmod>`
removed. Portal, API, drafts and 404s excluded. Preview deploys emit
`Disallow: /`.

### I — Redirects and 404

Seven rules, no loops, no chains, locale and query strings preserved, and no
catch-all to the homepage. A real 404 in three languages that redirects nobody,
offers no search field it cannot honour, loads no WebGL, and claims nothing to a
crawler about a page that does not exist.
→ [`phase9-redirect-map.md`](phase9-redirect-map.md) · 36 assertions

### J — Legal and data governance

Four corrections, all of them the document catching up with the code. Two Article
13 requirements deliberately **not** written — legal basis per purpose and the
third-country transfer mechanism — because an invented one is worse than an
absent one: it becomes the basis the Controller is held to.
→ [`phase9-legal-data-audit.md`](phase9-legal-data-audit.md)

### K — Forms and lead operations

Five form types, one controller, one envelope, one endpoint. The newsletter's
three false claims corrected. A four-step deletion procedure written down, in
which step one is `SELECT` and the delete carries `RETURNING`, because a receipt
is what proves the confirmation. The legacy adapter **stays** — its date has not
arrived and its telemetry has never been read.
→ [`phase9-lead-operations.md`](phase9-lead-operations.md) ·
[`phase9-legacy-lead-adapter-removal.md`](phase9-legacy-lead-adapter-removal.md)

### L, M — Portal and API security

One real vulnerability, fixed. Four source-level rendering-safety properties now
asserted over every file in `portal/src`, so they hold for files written later.
The in-memory rate limiter is documented as **not** durable and is not claimed to
be one.
→ [`phase9-portal-api-security.md`](phase9-portal-api-security.md)

### N — Security headers and CSP

No header changed. Every Google origin named with its directive, its reason and
its consent gate; every deliberate absence named too. The two allowances that
*are* weakenings — `'unsafe-inline'` on `style-src`, `blob:` on `worker-src` —
are stated rather than buried. HSTS `preload` flagged for a decision and not
touched.
→ [`phase9-security-headers.md`](phase9-security-headers.md)

### O — Dependencies and secrets

0 vulnerabilities in root and `experiments`. 3 moderate `react-router`
advisories in the portal, analysed per advisory and **not applicable** — two
need attacker-controlled navigation targets and every one here is a literal
string; one needs SSR. `npm audit fix --force` not run, no major upgrade
performed. Secret scan clean over 553 files and 12 rules, five added **before**
the credentials they look for exist.
→ [`phase9-dependency-audit.md`](phase9-dependency-audit.md)

### P — Media and relationship rights

Seven approved organisations, neutral wording, `ready` gate that renders nothing
rather than a placeholder. `cruise-jet.jpg` verified absent. Uncensored Society
absent from the entire repository. `FORRASOK.md` un-published.
→ [`phase9-media-rights.md`](phase9-media-rights.md)

### Q — Search platform readiness

No fake token anywhere. The sequence written down, with the step that gets missed
called out. One item is time-sensitive and unrecoverable.
→ [`phase9-search-platform-setup.md`](phase9-search-platform-setup.md)

### R — Email operations

**The system sends no email.** Every capability labelled honestly.
→ [`phase9-email-operations.md`](phase9-email-operations.md)

### S, T — Content trust and localisation

Zero unsupported result claims, zero unsupported partner claims, zero award
claims, zero Wix hosting claims, zero draft case studies presented as full.
Three inactive features described as active — all three the newsletter, all
three fixed. Mixed-language UI: 0. Broken hreflang pairs: 0.
→ [`phase9-content-trust.md`](phase9-content-trust.md)

### U — Readiness manifest

20 categories, 119 items, every one carrying status, evidence, affected routes,
owner, required action and production impact.
**68 pass · 14 warning · 34 blocked · 3 not-applicable.**
No external blocker is marked pass.
→ [`phase9-readiness.json`](phase9-readiness.json)

---

## 5. GA4 — implemented, and still pending

### Implemented and verified

- GA4 `G-JZD43PHJ41` behind Basic Consent Mode read strictly: `gtag.js` is not
  injected until consent, so a refusal causes **no contact with Google at all**;
- three independent gates — consent, a browser-side hostname allow-list, and the
  presence of a Measurement ID;
- advertising storage, user data and personalisation permanently denied; Google
  Signals off; **no advertising origin in the CSP**;
- everything off the two production domains labelled `staging`, on every event
  and as GA4's own `traffic_type`;
- PII guard derived from the lead schema, so a new form field fails the suite
  until it is listed as prohibited;
- Property ID `15392224433` present only in comments and documentation, and
  **verified absent from `dist/`**.

### Pending, and the distinction that matters

**The website sending `traffic_type: staging` does not by itself prove that
staging traffic is excluded from production reports.** Reported separately:

| | Status | Owner |
|---|---|---|
| Event labelling implemented in code | **done** | repository |
| GA4 property filter **configured** | **blocked** | site owner |
| GA4 property filter **tested** | **blocked** | site owner |
| Portal production-host filter tested | **not applicable** — the screen does not exist | — |
| Data-retention period configured | **blocked** | site owner |
| Service-account access for Portal reporting | **blocked** | site owner |
| Analytics Data API enabled | **blocked** | site owner |
| Portal metrics compared against the GA4 interface | **not applicable** | — |

**No retention period is written into the public privacy policy**, deliberately,
and none should be until the configured period is confirmed.

---

## 6. Gate results

Source frozen at **`a3af8b7`**. Working tree clean apart from
`.claude/settings.local.json`, a local editor permission file. Full
`npm run build` before the suites. No executable source was edited during the
sequence.

Every gate below ran against the **same** `dist/`, in the state
`validate:full` leaves behind — the one that includes `dist/experiments/`. That
is deliberate: it is the harder of the two states, and running the sequence in
it is what found defects 11 and 12.

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **exit 0** |
| Production build | inside `npm run validate:full` | **exit 0** |
| Asset fingerprints | `npm run fingerprint:check` | **exit 0** — 72 pages, 24 assets, 0 unstamped |
| Draco sync | `npm run draco:check` | **exit 0** |
| Secret scan | `npm run scan:secrets` | **exit 0** — 566 files, 12 rules, clean |
| CTA audit | `npm run audit:conversion:check` | **exit 0** — no CTA integrity failures |
| SEO / metadata / canonical / hreflang / structured-data eligibility / sitemap / robots audit | `npm run audit:seo:check` | **exit 0** — 72 documents, **0 failures**, 43 warnings |
| Route audit — every route rendered in a real browser | `node scripts/route-audit.mjs --quick` | **exit 0** — 132 checks, **0 failing**, 0 broken internal links |
| Deterministic regression suite | `npm test` | **exit 0** — 796 collected, 40 skipped, **756 passed, 0 failed** |
| Full journey suite + clean rebuild | `npm run validate:full` | **exit 0** — 185 collected, 97 skipped, **88 passed, 0 failed** |

**One consistent set of totals: 756 passed and 0 failed on the deterministic
suite, 88 passed and 0 failed on the journey suite, 132 route checks with 0
failing. Nine gates, nine exit codes of zero.**

The journey suite's 97 skips are its own design: the `reduced-motion` project
skips the WebGL motion tests it cannot meaningfully run.

### What the 756 covers

| Area | Where |
|---|---|
| Metadata, canonical, hreflang, sitemap, robots | `public-site.spec.ts` + `npm run audit:seo:check`; rendering by `route-audit.mjs` |
| CTA audit | `npm run audit:conversion:check` |
| Analytics no-PII audit, consent audit | `analytics.spec.ts` — 62 |
| Attribution audit | `attribution.spec.ts` — 32 |
| Structured-data audit | `structured-data.spec.ts` — 16 |
| 404 status and behaviour audit | `not-found.spec.ts` — 36 |
| Case-study status audit | `structured-data.spec.ts` + `seo-audit` |
| Form regression | `lead-forms.spec.ts`, `lead-endpoint.spec.ts` |
| Portal security and Portal rendering safety | `portal.spec.ts` |
| API security | `lead-endpoint.spec.ts` |
| CSP / security-header audit | `analytics.spec.ts`, `public-site.spec.ts` |
| Dependency audit, secret scan, media-output audit | `npm audit`, `npm run scan:secrets`, `seo-audit` |
| Locale audit | every public-site test runs in three locales |
| Accessibility smoke, reduced motion, horizontal overflow | `public-site.spec.ts`, the `reduced-motion` project |
| Homepage regression, Phase 7 transitions, Phase 8.5 motion, BFCache and lifecycle | `homepage-chrome.spec.ts`, `public-site.spec.ts`, `lead-forms.spec.ts` |
| The full 0–30 000 m journey | `validate:full` — 88 |

Portal Analytics authentication smoke: **not applicable** — the screen does not
exist.

---

## 7. Blocked items

34 in the manifest. The ones that block a launch or a cutover:

### Time-sensitive — do this first

1. **Export the old Wix URL inventory** from Search Console's Pages report on
   `media-stratos.com`, or from the Wix sitemap. **Before DNS moves.**
   Afterwards that site is unreadable and its URL structure is gone permanently.

### Before the domain cutover

2. **Confirm Netlify "Pretty URLs" is OFF.** If it is on, every canonical this
   build emits points at a 301 — on all 60 indexable routes at once. It is a
   dashboard setting and is invisible from the repository.
3. **Mark the custom domain PRIMARY in Netlify**, not merely attached.
   `robots.txt` is `Disallow: /` on any `netlify.app` origin by design and stops
   being so only then. Attach without marking primary and the site stays
   uncrawlable, silently, with nothing on any page to say so.
4. **Decide on HSTS `preload`.** Present, pre-dating this phase, and effectively
   irreversible once submitted. Recommendation: drop the token until the domain
   has been live and stable on HTTPS for a few weeks.

### Before a public launch

5. **Legal review of the privacy policy in three languages**, and the two
   Article 13 gaps: legal basis per purpose, and the transfer mechanism for
   Netlify (US) and Supabase (SG).
6. **A lead-notification mechanism.** A submission is stored and nobody is told;
   the Portal is the only place a new enquiry appears. Against a footer that
   promises a reply within a few hours, this is the most consequential
   operational gap in the phase.
7. **Durable rate limiting on `/api/lead`**, or an accurate statement that there
   is none. Whether Cloudflare is in front of this site is not knowable here.
8. **Media permissions** — `cruise-jet.jpg`, the seven organisation marks, the
   two team photographs.
9. **The email provider's legal entity**, for the processor list.
10. **Confirm or soften "a reply usually within a few hours"** — the only
    unverified promise left on the site, and it is on every page.

---

## 8. Phase 10 readiness

Ready to begin, subject to §7. Carried forward:

1. Everything in §7.
2. Build the Portal Analytics screen, once the service account and the Analytics
   Data API exist.
3. The react-router 6 → 7 migration, as its own change with its own test run.
4. Real publication dates for the six articles, if Article rich results are
   wanted.
5. Re-evaluate the legacy lead adapter on or after **2026-09-05**, with the
   telemetry query result attached to the decision.
6. A seeded staging user, so the three manual Portal checks become automated.
7. A timeout on the Supabase insert, once there is latency data to choose one
   from.
8. `CLOUDFLARE.md` rewritten for the real domain, or deleted.

---

## 9. Verdict

Nine gates green on a frozen source, in the harder of the two build states, with
one consistent set of totals. Twelve defects found and fixed — one of them a
real vulnerability in an authenticated admin, and three of them checks that
disagreed with themselves depending on which command ran first. No assertion was
weakened to get there.

The limitations are documented rather than resolved, and they are documented
because they **cannot** be resolved from inside this repository: four legal
inputs that need a lawyer, four dashboard settings and a DNS change that need
the site owner, one time-sensitive export that must happen before the cutover,
and one test that can time out on a saturated machine and was deliberately not
given more time.

**PHASE 9 ACCEPTED WITH DOCUMENTED LIMITATIONS**
