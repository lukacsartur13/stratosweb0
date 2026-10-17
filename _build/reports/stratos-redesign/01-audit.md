# Stratos redesign — 01 · Audit

Date: 2026-10-16 · Branch: `redesign/quiet-authority` · Scope: everything the homepage
touches, and everything that touches the homepage.

The point of this document is to know what can be removed without breaking anything
that matters, *before* anything is removed.

---

## 1. Architecture as it is

Two applications behind one domain (see `ARCHITECTURE.md`), and the homepage is a
**third** thing wedged between them.

| Surface | How it is made | Output |
|---|---|---|
| 66 public routes | `_build/build.py` renders HU fragments (`_build/pages/*.html`) and translates them by dictionary (`_build/i18n/*.json`, `"hu": ["en", "de"]`) | `*.html`, `en/*.html`, `de/*.html` in the repo root |
| **Homepage** `/ /en/ /de/` | **A React 18 + three.js + R3F + drei + GSAP app** in `experiments/src/full/`, built by `experiments/vite.home.config.ts` from three hand-written shells (`experiments/home/{hu,en,de}.html`). Header, footer and the "Ground" statement are rendered by build.py into `_build/home-chrome.json` and substituted into the shells | `dist/index.html`, `dist/en/index.html`, `dist/de/index.html` + `dist/assets/home/*` + `dist/models`, `dist/draco` (copied from `public/`) |
| Portal `/portal/*` | React/Vite SPA | `dist/portal` |

Build chain: `generate (build.py) → build:site (assemble.mjs) → build:home (Vite) →
llms → build:portal → strip:comments → fingerprint → fonts:check`.
`postinstall` also runs `npm ci` inside `experiments/` (three, fiber, drei, gsap) on
every install, including every Netlify build.

### Source of truth
- **Routes**: `SLUGS` in build.py (38–79), emitted as `_build/routes.json`. The homepage
  key is `index`; `HOME_PATH` = `/`, `/en/`, `/de/`.
- **Homepage copy**: *not* in the site's i18n system. It lives in
  `experiments/src/full/locales/{messages,en,de}.ts` and `content.ts`, plus the Ground
  copy in `GROUND_COPY` (build.py 2667–2925). Three copies of the homepage's words:
  the React compositions, `staticJourney.ts` (a third rendering for crawlers), and
  Ground.
- **Homepage `<head>`**: hand-written in the three shells; build.py reads title and
  description *back out* of them (`home_meta()`, 2582) for the JSON-LD.

## 2. The homepage today

### Chapters (HU; static narrative order)
| # | Stage | Heading | Words (narrative) |
|---|---|---|---|
| I | Kalibráció, 0 m | H1 "Nem weboldalakat építünk. Magasságot építünk." + locator "Stratos · Weboldal készítés és digitális ügynökség" | 40 (opening frame) |
| II | Emelkedés | "Egy weboldal önmagában nem visz sehova." | 76 |
| III | Alsó légkör | "Hat terület, egy rendszer." (6-step ladder with altitudes) | 96 |
| IV | Felhőréteg | "Idelent minden zajos." | 64 |
| V | Áttörés | "A tisztaság ott kezdődik…" | 28 |
| VI | Munkáink | "Akikkel együtt emelkedtünk." — 6 marks + Rapidkert featured case (~110M Ft) | 96 |
| VII | A rendszer | "Kilenc terület, három rétegben." (3 rings, 9 nodes) | 156 |
| VIII | A folyamat | "Hét ellenőrzőpont…" (7 checkpoints × 4 fields) | 321 |
| IX | Átmenet | "Innen már látni a görbületet." | 50 |
| X | Sztratoszféra | "Üdv a sztratoszférában." | 27 |
| XI | Célmagasság | "Készen állsz felemelkedni?" + stage index | 83 |
| — | Ground (build.py) | "Weboldal készítés Győrben és Budapesten" + 6 services + why/how/where/who + 6-item FAQ (pricing) | 707 |
| — | Arrival + footer | "EMELKEDÉS BEFEJEZVE · 30 000 M" … | ~190 |

**Totals (built HTML, body text):** HU 1,935 words · EN 2,390 · DE 2,152.
Eleven chapters, three of them pure atmosphere (IV, IX, X), two of them process
diagrams (VII, VIII), and the KKV pricing argument ("Miért egyszeri projektdíjjal?",
"Mennyibe kerül egy weboldal készítés?") inside Ground.

GoDataFusion: **absent from the homepage entirely.**

### Rapidkert proof, as the site already states it
`~110M Ft` — *Ajánlatkérési érték organikus keresésből* (value of quote requests received
from organic search, no ad spend behind it); separately `~9M Ft` brought in by Google Ads
on ~201E Ft spend (2025-12-01 – 2026-04-30). Source and the "never summed, not revenue"
rule: `_build/pages/munka-rapidkert.html` 26–60 and `_build/i18n/rapidkert.json` 24–27.
EN "~110M HUF / Quote requests from organic search"; DE "~110 Mio. HUF / Angebotsanfragen
aus der organischen Suche". Plus a verifiable Awwwards Honorable Mention.

## 3. Visual runtime and its cost

### What runs
- `main.tsx` arms six input events; the first one `import('./boot')` (React + both
  compositions, 275 KB) and mounts, **replacing** the static text.
- **Idle prefetch even with no interaction**: after `load` + 2 s + idle, the boot chunk
  plus the renderer (Gltf/three chunk 897 KB) are prefetched — on phones too, unless
  Save-Data / 2G.
- Desktop: `FullAscent` → WebGL probe → `JourneyScene`: sticky full-viewport
  `<Canvas frameloop="always">`, ~15 `useFrame` subscribers, drei Environment,
  PerformanceMonitor, two Draco-compressed mountain GLBs decoded in a worker, the
  altimeter GLB; GSAP ScrollTrigger drives the scroll. `JourneyHUD` runs a **permanent
  rAF loop**, even on the no-WebGL fallback.
- Phone: `MobileHome` → `MobileInstrument` canvas (`frameloop="demand"`) + the 397 KB
  altimeter GLB.
- `home-history.js` (sync in `<head>`) exists only because the page grows after the React
  mount.
- Header: `header.js` exposes `Stratos.header.push()` so the journey can drive the
  header's altitude read-out.

### Measured (cold cache, this machine, `scratchpad/perf.mjs`, headless Chromium)
| | Desktop 1440 | Phone 390 (4× CPU, slow 4G) |
|---|---|---|
| Requests before interaction (load + 10 s) | 27 | 26 |
| JS before interaction | **1,386 KB raw / 408 KB gz** (idle prefetch) | 1,218 KB / 351 KB gz |
| Images before interaction | 819 KB (logos in the static narrative incl. a 368 KB 1800² PNG) | 587 KB |
| After first scroll: JS | **2,014 KB raw / 561 KB gz** | (still downloading at +8 s) |
| After first scroll: GLB | 743 KB (altimeter + mountains) + Draco decoder | 397 KB altimeter |
| WebGL contexts / canvases | **2 / 1** | **2 / 1** |
| Long tasks after first scroll | **45 tasks, 7.8 s** (software GL) | 0 (still loading) |
| Main-thread task time | 8.1 s | 0.6 s |
| HTML | 96 KB raw / 25.6 KB gz (55 KB is four inlined stylesheets) | same |
| LCP | 40 ms (local) | 880 ms |
| CLS | 0.028 after interaction (mount swaps the DOM) | 0.007 |

Headless Chromium renders WebGL in software, so the long-task figure overstates a real
GPU — but the *shape* is the problem the brief describes: a continuous render loop for
the whole page, ~1.7 MB of models and decoder, and 1.4–2 MB of JS that a visitor
downloads whether or not they ever scroll.

## 4. Performance offenders (ranked)
1. three.js / R3F / drei chunk (897 KB) + JourneyScene (173 KB) + GSAP (115 KB).
2. Continuous rAF + `frameloop="always"` canvas for the entire journey.
3. GLBs (920 KB) + Draco JS decoder (512 KB) — and a CSP widening (`worker-src blob:`)
   that exists only for that decoder.
4. React (in boot, 275 KB) to render what is otherwise static text.
5. Idle prefetch of all of the above on phones.
6. Un-sized, non-lazy logo PNGs in the static narrative (Barbershop 1800×1800, 368 KB).
7. 55 KB of CSS inlined into every homepage document.

## 5. WebGL / Altimeter dependency map — what dies with it

| Area | Items | Notes |
|---|---|---|
| Homepage app | `experiments/` entirely (`src/full`, `home/*`, `vite.home.config.ts`, `vite.full.config.ts`, prototypes, ~60 probe/bench/shot scripts, its own `node_modules`) | `src/full` is shared with the noindex prototypes and their Playwright configs, so it can only go as a whole |
| Assets | `public/models/*` (920 KB), `public/draco/*` (764 KB) | reach dist only through Vite's `publicDir` |
| build.py | `HOME_HEAD`, `HOME_SCRIPTS`, `HOME_SHELLS`, `home_meta()`, `build_home_chrome()`, `write_home_chrome()`, `_build/home-chrome.json`, the Ground FAQ branch of the homepage JSON-LD | |
| assets/js | `home-history.js` (homepage only) | `header.js` `push/release` API becomes unused (left for Phase 4, when header.js is replaced) |
| netlify.toml | `worker-src 'self' blob:` (+ its justification), `/assets/home/*`, `/draco/*`, `/models/*`, `/models/*.glb` header blocks | `style-src 'unsafe-inline'` stays (inline `style` attributes remain on subpages) |
| scripts | `sync-draco.mjs`, `meridian-i18n.mjs`, `mobile-altimeter-review.mjs`; `_build/missing-meridian-*.json`; package scripts `build:home`, `dev:home`, `i18n:meridian`, `draco:*`, `test:full`, `test:mountains`, `validate:*`, `bench*`, `shots:*`, the experiments half of `typecheck` and `postinstall` | |
| tests | `homepage-opening`, `homepage-history`, `homepage-modality`, `mobile-homepage-simple`, most of `homepage-chrome`, the homepage block of `public-site`, `harness` frame-rate test, `tests/helpers/homepage.ts`, `playwright.full/experiments/mountains` configs | all assert the journey (HUD, altitude, stages, canvas) |
| docs | `ALTIMETER_MERIDIAN.md`, `FULL_ASCENT_PROTOTYPE.md`, `MERIDIAN_PERFORMANCE_AUDIT.md`, `PERFORMANCE_COMPARISON.md`, `CURRENT_HERO_NOTE.md` | describe the removed system |

**Not** part of the homepage runtime and therefore untouched in this phase: the altimeter
*rail* and contrail cursor on the 66 subpages (`main.js`, `main.css`, `RAIL`), the
flight-deck header (`header.js`, `chrome.css`), `motion.js`. They belong to the global
shell and move in Phase 4.

## 6. Global UI primitives today
- Header `DECK` (build.py 1290): logo, an **altitude read-out** (`.nav__alt`), "Árajánlat"
  button, burger → full-screen menu with six numbered destinations and a services column
  that prints an altitude per service ("1 200 M").
- Footer `FOOTER` (1948): "Arrival" (trace SVG, "KALIBRÁCIÓ KÉSZ · 30 000 M", kinetic
  H2, two buttons) + five-column ground-control footer with the newsletter form,
  NAP, socials, status, "VISSZA 0 MÉTERRE".
- `.btn` / `.btn--ghost` / `.skip` are defined twice (main.css and the journey CSS).
- Type: Archivo variable (wght 100–900, wdth 62–125), JetBrains Mono for every label,
  Aboreto for the wordmark. Uppercase mono micro-labels appear on nearly every element.
- Palette: `#000` void, `#FFEE25` signal, `#F4F4F4` paper. The site is ~95% dark.

## 7. SEO-critical dependencies (must survive)
| Thing | Where | Rule for the redesign |
|---|---|---|
| Titles & descriptions | shells today | **Unchanged, byte for byte**, in all three languages (HU "Weboldal készítés és fejlesztés \| Stratos"; EN "Web Development & Web Design Agency in Győr \| Stratos"; DE "Webdesign und Entwicklung \| Stratos") |
| Canonical / hreflang / x-default | shells → must equal `absolute('index')` | `/`, `/en/`, `/de/`, absolute, reciprocal |
| OG / Twitter | shells | same image (`og-stratos.jpg`), same alt |
| JSON-LD | `build_structured_data` | one block; WebPage name/description = title/description (`tests/structured-data.spec.ts`); Organization/WebSite unchanged. The homepage FAQPage is built from the Ground FAQ — it must go if the FAQ leaves the page |
| One non-empty `<h1>` | `seo-audit.mjs` 281 | now checkable statically |
| Keyword ownership | `seo-ownership.mjs` | the homepage is scanned but exempt; **no chrome heading may contain a head term**, or every HU page becomes a claimant |
| Sitemap | `assemble.mjs` from `routes.json` | homepage priority 1.0 / 0.5 — untouched |
| Internal links | Ground links every service with keyword anchors; footer links local pages (HU) | keep keyword-anchored links to every service from the homepage, keep the Győr/Budapest local links |
| `.html` twin redirects | `_redirects`, netlify.toml | untouched |
| llms.txt | reads `dist/index.html` description | keep a meta description |

## 8. Analytics / forms / tracking (must survive)
- `analytics.js` is class-based: a CTA is an `<a>` whose class matches
  `btn|cta|button`; zone = header/nav/footer/`.menu` (chrome) · `.arrival` · body.
  Body CTAs also fire `cta_view` and read `data-cta-placement`.
  `project_start_click` / `work_explore_click` are derived from the destination.
- `navigation_open/close` observes the first `[aria-controls][aria-expanded]`.
- `locale_change` fires for links inside `header` or `.menu`.
- Footer newsletter `form[data-lead="newsletter"]` + `.hp` honeypot → `lead.js` →
  `POST /api/lead`; form events `form_view … form_submit_success`.
- `consent.js` un-hides `[data-consent-settings]` in the footer.
- `conversion-audit.mjs --check`: a `.btn` must point at a file that exists in dist
  (`/arajanlat.html`, not `/arajanlat`); no two solid buttons to one target in a
  `.btn-row`.

## 9. Content that should move off the homepage — and where it already lives
| Block | Already lives at |
|---|---|
| KKV one-off pricing, "why no monthly fee", pricing FAQ | `/kkv`, `/blog-weboldal-arak`, `/rolunk` FAQ |
| Six/nine service areas, rings, ladder | `/szolgaltatasok` and each service page |
| Seven-checkpoint process | `/nagyvallalat` ("Így dolgozunk"), `/kkv` |
| Where we work (Győr / Budapest / regions) | `/hol-dolgozunk` + four regional pages; footer keeps the links |
| Who we work with | `/munkaink`, `/rolunk` |
| Atmosphere chapters (IV, V, IX, X) | nowhere — they carried the altitude metaphor only |

## 10. Decision for Phase 3

The homepage becomes **an ordinary generated route**: `_build/pages/index.html` (HU source)
+ `_build/i18n/home.json` (EN/DE), rendered by build.py with its own shell and the new
system stylesheet. That puts its words back into the one translation pipeline the other
66 routes use, makes every word static HTML, and removes React, three.js, GSAP, the
models and the decoder from production. The new header and footer are generated by the
same script from the same slug table; in this phase only the homepage uses them (the
66 subpages keep the current shell until the homepage direction is approved —
Phase 4).
