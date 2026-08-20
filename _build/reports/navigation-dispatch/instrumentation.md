# Instrumentation — §10, §11, §14, §15, §16, §17

## The question, and why the old instrument could not answer it

`tests/helpers/navigation-boundary.ts` already records everything a **test
process** can see about a navigation. Against the G6 failure it produced exactly
the right answer and it was an empty one:

```
GOTO_CALLED  →  (nothing)
```

That is not a defect in the recorder. It is the recorder correctly reporting that
between `page.goto` being called and the test budget expiring, **Playwright's
public API emitted no observable event at all**. Every listener it attaches —
`request`, `response`, `framenavigated`, `domcontentloaded`, `load` — fires only
once the browser has already begun navigating. The interval under investigation
is upstream of all of them.

So the new instrument does not add listeners. It reads the wire.

## What `page.goto` actually does on WebKit — measured, not assumed

§12 required the engine to be established before any engine-level claim. It is
**WebKit 26.5, revision 2336**. §14 therefore applies and §13 does not: there is
no CDP here, and none has been invented.

The supported facility is `DEBUG=pw:protocol`, which prints every protocol frame
Playwright sends and receives. Run against a healthy navigation to the exact
target route on this exact build, it produces this — quoted from a captured log,
trimmed for width:

```
SEND ► {"id":63,"method":"Playwright.navigate",
        "params":{"url":"http://127.0.0.1:4399/nagyvallalat.html",
                  "pageProxyId":"7","frameId":"4294967297"}}
◀ RECV  Target.dispatchMessageFromTarget → "Page.willCheckNavigationPolicy" {frameId}
◀ RECV  {"result":{"loaderId":"17"},"id":63}
◀ RECV  Target.dispatchMessageFromTarget → "Page.didCheckNavigationPolicy" {frameId, cancel:false}
◀ RECV  Target.dispatchMessageFromTarget → "Network.requestWillBeSent" {requestId:"5.22", loaderId:"17"}
◀ RECV  Target.dispatchMessageFromTarget → "Network.responseReceived"
◀ RECV  Target.dispatchMessageFromTarget → "Page.frameNavigated"
```

Three facts in that trace change how the failure has to be read.

### 1. The command is `Playwright.navigate`, not `Page.navigate`

Playwright's WebKit build carries its own protocol domain. Any reasoning that
started from the Chromium spelling would have been looking for a frame that is
never sent on this project.

### 2. Navigation travels a **different channel** from everything else the page does

`Playwright.navigate` is a **browser-level** command, addressed by
`pageProxyId`. Everything a page does — `evaluate`, `title`, `screenshot`,
`click` — is tunnelled to the page's own target session inside
`Target.sendMessageToTarget`, and comes back inside
`Target.dispatchMessageFromTarget`.

Those are two different paths over the connection.

This is what makes the G6 teardown evidence sharp rather than merely reassuring.
In that bundle, **after** the 30-second stall, `page.evaluate`, `page.title` and
`page.screenshot` all succeeded. On Chromium that would prove the navigation
command's own channel was healthy. On WebKit it proves only that the **target
session** channel was healthy — which is not the channel `Playwright.navigate`
went down. The two are not the same claim, and treating the first as evidence for
the second would be the exact kind of inference §11 forbids.

### 3. Two policy frames sit between the command and any network activity

`Page.willCheckNavigationPolicy` and `Page.didCheckNavigationPolicy` bracket
WebKit's decision about whether the navigation may proceed, and **no request is
emitted until the second one arrives**. A navigation that is dispatched,
acknowledged, and then never passes its policy check produces precisely the G6
signature: command sent, zero network events, page still on `about:blank`, page
otherwise responsive.

That is a hypothesis, written down before the data came in so it can be killed
rather than confirmed by hindsight. The instrument is built to distinguish it from
the alternatives, not to find it.

## The state machine — §17

Extended from the eleven states in `navigation-boundary.ts` to fourteen, with the
four new ones named for frames that were **observed** on this build rather than
assumed to exist:

| State | Confirmed by |
|---|---|
| `TEST_READY` | worker reached the attempt |
| `GOTO_CALLED` | wrapper entered |
| `PROTOCOL_COMMAND_DISPATCHED` | `SEND ► Playwright.navigate` |
| `PROTOCOL_POLICY_CHECK_STARTED` | `RECV Page.willCheckNavigationPolicy` |
| `PROTOCOL_COMMAND_ACKNOWLEDGED` | `RECV {"result":{"loaderId":…},"id":<that id>}` |
| `PROTOCOL_POLICY_ALLOWED` | `RECV Page.didCheckNavigationPolicy {cancel:false}` |
| `BROWSER_NAVIGATION_STARTED` | `RECV Network.requestWillBeSent` |
| `REQUEST_EVENT` | Playwright `page.on('request')`, main frame, navigation request |
| `SERVER_RECEIVED` | the server's own `nav-diag` JSONL |
| `RESPONSE_EVENT` | `page.on('response')` |
| `FRAME_NAVIGATED` | `page.on('framenavigated')`, main frame |
| `DOMCONTENTLOADED` | `page.on('domcontentloaded')` |
| `LOAD` | `page.on('load')` |
| `GOTO_RESOLVED` | the promise settled with a response |

Every failure record carries `lastConfirmedState` and `nextExpectedState`. A
state is never inferred from the state after it, and never from the absence of an
error.

## How the two streams are correlated — §16

Attempt ids are `nav-dispatch-000001`, monotonic, six digits.

§16 forbids carrying the id in the URL, and it is not carried there: the URL is
byte-identical to the contract's. The id travels in marker lines the worker
writes to **its own stderr**, the same file descriptor the protocol frames go to:

```
@@NAVDISPATCH {"kind":"goto-begin","id":"nav-dispatch-000123","hr":…,"target":…}
   … protocol frames …
@@NAVDISPATCH {"kind":"goto-end","id":"nav-dispatch-000123","outcome":…,"durationUs":…}
```

One descriptor, one writer, so the ordering between a marker and a frame is the
kernel's — not two clocks agreed after the fact. The parent slices the stream on
the markers, which is exact rather than approximate.

## Keeping the logs bounded — §15

One navigation of the target route produces a few hundred protocol frames. Five
thousand would be roughly a gigabyte, and §15 says not to keep that. But the
frames that matter cannot be filtered in advance by content, because the entire
question is what is **absent**.

The tap therefore keeps everything for the *current* attempt and nothing for the
attempts that already succeeded: the window resets at each `goto-begin` and is
flushed to disk only when the attempt ends in a stall, or for the first few
successes kept deliberately under §36. A passing attempt costs one buffer reset.

The debug stream is enabled **only** for these targeted runs. Nothing in the
repository gate path turns it on.

## Timing — §10

Recorded per attempt in microseconds from `process.hrtime.bigint()`: before the
call, promise creation, promise settlement, and the exception if there is one.
Page-close, context-close and browser-disconnect are separate recorded events.
The existing timeout is not merely wrapped — the navigation is called with an
explicit 30 000 ms, the value the test runner's budget would have imposed, so the
contract's own verdict is produced under the contract's own ceiling (§34).

## Driver liveness — §29

An independent 250 ms heartbeat runs on a plain timer that owes nothing to
Playwright. If a navigation stalls, the number of beats that elapsed during the
stall separates *the whole Node driver is wedged* from *only this navigation is
pending*. It is recorded as `driverResponsive` on every stall record.

## Probes — §30, §31, §32, and what they are forbidden to become

On a reproduced stall, and only after the stalled page's own artefacts are
captured, three probes run in order: a second page in the **same context**, a
**fresh context** in the same browser, and a **fresh browser** from the same
process. Each attempts one lightweight navigation. Together they localise the
problem to page, context, or process.

§33: these are diagnostic. There is no `if goto stalls → retry` anywhere in this
instrumentation, and none is proposed. A retry would convert the one measurement
this investigation needs into a green tick.

## What was not done

* Playwright internals are unmodified. Nothing under `node_modules` was patched.
* The product test is unchanged. `public-site.spec.ts` is byte-identical.
* No CDP-equivalent was invented for WebKit.
* Normal timeouts are unchanged (§34). Extended observation past the contract's
  own budget is recorded as a separate field and never replaces the verdict.

---

# Calibration — the instrument was made to fire before its silence was believed

A detector that **cannot** fire reports zero for the same reason a working one
reports zero, and from the outside the two are indistinguishable. So before the
5 000-execution silence is offered as evidence of anything, the stall path was
made to run.

Neither calibration uses the product, the server, or any real navigation defect,
and both are labelled in the record so a calibration can never be mistaken for a
reproduction.

## Calibration 1 — the stall path fires, and records the G6 signature

`STRATOS_DISPATCH_FAULT=pre-request` replaces the navigation with a promise that
never settles: no command, no request event. That is the shape of the G6 failure
and nothing else. Everything downstream is untouched — same timeout, same
classifier, same bundle, same probes.

```
KIND=stall  id calib-synth-000001  synthetic true  fault pre-request
  statesReached      ["TEST_READY","GOTO_CALLED"]
  driverResponsive   true   (24 heartbeats during the stall)
  probes             {"sameContextPage":"ok","freshContext":"ok","freshBrowser":"ok"}
  extended           {"how":"never-before-cleanup","afterMs":8003}
  inPage             {"readyState":"complete","href":"about:blank","bodyChildCount":0,"resources":0}
  proc               {"browserConnected":true,"contextPages":1,"pageClosed":false,"freememMB":3156}
```

Every mechanism §28-§35 asks for is demonstrated working:

| Requirement | Demonstrated by |
|---|---|
| §17 `lastConfirmedState` = `GOTO_CALLED` | `statesReached` stops there |
| §28 process state on a stall | `proc` captured |
| §29 driver-liveness heartbeat | 24 beats elapsed *during* the stall — the driver was alive, only the navigation was pending |
| §30 sibling page probe | `sameContextPage: ok` |
| §31 sibling context probe | `freshContext: ok` |
| §32 fresh browser probe | `freshBrowser: ok` |
| §34 extended observation past the budget | `never-before-cleanup` after 8 003 ms, recorded **separately** from the contract's own verdict |
| §35 failure bundle written | directory created with state machine, protocol window, host and subject hashes |

Note `inPage` reproduces the G6 bundle exactly — `readyState: "complete"`,
`href: "about:blank"` — which is what a page that was never navigated looks like
from inside.

## Calibration 2 — the classifier discriminates

A detector that fires on *any* slow navigation would also report zero
meaningfully, but it would be reporting the wrong thing. So the opposite case was
put to it: a navigation that dispatches normally and then stalls in the network.

Target `http://192.0.2.1:8080/…` — RFC 5737 TEST-NET-1, guaranteed unroutable, so
the connection never establishes.

```
KIND=attempt  outcome: failed
  statesReached  ["TEST_READY","GOTO_CALLED","REQUEST_EVENT"]
  dispatchUs     12525
  error          page.goto: Timeout 8000ms exceeded.
```

The command dispatched in **12.5 ms**, `REQUEST_EVENT` was reached, and the
attempt was classified **`failed`** — *not* `STALL_BEFORE_REQUEST`, and **no stall
bundle was written**.

That is the discrimination the whole result depends on. A navigation that hangs
for its entire budget is only counted as a dispatch stall if **no request was ever
emitted**. Without this arm, "0 stalls in 5 000" would have been compatible with a
detector that simply never fired.

## Where the fault injector lives, and why it cannot leak

The injector is a single branch guarded by an environment variable that nothing
in the gate, the matrix, or any arm sets. Injected attempts carry
`synthetic: true` and `fault: "pre-request"` in their record. The `--route`
argument accepts an absolute URL, which is what allowed calibration 2 to be
driven without the orchestrator and therefore without touching the owned-server
path at all.
