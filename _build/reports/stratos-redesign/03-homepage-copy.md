# Stratos redesign — 03 · Homepage copy: before / after

Rule applied to every sentence: *if this disappears, do we lose persuasion?* If not, it
went — as a whole block where possible, not shortened.

## Totals (body text of the built HTML, same counter for both)

| | Before (main / whole page) | After (main / whole page) | Main copy |
|---|---|---|---|
| HU | 1,784 / 1,965 words | **284** / 428 | **−84 %** |
| EN | 2,177 / 2,376 | **325** / 489 | −85 % |
| DE | 1,955 / 2,136 | **309** / 457 | −84 % |

This is **past the brief's 50–70 % target**. It is deliberate: every block removed below
already lives, in more depth, on a page that ranks for it. If Search Console shows the
homepage losing its co-ranking for *weboldal készítés* after launch, the first thing to
add back is a short company paragraph — not the pricing argument and not the FAQ. Title,
description and H1 keyword are unchanged, so nothing in the `<head>` changes.

## The new homepage, scene by scene (HU)

| # | Scene | Words (HU, measured) | What it has to make the visitor believe |
|---|---|---|---|
| 01 | Hero — "Olyat építünk, amit nem lehet összetéveszteni." + one line + *Projekt indítása* | 27 | who this is for, in one sentence |
| 02 | Rapidkert takeover — "A felszín csak az utolsó réteg." + ~110M Ft + case study | 24 | exceptional experiences, with a business result |
| 03 | Silence — "Nem mindenhez kell látvány. Csak ahhoz, amit nélküle rosszabbul lehetne elmondani." | 11 | restraint is a choice, not a limit |
| 04 | GoDataFusion — "A valóságból adat." + one line + Capture / Measure / Quantify | 36 | data/system thinking, design + engineering |
| 05 | Capabilities — Élmények · Rendszerek · Növekedés, one sentence each + service links | 49 | three things, done deeply; every service page one click away |
| 06 | Principles + "Nagy szervezeteknek" ledger | 115 | process discipline, senior involvement, code ownership, security, SLA |
| 07 | Selected collaborations — six marks | 2 | established, not advertised |
| 08 | Close — "Ha nagy a tét, beszéljünk." + one line + *Projekt indítása* | 20 | the next step is a conversation |

Every claim in scene 06 is one the site already makes and explains on
`/nagyvallalat` (sprints and demos, source-code ownership, audit before takeover,
access control, audit logging, GDPR, SLA) or in the previous homepage's own copy
("ugyanaz a csapat viszi végig a munkát az első beszélgetéstől").

The Rapidkert figure is the case study's, with its wording: *~110M Ft — ajánlatkérési
érték organikus keresésből* (EN *Quote requests from organic search*). It is not
presented as revenue or profit and is not summed with the ~9M Ft from ads.

## Every removed block

| Block (before) | What it did | Why it is no longer needed | Where the detail lives |
|---|---|---|---|
| **I · Kalibráció** — "Nem weboldalakat építünk. Magasságot építünk." + 45-word lead + "custom instrument" meta | opened the altitude metaphor | the metaphor is retired with the Altimeter; replaced by a claim about the work, not about altitude | — (concept removed) |
| **II · Emelkedés** — "Egy weboldal önmagában nem visz sehova." (76 w) | argued that a website alone is not enough | the argument is made by the Rapidkert result (site + SEO + ads → measurable quote requests) instead of by prose | `/szolgaltatasok` ("Weboldal készítés, és a rendszer körülötte") |
| **III · Alsó légkör** — "Hat terület, egy rendszer." 6-step ladder with altitudes (96 w) | service inventory | a wall of services; replaced by three capability groups | `/szolgaltatasok`, each service page |
| **IV · Felhőréteg** — "Idelent minden zajos." (64 w) | atmosphere: "five agencies, five messages" | atmosphere only; the one-partner argument is on the enterprise page | `/nagyvallalat` ("Miért jobb, mint több beszállítóval?") |
| **V · Áttörés** — "A tisztaság ott kezdődik…" (28 w) | atmosphere | its idea ("fewer tools, one direction") survives as the principle *Előbb redukálunk.* | scene 06 |
| **VI · Munkáink** — "Akikkel együtt emelkedtünk." + 6 marks + Rapidkert featured case (96 w) | proof | **kept and promoted**: Rapidkert is now scene 02 as a takeover; the marks are scene 07; the case's longer paragraph moved to the case study | `/munka-rapidkert` |
| **VII · A rendszer** — "Kilenc terület, három rétegben." 3 rings × 9 nodes (156 w) | method diagram | a process diagram is template material; replaced by principles | `/szolgaltatasok`, `/rolunk` ("Ahogy dolgozunk") |
| **VIII · A folyamat** — "Hét ellenőrzőpont…" 7 × 4 fields (321 w — the largest block) | generic Discovery→Launch process | the brief names this exact pattern as what not to build; the enterprise-relevant parts (sprints, demos, handover, SLA) are in the ledger | `/nagyvallalat` ("Így dolgozunk együtt a bevezetésig", FAQ), `/kkv` |
| **IX · Átmenet** — "Innen már látni a görbületet." (50 w) | atmosphere | metaphor only | — |
| **X · Sztratoszféra** — "Üdv a sztratoszférában." (27 w) | atmosphere | metaphor only | — |
| **XI · Célmagasság** — "Készen állsz felemelkedni?" + contact line + 10-link stage index (83 w) | closing CTA | **kept as scene 08**, without the altitude language and the stage index | scene 08 |
| **Ground** — "Weboldal készítés Győrben és Budapesten", 2 paragraphs | SEO statement written for crawlers under the journey | the H1 keeps the keyword locator; Győr/Budapest stay in the footer with links to the regional pages | `/hol-dolgozunk`, `/weboldal-keszites-gyor`, `/weboldal-keszites-budapest` |
| Ground — "Hat szolgáltatás, egy rendszer" (6 linked services) | internal links with keyword anchors | **kept as links** inside the three capability rows (every service page still linked from the homepage) | scene 05 |
| Ground — "Miért egyszeri projektdíjjal?" | KKV pricing argument | the brief: the homepage must not sell the low-ticket model | `/kkv`, `/blog-weboldal-arak` |
| Ground — "Hogyan dolgozunk" / "Hol dolgozunk" / "Kikkel dolgozunk" | process, location, client mix | process → ledger; location → footer; client mix → the work itself | `/nagyvallalat`, `/hol-dolgozunk`, `/munkaink` |
| Ground — 6-item FAQ (price, timing, WordPress, editing, Győr/Budapest, satisfaction) + its **FAQPage JSON-LD** | SME objections | KKV objections belong to the KKV page; the FAQPage node was removed with the FAQ because structured data may only describe what the page shows (and FAQ rich results have not been shown for this kind of site since 2023) | `/kkv` FAQ, `/rolunk` FAQ, `/nagyvallalat` FAQ — all three carry their own FAQPage |
| Arrival — "EMELKEDÉS BEFEJEZVE · 30 000 M", "Hova vigyük innen a vállalkozásodat?", "A következő szint innen indul." | altitude-themed closing band | replaced by scene 08 | — |
| Footer — "VISSZA 0 MÉTERRE" | altimeter control | instrument language | — |

## What was added that was not there before

* **GoDataFusion** — absent from the old homepage entirely; now the second proof.
* **The enterprise ledger** — four concise answers for large organisations.
* **The Awwwards Honorable Mention** tag on the Rapidkert takeover (verifiable; already on
  the case study).

## Language

German addresses the reader with *Sie* throughout (as the rest of the site since
`0228985`); Hungarian keeps the site's informal voice. Avoided throughout, in all three
languages: *innovatív, modern, kreatív, prémium, next level, full service, teljes körű,
igényeire szabott.*
