# The exact failing contract

§6 forbids referring to this failure as "mobile-390 `page.goto`". This file is
the identity it must be referred to by instead.

## Identity

| Field | Value |
| --- | --- |
| Spec file | `tests/public-site.spec.ts` |
| Enclosing describe | `structure and content` (line 256) |
| Generator | `for (const path of pages)` — line 263, `pages` at 257-261 |
| Test declaration line | **264** |
| Test title | ``/kkv.html responds and has a title and description`` |
| Parameter | `path = '/kkv.html'` — the **3rd** of 10 routes |
| Project | `mobile-390` |
| Engine | WebKit — Playwright 1.62.1, bundled revision **2336**, browserVersion 26.5 |
| Device preset | `devices['iPhone 13']` |
| Viewport | 390 × 844, `deviceScaleFactor: 3`, `isMobile: true`, `hasTouch: true` |
| Base URL | `http://127.0.0.1:4322` |
| Route | `/kkv.html` → `http://127.0.0.1:4322/kkv.html` |
| Served by | `node scripts/test-server.mjs 4322 dist`, owned by `gate-run.mjs` |
| Document size | 39 816 bytes (frozen subject) |
| Host | macOS 26.6.1 (25G76), arm64 |

## The navigation call

```ts
const res = await page.goto(path);
```

`tests/public-site.spec.ts:265`. **No options object.** Therefore:

| Property | Effective value | Where it comes from |
| --- | --- | --- |
| `waitUntil` | `'load'` | Playwright default — confirmed by the call log, which prints `waiting until "load"` |
| `timeout` | **inherited from the test timeout** | no `navigationTimeout` in `use`, no `timeout` in the config → `page.goto` has no deadline of its own and dies with the test |
| `referer` | unset | — |

The absence of a navigation timeout is the reason the artefact is empty: the
test's 30 000 ms budget expires *while `page.goto` is still pending*, Playwright
aborts the test body, and every statement after line 265 — including anything
that could have recorded state — never runs.

## Preceding action

Within the test: **none.** Line 265 is the first statement; the `page` fixture is
a fresh context and a fresh page.

Within the worker, reconstructed from `runs/g3-02/playwright-main.json`
(worker index 15), the three immediately preceding tests were:

| Start | Duration | Result | Test |
| --- | --- | --- | --- |
| 12:04:42.978Z | 448 ms | passed | `the de homepage is its own entry point with its own links` |
| 12:04:43.430Z | 395 ms | passed | `/index.html responds and has a title and description` |
| 12:04:43.828Z | 366 ms | passed | `/rolunk.html responds and has a title and description` |
| **12:04:44.198Z** | **30 038 ms** | **timedOut** | **`/kkv.html` …** |

So the immediately preceding action is *the same contract, on the previous route,
succeeding in 366 ms*, in the same worker and the same browser process.

The timed-out test is the **last** result recorded for worker 15: Playwright
discards a worker after a timeout, so the browser process was torn down with the
navigation still pending and nothing was asked of it first.

## Succeeding assertions

```ts
expect(res?.status(), `${path} status`).toBeLessThan(400);   // 266
await expect(page).toHaveTitle(/.{10,}/);                    // 267
const desc = page.locator('meta[name="description"]');       // 268
await expect(desc).toHaveAttribute('content', /.{20,}/);     // 269
```

None of them was reached.

## What the same run proves about the server

The four other projects ran the identical contract against the identical route
in the same run and passed:

| Project | Result | Duration |
| --- | --- | --- |
| desktop-1440 | passed | 179 ms |
| desktop-1920 | passed | 252 ms |
| mobile-430 | passed | 330 ms |
| reduced-motion | passed | 314 ms |
| **mobile-390** | **timedOut** | **30 038 ms** |

More decisive: **worker 17, the same `mobile-390` project and the same spec
file, served five sibling routes to completion during the stall** —
`/nagyvallalat.html` (363 ms), `/branding.html` (304 ms),
`/hirdeteskezeles.html` (334 ms), `/impact-program.html` (327 ms),
`/blog.html` (310 ms), all between 12:04:44 and 12:04:47.

The single `node` server therefore accepted connections, read files and
completed HTML document responses throughout the window in which this
navigation was pending. That does not locate the boundary — §21 still applies —
but it makes "the server stalled" a hypothesis that has to survive that
evidence, not a default.

## Resource surface of `/kkv.html`

Relevant because `waitUntil: 'load'` waits for all of it. From the frozen
artefact: 6 stylesheets, 8 scripts, 3 self-hosted `.woff2` fonts, 6 `<img>`, one
favicon. **No `.glb`, no WebGL, no Draco, no module preloads.** This is not one
of the WebGL-heavy pages; it is an ordinary static document.

## Load at the time

From `failures/g3-02-01-mobile390.json`: mean load1 **8.04**, peak 19.33, min
2.45, peak browser processes 45, peak swap 1 343 MB. §31 records this and
declines to treat it as the cause: g3-02 was among the *lower*-load runs of the
sequence.

## What is NOT known

Everything §3 asks for. The surviving artefact supports exactly one statement —
`page.goto` had not resolved when the budget expired — and `failure-records.mjs`
correctly refused to turn that into a boundary claim
(`mayBeCalledNavigationStall: false`).

Unknown: whether a request was ever issued; whether the server ever saw it;
whether a response was produced; whether the navigation committed; whether the
document parsed; which subresource, if any, was outstanding.

That list is the specification for the instrumentation.
