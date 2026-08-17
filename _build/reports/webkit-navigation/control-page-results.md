# Control pages — is the tail generic, site-specific, or homepage-specific?

§21 and §22 pose the question as a three-way: run the same high-volume WebKit
navigation loop against the 3D homepage, against a lightweight public subpage,
and against a minimal static control, on the same server and the same browser
process, and see which one produces the tail.

## The ladder

All four arms: WebKit 26.5, unmodified `devices['iPhone 13']`, real
`page.goto`, `waitUntil: 'load'`, 30 000 ms ceiling, a fresh `BrowserContext`
per navigation, `scripts/webkit-nav/nav-server.mjs`, no retries.

| Arm | Page | Requests/nav | n | Success | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M6 | `/__navctl/control.html` — one document, no CSS, JS, font or image | **1.0** | 1 000 | **1 000/1 000** | 3.1 ms | 5.4 ms | 7.2 ms | 12.8 ms |
| A1 | `/kkv.html` — 39 KB static page | **20** | 1 500 | **1 500/1 500** | 72.6 ms | 80.1 ms | 85.2 ms | 162.5 ms |
| M7 | `/index.html` — the React homepage, WebGL, GLB Altimeter | ~30 | 300 | **300/300** | 110.7 ms | 146.7 ms | 177.2 ms | 283.3 ms |
| S2 | `/index.html` + `/kkv.html` alternating, 5 browsers | mixed | 1 250 | **1 250/1 250** | ~260 ms | ~540 ms | ~880 ms | 1 331 ms |

The control page's request profile is confirmed from the server side rather than
assumed: **1 001 requests for 1 000 navigations**, exactly one per page load.

## What the ladder says

**There is no tail at any rung.** 4 050 navigations across the three page
complexities, and not one failure. The cost scales smoothly and entirely
predictably with the number of subresources — 3 ms for one request, 73 ms for
twenty, 111 ms for a WebGL homepage — and the *worst* observation anywhere on the
ladder is 283 ms on the heaviest page, against a 30 000 ms budget.

§22 asks whether the tail is generic WebKit navigation, site-specific, or
homepage-specific. **The question cannot be answered as posed, because no arm
produced a tail to attribute.** That is the finding, and it is a different and
more useful one than picking a rung:

* Not generic to WebKit navigation — the minimal control page, which is as close
  to a bare `page.goto` as this engine can be asked to perform, is the *fastest*
  and most consistent arm in the whole workstream (max 12.8 ms over 1 000
  attempts).
* Not site-specific — `/kkv.html`, which carries two of the four originally
  reported failures, is flat across 1 500 attempts.
* Not homepage-specific — the composition with the persistent 3D Altimeter is
  slower by 38 ms at the median and shows no tail at all.

## §19–§20 — the persistent 3D Altimeter, and why it is not implicated

The brief asks whether the WebGL canvas's lifecycle affects navigation teardown
on WebKit, and permits a control that disables the expensive visual component
**only through an existing legitimate capability path**.

Three independent measurements, none of which required inventing a test-only
product mode:

1. **M7 vs A1.** The homepage with a live WebGL context and a GLB model
   navigates 300/300 with a worst case of 283 ms. If renderer teardown were
   holding navigations, this is the arm where it would show.
2. **S2 — alternating heavy and light in one browser.** 1 250 navigations
   alternating `/index.html` and `/kkv.html` in the same WebKit browser, five
   browsers abreast at load ~60. Every navigation to the static page follows a
   WebGL teardown, which is precisely the sequence §19 describes. 1 250/1 250.
3. **M12 — the documented reduced-motion path.** The site's own
   `prefers-reduced-motion` capability, applied through the browser context
   rather than through any test-only switch.

**Two of the four originally reported failures are on `/kkv.html`, which has no
canvas, no WebGL, no GLB and no Altimeter at all.** That was visible before any
measurement was taken (`idle-host-baseline.md`) and it already made a
WebGL-teardown explanation unable to cover the reported population. The
measurements confirm it rather than merely restating it.

The Altimeter is **not modified** in this workstream, and on this evidence there
is no reason to modify it.

## §23 — `goto`, reload, and a real link, kept as separate categories

| Arm | Browser path | n | Success | p50 | max |
| --- | --- | --- | --- | --- | --- |
| A1 | `page.goto` | 1 500 | **1 500/1 500** | 72.6 ms | 162.5 ms |
| M8 | `page.reload` | 1 000 | **1 000/1 000** | — | — |
| M9d | activating a real `<a href>` — the `assets/js/transitions.js` path | 60 | **60/60** | 554 ms | 620.6 ms |

M9d walks between `/kkv.html` and `/rolunk.html` by clicking a real anchor, so
each iteration carries a click, the `pageswap`/View-Transition fallback and a
full `load` — which is why it costs 554 ms against `goto`'s 73 ms. The cost is
the user path, not a defect, and it never approached the ceiling.

> **Two earlier attempts at this arm were invalid and are quarantined**, under
> `failures/_invalid-M9-harness-defect/`. Both produced 30 000 ms boundary-A
> results indistinguishable from the defect under investigation, and both were
> the harness: the first selected each page's own `aria-current="page"` nav
> entry, which never becomes clickable; the second asked an `about:blank` page —
> freshly recycled by the default `--batch 25` — to click its way somewhere.
> They are documented rather than deleted, because they are the clearest
> evidence in this workstream for why a 30-second timeout must never be read as
> a navigation stall without checking which step consumed the budget.

These are deliberately not treated as one thing. `page.goto` is a
browser-initiated load; `reload` re-fetches the current entry; a link
activation goes through `pageswap`/View Transition and is the only one of the
three that `transitions.js` participates in at all. The reported failures are
`goto`, and the other two exist to establish whether the boundary is specific to
that path.

`transitions.js` intercepts clicks only, never `goto`, and its own header states
that navigation must not depend on it — so it was never a candidate for the
reported failures. M9 tests it anyway, because "it cannot be involved" is a
reading of the source and not a measurement.

## Caveat on the latency figures in this file

The arms in this matrix ran on a host carrying variable external load (other
sessions on the same machine), and each is labelled `CONTAMINATED` in
`stress-summary.csv` on its start-load. **The failure counts are robust to
that** — background load can only make a stall more likely, so zero failures
under adverse conditions is a conservative result. The **latency distributions
are not clean measurements** and should not be compared across arms to more than
an order of magnitude. Where a precise distribution matters, use A1 and B1,
which ran on a settled host.
