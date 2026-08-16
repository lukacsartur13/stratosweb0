# Portal P2 — performance

*Measured, not estimated. Every number below is reproducible with two commands.*

```bash
npm run build:portal
node scripts/portal-shots.mjs
```

The second writes `_build/reports/portal-p2/performance-measurements.json`,
which is the raw source of the request counts and timings in this document.

---

## 1. What was measured, and what could not be

| Measured | How |
| --- | --- |
| JavaScript delta | `vite build`, this branch vs `8380e0b` (the P1 acceptance commit), built in a git worktree with the same `node_modules` |
| Data requests per screen | recorded live from `page.on('request')` during the capture run, filtered to `/rest/v1/` and `/api/portal-*` |
| Client-side paint | `PerformanceNavigationTiming` + `first-contentful-paint`, per capture |
| N+1 patterns | request counts compared against the row counts on the screen |

| **Not** measured | Why |
| --- | --- |
| Real end-to-end load time | There is no Supabase project and no GA4 service account in this repository. Every request in the capture run is answered from memory. A wall-clock figure taken here would look like a round trip and would not be one. |
| Query plans | The migration has not been applied to any database, so there is nothing to `EXPLAIN`. The indexes are listed in the migration review; their justification is which column each screen filters on. |

---

## 2. JavaScript

### The entry bundle

| | P1 (`8380e0b`) | P2 | Delta |
| --- | ---: | ---: | ---: |
| `index-*.js` | 189.14 kB | **215.75 kB** | +26.61 kB |
| gzipped | 54.72 kB | **62.63 kB** | **+7.91 kB** |

That +7.9 kB gzip is the whole commercial layer on the Dashboard: money
formatting, the pipeline model, the delivery vocabulary, the attention rules and
the three aggregate reads. Nothing else was added to the first paint.

### Every chunk

| Chunk | P1 | P2 | Note |
| --- | ---: | ---: | --- |
| `index` (entry) | 189.14 kB | 215.75 kB | shell + Dashboard + Leads + System |
| `vendor` | 165.94 kB | 165.94 kB | unchanged |
| `supabase` | 218.46 kB | 218.46 kB | unchanged |
| `analytics` | 15.25 kB | 20.12 kB | + the revenue attribution section |
| `screens` | 6.78 kB | 4.56 kB | **smaller** — Clients and Projects left it |
| `sales` | — | 16.25 kB | new |
| `opportunity-detail` | — | 20.58 kB | new |
| `clients` | — | 19.95 kB | new |
| `projects` | — | 30.82 kB | new |
| `records` | — | 12.64 kB | shared: notes, timelines, the operations data layer |
| `OpportunityForm` | — | 4.69 kB | shared by Sales and the lead conversion; lazy on both |
| `plus` | — | 0.32 kB | one icon, shared |

**87 kB of new JavaScript exists and 26.6 kB of it is in the entry bundle.** The
rest is behind a route that has to be clicked.

### The chunking bug this phase found and fixed

The first P2 build put the entry chunk at **231.27 kB** — 42 kB over baseline.
Vite said why:

```
sales.tsx is dynamically imported by App.tsx but also statically imported by
lead-detail.tsx, leads.tsx — dynamic import will not move module into another chunk
```

One `StageBadge` import on the Leads screen dragged the entire Sales module into
the first paint. The general form of the problem is that **Rollup hoists any
module shared between the entry and a lazy chunk into the entry**, and it applied
three times over:

| Shared module | Pulled in by | Fix |
| --- | --- | --- |
| `pages/sales.tsx` | a badge on the Leads list | `features/sales/bits.tsx` — a 25-line file |
| `pages/sales.tsx` | the conversion dialog on lead detail | `features/sales/OpportunityForm.tsx`, `React.lazy` on the lead screen |
| `lib/sales.ts`, `lib/operations.ts` | three aggregate hooks on the Dashboard | `lib/business.ts` — the entry bundle's own data layer |

The module boundary is now **by when a screen loads**, not by what a record is
called:

```
lib/pipeline.ts    pure model and vocabulary. No imports at all.
lib/money.ts       pure formatting. No imports at all.
lib/business.ts    the aggregate reads the ENTRY bundle makes.
lib/sales.ts       the pipeline's own CRUD.        Lazy chunks only.
lib/operations.ts  clients and projects CRUD.      Lazy chunks only.
```

`tests/portal-revenue.spec.ts` → *the entry bundle does not import the lazy
modules* asserts it, so the regression cannot come back silently.

---

## 3. Data requests per screen

Recorded live. `profiles` is the auth provider's own read and is on every screen.

| Screen | Requests | What they are |
| --- | ---: | --- |
| **Dashboard** (populated) | **8** | profiles · health · analytics · leads · `rpc/portal_sales_summary` · opportunities (attention slice) · projects (live slice) · `rpc/portal_revenue_attribution` |
| **Dashboard** (empty book) | **7** | as above, minus the attribution call |
| Dashboard, P1 baseline | 4 | profiles · health · analytics · leads |
| Sales — pipeline | 4 | profiles · health · opportunities · `rpc/portal_sales_summary` |
| Sales — table | 4 | identical; the four views share one fetch |
| Sales — follow-ups | 4 | identical |
| Sales — performance | 4 | identical |
| Opportunity detail | 6 | profiles ×2 · health · opportunities · record_notes · activity_logs |
| Clients list | 5 | profiles · health · organizations · projects · opportunities (the two rollup reads) |
| Client detail | 8 | profiles · health · organizations · client_contacts · projects · opportunities · record_notes · activity_logs |
| Projects list | 4 | profiles · health · projects · project_milestones (counts for the whole list) |
| Project detail | 8 | profiles · health · projects · milestones · costs · links · record_notes · activity_logs |
| Analytics (with revenue) | 4 | profiles · health · analytics · `rpc/portal_revenue_attribution` |
| Leads list | 4 | profiles · health · leads · opportunities (conversion markers) |

### The Dashboard went from 4 requests to 8. Is that acceptable?

Yes, and the reason is what the four new ones are, not how many there are:

1. **They are parallel.** Each block renders its own state; none waits on
   another. The screen is useful the moment any one lands, which was already
   P1's design and is unchanged.
2. **None of them loads a table.** Two are server-side aggregates
   (`SECURITY INVOKER`, so RLS still decides what is counted); two are filtered,
   bounded slices — the attention query is one `.or()` over four conditions with
   `limit 40`, and the projects query is live-only, ordered by target date,
   `limit 12` of which six render.
3. **The seventh is conditional.** `portal_revenue_attribution` is only issued
   when the summary says won revenue exists. On a business that has closed
   nothing the request is never sent and the block is not drawn (§36).
4. **The alternative was worse.** Printing the pipeline by loading the
   opportunities would be one request instead of two — and it would transfer the
   whole commercial book to a browser to compute six numbers, which is precisely
   what §59 rules out.

---

## 4. N+1 patterns — found, and fixed

Three were found while building. Each is now a single bounded query.

| Where | The naive shape | What it is now |
| --- | --- | --- |
| **Clients list** — active projects and won value per client | one query per client | **two** queries: projects and won opportunities read once with four narrow columns each, grouped in memory (`useClientRollups`) |
| **Projects list** — open milestone count per project | one query per project | **one** `.in('project_id', ids)` read, counted client-side (`useOpenMilestoneCounts`) |
| **Leads list** — "has this become an opportunity?" per lead | one query per lead | **one** read of `id, lead_id, stage, title` where `lead_id is not null`, turned into a map (`useLeadConversions`) |

Evidence from the measurements: the Clients list makes 5 requests for **3
clients**, the Projects list makes 4 for **3 projects**, the Leads list makes 4
for **6 leads**. None of the counts moves with the number of rows, which is the
definition of not having an N+1.

Two further shapes were avoided by design rather than fixed:

* **Milestone seeding on project creation** is one `insert` of an array, not ten
  inserts. Ten round trips to create a website project would be ten chances for
  the fifth to fail and leave a half-built checklist.
* **The client name on every list row** comes from a PostgREST embedded resource
  (`client:organizations(id, name)`) inside the same select, not from a lookup.

### One duplicate that remains

The **opportunity detail** screen reads `profiles` twice: once for the signed-in
account (the auth provider) and once for the responsible-person dropdown
(`useStaff`). It is two reads of a table with one row in it, both cached by the
browser's connection, and de-duplicating it would mean a shared profile store
whose invalidation rules are more complex than the request it saves. Recorded
here rather than fixed, because pretending it is not there would be worse than
either.

---

## 5. Client-side paint

Against the mock bundle — **no network, no database**. This measures bundle
parse, boot and first paint, which is the half of the load this phase controls.

| Screen | FCP | DOMContentLoaded | load |
| --- | ---: | ---: | ---: |
| Dashboard, 1440×900 | 72 ms | 34 ms | 34 ms |
| Dashboard, 1512×945 (MacBook) | 64 ms | 27 ms | 27 ms |
| Sales — pipeline | 72 ms | 35 ms | 35 ms |
| Project detail | 56 ms | 23 ms | 23 ms |
| Leads list | 60 ms | 24 ms | 24 ms |

The Dashboard and the Sales board are the two heaviest and both paint in well
under a tenth of a second. The 8 kB gzip the entry bundle gained is not visible
in these figures.

---

## 6. Unnecessary re-renders

Checked by reading the hooks rather than by profiling, because there is no
interaction here that produces a render storm to profile.

| Pattern | Status |
| --- | --- |
| Every data hook returns a `useMemo`'d object | ✅ `useOpportunities`, `useTable`, `useRows` |
| Every loader is a `useCallback` with an explicit dependency list | ✅ |
| The bounded list is filtered in a `useMemo`, not on every render | ✅ `useSalesFilter`, and the same pattern as P1's `useLeadFilter` |
| The attention list is a `useMemo` over its six inputs | ✅ |
| `useOpenMilestoneCounts` keys its effect on a joined id string | ✅ — a new array with the same ids does not re-fetch |
| Dialogs are mounted only while open | ✅ — no effect syncing props into state, and no form that resets under somebody mid-edit |
| In-flight reads are cancelled on unmount | ✅ — every `useEffect` that awaits sets a `cancelled` flag |

One deliberate non-optimisation: `useOpportunityMutations` is called inside each
pipeline card rather than hoisted to the board. It creates three `useCallback`s
per card, which for a 200-card ceiling is 600 stable closures and no measurable
cost — and it keeps the busy state per card, which is what makes a card disable
its own control rather than the whole board.

---

## 7. Data scale

| Bound | Where | What happens at the limit |
| --- | --- | --- |
| 200 opportunities | `useOpportunities` | The Sales table prints *"Showing the 200 most recently updated opportunities. Narrow the filters to reach older records."* |
| 200 clients / 200 projects | `useTable` | Same bound as every other list in the Portal since P1 |
| 40 attention deals | Dashboard | Filtered to rows an attention rule can fire on |
| 12 live projects | Dashboard | Six render |
| 25 attribution rows | Analytics | Ranked by won value |
| 8 attention items | Dashboard | Header reads *"showing 8 of 12"* |
| 100 notes, 100 activity rows | every detail screen | |
| 2000 milestones | the projects list count query | |

§60 asks that the design not assume there will only ever be twenty records. The
answer here is not to remove the bound — an unbounded list is how a screen dies
at 10 000 rows — but to make the bound **visible**, so a growing business finds
out from the interface rather than from a total that quietly stopped growing.

When the cap is genuinely reached, the change is to push the stage filter into
the query: one line in `useOpportunities`, no change to any screen.

---

## 8. Regressions

None. `npm test` — **1013 passed, 122 skipped**, unchanged from before this
phase. The 72 new tests in `tests/portal-revenue.spec.ts` are additional.

The public site is untouched by this phase. The complete set of files this
phase edited or created is `portal/`, `supabase/`, `tests/portal-revenue.spec.ts`,
`playwright.config.ts` (one line, registering the new suite),
`scripts/portal-shots.mjs` and `_build/reports/`. Not one public HTML page, CSS
file, JavaScript file or Netlify function was touched, and `npm run build`
produces the same fingerprint for every public asset.
