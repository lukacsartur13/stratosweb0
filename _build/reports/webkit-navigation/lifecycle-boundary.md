# Lifecycle boundary — where the navigation actually stops

§8 forbids calling the defect a "navigation stall" without naming the boundary
it stalls at. This file is the classification scheme, the instrumentation that
makes it decidable, and the boundary each measured run landed on.

## The scheme

Every navigation attempt is assigned exactly one class, computed from which
timestamps its record has and which are `null`. The rule is ordered, so an
attempt is named by the *last* boundary it reached:

| Class | Reached | Missing | Reads as |
| --- | --- | --- | --- |
| SUCCESS | `page.goto` resolved | — | — |
| **A** | `goto` invoked | no request issued | Browser never asked. Client-side or network-process problem. |
| **B** | request issued | no response | Server never answered, or the answer never arrived. |
| **C** | response received | no navigation commit | Bytes arrived, WebKit did not commit the document. |
| **D** | committed | no `DOMContentLoaded` | Document committed, parsing/scripting never completed. |
| **E** | `DOMContentLoaded` | no `load` | A subresource is still outstanding. |
| **F** | `load` fired | `goto` did not resolve | Playwright/browser integration. |

Implemented in `scripts/webkit-nav/stress.mjs` → `classify()`. It reads only
recorded event timestamps, so the class of a failure is a property of the
evidence rather than of anyone's reading of it.

## How each timestamp is obtained

Client side, from Playwright page events, all on one high-resolution wall clock
(`performance.timeOrigin + performance.now()`):

| Timestamp | Source |
| --- | --- |
| `gotoInvoked` | immediately before `page.goto` |
| `requestIssued` | `page.on('request')`, main-frame navigation request |
| `responseReceived` | `page.on('response')`, main-frame navigation response |
| `committed` | `page.on('framenavigated')` for the main frame |
| `domcontentloaded` | `page.on('domcontentloaded')` |
| `load` | `page.on('load')` |
| `gotoResolved` / `failedAt` | the `await` returning or throwing |

Server side, from `scripts/webkit-nav/nav-server.mjs`, on the same clock:
`socket.open`, `request` (with keep-alive ordinal and reuse flag), `file.open`,
`file.firstByte`, `response.finish` (with `statMs`, `firstByteMs`, `totalMs`,
bytes vs content-length), `response.close-before-finish`, `request.aborted`,
`socket.error`, `socket.timeout`, `socket.close`, `clientError`, and a 500 ms
`inflight` heartbeat naming every request older than one second that has not
been answered.

The two sides are joined by an `x-nav-id` request header set on the browser
context before each attempt (§6). Not a query parameter: a query parameter is a
different cache key and a different subject for any rewrite rule, which §6
forbids. The header is read by nothing but the log.

**Verification that the join is complete**: `correlate.mjs` reports
`serverSawRequestForEveryNav`. For run A1 it is `true` for all 1 500 attempts,
which is what makes a future class-A observation ("the server never saw it")
meaningful rather than an artefact of lost logging.

## Runs and the boundary each produced

### A1 — serial, single browser, the suite's route and contract

```
label      A1-kkv-serial          CONTROLLED (load 1.52 at start)
engine     WebKit 26.5, Playwright 1.62.1
device     devices['iPhone 13'], unmodified
route      /kkv.html
action     page.goto, waitUntil: 'load', timeout 30 000 ms
mode       a new BrowserContext per navigation (the `page` fixture's shape)
n          1 500
```

| Result | |
| --- | --- |
| SUCCESS | **1 500 / 1 500** |
| Failures | 0 |
| p50 / p95 / p99 / max | 72.6 / 80.1 / 85.2 / **162.5 ms** |
| Failure rate by ordinal band (1–250 … 1251–1500) | 0 in every band |
| Stray events, crashes | 0, 0 |

Server side over the same run — 33 001 responses:

| | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- |
| response total | 0.351 ms | 0.743 ms | 1.042 ms | 12.104 ms |
| `stat` | 0.065 ms | 0.195 ms | 0.277 ms | 1.387 ms |
| first byte | 0.248 ms | 0.540 ms | 0.746 ms | 2.281 ms |

Sockets: opened 1 500-plus, closed cleanly, **0 errors, 0 timeouts, 0
`clientError`, 0 aborted requests, 0 file errors, 0 truncated responses, 0
`inflight` heartbeats**. Every one of the 1 500 main documents was served as
`200 / 39 816 bytes` — one artefact, no variation (§27).

**What A1 establishes, and what it does not.**

It establishes that the navigation contract the failing tests use is not, by
itself, unreliable. 1 500 consecutive attempts is the reported failure interval;
at the reported ~1-in-1500 rate the expected number of failures in this run was
about one, and there were none. Its worst attempt was 162 ms against a 30 000 ms
budget — a factor of 185 of headroom. Nothing in the server's view suggests
strain: the slowest single response in thirty-three thousand was 12 ms, and it
was a font.

It also removes one hypothesis outright. The repository is checked out on an
iCloud-backed volume and `dist/` contains evicted files (see
`idle-host-baseline.md`), which made "a file read blocks while the file provider
materialises it" a serious candidate: it would be rare, unbounded, invisible to
`stat`, and would truncate a response without any error. It is not what happened
here. 33 001 timed reads produced a maximum `stat` of 1.4 ms and a maximum
first-byte of 2.3 ms, and no read ever failed or short-changed its
`content-length`.

It does **not** establish anything about the environment the failure was
reported in. `playwright.config.ts` runs `workers: 5` with `fullyParallel: true`.
A1 ran one browser. The next run holds every other variable and changes only
that.

### B1 — the same navigation, five browsers abreast

```
label      B1-kkv-x5              CONTROLLED (load 2.42 at start)
workers    5 concurrent WebKit browsers, one shared nav-server
n          1 000 per worker = 5 000 navigations
```

Everything else identical to A1.

| Worker | Result | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| w1 | 1 000 / 1 000 | 184.3 | 266.0 | 434.7 | 555.5 ms |
| w2 | 1 000 / 1 000 | 185.2 | 267.0 | 421.5 | 588.7 ms |
| w3 | 1 000 / 1 000 | 185.6 | 271.9 | 438.8 | 628.9 ms |
| w4 | 1 000 / 1 000 | 184.4 | 261.8 | 428.9 | 632.7 ms |
| w5 | 1 000 / 1 000 | 185.5 | 272.1 | 451.8 | 574.5 ms |

**5 000 / 5 000. Zero failures.** Host load rose from 2.42 to 18.25 on ten
cores — well past the point where the previous pass's Chromium pathology
produced twenty-second clicks — and the navigation cost went up by exactly the
factor you would expect from sharing a machine five ways: p50 72.6 → 185 ms, and
a worst case of 633 ms against a 30 000 ms budget. The distribution moved; it did
not develop a tail. Failure rate by ordinal band is zero in all twenty bands, so
there is no accumulation over a browser's lifetime either (§17).

### What A1 and B1 together rule out

6 500 navigations of the exact failing route, on the exact engine and device
descriptor, through the exact server, under both the idle and the five-worker
shape, with not one failure. That is more than four times the reported failure
interval. The following are therefore not sufficient causes, individually or
together:

* the `page.goto` + `waitUntil: 'load'` contract on this route;
* WebKit's handling of a fresh `BrowserContext` per navigation;
* `scripts/test-server.mjs`'s serving logic, its keep-alive, its socket
  handling or its reads off the iCloud-backed volume;
* concurrency at the suite's worker count;
* accumulation over a browser process's lifetime.

What A1 and B1 do **not** contain is the rest of the suite: the WebGL homepage
in the same WebKit browser, the four Chromium projects rendering through
`--use-angle=metal` on the same GPU, the portal SPA, and the interleaving of all
of them across five workers. The reproduction therefore moves to the suite
itself, instrumented — see `server-comparison.md` and `root-cause.md`.

## §9 — the diagnostic `waitUntil` matrix

Same route, same engine, same device, same fresh-context-per-navigation shape;
only the lifecycle condition differs.

| Arm | `waitUntil` | n | Success | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | `commit` | 1 000 | **1 000 / 1 000** | 9.0 ms | 26.4 ms | 69.6 ms | 94.6 ms |
| M2 | `domcontentloaded` | 1 000 | **1 000 / 1 000** | 63.2 ms | 97.8 ms | 122 ms | 192.5 ms |
| A1 | `load` | 1 500 | **1 500 / 1 500** | 72.6 ms | 80.1 ms | 85.2 ms | 162.5 ms |

The ladder is exactly the shape a healthy page produces: the document commits in
9 ms, parsing and deferred scripts add ~54 ms, and every subresource settles
within a further ~9 ms. The gap between `domcontentloaded` and `load` — the
window in which a blocking subresource would live — is **under 10 ms at the
median and never more than a few hundred at the worst**.

**The question §9 poses cannot be answered in the intended direction, and that
is itself the finding.** §9 asks whether `commit` always succeeds while `load`
sometimes stalls. Here *all three* always succeed, so no boundary separates
them. There is no lifecycle condition at which this navigation is unreliable,
and therefore no evidence that the production tests' `load` requirement is
stronger than the real contract.

That matters for §39: it removes the temptation the brief anticipates. Weakening
the production tests from `load` to `domcontentloaded` would be a change with no
measured justification whatsoever — not a trade of strictness for stability, but
a reduction in coverage bought with nothing. **No test's wait condition is
changed in this workstream.**
