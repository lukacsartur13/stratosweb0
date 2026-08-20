# Rapidkert metric — mutation validation

`RAPIDKERT METRIC MUTATION: DETECTED`

The revised contract in `experiments/tests/full-ascent.spec.ts` was deliberately
attacked four times. Each mutation was applied to the source, the route was
rebuilt (`npm run build:full`), the contract was run on both projects that
collect the cinematic spec, and the mutation was then reverted.

A contract that cannot be broken proves nothing. These are the four ways this
one can be.

| # | Mutation | Where | Detected by | Both projects |
|---|---|---|---|---|
| 1 | metric removed (`metric: null`) | `content.ts` | `exactly one metric row is rendered, with no duplicate` — got `0` | yes |
| 2 | rendered value drifts from the source (`~25M Ft` hard-coded) | `FullAscent.tsx` | `rapidkert metric value` — `toHaveText` mismatch | yes |
| 3 | metric attached to the wrong case (moved to Barbershop) | `content.ts` | `the metric belongs to the Rapidkert case` — resolved to `case-barbershop` | yes |
| 4 | an invented, unsourced metric added to mentaltrening | `content.ts` | `exactly one metric row is rendered, with no duplicate` — got `2` | yes |

Mutation 4 is the one worth stating plainly. It is the failure the assertion
being replaced — `.case__metric` count === 0 — existed to catch, and it is the
reason the replacement is not `count > 0`. The old line protected the repository
against publishing a number nobody could source; the new contract still does,
by deriving the expected population from `WORK` instead of from a remembered
total. Nothing was traded away to make room for the Rapidkert figure.

Mutations 1 and 3 are both caught by the page-level invariants rather than by
the per-case loop, and that is by design: the loop derives its expectation from
the same table the mutation edits, so on its own it would agree with the
mutation. The two invariants — one row in the document, on Rapidkert — are what
make the source itself accountable.

## Revert

`experiments/src/full/content.ts` restored to
`7381f96d07fb1071283e4baadcf1e2973882d92f2f59b360d72212cdbefb4317`,
`experiments/src/full/FullAscent.tsx` restored from its pre-mutation copy, the
route rebuilt, and the contract re-run:

```
✓ [desktop]        every stage, case study and process step is real HTML
✓ [reduced-motion] every stage, case study and process step is real HTML
2 passed
```
