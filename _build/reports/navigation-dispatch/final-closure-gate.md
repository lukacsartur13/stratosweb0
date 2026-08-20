# The final closure gate — §49, §51, §55

**ONE run.** Not six, not three. §49 is explicit that this is *"a closure check,
not another statistical campaign"*, and the stop rules were fixed in the driver
before it started, with no rerun-for-green path in it.

## Result

> ## `FINAL CLOSURE GATE: VALID + RED`

| | |
|---|---|
| Run | `final-closure-01` |
| Started | 2026-08-20T11:19:20Z |
| Duration | **1 803 s** (30 min) |
| Preflight | **PASS on attempt 1** |
| Valid | **yes** — `invalidReasons: []` |
| Green | **no** |
| Failed gates | `playwright-main`, `playwright-full` |
| Failing tests | **4** |
| Subject mutation | **none** |
| `dist` canary events | **0** |
| Orphaned processes | **0** |
| Ports still held | **0** |

## §49's conditions, one by one

| Condition | Status |
|---|---|
| quiet host preflight PASS | **yes** — attempt 1: `load1 2.87 (cap 6)`, `iCloud 0%`, ports 4322/4327 free |
| complete manifest coverage | **yes** — `experiments/tests/` and both loose test modules inside the `test` group for the first time |
| same frozen subject | **yes** — see below |
| no iCloud checkout | **yes** — ran in `/Users/arturlukacs/stratos-hermetic/subject`, a git worktree outside iCloud |
| no subject mutation | **yes** — before and after byte-identical in all four groups |
| all required gates | **yes** — all 9 executed |

### The subject, and what moved since G6

All four groups were pinned to a frozen reference for the first time —
`--expect-dist`, `--expect-test` and `--expect-config`, where G6 could assert only
`dist`.

```
before == after (identical):
  combined cf68faefabc95a3ef75ddfcd2a6332694db2116a6a62a2b410edc4ea18a9417b
  product  088c02849aad0e870111fab16585dac6a1caf4fcd1b99893e1e5511682547c84
  test     5203f7ba5e865c3b4977331c73fec70bc6bab1dc10589132fa35f4db536180f2
  config   94c5bf52ccac846c9bb8149f8cda1d55cb78d51c32db5fcc798411cd611b326b
  dist     2538acb4918470f2d172c66df16737819bb41668936f7301fec65cfc396783c3   (186 files)
```

`product`, `config` and **`dist` are byte-identical to G6's**. Only `test` moved,
and it moved for the reason this workstream exists — the group now includes
`experiments/tests/` and the two test-only modules. **A `test` hash that had not
changed would have meant the manifest fix had not taken.**

So the closure gate and the red run it exists to close measured **the same served
bytes**, judged by a strictly larger set of hashed test inputs.

## The four failures

```
[desktop-1920] homepage-chrome.spec.ts:482
   the readout names the stage the journey reports              15 450 ms
   Expected: "rendszer"   Received: "munkáink"

[mobile-390]   mobile-homepage-simple.spec.ts:591
   the altitude advances with the document and settles at the ceiling   5 878 ms
   Expected: 30000        Received: 0

[mobile-390]   mobile-homepage-simple.spec.ts:638
   the menu opens, locks only while it is open, and leaves the ascent where it was   9 013 ms
   expect(|altitude - altitudeBefore|).toBeLessThanOrEqual(60)
   Expected: <= 60        Received: 14970

[desktop]      full-ascent.spec.ts:1342
   the stage announced at a scroll position does not depend on the direction   303 456 ms
```

### THE NAVIGATION DISPATCH FAILURE DID NOT RECUR

Not one of the four is a navigation. There is **no `page.goto` timeout**, no test
at `public-site.spec.ts:264`, no `lastConfirmedState: GOTO_CALLED`, and **no
navigation-boundary bundle was written** for this run. Every one of the four
reached its assertions, which means every one of them navigated successfully.

All four are **the same class**: the scroll-driven journey instrument failing to
track the document.

* altitude reads **0** where 30 000 is expected — the ascent never advanced;
* altitude drifts by **14 970** across a menu open/close where ≤ 60 is required;
* the header stage label and the stage readout **disagree** (`rendszer` vs
  `munkáink`);
* the announced stage **depends on scroll direction** where it must not.

That is one coherent cluster — the altimeter/journey not keeping up with or
resynchronising to the scroll — and it is a different failure from the one this
workstream was chartered to explain.

### `full-ascent.spec.ts:1342` is not new

The same test failed in `g5-02`. It is a known member of this cluster, not a
regression introduced here.

## Host conditions — stated, and NOT used as an excuse

| | G6 (red) | final-closure-01 (red) |
|---|---|---|
| `load1` mean / max | ~5 / low | **26.99 / 112.00** |
| `swapUsedMB` | 3 462, constant | 3 388 → 3 372, constant, near the 4 096 ceiling |
| `browserProcs` | 22-46 | 18-44 |
| `playwright-main` duration | 252 s | **607 s** |
| `playwright-full` duration | 598 s | **929 s** |

The suite ran roughly **2.4× slower** than in G6, at a mean load five times
higher and with swap within 700 MB of exhaustion. The four failures are all
timing-sensitive scroll assertions, which is exactly the class a host in that
state would be expected to break.

**This does not excuse the result, and it is not offered as excusing it.** The
preflight passed, and the preflight's own design is explicit that once it returns
PASS *"the run counts whatever the host does next"* — an asymmetry put there
precisely so that a checker cannot be used to retroactively discount a red run.
`final-closure-01` is VALID and it is RED.

What the host state does obligate is a disclosure: **this investigation caused
it.** The hours of targeted reproduction arms immediately preceding the gate drove
swap to near-exhaustion, and the machine had not recovered when the gate started.
The preflight measures `load1`, iCloud activity and port ownership; it does **not**
measure swap headroom, and on this evidence it should. That is a finding about
the preflight, recorded in `final-report.md` — not a reason to re-run until green.

## §51 — what happens next, and what does not

§51: *"Do not reopen all historical workstreams. Investigate only the exact
failing contract from that final run. Do not automatically start G8/G9/G10
sequences."*

Accordingly:

* **No G8 sequence was started.** No run was repeated. No retry was issued.
* The four failing contracts are named above with their exact assertions, and
  that is where any next investigation begins.
* The navigation-dispatch workstream is **not** reopened by this result: its
  subject did not recur, and nothing in these four failures touches the
  `GOTO_CALLED → REQUEST_EVENT` boundary.

## Verdict — §55

```
MOBILE-390 NAVIGATION DISPATCH ISSUE NOT RESOLVED
HERMETIC REGRESSION GATE: NOT ACCEPTED
REPOSITORY-WIDE MERGE GATE: NOT GREEN
```

§55: *"Do not compensate with retries or repeated runs until a green result
appears."* One gate was run. It was red. It stands.
