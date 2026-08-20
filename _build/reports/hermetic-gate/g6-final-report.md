# G6 — quiet-host closure gate: final report

# LEAD.JS SILENT-DROP PRODUCT DEFECT RESOLVED
# G6 QUIET-HOST CLOSURE GATE: NOT GREEN
# REPOSITORY-WIDE MERGE GATE: NOT GREEN

---

## Current frozen subject

| | |
| --- | --- |
| Worktree | `/Users/arturlukacs/stratos-hermetic/subject` (hermetic, outside iCloud) |
| Commit | `48811e991089dd8cb73f23ec1c6ae880446cff6f` |
| product | `088c02849aad0e870111fab16585dac6a1caf4fcd1b99893e1e5511682547c84` |
| test | `2d561c3320f5c51b2432ae96d81782fc337ee30d864cc41daa5f2093e8165a8e` |
| config | `94c5bf52ccac846c9bb8149f8cda1d55cb78d51c32db5fcc798411cd611b326b` |
| dist | `2538acb4918470f2d172c66df16737819bb41668936f7301fec65cfc396783c3` (186 files) |
| combined | `660f76198c30f6f9a843908ef2cf822b6b5701bfdacc93e6d630311b6b5db269` |

Byte-identical to the subject that completed G5. No build, no edit, no
reconfiguration between the two sequences, and none between runs within G6
(`--skip-build`, per §21).

---

## Why G6 exists

G5 produced six valid runs and four green ones. Everything hermetic held —
immutable subject, stable skip set, deterministic Portal, active ANGLE Metal —
and the non-green population correlated strongly with abnormal host contention.
One run, `g5-02`, executed at a mean 1-minute load of 88.15 and a peak of
186.37 against a normal green-run mean of about 6.2, while `fileproviderd`,
iCloud materialisation and interactive application helpers were consuming the
machine.

The wrong response to that observation is to look at a red run, notice the load,
and decide it did not count. G6 was constructed to make that impossible: define
the host conditions under which an authoritative run may **begin**, fix them in
writing beforehand, and then measure the same frozen subject under them and live
with the outcome.

The question G6 asks is narrow, and deliberately so:

> Does the existing frozen subject produce repeatable green repository-wide
> results when the authoritative run **begins** on a controlled host?

The answer is **no**.

---

## Prospective host-health policy

[`host-health-policy.md`](host-health-policy.md), written and fixed before the
first attempt. Its governing rule:

> **Host health is a precondition to STARTING an authoritative run.** Once
> preflight returns `PASS` and the gate begins, the run counts — whatever the
> host does afterwards.

Checks: repository conditions (§9), port ownership across every address family
(§10), competing test/build workloads (§11), iCloud `bird`/`fileproviderd`
activity (§12), interactive application saturation (§13), CPU and load with
trend and cause (§14), and memory pressure (§15). The load cap of 6.0 was
derived from this host's own clean baseline — the within-run quiet floor of
every green G3 and G5 run fell between 1.62 and 5.06 — rather than invented from
a single historical reading.

The policy states explicitly what does **not** invalidate a started run: CPU
spikes, rising load to any value, background processes waking, iCloud
synchronising, or an application saturating cores. Only the pre-existing
hermetic conditions — subject mutation, canary writes, server-ownership failure,
hash mismatch, harness corruption — can invalidate.

**No retroactive exemption was created, and none was needed.** `g6-01` did not
fail under load.

---

## Preflight results

Full detail: [`g6/preflight-summary.md`](g6/preflight-summary.md).

| # | Attempt | Verdict | load1 | Blocking check |
| --- | --- | --- | --- | --- |
| 0 | tool validation | `WAIT` | 1.62 | competing automation workload |
| 1 | `g6-01` | `WAIT` | 1.37 | `chrome-headless-shell` 34.6% sustained |
| 2 | `g6-01` | **`PASS`** | 1.22 | — (18/18 checks) |

Both WAITs were caused by leftover `chrome-headless-shell` browsers from an
unrelated Playwright automation server. Nothing was killed; the workload was
allowed to settle to 0.0% sustained and preflight was re-run.

The detector initially matched only the string `playwright`. The driver
processes were idle at 0.0% while the browsers they had started were consuming
the machine — matching only the driver would have returned `PASS` and begun a
performance-sensitive WebGL gate alongside a live browser workload. This was
corrected before any authoritative run began.

`g6-02` and `g6-03` have no preflight rows: they were never reached.

---

## g6-01

# VALID + RED

| | |
| --- | --- |
| Started | 2026-08-20T03:25:45Z, after a passing preflight |
| Duration | 1 108.7 s |
| Mean / peak load | 5.50 / 11.28 |
| Collected / passed / failed / skipped | 1450 / 1294 / 1 / 155 |
| Subject before → after | identical |
| Canary writes | 0 |
| Orphaned processes / ports held | 0 / 0 |
| Non-Playwright gates | 7 / 7 pass |

### The single failure

```
[mobile-390] public-site.spec.ts:264 /nagyvallalat.html responds and has a title and description
```

Classified using the existing boundary instrumentation, per §29. **No new
navigation investigation was opened.**

| | |
| --- | --- |
| `lastConfirmedState` | **`GOTO_CALLED`** |
| States reached | `GOTO_CALLED`, and nothing further |
| `gotoResolved` | `false` |
| Target | `http://127.0.0.1:4322/nagyvallalat.html` |
| Elapsed | 30 003 ms against a 30 000 ms test timeout |
| Browser network events | **0** — total, failed, pending and mainDocument all empty |
| Server-side log lines for this navId | **0** |
| Page state at failure | `about:blank`, `readyState: complete`, empty body, no crash, no page errors, no console errors |
| Worker | `mobile-390` w19, 11 tests and 11 navigations already completed |
| Preceding navigation | `http://127.0.0.1:4322/kkv.html` — succeeded |
| Same route, same run, other projects | `desktop-1440` and `desktop-1920` both served `200 | 39802 bytes` |
| Load at failure | 4.17 / 3.63 / 2.65, 927 MB free |

**Where it stopped, precisely:** `page.goto` was called and the navigation never
left the browser. Playwright's own network instrumentation recorded zero
requests — not a pending request, not a failed request, *no request at all* —
and the server never saw one. The page remained on `about:blank` with a complete
ready state for the full thirty seconds.

This is **not** a server stall, a slow response, or a page-load hang. The same
document was served successfully to two other projects in the same run from the
same server. The boundary is inside the browser, before the request is issued.

This is the failure family §21 of the earlier workstream was written for: a bare
`Timeout 30000ms exceeded` that must not be classified as a navigation stall
without artefacts. Here the artefacts exist and they exclude the network
entirely. The bundle is preserved at
`_build/reports/final-navigation-boundary/failures/g6-01/` — `meta.json`,
`timeline.json`, `network.json`, `server.json`, `page-state.json`,
`response-signature.json` and a screenshot.

---

## g6-02

**NOT STARTED.** `g6-01` was valid and red, and §35 forbids rerunning to obtain
three green results. The predefined sequence had already failed; continuing
would have been result-shopping with extra steps.

## g6-03

**NOT STARTED**, for the same reason.

---

## Exact skip-set identity

| | |
| --- | --- |
| g6-01 skip-set hash | `bb65b6846f9975fa5b2cb3a73439adc1ae56ab8e09933c6dbaf43fb05a837cee` |
| Skip count | 155 (main 121 + WebGL 34) |

Byte-identical to G5's, and to G3's before it. The skip set has now been stable
**by identity, not by count**, across three independent sequences on two
different commits. Two runs can each skip 155 tests and skip 155 different
tests; this hash is what rules that out.

---

## Product / test / config / dist integrity

| | Before | After | Verdict |
| --- | --- | --- | --- |
| product | `088c0284…` | `088c0284…` | identical |
| test | `2d561c33…` | `2d561c33…` | identical |
| config | `94c5bf52…` | `94c5bf52…` | identical |
| dist | `2538acb4…` (186) | `2538acb4…` (186) | identical |
| combined | `660f7619…` | `660f7619…` | identical |

Canary writes **0**. Orphaned processes **0**. Ports still held **0**. Servers
owned by the run and confirmed dead at the end. The subject was demonstrably one
thing from beginning to end.

---

## WebGL

| Collected | Passed | Failed | Skipped | Reconciles |
| --------: | -----: | -----: | ------: | ---------- |
| 165 | 131 | **0** | 34 | ✅ |

**Green.** This is the sharpest single contrast with G5, where the load outlier
manifested here as two `full-ascent.spec.ts` failures. Under a controlled start
the WebGL suite passed without incident, and no WebGL failure boundary needed
recording because there was no WebGL failure.

It is worth stating plainly: G6's controlled start appears to have removed the
WebGL failure mode that dominated G5's non-green population. It did not remove
the failure that actually stopped the sequence.

## Renderer

`tests/harness.spec.ts` › 'the rasteriser is either hardware, or declared' —
4 / 4 executions passed. ANGLE Metal active. No SwiftShader regression.
`STRATOS_SOFTWARE_RASTER` never set. No renderer flags changed during G6.

## Lead regression

Silent-drop contract set: **32 / 32 executions passed, 0 failed.** Whole
`lead-forms.spec.ts` file: **128 / 128 passed.**

That includes `Impact Program application › maps the application into the lead
schema`, which was G5's single `g5-06` failure and did not recur here. The
silent-drop defect itself has never failed in any run of any sequence since the
fix. The historical stress evidence (500/500 targeted, 968/968 lead surface,
mutation A/B/AB/C all detected) stands and was not repeated.

## Portal P1/P2

**411 / 411 executions passed, 0 failed, 0 skipped.** Green in every run of
every sequence to date. Portal was not modified. Portal P3 was not begun.

---

## Comparison with G5

The two sequences are **not** combined into one population. They ran under
different execution policies and answer different questions.

### G5 — historical, original policy

Six runs, started whenever the harness was ready. `6 / 6 VALID · 4 / 6 GREEN`.
Failures:

| Run | Failures |
| --- | --- |
| g5-02 | 4 — `full-ascent.spec.ts:1342`, `full-ascent.spec.ts:1500` (WebGL, desktop), `mobile-homepage-simple.spec.ts:1089` (mobile-390 and mobile-430) |
| g5-06 | 1 — `lead-forms.spec.ts:472` (desktop-1920) |

Mean load 6.20 – 88.15. Every failure wandered; none reproduced across runs.

### G6 — prospective host-health closure policy

One run started, after a passing preflight that had twice returned `WAIT`.
`1 / 1 VALID · 0 / 1 GREEN`. One failure:

| Run | Failures |
| --- | --- |
| g6-01 | 1 — `public-site.spec.ts:264` (mobile-390), boundary `GOTO_CALLED` |

Mean load 5.50, peak 11.28 — comparable to the quietest G5 runs.

### What the comparison supports

* The **WebGL** failure mode that dominated G5's non-green population **did not
  appear** under a controlled start. That is consistent with the load
  correlation and is the one place G6 changed the picture.
* A **different** failure mode appeared instead, on a quiet host. It is not
  attributable to contention, and the prospective policy is what makes that
  claim defensible rather than convenient.
* `public-site.spec.ts:264` on `mobile-390` is **not new**. G3 recorded the same
  test line, same project, on a different route parameter (`/kkv.html`, run 2 of
  6). It was absent from G5. Across G3 and G6 it has now appeared twice, in
  seven authoritative runs, always on `mobile-390`, always as a `page.goto` that
  never dispatched.

### What it does not support

§38 is explicit and is honoured here: the evidence supports a **strong
correlation** between G5's non-green population and abnormal host contention. It
does **not** establish that `load > X` causes WebGL failures. `g5-03` reached a
peak load of 110.27 and was green. Instantaneous peak load, sustained mean load
and external process composition are three different things, and one sequence of
six runs plus one of one does not separate them.

**No G5 result has been discarded, reclassified or rewritten.** `g5-02` remains
a valid run. G5 remains `6 / 6 VALID · 4 / 6 GREEN`.

---

## Remaining known limitations

1. **The closure question is unanswered, not answered negatively.** One valid
   red run tells us the subject is not reliably green on a quiet host. It does
   not tell us the failure rate. Three runs were pre-registered; one was
   executed. That is the correct outcome under the stop rule, and it is also
   less information than three runs would have given.

2. **`public-site.spec.ts:264` is unclassified beyond its boundary.** We know
   exactly where it stopped — `GOTO_CALLED`, zero network events, page on
   `about:blank`. We do not know *why* the navigation never dispatched. The next
   investigation must be narrow and must start from this bundle, per §47.

3. **`experiments/tests/` is in no hash group.** `manifest.mjs` hashes root
   `tests/` and `scripts/` into the `test` group, but `playwright.full.config.ts`
   sources the entire WebGL suite from `experiments/tests/`. Those spec files are
   therefore **not** covered by the frozen-subject hash, even though they define
   the WebGL gate. No mutation occurred and nothing here is invalidated, but the
   integrity guarantee is narrower than it reads. Not changed during G6, per §5.

4. **The preflight cannot see inside the browser.** It gates on host conditions.
   The `g6-01` failure was internal to a WebKit-family context on a quiet host,
   which is precisely the class of fault host preflight is powerless against.

5. **The preflight attempt-id collision** described in the preflight summary
   overwrote one WAIT record, which was reconstructed from console output rather
   than preserved as an original artefact.

6. **`g6-01` is a single sample.** Load, memory and process composition at the
   moment of failure (4.17 load, 927 MB free) are recorded but prove nothing on
   their own.

---

## Rapidkert experiment exclusion

The iCloud development checkout carries in-flight, uncommitted edits to
`experiments/src/full/content.ts` and its `de` / `en` locale files, adding a
`~15M Ft` contracted-project-value metric to the Rapidkert case study. The
frozen G6 subject is the committed state, where `metric` is `null` on every
entry.

**These edits are outside the G6 subject and were not touched** — not resolved,
not discarded, not modified, and not included. They did not prevent G6 from
completing, because the hermetic worktree does not contain them.

One consequence is sharper than it may appear and should not be lost:

* `experiments/tests/full-ascent.spec.ts:388` asserts
  `expect(page.locator('.case__metric')).toHaveCount(0)`.
* `full-ascent.spec.ts` **is** the WebGL gate suite — `playwright.full.config.ts`
  matches it as `CINEMATIC`.
* `experiments/src/full/content.ts` **is** a hashed `product` path.

So the pending edit changes the frozen subject *and* contradicts a live assertion
in the gated WebGL suite. Whoever picks this up must decide whether the new
metric is intended and the assertion is stale, or the content edit should be
reverted. That decision is outside this workstream.

**Release consequence (§44):** adding these edits to the same intended release
creates a **new subject**. G6 does not validate them, and could not — it
measured a subject that does not contain them. At minimum the experiment
regression surface must be rerun after the conflict is resolved; because the
change touches shipped product content and the WebGL gate, broader gating is
warranted.

---

## Merge decision

# REPOSITORY-WIDE MERGE GATE: NOT GREEN

The lead.js silent-drop product defect is **resolved** and its regression
coverage is green — 32/32 silent-drop executions, 128/128 across the whole lead
file, and no failure in any run of any sequence since the fix. That finding
stands on its own and is not disturbed by this result.

The repository-wide gate does not pass. One authoritative run, started on a
verified-quiet host under a policy fixed in advance, produced one failure in
`public-site.spec.ts:264` on `mobile-390`. The subject was trustworthy; the
result was red.

Nothing has been pushed, merged, deployed or migrated. Portal P3 was not begun.

The next step is a **narrow** investigation of one contract, starting from the
boundary bundle at
`_build/reports/final-navigation-boundary/failures/g6-01/`, whose finding is
already specific: the navigation never left the browser.
