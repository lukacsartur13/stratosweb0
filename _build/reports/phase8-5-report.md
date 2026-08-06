# Phase 8.5 — report

Motion, spatial art direction, active navigation, the Arrival footer and
controlled work proof. Written against the frozen source at the end of the
phase. The baseline it is measured from is `_build/reports/phase8-5-baseline.md`,
recorded at `0c769ac` before any edit.

---

## 1. Baseline and what moved

| | baseline `0c769ac` | now | delta |
|---|---:|---:|---|
| public routes | 66 | **66** | 0 |
| visible words (all 66 routes) | 50,629 | **55,139** | **+4,510** |
| sections (inventory) | 381 | 453 | +72 |
| CTAs (inventory) | 99 | 225 | +126 |
| forms | 9 | 9 | 0 |
| sitemap URLs | 69 | 60 | −9 (case studies, §9.5) |
| routes carrying `noindex` | 0 | 9 | +9 (case studies) |
| broken internal links | 0 | **0** | 0 |

"Visible words" is every word a reader can see on the 66 tracked HTML routes,
counted by stripping tags from the committed output and comparing against the
same measurement at the baseline commit. It is the number that answers §33,
because the content inventory's own figure moves for reasons that are not
content — see §12 of this report.

### Words not carried forward

Every one of the 66 routes gained words. Three groups did not carry forward,
and all three are deliberate:

1. **Navigation labels, all 66 routes** — `Árajánlat` / `KKV` / `Nagyvállalat` /
   `Hirdetés`, `Get quote` / `SME` / `Enterprise`, `Angebot` / `Konzerne` /
   `Werbung` / `Impact`. The flight-deck header and the Arrival footer name the
   same destinations differently. No destination lost a link.
2. **`Esettanulmány` / `Case study` / `Fallstudie`** — the related-link chip and
   the Work index meta label, now `Projekt` / `Project`. Required by §9.5: a
   `summary` route may not be labelled a case study.
3. **The Pille Sewing entry on the Work index** — ~16 words × 3 locales, plus
   its logo and its homepage case-study record. See §7 below. **This is the only
   editorial removal in the phase and it is flagged for approval.**

---

## 2. Motion architecture

No framework and no GSAP. GSAP is a dependency of `experiments/` and ships
inside the homepage bundle; adding it to the shared layer would put a
third-party runtime on 66 routes that currently have none, which §28 forbids.
Everything is CSS transforms, SVG geometry, the Web Animations API and one
IntersectionObserver.

Every primitive is a pure function of one number: how far its element has
travelled through its own scroll range, 0 to 1. Nothing integrates velocity and
nothing remembers direction, so every sequence is exactly reversible.

One shared rAF driver runs only while at least one registered element is on
screen and stops dead otherwise. Each registration is torn down on `pagehide`,
so the Phase 7 cross-document transitions never inherit a live loop.

### The bug under all of it

`position: sticky` did not work anywhere on this site, and had not before this
phase began. `<html>` was correctly `overflow-x: clip`, with a comment saying
`hidden` would break the pins — and `<body>` was still `overflow-x: hidden`.
`hidden` makes an element a scroll container, and a scroll container is the
scrollport its sticky descendants stick inside. Body's height is the document's
height, so it never scrolls within itself and there was nothing to stick to.

Every pinned sequence laid out perfectly and then travelled off the top of the
screen with the rest of the page. It was invisible because a pin that fails
still looks like a section — the services rail was shipped in one commit and
photographed looking plausible before this was found. Both are `clip` now, and
all 66 routes still report zero horizontal overflow at 12 viewports.

---

## 3. The Meridian Trace

One hairline, one weight, one colour everywhere: the Meridian is a measuring
instrument and instruments do not change their line weight per page. What
changes per page is the path, and the path is authored in each page's markup
because the shape is the argument that page is making.

| route | what the Trace is |
|---|---|
| services overview | a trunk branching into four services |
| web design (SME, enterprise) | not a line — a browser window and a system diagram |
| advertising | a signal arriving in segments and resolving into one path |
| branding | the type's own width and weight axes |
| about | four strands braided and released |
| impact | a route with four stations |
| contact | one line dividing once into two decisions |
| questionnaire | a flight path, one station per question |
| blog index | numbered stations, image raised per row |
| footer | convergence to a node above the closing question |

Every decorative Trace is `aria-hidden="true"` and `focusable="false"`. Each one
repeats an argument the page also states in text, which is what makes hiding it
safe rather than lossy.

---

## 4. Primitives

`assets/js/motion.js` (16,514 B / 6,256 B gz), `assets/css/motion.css`
(12,166 B / 3,996 B gz). All eleven §5 primitives exist. Those actually used by
a shipped route:

| primitive | used on |
|---|---|
| TraceLine | services, advertising, about, impact, contact, footer |
| StickyStage | web design SME, web design enterprise |
| HorizontalRail | services overview |
| DepthGallery | web design SME, web design enterprise |
| MaskReveal | web design SME (proof crop) |
| KineticType | branding |
| CTAConvergence | services overview |
| LogoSignalRail | work index |
| LogoConstellation | about, services overview |
| MetricTrace | **nowhere** — no verified metric exists to reveal |
| LogoIndex | **nowhere** — only two marks are publishable |

MetricTrace shipping unused is deliberate and is the mechanism working: it can
only reveal a number an author wrote into the markup, and no verified number
exists. §13's measurement section is process and decision logic, with no chart.

### An IntersectionObserver detail worth keeping

An IntersectionObserver reports threshold *crossings*, not positions. An anchor
jump or a restored scroll position can take an element from "below the viewport,
ratio 0" to "above it, ratio 0" without ever firing, leaving that section on its
first frame forever — an undrawn trace, a closed mask, a stage stuck on 1 of 3.
One full sweep on `scrollend` fixes it and costs nothing while scrolling.

---

## 5. Header, menu and footer

**Three states over one monotonic number**, with hysteresis at the boundaries:
opening (wordmark, full navigation, transparent), journey (compact mark,
altitude, ~50px), destination (navigation returns, Start Project comes forward).
What it replaced read the *sign* of the scroll delta and hid the header when it
was negative, so a trackpad's micro-reversals made it flicker while you were
simply reading. The same scroll position now always gives the same header.

The homepage is a separate React/WebGL bundle whose progress is not document
scroll, so `Stratos.header.drive(fn)` lets it supply the real number.

**Fixed during this phase:** the destination-state CTA was cutting its own label
in half. `max-width: 22ch` resolves to 169px, but `ch` is the width of a zero
and knows nothing about .13em of tracking on every character — the longest
label, `Projekt indítása`, needs 187px. It was also the most compressible item
in a flex row and was being squeezed to 96px on top of that. Now 26ch and
`flex: 0 0 auto`; verified unclipped in all three locales at 1920, 1440, 1366,
1280 and 1081.

**The navigation layer** is full-viewport, six numbered destinations plus the
service architecture, every one a plain anchor — middle-click, ctrl-click and
the back button behave normally. It has a focus trap that includes the trigger,
focus restoration, a dismissable veil, and an iOS-safe scroll lock
(`position: fixed`, not `overflow: hidden`, which Safari ignores on body).
Verified: 40 tabs never escape the layer, ESC closes, focus returns to the
trigger.

**The footer** is three movements: the page's trace converges to a node, the
page asks its own closing question, then the information grid. The headline is
archetype-specific, so a service page asks a service question and an article
asks an article question. The Status group states only what the site already
says elsewhere — the reply expectation is the Contact page's own sentence, the
location is the one in the site description, the languages are the three
locales this build emits. Nothing there is a new availability claim.

---

## 6. Work, case-study status and project images

### The status model

`_build/build.py:CASE_STATUS` — `draft` / `summary` / `full`. What separates them
is what a route may *claim*.

The three projects each carry a section headed "result figures are deliberately
absent". Publishing them under `full` route rules — sitemap entry, indexable
metadata, the shared Work→Case transition, a chip reading "Case study" — was the
site asserting a maturity its own copy denies. All three are `summary`:

* reachable, linked from the Work index and translated;
* `noindex, follow` — `follow` keeps the outbound equity, `noindex` keeps the
  claim honest;
* out of the sitemap, because a sitemap entry for a noindex URL is a
  contradiction the crawler has to resolve;
* no shared Work→Case transition, gated at build time from `data-case` rather
  than by deleting the attribute, so the wiring stays visible while switched off.

Nothing was deleted. All nine routes keep their content and their hreflang set.
Promoting one is a one-word edit that moves its robots tag, its sitemap entry
and its transition together.

### Image restraint (§9.4)

| viewport | Work index project image | §9.4 |
|---|---|---|
| 1440×900 | 38.0vw / 45.6vh | 34–42vw ✓ |
| 1024×768 | 36.9vw | ✓ |
| 844×390 | 33.9vw / 55vh | ✓ (the 55vh cap biting) |
| 390×844 | 89.7vw | 85–92vw ✓ |
| 360×800 | 88.9vw | ✓ |
| 820×1180 | 92.0vw | ✓ |

Baseline was **58vw**. The media column is now the narrower of the two rather
than an equal half, mirrored on alternating rows so `order` cannot hand it the
wide track every second card.

On the service pages, three full-height screenshots became a text-led index —
name, scope, link — with one restrained crop bounded by `.proofshot` at 38vw and
52svh. Nothing was removed: all three projects are still named and still linked.

---

## 7. Logos, organisations and relationship wording

One table (`_build/build.py:ORGS`) owns every organisation's name, its artwork
and what may be said about it. Nothing renders unless `ready` is true. A missing
or unpublishable mark produces **no markup at all** — not a box, not a name in a
border, not a grey rectangle.

### Publishable: 2 of 7

| organisation | asset | where it appears | why there |
|---|---|---|---|
| Kontyos.hu | `assets/img/logo-kontyos.webp` (436×107, WebP VP8X, transparent) | Work index rail, About constellation, Services constellation | §10.6: a collaboration signal on the two reference destinations and the capability map |
| Grantool Kft. | `assets/img/logo-grantool.png` (800×500, stacked lockup, `--optical: 1.75`) | same three | same |

Relationship wording is **"Kiválasztott együttműködések" / "Selected
collaborations" / "Ausgewählte Kooperationen"** — identical for both, claiming
association and nothing more. It specifically does not claim partnership,
endorsement, sponsorship or a commercial engagement, because nothing in this
repository establishes which of these are clients and which are not.

Normalisation is by optical height and padding only: `width: auto`,
`object-fit: contain`, no stretching, no cropping, no forced identical widths.

### Blocked: 5 of 7 — production blockers

| organisation | blocker |
|---|---|
| **Synergy Digital Hungary Kft.** | Two files, neither publishable. The raster export has a baked white background (0% alpha) behind a white wordmark — a white box on the void, invisible on white. The vector at `../Synergy Digital/img/logo.svg` is transparent and correctly coloured, **but its wordmark is 14 live `<text>` elements** set in `'Yu Gothic UI', Segoe UI Light, Avenir Next, Helvetica Neue, Arial`. The letterforms are resolved by whatever font the reader's machine has, so the mark changes shape between visitors. That is a logo reconstructed from text, which §10.4 forbids. **Needs the official artwork with the wordmark converted to outlines.** |
| **Duna Hajók** | Supplied file is 225×225 with a baked white background and no transparency; the mark itself is ~150px wide, below what the rail renders at on a 2× screen. |
| **Duna Enterior** | Artwork is transparent but entirely black (mean luminance 13/255), invisible on the void. Needs a reversed or single-colour light variant. |
| **HAIO** | No asset, and nothing in this repository establishes Stratos's role in the ELTE AI competition. §10.3 requires that role described accurately, so it cannot appear at all until confirmed. **HAIO is not presented as a company anywhere.** |
| **FICE** | No asset and no relationship evidence. |

**No placeholder ships for any of the five.**

### Uncensored Society (§10.1)

Zero current-facing appearances, before and after. It was never on a shipped
route. One reference existed in the private portal — an empty-state hint string
in `portal/src/pages/screens.tsx` — and it is gone. Three documentation mentions
remain in `CONTENT_GUIDE.md`, `FULL_ASCENT_PROTOTYPE.md` and
`_build/reports/phase8-report.md`; the second explicitly records it as
*excluded*. **Flagged for review, not removed**, because rewriting historical
phase reports would falsify the record.

### Pille Sewing — the one removal needing approval

Not among the seven approved organisations, and §9.2 caps the homepage at three
project summaries (it was the fourth). Removed from: the Work index logo rail
and its "other clients" entry (3 locales, ~48 words), the About logo rail, the
homepage `content.ts` case-study record, and `assets/img/client-pille.png`.
Git retains all of it; restoring is a revert. **This is the only meaningful
content removed in the phase and it is not yet approved.**

---

## 8. Per-archetype signature interactions

| archetype | signature interaction | page CSS |
|---|---|---|
| services overview | branching map + pinned horizontal service journey (~300vh at 1440, ~270vh at 1024) + CTA convergence | `page-services.css` |
| web design SME | pinned interface object: wireframe → designed page → live site | `page-build.css` |
| web design enterprise | pinned system diagram: apart → wired to a hub → running | `page-build.css` |
| advertising | six-station signal path, fragmented then resolved | `page-signal.css` |
| branding | headline moving along the variable font's width and weight axes; asymmetric palette | `page-brand.css` |
| work index | restrained project index, image demoted, logo rail | (shared) |
| about | four strands braided and released | `page-about.css` |
| impact | four-station selection route, and nothing else | `page-impact.css` |
| contact | one trace dividing into two decisions, focus follows the choice | `page-contact.css` |
| questionnaire | flight path, one station per question | `page-quiz.css` |
| blog index | editorial index, sticky image panel raised per row via `:has()` | `page-blog.css` |
| article | section-heading reveals only | (shared) |
| legal | none, by §24 | — |

Per-archetype stylesheets load only where declared (`css:` in the fragment's
front matter). The largest is `page-build.css` at 3,206 B gzipped.

### Not built

* **§12 exploded system stack as six named layers** — the SME page's real
  package is four items and the enterprise page's is six capabilities. Both
  received ordinal depth. A six-layer technical stack invented to match the
  brief's example would be scope the business does not sell.
* **§12's seven-stage process** — this business runs three stages and the page
  already said so. A seven-step process invented to fill a sequence is a
  seven-step process the client will expect.
* **§23 sticky chapter contents** — not implemented. The altimeter rail already
  carries reading progress on every route; a per-article table of contents
  across 6 articles × 3 locales was not reached.
* **§20 form morph** — the two contact routes are an on-page anchor and a
  separate route. A true in-place morph would change the lead architecture,
  which §2 freezes.
* **§13 campaign lab / §14 artboard wall as horizontal sequences** — the
  advertising and branding pages received their signature interaction but not a
  second spatial sequence.

---

## 9. Responsive and reduced motion

**Route audit — 66 routes × 12 viewports = 792 checks: 0 failing, 0 broken
internal links.** Viewports: 1920×1080, 1440×900, 1366×768, 1280×800, 1024×768,
820×1180, 430×932, 390×844, 375×812, 360×800, 844×390, and 1280 @ 200% zoom.

Mobile is art-directed rather than collapsed:

* the horizontal service rail becomes four full-width blocks in source order —
  no pin, no travel, no viewport-height trap;
* the pinned build sequences release, the interface object leads and the stages
  follow as text;
* the branch map, signal path, braid and split traces are removed below the
  width at which they stop describing anything, and the prose that already
  carried the same argument carries it alone;
* the blog index goes text-led and does not fetch five decorative photographs a
  phone was never going to show.

**Reduced motion**, verified across 14 representative routes: nothing hidden
(0 elements below 0.9 opacity among stage items, rail panels, masks, logos and
convergence CTAs), 0 sticky pins remaining, 0 horizontal overflow, 0 page
errors. It is the same content, not a lesser layout.

---

## 10. Accessibility

Verified programmatically across 14 representative routes:

| check | result |
|---|---|
| one `<h1>` per route | 66/66 |
| horizontal overflow at 200% zoom | 0 routes |
| horizontal overflow with WCAG 1.4.12 text spacing | 0 routes |
| menu focus trap (40 tabs) | never escapes |
| ESC closes the menu | yes |
| focus restored to the trigger | yes |
| decorative Traces hidden from AT | all, `aria-hidden` + `focusable="false"` |
| anchored form section takes focus | yes, `:focus-visible` only |
| console/page errors | 0 |

**Known, pre-existing, not a Phase 8.5 regression:** at display sizes the
Hungarian and German diacritics on `.display` headings sit close enough to the
line above to touch on multi-line headings (`MŰKÖDIK?`, `TÉNY-LEG EGYÜTT`). This
is the Phase 8 type system's line-height, present in the baseline stills. §2
freezes accepted typography, so it is reported rather than changed. **It is a
real legibility issue and worth a decision.**

---

## 11. Performance

### Shared layer, on all 66 routes

| | baseline | now | delta |
|---|---:|---:|---|
| CSS raw / gzip | 103,280 / 27,500 | 130,636 / 36,107 | +27,356 / **+8,607** |
| JS raw / gzip | 73,375 / 25,835 | 98,441 / 35,623 | +25,066 / **+9,788** |
| **total gzip** | **53,335** | **71,730** | **+18,395** |

New: `motion.js` 6,256 gz, `header.js` 3,657 gz, `motion.css` 3,996 gz, plus
`main.css` growing 4,611 gz for the header, menu and footer.

Per-archetype CSS adds at most 3,206 B gzipped (`page-build.css`) on the routes
that declare it, and zero on the routes that do not.

### Against the homepage

The homepage bundle is ~1.4 MB of JavaScript. A subpage is 98 KB raw. The ratio
is ~14×, against ~19× at baseline. §28's "substantially lighter" holds with
margin, and the largest single contributor to the change is the header/menu/
footer system, which is chrome every route needs rather than motion.

Motion is lazy: the driver runs only while a registered element is intersecting
and stops otherwise, so a page whose motion is all below the fold costs nothing
until you reach it. `assets/img/team-richard.jpg` was resampled from 1800px /
234 KB to 1250px / 115 KB — 51% off, no visible difference at any supported
viewport.

---

## 12. Lifecycle

Verified: dispatching `pagehide` releases the IntersectionObserver and the rAF
loop; the tracked map is cleared. No pinned styles, active classes, overlay
elements, scroll locks or stale animation state survive.

**Not run in this phase:** repeated BFCache and browser back/forward traversal
regression across many navigations. The Phase 7 traversal validator exists
(`npm run validate:traversal`) and was not exercised against the new pins.

### Two audit fixes found on the way

1. **`scripts/content-inventory.mjs`** skipped anything whose class matched
   `\brail\b`, meant for the altimeter. A hyphen is not a word character, so
   `logoset--rail` matched too and two real images vanished from the count. An
   audit that under-reports is worse than one that over-reports, because the
   number still looks plausible. Now anchored to the class token.
2. **`_build/build.py:image_size`** knew PNG and JPEG. The first approved mark is
   WebP, so it shipped with no width and no height and reflowed the logo rail
   when the bytes landed — 12 route-audit failures. All three WebP flavours are
   read now.

The content inventory's own image and word figures still move for reasons that
are not content (it excludes `aria-hidden` subtrees, and the blog index's
decorative panel is one). §1's visible-word measurement is the figure that
answers §33.

---

## 13. Tests and gates

| gate | result |
|---|---|
| typecheck (portal + experiments) | **pass** |
| secret scan (500 files, 7 rules) | **clean** |
| route audit — 66 × 12 viewports | **792 checks, 0 failing** |
| broken internal links | **0** |
| reduced motion / 200% zoom / text spacing / focus trap / lifecycle | **0 findings, 14 routes** |
| locale coverage — 0 untranslated strings | **hu / en / de all clean** |
| sitemap and indexing rules | **60 URLs, 9 noindex, consistent** |
| production build + `validate:full` | **88 passed, 0 failed, 97 skipped, exit 0** |

Timeouts were not raised. One assertion was *changed* rather than weakened: two
places asserted four homepage case studies, and §9.2 caps the Selected Work at
three. Both now name the three and additionally assert the count is exactly
three — a fourth reappearing is as much a regression as one going missing, and a
loop over a list can only catch the second. See §14.

The 97 skips are the suite's own `test.skip` guards, not omissions: canvas tests
skip on the reduced-motion project, reduced-motion assertions skip on the motion
projects, once-only inspections skip off desktop, and mobile-layout tests skip on
desktop. Five projects — desktop, mobile-390, mobile-430, mobile-375,
reduced-motion — at `workers: 1`.

### A note on running this suite

The first attempt reported ~40 failures, almost all mobile WebGL timeouts at
exactly 20.3s. None were real: the route audit and several Playwright probes
were running concurrently and the machine was starved. Re-run with nothing else
in flight, the same source produced one genuine failure (the case-study count
above) and then a clean pass. A contended run of this suite is not evidence.

---

## 14. §33 scorecard

| required | actual |
|---|---|
| Routes lost | **0** |
| Meaningful content removed without approval | **1 — Pille Sewing (§7), flagged** |
| Unsupported project metrics added | **0** |
| Empty case-study sections rendered | **0** |
| Oversized project-image regressions | **0** (58vw → 38vw) |
| Uncensored Society current-partner appearances | **0** |
| Unverified "partner" claims | **0** — wording is "selected collaborations" |
| Missing official-logo placeholders shipped | **0** |
| Broken CTAs | **0** |
| Broken internal links | **0** |
| Lead-flow regressions | **0** — `lead.js`, the functions, the Supabase schema and the questionnaire payload are byte-identical |

---

## 15. October full case-study activation

When a project has professional media, a documented challenge and strategy,
design rationale, a technical account and verified results:

1. change its value in `_build/build.py:CASE_STATUS` from `summary` to `full`;
2. rebuild.

That single edit restores its sitemap entry, drops `noindex, follow`, re-arms
the shared Work→Case transition on the Work index, and re-enables a full-case
CTA. Nothing else needs touching, and nothing has to be un-deleted, because
nothing was deleted.

The related-link chip vocabulary (`Projekt` / `Project`) is a dictionary entry
and should be revisited at the same time.

---

## 16. Deployment readiness and acceptance

**Not deployed. Not pushed. Nine local commits on `main`.**

Outstanding before Phase 8.5 can be accepted:

1. **Five of seven approved logos are production blockers** (§7). Two ship.
2. **Pille Sewing removal is unapproved** (§7).
3. **Human visual review has not happened.** No review package was produced —
   §32 asks for four viewports across header, footer, services, work, logos,
   contact, questionnaire, about, impact and blog, plus short recordings.
4. **Several §12–§14 and §23 elements were not built** (§8).
5. **Production deployment is not authorised and has not been verified.**
6. The pre-existing display-type diacritic collision (§10) needs a decision.

---

*Report closed against frozen source.*
