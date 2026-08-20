# Lifetime controls — §19, §20

## What was varied, and what was held

Four arms, each differing from the others in exactly one thing: **what is reused
between attempts.** Route, context options, server, worker count, warm-up state
and the preceding-neighbour pattern are identical across all four.

| Arm | Model | What is fresh each attempt | What is reused |
|---|---|---|---|
| §19 A | `reused-page` | nothing | page, context, browser |
| §19 B | `fresh-page` | page | context, browser |
| §19 C | `fresh-context` | context + page | browser |
| §19 D | `fresh-browser` | browser + context + page | nothing |

**Arm C is the production contract.** Playwright Test builds a fresh
`BrowserContext` and a fresh `Page` for every test and reuses the browser process
across the tests a worker runs. So `fresh-context` is not one hypothesis among
four — it is what `public-site.spec.ts:264` actually does, and the other three
exist to bracket it.

Arm A departs from the contract in a way worth naming: with the page reused, the
attempt's navigation starts from the *previous* attempt's URL rather than from
`about:blank`. That makes A simultaneously the lifetime control and a second
reading of the §22 condition.

## Results

All four arms: subject hashed before and after, identical; no `dist` canary
events; port released. All valid.

| Arm | Model | Attempts | **Stalls** | p50 | p99 | max | Host free MB | load1 |
|---|---|---|---|---|---|---|---|---|
| A | `reused-page` | 300 | **0** | 303 ms | 635 ms | 705 ms | 4 548 | 99.8 |
| B | `fresh-page` | 300 | **0** | 326 ms | 564 ms | 622 ms | 2 683 | 130.0 |
| C | `fresh-context` | 300 (+500 in stage A, +1 500, +3 000) | **0** | 320 ms | 585 ms | 2 443 ms | 3 384 | 39.2 |
| D | `fresh-browser` | 300 | **0** | 320 ms | 556 ms | 578 ms | 2 965 | 46.3 |

## What §20 permits us to conclude

§20 gives four readings, each conditional on a failure appearing somewhere. **No
arm produced a failure**, so none of the four readings is available and none is
claimed. Specifically, it is **not** established that the defect is or is not
page-, context-, or process-level. That question is untouched by this table.

What the table does establish is narrower and still worth having:

* Navigation latency is **flat across every lifetime model**. p50 ranges 303-326
  ms and p99 556-635 ms across arms that differ by three orders of magnitude in
  setup cost. Whatever a reused page or a reused browser accumulates, it does not
  show up as navigation latency.
* The maximum over all 1 200 control attempts is **705 ms** (2 443 ms in the
  larger stage-A population, and that outlier's time was spent *after* the
  request — see below). Against a **30 000 ms** budget, there is no tail
  approaching the failure. The stall is not the extreme of a distribution these
  arms are sampling; it is discrete.

## The one long attempt, and where its time went

The slowest navigation in any arm is stage A's `nav-dispatch-000092`, at
2 443 ms. Its event offsets:

```
REQUEST_EVENT     3 561 583 µs
RESPONSE_EVENT    3 658 242 µs   (+  97 ms)
FRAME_NAVIGATED   3 678 987 µs   (+  21 ms)
DOMCONTENTLOADED  5 671 655 µs   (+1 993 ms)
LOAD              5 861 990 µs   (+ 190 ms)
```

Nearly two of its two-and-a-half seconds are between `FRAME_NAVIGATED` and
`DOMCONTENTLOADED` — parsing and subresources, on a host under load 39. **None of
it is in the dispatch phase.** The slowest navigation observed is slow in a
completely different place from the one under investigation, which is a useful
negative: the arms are not sampling a slow version of the failure.

## Host conditions, and the divergence that matters

The load figures are the reason this table cannot be the last word. These arms
ran at **load1 39-130**, far above the **5.77 falling to 4.16** measured during
the G6 failure, and with **1 877-4 548 MB free** against G6's **927 MB**.

The controls are therefore a harder CPU test and a **much softer memory test**
than the conditions the failure has ever been seen in. §20 says not to infer
until measured; on the variable that most distinguishes the failure's known
environment, these arms measure the wrong direction.
