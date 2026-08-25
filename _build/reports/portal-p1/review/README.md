# Portal review captures

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

Regenerate with:

    node scripts/portal-shots.mjs
