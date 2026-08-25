# Editorial redesign — execution plan

The ascent, the reverse-gravity grammar, the Altimeter, the portfolio IA and
every strategic claim stay exactly as they are. What changes is how a chapter is
*staged*: the type hierarchy, the composition, and what the background does for
the type.

---

## The three layers, and what they are made of

| | role | what it is | treatment |
|---|---|---|---|
| **A · STATEMENT** | the scene | the chapter headline, already written | monumental — 68px at 1440 in a column, up to 112px where the frame allows it. Leading 0.95–1.0, tracking −0.03em, `text-wrap: balance` off in favour of authored breaks |
| **B · LINE** | the clarification | ONE short sentence | 1.15rem, `--paper`, max 38ch, one or two lines. Never a block |
| **C · NOTE** | the annotation | short editorial or technical remarks | mono `--data`, 0.7rem, 0.16em tracking, `--haze`, each on its own hairline, placed off-axis |

**No new words are written.** Where a scene currently carries a paragraph, the
paragraph is split at its own sentence boundaries into a B line and a set of C
notes — in all three locales, from the strings that are already there. Nothing
is deleted and nothing is invented.

## The statement escapes the column

The single biggest reason the page reads as conventional: the headline is
confined to the same ~470px column as the body, so it can never be more than
medium-sized. A monumental statement needs a wide measure.

It gets one **where the geometry allows it**, and that is measured rather than
assumed: `statementRoom()` asks whether the lead band clears the instrument's
projected silhouette at this stage's settled altitudes. Where it does, the
statement runs to `min(58vw, 62rem)`; where the dial reaches up into the sky
band — the ground stage, where it is at its largest — it keeps the column.

That produces the scale rhythm as a by-product rather than as a decoration: the
low chapters are held tighter because there is an instrument in the frame, and
the high chapters open out because there is not.

## Scene by scene

Every scene is given a `data-scene` archetype. Adjacent chapters never share
one.

---

### I · GROUND — `calibration` · 0 m

* **Role** — the lowest point. Dense air, an instrument, and a claim.
* **Statement** — "Nem weboldalakat építünk. / **Magasságot** építünk." Column
  width (the dial is at its largest here), but at the hero tier: 4.6rem at 1440
  against 3.1 now, leading 0.98.
* **Line** — the promise, alone: *"Előbb megnézzük, hol tartasz — aztán
  megépítjük a rendszert, amivel feljebb kerülsz."*
* **Notes** — the premise, demoted: *"A legtöbb vállalkozás a földön versenyzik…
  Mi máshol dolgozunk."* plus the instrument note. Both mono, both small, set
  against the lower right where the ground haze is densest.
* **Staging** — the ground layer is the stage: dense at the bottom, the
  statement written into the clear air above it.
* **Placement** — statement upper-left, actions under the line, notes bottom.
* **vs. now** — a three-sentence paragraph at body size directly under the
  headline is replaced by one line and two annotations. Same words.

### II · LIFT-OFF — `initial-ascent` · 150–3 000 m · scene `annotated`

* **Role** — the argument for a system rather than a website.
* **Statement** — "Egy weboldal önmagában / **nem visz sehova.**" Wide measure.
* **Line** — *"A Stratos integrált növekedési rendszereket épít: … ugyanabba az
  irányba mozdul."*
* **Notes** — the four-sentence paragraph becomes **four annotations**, which is
  what it already was: one premise and three failure conditions, each on its own
  hairline. *"A weboldal egyetlen alkatrész." / "Ha nincs mögötte stratégia…" /
  "Ha nincs mellette hirdetés…" / "Ha nincs utána mérés…"*
* **Staging** — the annotations sit as a narrow column offset from the
  statement, so the scene reads as a diagram rather than as prose.
* **vs. now** — two body paragraphs stacked under a medium heading.

### III · ASCENT — `lower-atmosphere` · 3 000–6 000 m · scene `index`

* **Role** — what Stratos does, as a sequence.
* **Statement** — "Hat terület, / **egy rendszer.**" Wide.
* **Line** — the existing lead, unchanged: it is already one sentence.
* **Notes** — each capability's altitude, already present, set as the index
  marks they are.
* **Staging** — the six capabilities become a wide altitude index: altitude
  mark, name, one line, on a hairline, at a much larger name scale than now.
* **vs. now** — a narrow three-column ladder inside the copy column.

### IV · LAYER — `cloud-entry` · 6 000–8 500 m · scene `dense`

* **Role** — the noise. The one scene allowed to feel enclosed.
* **Statement** — "Idelent / **minden zajos.**" Wide, and the largest tier: two
  short words carry a whole frame.
* **Line** — *"Nem a zaj a probléma, hanem hogy a legtöbb rendszer benne is
  marad. Aki fel akar jutni, annak előbb el kell döntenie, mit hagy el."*
* **Notes** — the three symptoms as three annotations: *"Öt ügynökség öt
  különböző dolgot mond." / "A hirdetés más üzenetet visz, mint az oldal." /
  "Az analitika mást mér, mint amit a vezetőség lát."* plus *"Ez a réteg
  mindenkinek ugyanolyan sűrű."*
* **Staging** — the densest wash on the page; the scene closes in.
* **vs. now** — two paragraphs of equal weight.

### V · BREAKTHROUGH — `cloud-breakthrough` · 8 500–11 000 m · scene `open`

* **Role** — the turn. One idea, nothing else.
* **Statement** — the long one, at the widest measure and the largest tier, with
  its authored break. Nothing shares the frame with it.
* **Line** — *"Nem több eszköz kell. Kevesebb, de egy irányba állítva."*
* **Notes** — one: the altitude band. Nothing more.
* **Staging** — the wash all but disappears; the sky opens behind the type.
* **vs. now** — the same content at two thirds the scale with a card's worth of
  padding around it.

### VI · PROOF — `selected-work` · 11 000–17 000 m · scene `proof`

* **Role** — evidence, logo-led, one case.
* **Statement** — "Akikkel / **együtt emelkedtünk.**"
* **Line** — the existing lead.
* **Notes** — *"Nem mindegyikről van esettanulmány."* becomes an annotation
  rather than a subtitle; the rail's own title becomes a technical label.
* **Marks** — a quieter, wider rail on a single hairline, plated as now, nothing
  recoloured. It reads as a register of names encountered on the way up.
* **Rapidkert** — stays the sole feature and gets *less* chrome, not more: a
  label, the name, the landscape frame, the sourced figure at display scale
  (`~15M Ft` as a number, not a line of body text), one line of what the work
  was, two exits. No description list, no metrics grid, no second image.
* **vs. now** — a rail with a heading and a subtitle, then a stacked block where
  the metric is the same size as the prose around it.

### VII · SYSTEM — `system` · 17 000–22 000 m · scene `annotated`

* **Role** — the architecture.
* **Statement** — "Kilenc terület, / **három rétegben.**" Wide.
* **Line** — the existing lead.
* **Notes** — the three ring notes become annotations under their layer names.
* **Staging** — the three layers set as a wide index against the rings behind
  them: layer number at display scale, name large, the nine areas as small
  paired entries.
* **vs. now** — three bordered columns of equal-weight text.

### VIII · METHOD — `process` · 22 000–25 500 m · scene `index`

* **Role** — precision and execution.
* **Statement** — "Hét ellenőrzőpont, / **találgatás nélkül.**"
* **Line** — the existing lead.
* **Notes** — the four terms per checkpoint stay, at annotation weight; the
  checkpoint number goes to display scale and the name grows.
* **vs. now** — seven identical four-column definition lists.

### IX · THIN AIR — `stratosphere-transition` · 25 500–28 000 m · scene `dense`

* **Statement** — "Innen már / **látni a görbületet.**"
* **Line** — *"Üzletileg ugyanez történik: … merre tovább."*
* **Notes** — the first paragraph split in two: *"Ebben a magasságban a levegő
  nyolcvan százaléka alattad van."* / *"Kevesebb a zaj, messzebb ellátni…"*
* **vs. now** — two paragraphs.

### X · STRATOSPHERE — `full-stratosphere` · 28 000–30 000 m · scene `open`

* **Statement** — "Üdv a / **sztratoszférában.**" The largest tier on the page.
* **Line** — the existing lead.
* **Notes** — the altitude band alone.
* **Staging** — the emptiest frame on the page. Nothing but type and air.

### XI · ARRIVAL — `destination` · 30 000 m · scene `arrival`

* **Role** — the ending, and the conversion.
* **Statement** — "Készen állsz / **felemelkedni?**" at the arrival tier.
* **Line** — the existing lead.
* **Actions** — the primary at a larger scale, the secondary quieter, held
  together as one block rather than as a button row.
* **Notes** — the contact line and the stage index, both at annotation weight;
  the index becomes an altitude ledger rather than a link list.
* **Staging** — maximum openness, the Earth limb, and no wash at all behind the
  type where the sky is already dark enough to carry it.

---

## What the background does now

1. **It frames the statement.** The lead band's wash becomes a *stage light*
   whose size and density are a property of the scene, not a constant: `open`
   scenes get almost none, `dense` scenes get a deep one, `proof` and `index`
   scenes get one wide enough to carry a display figure.
2. **It varies with altitude**, as it already did — ground haze out by 9 000 m,
   the cold opening widening with the climb.
3. **It creates the air.** Statement, line and notes each get their own measure,
   so the vertical rhythm of a scene is three different widths rather than one
   column of same-width text.

## Risks accepted

* A monumental statement is a taller lead band, which moves `--lead-h` and can
  flip a chapter from `whole` to `lead`. Both branches are already measured and
  both are compositions; the flip is checked in the review.
* German is the long case. Every tier is a `clamp()` with a `vw` term, and the
  statement's measure is capped in `ch` as well as in `vw`.
* The mobile page keeps a smaller ceiling: a phone headline that produces
  one-word lines is worse, not better, and §20 of the mobile brief already rules
  it out.
