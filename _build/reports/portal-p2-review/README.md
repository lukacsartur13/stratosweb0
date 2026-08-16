# Portal review captures

62 captures of every Portal screen, at 1920, 1440, 1512 (MacBook),
834 (tablet) and 390 (phone).

**Every image in this directory shows MOCK DATA.**

There is no Google service account in this repository and no Supabase project was
contacted. The bundle these were taken against is built separately into
`_build/.portal-mock` with placeholder credentials so that the real client is
constructed and every request can be intercepted; it is never published and is not
`dist/`. Every figure comes from the fixtures in `scripts/portal-shots.mjs`.

`MOCK-dashboard-not-configured.png` and `MOCK-analytics-not-connected.png` are the
states this deployment is actually in today: the feature is built and waiting for
credentials. They are in the set on purpose — they are what a reviewer opening the
real Portal right now would see.

This script also ASSERTS the rendered Control Room contracts as it captures, and
exits non-zero if one fails. The Playwright suite runs against `dist/portal`,
which has no credentials and therefore cannot reach any screen behind the auth
guard; this is the one place the signed-in UI actually renders.

Phase P2 added the revenue and operations screens — Sales (pipeline, table,
follow-ups, performance), the opportunity detail with its won and lost flows,
Clients, Projects with their contribution figures, and the revenue attribution
section on Analytics. The "empty" captures are what a reviewer opening the
real Portal sees today: the P2 migration has not been applied, so every
commercial table answers with nothing and every screen degrades to an empty
state rather than to a table of zeroes.

This run also recorded the data requests and paint timings behind each screen
to _build/reports/portal-p2/performance-measurements.json.

Regenerate with:

    node scripts/portal-shots.mjs
