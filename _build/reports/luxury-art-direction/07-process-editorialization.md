# 07 · Process editorialisation

Phase 4. Content compression, not a design phase — the accepted Direction D
typography, the six master acts, the Editorial Passage system, the background
progression, the Altimeter strategy, the Rapidkert act, the yellow budget and
the crossing rhythm are all unchanged, and nothing below reopens any of them.

**The finding.** The process passage was 5.71 screens on desktop and 3.43 on the
phone, and it was the longest chapter on the homepage — longer than any of the
six master acts, which are supposed to be the destinations. It got there
honestly: thirty-five sentences at the editorial size is about two screens of
type in any arrangement, and meeting them one at a time — which is what keeps
them from being a forty-nine-object dashboard again — adds the air between.

**So the length was the symptom.** The defect was the information DEPTH. The
homepage was documenting the operating model where its job is to introduce it.

**What was done.** The twenty-eight term sentences moved, whole and unedited, to
`05 · A folyamat` on the services route. The homepage kept the statement, the
seven stage names in one line, three principles derived from the same sentences,
and one restrained route to the rest. It is 2.23 screens on desktop and 1.17 on
the phone, and by length it has gone from the FIRST of eleven chapters to the
ninth on desktop and the fifth on the phone.

Nothing was cut without being classified, and the classification is checked by a
script rather than asserted here: `scripts/process-inventory.mjs`.

---

## A · Current process inventory — §4

The passage rendered forty-two strings: the two halves of the statement, one
lead, four term labels, and the seven checkpoints' names and twenty-eight
sentences. The thirty-five in `content.ts` were snapshotted in all three locales
BEFORE any production change, and the file is committed:

```
_build/reports/luxury-art-direction/process/inventory-source.json
```

`node scripts/process-inventory.mjs --snapshot` wrote it, reading the real
`content.ts` through Vite rather than a regex, and reported **35 units, 0
without a full translation**. Every unit carries `hu`, `en` and `de`, so the
audit below is a three-locale audit rather than a Hungarian one with two
translations assumed.

| checkpoint | name | sentences |
| --- | --- | --- |
| 1 | Felderítés | `Mi történik` · `Amit átadunk` · `Amit tőled kérünk` · `Várható eredmény` |
| 2 | Kutatás | the same four |
| 3 | Stratégia | the same four |
| 4 | Tervezés | the same four |
| 5 | Fejlesztés | the same four |
| 6 | Indulás | the same four |
| 7 | Optimalizálás | the same four |

The full text of all thirty-five, in all three locales, is the snapshot file.
The generated classification table is
`_build/reports/luxury-art-direction/process/content-audit.md`.

---

## B · Duplication audit — §24

Compared against the System act, the Hero promise, the Rapidkert proof, the
other homepage passages and the four service routes.

| process content | already said where | verdict |
| --- | --- | --- |
| `Egy irány, amelyhez minden későbbi döntés mérhető.` (3d) | System says it harder, twice: `A sorrend a lényeg, nem az, hogy kilenc van belőle.` and ring 0's `Ez dönti el a többit. Enélkül minden alatta lévő döntés találgatás.` | **redundant** — dropped from this journey |
| `Tényeken alapuló alap a stratégiához.` (2d) | Same family of claim as above, but it is about research feeding strategy rather than about ordering as such, and it is the research stage's own outcome | kept, at depth |
| `Havonta: mérés, elemzés, módosítás.` (7a) | System's ring 2 has `Optimalizálás — Havi finomhangolás a mért adatok alapján, nem megérzésből.` | Related but distinct: System names monthly optimisation as a CAPABILITY; principle 3 says the ENGAGEMENT does not end at launch. Kept, and principle 3 is phrased on `nem projektzárás, hanem üzemeltetés` rather than on the monthly cadence, so the two do not restate each other |
| checkpoint 1 as a whole | The services route's `04 · Az ajánlat` already covers Igényfelmérés → Terjedelem → Írásos ajánlat → Indulás vagy nem | Overlapping but not duplicate: that section is how a PROPOSAL is produced; checkpoint 1 is the first stage of the work. They are now adjacent sections on the same page, which is where the overlap is visible and useful rather than hidden |
| the three-step processes on `kkv.html` and `nagyvallalat.html` | Both routes carry an audience-specific three-step process | Not duplicates: those are the SME and enterprise offers' own delivery shapes. The seven checkpoints are the general operating model, which is why they went to the services overview that is the parent of both |

**§23 was checked explicitly.** System explains capability integration — nine
disciplines in three dependent layers. The compressed process explains the
operating sequence and the terms of the engagement. The one sentence that
crossed the line is 3d, and it is the one classified redundant.

---

## C · Content classification — §5

Generated, not asserted:
`_build/reports/luxury-art-direction/process/content-audit.md`.

```
35 original units. 7 support · 24 deep · 8 core · 1 redundant
```

(The audit table also carries five frame strings from `messages.ts` that are not
in the snapshot — the passage lead and the four term labels — for forty rows in
total.)

| bucket | count | what it means here |
| --- | --- | --- |
| HOMEPAGE CORE | 8 | the compressed homepage carries the sentence or the idea it is the label of |
| HOMEPAGE SUPPORT | 7 | the seven stage names, in the passage's one support line |
| DEEP DETAIL | 24 | on the services route, verbatim |
| REDUNDANT | 1 | `Egy irány, amelyhez minden későbbi döntés mérhető.` — see §B |

`scripts/process-inventory.mjs` exits non-zero if any unit has no
classification, or if a unit classified `deep` or `support` cannot be found at
the destination it names. It currently reports:

```
audit: 40 units · 7 support · 24 deep · 8 core · 1 redundant
  every original unit is accounted for.
```

---

## D · The three principles — §10, §11, §12, §13

### Why these three

They are the three things the seven checkpoints argue that nothing else on the
homepage argues:

1. **the first deliverable is written, and the answer may be no** — an entry
   gate, stated as a refusal. No other page on the site says this.
2. **every stage names what it asks of the client, and the work is visible
   while it happens** — the four-term grid's fourth column was the only part of
   it that was about the reader rather than about us, and it is the whole
   two-sided character of the engagement.
3. **going live is the start of operation, not the end of a project** — the
   lifecycle claim, and the one the last two checkpoints exist for.

§11's rejection test: none of them is a variant of "we understand", "we plan" or
"we build". One is about the terms of entry, one about the terms of
collaboration, one about what happens after delivery. At a glance the
progression reads: *before · during · after.*

### The copy, exactly

| | HU | EN | DE |
| --- | --- | --- | --- |
| **1 label** | `Előbb a korrekt nem.` | `First, the honest no.` | `Zuerst das ehrliche Nein.` |
| **1 line** | `Írásos helyzetkép, és egy őszinte válasz arra, hogy tudunk-e segíteni.` | `A written assessment, and an honest answer on whether we can help.` | `Eine schriftliche Bestandsaufnahme und eine ehrliche Antwort darauf, ob wir helfen können.` |
| **2 label** | `Amit tőled kérünk.` | `What we ask of you.` | `Was wir von Ihnen brauchen.` |
| **2 line** | `Minden szakasznak két oldala van, és menet közben látod, nem a végén.` | `Every stage has two sides, and you see it as it goes, not at the end.` | `Jede Phase hat zwei Seiten, und Sie sehen es währenddessen, nicht erst am Ende.` |
| **3 label** | `Az indulás nem befejezés.` | `Launch is not the end.` | `Der Start ist kein Ende.` |
| **3 line** | `Nem projektzárás, hanem üzemeltetés — a rendszer idővel jobb lesz, nem avul el.` | `Not project closure but operation — the system gets better over time rather than going out of date.` | `Kein Projektabschluss, sondern Betrieb — das System wird mit der Zeit besser, statt zu veralten.` |

Labels are two to five words. Explanations are one sentence. Nothing in them is
`proven process`, `results-driven`, `tailored solutions`, `seamless execution`
or `end-to-end excellence` — §14 — and none of them is a category noun with a
generic gloss under it, which is what §13 rules out.

### The other two homepage objects

| | HU | EN | DE |
| --- | --- | --- | --- |
| **statement** | `Hét ellenőrzőpont, / találgatás nélkül.` | `Seven checkpoints, / no guesswork.` | `Sieben Kontrollpunkte, / ohne Raterei.` |
| **support** | `Felderítés, Kutatás, Stratégia, Tervezés, Fejlesztés, Élesítés, Optimalizálás.` | `Discovery, Research, Strategy, Design, Development, Go-live, Optimisation.` | `Erkundung, Recherche, Strategie, Konzeption, Entwicklung, Livegang, Optimierung.` |
| **route** | `A hét ellenőrzőpont részletesen` | `The seven checkpoints in detail` | `Die sieben Kontrollpunkte im Detail` |

The statement is untouched, to the character, in all three locales. The support
line is not a new string: `FullAscent.tsx` and `MobileHome.tsx` both compose it
from `PROCESS`, so the line and the table cannot disagree about what the seven
are. It is what keeps `Hét` a true sentence about the page.

---

## E · Traceability — §30

Final homepage copy → the original sentences it comes from → where the omitted
detail went.

| final homepage principle | original source sentences | destination of omitted detail |
| --- | --- | --- |
| `Előbb a korrekt nem.` + `Írásos helyzetkép, és egy őszinte válasz arra, hogy tudunk-e segíteni.` | **1b** `Írásos helyzetkép és egy őszinte válasz arra, hogy tudunk-e segíteni.` (verbatim, three locales) · **1d** `Közös kép a kiindulási pontról — vagy egy korrekt nem.` (its tail is the label) | 1a and 1c → services `05`, checkpoint 01. 1d's first clause → services `05`, checkpoint 01 |
| `Amit tőled kérünk.` + `Minden szakasznak két oldala van, és menet közben látod, nem a végén.` | the term label **`Amit tőled kérünk`** itself · **5a** `Megépítjük. Menet közben látod, nem a végén.` (second sentence verbatim) · **3c** `Döntést. Ez az a pont, ahol a legtöbb múlik rajtad.` · **4c** `Visszajelzést egy körben, összegyűjtve.` | 3c, 4c and 5a in full, plus the other four `Amit tőled kérünk` answers → services `05`, in their own checkpoints |
| `Az indulás nem befejezés.` + `Nem projektzárás, hanem üzemeltetés — a rendszer idővel jobb lesz, nem avul el.` | **7a** `…Ez nem projektzárás, hanem üzemeltetés.` (verbatim tail) · **7d** `Rendszer, amely idővel jobb lesz, nem elavul.` (verbatim) · **6d** `A rendszer működik és mér.` | 6a–6c, 7a in full, 7b, 7c → services `05`, checkpoints 06 and 07 |
| the seven-name support line | the seven `name` values, unchanged except **6n** | — |
| the statement | unchanged | — |

**Only one clause in the three principles is not a selection or recombination of
approved copy**: `Minden szakasznak két oldala van` / `Every stage has two
sides` / `Jede Phase hat zwei Seiten`. It states in one clause what the
four-term grid's shape used to state by existing — two columns about us, two
about you — and it is the sentence that lets the fourth column's idea survive
the grid's removal.

### The one source string this phase changed — §29

`Indulás` → `Élesítés` (`Launch` → `Go-live`, `Start` → `Livegang`).

It is a collision, not a preference. `Indulás` is also the closing-CTA eyebrow
on the ads route, where `_build/i18n/kapcsolodas.json` reads it as
`Starting out` — the right English for "getting started with us" and the wrong
English for a go-live stage. The site's dictionary is keyed on the Hungarian
sentence and cannot hold two senses of one word, so publishing the process on a
generated route would either have renamed that CTA or given the checkpoint the
wrong name in English. `Élesítés` is the word checkpoint 6's own first sentence
already uses — `Élesítés, átirányítások, mérés ellenőrzése, hirdetések
indítása.` — and `Livegang` is the word the approved German translation of that
same sentence already uses.

A second, smaller alignment: the homepage's German for `Tervezés` was
`Gestaltung` and the site's is `Konzeption`. Both keep the phase distinct from
`Dizájn`/`Design`, which is the reason `de.ts` gave for choosing a separate
word; the homepage now uses the site's, so a visitor following the new link does
not meet two German names for one stage. Nothing else on the site changed —
`npm run generate` reports no redefinition warnings.

---

## F · Detail destination — §6, §7, §8, §25, §26

**An existing route, and no new one.** `szolgaltatasok.html` /
`services.html` / `leistungen.html`, as a new numbered section
`05 · A folyamat`, with `id="folyamat"` as the homepage link's target. The
capabilities section that was `05` is now `06`.

### The routes that were audited first

| route | carries | verdict |
| --- | --- | --- |
| `szolgaltatasok.html` — services | `01 Hogyan kapcsolódnak` · `02 A szolgáltatások` · `03 Kombinációk` · `04 Az ajánlat` · `05 Amit be tudunk vállalni` | **chosen.** It is the page whose whole subject is what Stratos does and in what order, it already carries a process (how a proposal is produced), and it is the parent of the four service routes. `04` ends on `Indulás vagy nem`, which is where checkpoint 01 begins |
| `kkv.html` — SME | a three-step delivery process for the monthly-fee offer | rejected: audience-specific, and its three steps are that offer's shape, not the operating model |
| `nagyvallalat.html` — enterprise | a three-step process to rollout | rejected, same reason |
| `hirdeteskezeles.html` — ads | a three-stage campaign process | rejected: one discipline's process |
| `rolunk.html` — about | history, attitude, the team, six reasons, FAQ | rejected: it is who Stratos is, not how a project runs |
| `arajanlat.html` — quote | the questionnaire | rejected: it is a form |
| a new `/folyamat` route | — | **not created.** §8's four conditions are not met: an existing route contains it coherently, and a seventh top-level page for one section fragments the navigation rather than improving it |

### How it is built there — §25, §9

It is that page's own `.step` primitive, widened. The numeral is the services
page's numeral in the services page's signal colour on the services page's
hairline; the four terms are `<dt>`s and their answers `<dd>`s in the data face
this page already uses for `.eyebrow`, `.build__k` and `.branch__k`. The
homepage's composition was not transplanted onto it, which is what §25 asks.

It is not the thirty-five sentences pasted in sequence either. It has a head, a
lead — the passage's own retired lead, verbatim, immediately above the four
terms it describes — and seven numbered stages each answering the same four
questions in the same order, which is a table of contents a reader can scan
rather than a scroll they have to complete.

Measured: 2 212px at 1440 wide (HU), 2 469 (DE), 2 350 (EN), 3 181 at 390.

### SEO — §27

Ordinary semantic HTML on an existing indexable route: `<section>`, `<h2>`,
seven `<h3>`s, one `<dl>` per stage. No JavaScript gates any of it — the
`data-reveal` attribute is the same scroll reveal the four steps above it
already carry, and the copy is in the document either way. The generated EN and
DE trees carry the full text, not the Hungarian: `_build/i18n/szolgaltatasok.json`
gained 42 entries and `npm run generate` reports no untranslated strings for the
page. There is no duplicate full copy — the homepage carries three sentences of
this material, not twenty-eight.

---

## G · Homepage composition — §3, §15, §18, §19, §20, §21

```
statement           Hét ellenőrzőpont, / találgatás nélkül.      58u, right margin line, high
support             the seven, named                             17u, spine, y 560
——— the body, one beat ———
principle 1         label 30u  ·  line 17u
principle 2         label 30u  ·  line 17u
principle 3         label 30u  ·  line 17u
route               A hét ellenőrzőpont részletesen              17u, hairline under it
```

**One beat, not three — §18.** `.passage__item` is 58svh because seven items of
five lines each have to be met one at a time. Three items of two lines do not,
and §18 says so in as many words: *the elements may coexist in a restrained
editorial composition.* Staging them would have spent 1.7 screens saying what
resolves in half of one, and §31 forbids reusing the old height tokens without
re-solving them.

**What was NOT built — §15, §19.** No cards, no timeline, no process circles, no
stepper, no horizontal journey diagram, no numbered boxes, no icons, and no
`01 / 02 / 03`. Nothing in the passage is a new visual language: `<h3>` and `<p>`
are the settings `.passage__body` already had, the route is the Proof act's
`act__routes` link treatment with the two selectors grouped into one rule rather
than copied, and the two new declarations are the air between the principles
(40u) and the air above the route (16u).

**Yellow — §21.** Zero yellow events in the passage, before and after. The
homepage's two remain `~15M Ft` at the proof and the closing action.
`probe-yellow.mjs` is part of the gate below.

**No Altimeter was added to the process** — §40. The passage's scene attributes
are untouched.

**Master acts — §22.** Unchanged. The only geometry that moved is the process
chapter's own `share`, 2.4 → 2.0, and the reason is §31: 1.25 screens of held
frame plus one 58svh beat plus the passage body's 200u foot is 2.05 measured, so
a share of 2.4 was a third of a screen the chapter had no content for.

---

## H · Before and after — §16, §31, §38, §41

Measured off the running page by `experiments/probe-chapter-length.mjs`, which
is new and is the instrument for all of the numbers below. JSON per run in
`_build/reports/luxury-art-direction/process/`.

### The chapter

| | before | after | |
| --- | ---: | ---: | --- |
| desktop 1440×900, HU | **5.71 screens** (5 143px) | **2.23** (2 011px) | −61% |
| desktop 1440×900, DE | 5.71 | 2.23 | −61% |
| phone 390×844, HU | **3.43 screens** (2 892px) | **1.17** (984px) | −66% |
| phone 390×844, DE | 3.80 | 1.25 | −67% |

§16's target was 1.0–2.0 viewports on primary desktop. It lands at **2.23**, and
1.25 of that is `PASSAGE_HOLD` — the held statement frame every passage on the
page gets, shared geometry rather than process content. The chapter's own body
is 0.58 of a screen. Going below the target would mean shortening the hold,
which is the passage system's and not this phase's.

### Share of the journey — §38

| | before | after |
| --- | ---: | ---: |
| desktop, HU | **19.1%** | **8.5%** |
| desktop, DE | 19.0% | 8.4% |
| phone, HU | **26.5%** | **11.0%** |
| phone, DE | 27.4% | 11.1% |

It was the **longest** of eleven chapters on both surfaces. It is now **ninth of
eleven** on desktop — behind `system` 3.39, `full-stratosphere` 2.83,
`lower-atmosphere` 2.69, `selected-work` 2.48, `initial-ascent` 2.43,
`stratosphere-transition` 2.40, `destination` 2.31 and `cloud-entry` 2.23, which
it now ties — and **fifth of eleven** on the phone, behind `system` 1.64,
`lower-atmosphere` 1.55, `calibration` 1.27 and `selected-work` 1.24. On the
phone it had been more than a quarter of the whole homepage.

### The whole track

| | before | after |
| --- | ---: | ---: |
| desktop chapters, HU | 29.85 screens | **26.37** |
| desktop document, HU | 31.73 | **28.25** |
| phone document, HU | 17.21 | **14.95** |
| phone document, DE | 18.21 | **15.66** |

`System → Process → High Altitude` now reads 3.39 → 2.23 → 2.40: a long
structural chapter, a short one, then a master act. Before it was 3.39 → 5.71 →
2.40, where the crossing between two acts took longer than either of them.

---

## I · Mobile — §17

The phone gets the same edit, and needed it more: 26.5% of the portrait journey
before, 11.0% after.

* the three principles stack in the surface's own `PassageItem`, as a name and
  its note — the shape the nine areas above already use;
* native scroll, unchanged. No accordion, nothing hidden, no disclosure widget —
  §17 rules out hiding the content rather than moving it, and it was moved;
* type hierarchy unchanged: `.mv-passage__name` at 1.5rem, notes at 0.94rem;
* the route is `.mv-quiet`, the same quiet link the closing panel uses;
* the whole chapter is 984px at 390×844, so a reader meets the statement, the
  seven names and the first principle in one screen and the rest in the next.

`PassageItem`'s `terms` is optional now. That is the only structural change to
the portrait composition: a principle is a label and one sentence, and a list of
one term under it would be the four-term grid growing back.

---

## J · Locales — §28, §29

All three were compressed together, not Hungarian first and the others
truncated.

* the snapshot recorded **35 units with 0 missing translations**, so every
  sentence that moved had an approved EN and DE to move with it;
* the twenty-eight sentences were relocated from `experiments/src/full/locales/{en,de}.ts`
  into `_build/i18n/szolgaltatasok.json` **as the same strings**. Not one was
  retranslated;
* the three principles' EN and DE are recombinations of those same approved
  translations, except the one clause named in §E;
* the statement is untouched in all three.

**German is the layout stress case and it holds.** The chapter measures 2.23
screens in DE against 2.23 in HU on desktop, and 1.25 against 1.17 on the phone.
All three principle labels set on one line at 1440; principle 3's sentence wraps
to two lines in German and to one in Hungarian, which is the composition
absorbing length rather than fighting it. No overflow at any width measured.
`process-locales.png` is the three-locale sheet.

---

## K · Accessibility and reduced motion — §32, §33, §7 of the passage contract

* **the passage is still entered by the accessibility walk.** `portrait-journey.spec.ts`
  steps 0.45 of a viewport; the compressed chapter is 984px at 390×844 against a
  380px step, and 1 056px in German. It was never close to the floor and it is
  not close now;
* **no giant trailing spacer.** The chapter shrank; its trailing band did not
  grow. Both suites' spacer ceilings are checked in the gate below;
* **the 45vw foot silence is untouched, and that was measured rather than
  assumed** — §33. That length was solved between the walk's floor and the
  spacer ceiling *for the shortest passage on the page*, and the shortest
  passage is still `cloud-breakthrough` (0.48 screens on the phone, 1.38 on
  desktop) — the compressed process is 1.17 and 2.23, well above it. The
  constraint that produced 45vw did not move, so neither did the number;
* **nothing is hidden.** No `display: none`, no `aria-hidden`, no observer and no
  reveal gates any of the three principles or the route: every word is in the
  document, in reading order, at full contrast, in the tab order and announced.
  The chapter marker is still the `sr-only` line first in the section, so the
  walk still finds eleven chapters;
* **reduced motion**: the passage carries no motion of its own to disable. What
  it had was the staging, and staging was scroll distance rather than animation.
  The reduced-motion projects are in the gate below.

---

## L · Performance and motion — §41, §18

### Objects and copy

| | before | after | |
| --- | ---: | ---: | --- |
| DOM nodes in the chapter, desktop | 87 | **22** | −75% |
| DOM nodes, phone | 85 | **19** | −78% |
| text leaves | 38 | **11** | −71% |
| words, HU | 323 | **75** | −77% |
| words, DE | 391 | **84** | −79% |

The passage was already the cheapest state on the page for the renderer — one
draw call and 1 840 triangles, from the previous phase's `act-cost.json` — and
nothing in this change touches the scene, so that number is unchanged. What fell
is DOM and layout work: a quarter of the elements it had, and a chapter 3.5
screens shorter to composite. No rAF work was added or removed; the passage has no
observer, no measurement and no clock, before or after.

No performance investigation was opened, because no regression appeared. — §41

### Motion

None was added. The passage's only movement is the shared reveal and the frame
release both passages already have, and the compressed body uses the same
`.passage__item` box the staged one did. §18 asks for the minimum motion
required; the minimum turned out to be none.

---

## M · Test results — §40

### M1 · What was run

| gate | result |
| --- | --- |
| `npm run test:full` — desktop, mobile-390, mobile-landscape, reduced-motion | **196 passed · 36 skipped · 0 failed** (16.7m) |
| `npm test` — the static site suite, 74 routes | **1 167 passed · 6 failed**, all six on gitignored `dist/_studio-lux/` scratch — see M3 |
| `npm run typecheck` | clean |
| `npm run generate` | 22 pages × 3 locales, **no redefinition warnings, no untranslated strings** |
| `npm run i18n:meridian` | **0/63 untranslated**, EN and DE |
| `npm run audit:conversion:check` | OK — 447 CTAs, 0 broken destinations, 0 wrong-locale destinations |
| `npm run audit:seo:check` | fails on `/_studio/` and `/_studio-lux/` only — gitignored review artefacts from an earlier phase that the crawler walks as routes. Pre-existing, unrelated, and untouched here. No generated route fails |
| `node scripts/process-inventory.mjs` | **40 units · every original unit accounted for** |

### M2 · The contracts that changed, and how they still hold

`full-ascent.spec.ts` and `portrait-journey.spec.ts` each walked seven
checkpoints and asserted that every one named and answered all four of its
terms. That contract went with the content. What replaces it holds the same line
from the other side — the old rule protected against detail being silently
dropped; the new one protects against it silently coming back:

* all seven stage names still appear in the passage, read from `PROCESS`;
* **exactly three** principles, each a level-3 heading and a sentence, matched
  against `messages.ts`;
* `[data-testid^="checkpoint-"]` has **count 0** on both surfaces;
* three of the four term labels are **absent** from the passage (`Amit tőled
  kérünk` is excluded — it is principle 2's label);
* the route exists, says the right thing, and points at
  `/szolgaltatasok.html#folyamat`.

The twenty-eight sentences are checked at their new address by
`scripts/process-inventory.mjs`, which is the §39 no-content-loss verification
and fails if any of the thirty-five original units is missing from where the
audit says it went.

**§34 was respected.** No test-harness refactor. Two test blocks changed because
their subject changed; the reduced-motion suite's unrelated
`enableReducedMotion` debt is untouched and remains open.

### M3 · The static site suite

`npm test`, 74 routes: **1 167 passed · 124 skipped · 6 failed**.

**All six failures are one spec against one directory, and it is not a route.**
Every failure names `dist/_studio-lux/index.html` — gitignored scratch that an
earlier phase's `_build/reports/luxury-art-direction/stage-studio.sh` copied
into the built tree so a render script could reach it. Its own comment says the
next `npm run build` wipes it. `structured-data.spec.ts` walks every HTML file
under `dist/` and asks each one for an `Organization` node, a canonical and a
description; a bare three.js viewer has none of those.

Proved rather than asserted: with the two scratch directories moved aside,
`npx playwright test tests/structured-data.spec.ts` is **16 passed, 0 failed**.
They were then put back — somebody's local review scratch is not this change's
to delete.

**One genuine flake, and it was load.** The first run of the suite also failed
`homepage-chrome.spec.ts › opens from every header state` on the reduced-motion
project — `header never reached "journey"`. It was running alongside the
screenshot scripts; in isolation it passes, and it passed on the clean re-run.
It is not related to the chapter's length: the header's edges are fractions of
the track, and the state the test failed on is at the foot of the page, which is
`destination` before and after.

No route this phase touched fails anything. The services route, the homepage and
all three locale trees are green in both suites.

---

## N · Content removed as redundant — §5, §24

**One sentence, and this is the whole of it.**

> `Egy irány, amelyhez minden későbbi döntés mérhető.`
> EN `A direction every later decision can be measured against.`
> DE `Eine Richtung, an der sich jede spätere Entscheidung messen lässt.`

Checkpoint 3's `Várható eredmény`. It is not on the homepage and it is not on
the services route.

**Why.** The System act makes the same point twice and harder — `A sorrend a
lényeg, nem az, hogy kilenc van belőle.` and ring 0's `Ez dönti el a többit.
Enélkül minden alatta lévő döntés találgatás.` §23 keeps System and Process
separate and §24 forbids repeating a point already made strongly elsewhere;
this sentence is the one place the two chapters said the same thing.

It is recorded in `content-audit.md` as `redundant` with that reason attached,
so restoring it is a one-line change and a documented decision rather than an
archaeology problem. Everything else — all thirty-four other units — is either
on the homepage or on the services route.

---

## O · Remaining limitations

1. **2.23 screens is at the top of §16's 1.0–2.0 target, not inside it.** The
   body is 0.58 of a screen; the other 1.65 is `PASSAGE_HOLD` plus the panel's
   own padding, which is the Editorial Passage system's geometry and is shared
   by all four passages. Bringing the chapter under 2.0 means shortening the
   hold for every passage, which is a design change this phase is not allowed to
   make and probably should not want to.

2. **One clause of new copy.** `Minden szakasznak két oldala van` is not a
   selection from existing strings. §E says which and why; everything else in
   the three principles is approved copy, mostly verbatim.

3. **One source string renamed.** `Indulás` → `Élesítés`, for the dictionary
   collision described in §E. It is a real change to the approved process
   vocabulary, it is more precise than what it replaces, and it is the only one.

4. **A German word changed on three pages' worth of surface** — the homepage's
   `Tervezés` is `Konzeption` now instead of `Gestaltung`, to agree with the
   site. Nothing else moved and the build reports no redefinitions, but a German
   reader who knew the old homepage will see a different word for stage 04.

5. **`components/SystemRings.tsx` is now definitively dead.** It exported
   `Checkpoints`, which read the per-checkpoint altitudes this phase removed;
   nothing has imported the module since the continuity pass, and
   `six-acts.spec.ts` already asserts both of its objects are absent from the
   scene. Deleting it is a clean follow-up and was left out of this change
   because §42 scopes cleanup to code the 35-sentence reveal used, and this
   module predates it.

6. **The services page's process section is long** — 2.2 to 2.5 screens of
   desktop, 3.2 on the phone. That is correct for a reference section on a
   reference page, and it is deliberately not compressed: the whole point of the
   move is that this is the depth at which the detail belongs. It does mean the
   services route grew by roughly that much, which was not measured against the
   other twenty-one pages and is not claimed to be the longest.

7. **The overlap between services `04 · Az ajánlat` and checkpoint 01 is now
   visible on one page.** Both describe a first conversation that may end in a
   no. They are different things — how a proposal is produced, and the first
   stage of the work — and adjacency makes the distinction legible, but an
   editor may want to tighten the join. It was left alone rather than rewritten,
   because rewriting `04` is not this phase's scope.

8. **`FULL_ASCENT_PROTOTYPE.md`'s stage table has one corrected row and eleven
   that were already stale.** Row 8 said `hét ellenőrzőpont, négy kérdésre
   válaszolva` and `3.0`, which this change made false, so it now reads `2.0`
   and describes what the chapter does. The other rows' `share` values predate
   the six-act pass and none of them matches `journey.ts` either — that document
   names `STAGES` as the source of truth, and correcting the whole table is a
   documentation pass rather than part of this one.

9. **`_studio/` and `_studio-lux/` fail two site-suite specs and the SEO audit,
   and always did.** They are gitignored scratch that an earlier phase's
   `stage-studio.sh` copied into `dist/` — the script's own comment says the
   next `npm run build` wipes them — and the structured-data and SEO crawlers
   walk them as if they were routes. Six of the seven failures in §M3 are that.
   Nothing was deleted here: it is somebody's local review scratch, not this
   change's to clear.

---

## Appendix 1 · Code cleanup — §42, §43

Removed, because the 35-sentence passage was their only reader:

* `Checkpoint`'s `happens`, `weProduce`, `youProvide` and `outcome` — the four
  sentence fields;
* `Checkpoint.altitude`. Its two readers were the per-checkpoint altitude stamp,
  removed by the continuity pass as §6 "altitude decoration", and the seven 3D
  markers in `SystemRings.tsx`, which nothing has mounted since;
* the four `checkpoint.term.*` keys in `messages.ts` and `process.lead` — moved
  to the destination page, not deleted;
* 56 entries in `locales/en.ts` and `locales/de.ts` — moved to
  `_build/i18n/szolgaltatasok.json`, as the same strings.

Kept, deliberately:

* `.passage__terms` and `.mv-terms` — the `term — sentence` idiom is still the
  page's only structural idiom and the system passage and the cloud entry both
  use it;
* `.mv-check*` and `.check__*` in the two stylesheets. They were already
  unreachable before this phase, and the previous pass recorded them as a
  deletion to make once the design is visually approved. That is still the right
  time for it, and it is not this change.

**No abstraction was built** — §43. There is no "editorial sequence engine". The
compressed passage is three `<div>`s and a `<p>` inside the `.passage__item` box
that already existed, plus two declarations of spacing. The page got smaller.

---

## Appendix 2 · Review assets — §46, §36, §37

In `_build/reports/luxury-art-direction/process/`:

| file | what it shows |
| --- | --- |
| `process-before-after.png` | the long passage against the compressed one, three frames each, 1440×900 HU |
| `process-desktop.png` | the settled composition, 1440×900 |
| `process-mobile.png` | the 390×844 sequence, in order |
| `process-locales.png` | HU · EN · DE, statement frame and principles |
| `journey-after-process-compression.png` | the whole track, nineteen states, at thumbnail scale |
| `process-detail-desktop-{hu,en,de}.png` | the detail destination on the services route |
| `process-detail-mobile-hu.png` | the same at 390 |
| `content-audit.md` / `.json` | the generated classification and traceability table |
| `inventory-source.json` | the phase-0 snapshot: 35 units × 3 locales |
| `chapter-length-*.json` | every measurement in §H |

No further mockups were produced — §45.

**Static review before motion — §36.** The 1440×900, 390 and German-desktop
states were captured and read before anything was called finished, and the
composition was cut once as a result: the section head on the destination page
lost an invented framing sentence and a forced line break that was hyphenating
`DOL-GOZUNK` across two lines. Nothing in the homepage passage needed a second
compression pass — at 1.1 screens in, the frame holds three labels, three
sentences and one link, and reads as an editorial beat rather than as
documentation.

**Full journey review — §37.** `journey-after-process-compression.png`. The
master acts are still the only monumental frames on the sheet; the process now
contributes two quiet states where it contributed three dense ones, and the run
`System → Process → High Altitude` is 3.39 → 2.23 → 2.40 screens. A visitor
reaches the next master act 3.5 screens sooner than before.

---

