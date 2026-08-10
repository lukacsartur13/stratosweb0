# Phase 9 — Workstream E: consent and storage inventory

Everything this site stores on a device or fetches from a third party, and what
each item is gated on. Counted from `dist/` and from the source, not assumed.

---

## 1. Cookies

| Cookie | Set by | When | Gate | Lifetime |
|---|---|---|---|---|
| `_ga` | Google Analytics 4, via `gtag.js` | only after analytics consent is granted | **analytics consent** | 2 years (Google's default) |
| `_ga_JZD43PHJ41` | Google Analytics 4 | same | **analytics consent** | 2 years |

**Two cookies, both from one vendor, both consent-gated, and neither exists until
the visitor says yes.** The site itself sets no cookie of its own — no session
cookie, no preference cookie, no CSRF cookie. There is nothing to set one: the
public site is static files, and the one endpoint it posts to is stateless.

Refusal is not a "cookieless ping" arrangement. `gtag.js` is not injected at all
until consent is granted (`loadGa4()` in `assets/js/analytics.js`), so a visitor
who refuses causes no request to any Google host and therefore no cookie.

Withdrawal deletes both cookies rather than only stopping new ones — see
`unloadGa4()`, which expires every `_ga*` name on the host, the bare domain and
the dot-prefixed domain.

Verified by `tests/analytics.spec.ts`:
`measurement sets no cookie and writes no storage`,
`refusing loads nothing, and is remembered`,
`withdrawal stops sending and clears the cookies`,
`the cookie names it lists are the ones that can actually be set`.

---

## 2. `localStorage`

| Key | Origin | Written by | Purpose | Gate |
|---|---|---|---|---|
| `stratos.consent` | public site | `assets/js/analytics.js` | Remembers the answer — `{ state: "granted" \| "denied", at: <ISO timestamp> }` | none, and correctly so |
| `sb-<project-ref>-auth-token` | `/portal` only | `@supabase/supabase-js` (`persistSession: true`) | The signed-in staff member's session | authentication; strictly necessary |

`stratos.consent` holds no identifier. It exists **only so that a refusal is
honoured** — remembering "no" is what stops the interface asking again on every
page. Storage strictly necessary to carry out a choice the visitor made does not
itself require consent; if it did, no consent banner could ever remember
anything.

The Supabase auth token is on the `/portal` origin, is written only after a
successful sign-in, and is a private admin tool that no public visitor reaches.
It is authentication storage, which is strictly necessary by definition.

**Nothing else writes `localStorage`.** Verified by grep across `assets/js/`,
`experiments/home`, `experiments/src` and the built homepage bundles
(`dist/assets/home/*.js` — zero occurrences).

---

## 3. `sessionStorage`

| Key | Origin | Written by | Contents | Gate |
|---|---|---|---|---|
| `stratos.attribution` | public site | `assets/js/lead.js` | Up to five UTM campaign labels, a landing path, a referring host | see below |
| `stratos.home-height` | homepage only | `assets/js/home-history.js` | Three numbers: the homepage's settled document height, the viewport width it was measured at, and the pathname (`/`, `/en/`, `/de/`) | strictly necessary |

Written **only** when the page view carries an allow-listed campaign parameter or
an external referrer. A visitor who types the address, or follows an internal
link, causes **zero bytes** — which is most visitors. It holds no identifier,
and it dies with the tab.

Design and the full allow-list: `phase9-attribution-design.md`.

### `stratos.home-height`

A layout measurement, and the gate is not a close call. It is the height in
pixels that the homepage settled at, the viewport width it was measured at, and
which of the three locale homepages it was — no identifier, nothing derived from
the visitor, nothing transmitted anywhere, and it dies with the tab.

It exists so that pressing Back returns the visitor to where they were reading.
`<main>` is a React container, so on a back navigation the browser applies its
scroll restoration to a two-thousand-pixel shell and the visitor's position is
clamped away before the page exists; reserving the recorded height gives the
browser's own restoration something to restore into. Storage carrying out a
navigation the visitor just asked for is strictly necessary in the ordinary
sense of the term.

Written only on the homepage, and only when the document's height changes by
more than 32 px. Full reasoning, including why `history.state` was tried first
and abandoned: `assets/js/home-history.js` and
`homepage-history-restoration-investigation.md`.

> **REQUIRES LEGAL REVIEW** — whether this may be written without prior consent.
> The engineering position is that it is not analytics: nothing is transmitted
> until the visitor deliberately submits a form carrying their own name, address
> and message, and campaign labels identify nobody. That is a defensible reading
> and it is not the only possible one. If the answer is that consent is required,
> the fallback is one line of change and costs one campaign attribution per
> multi-page session — read the parameters at submission time from the current
> URL and store nothing. Recorded here rather than decided here.

---

## 4. Third-party requests

### 4.1 From the public site

| Origin | What | When | Gate |
|---|---|---|---|
| `www.googletagmanager.com` | `gtag.js` | after consent granted | **analytics consent** |
| `www.google-analytics.com`, `*.google-analytics.com`, `*.analytics.google.com` | event collection | after consent granted | **analytics consent** |

**That is the complete list.** With consent refused or unanswered, the public
site makes **zero** cross-origin requests. Confirmed structurally rather than by
observation alone:

- **No font CDN.** Archivo, Aboreto and JetBrains Mono are self-hosted under
  `/assets/fonts`; `font-src` in the CSP is plain `'self'`.
- **No embedded media.** Zero `<iframe>`, `<video>`, `<audio>`, YouTube, Vimeo or
  Google Maps in any of the 69 public pages.
- **No script CDN, no tag manager container, no chat widget, no A/B tool, no
  heatmap, no error reporter.**
- **No Meta Pixel.** Removed in Phase 9 and asserted absent.
- The only other external origins that appear in the public HTML are ordinary
  `<a href>` links a visitor has to click: `facebook.com`, `instagram.com`,
  `linkedin.com` (footer profiles), `netlify.com`, `supabase.com` (named
  processors in the privacy policy) and `naih.hu` (the supervisory authority).
  A link is not a request.

### 4.2 From the portal (`/portal`, private, staff only)

| Origin | What | Gate |
|---|---|---|
| `*.supabase.co` | REST, auth and realtime | authentication |

Not part of the public site's consent surface: the portal is behind a sign-in,
is `noindex, nofollow, noarchive`, is `Cache-Control: no-store`, and is excluded
from the sitemap and from `robots.txt`.

---

## 5. The consent interface, against the brief's checklist

`assets/js/consent.js`. Each row names where the property is enforced and the
test that fails if it stops being true.

| Requirement | Status | Evidence |
|---|---|---|
| Accept and Refuse have equivalent visual weight | **pass** | Same element type, same classes (`btn btn--ghost consent__btn`), same container. The test compares *computed* styles, not the class attribute — `offers accept and refuse with equal weight` |
| Optional analytics is not preselected | **pass** | There is no checkbox to preselect. State starts `denied`; nothing loads before an answer — `nothing is contacted, stored or sent before an answer is given` |
| Refusal is as easy as acceptance | **pass** | One click, same row, no "manage preferences" detour, no second screen |
| Preference can be reopened and changed | **pass** | `[data-consent-settings]` control in the footer of every page — `the choice can be reopened and reversed from the footer` |
| Withdrawal disables future GA4 loading | **pass** | `consent('denied')` → `unloadGa4()`; `allowed()` gates every dispatch — `withdrawal stops sending and clears the cookies` |
| No tracker loads before consent | **pass** | `loadGa4()` is called only from `consent()` and from `start()` when already granted |
| HU, EN and DE complete | **pass** | All nine strings present in all three built dictionaries; verified in `dist/ugyfelszolgalat.html`, `dist/en/contact.html`, `dist/de/kontakt.html`. The privacy link is per-locale and resolves within the locale |
| Keyboard navigation works | **pass** | Native `<button>`s in the document flow; the banner is a `role="region"`, not a focus trap — `does not block the page, and is reachable from the keyboard` |
| Focus is visible | **pass** | Both buttons carry `.btn`, which the site's focus-visible ring applies to; focus moves into the banner on open and returns to the trigger on close |
| Reduced motion works | **pass** | The banner has no entrance animation to suppress. The `reduced-motion` project runs the whole public suite |
| No layout shift blocks content | **pass** | Fixed-position band, not a modal and not an interstitial. The page is readable and scrollable with the banner open |
| Does not reappear after a valid decision | **pass** | `consentAnswered()` reads `stratos.consent` — `a remembered answer is not asked again` |
| Cannot be dismissed into implied consent | **pass** | No close control, and Escape does not answer — `cannot be dismissed into implied consent` |

### Categories

**Two, and both are real:**

- **necessary** — the consent record itself, and portal authentication. Not
  offered as a choice, because refusing it is not a coherent request.
- **analytics** — GA4. The only thing the banner asks about.

No advertising category, no "external media" category, no "personalisation"
category. Those technologies do not exist here, and offering a switch for a
thing that does not exist trains people to ignore the ones that do.

---

## 6. What is deliberately absent

- Meta Pixel, Google Ads, DoubleClick, and every other advertising origin — not
  in the CSP, not in the code. Asserted by
  `the CSP permits gtag and nothing from the advertising side`.
- Google Signals — off in the `gtag('config')` call.
- `ad_storage`, `ad_user_data`, `ad_personalization` — permanently `denied`,
  never granted by any code path. Asserted by
  `advertising storage is refused even when analytics is accepted`.
- Cross-session or cross-device identifiers of any kind.
- Form-field analytics and questionnaire-answer analytics — every field the lead
  schema declares is refused as an analytics parameter key, and that list is
  derived from the schema so a new field fails the build until it is listed.

---

## 7. Open items

| Item | Status | Owner |
|---|---|---|
| Legal reading of `stratos.attribution` session storage | **REQUIRES LEGAL REVIEW** | site owner / counsel |
| Consent copy in three languages reviewed by a lawyer | **REQUIRES HUMAN LEGAL TRANSLATION REVIEW** | site owner / counsel |
| GA4 data-retention period, before the privacy policy names one | **REQUIRES USER FACTUAL INPUT** | site owner, in the GA4 Console |
