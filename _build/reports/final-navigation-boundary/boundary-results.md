# Boundary results

§11, §19, §22-§29, §38. What each `lastConfirmedState` licenses, what the
preceding state actually is, and what was observed.

## The decision procedure

`lastConfirmedState` is not a label. Each value sends the investigation
somewhere different and forbids the other directions, which is the whole reason
§21 refuses to accept a bare timeout. The mapping below is fixed **before** any
result, so it cannot be adjusted to fit one.

| `lastConfirmedState` | What is proven | Where the investigation goes | Brief |
| --- | --- | --- | --- |
| `GOTO_CALLED` | the call was made; **no request event** | browser process, WebKit networking, a pending previous navigation, context state, page closed/crashed. **Not the server** | §22 |
| `REQUEST_STARTED` | the browser issued it; the server never recorded receiving it | socket/connection layer, browser network process, cancellation, localhost routing, connection reuse. Preserve `requestfailed` detail | §23 |
| `SERVER_RECEIVED` | the server saw it and did not answer | server handler, file read, response stream, socket, static-file implementation. **HARNESS/SERVER defect** unless product generation is implicated | §24 |
| `RESPONSE_STARTED` / `RESPONSE_COMPLETE` | a complete response left the server; the navigation did not commit | strong browser/network-process evidence. Capture status, finish, frame URL, WebKit process state. **Not classifiable as D from one occurrence** | §25 |
| `NAV_COMMITTED` | the document committed; DOMContentLoaded never fired | main document, script/module state, page errors, **parser-blocking resources**, pending resource list | §26 |
| `DOMCONTENTLOADED` | parsed; `load` never fired | the outstanding resource list — URL, type, initiator, state. Images, fonts, JS, GLB, preload, stylesheet | §27 |
| `LOAD` | `load` fired and `page.goto` still did not resolve | Playwright/WebKit integration anomaly. Record exact Playwright and bundled WebKit revisions. **Evidence first, upstream research second** | §28 |
| `DESTINATION_READY` | **the navigation succeeded.** The original attribution was false | destination readiness, assertion, later interaction. Such a timeout may never again be labelled `page.goto` | §29 |

The three server-owned states are merged from the server's own log. **A missing
server line means NOT CONFIRMED, never "did not happen"** — the recorder
degrades to the lower state rather than guessing the higher one.

## Classification standard — §38

A captured failure may be left `F — UNRESOLVED` only when nothing more specific
is supported. The permitted classes are A (product defect), B (test defect),
C (load/resource contention), D (environment/engine limitation), E
(non-deterministic product behaviour), F (unresolved).

**D is not available merely because the browser is WebKit** (§38), and §42 makes
it conditional on all of: the boundary proven, product and server shown correct,
the behaviour repeatable enough to characterise, browser and version recorded,
and a visible dedicated gate policy. Silently skipping mobile WebKit is
forbidden.

## Preceding state — §19

"Do not assume a `goto` failure begins at `goto`." For this contract the answer
is unusually clean, and it is worth stating because it removes a whole family of
hypotheses.

**Inside the test: nothing.** `tests/public-site.spec.ts:265` is the first
statement of its test body. The `page` fixture is a fresh context and a fresh
page, so at `GOTO_CALLED` there is no scroll position to restore, no menu state,
no history entry, no route transition in flight, no WebGL context and no
in-flight request. The recorder captures this rather than assuming it —
`timeline.json.preceding` carries `urlBefore`, open request count and context
page count at the moment of the call.

**Inside the worker: a great deal.** The browser process is reused across tests,
and that is where the only real preceding state lives. Reconstructed from the
original failure (`runs/g3-02`, worker 15):

| | |
| --- | --- |
| tests this worker had already run | **139** |
| immediately preceding test | `/rolunk.html responds and has a title and description` |
| its result | **passed in 366 ms** |
| the test before that | `/index.html …`, passed in 395 ms |
| distinct spec files already exercised | **12** — analytics, attribution, harness, homepage-chrome, homepage-modality, lead-forms, mobile-homepage-simple, not-found, portal-control-room, portal-revenue, portal, public-site |
| worker's first test | 12:03:27.434Z |
| the failing navigation | 12:04:44.198Z — **77 s later** |

So the failing navigation is the third of ten identical route contracts, in a
worker that had already driven 139 tests across 12 spec files — including the
WebGL homepage suite — and whose two immediately preceding navigations were
**the same contract on different routes, both succeeding in under 400 ms**.

Those 139 tests took only 77 seconds, because most of them are the
filesystem-reading portal specs that never open a page. The browser process was
therefore young in wall-clock terms and old in test-count terms, and the
recorder now carries both numbers so the next occurrence does not have to be
reconstructed from a report to tell them apart.

The recorder now counts this directly: `workerTestsBefore`,
`workerNavigationsBefore`, `precedingTest` and `precedingNavigation` are in
every bundle, so the next occurrence does not need reconstructing from a report.

## What the original failure already ruled out

Not a boundary, but it constrains one. During the 30 s stall, **worker 17 — the
same `mobile-390` project, the same spec file — completed five sibling route
navigations**: `/nagyvallalat.html` 363 ms, `/branding.html` 304 ms,
`/hirdeteskezeles.html` 334 ms, `/impact-program.html` 327 ms, `/blog.html`
310 ms.

One `node` process was serving both workers. It accepted connections, read files
and completed HTML document responses throughout the window in which this
navigation was pending. That does not locate the boundary — §21 still applies,
and a per-connection or per-context fault is entirely compatible with it — but
it means **"the server stalled" is a hypothesis that must survive that evidence
rather than being the default reading of a `page.goto` timeout.**

## A worked example — what a classified failure actually looks like

No genuine failure was captured, but 57 accidental ones were, and one complete
bundle is retained as the exemplar
(`discarded/orphaned-150-arm/…/mobile-390--kkv.html-…`). It is the **same test,
same project, same route** as the failure under investigation, so it shows
precisely what the next real occurrence will produce.

```
target            http://127.0.0.1:4322/kkv.html
gotoResolved      false
preceding         urlBefore=about:blank  contextPages=1  openRequests=0
                  workerTestsBefore=0    workerNavigationsBefore=0

  +  53ms  GOTO_CALLED        /kkv.html
  + 117ms  REQUEST_STARTED    http://127.0.0.1:4322/kkv.html
  + 127ms  requestfailed      [Could not connect to the server.]

server lines for this navId   0
states confirmed by server    []
network                       1 total, 1 failed, 0 pending
lastConfirmedState            REQUEST_STARTED
```

Read against the decision table above, that is unambiguous and it is §23: the
browser issued the request and **the server has no record of it whatsoever** —
zero correlated lines, no state confirmed. The investigation goes to the
transport, not to the server handler and not to the product.

Two details matter more than the classification:

* **§13 is satisfied.** The `requestfailed` is preserved with its error text
  rather than collapsing into a generic timeout. The *reason* survives.
* **The server's silence is evidence, not an assumption.** `SERVER_RECEIVED` is
  absent because the server's own log has nothing for this navId — not because
  the test process inferred it. Had the server received and not answered, the
  same bundle would read `SERVER_RECEIVED` and the investigation would go
  somewhere else entirely.

Set this beside what the original failure produced:

```
page.goto did not resolve — boundary NOT proven (see §21)
```

That is the whole difference this workstream was built to make.

## Two arms deliberately not run, and why

Both are gated by the brief itself on a reproduction that did not occur.

**§20 — the `waitUntil` comparison.** "Do NOT immediately switch the actual
contract from one lifecycle boundary to another. **If a real failure is
captured:** then compare diagnostic variants — commit, DOMContentLoaded, load."

No failure was captured, so there is nothing to compare variants against. More
importantly, §20's real instruction is the sentence after it: *do not weaken the
production test merely to remove a red result.* Changing `/kkv.html`'s contract
from `load` to `domcontentloaded` would make the observed failure less likely to
recur while proving nothing about it, and the contract is unchanged.

The self-test already establishes that the recorder can *tell those variants
apart* when one does occur: arm D stops at `NAV_COMMITTED`, arm D2 at
`DOMCONTENTLOADED`, arm E at `DESTINATION_READY`.

**§21 — EXTENDED DIAGNOSTIC OBSERVATION.** The arm is built and committed
(`nav-boundary-stress.spec.ts`, armed by `STRATOS_NAV_EXTENDED`), and it samples
a pending navigation at 31 s, 60 s and 120 s to answer whether a stall ever
resolves. §21 conditions it on "**If the normal test budget expires**" — on
having a stall to observe. There was none. Running it against 550 healthy
navigations would measure how fast this machine serves a 39 KB document, which
is not the question.

It is ready for the next occurrence rather than absent, and it does not touch
the suite timeout.

## Results

*(Filled in from the stress arms and the six-run sequence.)*
