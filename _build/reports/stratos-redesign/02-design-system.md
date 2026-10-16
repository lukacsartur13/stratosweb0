# Stratos redesign — 02 · Design system ("Soft Machinery")

> **Build a mostly light, typography-led digital product studio site where soft
> rounded surfaces and controlled spotlight lighting frame exceptional work, while
> movement and interface disappear whenever they are not necessary.**

Source of truth: `assets/css/system.css` (system) and `assets/css/home.css` (the first
composition built on it). Behaviour: `assets/js/shell.js` (3.6 KB minified, 1.3 KB
gzip, no dependencies). Markup: `HEADER_V2`, `FOOTER_V2`, `SHELL_V2` in `_build/build.py`.

Tokens are namespaced (`--c-` colour, `--t-` type, `--r-` radius, `--sp-` space) so the new
system can be linked beside the old `chrome.css`/`main.css` during the Phase 4 migration
without either reaching into the other.

---

## 1. Colour

| Token | Value | Use | Contrast on `--c-bg` |
|---|---|---|---|
| `--c-bg` | `#F3F2EE` | warm paper — the default field | — |
| `--c-bg-recess` | `#EAE9E4` | a tonal step down | — |
| `--c-surface` | `#FAFAF8` | a tonal step up (raised surfaces, inputs) | — |
| `--c-ink` | `#141413` | type, primary button | **16.5 : 1** |
| `--c-ink-2` | `#5A5954` | secondary text, body copy | **6.3 : 1** |
| `--c-ink-3` | `#8A8983` | *recessive* — unlit headings only, ≥ 24 px | 3.1 : 1 (large text) |
| `--c-line` / `--c-line-strong` | ink at 10 % / 18 % | hairlines | — |
| `--c-dark` / `--c-dark-2` | `#1B1B1A` / `#242422` | graphite — the Stratos dark field | — |
| `--c-on-dark` / `-2` / `-3` | `#EEEDE8` / `#A9A8A2` / `#77766F` | type on graphite | 14.7 / 7.2 / 3.8 : 1 |
| `--c-signal` | `#FFEE25` | brand yellow — **three jobs only**: `::selection`, the focus ring on dark, one beacon in the closing scene | 1.07 : 1 on paper → never text, never a fill under light-surface type |

Project worlds bring their own colour and nobody else may use it: Rapidkert soil
`#17140F` + cream `#EEEAE0`/`#B4AC9C`; GoDataFusion screen `#090A0C` and its three mode
colours (teal `#34C6D3`, green `#8FD14F`, red `#EE5A3A`) — the latter appear only as the
active mode's dot.

**Measured split on the homepage** (share of page area, `scratchpad/split.mjs`):
desktop 1440 — **78 % paper, 13 % dark field** (Rapidkert surface, closing scene),
**8.5 % project imagery**; phone 390 — 84 % / 10 % / 5.5 %. Brief target: 70–80 / 15–20
/ 5–10.

## 2. Typography

Archivo (variable: wght 100–900, wdth 62–125), self-hosted, already preloaded. Aboreto
only for the wordmark. **JetBrains Mono is not used by the new system at all** — the
uppercase-mono label vocabulary was the HUD language the brief retires.

Three roles, nothing between them:

| Role | Token | Size (375 → 1728 px) | Settings |
|---|---|---|---|
| **Monument** | `--t-monument` | 40 → 120 px | wght 520, wdth 94 %, tracking −0.038em, leading 0.98, sentence case |
| | `--t-statement` | 34 → 84 px | same family, leading 1.02 |
| **Editorial** | `--t-title` | 28 → 52 px | wght 520, tracking −0.025em |
| | `--t-lead` | 18 → 22 px | ink-2, leading 1.45 |
| | `--t-body` / `--t-small` | 17 / 15 px | ink-2, leading 1.55 |
| **Micro** | `--t-micro` | 13 px | wght 520, +0.01em, **sentence case**, ink-2. Rare by rule: a project name above its scene, a section name above a list. |

Width 94 % on Monument is what lets "összetéveszteni." and "unverwechselbar" sit on one
375 px line at 40 px without dropping a size. Line breaks in statements are authored
(`<br>` in the source and in each translation), not left to the browser.

## 3. Space and layout

4 px base (`--sp-1` … `--sp-11`), one scene rhythm `--sp-scene` (96 → 208 px).
Gutter `--gutter` 16 → 48 px; content max 1360 px; takeover surfaces max 1680 px with an
8–24 px frame. Phones are authored, not compressed: own hero height, own takeover
(no fixed height, full-bleed screen), own mode list, single-column rows.

## 4. Radius — hierarchy, not fashion

| Token | Desktop | ≤ 640 px | Used for |
|---|---|---|---|
| `--r-xs` | 10 | 10 | nav-link hover field, language chips |
| `--r-sm` | 14 | 14 | buttons |
| — | 16 / 14 | — | the header box |
| `--r-md` | 20 | 20 | inputs, the framed screen inside a takeover |
| `--r-lg` | 28 | 22 | capability-row surface, phone project surfaces |
| `--r-xl` | 40 | 26 | the GoDataFusion screen |
| `--r-display` | 56 | 28 | full takeovers (Rapidkert, closing scene) |

Pill radius only for semantic tags (`.tag`: "Awwwards Honorable Mention"). The hero, the
silence scene, the capabilities, the principles and the marks have **no container at all**.

## 5. Surfaces

Precision-machined, not carded: tone + an inset 1 px hairline + one inner top highlight.
`.surface`, `.surface--recess`, `.surface--dark`, `.surface--display`. The only drop
shadows in the system: the header once scrolled (soft, 28 px) and a faint ambient under
the GoDataFusion screen.

## 6. Light — "light follows importance, not the cursor"

| Behaviour | Class | Where | What it does |
|---|---|---|---|
| **Soft Field** | `.light-field` | hero, silence, closing scene | a static diffused bloom (`--lx/--ly` place it). On paper it is a tonal lift; on graphite a warm 7 % glow. |
| **Blade Light** | `.take__shot` reveal | Rapidkert only | the screen opens from a horizontal slit (`clip-path` 46 % → 0) while brightening from 0.55 → 1, once, 1.3 s |
| **Residual Glow** | `.light-residual` | Rapidkert surface | stationary warm light at the surface's top edge |
| **State change** | `[data-light]` + `.lit` | silence statement, principles | recessive (ink-3) → present (ink) once the element's top passes ~62 % of the viewport |

No cursor following, no loops, no neon, no scanning sweep. Hero: the field and the words
come up once at load (1.4–1.8 s), and that is the only load animation on the page.

**Contract (important):** the static default is always the *lit* state. `shell.js` adds
`.is-dim` / `.is-pre` only to elements that are below the fold when it runs, and removes
them when they are read. No script, a failed script, reduced motion, a crawler → the
finished composition.

## 7. Motion

| Token | Value | Use |
|---|---|---|
| `--dur-ui` | 180 ms | colour, hover |
| `--dur-state` | 360 ms | surfaces, sheet, mode switch |
| `--dur-reveal` | 720 ms | arrival (opacity + 14 px or scale 0.98 → 1) |
| `--dur-light` | 1100 ms | light state changes |
| `--ease-out` | `cubic-bezier(.2,.7,.1,1)` | things arriving |
| `--ease-std` | `cubic-bezier(.4,0,.2,1)` | state changes |

Allowed: fade, small translation, scale .98 → 1, controlled crop, light state change,
cross-fade. Not used anywhere: per-letter reveal, scroll-scrubbed transforms, parallax,
springs, magnetic buttons, marquee, moving backgrounds. `prefers-reduced-motion`
collapses every transition to 0.01 ms and never applies a pre-state.

## 8. Buttons and links

* **Primary** `.btn`: 50 px tall, 14 px radius, ink on paper (`.btn--light` on graphite),
  one label, optional 16 px arrow that moves 2 px on hover. `.btn--sm` (40 px, 12 px
  radius) for the header and the footer form only.
* **Secondary** `.link`: text + arrow, underline on hover.
* Nothing else. No ghost buttons, no pills, no glow.

## 9. Header

Floating rounded box (16 px radius, 56 px tall, 12 px from the top; 14 px/52/8 on phones),
translucent paper with an 18 px backdrop blur and a hairline. **Stable**: it never hides,
shrinks or bounces; once the page moves it gains a soft shadow.

* ≥ 961 px: wordmark · Work / Capabilities / About / Insights (HU: Munkáink ·
  Szolgáltatások · Rólunk · Blog; DE: Projekte · Leistungen · Über uns · Insights) ·
  HU/EN/DE · **Projekt indítása**.
* ≤ 960 px: wordmark · Menü. The sheet opens *inside the same box* over a blurred veil:
  the four destinations + Kapcsolat, the full service list, languages and the action.
  Focus moves into the navigation, the page behind is `inert` and scroll-locked, Escape /
  veil tap / growing past the breakpoint close it, focus returns to the trigger.
* No route is removed; the service pages remain reachable from the sheet, the footer and
  the homepage's capabilities.

## 10. Footer

Light and quiet. Wordmark + one line; the newsletter form (unchanged contract:
`data-lead="newsletter"`, honeypot, `.form__note` status); four columns (pages,
services incl. HU local pages, contact + NAP + status, profiles); legal line with the
consent switch, language switcher and GDPR mark. No Arrival, no trace, no ceiling, no
"return to 0 m".

## 11. Quality tests every scene is held to

* **Static screenshot** — the kill-test stills (`shots/kill-*.png`) are JavaScript off,
  every light and transition removed.
* **Removal** — would removing one element make it stronger? (Applied: hero has no image,
  silence has no graphic, marks have no carousel.)
* **Executive** — would a decision-maker take it seriously in 20–30 seconds?
* **Template** — three-column card grids: none on the page. Capabilities are rows of
  type; principles are an editorial sequence; GoDataFusion is one active surface.
* **Stratos** — authored statements, the soil takeover, the slit reveal, the beacon.
