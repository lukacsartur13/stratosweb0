# Hermetic regression gate — final report

**Frozen commit: `6fda3ff`** (harness work only; `4ed92e2` plus six focused
commits — no product source was changed). Branch `portal-p1-control-room`.
Nothing pushed, deployed, merged, or migrated.

*The verdict and the six-run matrix are in §8 and §9. Everything before them is
the evidence.*

---

## 1. What this workstream was asked to fix

Not a failing test. A gate whose results could not be interpreted:

> No diagnostic run counts unless the tested artefact is proven unchanged for the
> entire run.

The previous pass spent a long time on an `ESTALE` population and a set of
"navigation-shaped" timeouts before discovering that another process had been
rebuilding `dist/` underneath the suite while it ran. Those numbers were not
wrong; they were **uninterpretable**, and nothing in the harness could say so.
The contamination detector of the day watched CPU — a fine thing to watch, and
not the thing that invalidates a run.

## 2. The architecture

| Property | Mechanism |
| --- | --- |
| Isolated subject | `git worktree --detach` at `/Users/arturlukacs/stratos-hermetic/subject`, outside the iCloud-synchronised directory |
| Subject immutability | four-group SHA-256 manifests (`product` / `test` / `config` / `dist`) captured before and after every run |
| Mid-run mutation | `fs.watch` canaries on six trees, armed for the whole run |
| Immutable artefact | build inside a declared window; result must equal `--expect-dist` |
| Server ownership | the gate starts both servers and records PID/port/ready/stop/exit; both Playwright configs **drop** `webServer` under `STRATOS_GATE_SERVER` |
| Arithmetic | `gate-report.mjs` — `passed + failed + flaky + skipped === collected`, exit 2 otherwise |
| No truncation | full stdout+stderr per gate to disk; no verdict from scrollback |
| Cleanup | every started PID confirmed dead and both ports confirmed released before a verdict |

### The three things this proved about itself

1. **The build is byte-for-byte deterministic.** Two builds from frozen source
   produce an identical `dist` hash; so does every gate run
   (`2cce7616f7f96a0d…` on all of them). This is what makes "build every run and
   require identical bytes" possible, satisfying §51's build gate and §7's
   immutable artefact simultaneously — strictly more information than skipping
   the build.
2. **Hashes and canaries are not redundant.** A `dist/index.html` appended to
   20 s into a run and reverted 2 s later hashed **IDENTICAL** at both ends, and
   the run was still correctly classified `INVALID` on the canary. A final hash
   alone would have called it clean — §43's exact scenario, demonstrated.
3. **It found a hole in the merge gate on its first authoritative run.**
   `playwright.full.config.ts` — the 165-test WebGL suite — declared
   `reporter: [['list']]` and no machine-readable output, so every previous
   green verdict on the heaviest suite in the repository was read off a
   terminal. That is the same arrangement that produced the P2 miscount this
   workstream exists to prevent, still in place and unnoticed. All 165 tests
   passed and the gate still returned
   `RUN hg-01 INVALID — NO_PLAYWRIGHT_JSON_playwright-full`. Had it warned
   rather than refused, the sequence would have produced six confident green
   runs whose WebGL half was never reconciled. Fixed in `6fda3ff`; the sequence
   restarted from RUN 1 per §36.
4. **It caught a real accident.** A `perl -0pi` substitution during the §20
   mutation check silently corrupted `assets/js/home-history.js` instead of
   replacing one line, and the shell reported success because `grep | head`
   returns `head`'s exit status. The hashes caught it; restore-and-rebuild
   returned `dist` to `2cce7616` to the digit.

## 3. Environment, and what is honestly isolated

The subject is outside `~/Library/Mobile Documents`, so `bird` cannot touch it
and no `.icloud` placeholder exists anywhere under it (measured, not assumed).
It is on the **same APFS volume** as the development checkout — "outside iCloud"
means outside the synchronised directory, not different physical storage, and no
claim is made about the device. Build time there is 10.6 s.

**§5 was not fully satisfiable and this is stated rather than glossed.** A second
Claude Code session ran throughout, against unrelated projects, and during the
server-comparison arms it was driving headless Chromium at 175–438 % CPU. It
could not reach the hermetic worktree — that is the whole point of the design —
but it did contend for the machine. Every arm affected is labelled
`CONTAMINATED` by the harness's own classifier rather than quietly reported.

One §45 orphan was found and cleared: `node scripts/test-server.mjs 4399 dist`,
running for seventeen hours since the previous investigation and still serving
the iCloud `dist/`.

## 4. `lead-forms:177` — not reproduced

**66 executions, zero reproductions**: 12 at file level (×3 repeat, all four
carrying projects, 348 tests, `unexpected: 0`), 6 isolated diagnostic, 48
diagnostic under concurrent suite load at **load average 96**.

Every link of the §14 chain fires. Segment timings at load 96:

| Segment | p50 | max |
| --- | --- | --- |
| **post-click → `data-state=invalid`** (what the 15 s budget sees) | **617 ms** | **6 502 ms** |
| submit → fetch requested | 6 ms | 195 ms |
| fetch requested → answered | 200 ms | 1 673 ms |
| answered → DOM state changed | 2 ms | 12 ms |

**2.3× margin at twice the gate's load.** All 48 loaded runs reached the state
via the server's 422, never via the client-side check — so the "wrong producer"
fork (which would fail `toHaveText` after passing `toHaveAttribute`) is
excluded. Hit-tests were clean every time; no `force: true` anywhere.

Carried as **`F — UNRESOLVED`**: absence of evidence is not a close.

## 5. `homepage-history:223` — reproduced, and the documented mechanism is wrong

Two corrections to the standing account:

**It is the second traversal that fails.** The test asserts the restore twice —
`:275` after one Back, `:293` after forward-then-back. Every failure names
`:293`. A diagnostic covering only the first Back passed **48/48** and proved
nothing.

**The document is not short when it fails.**

```
t=  0   reserve read: {"p":"/index.html","h":14072,"w":390}
t= 62   y=  4983   h=14072   reserve=14072px     RESTORE CORRECT
t= 85   DOMContentLoaded / load    y=4983
t= 87   pageshow  persisted=false  y=4983
t=208   y= 13408   h=14072   reserve=-           AT THE BOTTOM
```

`13408 = 14072 − 664` — the bottom of a **full-height** document that never
shrank. The restore succeeded and survived every lifecycle event; the position
was lost afterwards, at the frame the reserve released. That excludes all four
candidates the diagnostic was built to separate, including the "clamped into a
short parsed shell" mechanism written into the product file's header.

The scroll log was empty, which turned out to be an instrumentation gap rather
than a finding — `scrollTop = n` is an assignment and was not wrapped. It now
is. GSAP `ScrollTrigger` is visible doing a `scrollTo(0,0)` / `scrollTo(0,y)`
round trip in the *passing* traces and is the leading suspect, but 36 further
executions at load 138 did not catch it in the act, so it is named as a
**hypothesis, not a finding**.

**§20 mutation check passed.** Reserve disabled ⇒ `3 failed, 1 passed`
(`mobile-390`, `desktop-webkit`, `portrait-chromium` fail; `desktop-1920` passes
because Chromium's scroll anchoring compensates at that size — which is exactly
why the matrix carries both engines). Reverted immediately; not committed.

Carried as **`F — UNRESOLVED`**.

## 6. The concurrent-Python arm — hypothesis withdrawn

The previous pass named this the single most valuable outstanding measurement
and recorded it as **NOT RUN**, because the serial harness could name Python but
not create concurrency and the concurrent harness could not name Python.
`fleet.mjs` now takes `--server node|python|nav`.

| Route | Node (`test-server.mjs`) | Python 3.9 `http.server` |
| --- | --- | --- |
| `/kkv.html`, 5 × 120 | **600/600**, p50 227 ms, max 396 ms | **600/600**, p50 **107 ms**, max 363 ms |
| `/index.html` (1.4 MB WebGL), 5 × 40 | **200/200**, p50 205 ms, max 414 ms | **200/200**, p50 **119 ms**, max 295 ms |

**1 600 concurrent navigations, zero stalls, Python roughly twice as fast on
both routes.** Per §21 the attribution of `page.goto` timeouts to Python's
missing keep-alive is **withdrawn**, not weakened. This does not make shipping
`test-server.mjs` wrong — it fixed a real HTTP/1.0 defect — only its role as the
explanation for the remaining tail.

## 7. A new defect: coverage that disappears under load

`tests/mobile-homepage-simple.spec.ts` gates 26 tests on

```ts
const mounted = (page) => page.locator('[data-testid="mobile-home"]').count().then((n) => n > 0);
```

`locator.count()` **does not wait**. So the gate asks "has the mobile
composition mounted *by this instant*?" and under load answers "no", skipping
the test as `'desktop composition'`.

Two runs of the same commit against the same artefact:

| Run | passed | failed | skipped | collected |
| --- | --- | --- | --- | --- |
| Loaded run 1 (peak load 96) | 1108 | 17 | **146** | 1271 |
| Loaded run 2 (lower load) | 1148 | 2 | **121** | 1271 |

**Twenty-five tests present in one run and absent from the other.** The
arithmetic reconciles in both — that is the point. A load-induced failure is
converted into a reassuring skip, which is worse than a failure because it is
invisible.

Not repaired in this pass: §36 requires the six-run sequence to restart from
RUN 1 on any subject change, and the sequence was already running when this was
found. The correct fix is a deterministic state wait (resolve *which*
composition mounted before deciding), which §24 permits and encourages, plus its
own §40 mutation check and its own frozen sequence.

---

## 8. The six-run matrix

**Frozen commit `6fda3ff`. Six attempts, six VALID runs, zero discarded, zero
subject mutations.**

| Run | Valid | Collected | Passed | Failed | Skipped | Duration | Mean load | Peak load | Subject identical |
| --- | ----: | --------: | -----: | -----: | ------: | -------: | --------: | --------: | ----------------: |
| 1 | VALID | 1436 | 1281 | 0 | 155 | 1227 s | 8.03 | 15.94 | yes |
| 2 | VALID | 1436 | 1281 | 0 | 155 | 1441 s | 13.50 | 32.09 | yes |
| 3 | VALID | 1436 | 1281 | 0 | 155 | 1429 s | 13.77 | 22.90 | yes |
| **4** | VALID | 1436 | **1279** | **2** | 155 | 1420 s | 16.85 | 32.05 | yes |
| 5 | VALID | 1436 | 1281 | 0 | 155 | 1181 s | 10.42 | 26.01 | yes |
| 6 | VALID | 1436 | 1281 | 0 | 155 | 1451 s | 16.05 | 24.64 | yes |

Full detail, per-suite breakdowns and boundary analysis: `six-run-matrix.md`.
Canonical machine-readable state: `final-gate.json`.

### Exact outcome identity

| Property | Identical across six | Value |
| --- | --- | --- |
| Commit | yes | `6fda3ff` |
| `product` hash | yes | `69106294…` |
| `test` hash | yes | `d5e98d86…` |
| `config` hash | yes | `39f6a938…` |
| `dist` hash (before **and** after) | yes | `2cce7616…` |
| Collected | yes | 1436 (1271 main + 165 WebGL) |
| Skipped | yes | 155 (121 + 34) |
| Main suite | 5 of 6 | 1150 passed / 0 failed |
| WebGL suite | **yes, all six** | 131 passed / 0 failed |
| **Failure set** | **NO** | empty in five runs, two entries in run 4 |

### Exact skip-set identity

Hashing the **set of skipped test identities**, not the count:
`9e33218a6d5b8115` in all six runs. **One distinct hash — the same 155 tests
were skipped every time.**

The `mounted()` runtime-skip defect (§7) did not fire anywhere in this
sequence's load range. It was observed at mean load ~96; the authoritative runs
peaked at mean 16.85.

### Subject integrity

Zero subject mutations. Zero canary write events across all six runs. Every run
rebuilt the artefact from frozen source and produced identical bytes. After the
sequence completed, `dist` still hashed `2cce7616…`.

### Load and runtime range

Mean load **8.03 – 16.85**; peak load **15.94 – 32.09**; runtime
**1181 – 1451 s** (19.7 – 24.2 min).

### Chromium renderer status

`tests/harness.spec.ts`: **12/12 passed in every run — 72 assertions, 0
failures.** `desktop-1440` and `desktop-1920` both report
`ANGLE (Apple, ANGLE Metal Renderer: Apple M4)`; `mobile-390` and `mobile-430`
report `Apple GPU`. **No SwiftShader regression.**

### Portal P1/P2 status

`portal*.spec.ts`: **411 collected, 411 passed, 0 failed, 0 skipped, in every
one of the six runs — 2 466 executions, zero failures.** The Portal baseline is
deterministic and was not touched.

### Invalid attempts

One, from the superseded sequence at `4ae0838`:

| Attempt | Reason | Disposition |
| --- | --- | --- |
| `hg-01` | `NO_PLAYWRIGHT_JSON_playwright-full` | Not counted. All 165 WebGL tests passed; the gate refused to certify a run whose results it could not reconcile. Fixed in `6fda3ff`, sequence restarted from RUN 1 per §36. |

**No attempt in the authoritative sequence was discarded.** Six attempts, six
valid runs.

### Remaining limitations

1. **Two wandering failures in run 4** — the reason for the verdict below.
2. `lead-forms:177` — `F — UNRESOLVED` on absence of evidence; it did not appear
   in any of the six runs, nor in 66 targeted executions.
3. `homepage-history:223` — `F — UNRESOLVED`; mechanism narrowed, culprit not
   named. **It did not fail in any of the six authoritative runs.**
4. `mounted()` runtime-skip defect — identified and reproduced, **not repaired**,
   and outside the load range this sequence reached.
5. `node_modules` is frozen by lockfile hashes, not by content hashing.
6. §5 could not be fully satisfied: a second session shared the host, though it
   could not reach the hermetic subject.

## 9. Verdict

```
HERMETIC REGRESSION GATE NOT ACCEPTED

REPOSITORY-WIDE MERGE GATE: NOT GREEN
```

**Why, precisely.** Every acceptance condition but one is met:

- six valid runs — **yes**
- zero subject mutation — **yes**
- identical commit and all four subject hashes — **yes**
- identical collected — **yes**
- identical skip **set**, not merely count — **yes**
- all arithmetic reconciles, twelve of twelve — **yes**
- all required constituent gates in every run — **yes**
- no timeout, retry, skip or force workaround introduced — **yes**
- renderer canary and Portal P1/P2 clean throughout — **yes**
- **identical failure set — NO**

Two tests failed in run 4 and in no other run:

```
[desktop-1440]      homepage-chrome.spec.ts:1005
                    expect(locator('#menu')).toBeVisible() — Received: hidden
[portrait-chromium] homepage-modality.spec.ts:96
                    Execution context was destroyed, most likely because of a navigation
```

§37 of the stabilization brief and §12 of the completion brief are both
explicit: a wandering failure is disqualifying regardless of green rate, and
`ACCEPTED WITH DOCUMENTED LIMITATIONS` may not be used to hide nondeterminism.
5/6 green with a failure set that changes between runs is exactly the "mostly
green" outcome the workstream exists to refuse.

**What the sequence nonetheless established.** The gate architecture itself is
sound and is the part that was previously missing: the subject is now provably
immutable across a run, the arithmetic is closed by a program, the WebGL suite
is counted for the first time, no process or port leaks, and 1 434 of 1 436
tests are deterministic across six runs. The remaining nondeterminism is
two tests, named, with their boundaries recorded — not an uninterpretable
result.

**The `mobile-390 page.goto` stall is not pursued further.** It did not
reproduce in 24 010 prior navigations, in 1 600 concurrent navigations across
two servers, or in any of the six authoritative runs. Neither surviving failure
is a navigation stall: one is an assertion that evaluated against a hidden
element, the other a navigation race. No root cause is invented for it.

## 10. Recommended next steps, in order

1. **Fix `mounted()`** (§40): replace the instantaneous `count()` with a
   deterministic wait that resolves which composition mounted, mutation-check
   it, then restart the six-run sequence from RUN 1.
2. **Finish `homepage-history:223`**: the `scrollTop` accessor instrumentation is
   now in place; run the two-leg diagnostic under load until it catches the
   mutation in the act and names the caller.
3. **Leave `lead-forms:177` alone** until it reproduces. It has 2.3× margin and
   no defect has been demonstrated in it.
4. **Decide on the Node/Python latency gap** separately — Python is consistently
   ~2× faster and neither server fails. This is not urgent and is not a gate
   question.
