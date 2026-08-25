# Portal P2 — Revenue & Operations

*What the Portal became, how it was built, and what remains to be done by hand.*

Phase P1 — the Control Room — is untouched and remains accepted. This phase adds
the business-operating layer on top of it. The Portal was
`analytics + lead administration`; it is now the system Stratos runs its
commercial life in.

### Status at a glance

| | |
| --- | --- |
| **P2 change-surface gate** | **PASS** |
| **Repository-wide regression gate** | **NOT GREEN** |
| **Merge / deploy** | **NOT APPROVED** |

P2 is **ready for human review**. It is **not ready for merge or deploy**. The
two statements are not in tension, and §14 sets out exactly why.

---

## 1. The architecture

### The chain, and where each link lives

```
  traffic  →   lead   →  opportunity  →  proposal  →   won   →  client  →  project  →  revenue
    GA4        leads     opportunities    (a stage)   (a stage) organizations projects  (won value,
                                                                                        project value,
                                                                                        contribution)
```

Four of those eight already existed. P2 added the missing middle and the
commercial tail — **and it added them to the tables that were already there**:

| Concept | Table | New in P2? |
| --- | --- | --- |
| **Lead** | `leads` | No. Untouched by this migration — not one column, not one row. |
| **Opportunity** | `opportunities` | **New.** |
| **Client** | `organizations` | No. Extended with acquisition fields and an archive flag. |
| **Project** | `projects` | No. Extended with value, currency, hours, payment, an opportunity link and a responsible person. |
| **Revenue** | won opportunity value + project value | Derived. There is no separate revenue table, because there is no revenue event this system observes that is not one of those two. |
| **Audit** | `activity_logs` | No. Written to by triggers. |
| Contacts | `client_contacts` | New. |
| Milestones | `project_milestones` | New. |
| Costs | `project_costs` | New. |
| Links | `project_links` | New. |
| Notes | `record_notes` | New — one table for the three new record types. `lead_notes` is left exactly as it was. |

The audit that produced these decisions is
`_build/reports/portal-p2/current-operations-audit.md`, written before a line of
P2 was designed.

### The five entities, kept distinct

**Lead** — an inbound or manually entered contact. Most are not commercial
possibilities. A newsletter sign-up is a lead and is not a deal.

**Opportunity** — a *qualified* commercial possibility, with a value, a
probability and a close date. Created by a deliberate `Convert to opportunity`
action, never automatically (§3), because a pipeline containing every enquiry has
a total that means nothing.

**Client** — a company that actually became a Stratos client. Not a list of
leads. Created from a won opportunity, or by hand, with duplicate detection
either way.

**Project** — a defined piece of work for a client. Requires a client; there is
no orphan-project path.

**Revenue** — the value of a won opportunity, and the value of a project. Never
called cash: `projects.paid_amount` is the only record of what has actually
arrived, and the project screen says so in a sentence.

### Lead status and opportunity stage are separate, on purpose

`leads.status` answers *have we dealt with this enquiry*. `opportunities.stage`
answers *how close is this deal to closing*. They share four words where the
words genuinely coincide (§1) and they are two columns on two tables (§5). One
lead can produce two opportunities; an opportunity can exist with no lead at all.

---

## 2. Sales

### Stages

`QUALIFIED → DISCOVERY → PROPOSAL → NEGOTIATION → WON / LOST`

Six, and deliberately not twenty. `negotiation` is the one stage the lead
pipeline has no business carrying — it is a commercial state, not a
correspondence state.

### Probability

Stored per opportunity, editable, and defaulted per stage:

| Stage | Default |
| --- | ---: |
| Qualified | 20% |
| Discovery | 40% |
| Proposal | 60% |
| Negotiation | 80% |
| Won | 100% (forced by the database) |
| Lost | 0% (forced by the database) |

**These are operational defaults, not measured Stratos win rates.** Stratos has
no measured win rates yet — there is no closed history to compute them from. The
claim is documented in the schema (`opportunity_default_probability`), in the
code (`STAGE` in `lib/pipeline.ts`), on the Performance screen next to the
figures they produced, and it is asserted by the suite.

Moving a deal to a new stage raises a *default* probability to the new default
and leaves a *considered* one alone. Closing forces 100 or 0, because a forecast
weighted at 60% on a closed deal is not a forecast.

### Pipeline and forecast

| Figure | Definition |
| --- | --- |
| **Total pipeline** | Σ estimated value, open opportunities |
| **Weighted pipeline** | Σ (estimated value × probability), open opportunities |
| **Closing this month** | open, expected close date inside the current calendar month |
| **Won this month / year** | value of opportunities marked won, by the database-stamped `won_at` |
| **Win rate** | won ÷ (won + lost), all time. **`null`, not 0%, until something closes.** |
| **Average won deal** | per currency |

All computed by `portal_sales_summary()` — server-side, `SECURITY INVOKER`, one
round trip, one row per `(bucket, currency)`. No demo values anywhere.

### Currency

Every monetary column carries its own currency and **nothing in this system
converts between them**, because no rate exists in it. Every aggregate is grouped
by currency; a screen prints the largest group and discloses the rest as a
*count*:

> **4.5M Ft**  3 open opportunities  **+1 in EUR**

and, on the Dashboard's pipeline block:

> *1 more in EUR — not added in, because nothing here converts between currencies.*

### Follow-ups

Two columns on the opportunity — `next_action`, `next_action_on` — and a view
that groups them **Overdue / Today / Upcoming**. Not a task table, because §14
forbids a project-task manager and a view over two columns cannot become one.
There is nothing to create here and nothing to tick off; a row leaves the list
when the action on the deal changes, which is the only thing that resolves it.

A deal with an action and no date is deliberately absent from all three groups —
putting it in "upcoming" would be a claim about when it is due that nobody made.
It surfaces on the Dashboard instead, as *"has no next action"*.

### Lost reasons

Controlled: Price · No response · Competitor · Timing · Scope mismatch ·
Internal decision · Other. Plus a free-text note.

**Optional, and the dialog says so.** A required dropdown gets answered "Other"
on every deal somebody was in a hurry with, which is a column full of noise
rather than the sales intelligence §16 is after. No historical reason was
invented for any existing record — there are no existing records.

A database check constraint enforces that a reason can only exist on a lost deal,
so a won opportunity can never carry `price` and skew the report.

### The four views, one screen

Pipeline · Table · Follow-ups · Performance, at `/sales?view=…`. One fetch, one
set of filters, four readings. Sales gets no sidebar children (§45).

**There is no drag-and-drop, and that is the accessibility answer rather than a
gap in it.** §62 requires a non-drag control wherever a stage can be dragged.
Built forwards, that argues for building the keyboard control *first* — and once
every card carries a native `<select>` that works with a keyboard, a touch, a
screen reader and a 390px phone, drag is a second way to do the same thing whose
only advantage is that it feels nice on a desktop mouse. It also cannot work on
the phone layout, where the columns stack. One control, everywhere, at every
width.

---

## 3. Clients

Created by the **won flow**, which is two deliberate steps and never one:

1. Mark the opportunity won. The date is stamped by the database.
2. *Then* the Won panel appears, offering `Create client` — with any possible
   existing clients listed above it.

**Duplicate prevention (§40)** matches on a normalised company name — trimmed,
lowercased, punctuation and the common Hungarian and German company suffixes
removed, so *"Rapidkert Kft."* matches *"rapidkert"* — and on the email or
website domain. It **presents** the matches. It does not merge, does not pick one
and does not block: two clients can genuinely share a name, and a system that
silently merged them would have merged two companies' revenue into one
relationship with no way to tell.

### Client detail

A summary strip — client · won value · active projects · opportunities ·
acquisition source — then Projects, Opportunities, Notes, Activity and Contacts.

**Won value** is the sum of won opportunity values for that client, per currency.
It is called *Won value*, not "lifetime revenue", because that is what it is.

### Contacts

Multiple per client, one primary (enforced by a partial unique index). Name,
role, email, phone. Deliberately entered by staff — **the enquiry's own personal
data stays on the lead and is never copied here**, which is both §20's
requirement and one fewer place a GDPR erasure request has to reach.

---

## 4. Projects

A lightweight delivery tracker, and the constraint is the feature: no tasks, no
dependencies, no board, no burndown, no timer.

### Lifecycle

Planned · Active · Client review · Blocked · On hold · Completed.

`project_status` gained those six values **additively**. The six original values
(`discovery`, `design`, `build`, `launch`, `care`, `archived`) were not dropped —
dropping an enum value requires rewriting the table — and a pre-P2 project keeps
rendering under its own label until somebody moves it. The status dropdown offers
only the operational six and shows a legacy value as a disabled option reading
`Build (legacy)`, so the control tells the truth rather than silently claiming
the project is "Planned".

The reason the two vocabularies could coexist is that they are **two different
axes**: the original enum is a *phase* vocabulary, and phases now live in the
milestone list where they can be per-service.

### Milestones

Per-service starting points, held in the application rather than the schema
(§23), because a schema cannot express "these ten, unless it is an ads project"
without becoming a templating system:

| Service | Steps |
| --- | --- |
| Website | Discovery · Research · UX/structure · Design · Development · Content · QA · Client review · Launch · Maintenance |
| Ads | Audit · Account setup · Creative · Launch · Optimisation |
| Branding | Discovery · Direction · Design · Refinement · Handover |
| Anything else | Discovery · Delivery · Client review · Handover |

The moment a project is created the list is *its* list — editable, addable,
removable, with no template to keep in step. Progress is the fraction done, and
is **`null` (not 0%) when a project has no milestones**: unrecorded progress and
zero progress are different facts.

### Links

Label + URL, `http`/`https` only, enforced in three places: a database check
constraint, a check in the mutation, and `safeUrl()` at the point of render. A
stored value that fails the render check is drawn as red text — still visible,
still copyable, not clickable. Losing a link is a shrug; running someone else's
script inside an authenticated admin session is not.

### Costs and hours

Direct project costs only, in six categories: collaborator fee · subcontractor ·
stock/media · software/service · production · other. **There is no overhead
category, no salary category and no tax category**, because this is not
bookkeeping and a category that invites those numbers in is how it becomes
bookkeeping.

Hours are two numbers a person types: estimated and actual. There is no timer
and no time-entry table to grow into one.

---

## 5. Commercial reporting

### Project contribution (§30)

| Figure | Formula |
| --- | --- |
| **Contribution** | project value − direct project costs |
| **Contribution margin** | contribution ÷ project value |
| **Revenue per actual hour** | project value ÷ actual hours |
| **Contribution per actual hour** | contribution ÷ actual hours |

Every one returns `null` when its inputs are missing, and the screen renders
`null` as **`Not recorded`** — never as zero (§31). The failure this prevents is
concrete: a project with a value and no recorded costs would otherwise read
*100% margin*, which is a beautiful number and a lie.

The block is drawn quietly when the data is incomplete, and it carries its own
disclaimer next to the figures:

> *Contribution is project value minus direct project costs. It is a management
> figure — not profit, and not an accounting result.*

**No screen in this phase uses the words profit, EBITDA, net income, after tax or
recognised revenue.** Asserted by the suite over four source files and by the
rendered capture of the project screen.

### Performance (§32)

Inside Sales, not a separate Finance module. Won MTD · Won YTD · Open pipeline ·
Weighted pipeline · Average won deal · Win rate · open pipeline by stage. Every
figure is `portal_sales_summary()`'s answer, from real records only.

### Source → revenue (§33–§35)

`portal_revenue_attribution(dimension)` walks the chain over **source, medium,
campaign or landing page**:

```
SOURCE      LEADS   QUALIFIED   OPPORTUNITIES   WON   WON VALUE
```

Those five columns are **one measurement, joined by real foreign keys**: a lead's
own recorded attribution → the opportunity it produced → the value that closed.

`SESSIONS` is a **different measurement**, from GA4, placed beside them by
matching the source string and nothing else.

**There is deliberately no conversion rate in this table.** A GA4 session and a
named lead row are not the same population — GA4 counts visits, only from
visitors who accepted analytics, with no identifier in common with a lead — so a
rate built by dividing one by the other would be precision that does not exist.
The screen says all of this, in two paragraphs, directly under the table (§34).

Nothing here identifies an individual and no request behind it carries a person's
identifier. The Google side is an aggregate by source; the Portal side is an
aggregate by source.

The section renders **even when GA4 is unconfigured or down**, because only the
sessions column needs Google. A missing sessions column is a missing column, not
a missing section — which is the practical difference between *"analytics is
unavailable"* and *"we cannot tell you what your channels earned"*.

---

## 6. The Dashboard

After P2, in fixed order:

```
01  EXECUTIVE SUMMARY     Sessions · Leads · Conversion · Pipeline · Won MTD
02  TRAFFIC + LIVE        the chart, and who is on the site now
03  PIPELINE + CONVERSION stage distribution with totals · the GA4 funnel
04  ACQUISITION + REVENUE where traffic comes from · what it earned
05  RECENT LEADS + ACTIVE PROJECTS
06  NEEDS ATTENTION
07  SYSTEM STATUS
```

### What changed in the executive strip, and why

It was *Active users · Sessions · Leads · Conversion · Realtime*. It is now
*Sessions · Leads · Conversion · **Pipeline** · **Won this month***.

§8 permits exactly this trade: the commercial strip should immediately
communicate *how much business is in motion*, and "Realtime can remain visible in
the Traffic/Live area instead of consuming a primary business KPI slot if that
produces better hierarchy." It does — the Live panel one row below already prints
the realtime count at 4xl in yellow, which is a louder statement of the same fact
than a strip cell was. And Active users and Sessions were two readings of one
thing, where Pipeline and Won are two questions the business could not previously
ask at all.

Yellow now appears once in the strip, on **Won this month**: the one figure there
that is money in rather than money hoped for.

### What P2 did NOT do to the Dashboard

It did not become a mosaic. Three panels arrived, one figure left, and the
section count went from six to seven — not to twelve. §47's instruction when a
Dashboard gets noisy is to *reduce information*, not to add widgets, so:

* the pipeline is a **summary with a link**, not a board;
* revenue attribution is **four rows**, not the table (that is Analytics');
* active projects is **four columns and six rows**, not a project wall;
* and "recent opportunities" was deliberately **not** added as a sixth table,
  because the pipeline block already shows the shape of the book and the
  attention list already names the individual deals that need something doing.

### Needs attention — genuine operational rules

| Rule | Fires when | Urgent |
| --- | --- | --- |
| No next action | an open deal has nothing scheduled | |
| Next action overdue | the date set for the next step has passed | ● |
| Expected close passed | still open past its forecast close date | ● |
| Won, not converted | a won deal has no client record | |
| Project blocked | | ● |
| Project past target | | ● |
| Project in client review | waiting on the client | |
| Active with no milestone left | (Projects screen only — see below) | |

Every item obeys four rules: it comes from a condition that is **stored**, it
**explains itself** in a sentence rendered under it, it **links** to the record,
and it **disappears** the moment the data resolves it. Nothing is dismissed,
snoozed or acknowledged — fixing the record is the only way to clear a row, which
is what stops this becoming an inbox. The list is capped at eight, with the true
total in the header.

Two rules were considered and rejected as unsupportable:

* *"proposal has had no activity for X days"* — needs a per-record activity
  timestamp. What exists is `updated_at`, which changes when anyone edits
  anything, so the rule would fire on the deals somebody is actively working.
  `next_action_on` answers the same question honestly and is already there.
* *"active project with no next milestone"* on the Dashboard — needs a milestone
  count, which would be a third query for one rule. It fires on the Projects
  screen, which already has the counts. An absent count means *unknown*, never
  zero.

### The fifteen-second contract (§56)

Without leaving the Dashboard: traffic level ✓ · leads ✓ · conversion ✓ ·
pipeline value ✓ · weighted pipeline ✓ · won value ✓ · deals requiring action ✓ ·
active project count ✓ · strongest acquisition source ✓ · system health ✓.

---

## 7. Security

### Row Level Security

Every new table: RLS **enabled and forced**.

| Table | Read | Write | Delete |
| --- | --- | --- | --- |
| `opportunities` | staff | admin | **no policy at all** |
| `client_contacts` | staff | admin | admin |
| `project_milestones` | inherits `projects` visibility | admin | admin |
| `project_costs` | **admin only** | admin | admin, audited |
| `project_links` | inherits `projects` visibility | admin | admin |
| `record_notes` | staff | admin **and `author_id = auth.uid()`** | author only, **no update** |

`project_costs` is admin-only rather than staff-readable because what a
collaborator was paid is commercially sensitive in a way a milestone is not, and
`is_staff()` there would put every subcontractor fee in front of every
subcontractor.

`opportunities` has **no delete policy**, which is how §41's "prefer archive over
destructive delete" is guaranteed rather than merely intended: a DELETE from the
browser is refused by the database, and archiving is an update to `archived_at`.

`anon` is explicitly revoked on all six tables, so an unauthenticated caller is
refused by the privilege system *before* RLS is consulted. Two independent locks.

### The aggregates run as the caller

`portal_sales_summary()` and `portal_revenue_attribution()` are **`SECURITY
INVOKER`**. A definer function would compute the company's revenue without the
caller's policies and publish it to every authenticated account, including a
`client`. This is written out explicitly in the migration, asserted by the test
suite, and printed by section 7 of the verification file.

### Authentication and API

**P2 adds no HTTP endpoint.** Business data moves through PostgREST + RLS, which
is the architecture P1 established: the policies *are* the authorisation, and a
function in front of them would move that decision to a place where it can be
forgotten. §44's checklist is satisfied by not creating the surface it governs.

The two existing Netlify functions are unchanged. Both still verify the bearer
token against Supabase, read the role from `profiles` rather than the JWT,
allowlist GET, and never return a variable's value.

### Audit

Written by `SECURITY DEFINER` triggers with pinned `search_path`, into the
existing `activity_logs` — not by the application. Two reasons, and the second
matters more: `activity_logs` has no insert policy, so a browser cannot forge an
entry; and the Portal is not the only thing that can change these rows — the
Supabase table editor can, a future automation can, an SQL fix can. A trigger
records all of them.

Recorded: opportunity created / stage changed / value changed / next action
changed / client linked; client created / status changed; project created /
status changed / value changed; cost added / **removed**. `auth.uid()` is null
when the change did not come from a signed-in session, and null is the honest
answer.

### XSS and unsafe URLs

No `dangerouslySetInnerHTML` and no `innerHTML` assignment anywhere in the P2
screens — asserted over six files. Every stored value is a text node; notes are
`text` in the database and rendered with `white-space: pre-wrap`. The only
`href`s built from data are `mailto:` with a literal scheme, and project/client
URLs through `safeUrl()`, which allows exactly `http:` and `https:`.

### Data integrity in the database, not the dropdown

`probability between 0 and 100` · non-negative money and hours · valid currency
via `is_supported_currency()` · a lost reason only on a lost deal · an
opportunity must name a company or a client · a link must be http/https · one
primary contact per client · required foreign keys throughout.

---

## 8. Migration

**Status: prepared, reviewed, NOT APPLIED.**

`supabase/migrations/20260816000100_revenue_operations.sql` — additive in every
statement, invalidating no existing row, taking no exclusive lock.

`_build/reports/portal-p2/migration-review.md` reviews every table, column,
constraint, index, policy, trigger and function, with its existing-data impact
and its rollback, and ends **MIGRATION SAFE FOR REVIEW**.

Companion files: `supabase/checks/revenue-operations-verify.sql` (run after
applying; section 9 writes inside a transaction that rolls back) and
`revenue-operations-rollback.sql`.

The one thing not reversible: six inert `project_status` labels. Postgres cannot
drop an enum value without rewriting every table using the type, which is the
lock this migration exists to avoid taking. The rollback moves any row using them
back to a legacy value, so nothing depends on them.

**Nothing in this phase applies a production migration.**

---

## 9. Tests

### What is verified, and what is not

| | Result |
| --- | --- |
| **The P2 change surface** — `portal.spec.ts` + `portal-control-room.spec.ts` + `portal-revenue.spec.ts` | **331 / 331 pass**, deterministically, on both projects |
| Rendered contracts (`scripts/portal-shots.mjs`) | **57 / 57 hold** |
| `npm run typecheck`, `scan:secrets`, `fingerprint:check` | clean |
| **The full suite** | **not green, and not green at P1 either** — see below |

**The full suite has pre-existing flakiness that this phase did not cause and
has not fixed.** At the P1 acceptance commit (`8380e0b`), a full clean run is
**1 failed / 1038 passed / 122 skipped**. Full runs on this machine produce a
*varying* set of failures at both commits, all of them in the public-site
homepage specs — `homepage-chrome`, `homepage-modality`, `homepage-history`,
`mobile-homepage-simple`, `public-site` — which `playwright.config.ts` already
warns "sit close to the 30 s timeout under parallel load". A run that took 8.3
minutes early on took 25.4 minutes after six full passes, and the failure count
tracked the runtime, not the diff.

The like-for-like check, same machine and same minute, one targeted command:

| Commit | `homepage-chrome` + `lead-forms` on desktop-1920 |
| --- | --- |
| P1 `8380e0b` | 1 failed / 64 passed |
| P2 `HEAD` | 2 failed / 63 passed |

Same specs, same failure names, differing by one flaky test. **No portal test
appears in any of those failures.**

**This characterises the failures; it does not accept them.** The repository-wide
regression gate is NOT GREEN, and nothing in this section should be read as
clearing it — see §14.

### The regression this phase DID cause, and how it was found

Five P1 contracts broke and were reported as passing. The cause was a truncated
read: `tail -6` of a full run shows the passed/skipped summary, which is printed
*after* the failure list. The arithmetic was there to catch it — 1013 + 122 =
1135 against 1161 declared tests — and it was not checked.

Four were assertions that needed bringing forward (the seven-item navigation,
the promotion of Projects and Clients out of Records, the realtime figure moving
to the Live panel). **Two were real defects:**

* **`yellow is scarce` caught a design error.** `tone="live"` had been reused for
  Won this month. That token is for the one figure true *right now*, and a
  month-to-date total is a period figure. Removed — the executive strip now has
  no yellow figure at all.
* **A security check had been silenced without being violated.**
  `pages/projects.tsx` hoisted `safeUrl(link.url)` into a local, so the lexical
  check that reads every `href={…}` could no longer see it. The code was safe;
  the assertion went quiet, which is worse. The file now uses the inline idiom
  the rest of the Portal uses.

Both were found by P1's own tests, which is what they are for.

### The new tests

`tests/portal-revenue.spec.ts` adds **72** (×2 projects = 144), in seven groups.

| Group | Covers |
| --- | --- |
| **Money** | exact and compact formatting, locale independence, null ≠ zero, minus sign, **two currencies are never added**, no rate anywhere |
| **The pipeline** | six stages, the probability defaults *and the claim that they are defaults*, weighted value, stage distribution, mixed-currency withholding, **the authoritative totals**, win rate is `null` before anything closes, average won deal per currency |
| **Contribution** | contribution, margin, revenue/hour, contribution/hour; missing costs give **no** contribution rather than a full one; zero hours give no hourly rate; no screen claims profit |
| **Dates and delivery** | overdue/today/soon/later, no midnight-UTC drift, progress is `null` without milestones, legacy statuses still render, per-service milestone templates |
| **Attention** | every rule fires, every rule stops firing when resolved, every item explains itself, archived and lost deals are on nobody's list, the milestone rule does not fire on an unknown count |
| **The migration** | additivity (nothing dropped, renamed, rewritten, backfilled), every new column nullable or defaulted, RLS enabled and forced on all six, **no delete policy**, no note forgeable, `anon` revoked, **`SECURITY INVOKER` on both aggregates**, pinned `search_path` on every definer function, the database constraints, the enum-in-transaction rule |
| **Structure** | the seven-item navigation, every route capability-guarded, clients and team members cannot reach the commercial book, **the keyboard stage control and the absence of drag**, the dialog's focus trap / Escape / focus restoration, no stored markup, `safeUrl` on every stored URL, the Dashboard imports the aggregate and not the lists, the pure modules stay pure, empty states, `Not recorded`, the attribution methodology, GA4 not regressed |

Three of these tests failed on first run and found **two real bugs**, both in
money:

1. `moneyCompact(850_000)` printed **`85k Ft`** — the trailing-zero trim regex
   `/\.?0+$/` ate the last digit of `"850"`. The kind of bug that is invisible
   until somebody quotes the wrong number off a dashboard.
2. `sumByCurrency` counted *rows* rather than the `items` each summary row
   already stood for, so the Dashboard would have printed **"1 open
   opportunity"** above a fourteen-deal pipeline.

`node scripts/portal-shots.mjs` asserts **57 rendered contracts** as it captures
and exits non-zero if one fails. All hold.

### Authoritative totals, as asserted

From the fixture summary in the suite:

| Figure | Value |
| --- | --- |
| Total open pipeline | 12 500 000 Ft (14 deals) |
| Weighted pipeline | 7 160 000 Ft |
| Closing this month | 4 200 000 Ft (3) |
| Won this month | 3 000 000 Ft (2) |
| Win rate | 60% (6 won of 10 closed) |
| Average won deal | 1 600 000 Ft |
| Contribution on a 2 000 000 Ft project with 700 000 Ft costs | 1 300 000 Ft, 65% margin |
| Revenue per hour at 125 actual hours | 16 000 Ft |

---

## 10. Review package

`_build/reports/portal-p2-review/` — **62 captures, 31 of them new in this
phase**, all mock data, all banner-marked, at 1920, 1440, 1512 (MacBook), 834
(tablet) and 390. The other 31 are P1's, re-run against the P2 build.

| Area | Captures |
| --- | --- |
| Dashboard | top viewport · pipeline · revenue attribution · active projects · needs attention · the empty operating system |
| Sales | pipeline · table · follow-ups · performance · both at 390 |
| Opportunity | detail · the lost dialog · the won conversion · 390 |
| Clients | list · detail · both at 390 |
| Projects | list · detail · profitability · **the `Not recorded` state** · 390 · MacBook |
| Analytics | revenue attribution at 1440 and 390 |

Every P1 capture was re-run and still holds, with two assertions updated for the
P2 composition (the strip's contents, and the attention list's `showing 8 of 12`
header) and two selectors scoped because P2 added a second control with the same
option names.

---

## 11. External requirements

Everything below needs a human. Nothing in this phase did any of it.

1. **Apply `supabase/migrations/20260814000100_lead_pipeline.sql`** — still
   outstanding from the previous phase, and P2's migration runs after it.
2. **Apply `supabase/migrations/20260816000100_revenue_operations.sql`** in the
   Supabase SQL editor. Read `_build/reports/portal-p2/migration-review.md`
   first.
3. **Run `supabase/checks/revenue-operations-verify.sql`.** Section 9c is the one
   check that cannot be made any other way: it proves the audit triggers actually
   write to `activity_logs`, which carries `force row level security` and no
   insert policy. If they do not, the same is true of the lead pipeline's trigger
   and both need the same fix.
4. **Confirm anonymous refusal by hand** — section 10 of that file. An anonymous
   PostgREST call to `/rest/v1/opportunities` must return a permission error, not
   an empty array. An empty array would mean the request reached RLS; an error
   means it did not get that far.
5. **Deploy the Portal bundle.** `npm run build` produces it; nothing here
   deploys.
6. Still outstanding from earlier phases and unchanged by this one: the Google
   service account for Portal Analytics, and the lead notification webhook.

---

## 12. What was deliberately not built

Accounting · invoicing · payroll · an ERP · a ClickUp clone · a Slack clone ·
the Client Portal · AI agents · autonomous sales · automated outreach · public
proposal pages · a time tracker · a global search · a general task manager ·
individual GA4 user tracking · currency conversion.

Two that were *nearly* built and were not:

* **A `followups` table.** §42 lists it as a possible entity. Two columns on the
  opportunity answer the same question and cannot grow into a backlog, which §14
  forbids.
* **Drag-and-drop on the pipeline.** See §2 above — the accessible control is the
  control, and a second way to do the same thing that only works with a desktop
  mouse is not an improvement.

---

## 13. Design

P1's Control Room is preserved without exception: the same sidebar, command bar,
12-column grid, three surfaces, two hairlines, six typographic levels, restrained
yellow, tabular figures and responsive rules. Every P2 screen is built from
`components/ui`, and P2 added exactly two primitives to it — `DataLine` (one fact
in a detail column) and `Dialog` (a modal that does what a modal owes a
keyboard), plus `NotRecorded`.

Nothing was redesigned. P2 looks like it was always part of P1.

---

## 14. Regression gates

There are two gates here, and they are not the same gate. Reading one as the
other is the single most likely way to misread this report, so they are stated
separately and named separately.

### The three verdicts

| | |
| --- | --- |
| **P2 CHANGE-SURFACE GATE** | **PASS** |
| **REPOSITORY-WIDE REGRESSION GATE** | **NOT GREEN** |
| **MERGE / DEPLOY** | **NOT APPROVED** |

Stated plainly, without hedging:

* **All P2 Portal contracts are currently green.** `portal.spec.ts` +
  `portal-control-room.spec.ts` + `portal-revenue.spec.ts` — **331 / 331**,
  deterministically, on both projects. `scripts/portal-shots.mjs` — **57 / 57**.
  `typecheck`, `scan:secrets`, `fingerprint:check` — clean.
* **The full repository suite remains red.** It is not green at `HEAD`, and it
  was not green at the P1 acceptance commit either.
* **The remaining failures are outside the Portal change surface.** Every one of
  them is a public-site homepage spec. No portal test appears in any failure at
  either commit, and P2 did not edit one public file.
* **Like-for-like P1/P2 runs reproduce the same shifting homepage failure
  class.** Same specs, same failure names, a differing count that tracks machine
  load rather than the diff (§9).
* **This does NOT mean the full regression gate is accepted.** A red suite whose
  failures are explained is still a red suite. The explanation establishes *where
  the failures live*; it does not convert the repository-wide gate to PASS, and
  nothing in this report should be quoted as though it did.
* **P2 is therefore ready for human review, not ready for merge or deploy.** The
  work is reviewable now because its own contracts hold and its failure surface
  is characterised. It is not mergeable now because the repository-wide gate is
  not green.

The verdict at the foot of this report is a **review** verdict. It is not a merge
approval, not a deploy approval, and does not stand in for one.

### The gate table

| Gate | Status |
| --- | --- |
| P1 Control Room | ⚠️ **five contracts were broken and are fixed** — see §9. Four were assertions needing to move with the documented §8 and §45 changes; two were real defects the P1 tests caught. |
| GA4 / Portal Analytics | ✅ all six sections intact, asserted |
| Leads, notes, timeline | ✅ plus a Pipeline column and a Convert action |
| System Health | ✅ untouched |
| Auth and route guards | ✅ extended with `view_sales` / `manage_sales` |
| XSS protections | ✅ asserted over six new files |
| Self-hosted fonts, CSP | ✅ untouched |
| Website lead submissions | ✅ no function or contract edited |
| Public homepage, mobile Altimeter, history restoration, menu inertness | ✅ not one public file edited |
| Portal specs (the whole P2 change surface) | ✅ 331 / 331 |
| Rendered contracts | ✅ 57 / 57 |
| Full suite | ⚠️ **not green — and not green at P1 either.** Pre-existing public-site flakiness, unrelated to this diff. See §9. |
| `npm run scan:secrets` | ✅ clean, 720 files |
| `npm run typecheck` | ✅ clean |

---

## 15. What comes next

Not P3. The next workstream is a **dedicated regression-harness stabilization
pass**, before any further Portal feature development. The public-site homepage
specs sit close to their timeout under parallel load and fail in a shifting set
that tracks machine load; until that is fixed, no phase can produce a green
repository-wide gate, and every phase after this one would inherit the same
ambiguous result. Stabilize the harness first, then take the merge decision on
P2 against a gate that means something.

---

**P2 CHANGE-SURFACE GATE: PASS**
**REPOSITORY-WIDE REGRESSION GATE: NOT GREEN**
**MERGE / DEPLOY: NOT APPROVED**

PORTAL P2 REVENUE & OPERATIONS READY FOR REVIEW
