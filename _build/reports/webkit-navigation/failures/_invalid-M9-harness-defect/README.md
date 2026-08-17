# INVALID — these eight bundles are harness defects, not reproductions

> **Two separate defects are quarantined here**, both in the `--action link`
> arm, both producing a flawless imitation of the failure under investigation.
> `M9-link-*` (three bundles) is the selector defect described below.
> `M9c-link-*` (five bundles) is a second one found immediately after fixing the
> first, and is described at the end of this file.
>
> The corrected arm, **M9d**, ran 60/60 with p50 554 ms and a worst case of
> 621 ms.


**Do not count these toward any failure total, and do not read them as
reproductions of the WebKit navigation stall.** They are quarantined here rather
than deleted because discarding measurements is worse than labelling them.

## What they look like

Superficially, exactly like the failure this workstream is hunting:

```
boundary: A: goto invoked, no request issued
duration: 30 005 ms   (the full ceiling)
route:    /kkv.html   (one of the originally reported routes)
engine:   WebKit, devices['iPhone 13']
```

## What they actually are

```
error: locator.click: Timeout 30000ms exceeded.
  - waiting for locator('a[href$="kkv.html"]').first()
    - locator resolved to <a href="kkv.html" aria-current="page">…</a>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
```

The `--action link` arm of `scripts/webkit-nav/stress.mjs` selected its link
with `a[href$="kkv.html"]` and took `.first()`. On `/kkv.html` itself the first
such anchor is the **current-page link in the navigation chrome**, carrying
`aria-current="page"`, which never becomes clickable. Playwright waited the full
30 000 ms on actionability and the navigation was never attempted.

The page was entirely healthy throughout:

| | |
| --- | --- |
| `pageUrl` | `http://127.0.0.1:4469/kkv.html` |
| `title` | `Webdesign KKV-nak — havidíjas weboldal \| Stratos` |
| `readyState` | `complete` |
| Outstanding requests | **none** |
| Requests made during the attempt | **0** |

Boundary A is reported because no request was issued — which is true, and true
because **no navigation was ever started**. The classifier is working correctly;
it is classifying an attempt that never happened.

## Why this matters beyond bookkeeping

This is the third instance in this workstream of the same class — Playwright
waiting indefinitely on an element that never satisfies its actionability
check — after `lead-forms.spec.ts:177` in gate run 4 and, on the previous pass's
evidence, the Chromium/SwiftShader click costs of up to 20 781 ms. It is also a
warning about the method: **a 30-second timeout on a navigation test does not by
itself mean the navigation stalled.** It means the test's budget ran out. Which
step consumed it is a separate question, and one that requires the error text or
the trace to answer.

That distinction is applied to the originally reported failures in
`root-cause.md`.

## Disposition

The arm was killed after four iterations rather than left to run — at 30 s per
attempt, 500 iterations would have taken over four hours and produced nothing.
The selector is fixed in `scripts/webkit-nav/stress.mjs` (visible, non-current
links only).

---

# The second defect — `M9c-link-*`, five bundles

Found by re-running the arm after fixing the selector. It failed **again**, with
the same signature:

```
boundary: A: goto invoked, no request issued
duration: 30 000.9 / 30 002.2 / 30 001.4 / 30 001.1 ms
routes:   /kkv.html and /rolunk.html
host:     CONTROLLED — load 1.70 at start, 1.82 at end
```

Navigations 1–25 succeeded with p50 539 ms. Navigations 26–30 all failed. A
clean break at 25, not a random tail — which is the shape of a state change, not
of a stall.

`stress.mjs` defaults to `--mode new-context --batch 25`, so the browser context
was recycled at iteration 26. A recycled context's page is `about:blank`. The
link branch still ran, because `previousUrl` was left over from before the
recycle, so the harness asked a blank page to click its way to `/kkv.html`:

```
error:      page.waitForURL: Timeout 30000ms exceeded.
            waiting for navigation to "**/kkv.html" until "load"
pageUrl:    about:blank
title:      ""
readyState: complete
```

Fixed by clearing `previousUrl` on every recycle, so the first navigation after
any recycle is a `goto`.

# Why both are kept

Three times in this workstream — twice here, once in the suite's own
`lead-forms.spec.ts:177` — a 30-second timeout appeared on a navigation-shaped
test and was **not** a navigation stall. Two of the three were the measuring
instrument.

That is the strongest single argument in the workstream for its own central
caution, and deleting the evidence for it would be self-serving. Anyone reading
the conclusion in `root-cause.md` — that 23 950 navigations produced no stall —
is entitled to see how easy it was to manufacture one by accident, and to judge
how carefully the real ones were checked.
