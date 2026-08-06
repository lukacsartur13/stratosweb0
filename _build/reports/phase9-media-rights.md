# Phase 9 — Workstream P: media and relationship rights

Every file the public site serves, and every organisation it names. One finding,
fixed. Everything else was already correct because Phase 8 built the mechanism
that makes it correct — this audit mostly confirms that mechanism still holds.

---

## 1. The finding

`assets/img/FORRASOK.md` and `assets/fonts/MANIFEST.json` were being **published**.

`assets/` is copied wholesale into `dist/`, so both shipped at guessable URLs.
`FORRASOK.md` is the media-rights audit itself: it names every image's source
and licence, names the one file whose rights are unresolved, and says where it
is quarantined. It belongs beside the assets it describes — that is what keeps
it accurate — and it is not a document to serve to the public.

Fixed in `scripts/assemble.mjs`: `.md` files and `MANIFEST.json` are excluded
from the asset copy. `dist/assets/img/` went from 33 files to 32.

---

## 2. What ships, and its rights basis

**32 image files, 3 font families.** Every one accounted for.

### Photography

| Files | Source | Basis |
|---|---|---|
| `space-horizon.jpg`, `moon.jpg`, `cloud-tops.jpg` | NASA (`iss064e002941`, `GSFC_20171208_Archive_e000868`, `iss023e057948`) | **Public domain.** NASA Media Usage Guidelines. Attribution is courtesy, not obligation. Each is recorded with its NASA identifier and its original URL |
| `hero.jpg`, `work-1..3.jpg`, `blog-1..6.jpg`, `kivitelezes.jpg`, `struktura.jpg`, `texture-fabric.jpg` | site imagery | Inventoried in `FORRASOK.md` |
| `team-artur.jpg`, `team-richard.jpg` | the two people shown | Own images of the team |

### Client and organisation marks

| Files | Organisations | Basis |
|---|---|---|
| `client-rapidkert.png`, `client-barbershop.png` | Rapidkert Kft., Barbershop Győr | Clients with live project routes — evidenced by the work itself, since there is a page about each |
| `logo-kontyos.webp`, `logo-grantool.png`, `logo-synergy.png`, `logo-duna-hajok.png`, `logo-duna-enterior.png` | the five collaborations | Official artwork, supplied |
| `logo-haio.png`, `logo-fice.png` | HAIO, FICE | Official artwork, supplied |

### Own marks and interface

`logo.png`, `favicon.png`, `plane-cursor.png`, `icons.svg`, `gdpr.png` — the
Stratos identity and interface graphics.

### Fonts

Aboreto, Archivo, JetBrains Mono. All three self-hosted, all three open-licence,
all three audited in `FONTS.md` by parsing the binaries rather than by reading a
foundry page. **No font CDN**, so `font-src` is plain `'self'` and no third
party sees a visitor's request for type.

Worth recording: `FONTS.md` §1 states plainly that the brief asked for three
ABC Dinamo families the project does not have and does not hold licences for,
and that they were **not used**. That is the same discipline as the `ready` flag
below, applied to type.

### Stock media

**None.** No stock library asset ships. Nothing has an unresolved licence.

### Generated media

The 3D models (`stratos-mountains-*.glb`, `stratos-altimeter.glb`) are built in
Blender from this project's own sources. The `assets/blender` source directory
is excluded from `dist/`, deliberately — a `.blend` is several hundred KB nobody
requests and a look inside the workshop nobody asked for.

---

## 3. `cruise-jet.jpg` — verified absent

| | |
|---|---|
| What it is | A Gulfstream G700 (N702GD) press photograph, copyright Gulfstream Aerospace. Publishing it needs permission that has not been obtained |
| Where it is | `_backup/media-rights-hold/cruise-jet.jpg` — quarantined during Phase 8 |
| In `dist/` | **No.** Verified in this phase |
| Referenced by any page, stylesheet or script | **No.** It never was |

The reasoning recorded in `FORRASOK.md` is the right one and is worth
restating, because it is the part that is easy to get wrong: **the file was not
at risk because a page referenced it — no page ever did. It was at risk because
`assemble.mjs` copies all of `assets/`, so it was downloadable at a guessable
URL from the published site.** Publication is a function of the directory, not
of the link. Which is exactly the same mechanism that shipped `FORRASOK.md`
itself, found this phase.

**It must not be moved back into `assets/img/` while its status is unresolved.**

---

## 4. Organisations and how each is described

Seven, and all seven are on the approved list.

| Organisation | `relationship` | Where it appears | What is claimed |
|---|---|---|---|
| Kontyos.hu | `collab` | the rail | association |
| Grantool Kft. | `collab` | the rail | association |
| Synergy Digital Hungary Kft. | `collab` | the rail | association |
| Duna Hajók | `collab` | the rail | association |
| Duna Enteriőr | `collab` | the rail | association |
| HAIO | `sponsor` | one page, by name | Stratos sponsors them |
| FICE | `impact` | one page, by name | Stratos works for them for nothing |

### The wording is neutral, and it is neutral by construction

The five collaborations sit under one heading — **"Selected collaborations"**
(`Kiválasztott együttműködések` / `Ausgewählte Kooperationen`) — which claims
association and nothing more. It specifically does **not** claim partnership,
endorsement, sponsorship or a commercial engagement, because nothing in this
repository establishes which of the five are clients and which are
collaborations, and inventing that per organisation is exactly what this audit
exists to catch.

HAIO and FICE are the two exceptions and were **not** invented here — both were
stated directly by the owner of the relationship. They are also the two the
neutral heading would get *wrong* rather than merely leave vague: Stratos pays
HAIO and works for FICE for free, so filing either as a collaboration would
overstate one and understate the other. Each is named on the single page where
it is the subject, and nowhere else.

`logoset()` renders the rail from `collab` only, so this separation is
structural rather than editorial.

### Uncensored Society

**Absent.** Not in `ORGS`, not in any fragment, not in any translation
dictionary, not in `dist/`. Grep across the whole repository for
`uncensored`: zero matches. It does not appear as a current partner, because it
does not appear at all.

Historical references: **there are none to audit.** Nothing in the current site
references any past relationship. If one is added later it needs a separate
treatment — a past relationship stated in the present tense is the same class of
defect as a summary case study presented as a full one.

### The word "partner"

The site uses `partnereink` / `our partners` five times in prose, always
generically about clients ("while we work on our partners' growth") and never
attached to a **named** organisation. No named organisation is described as a
partner anywhere. That is the line the brief draws, and it holds.

---

## 5. The `ready` gate — why no placeholder can ship

`ORGS` carries a `ready` flag on every entry, and `logoset()` emits **nothing**
for an entry where it is false — not a box, not a name in a border, not a grey
rectangle.

The reasoning in the source is the part that matters: *"we have a logo for them"
and "we have a logo we can publish" are different claims, and the gap between
them is where a stretched, keylined, white-boxed or reconstructed mark gets
shipped.* `ready` is false unless the supplied file is the official artwork, at
a usable size, with real transparency, legible on the Stratos void. **A false is
a production blocker to be reported, never a placeholder to be drawn.**

All seven are currently `ready: true`.

A related structural guard: `LIGHT_INK` marks (HAIO, FICE) are knockout artwork,
and `logoset()` **raises** rather than render one on a light band. A white mark
on `#F4F4F4` is not a subtle regression — it is a blank rectangle that passes
every test that only counts `<img>` elements.

---

## 6. Against the brief's prohibitions

| Must not ship | Status |
|---|---|
| Missing-logo placeholders | **none** — structurally impossible while `ready` gates rendering |
| Approximate recreations | **none** — every mark is supplied official artwork |
| Unused press assets copied into public output | **fixed.** `cruise-jet.jpg` was removed in Phase 8; `FORRASOK.md` and `MANIFEST.json` were found and removed in this one |
| Assets with unknown permission | **none in `dist/`.** The one file with unresolved rights is quarantined outside the published tree |

---

## 7. Open items

| Item | Status |
|---|---|
| `cruise-jet.jpg` permission | **REQUIRES USER FACTUAL INPUT** — obtain permission from Gulfstream Aerospace, or delete the file permanently. It cannot return to `assets/img/` either way until this is settled |
| Written permission for the seven organisation marks | **REQUIRES USER FACTUAL INPUT** — the artwork was supplied, which strongly implies consent to display it. Whether that consent is written down anywhere is not knowable from this repository, and trademark display permission is worth having in writing before a public launch |
| `team-richard.jpg`, `team-artur.jpg` consent | **REQUIRES USER FACTUAL INPUT** — publishing a photograph of an identifiable person needs their agreement. Presumed held for both; not recorded anywhere |
