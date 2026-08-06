# Phase 9 — Workstream K: removing the legacy lead adapter

**Recommendation: do not remove it yet.** The dated removal window has not
opened, and — more importantly — the telemetry that would prove it is safe to
remove has never been read. Removing it on the strength of a date alone is
removing it on the strength of an assumption.

---

## 1. What it is, and why it exists

`LEGACY_FIELDS`, `normaliseLegacy()`, the `'legacy'` branch of `detectFormat()`
and of `toLeadRow()`, and the legacy `describe` block in
`tests/lead-endpoint.spec.ts`. Banner date in `lead-contract.mjs`:
**REMOVE ON OR AFTER 2026-09-05.**

It exists because a deploy is atomic on the server and is not atomic in the
browser. When the envelope contract went live there were visitors holding the
previous `assets/js/main.js` — in an open tab, and from cache, because
`netlify.toml` serves `/assets/*` with `max-age=604800`, so a seven-day-old copy
of the old client is a *correct* cache hit rather than a stale one. Those
clients post the pre-envelope flat body. Without the adapter every one of them
gets a 400 and loses their submission, and neither they nor we would see why.

It does **not** pass the body through. It reads only the names in
`LEGACY_FIELDS` and drops everything else, so a legacy request has no more reach
into the table than a canonical one.

---

## 2. Telemetry — what exists, and what has been read

| Signal | Where | Read? |
|---|---|---|
| `meta.legacyClient === true` on the stored row | the `leads` table | **never queried** |
| `meta.submissionIdSource === 'server'` | same | **never queried** |
| `format` on every `audit()` line | Netlify function logs | **never read** |

The instrumentation is already in place and is deliberate: `legacyClient` is set
*after* `normaliseMeta`, so a canonical client cannot mislabel itself as legacy,
which makes the marker reliable rather than suggestive.

**The query that answers the question:**

```sql
select
  count(*) filter (where meta->>'legacyClient' = 'true')          as legacy,
  count(*)                                                        as total,
  max(created_at) filter (where meta->>'legacyClient' = 'true')   as last_legacy
from leads
where created_at > now() - interval '30 days';
```

> **REQUIRES USER FACTUAL INPUT** — run this. It is the single fact this whole
> decision turns on, and it takes ten seconds.

---

## 3. Removal criteria

All four must hold. **Any one failing means it stays.**

| # | Criterion | How to check |
|---|---|---|
| 1 | The banner date has passed — **2026-09-05** | calendar. Today is before it |
| 2 | **Zero** legacy submissions in the last 30 days | the query in §2 |
| 3 | The last legacy submission is at least 14 days old | `last_legacy` from the same query |
| 4 | No `drop.honeypot` / `reject` log line with `format: "legacy"` in the same window | Netlify function logs |

Criterion 2 is the real one. The date is a proxy for "the cache has expired and
the tabs are closed"; the count is the measurement of it.

---

## 4. Safe removal window

The asset cache is seven days. A long-lived tab is not bounded by it — a phone
that has not been restarted can hold a page open for weeks. The banner date is
seven days of cache plus a margin.

Remove during a low-traffic period with the query result in hand, in a change
that does **nothing else**, so that a regression has exactly one candidate
cause.

**On removal, delete together:** `LEGACY_FIELDS`, `normaliseLegacy`, the
`'legacy'` branch of `detectFormat`, the `envelope.legacy` branch of
`toLeadRow`, the legacy `describe` block in `tests/lead-endpoint.spec.ts`, and
the dated banner. Nothing else depends on any of it.

Afterwards a legacy body falls through to `MALFORMED_JSON`, which by then is the
correct answer.

---

## 5. Old-client risk

| Risk | Likelihood after the criteria hold | Impact | Mitigation |
|---|---|---|---|
| A visitor with a tab open for 30+ days submits | very low | **one lost enquiry, silently** — they see a generic failure and are unlikely to retry | The criteria are what reduce this to very low. It cannot be reduced to zero without keeping the adapter forever |
| A cached `main.js` beyond 7 days | none after the cache expires | same | `max-age=604800` bounds it |
| A bot or scraper replaying an old payload shape | moderate | none — it gets a 400, which is correct | none needed |

**The asymmetry is the whole argument.** Keeping the adapter costs ~80 lines of
well-tested, well-fenced code that no canonical request touches. Removing it too
early costs a real enquiry from a real person, silently, with no way to find out
it happened. Those are not comparable, and the cheap side is obvious.

---

## 6. Tests

Removal must not weaken what is asserted. Currently covered:

- a legacy body is detected as legacy, positively, by names only that contract
  uses — never by absence;
- a legacy body is validated by the **old** server's rules, not the new per-form
  schemas, which would reject every one of them;
- only `LEGACY_FIELDS` names reach a column;
- the honeypot is read from the top level for legacy and from `meta` for
  canonical, and is never stored either way;
- `meta.legacyClient` and `meta.submissionIdSource` are set;
- a canonical client cannot mislabel itself as legacy.

**After removal**, the last assertion is the one that must survive in a new
form: a flat legacy body must be answered with `MALFORMED_JSON` rather than
falling into any other branch. That is one test replacing six, and it is what
proves the removal was complete rather than partial.

---

## 7. Verdict

**Keep.** Criterion 1 has not been met and criterion 2 has never been measured.

Re-evaluate on or after **2026-09-05**, with the §2 query result attached to the
decision.
