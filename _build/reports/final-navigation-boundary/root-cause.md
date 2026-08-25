# Root cause

§34, §38-§42, §50. What was proven, what was fixed, and what is still open.

> **§50: "Do not create a fake root-cause commit."** This file distinguishes
> three things that are easy to blur together — defects found and fixed during
> the investigation, defects in the investigation's own apparatus, and the
> navigation failure the workstream exists to explain. Only the third is "the"
> root cause, and it is the one this file is least willing to guess at.

## 1. The navigation failure — verdict

**Status: see `boundary-results.md` and `six-run-matrix.md`.** Nothing is
asserted here that the artefacts do not carry.

What is already established and is not a guess:

* The failure is **not a product defect that changed anything the browser
  sees.** The frozen subject for this workstream has `product`, `config` and
  **`dist` hashes byte-identical** to the sequence in which the failure
  occurred — `dist = 2cce7616f7f96a0d6ba51fe386f8431cc9ed712d7231b49807f3b404cfa371d4`.
  Only the `test` group moved, and it moved by the instrumentation. §34's rule
  holds: *a route name is not a root cause*, and `/kkv.html` has not been
  touched.
* The failure is **not a whole-server stall.** During the 30 s window, a second
  worker on the same project and the same server completed five sibling route
  navigations in 304-363 ms each.
* `/kkv.html` is **not one of the WebGL-heavy pages** — 6 stylesheets, 8
  scripts, 3 fonts, a handful of images, no `.glb`, no Draco, no module
  preloads. Whatever is being waited on at `load`, it is an ordinary static
  document's resource set.

## 2. Defects found and fixed — harness only (§41)

Neither is the navigation failure. Both are real, both were found by this
workstream, and both are recorded separately so they cannot be mistaken for it.
`dist` is byte-identical across both fixes.

### 2a. `route-audit` audited another project's website

`scripts/route-audit.mjs` spawned `python3 -m http.server` on a **fixed** port
4331 with `stdio: 'ignore'`, then `await wait(900)` and started auditing.

On 2026-08-19 an unrelated session on this host held 4331. Python could not
bind, wrote *Address already in use* to a discarded stderr, and exited. The
audit then drove a real browser through 66 routes at 12 viewports **against a
different project's site**, and reported **792 of 792 checks failing** — every
route "404", no `lang`, no canonical, no `<main>` — as failures of *this*
project. Nothing in the output indicated that not one line of it was about this
codebase.

This is the same class of defect as the ESTALE contamination that invalidated
the previous investigation: a gate confidently measuring something other than
the subject.

**Fix** (`63712b5`): the port is a starting point rather than a decision; the
server is polled until it answers instead of slept at; and whatever answers must
**prove** it is serving this `dist` by matching `/index.html` against the bytes
on disk, before a single route is audited. A mismatch is a loud abort naming the
port.

**Confirmed in the live gate.** Run `g4-01`'s route-audit log:

```
route-audit: serving dist/ on :4331
  failing checks: 0
  broken internal links: 0
[exit 0] 264.1s
```

792 failures and 0 failures, on the same commit, the same `dist` and the same
66 routes — the entire difference being whether the port was answered by this
project's server or somebody else's. The audit was never failing; it was never
looking at this project.

### 2b. The stress runner blocked its own instruments

`scripts/hermetic/nav-stress.mjs` drove Playwright with `spawnSync`, which
blocks the event loop for the entire arm. For 38 minutes the load sampler never
ticked (§31's figures came out `null`) and every `fs.watch` callback queued
until the child exited, then fired inside a single millisecond and carried that
millisecond as its timestamp.

The canary still did its job — it caught a real rebuild of `dist` by a
concurrent process and correctly marked the arm INVALID. That rebuild produced
**identical bytes**, so the hash comparison reported `SUBJECT IDENTICAL`; it is
exactly the case §15 keeps the watcher for. But the watcher could not say
*when*, and "when" is the difference between naming the process that touched the
subject and holding 509 events with no history.

**Fix** (`32d08c4`): `spawn` and await.

## 3. Defects in the investigation itself

Recorded because §50 forbids a tidy narrative, and because both would otherwise
show up in the artefacts as findings.

* **A discarded stress arm.** A `pkill -f "test-server.mjs 4322"` issued to
  clear the way for an unrelated self-test killed a stress run's own server on
  the same port, mid-flight. 34 navigation failures resulted; none is a
  reproduction of anything. The run is discarded and its log kept.
* **A contaminated stress arm.** A gate-run started against the same subject to
  verify the diagnostic wiring rebuilt `dist` while an arm was in flight — the
  509 canary events above, plus 6 sibling `/index.html` status failures that
  landed inside the rebuild window. Discarded and re-run.

Both were self-inflicted, both were caught by the hermetic machinery rather than
by the person who caused them, and that is the strongest available evidence that
the machinery works.

## 4. What may NOT be concluded

* **Not class D on the grounds that the engine is WebKit.** §38 forbids it, and
  §42 makes D conditional on the boundary being proven, the product and server
  shown correct, the behaviour characterised, versions recorded, and a visible
  dedicated gate policy. Silently skipping mobile WebKit is not available.
* **Not "a `page.goto` stall"** without a `lastConfirmedState`. §21 and §46.
* **Not class C from load.** §31 records the original failure at mean load 8.04,
  among the *lower*-load runs of its sequence. Load is an observed variable
  here, not a presumed cause.
* **Not a fixed cause at all, if the artefacts do not carry one.** §35's
  `NOT REPRODUCED WITH COMPLETE INSTRUMENTATION` is a permitted and honest
  outcome; inventing a root cause is not.
