# Scroll / Altimeter four-contract review — final report

```
SCROLL / ALTIMETER FOUR-CONTRACT REVIEW: RESOLVED
FINAL HERMETIC CLOSURE GATE: GREEN
REPOSITORY-WIDE MERGE GATE: GREEN
REGRESSION-HARNESS WORKSTREAM: CLOSED
```

Nothing pushed. Nothing merged. Nothing deployed. No P2 migration applied.
Portal P3 not begun.

---

## §48 — what was found, separated

### Product defects found — **one**

**`assets/js/header.js` — `Stratos.header.push()` discarded the pushed altitude
and stage label on any frame whose progress had not moved past the paint gate.**

The gate is a scroll-noise filter, and it is correct on the 66 generated routes
where `paint` *derives* both values from `p`. The two homepage compositions do
not derive them — they push them, from a damped clock and a stage map that move
while `p` does not: the clock's final approach steps below the gate, and
`calibrate()` moves a stage boundary under a stationary page whenever a late
image decodes. `last` advances only when a paint happens, and by then the page
has stopped, so nothing corrected it.

Measured at 1920 × 1080, gate = 9.6 px of a 22 248 px track:

```
scrollY 13 176   deck: "Munkáink  16 993 m"   instrument: "17 000 m  RENDSZER"
```

still disagreeing 2.5 s later, at rest — 3 of 21 settled positions across that
boundary. `evidence/contract-a-defect-13176.png` is the screen.
After the fix: **0 of 21**, with the boundary crisp at 13 176 from either
direction.

Reported by `homepage-chrome.spec.ts:482` in `final-closure-01`. Fixed in
`a1e8ddb`, committed on its own.

### Test defects found — **two, one cause**

**`tests/mobile-homepage-simple.spec.ts:591` and `:638`** both read the portrait
telemetry `200 ms` after a programmatic scroll. `ascent.ts` coalesces to one
reader pass per animation frame — deliberately; it is the whole portrait
performance architecture — so the readout is written on a *frame*, and 200 ms is
four frames on a quiet host and none at all under five parallel WebGL pages.

The gate's two numbers are literally the readings for the position the page was
at *before* the scroll: the top of the document reads **0**, and `scrollY 5200`
settles at exactly **14 970 m**. Neither is a drift and neither is a fall to sea
level. The product is correct.

Fixed in `5fd6fdb`: a named readiness condition covering the deck's height, the
scroll position and the reader's frame — in that order, because a scroll
instruction is not the end of a scroll.

### Brittle test found — **one**

**`experiments/tests/full-ascent.spec.ts:1342`** — a constant 300 s budget over
twenty damper settles whose wall-clock cost is inversely proportional to the
frame rate the harness grants. It has now timed out twice (`g5-02` 306 645 ms,
`final-closure-01` 303 456 ms), both by one to two per cent, and **neither run
reached an assertion**. Fixed in `2215ef9`: the constant is a floor, and the
budget is measured against the very wait it is a budget for.

### Stale contracts found — **none**

All four protect current behaviour. Not one of them mentions terrain, a camera
journey, old WebGL mobile composition, continuous scroll interpolation, the old
stage flow or the old Altimeter disappearance. Nothing was deleted and no
assertion was weakened, so §18 never needed to be invoked.

### Navigation anomaly — historical, unresolved, and it recurred once

**It reappeared, naturally, for the first time.** Not in the gate — in the §34
safety run of the main suite:

```
[mobile-390] public-site.spec.ts:264  /kkv.html responds and has a title and description
Test timeout of 30000ms exceeded — page.goto
lastConfirmedState: GOTO_CALLED     statesReached: ["GOTO_CALLED"]
durationMs 30 003   host loadavg 5.16 / 18.59 / 29.06, free memory 2 309 MB
```

Same identity, same boundary, same shape as the historical anomaly: bounded to
pre-network dispatch, ~27 100 targeted reproductions without recurrence. It is
**not conflated with the four contracts** — it is a different test, a different
file, a different failure mode, and it did not occur in the closure gate, which
ran `public-site.spec.ts` clean on every project and wrote no navigation-boundary
bundle.

Per §40 it is left documented and was not made an active blocker: the generic
navigation investigation was not restarted, no G7 was created, and the harness
workstream was not reopened. The recurrence is recorded here so the next
investigation starts from a real observation rather than from a memory of one —
it happened on a host the stress campaign had driven to 2.3 GB free, which is
consistent with the resource-pressure correlation already noted and is one more
data point, not a conclusion.

### Rapidkert experiment conflict — separate and excluded

`experiments/src/full/content.ts` versus `full-ascent.spec.ts:388` is untouched.
It remains an unresolved source-of-truth decision, it was **not staged**, and it
is not part of any commit in this workstream. `git add` was used with explicit
paths only; `git add .` was never run. The in-flight working tree still carries
it, along with the other uncommitted Rapidkert edits, exactly as it did at the
start.

---

## §51 — the success standard, item by item

| | |
|---|---|
| all four failures understood | **yes** — each reproduced and instrumented to the frame where behaviour diverges from expectation |
| each classified correctly | **yes** — one product defect, two test defects with one cause, one brittle test; §3 grouping is three populations, not one and not four |
| no stale assertion retained | **yes** — none found, nothing weakened, nothing deleted |
| no product defect hidden | **yes** — and the mutation pass is what proved it: the contract that *reported* the defect could not catch it on demand, so a contract that can was added |
| mutation checks prove coverage | **yes** — 10 mutations, 6 killed a contract, 4 recorded as not-caught with the reason each turned out not to break the claim |
| targeted stress passes | **yes** — 400 + 400 isolated, 2 400 combined, 20 contended for D, all 0 failures |
| one final hermetic gate passes | **yes** — `VALID + GREEN`, one run |

## The thing this workstream nearly got wrong

The product fix alone would have produced a green suite and **no coverage of the
defect it had just fixed**. With the defect deliberately restored,
`homepage-chrome.spec.ts:482` — the test that reported it — passed **10 of 10**.
It witnesses the disagreement only when the journey happens to settle inside a
~9 px band above a stage boundary, and where that band falls depends on where
`calibrate()` put the boundary on the run. It caught the real thing once, by
luck.

That is what §30 is for, and it is the only reason the strengthened contract
exists.

## What was not done

* No harness workstream reopened. No G7. No generic navigation investigation.
* No test infrastructure redesigned. `manifest.mjs`, the gate runner and the
  thresholds are untouched; the `config` hash is byte-identical to
  `final-closure-01`'s.
* No `IntersectionObserver`, no new scroll listener, no new resize or
  `visualViewport` listener, no forced layout loop, no per-frame geometry read.
* No DPR change, no stacking change, no departure-contract change.
* The accepted portrait architecture is intact: native document scroll, no
  portrait terrain, one persistent Canvas/GLB, the fixed pointer-transparent
  overlay, authored finite states, copy above the instrument, no
  layout-measurement feedback loop.
* Desktop cinematic behaviour is unchanged except for the one repaint condition
  §5 permits, which is where the desktop product defect was proved.

## Commits

| | |
|---|---|
| `a1e8ddb` | `fix: paint the deck when the journey moves and the scroll does not` |
| `bbd2913` | `test: hold the deck's stage contract where it can actually be broken` |
| `5fd6fdb` | `test: wait for the portrait ascent to have read the position it was sent to` |
| `2215ef9` | `test: derive the direction contract's budget from the frame rate it gets` |

Product and test are separate commits, as §29 requires. Four files changed, 254
insertions, 8 deletions.

## §50 — stop

Not pushed. Not merged. Not deployed. No P2 migration. No Portal P3. The gate was
not run again.
