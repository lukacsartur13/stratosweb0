# Phase 9 — resolving the contradictory test totals

Two incompatible results were reported for the same phase:

- `607 passed, 0 failed`
- `605 passed, 2 failed`

This document establishes what each measured, why they differ, and what the
authoritative result is.

**Summary: the totals never disagreed. 607 tests executed in both runs. The
disagreement was entirely in the pass/fail split, and it was caused by two
load-dependent test races — one of which has now been diagnosed and fixed at its
cause.**

---

## 1. What each run measured

| | Run A — `607 passed, 0 failed` | Run B — `605 passed, 2 failed` |
|---|---|---|
| Command | `npm test` | `npm test` |
| Config | `playwright.config.ts` | same |
| Source commit | `6a1d4aa` — the fifth Phase 9 commit | same |
| Tests **collected** | 647 | 647 |
| Tests **skipped** at runtime | 40 | 40 |
| Tests **executed** | **607** | **607** |
| Passed | 607 | 605 |
| Failed | 0 | 2 |

The 40 skips are runtime `test.skip()` guards, chiefly
`test.skip(project.name.startsWith('mobile'), 'Tab is not a phone interaction')`
on the keyboard tests. Playwright reports them as skipped, not as passed, so
`collected − skipped = executed` and **607 is the executed total in both runs.**

**No documentation edit changed the source freeze.** The Phase 9 documentation
commits touched `_build/reports/**`, `README.md` and `.env.example`; none is
read by the test suite or by the build. `git diff --name-only` between the two
runs' commits is empty — they are the same commit.

---

## 2. Reruns on a newly frozen source

Source frozen at `6a1d4aa`, working tree clean apart from
`.claude/settings.local.json` (a local editor permission file, not project
state). A full `npm run build` before each run.

| Run | Collected | Skipped | Executed | Passed | Failed | Failing test |
|---|---|---|---|---|---|---|
| 1 | 647 | 40 | 607 | 606 | 1 | `portal.spec.ts` › `password reset` › `does not reveal whether an address has an account` — `[desktop-1920]` |
| 2 | 647 | 40 | 607 | 606 | 1 | `homepage-chrome.spec.ts` › `the full-screen menu on the homepage` › `focus is trapped inside the layer while it is open` — `[desktop-1920]` |
| 3 (`--workers=4`) | 679 | 40 | 639 | 637 | 2 | **both of the above** |

Run 3 collected 32 more because the attribution suite had been added by then.

**This reproduces the reported contradiction exactly.** The two tests that fail
are the same two, always on the same project, and whether one, both or neither
fails on a given run is not determined by anything in the source.

### Both failures are TIMEOUTS, not assertion failures

```
1) [desktop-1920] › tests/homepage-chrome.spec.ts:463:3 › focus is trapped inside the layer while it is open
   Test timeout of 30000ms exceeded.
```

```
1) [desktop-1920] › tests/portal.spec.ts:107:3 › does not reveal whether an address has an account
   Error: expect(locator).toBeVisible() failed
   Locator: getByRole('heading', { name: /reset password/i })
   Expected: visible
   Timeout: 5000ms
   Error: element(s) not found
     110 |     await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
   > 112 |     await expect(page.getByRole('heading', { name: /reset password/i })).toBeVisible();
```

**No assertion about the product was ever violated in any run.** Neither
failure describes a defect in the site or the portal.

---

## 3. Commit-level evidence that neither is a Phase 9 regression

Required by the brief, and not asserted on the strength of "it looks like a
flake".

### 3.1 The portal failure

Every file it exercises is **byte-identical** between the pre-Phase-9 baseline
`ad798d7` and the Phase 9 head `6a1d4aa`:

```
IDENTICAL  tests/portal.spec.ts        abbac71a896ed2b92b1678e08768641d5ce60326
IDENTICAL  portal/src/App.tsx          592d4fa26da9ecbbcba4e6b5017dbb4f1c73f29d
IDENTICAL  portal/src/main.tsx         648f903414cbc0054adf410cb27783ad14a717f6
IDENTICAL  tests/homepage-chrome.spec.ts  e8cb0274fe5499aea282208dbb5c88ea15443f54
```

The **built** portal bundle is byte-identical too. A worktree at `ad798d7` was
created, `node_modules` linked, and `npm run build` run; `diff -rq` between the
two `dist/portal` trees reports no differing file. (It reports four *extra*
files in the working tree — iCloud's `" 2"` sync duplicates, which
`assemble.mjs` and `.gitignore` already exclude.)

The only Phase 9 change anywhere under `portal/` is `portal/src/vite-env.d.ts`,
a TypeScript declaration file that emits nothing.

**Phase 9 could not have caused this failure**: it changed no file in its path,
and the artefact it runs against is identical.

### 3.2 The homepage failure

`tests/homepage-chrome.spec.ts` is byte-identical, as above. Phase 9 *did*
change what the homepage loads — `analytics.js` and `consent.js` are two extra
`defer` scripts on every page — so this one is not settled by identity alone,
and the honest statement is:

- the full suite was run at `ad798d7` (585 collected, 40 skipped, **545 passed,
  0 failed**), so the flake did not appear there on that run;
- one green run is not proof of absence for a probabilistic failure, and this
  report does not claim it is;
- what *is* established is the mechanism (§4), which is independent of the two
  extra scripts.

### 3.3 The worker-count hypothesis, tested and rejected

The machine is 4 performance + 6 efficiency cores; Playwright's default is 5
workers, so at least one worker runs on an efficiency core at all times. That
was a plausible cause and it was worth eliminating rather than assuming.

**Run 3 above used `--workers=4` and both tests failed.** The hypothesis is
wrong, no configuration change was made on the strength of it, and it is
recorded here so nobody re-derives it.

---

## 4. Root cause, and what was fixed

### 4.1 The portal test — a genuine race, now fixed

```js
await page.goto('/portal/index.html');
await page.evaluate(() => history.pushState({}, '', '/portal/forgot-password'));
await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
```

`page.goto` resolves on `load`. React commits its first render after that, and
`BrowserRouter` subscribes to `popstate` inside an effect — later still. Under
load, the dispatched `popstate` can land before anything is listening, in which
case **the event is simply lost**: the SPA stays on the sign-in route, the
heading never appears, and the test fails 5 seconds later.

The decisive evidence is ten lines above it in the same file.
`protected routes redirect rather than render` does the identical
`pushState`/`popstate` dance and has **always** waited first:

```js
await expect(page).toHaveURL(/\/portal\/login/);
```

That URL is the router's own first act. Waiting for it is waiting for exactly
the precondition the next line depends on. It has never flaked.

**Fix applied:** the same wait, in the same shape, in the password-reset test.

This is not a weakening and not a timeout change. No timeout was raised, nothing
was skipped, no assertion was relaxed. A missing precondition was added — the
one its sibling already had.

### 4.2 The homepage test — not fixed, and deliberately not

`focus is trapped inside the layer while it is open` presses `Tab` 30 times on
the WebGL homepage and exceeds the 30 s file timeout under parallel load. It
already waits for `aria-expanded="true"` before starting, and its author already
optimised it once — from ninety round trips to thirty — for exactly this reason.

**Nothing was done to it.** The available options were to raise the timeout, mark
it slow, reduce the number of Tab presses, or skip it on `desktop-1920`. Every
one of those is what the brief forbids: obtaining green output by weakening the
test rather than by fixing what it found. It found a slow test environment, not
a slow site, and the honest response is to say so.

It did not fail in the authoritative run below. It may fail again on a loaded
machine. That is recorded as a documented limitation rather than papered over.

---

## 5. The authoritative result

Source frozen at **`a3af8b7`**, working tree clean apart from
`.claude/settings.local.json`. Run in the state `npm run validate:full` leaves
behind — the harder of the two, and the one that exposed §6.

```
npm test
  40 skipped
  756 passed (6.3m)
exit code 0
```

| | |
|---|---|
| **Collected** | **796** |
| **Skipped** | **40** |
| **Executed** | **756** |
| **Passed** | **756** |
| **Failed** | **0** |

The executed total rose from 607 to 756 because Phase 9's continuation added
149 assertions: 32 attribution, 16 structured data, 36 not-found, 6 newsletter
honesty, 7 portal rendering safety, and the sitemap-canonical check, multiplied
across the projects each runs in.

**There is one authoritative result and it is the one above.**

---

## 6. A second order-dependence, found by running the gates in a different order

Worth recording here rather than only in the commit, because it is the **same
class of problem** as the one this document exists to resolve — and it was in
the gates written to close it.

`npm test` and `npm run audit:seo:check` were run twice: once after
`npm run build`, and once after `npm run validate:full`. They disagreed.

| | after `npm run build` | after `npm run validate:full` |
|---|---|---|
| `npm test` | 755 passed, 0 failed | 751 passed, **4 failed** |
| `npm run audit:seo:check` | 0 failures | **8 failures** |
| `npm run fingerprint:check` | 0 unstamped | **1 unstamped**, exit 1 |

**Byte-identical source both times.** The difference was `dist/experiments/`.

`dist/experiments/stratos-ascent-full/` is the fixed benchmark baseline the
performance work is written against: `noindex, nofollow`, absent from the
sitemap and from every internal link. `npm run build` **deletes** it; only
`npm run build:full` — which `validate:full` runs — creates it. Both the SEO
audit and the structured-data suite walked `dist/` stopping at `portal` and
`assets`, and neither stopped at `experiments`. So after `validate:full` they
were auditing a development route as though it were a public page, and correctly
reporting that it has no canonical, no hreflang set and no JSON-LD.

Neither result was a defect in the site. Both were a defect in the scope of the
check, and it is the more interesting kind: **the gate's answer depended on
which command ran before it.**

A **third** check had the same defect and is the only one that pre-dates this
phase: `fingerprint:check` skipped `portal` and not `experiments`, so it
reported an unstamped stylesheet reference on a route no deploy will ever serve
— `npm run build` does not create `dist/experiments/` and, through
`assemble.mjs`, wipes it. Fixed in `a3af8b7`.

Fixed in `8fcc7da`. Both now exclude it, and both **record** the exclusion
rather than performing it silently — the audit reports `excludedFromAudit`, and
a new assertion checks that the excluded route really is outside the public
site (noindex, and absent from the sitemap), skipping itself when the route is
absent because absence is the normal state after a plain build.

An exclusion nobody can see is how the next directory gets skipped by accident.

---

## 7. Why the earlier reports differed — the one-line answer

They ran the same tests on the same commit and got different pass/fail splits
because two tests were sensitive to machine load rather than to the code. One
was a real race with a real fix, which has been applied. The other is a test
that needs more than 30 seconds on a saturated machine, and it has been left
alone rather than quietly given more time.

**The totals were never in dispute. 607 tests executed in both runs, and the
number was correct in both reports.**
