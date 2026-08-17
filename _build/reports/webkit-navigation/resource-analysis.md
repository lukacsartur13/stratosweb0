# Resource analysis — what is actually outstanding when a page is loading

§10 asks what is still in flight when a navigation fails to reach `load`, and
warns against assuming the main document is responsible. Since no navigation
stall was reproduced (see `root-cause.md`), this file answers the adjacent
question the evidence does support: **what the resource population of these
pages looks like under real suite load, and whether anything in it is capable of
blocking `load` indefinitely.**

## Method

Every request the server answered during six complete repository-wide runs was
timed on both sides of the file read (`scripts/webkit-nav/nav-server.mjs`):
`stat`, `open`, first byte, completion, bytes written against `content-length`,
plus a 500 ms heartbeat naming any request older than one second that had not
been answered. The suite was unmodified; the server was adopted through
`reuseExistingServer`.

## The population — six full runs, frozen commit `c37587c`

| | |
| --- | --- |
| Requests received | **117 083** |
| Responses completed | 116 790 |
| Requests aborted by the client | 293 |
| **Responses truncated (bytes ≠ `content-length`)** | **0** |
| Sockets opened / closed | 26 083 / 26 083 |
| `ECONNRESET` / `EPIPE` | 124 / 2 |
| Socket timeouts | 51 |

Response time, server side:

| p50 | p99 | p99.99 | max |
| --- | --- | --- | --- |
| 4.49 ms | 296 ms | 1 498 ms | **2 907 ms** |

**72 responses out of 117 083 took longer than a second, and the slowest took
2.9 seconds.** Every one of them completed. There is no request in this
population that the server failed to answer, and none that it answered
incompletely.

### The truncation detector is sensitive, not blind

A negative result is only worth as much as the instrument's ability to produce a
positive one. The `short` flag — bytes written ≠ `content-length` — reported zero
across all 117 083 suite requests and across every `waitUntil: 'load'` arm. That
could mean the condition never occurred, or that the detector never works.

It works. The `waitUntil: 'commit'` arm (M1) logged **308 truncated responses out
of 4 272 requests**, because committing early and immediately navigating again
aborts whatever subresources are still in flight. The detector fires exactly when
responses genuinely are cut short, and it fired nowhere else.

So "zero truncated responses under `load`" is a measurement, not an absence of
measurement.

### What the slow tail is made of

Exclusively large assets, and the same handful every time:

| Asset | Size | Worst observed |
| --- | --- | --- |
| `/assets/home/Gltf-D7FiHbmi.js` | 896 910 B | 2 018 ms |
| `/models/stratos-altimeter.glb` | 396 912 B | 1 601 ms |
| `/models/stratos-mountains-desktop.glb` | 345 744 B | 1 503 ms |
| `/assets/img/work-3.jpg` | 335 495 B | 1 020 ms |
| `/draco/draco_decoder.js` | 512 465 B | 1 076 ms |
| `/assets/home/main-CkZ5Ow1d.js` | 270 292 B | 1 324 ms |

All sixteen `inflight` heartbeats in six runs name one of these, all with
`firstByte: true` and a byte count that was still climbing — a large transfer in
progress on a loaded machine, not a stalled one. Each resolved within the next
heartbeat or two.

### The iCloud-backed volume, quantified rather than assumed

`idle-host-baseline.md` recorded that `dist/` is served off an iCloud file
provider with evicted files present, and flagged a blocking materialisation as a
serious candidate: it would be rare, unbounded, invisible to `stat`, and would
truncate a response with no error.

Measured across 117 083 reads:

| | A1 (idle, 33 001 reads) | Six suite runs (117 083 reads) |
| --- | --- | --- |
| `stat` p99 | 0.277 ms | — |
| `stat` max | **1.387 ms** | **346 ms** |
| Truncated responses | 0 | **0** |
| File read errors | 0 | 0 |

The volume does produce latency spikes under load — a 346 ms `stat` is three
orders of magnitude above the idle median — but across these reads it is
bounded, it never failed, and it never short-changed a `content-length`.

> ### CORRECTION — this section originally claimed too much
>
> An earlier revision of this file concluded from the table above that "the
> eviction hypothesis is excluded for this workload". **That was wrong, and it
> was wrong in the direction that flatters the measurement.** It generalised
> from *the files the server reads* to *the volume*, and those are not the same
> population.
>
> A later arm — 1 160 `mobile-390` test executions at host load 231 — produced
> five hard failures inside `fs.readFileSync` on `dist/`:
>
> ```
> Error: Unknown system error -70: Unknown system error -70, read
>   tests/public-site.spec.ts:439   const html = fs.readFileSync(full, 'utf8');
> ```
>
> macOS errno 70 is `ESTALE`, which is what the iCloud file provider returns
> when it cannot materialise a dataless file. The five failing test executions
> took **14 947 ms, 31 558 ms, 43 181 ms, 55 648 ms and 66 589 ms** before
> giving up.
>
> So this volume demonstrably *can* block a read for over a minute and then fail
> outright. What the 117 083-request table actually shows is narrower than what
> was claimed: **the files the server serves stayed materialised, so the server
> never hit the condition.** It does not show the condition cannot occur. The
> corrected statement is in "The population the server never touches" below.

## The population the server never touches — and the tests do

`dist/` contains two disjoint sets of files, and only one of them is served.

| | Requested by tests over HTTP | Read off disk by tests |
| --- | --- | --- |
| Real routes (`kkv.html`, `index.html`, assets, models) | yes — constantly, so always materialised | yes |
| **iCloud sync-conflict duplicates** (`kkv 2.html`, `blog 2.html`, `rolunk 3.html`, …) | **never** | **yes — every one of them** |

The source tree carries 8 sync-conflict duplicates (`blog 2.html`,
`hirdeteskezeles 2.html`, `impact-program 2.html`, `impresszum 2.html`,
`kkv 2.html`, `nagyvallalat 2.html`, `rolunk 2.html`, `ugyfelszolgalat 2.html`).
The build copies them, so `dist/` carries **18**.

No HTTP request in the entire suite names any of them, which is exactly why they
stay evicted — nothing ever reads them over the wire to force materialisation.
But four separate suites walk `dist/` off the filesystem and read **every**
`.html` they find:

| Suite | What it walks for |
| --- | --- |
| `public-site.spec.ts:429` | no built page carries an executable inline script |
| `structured-data.spec.ts` | every public page carries exactly one JSON-LD block |
| `portal-analytics.spec.ts:1131` | analytics surface |
| `portal.spec.ts:172` | portal shell |

So the walkers are the only readers of the one population that is reliably
**cold**. That is the whole mechanism, and it explains the shape of the
observations exactly:

* it is **rare**, because it needs the provider to have evicted the file *and*
  to be slow or unable to bring it back;
* it is **load-correlated**, because materialisation competes for the same
  starved I/O;
* it is **invisible to `stat`**, which answers from metadata;
* it produces **a timeout, not an error**, until it eventually produces
  `ESTALE`.

### The file population changed underneath the session — but not for the reason first given

| | At baseline capture | At end of session |
| --- | --- | --- |
| Files in `dist/` | 322 | 265 |
| Dataless files in `dist/` | **149** | 4 |

> **CORRECTION.** An earlier revision attributed this to "the walkers
> materialising roughly 145 files by reading them". That is not supported.
> `dist/` was **rebuilt by another process at 14:39:53**, and 82 of its files
> were being rewritten during the 14:15–14:35 window in which the `ESTALE`
> failures occurred. A rebuild regenerates files as local, non-dataless copies
> and removes stale ones, which accounts for the whole table without any
> materialisation.
>
> Four other agent sessions were live on this host, and product source under
> `_build/` was modified at 13:58–14:18 by none of this workstream. See
> `root-cause.md` §2, where the corresponding root-cause claim is retracted.

What survives, and it is the part that matters for the gate: **the tree the
suite measures was not stable across this session.** Zero files changed during
the six repository-wide gate runs, which is what makes those runs valid. 82
changed during a later diagnostic arm, which is what invalidates that arm.

## What could still block `load`, and what could not

`load` fires when every subresource has settled. A navigation waiting on `load`
therefore hangs if *any* request neither completes nor fails. The measurement
above says the server is not that party: in 117 083 requests it left nothing
unanswered, and its own worst case is 2.9 s against a 30 000 ms budget.

That leaves three places a `load` could be held that this instrumentation does
**not** exclude, and they are named here rather than dismissed:

1. **A request the browser never issued to the server.** Boundary A. The server
   log cannot see this by construction — which is exactly why `stress.mjs`
   records `requestIssued` on the client and `correlate.mjs` reports
   `serverSawRequestForEveryNav`. In the 6 500 focused navigations that check
   held for every attempt.
2. **A request issued into WebKit's network process and never handed to the
   socket.** Would present as boundary A or B with no server-side record. Not
   observed, but not excluded by server evidence alone.
3. **A resource the page itself creates and never resolves** — a `fetch`, a
   font swap, a media element. `analytics.js` is the obvious candidate and is
   excluded separately below.

## GA4 (§11)

The site ships a real Measurement ID (`G-JZD43PHJ41`) in the page. It is gated
in the browser, not at build time:

```
allowHosts: ["stratosweb.hu", "www.stratosweb.hu", "stratosweb1.netlify.app"]
```

`assets/js/analytics.js` compares `location.hostname` against that list and, on
a miss, deletes the `ga4` config before anything is injected — no tag, no
consent interface, no cookies. The test origin is `127.0.0.1`, which is not on
the list.

**Verified empirically, not just read:** across every navigation in this
workstream — 6 500 focused attempts with full per-request capture — no request
to `googletagmanager.com`, `google-analytics.com` or any other external host was
recorded. The only origin contacted is `http://127.0.0.1`. There is no
uncontrolled Google network dependency in the test environment, and therefore no
GA4-shaped candidate for a hung subresource.

This is a clean result, not a workaround: nothing is blocked in the test
environment, the gate is the product's own and it holds.

## Route path (§28)

The stress environment does not emulate Netlify, and the difference is recorded
rather than glossed:

| Path | Test server | Netlify (`netlify.toml`) |
| --- | --- | --- |
| `/kkv.html` | served directly from `dist/kkv.html` | served directly |
| `/index.html` | served directly | **301 → `/`** |
| `/en/index.html` | served directly | **301 → `/en/`** |

`/kkv.html` — the route two of the four reported failures are on — travels
exactly the same path in both environments, with no redirect, no `.html`
fallback, no locale rewrite and no 404 fallback. The two homepage paths are
served directly under test where production would redirect once, so the harness
if anything exercises a *shorter* chain than production. No accidental redirect
chain exists in either the suite or the stress harness; every main-document
response observed was a direct `200`.
