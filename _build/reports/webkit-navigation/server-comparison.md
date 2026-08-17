# Server comparison — §12

The previous pass concluded that the stalls "persist across *both* web servers,
so the server is not the cause". §12 requires that to be re-tested under a
controlled harness rather than carried forward, and warns specifically against
concluding "server independent" from median latency, because rare-tail behaviour
is what fails tests.

## The two servers

| | `scripts/test-server.mjs` | `python3 -m http.server` |
| --- | --- | --- |
| Runtime | Node v24.18.1, `node:http` | Python **3.9.6** |
| Protocol | HTTP/1.1 | **HTTP/1.0** (`protocol_version` confirmed at runtime) |
| Keep-alive | yes, `keepAliveTimeout` 60 s | **none** — `--protocol` arrived in 3.11 |
| Concurrency | single event loop + libuv threadpool | `ThreadingHTTPServer`, GIL-bound |
| Backlog | 511, stated | default |

The Python facts the previous pass rested its argument on are confirmed
first-hand, not taken on trust: this host really is on 3.9.6, and its
`BaseHTTPRequestHandler.protocol_version` really is `HTTP/1.0`.

## Serial comparison — same sample, same everything else

WebKit 26.5, `devices['iPhone 13']`, `/kkv.html`, `page.goto`,
`waitUntil: 'load'`, fresh context per navigation, 30 000 ms ceiling, no retries.

| Arm | Server | n | Success | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M10 | `test-server.mjs` | 1 000 | **1 000 / 1 000** | 62.1 ms | 81.8 ms | 95.2 ms | 148.8 ms |
| M11 | `python3 -m http.server` | 1 000 | **1 000 / 1 000** | **33.0 ms** | 43.7 ms | 81.2 ms | **95.6 ms** |
| A1 | `nav-server.mjs` (instrumented twin) | 1 500 | **1 500 / 1 500** | 72.6 ms | 80.1 ms | 85.2 ms | 162.5 ms |

Neither server failed once, and **Python was the faster of the two serially** —
p50 33 ms against 62 ms, and the lowest maximum of any arm in the workstream.

### This does not contradict the previous pass, and must not be read as doing so

Python's documented failure mode is *connection churn under concurrency*: with no
keep-alive, every asset opens a new socket, and five workers pulling a 1.4 MB
bundle and a `.glb` each open and tear down hundreds of sockets a second against
one GIL-bound process. **M11 is serial.** One browser, one navigation at a time,
~20 sockets per page load instead of hundreds per second. It does not exercise
the mechanism at all.

What M11 establishes is narrow and worth stating precisely: the Python server is
not broken one request at a time, and it is not slow. It says nothing about its
tail under five-worker load, which is the condition the previous pass measured
its two timeouts under. **A serial arm cannot stand in for a concurrent one**,
and reporting "Python passed 1 000/1 000" as a refutation would be exactly the
error §12 warns about, inverted — inferring tail behaviour from a sample that
contains no tail.

The concurrent Python arm is recorded as **not run** in this pass. It is the
single most valuable outstanding measurement for §12 and is named as such in
`root-cause.md`.

## The instrumented server under the real suite

The strongest server evidence in this workstream is not from the matrix at all.
It is from `nav-server.mjs` adopted by six complete, unmodified repository-wide
runs — the real gate, five workers, all engines, all projects:

| | |
| --- | --- |
| Requests received | **117 083** |
| Responses completed | 116 790 |
| Client-aborted requests | 293 |
| **Truncated responses** | **0** |
| Sockets opened / closed | 26 083 / 26 083 |
| `ECONNRESET` / `EPIPE` | 124 / 2 |
| Socket timeouts | 51 |
| p50 / p99 / max response | 4.49 ms / 296 ms / **2 907 ms** |
| **Requests unanswered after 1 s** (heartbeats) | **16**, all large assets mid-transfer, all completed |

**In 117 083 requests the server never left one unanswered and never truncated
one.** Its own worst case is 2.9 s against a 30 000 ms budget. Boundary B — "the
server received the request and never completed the response" — is excluded for
these six runs by direct observation rather than by inference from medians.

The `ECONNRESET`s and the 293 aborts are the expected shape of a browser
context closing mid-load, not defects: they cluster at context teardown and
every one has a matching `request.aborted`.

## A harness hazard that could produce "both servers" without either being at fault

`playwright.config.ts` sets `reuseExistingServer: !process.env.CI`, which is
`true` locally. Playwright then **adopts whatever is already listening on port
4322** and never starts, or checks, its own.

This host demonstrably leaves servers behind. At the start of this session:

```
node scripts/test-server.mjs 4399 dist     — running 9 h 35 m, orphaned
```

That is a stale server on a *different* port, so it affected nothing here. But
the same mechanism on 4322 would silently serve a gate run from an arbitrary
process — an older build, a different server implementation, or one started
before a rebuild. A suite run in that state would produce results attributed to
the configured server while being served by another one, and would look
identical to a run that was configured correctly.

**This is a hazard, not a demonstrated cause.** There is no evidence that a
stale server was listening on 4322 during the previous pass's gate, and none can
now be obtained — the process table from that session is gone. It is recorded
because it is a plausible, checkable mechanism by which "the stalls persist
across both web servers" could be true of the *observations* without being true
of either *server*, and because the fix is cheap.

**No change is made to `reuseExistingServer` in this pass.** §37 licenses a
harness fix when evidence proves a harness defect; this is an unexercised risk,
not a proven defect, and §48 forbids manufacturing a fix commit when diagnosis
has not established the cause. The recommendation is in `root-cause.md` for a
scoped follow-up, where it can be applied and then validated by a fresh repeated
gate rather than asserted.
