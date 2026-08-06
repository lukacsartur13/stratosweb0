# Phase 9 — Workstreams S and T: content trust and localisation

Every public claim, checked against what the system and the business can
actually support. Then the same check applied to all three languages, because a
claim removed in Hungarian and left standing in German is still on the site.

---

## 1. The required counts

| Requirement | Count | Notes |
|---|---|---|
| Unsupported result claims | **0** | No conversion rates, no traffic figures, no revenue numbers, no "X% increase" anywhere |
| Unsupported partner claims | **0** | See §2 |
| Fixed-price contradictions | **0** | See §3 |
| Outdated Wix hosting claims | **0** | See §4 |
| Draft case studies presented as full | **0** | See §5 |
| Inactive features described as active | **0 — after this phase.** Was **3** | See §6 |
| Mixed-language UI | **0** | §8 |
| Untranslated consent controls | **0** | §8 |
| Wrong-locale legal links | **0** | §8 |
| Untranslated 404 | **0** | §8 |
| Broken hreflang pairs | **0** | 69/69 reciprocal, asserted |

---

## 2. Partners, collaborators and clients

Handled structurally rather than editorially — the full analysis is in
`phase9-media-rights.md` §4. In summary:

- Five organisations under **"Selected collaborations"**, which claims
  association and nothing more.
- Two named individually because their real relationship is the opposite of a
  client's: Stratos **sponsors** HAIO and works for **FICE** for nothing. Both
  were stated by the owner of the relationship, not inferred.
- Two clients with live project routes, evidenced by the work itself.
- **No named organisation is called a partner anywhere.** The word appears five
  times in generic prose about clients ("while we work on our partners'
  growth"), never attached to a name.
- **Uncensored Society: absent from the entire repository.** Zero matches.

---

## 3. Business model and pricing

| Claim | Support |
|---|---|
| Monthly-fee construction | The service pages describe it as the offer; no specific figure is published |
| "fix áras keretben" on the enterprise page | Reads in full as *"depending on the project we can work in a fixed-price framework, a dedicated team (time & material) model, or an ongoing retainer"* — a list of **contracting models offered**, not a price. No contradiction with the monthly-fee positioning: both are named as options in the same sentence |
| Public prices | **none anywhere**, and none in the structured data. `Service` nodes carry no `offers` and no `priceRange` |
| The questionnaire produces a quote | It produces an enquiry a person answers. No automatic pricing is claimed |

---

## 4. Technology and hosting

| Claim | Reality |
|---|---|
| Hosted on Netlify, with Netlify Functions | **true** |
| Supabase stores enquiries and serves the Portal | **true** |
| No Wix hosting claim anywhere in visitor-facing text | **true.** The only occurrence of "Wix" in `dist/` is inside an HTML **comment** in the privacy policy — the source review marker recording what the old Wix-inherited text said. Not visible to a visitor, which is the intended behaviour: a public "this document used to be wrong" note would be worse than the state it records |
| Awwwards, awards, prizes | **zero occurrences.** Not claimed anywhere, in any language |
| Team size | **not stated numerically** anywhere. Two people are shown on the About page by photograph and name; no headcount is asserted |
| Geography | Győr and Budapest, in the site description. A statement about where the business works, and the owner's to make |
| Response time | **flagged** — see §6 |

---

## 5. Case-study maturity

Three case studies, all marked `summary` in `CASE_STATUS`. Each is:

- reachable, linked and translated into all three languages;
- `noindex, follow` — the outbound link equity is kept, the claim is not;
- absent from the sitemap;
- given no "read the full case study" call to action;
- given **no** `Article` or `CreativeWork` structured data — a `WebPage` and a
  breadcrumb, and nothing that reads as a finished work.

All four are asserted:
`a draft or summary case study is never presented as a full case study` checks
the structured data **and** the `noindex` meta on every one of the nine routes,
and the SEO audit checks the sitemap in both directions.

Promoting a project later is a one-word edit in `CASE_STATUS`.

---

## 6. Features described as active — the three that were not

This is where the audit found real defects. All three were the same class:
**the software stored something and the page said it had done something more.**

| Claim | Reality | Status |
|---|---|---|
| "Subscribe to our newsletter" + a **Subscribe** button | The address is stored. Nothing is ever sent | **fixed** |
| "We'll send you new articles and tips by email — **rarely**, but with substance" | No delivery, and no frequency to claim | **fixed** |
| "We'll reply to the address you gave us shortly" *after a newsletter signup* | No reply is generated | **fixed** — the newsletter has its own message now |

Full account in `phase9-email-operations.md` §2. Asserted by
`the newsletter does not claim to send anything`, across six built pages in
three languages, by checking for the **absence** of each of the nine phrasings.

### The one claim left standing, flagged rather than changed

The footer says **"A reply usually within a few hours"**, on every page, in all
three languages.

It is not verifiable from the repository — it is a statement about how the
business operates — and softening a business's own commercial commitment is not
an implementer's call. It is also the claim most affected by §7 below.

> **REQUIRES USER FACTUAL INPUT** — confirm "usually within a few hours" holds
> in practice, including at weekends. If not, "within one working day" or no
> timing at all are the honest alternatives.

### Notifications and the Portal

| Claim on the site | Reality |
|---|---|
| Nothing claims an email notification is sent | **correct** — none is |
| Nothing claims automatic scheduling | **correct** — there is no booking widget, calendar link or "pick a time" anywhere |
| Nothing claims an Impact application is *accepted* | **correct** — applications are described as received and reviewed |
| Nothing public claims the Portal exists as a client feature | **correct** — the Portal is named only in the privacy policy and imprint, as the private system where enquiries are read |

---

## 7. The gap worth naming

**A submission is stored and nobody is told.** There is no email, Slack, webhook
or push notification of any kind — the Portal is the only place a new enquiry
appears, and somebody has to open it.

That is not a false claim, so it is not a §1 count. It is the operational fact
that makes the footer's few-hours promise depend entirely on a habit. Options
and trade-offs are in `phase9-email-operations.md` §4; none was implemented,
because the brief forbids adding a vendor without approval.

---

## 8. Localisation of the Phase 9 changes

Every change made in this phase, in all three languages.

| Surface | HU | EN | DE | Evidence |
|---|---|---|---|---|
| Consent banner — title, body, accept, decline, privacy link, state messages | ✓ | ✓ | ✓ | All nine strings present in the built dictionaries of all three; verified in `dist/ugyfelszolgalat.html`, `dist/en/contact.html`, `dist/de/kontakt.html` |
| Consent settings control (footer) | ✓ | ✓ | ✓ | Generated markup, per locale |
| Privacy policy — the four corrections | ✓ | ✓ | ✓ | 13 new strings translated; the build reports zero untranslated |
| Newsletter copy — footer and blog | ✓ | ✓ | ✓ | 6 new strings; asserted absent-of-claim on six built pages |
| Newsletter success message | ✓ | ✓ | ✓ | `thanks_newsletter` in all three `js` dictionaries |
| **404 page** | ✓ | ✓ | ✓ | Three documents. `tests/not-found.spec.ts` asserts `lang`, the heading and the four links per locale |
| Metadata — title, description | ✓ | ✓ | ✓ | 60 distinct titles and 60 distinct descriptions for 60 indexable routes. **The Impact Program description was shipping the Hungarian sentence in EN and DE — found and fixed** |
| Structured data | ✓ | ✓ | ✓ | `inLanguage` is `hu-HU` / `en-GB` / `de-DE` per page; breadcrumb labels are read from the trail each locale renders |
| Form messages | ✓ | ✓ | ✓ | Client strings per locale; server strings in `MESSAGES` in `lead-contract.mjs` |
| Analytics labels | n/a | n/a | n/a | Event names and parameters are locale-invariant by design — the taxonomy uses canonical page keys, not translated slugs |
| Portal Analytics labels | n/a | n/a | n/a | The screen does not exist |
| Legal links | ✓ | ✓ | ✓ | `consent_privacy_href` resolves within the locale: `adatkezelesi-tajekoztato.html`, `en/privacy-policy.html`, `de/datenschutz.html`. **No wrong-locale legal link** |
| CTA wording | ✓ | ✓ | ✓ | Unchanged in this phase; Workstream A covered it |
| Search Console references | ✓ | ✓ | ✓ | The correction that Search Console is not visitor tracking is present in all three privacy policies |
| Locale routes | ✓ | ✓ | ✓ | Reciprocal hreflang on 69/69, asserted |

### Mixed-language UI: 0

The build fails loudly on an untranslated string — it writes `missing-<lang>.json`
and prints a count. Both are currently absent, for both languages. That is what
caught the Impact description, which had been in Hungarian on the English and
German pages for as long as the page has existed.

### Legal translation

> **REQUIRES HUMAN LEGAL TRANSLATION REVIEW** — the privacy policy in all three
> languages. The Phase 9 corrections were written in Hungarian and translated by
> an implementer. The English and German are faithful to the Hungarian; neither
> has been read by a lawyer, and a privacy notice is a document where "faithful
> to the source" and "correct in the target jurisdiction" are different
> standards.
>
> Already marked in the source and asserted by
> `is flagged for legal review before launch`.

---

## 9. Uncertain claims, flagged rather than deleted

Per the brief, these are surfaced rather than silently removed. None is known to
be false; each is simply not verifiable from here.

| # | Claim | Where | Why flagged |
|---|---|---|---|
| 1 | "A reply usually within a few hours" | footer, every page, 3 languages | An unverified response-time commitment, and §7 makes it depend on a habit |
| 2 | "Győr and Budapest" | site description, all locales | A statement about where the business works. The owner's to confirm |
| 3 | The seven organisation marks are displayed with permission | logo rail, Impact and sponsor pages | Artwork was supplied, which strongly implies consent. Whether it is written down anywhere is not knowable here |
| 4 | The two team photographs are published with the subjects' agreement | About page | Presumed; not recorded |
| 5 | Controller legal details — name, address, tax number, chamber | imprint and privacy policy | Specific and internally consistent. Not an implementer's to verify or edit |
