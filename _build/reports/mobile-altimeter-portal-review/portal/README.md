# Portal review captures

**Every image in this directory shows MOCK DATA.**

There is no Google service account in this repository and no Supabase project was
contacted. The bundle these were taken against is built separately into
`_build/.portal-mock` with placeholder credentials so that the real client is
constructed and every request can be intercepted; it is never published and is not
`dist/`. Every figure comes from the fixtures in `scripts/portal-shots.mjs`.

`MOCK-analytics-not-connected.png` and `MOCK-command-center-no-ga4.png` are the
states this deployment is actually in today: the feature is built and waiting for
credentials.

Regenerate with:

    node scripts/portal-shots.mjs
