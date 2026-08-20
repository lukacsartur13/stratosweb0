# Route controls — §21

## The question

Whether route identity is relevant, with browser and context conditions held
identical.

## Answered twice, and the historical answer is the stronger one

### From history — the decisive evidence

Nineteen valid gate runs contain **two** occurrences of this signature:

| | g3-02 | g6-01 |
|---|---|---|
| File and line | `public-site.spec.ts:264` | `public-site.spec.ts:264` |
| Project | `mobile-390` | `mobile-390` |
| **Route** | **`/kkv.html`** | **`/nagyvallalat.html`** |
| Duration | 30 038 ms | 30 065 ms |
| Error | `page.goto: Test timeout of 30000ms exceeded` | identical |
| Call log | `navigating to …, waiting until "load"`, nothing after | identical |

**Two different routes produced the identical failure.** No new execution can
improve on that, and it settles §21 directly:

> **Route identity is not the variable.**

This is the positive evidence for a refusal the previous workstream had already
made on principle — *a route name is not a root cause* — and it retires
`/nagyvallalat.html` as a suspect. §26's prohibition on touching product code is
not merely a procedural constraint here; there is affirmative evidence that the
document is not the subject.

### From new executions — the confirming control

Run anyway, because a control that agrees with history is worth more than one
skipped on the strength of it. Identical browser, context options, server, worker
count and lifetime model; only the route differs.

| Arm | Route | Size | Attempts | **Stalls** | p50 | p99 | max | Valid |
|---|---|---|---|---|---|---|---|---|
| exact | `/nagyvallalat.html` | 39 659 B | 500 | **0** | 245 ms | 585 ms | 2 443 ms | yes |
| R-kkv | `/kkv.html` | 39 705 B | 300 | **0** | 298 ms | 727 ms | 1 017 ms | yes |
| R-light | `/impresszum.html` | 20 580 B | 300 | **0** | 231 ms | 1 545 ms | 1 713 ms | yes |

`/kkv.html` was chosen because §21 asks for a route with historical evidence, and
it is the g3-02 route. `/impresszum.html` is the lightweight static control at
roughly half the bytes.

## Reading

* No route stalled, so the arms cannot rank routes by failure rate.
* Latency does not separate the routes meaningfully. The lightweight route has
  the **lowest** p50 and the **highest** p99, which is scheduling noise on a
  loaded host rather than a property of the document.
* Halving the document size changes nothing about the dispatch phase, which is
  expected once the boundary is understood: the stall under investigation happens
  **before any byte of any document is requested**, so document size cannot be
  the mechanism.

## What follows for the product

§26 holds, and now with evidence rather than only with caution. A failure that
occurs before the browser emits a request cannot be attributed to
`/nagyvallalat.html`, to its markup, its CSS, its JavaScript, the Altimeter, or
its route content — and two different routes failing identically confirms it.
**No product file was modified in this investigation.**
