# Stratos redesign — 04 · QA and what changed

Date: 2026-10-16 · Branch `redesign/quiet-authority` · **Nothing committed, pushed,
merged or deployed.** All changes are staged on the branch for review.

Read in order: `01-audit.md` → `02-design-system.md` → `03-homepage-copy.md` → this file.
Stills: `shots/` (git-ignored PNGs, local only).

---

## 1. What was built

The homepage (`/`, `/en/`, `/de/`) is a static, generated page on a new light design
system. Eight scenes: hero → Rapidkert takeover → silence → GoDataFusion → three
capabilities → principles + enterprise ledger → selected collaborations → closing
scene. New header (floating, four destinations + one action, sheet under 961 px) and
new light footer — **on the homepage only**; the 66 subpages keep the dark flight-deck
shell until this direction is approved (Phase 4).

## 2. Performance — measured, before vs after

Cold cache, headless Chromium, same script both times (`scratchpad/perf.mjs`,
`fullread.mjs`, `inp.mjs`), local static server (no compression, so "gz" is computed
per file with gzip -9). Phone profile = 390×844, 4× CPU throttle, slow 4G (150 ms RTT,
1.6 Mbps).

| | Before | After | Change |
|---|---|---|---|
| **Desktop, load + 10 s idle** | 27 requests · 2,405 KB raw / 1,327 KB gz | **14 requests · 373 KB / 313 KB** | −84 % raw |
| JS before any interaction | 1,354 KB raw / 398 KB gz (idle prefetch of React + three.js) | **25 KB / 10 KB** (4 deferred files) | −98 % |
| **Desktop, after first scroll** | 32 requests · 3,743 KB · JS 1,967 KB · 2 GLBs 725 KB | **14 requests · 373 KB · no new JS** | −90 % |
| **Desktop, full read-through** | 3,743 KB | **419 KB** | −89 % |
| **Phone, full read-through** | 2,628 KB | **502 KB** | −81 % |
| HTML document | 94 KB raw / 25.0 KB gz | **56 KB / 14.5 KB** (CSS inlined) | −42 % gz |
| WebGL contexts / canvases | **2 / 1** | **0 / 0** | removed |
| Module scripts | 1 entry + 6 chunks | **0** | removed |
| Long tasks after first scroll (desktop) | 45 tasks · 7,826 ms | **0** | — |
| Main-thread task time after first scroll (desktop) | 8,054 ms | **130 ms** | −98 % |
| LCP, phone slow 4G | 880 ms | **464 ms** | −47 % |
| LCP, desktop (local) | 40 ms | 44 ms | same (local network) |
| CLS | 0.028 desktop after interaction (React mount swaps the DOM) | **0** | — |
| Worst interaction event (mode switch, menu open/close) | — (the old menu's click cost 2–20 s under software GL, per `playwright.config.ts`) | **56 ms desktop · 40 ms phone at 4× CPU** | — |
| Production build | `generate → assemble → vite (three) → …` | **8.2 s total**, no Vite step for the site | — |
| `npm install` | also installs three, R3F, drei, GSAP, Vite for `experiments/` | portal only | — |

The software-GL long-task number overstates what a real GPU would do, but the
structural facts don't depend on the GPU: there is no render loop, no canvas, no models,
no decoder and no framework.

**Not measured:** a Lighthouse run against the deployed site, and real devices.
Both should be done on the deploy preview before launch.

## 3. SEO regression

| Check | Result |
|---|---|
| `npm run audit:seo:check` | **0 failing**, 31 warnings: 27 `hreflang-noindex` + 4 `description-length`, all on other routes and present before. The homepage `<h1>` is now checked statically (it was deferred to a browser test before). |
| `npm run audit:ownership:check` | **no collisions**. The homepage still co-claims *weboldal készítés* (exempt, as before). |
| `npm run audit:conversion:check` | **0 integrity failures** (no broken / wrong-locale destinations, no conflicting primaries, no "full case study" promise). |
| `npm run fingerprint:check` | 99 pages, 0 unstamped |
| `npm run fonts:check` | every character covered |
| Titles / descriptions | **byte-identical** to the previous shells in HU, EN and DE |
| Canonical / hreflang / x-default / og:url | unchanged URLs (`/`, `/en/`, `/de/`), absolute, reciprocal — now produced by the same `build_social` / `build_alternates` as every other route |
| Sitemap | unchanged: 87 entries, homepage priority 1.0 / 0.5 |
| JSON-LD | one block; Organization, WebSite, WebPage unchanged. **The homepage FAQPage node is gone**, because the FAQ it described is gone (structured data may only describe what the page shows). `/kkv`, `/rolunk`, `/nagyvallalat` keep theirs. |
| URLs / redirects | no route added, renamed or removed; `.html` twin 301s untouched |
| Internal links from the homepage | every service page still linked with keyword anchors (capabilities rows); Győr / Budapest regional pages still linked (footer, HU) |
| Every other generated page | **byte-identical** output from `build.py` (the generator change only affects `index`) |
| Indexability | homepage `max-image-preview:large`, indexable, in sitemap |

## 4. Tests

| Run | Result |
|---|---|
| `npx playwright test` (all 9 projects, full repository suite) | **2,201 passed, 15 skipped, 3 failed.** The 3 failures were 90 s timeouts in `lead-forms.spec.ts` "the deployed bundle" (reads every text file in `dist/` off iCloud) during a run that overlapped a screenshot job. Re-run alone: **pass in 274 ms**. |
| Homepage-related specs after the last CSS change (`public-site`, `homepage-shell`, `structured-data`, `head-links`, `not-found`, `asset-packaging`, `seo-ownership`, `analytics`) | **373 passed, 9 skipped, 0 failed** |

Test changes: the five journey specs (`homepage-opening`, `-history`, `-modality`,
`-chrome`, `mobile-homepage-simple`) and `helpers/homepage.ts` asserted the WebGL ascent
and were removed. New: `tests/homepage-shell.spec.ts` (header, sheet focus/Escape/inert/
scroll-lock/breakpoint, footer contract, light/arrival guarantees, five viewport fit
checks, subpage deck smoke) and a rewritten homepage block in `public-site.spec.ts`
(static document — no canvas/WebGL/bundle/model requests; every scene and link in the
HTML with JavaScript off; no SME pricing language; GoDataFusion switcher; three locale
entry points; reduced motion holds nothing back). The two "hardening" projects
(desktop WebKit, portrait Chromium) now run the shell spec.

## 5. Visual QA

Stills in `shots/` for HU at **1440×900, 1728×1117, 375×812, 390×844, 430×932** (full
page + every scene) and EN/DE at 1440 and 390. Checked: hero, both takeovers, light
states, headline wrapping (the longest words — *összetéveszteni*, *unverwechselbar* —
fit at 375 px), rounded surfaces, navigation, CTA, clipping, sideways scroll, legibility,
card density.

Found and fixed during QA:
- **Sideways scroll of exactly 5 % of the viewport** (72 px at 1440, 19 px at 375): the
  light field's pseudo-element bled `-5 %` horizontally. Fixed in `system.css` (vertical
  bleed only, `overflow-x: clip` on the field and on `html`), and now asserted at five
  sizes × three languages.
- A principle could stay dimmed after a jump scroll that skipped its trigger band — the
  trigger is now "top passes 62 % of the viewport", so anything a jump lands above that
  line lights.
- Logo marks: square and vertical marks read as dots next to the wordmarks — one fixed
  box per mark now, so each finds its optical size.
- Sheet: no veil, a focus ring painted on the first link by a tap, label stayed "Menü" —
  all three fixed.
- Header wordmark now shares the left line of the content column at every width.
- Double scene padding between consecutive paper scenes (~440 px at 1440) halved.

**Creative kill test** (`shots/kill-*.png`): script blocked, every light primitive and
transition removed. The page keeps its structure and hierarchy — the composition, type
and work carry it.

Proportions measured from the DOM (share of page area): desktop **78 % light / 13 %
dark field / 8.5 % project imagery**; phone 84 / 10 / 5.5.

## 6. Accessibility / motion

- `prefers-reduced-motion`: every transition 0.01 ms, no pre-states ever applied (test).
- No information depends on motion or hover: capability sentences and links are always
  visible; hover only adds a surface.
- Focus: one visible ring (ink on paper, signal yellow on dark); the sheet moves focus
  into its navigation, makes the page behind `inert`, returns focus on close.
- Contrast: body text ≥ 6.3 : 1; the recessive heading tone (3.1 : 1) is used only at
  ≥ 28 px and only for the unlit state.
- Skip link, one `<h1>`, landmarks (`header`, `nav` ×2, `main`, `footer`), every image
  has `alt`, the GoDataFusion panels hide inactive images from assistive tech.

## 7. What changed, by file

**Added**
- `_build/pages/index.html` — the homepage, HU source (8 scenes).
- `_build/i18n/home.json` — EN/DE (DE in *Sie*); includes the three unchanged titles and
  descriptions.
- `assets/css/system.css` — the design system (tokens, type, surfaces, light, buttons,
  header, footer).
- `assets/css/home.css` — the homepage composition.
- `assets/js/shell.js` — header/sheet, light, arrival, one-active-surface (3.6 KB).
- `index.html`, `en/index.html`, `de/index.html` — generated output (tracked like every
  other generated page).
- `tests/homepage-shell.spec.ts`; reports `01`–`04`.

**Changed**
- `_build/build.py` — new `SHELL_V2`, `HEADER_V2`, `FOOTER_V2`, `render_v2`,
  `SHELL_V2_ROUTES = {"index"}`; removed the home-chrome bridge (`HOME_HEAD`,
  `HOME_SCRIPTS`, `home_meta`, `build_home_chrome`, `write_home_chrome`), the Ground
  statement and its FAQPage branch.
- `scripts/assemble.mjs` — inlines `type/system/home.css` into the three homepages
  (the old Vite build did the same, for the same cold-phone reason).
- `package.json` — `build` no longer runs `build:home`; `postinstall` / `typecheck` are
  portal-only; 24 experiments scripts removed.
- `netlify.toml` — `worker-src 'self'` (was `'self' blob:`, which existed only for the
  Draco decoder; pdf.js in the portal uses a same-origin worker, checked); removed the
  `/assets/home/*`, `/draco/*`, `/models/*` header blocks.
- `scripts/seo-audit.mjs` (homepage h1 checked statically), `seo-ownership.mjs`,
  `hermetic/gate-run.mjs` + `manifest.mjs` (no prototype build/suite), comments in
  `fingerprint-assets.mjs`, `llms-txt.mjs`, `route-matrix.mjs`.
- `assets/css/chrome.css` — removed the homepage-only `journey-home` rules (scroll
  reserve, anchoring) and the `.journey`/`.hud` menu rule; `type.css` comment.
- `playwright.config.ts`, `tests/public-site.spec.ts`, `tests/harness.spec.ts`.
- `README.md`, `ARCHITECTURE.md` — describe the homepage as it now is.
- `.claude/launch.json` — `site` (repo root) and `dist` static servers.

**Removed** (212 tracked files, all recoverable from git history / `main`)
- `experiments/` entirely — the React/three.js homepage, both prototypes, ~60 probe/
  bench/shot scripts, their tests and configs.
- `public/models/*` (920 KB GLBs), `public/draco/*` (764 KB decoder), `blender/mountains/`.
- `assets/js/home-history.js`, `_build/home-chrome.json`, `_build/missing-meridian-*.json`.
- `scripts/sync-draco.mjs`, `meridian-i18n.mjs`, `mobile-altimeter-review.mjs`.
- `playwright.{experiments,full,mountains}.config.ts`; the five journey specs and their
  helper; `scripts/hermetic/diagnostics/history-chain.spec.ts`.
- `ALTIMETER_MERIDIAN.md`, `FULL_ASCENT_PROTOTYPE.md`, `MERIDIAN_PERFORMANCE_AUDIT.md`,
  `PERFORMANCE_COMPARISON.md`, `CURRENT_HERO_NOTE.md`, `.meridian-*.mjs`.
- Not deleted: `experiments/screenshots/` (483 MB) and `experiments/bench-out/` were
  **never in git** (human-approved art-direction stills), so they were moved to
  `_backup/experiments-local/` rather than destroyed.

## 8. Behaviour changes to know about

- **Measurement**: the homepage now has body CTAs, so it emits `cta_view` / `cta_click`
  with placements `hero` and `closing`; the header action is a `.btn` and now fires
  `cta_click` (`chrome.bar.quote`) + `project_start_click` (the old `.nav__cta` fired
  nothing); case links fire `work_explore_click`. Expect homepage event volume to change
  in GA4 — it is more measurement, not a tracking fault.
- **Page transitions**: the homepage does not opt into the subpages' cross-document view
  transition (the "aperture" reveal belonged to the WebGL instrument), so home ↔ subpage
  is an ordinary navigation.
- **Visual discontinuity until Phase 4**: the homepage is light with the new header;
  every subpage is still dark with the flight deck and the altimeter rail. Expected for a
  proof of concept, but visible.

## 9. Open items and risks

1. **Copy is down 84 %, past the 50–70 % target** (see 03). Watch Search Console for the
   homepage's *weboldal készítés* co-ranking after launch.
2. **Lighthouse and real-device checks** on the deploy preview before launch.
3. **Phase 4 not started** (by instruction): subpages, forms, local SEO pages, the 404s
   and `header.js` / `chrome.css` / `main.js` / the altimeter rail stay as they are.
4. The Rapidkert takeover shows the client's Hungarian screen on EN/DE as well (the
   English capture `work-rapidkert.jpg` exists if a per-locale image is wanted).
5. The subpage header label is still "Árajánlat"; the homepage says "Projekt indítása".
   Same destination; unified in Phase 4.

## 10. Non-negotiables

| | |
|---|---|
| Altimeter removed from homepage | ✅ removed from the repository |
| No moving universe / background | ✅ static field; one load-time light-on |
| No mandatory homepage WebGL | ✅ 0 contexts, 0 canvases (tested) |
| Predominantly light | ✅ 78 % desktop / 84 % phone |
| Rounded geometry used hierarchically | ✅ 10 → 56 px scale; hero, silence, rows, principles have no container |
| Spotlight as a controlled signature | ✅ Soft Field, Blade reveal, Residual Glow, state change; no cursor following |
| Dramatically reduced homepage copy | ✅ −84 % (beyond target, see §9) |
| Typography can carry scenes alone | ✅ hero, silence, principles; kill test |
| Project work is the spectacle | ✅ two takeovers, Stratos chrome quiet |
| Rapidkert strongly featured | ✅ scene 02, near-full-viewport takeover, verified metric |
| GoDataFusion strongly featured | ✅ scene 04, different composition (split + one active surface) |
| KKV pricing narrative off the homepage | ✅ (tested) |
| Enterprise decision-maker prioritised | ✅ ledger: same team, code ownership, sprints, security/SLA |
| Small number of strong chapters | ✅ 8 (was 11 + Ground + Arrival) |
| Mobile authored separately | ✅ own hero height, takeover layout, GoDataFusion order, sheet |
| SEO architecture preserved | ✅ audits clean, titles/canonicals/hreflang/sitemap unchanged |
| EN/DE/HU ownership preserved | ✅ ownership check: no collisions |
| URLs preserved | ✅ |
| No generic SaaS card grid | ✅ |
| Performance materially improved | ✅ see §2 |
| Static screenshot quality | for your review — `shots/` |
