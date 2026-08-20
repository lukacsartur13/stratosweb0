# First divergence — §37

§37 forbids vague language, so this file states plainly both where the two
sequences part company **and** how precisely that point is known. The second half
matters as much as the first: the failure this workstream is explaining happened
**before** the instrument that could localise it existed, and no amount of
formatting can move the resolution of an artefact already on disk.

## Successful attempt — measured

Captured with `DEBUG=pw:protocol` on the exact contract, WebKit 26.5 rev 2336,
route `/nagyvallalat.html`. Offsets are from the `Playwright.navigate` frame,
across three preserved successes (§36):

```
A  TEST_READY                       —
B  GOTO_CALLED                      —
C  PROTOCOL_COMMAND_DISPATCHED      +0 ms      SEND ► Playwright.navigate {url, pageProxyId, frameId}
D  PROTOCOL_POLICY_CHECK_STARTED    +2, 3, 3 ms   RECV Page.willCheckNavigationPolicy
E  PROTOCOL_COMMAND_ACKNOWLEDGED    ~+3 ms     RECV {"result":{"loaderId":"17"},"id":<C's id>}
F  PROTOCOL_POLICY_ALLOWED          +4, 6, 5 ms   RECV Page.didCheckNavigationPolicy {cancel:false}
G  BROWSER_NAVIGATION_STARTED       +4, 6, 5 ms   RECV Network.requestWillBeSent
H  REQUEST_EVENT                    —          page.on('request'), main frame
I  SERVER_RECEIVED                  —          server nav-diag JSONL
J  RESPONSE_EVENT → K FRAME_NAVIGATED → L DOMCONTENTLOADED → M LOAD → N GOTO_RESOLVED
```

**The entire dispatch phase C→G completes in under 6 ms**, in all three samples,
and the spread between them is 2 ms.

## Failed attempt — G6, `g6-01`, as recorded

```
A  TEST_READY
B  GOTO_CALLED            t = +2 ms after fixture attach
   [stops]
   … 30 000 ms …
   test budget expires
```

Everything after B is **absent, not failed**: zero browser network events, zero
server log lines carrying the navId, page still `about:blank`, `readyState
complete`, `crashed: false`, `closed: false`, no page errors, no console errors,
no request ever marked failed.

## FIRST DIVERGENCE

> **FIRST DIVERGENCE = between `GOTO_CALLED` (B) and `REQUEST_EVENT` (H).**
>
> In the successful sequence that interval is **under 6 milliseconds** and
> contains five protocol-observable states — C, D, E, F, G. In the failed
> sequence it never completed within **30 000 milliseconds**, a factor of more
> than 5 000.

## The resolution of that answer, stated rather than glossed

The interval B→H is where the divergence lies. **Which of C, D, E, F, G was the
last state reached in the failure is not known**, and cannot be recovered, for a
reason that is not a defect in the current instrument:

`g6-01` ran with `tests/helpers/navigation-boundary.ts`, whose state machine
begins at `GOTO_CALLED` and whose next observable state is `REQUEST_STARTED`.
Every one of C, D, E, F and G is a **protocol** frame, and that fixture does not
read the protocol — nothing that attaches to Playwright's public event API can.
The bundle therefore reports the truth at the finest resolution it possesses, and
that resolution is exactly one interval wide.

The instrument built in this workstream resolves B→H into five states and has
been demonstrated to record all five on a healthy navigation. It has **not** yet
observed a failure, so it has not yet been used to subdivide this interval.

## What the interval already excludes

Even unsubdivided, B→H rules things out, and these are load-bearing for §26 and
§27:

| Excluded | Because |
|---|---|
| The product document | The request that would have fetched it was never emitted. Two different routes fail identically (`route-controls.md`). |
| The static server | `SERVER_RECEIVED` never occurs; the server has no record of the navId. The same document was served normally to two desktop projects in the same run. |
| Server overload | Sibling navigations in other workers completed in hundreds of milliseconds throughout the window. |
| A crashed browser process | `crashed: false`, and `page.evaluate`, `page.title` and `page.screenshot` all succeeded in teardown. |
| A closed page or context | `closed: false`; the context still held exactly one page. |
| A dead protocol connection | See the qualification below. |

### The qualification that a Chromium habit would get wrong

That last row is where WebKit's architecture forbids the obvious inference. On
WebKit, `Playwright.navigate` is a **browser-level** command addressed by
`pageProxyId`, while `evaluate`, `title` and `screenshot` are tunnelled to the
page's own target session inside `Target.sendMessageToTarget`. **Two different
paths.**

So the teardown evidence proves the **target session** was alive and answering.
It does **not** prove the pageProxy path that carried the navigation was.
Concluding "the connection was fine, therefore the command was delivered" would
be importing a Chromium single-session mental model into an engine that does not
have one — precisely the inheritance §12 required to be checked before any
engine-level claim.

## What would close the remaining gap

One reproduction under the new instrument. The failure record would name the last
protocol frame observed, and the interval would collapse to a single edge:

* stops at **C** → Playwright emitted the command and the browser never answered;
* stops at **D or E** → the browser received it and the policy decision never
  returned;
* stops at **F** → the policy allowed it and no request followed;
* reaches **G** but not **H** → the browser began navigating and Playwright's
  client never saw it.

Each of those points at a different layer, and they are not interchangeable. Until
one of them is observed, the divergence is reported as the interval it is known to
lie in, and no narrower.
