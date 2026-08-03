# Content guide

Everything Stratos publishes sits on one idea: **the competition is still in the
valley.** The site does not describe ascent — it performs it, and the copy has to
earn the altitude the page is claiming.

---

## Voice

Stratos sounds like a good technical partner in a meeting: specific, unhurried,
slightly blunt, never impressed with itself.

**Do**

- Lead with the outcome, then the mechanism. *"More enquiries, because the page
  loads before they leave."*
- Use real numbers, real place names, real client names.
- Say the uncomfortable thing when it is true. *"Most of your traffic already
  bounced."*
- Keep sentences short enough to read on a phone at arm's length.

**Do not**

- Reach for "solutions", "leverage", "synergy", "cutting-edge", "game-changing",
  "digital transformation", "in today's fast-paced world".
- Claim awards, partnerships or certifications that do not exist.
- Invent metrics. Ever. See **Numbers** below.
- Write a paragraph where a clause will do.

### Register by language

| | |
|---|---|
| **Hungarian** | Source language. Informal *te* — this is the existing voice and it is right for the market. Direct, a little dry. |
| **English** | International, not American. Plain over promotional. No exclamation marks. |
| **German** | Formal *Sie*. German business writing punishes casualness; the Hungarian bluntness has to become precision instead. |

Hungarian is the only language written from scratch. EN and DE are generated
from the same markup — see `_build/SZERKESZTES.md`. Translate the *intent*, not
the words: an idiom that lands in Hungarian usually does not survive.

---

## Typography

Three faces, three jobs. Nothing else.

| Face | Job | Rules |
|---|---|---|
| **Aboreto** | Display. Big statements only. | Uppercase, wide tracking. Never below ~2rem. Never for a paragraph, a button or a label. |
| **Instrument Sans** | Body. Everything a visitor reads to understand. | Sentence case. Line length under ~70 characters. |
| **JetBrains Mono** | Data. Altitude, labels, stages, buttons, metadata. | Uppercase, tracked out. Numbers are always tabular. |

The monospace is the site's tell. It says the numbers on screen are measurements,
not decoration — which on this site they are, because the altimeter reads the
document's real structure.

> Hungarian display type carries Á, É, Ő, Ű. Set line-height loose enough that
> the accents do not collide with the line above. This is why `.st__stage h2`
> runs looser than the display face does elsewhere.

---

## Headlines

A headline earns its size by saying something only Stratos would say.

**Working examples from the site**

> A VERSENYTÁRSAID MÉG A VÖLGYBEN ÁLLNAK.
> *Your competitors are still standing in the valley.*

> NEM JÖTT MÉG EL AZ IDEJE, HOGY A VÁLLALKOZÁSOD ELÉRJE A CSÚCSOT?
> *Isn't it time your business reached the summit?*

Both are specific, both use the altitude metaphor structurally rather than
decoratively, and neither would fit another agency's site. That is the test.

**Rules**

- Three to eight words for a display line; up to about twelve across two lines.
- One idea. If it needs a comma and an "and", it is two headlines.
- No headline that survives find-and-replacing "Stratos" with a competitor.
- Question headlines only at a decision point — the closing CTA, not the hero.

---

## Buttons

Monospace, uppercase, verb-first, and always specific about what happens next.

| Use | Avoid |
|---|---|
| Váltsuk valóra | Learn more |
| Kitöltöm a kérdőívet | Submit |
| Ingyenes konzultáció | Get started |
| Start your ascent | Click here |

The primary action on a screen is yellow. There is exactly one. A second yellow
button means neither is primary.

---

## The altitude metaphor

The strongest constraint in this guide, because it is the easiest thing to ruin.

**It is structural.** Every stage declares a real altitude band, and the readout
shows that number when the stage is centred. Services sit at altitudes that
reflect their scope — SME work at 1,200 m, the Impact Program at 30,000 m. The
metaphor is the information architecture.

**Use it when**

- Describing scope, ambition, or where a client is now versus where they could be
- Naming a stage of work
- Marking progress

**Do not use it when**

- It would replace a concrete claim. "We'll take you higher" says nothing;
  "Rapidkert's enquiries came from a page that loads in under a second" says
  something.
- It appears twice in one section. Once per screen. The visuals are already
  carrying it.
- It turns into weather. No "turbulence", "headwinds", "smooth sailing",
  "sky's the limit", "moonshot", "rocket fuel", "next level".

The visual journey does the metaphor. The copy should mostly get out of its way
and talk about business.

---

## Case studies

Real references only: **Rapidkert**, **Barbershop Győr**, **Pille Design**,
**Uncensored Society**, **Brickness Community**.

Structure:

1. **Challenge** — the situation before, in the client's terms
2. **Approach** — what was decided, and why that and not something else
3. **Implementation** — what was actually built
4. **Result** — what changed
5. **Ongoing** — what continues

### Numbers

**Never invent a metric.** Not as a placeholder, not as an illustration, not
"roughly". A fabricated conversion rate is the fastest way to lose a client who
checks, and it is the kind of thing that ends up in a screenshot.

If a number is not verified, write the change qualitatively:

> ✅ "Enquiries went from occasional to steady, and they now arrive with enough
> detail to quote from."
>
> ❌ "247% increase in qualified leads."

When a number *is* verified, give it context — the period, the baseline, and
what was measured. A percentage with no denominator is decoration.

---

## Images

- Alt text describes the content, not the file. `alt=""` only when the image is
  genuinely decorative — and on this site most of the atmosphere is CSS and
  canvas, which needs no alt at all.
- Client work: show the real thing. No laptop mockups floating in gradient.
- People: real photographs of real staff. A stock photo on an agency about-page
  reads as a warning.
- Every image is reduced to 1800 px on the long edge before it goes in
  `assets/img/`.

---

## Legal and factual

- The Hungarian text of the privacy policy and imprint is the binding version.
  EN and DE carry a notice saying so.
- Hosting, company registration and contact details live in
  `_build/pages/impresszum.html` and
  `_build/pages/adatkezelesi-tajekoztato.html`. Both still name Wix as the host,
  carried over from the previous site — **update them before launch.**
- No claim about GDPR, accessibility or certification that has not been checked.
