# Root cause

## The short answer

**The named failure was not reproduced, and its root cause is not established.**

A different failure of the same 30-second class *was* reproduced and *is* root-caused,
and its mechanism is one that could produce the named failure's exact signature.
That is a real result and it is not the same thing as explaining the named
failure. Both statements are below, kept apart on purpose.

## 1. What was searched, and what it cost

Every arm used WebKit 26.5 via Playwright 1.62.1, an unmodified
`devices['iPhone 13']`, real `page.goto`, a 30 000 ms ceiling, no retries, and
counted the first outcome of every attempt.

| Dimension | Arms | Navigations | Stalls |
| --- | --- | --- | --- |
| Serial, single browser | A1 | 1 500 | **0** |
| 5 browsers (the suite's `workers: 5`) | B1 | 5 000 | **0** |
| 10 browsers, host load 66–101 | S1 | 7 000 | **0** |
| Homepage + static page alternating, 5 browsers | S2 | 1 250 | **0** |
| `waitUntil` commit / domcontentloaded | M1, M2 | 2 000 | **0** |
| Page / context / browser lifetime | M3, M4, M5 | 2 600 | **0** |
| Minimal static control page | M6 | 1 000 | **0** |
| 3D WebGL homepage | M7 | 300 | **0** |
| `page.reload` | M8 | 1 000 | **0** |
| `test-server.mjs` / `python3 -m http.server` | M10, M11 | 2 000 | **0** |
| Reduced-motion homepage | M12 | 300 | **0** |
| **Total focused** | **32** | **23 950** | **0** |
| Unmodified repository-wide suite | 6 runs | 117 083 requests | **0** |

The total is machine-checked, not added by hand — an earlier revision of this
file said 22 150, which was simply wrong:

```
$ awk -F, 'NR>1 && $1!="smoke" {n+=$10; ok+=$11; f+=$12; arms++} \
    END {printf "arms=%d navigations=%d ok=%d failed=%d\n", arms,n,ok,f}' stress-summary.csv
arms=32 navigations=23950 ok=23950 failed=0
```

`ok` equals `navigations` and `failed` is zero in every one of the 32 arms, so
the totals reconcile in the sense §45 requires.

The reported interval is one stall per ~1 500 navigations. This search covered
roughly **sixteen times** that interval without producing one.

### What that eliminates

Not sufficient causes, individually or in combination:

* the `page.goto` + `waitUntil: 'load'` contract on the reported routes;
* WebKit's fresh-`BrowserContext`-per-navigation handling;
* page, context and browser process lifetime (no ordinal-band effect in 20 bands);
* `scripts/test-server.mjs` — its serving logic, keep-alive, sockets and reads;
* concurrency at the suite's worker count, and at twice it;
* host saturation to 10× oversubscription;
* the persistent 3D Altimeter and WebGL teardown (§19–§20);
* GA4 or any external network dependency (§11 — zero non-localhost requests);
* redirect chains or route fallbacks (§28 — every main document a direct 200).

### What it does not license

It does not license "the failure does not exist", and it does not license a
root cause. **Absence of reproduction is not an explanation.** The previous
pass observed the failure four times in five runs; this pass observed it zero
times in six. Something differs between the two measurements, and the leading
candidate is stated in §4 below — but a leading candidate is a hypothesis.

## 2. The failure that WAS reproduced and root-caused

At host load 231 (1 160 `mobile-390` executions of `public-site.spec.ts`), five
test executions failed inside the `dist/` walker:

```
Error: Unknown system error -70: Unknown system error -70, read
  tests/public-site.spec.ts:439    const html = fs.readFileSync(full, 'utf8');
```

Durations before failing: **14 947, 31 558, 43 181, 55 648 and 66 589 ms.**

macOS errno 70 is `ESTALE` — what the iCloud file provider returns when it
cannot materialise a dataless file.

### RETRACTED — this section originally completed the §47 sentence, and should not have

An earlier revision of this file completed §47's sentence as:

> ~~The `dist`-walking tests stall **because the repository is on an iCloud Drive
> volume and the build copies sync-conflict duplicate pages into `dist/`, where
> no HTTP request touches them so the provider keeps them evicted**, which causes
> the test to stop between `readdirSync` returning the entry and `readFileSync`
> returning its contents.~~

**That is withdrawn.** It was written before checking what else was happening on
the machine, and a better explanation was available the whole time.

`dist/` was **rewritten by another process during the arm that produced the
`ESTALE` failures**:

| Window | Files modified in `dist/` |
| --- | --- |
| The six repository-wide gate runs, 10:48–11:40 | **0** |
| The repeat-each arm, 14:15–14:35 | **82** |
| Full rebuild completed | 14:39:53 |

Product source under `_build/` was also modified at 13:58–14:18 —
`_build/build.py`, `_build/pages/kkv.html`, `_build/i18n/kkv.json` and others,
plus a new `_build/i18n/rapidkert.json`. None of it by this workstream, which
touched only `scripts/webkit-nav/` and this report directory. Four other agent
sessions were live on this host.

So the walker was reading `dist/*.html` while 82 of those files were being
replaced underneath it, on a file-provider volume. `ESTALE` is exactly what a
stale handle to a replaced file returns. **Concurrent mutation of the subject is
now the better-supported explanation, and iCloud eviction is not needed to
account for the observation at all.**

The blank-document failures in the same arm — `toHaveTitle` receiving `""`,
`h1` count zero, the altimeter never appearing — fit the same cause and did not
fit the eviction story well: a page served while its file is being rewritten is
empty or partial.

**The §47 sentence is therefore not completed for this failure either.** What
survives is narrower:

* `fs.readFileSync` on this `dist/` returned errno 70 (`ESTALE`) after 15–67 s —
  a fact;
* it did so while another process was rewriting that directory — a fact;
* the two are consistent, and no measurement in this workstream separates
  "concurrent rewrite" from "iCloud materialisation failure" as the cause.

The `dist/` sync-conflict duplicates described below remain real and remain worth
removing, but they are no longer offered as the cause of anything.

### The evidence chain

| Claim | Evidence |
| --- | --- |
| The repo is on an iCloud file provider | `idle-host-baseline.md`; path under `~/Library/Mobile Documents/com~apple~CloudDocs` |
| `dist/` carries sync-conflict duplicates | 8 in source, **18** in `dist/`, listed in `resource-analysis.md` |
| No test requests them over HTTP | 117 083 server-side request records; none names one |
| Four suites read every `.html` in `dist/` off disk | `public-site:429`, `structured-data`, `portal-analytics:1131`, `portal:172` |
| They were evicted | 149 dataless files in `dist/` at baseline capture |
| Reading them blocks, then fails | five `ESTALE`s, 15–67 s, at load 231 |
| Reading them materialises them | dataless count fell 149 → 4 during this session |
| The server never hits it | **0** `file.error` in 117 083 + 46 738 responses; max response 2 907 ms |

The last two rows are what make this precise rather than merely suggestive: the
server and the walkers read the *same directory* with the *same syscalls*, and
only the walkers fail — because only the walkers touch the cold population.

### Why this matters even though it is not the named failure

It is a genuine, load-correlated, rare mechanism that turns a healthy test into
a multi-second-to-multi-minute hang, on this exact machine, in this exact
suite. Any test whose budget it exceeds fails as a timeout with no error — which
is indistinguishable, in a gate summary that records only duration, from a
navigation stall.

## 3. Could this mechanism produce the *named* failure?

Mechanically, yes. `scripts/test-server.mjs` serves with:

```js
res.writeHead(200, { 'content-length': info.size, ... });   // stat: cheap on a dataless file
createReadStream(filePath).pipe(res);                       // read: blocks on materialisation
```

`stat` answers from metadata and is fast even when the data is absent, so the
**headers go out with a correct `content-length` and the body never arrives**.
The browser holds the response open, the subresource never settles, `load` never
fires, and `page.goto` consumes its entire budget. That is precisely the reported
signature, and it would be boundary **E**.

It would also be rare in exactly the reported way: served files are read
constantly and therefore stay hot, so it needs an eviction to land on a served
path between builds.

**This was not observed.** In 163 821 server-side responses across every run in
this workstream, not one file read failed or stalled. It is a mechanism with a
demonstrated capability and no demonstrated instance, and it is recorded as such
rather than promoted to a conclusion.

## 4. Why the named failure may not have recurred

Stated as candidates, in order of how well the evidence supports them.

1. **Host contamination.** The previous pass recorded that its two worst runs
   were the two during which that session ran its own analysis on the same
   machine, and explicitly called this "a reason to re-measure". This pass began
   from load 1.29. This is the candidate the brief itself advances, and this
   pass's result is consistent with it — but consistency is not proof, because
   this pass also cannot make the failure appear *under* contamination (S1 ran
   at load 66–101 and produced nothing).
2. **The evicted population was materialised.** The dataless count in `dist/`
   fell from 149 to 4 during this session. If the mechanism in §3 is the cause,
   then the act of measuring partially removed the condition — the failure would
   be expected to return after the provider next evicts.
3. **A stale server on port 4322.** `reuseExistingServer: !CI` silently adopts
   whatever is listening. This host leaves servers behind (a `test-server.mjs`
   on 4399 ran for 9 h 35 m during this session). A gate served by an unintended
   process would be misattributed. **No evidence** says this happened; the
   process table from that session is gone. Recorded because it is checkable
   going forward and would explain "persists across both servers" without either
   server being at fault.

## 5. The two failures this gate did produce

Both reproduced on an idle-started host; neither is a navigation stall. Full
detail in `final-repeated-gate.md`.

| Run | Test | Boundary | Status |
| --- | --- | --- | --- |
| 4 | `desktop-1440 lead-forms.spec.ts:177` | click never activated an already-bound button | **root-caused** |
| 5 | `mobile-390 homepage-history.spec.ts:223` | back-navigation restored to document bottom | hypothesis only |

For the second, the measurement that would decide it: capture `scrollY`,
`document.body.style.minHeight` and `scrollHeight` at `pagereveal`, at
reservation release, and one frame later. If the reserved height exceeds the
settled height, releasing it clamps the scroll to the new bottom, which is what
`travel − y === 0` reports. That is one instrumented run, and it was not done in
this pass.

## 6. Recommended next actions, and why none were taken here

**Nothing in this section was applied.** §48 forbids a fix commit where diagnosis
has not established the cause, and §44 restricts this pass to infrastructure and
test reliability. Each of these needs its own scoped change plus a fresh repeated
gate to validate.

1. **Stop shipping iCloud conflict duplicates into `dist/`.** 18 junk pages are
   built and would be deployed. Either exclude `* N.html` in
   `scripts/assemble.mjs`, or delete the 8 source duplicates. **Deleting files
   from the working tree is the owner's call, not mine**, which is why it was
   not done — but they are sync artefacts, not content, and they are also a
   duplicate-content surface in production, not only a test problem.
2. **Make the walkers robust to the provider.** They should skip conflict
   duplicates outright. This is pure test code and low risk — but on its own it
   would *mask* item 1 rather than fix it, so it should follow, not precede.
3. **Set `reuseExistingServer: false`** so a gate can never be served by a
   process it did not start. Fails loudly on a busy port, which is the correct
   trade for a gate.
4. **Move the checkout off the iCloud volume**, or exclude `dist/` and
   `node_modules/` from sync. This removes the entire class rather than each
   instance. It is the single highest-value change available and it is an
   environment decision, not a code one.

## 7. Classification

The named failure — `mobile-390 page.goto` stalling for the full 30 s budget —
remains, under the previous pass's scheme:

**`F — UNRESOLVED`**

It is not reclassified to `D — ENVIRONMENT-SPECIFIC LIMITATION`, because §38
requires a repeatable reproduction before that label may be used, and there is
no reproduction at all. Downgrading an unreproduced failure to "environment" on
the strength of 22 150 clean navigations would be exactly the kind of
convenient reclassification the brief exists to prevent.
