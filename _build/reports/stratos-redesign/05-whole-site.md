# Stratos redesign — 05 · The whole site on the new system

Date: 2026-10-16 · Branch `redesign/quiet-authority` · follows `04-qa-and-changes.md`
(the homepage, committed as `614dd62`). Approved by the owner with two instructions:
the collaboration marks take their colour on hover, then do the whole site; and,
during the pass, a third: every logo on the homepage and the About page.

Nothing pushed, merged or deployed.

---

## 1. What changed

**Every route, in all three languages, and the three 404 pages are on one shell** —
the floating header, the light page, an optional closing scene, the quiet footer.
The original shell is gone: the dark flight deck, the full-screen numbered menu, the
altimeter rail, the plane cursor and contrail, the grain, the Arrival footer, magnetic
buttons, cross-document page transitions.

**The fragments kept their words.** All 35 Hungarian source pages are the same text,
headings, links and FAQ as before, and so are their translations: `assets/css/site.css`
restyles the class vocabulary they are written in (table in `02-design-system.md`
§11). That is how the SEO and local pages "inherit typography, colours, buttons,
radius, header/footer, forms and surfaces" (brief §37) without a word of search
content moving.

**Two pages were rewritten, as the brief asked:**

| Page | Brief | What it is now |
|---|---|---|
| `/munkaink` (Work) | §31 | Three flagships — Rapidkert, GoDataFusion, MindForge — each a full-width picture in its own project world, then one idea, one proof where one is published (Rapidkert ~110M Ft, the case study's figure and wording), one paragraph. Barbershop moves to "További munkák" below, then the collaborations. The generic "Ami mindegyikben közös" checklist is gone. Every sentence is the old one; their translations carried over. |
| `/rolunk` (About) | §32 | "Kis csapat. Nagy felelősség." The stratosphere founding quote, "Ez nem munka. Ez életszemlélet." and the six-reason grid are gone; in their place four concrete ways of working (direct contact, one pair of hands, craft, discipline — each a claim the enterprise page already makes), the two partners with factual role lines drawn from their own descriptions, the existing figures, strands, collaborations, FAQ and closing. Title and description updated (EN/DE included). |

**One addition every page now has:** the old Arrival band was every page's closing CTA,
and only 9 of 35 pages had a dark closing of their own. The generator now adds a
closing scene (`CLOSE_V2`, `.pclose`) to pages that do not end on a launch: graphite,
an archetype-specific question (service / work / about / article — the same strings
the Arrival used), one action, a link to the work. Not on the questionnaire, the
contact page, the legal pages or the 404.

**Every logo on the homepage and About** (owner, mid-pass): both pages show all
12 client and collaboration marks — Rapidkert, Barbershop, Kontyos, Grantool,
Synergy, Duna Hajók, Duna Enterior, RS Oil, GoDataFusion, O2 Tanácsadó, MindForge,
Reverb — through `{{logoset:<kind>:all}}`, which reads `ALL_MARKS` in `build.py`, so
a mark approved in `ORGS` appears on both without either fragment changing. Rows of
six, four or three, so twelve always fill whole rows (2×6 desktop, 3×4 tablet, 4×3
phone, checked in HU/EN). Quiet ink at rest, own colour on hover. Barbershop's
square file was 39% empty above and below, so it rendered at half its neighbours'
size; it now uses a tight crop of the same artwork (`client-barbershop-tight.png`,
the Rapidkert precedent). Not included: HAIO (sponsored) and DPA (pro bono) — under
"Kiválasztott együttműködések" both would be misstated; each stays on its own page.

**One rule for dark:** a page's single dark moment is the scene it ends on. A `.launch`
mid-page is a light raised surface; only the launch in the last section, or the
closing scene, is graphite.

## 2. Measured, subpages, before vs after

Cold cache, full read-through, same machine and the same (uncommitted) Playwright script; phone
= 390×844, 4× CPU, slow 4G. Local server, no compression (raw bytes).

| Route | Requests | Bytes | JS | CSS | Fonts | Canvas | Long tasks (phone) | Phone LCP | CLS |
|---|---|---|---|---|---|---|---|---|---|
| `/kkv` before | 22 | 362 KB | 44 KB | 81 KB | 145 KB | 1 | 70 ms | 1,380 ms | 0.003 |
| `/kkv` after | **15** | **275 KB** | **26 KB** | 56 KB | 104 KB | **0** | **0** | **1,160 ms** | **0** |
| `/munka-rapidkert` before | 22 | 353 KB | 44 KB | 79 KB | 145 KB | 1 | 69 ms | 1,356 ms | **0.144** |
| `/munka-rapidkert` after | **15** | **268 KB** | **26 KB** | 55 KB | 104 KB | **0** | **0** | **1,128 ms** | **0** |
| `/blog-webdesign` before | 20 | 300 KB | 44 KB | 76 KB | 145 KB | 1 | 65 ms | 1,404 ms | 0.010 |
| `/blog-webdesign` after | **13** | **216 KB** | **26 KB** | 53 KB | 104 KB | **0** | **0** | **1,180 ms** | **0** |

The fonts drop because JetBrains Mono is no longer used anywhere on the public site
(it is still declared in `type.css`, which costs nothing until a rule names it).

## 3. SEO, after the whole-site change

| Check | Result |
|---|---|
| `audit:seo:check` | 0 failing; the same 31 warnings as before (27 `hreflang-noindex`, 4 `description-length`, none new) |
| `audit:ownership:check` | no collisions — no chrome heading claims a head term; the closing scene's questions contain none |
| `audit:conversion:check` | 0 integrity failures; zones now chrome 198 · arrival 0 · body 315 (the closing scenes are body CTAs with `data-cta-placement="closing"`); routes with no body CTA: 12, unchanged |
| `fingerprint:check`, `fonts:check` | clean |
| Titles, descriptions, canonicals, hreflang, sitemap, JSON-LD, redirects | unchanged on every route except `/rolunk`'s title and description (rewritten page, EN/DE translated); the about page keeps its FAQPage |
| URLs | none added, renamed or removed |
| Internal links | every link in every fragment kept; the header's four destinations + the sheet's full service list + the footer replace the old menu |

## 4. Tests

`npx playwright test`, all nine projects: **2,203 passed, 13 skipped, 3 failed** — the
three were `lead-forms.spec.ts` "the deployed bundle" timeouts. Cause found: the scan
read 298 iCloud conflict copies (`name 2.html`, `name 3.js`…) sitting in `dist/`, many
evicted to the cloud. Those never ship (Netlify builds from git, which refuses them), so
the scan now skips them like `asset-packaging.spec.ts` already did; the spec then
passes in full (128/128).

Adapted to the new site, keeping each test's question:
- `service-route-legibility.spec.ts` — still measures contrast against the composited
  background. The pinned-window and rail-travel timing tests became "every build stage
  on screen at once, in order" and "the five services are rows inside the viewport";
  the lit panel is asserted *different* from its neighbour instead of a colour value;
  the dark-band FAQ test became the same accordion on the (now light) About page; the
  FAQ open-state test drove a real fix (the mark goes ink and rotates, the rule
  darkens). It also caught small labels set in the recessive tone at 3.1 : 1 — all moved
  to `--c-ink-2` (6.3 : 1).
- `homepage-shell.spec.ts` — the two "original deck" tests became "a subpage carries the
  same header" (and no deck, menu, rail, Arrival, cursor or canvas) and "the sheet works
  on a subpage".
- `not-found.spec.ts` — no canvas at all (the contrail is gone).
- `asset-packaging.spec.ts` — understands root-absolute `/assets/…`.

## 5. Visual QA

Stills: `shots/site/` (git-ignored) — 14 routes × desktop 1440 and phone 390, including
EN/DE and the 404. Automated on each: no sideways scroll, no uppercase text, no mono
text, no console errors. Found and fixed during the pass: the questionnaire threw
`Stratos.setProgress is not a function` (its altimeter hook — removed); structural links
picked up the paragraph-link underline; the flagship screens were cropped through the
client's own headline on phones (now shown whole, 16:10); breadcrumbs underlined.

The consent banner — which only appears on the production hosts — was rendered locally
with its real markup and checked at 1440 and 390 (symmetric answers, wraps cleanly).
**This also fixed a defect in the homepage commit:** the banner's only styles were in
`chrome.css`, which the new homepage did not load, so on production it would have
rendered unstyled. They now live in `system.css`.

## 6. Removed in this step

`assets/css/main.css`, `chrome.css`, `motion.css`, `transitions.css`, `page-contact.css`,
`page-impact.css`; `assets/js/main.js`, `header.js`, `motion.js`, `transitions.js`;
nine images only the old chrome used (`hero`, `kivitelezes`, `struktura`,
`space-horizon`, `cloud-tops`, `moon`, `texture-fabric`, `work-1`, `work-2`, with their
responsive variants — `assets/img` 14 → 10 MB); in `build.py` the `SHELL`, `DECK`,
`RAIL`, `FOOTER` templates, `build_deck`, `build_menu`, `build_footer`,
`ARCHETYPE_CTA`, `CEILINGS`, `NAV`, `MENU`, `MENU_PRIMARY`, `ARROW` and 72 UI strings
the instrument used; the decorative trace SVGs and the two head photos from the
fragments; `ceiling:` from every fragment's front matter; the questionnaire's altimeter
calls. Kept on purpose: `scripts/hermetic/diagnostics/` and `scripts/webkit-nav/`
(investigation tools outside every gate, still naming the old header).

## 7. Open items

1. Lighthouse and real-device checks on a deploy preview.
2. The Rapidkert screen is the Hungarian capture in all three languages (the English
   one, `work-rapidkert.jpg`, exists).
3. `type.css` still declares JetBrains Mono; the font files and the declaration can be
   removed once the portal is confirmed not to use them.
4. Dictionary entries for the removed About copy are still in `rolunk.json` (harmless:
   unused keys are never read).
