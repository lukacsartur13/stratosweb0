# `homepage-history.spec.ts:223` — the restore, frame by frame

**Verdict: REPRODUCED, and the mechanism is NOT the one currently documented.**

## 1. The two things the previous framing got wrong

### It is the SECOND traversal that fails

`:223` asserts the restore **twice**:

| Line | Journey |
| --- | --- |
| `:275` | homepage → footer link → **Back** |
| `:293` | → **Forward** → **Back again** |

Every failure captured in this workstream names **`:293`** — both the
load-induced one and the §20 mutation check. The first version of the
diagnostic exercised only the first Back and passed **48 out of 48**. That was
not evidence that the mechanism holds; it was evidence the diagnostic was
pointed at the wrong leg.

### The document is NOT short when it fails

The mechanism written into `assets/js/home-history.js` is that the browser's
restore is clamped into a document that is still the parsed shell — `y` comes
back as exactly `scrollHeight − innerHeight` of a *small* document. That is what
was measured before the fix, and it is real.

**It is not what happens now.** The captured failure lands at exactly
`scrollHeight − innerHeight` of the **full** document.

## 2. The captured failure

`mobile-390`, load average 49, 1 failure in 18:

```
  t=  0   init-script    reserve read from sessionStorage:
                         {"p":"/index.html","h":14072,"w":390}      correct
  t= 62   y=  4983   h= 14072   reserve=14072px      RESTORE CORRECT
  t= 85   DOMContentLoaded   y=4983                  still correct
  t= 85   load               y=4983                  still correct
  t= 87   pageshow  persisted=false  y=4983          still correct
  t=208   y= 13408   h= 14072   reserve=-            AT THE BOTTOM
```

`13408 = 14072 − 664`, exactly `scrollHeight − innerHeight`.

| | Passing run | Failing run |
| --- | --- | --- |
| stored height | 14072 | 14072 |
| reserve applied | 14072px | 14072px |
| first sampled frame | y = 4983 | y = 4983 |
| `y` at `load` / `pageshow` | 4983 | 4983 |
| document height throughout | 14072 | **14072 — never collapsed** |
| `y` after reserve release | 4983 | **13408** |
| `persisted` | false | false |

**The restore worked.** The position survived `DOMContentLoaded`, `load` and
`pageshow`. It was lost afterwards, on the frame the reserve was released, in a
document that was already at its final height and never shrank.

That rules out all four of the candidate causes the diagnostic was built to
separate: it is not "no restore", not "a late reserve", not "clamped into a short
document", and not "released before the content grew" — the content was never
smaller than the reserve.

## 3. What moved it — an instrumentation gap, now closed

The first capture recorded an **empty** programmatic-scroll log for a page that
had plainly been moved. That is worse than no log, because it reads as proof
that nothing scrolled it.

The wrapper covered `window.scrollTo`, `window.scrollBy` and
`Element.prototype.scrollIntoView`. It did **not** cover `scrollTop = n`, which
is an *assignment* rather than a call, and which is the form GSAP's
`ScrollTrigger` uses — the same `ScrollTrigger` that is visible doing a
`scrollTo(0,0)` / `scrollTo(0,y)` save-restore round trip in the passing
`desktop-webkit` traces:

```
t=1730  scrollTo [0,0]     atY=9078   ScrollTrigger-7Zy99s9Q.js:15:6808
t=1730  scrollTo [0,0]     atY=0      ScrollTrigger-7Zy99s9Q.js:15:6808
t=1732  scrollTo [0,9078]  atY=0      ScrollTrigger-7Zy99s9Q.js:15:7455
```

The accessor is now redefined so `scrollTop =` is recorded with its stack
(commit `4ae0838`). A further 36 executions at load 138 did **not** reproduce —
the failure is rare, roughly 1 in 18 at load 49 — so the culprit is **named as a
hypothesis, not as a finding**: the position is lost to something that is not
`scrollTo`/`scrollBy`/`scrollIntoView`, most plausibly a `scrollTop` assignment
during `ScrollTrigger`'s refresh at the moment the reserve is released.

## 4. WebKit's systematic offset — separate, and within contract

Across 18 clean runs, the restore error was **0 px on every Chromium project**
and **−68 to −83 px on `desktop-webkit`**, appearing at the frame the reserve
releases and the document settles from 21 793 → 21 467 px. This is well inside
the 200 px tolerance and is a different phenomenon from the failure above. It is
recorded because it is the kind of systematic bias that a tightened tolerance
would turn into a wandering failure.

## 5. §20 mutation check — the test does protect the contract

The reserve was deliberately disabled (`root.style.setProperty(PROP, …)` replaced
with a no-op), rebuilt, and `tests/homepage-history.spec.ts` run:

```
3 failed   [mobile-390] [desktop-webkit] [portrait-chromium]  :223
1 passed   [desktop-1920]
```

`desktop-1920` passing is itself informative: Chromium's scroll anchoring
compensates at that size, which is precisely why the file's own header insists
the matrix carry both engines.

**Reverted immediately and verified byte-exact**: `git status` clean on
`assets/js/`, and the rebuilt `dist` hash returned to `2cce7616`, the frozen
reference. The mutation is not committed.

Note: a first attempt at this mutation used a `perl -0pi` substitution that
silently corrupted the file rather than replacing the intended line. It was
caught by hashing, restored from backup, and re-applied with a line-addressed
edit. That is the class of accident the subject manifest exists to catch, and it
caught it.

## 6. Status

```
homepage-history:223 — REPRODUCED (1 in 18 at load 49; 2 of 1271 in a loaded suite run)
failing leg:      the SECOND traversal, forward-then-back  (spec :293)
last confirmed:   restore correct through pageshow; position lost at reserve release
mechanism:        NOT the documented short-document clamp — document was full height
classification:   F — UNRESOLVED (mechanism narrowed, culprit not yet named from evidence)
```

No timeout was raised, no retry added, no tolerance weakened, and the test was
not skipped. §24 and §19.
