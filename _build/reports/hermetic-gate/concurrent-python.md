# The concurrent-Python arm — §10

**Status: RUN. The previous pass recorded it as NOT RUN and named it the single
most valuable outstanding measurement. It has now been taken, and the answer is
the opposite of the standing hypothesis.**

## 1. Why it could not be run before

`stress.mjs` could point at Python but ran **serially**. `fleet.mjs` produced
**concurrency** but hard-coded the instrumented Node twin. So the only harness
that could name Python could not create the condition Python is supposed to fail
under, and the only harness that created the condition could not point at
Python.

`fleet.mjs` now takes `--server node | python | nav` (commit `eff4fe4`).

## 2. What the hypothesis was

Python 3.9's `http.server` answers **HTTP/1.0 with no keep-alive** —
`--protocol` arrived in 3.11, and this host is on 3.9.6. Every asset therefore
opens a new TCP connection. Under five parallel workers each pulling a 1.4 MB
bundle and a `.glb`, that is hundreds of sockets a second against one GIL-bound
process. Two full-suite runs had timed out on `page.goto` for a plain 15 KB page,
and this was the named cause.

The serial arm (`server-comparison.md`, M11) found 1 000/1 000 and a p50 of
33 ms, and was explicitly recorded as **not a refutation**, because a serial
sample opens ~20 sockets per page rather than hundreds a second and does not
engage the mechanism at all.

## 3. What was measured

WebKit 26.5, `devices['iPhone 13']`, real `page.goto`, `waitUntil: 'load'`,
fresh context per navigation, 30 000 ms ceiling, **no retries**, 5 concurrent
drivers against one server.

### `/kkv.html` — the plain 15 KB page the original timeouts were on

| Server | Drivers × n | Success | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- | --- |
| `test-server.mjs` (Node, HTTP/1.1, keep-alive) | 5 × 120 | **600 / 600** | 227 ms | 308 ms | 333 ms | 396 ms |
| `python3 -m http.server` (HTTP/1.0, no keep-alive) | 5 × 120 | **600 / 600** | **107 ms** | **164 ms** | 302 ms | 363 ms |

### `/index.html` — the ~1.4 MB WebGL homepage, which is where the churn is

| Server | Drivers × n | Success | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- | --- |
| `test-server.mjs` | 5 × 40 | **200 / 200** | 205 ms | 339 ms | 389 ms | 414 ms |
| `python3 -m http.server` | 5 × 40 | **200 / 200** | **119 ms** | **183 ms** | 211 ms | 295 ms |

**1 600 concurrent navigations across both servers and both routes. Zero
failures. Zero stalls. Python was roughly twice as fast at p50 on both routes
and had the lower tail on three of the four p99/max pairs.**

Every attempt's last confirmed boundary was recorded as `SUCCESS`; no attempt
reached any earlier boundary.

## 4. What this establishes, and what it does not

**Establishes.** The concurrent condition that Python was supposed to fail under
has now been created — five simultaneous WebKit drivers, fresh context per
navigation, including the heavy homepage — and Python did not fail once. It was
faster than the Node replacement on every percentile that matters. **The
`page.goto` timeouts cannot be attributed to Python's lack of keep-alive on this
evidence**, and §21's rule applies: that attribution is withdrawn, not weakened.

**Does not establish.** That Python is the better server, or that
`scripts/test-server.mjs` should be reverted. Two things are worth separating:

- The Node server's higher p50 is consistent and unexplained here. It is not a
  failure — 600/600 and 200/200 — and it is not investigated further, because
  latency was never the property under test.
- The suite's real load is not five drivers doing `goto` in a loop. It is five
  workers each running assertions, WebGL frames and interaction waits, sharing
  ten cores and one GPU. This arm reproduces the server's connection conditions,
  not the whole suite's resource contention.

## 5. Contamination

**Every arm here is marked `CONTAMINATED` by the harness's own classifier, and
that is reported rather than smoothed over.** A second Claude session was
running `node scripts/qa.mjs` against an unrelated project throughout, spawning
headless Chromium at 175–438 % CPU. Start-of-arm load averages were 9.4, 14.6,
11.9 and 16.0.

Two reasons this is still usable:

1. **The arms were run back to back under the same interference**, alternating
   servers, so the comparison between them is like-for-like even though neither
   is a clean absolute number.
2. Contention makes a stall **more** likely, not less. A clean 1 600/1 600 under
   interference is a stronger negative result than the same figure on an idle
   host.

What it does mean is that the absolute latencies above are inflated and should
not be compared against the idle-host numbers in `server-comparison.md`
(p50 33–62 ms). Only the Node-versus-Python contrast within this table is sound.

## 6. Where the tail actually follows

The question §10 poses is whether the remaining tail follows the **browser**,
the **server**, **connection handling**, or **unrelated system load**.

On this evidence it does not follow the server and it does not follow connection
handling: two servers with opposite connection semantics both completed 100 % of
1 600 concurrent navigations.

It follows **load**, and it follows the **browser under load**. The measurement
that shows it is not in this file — it is in
`lead-forms-investigation.md` §3, where the same contract's `locator.click()`
cost rose from 89 ms idle to **5 184 ms** at load 96 while every server-side
segment stayed under 1.7 s, and in the loaded suite run where 17 failures
appeared at load 96 and **2** at a lower load, 11 of the 17 on a single WebKit
project.
