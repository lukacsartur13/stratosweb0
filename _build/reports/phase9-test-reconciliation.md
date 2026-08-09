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

---

# Part 2 — the continuation's gate run

Frozen at `2154c77`, on branch `phase-9-continuation-portal-analytics`.

The tree under test is **not** the tree Part 1 measured. Nine commits of
mobile-3D-altimeter work landed between the Phase 9 freeze (`a3af8b7`) and this
branch's base — 68 files, ~17 000 insertions, almost all of it in
`experiments/`. This part is about what that changed, and about keeping the two
apart.

## 8. The results

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **exit 0** |
| Production build | inside `validate:full` | **exit 0** |
| Asset fingerprints | `npm run fingerprint:check` | **exit 0** — 72 pages, 24 assets, 0 unstamped |
| Draco sync | `npm run draco:check` | **exit 0** |
| Secret scan | `npm run scan:secrets` | **exit 0** — 640 files, 12 rules, clean |
| CTA audit | `npm run audit:conversion:check` | **exit 0** |
| SEO / canonical / hreflang / sitemap / robots | `npm run audit:seo:check` | **exit 0** — 72 documents, **0 failing**, 43 warnings |
| Route audit | `node scripts/route-audit.mjs --quick` | **exit 0** — 132 checks, 0 failing, 0 broken links |
| Dependency audit | `npm audit` ×3 | 4 advisories, **none applicable** — see the dependency report §5 |
| **Deterministic suite** | `npm test` | **987 collected, 115 skipped, 864 passed, 8 failed** |
| **Journey suite** | `npm run validate:full` | **185 collected, 97 skipped, 57 passed, 31 failed** |

Eight of eleven gates are green. The two suites are not, and **every one of the
39 failures is in code this continuation did not touch.**

### The attribution, established rather than asserted

`git diff --name-only 9ccbe05..HEAD` — the continuation's complete file list — is
18 files: three Netlify functions, six portal sources, two new specs,
`playwright.config.ts`, `netlify.toml`, `.env.example` and reports. It contains

- no file under `experiments/`,
- no `assets/`, no `_build/build.py`, no `_build/pages/`,
- and not `tests/homepage-chrome.spec.ts`.

The homepage, its shared header, the journey and the specs that exercise them
are **byte-identical** to `9ccbe05`. Both failure sets therefore pre-date this
branch and arrived with the mobile work.

---

## 9. The journey suite — 31 failures, 10 distinct tests

30 of the 31 are the same ten tests repeated across the three portrait projects
(`mobile-390`, `mobile-430`, `mobile-375`). The 31st is one desktop test.

### 9.1 The 30 portrait failures — a suite that was never re-pointed

The portrait homepage was deliberately rebuilt. `mobile-homepage-simple-report.md`
§2 lists what a phone no longer loads: *"the WebGL scene entirely"*, the
ScrollTrigger mapping, the damped `journey.advance`, the composition
re-derivation. The desktop composition keeps all of it.

`full-ascent.spec.ts` still asserts the old portrait architecture on those three
projects: a canvas, a scroll-driven altitude clock climbing to exactly 30 000 m,
a sticky CTA handoff over the scene, eleven `stage-*` sections.

**The file already contains the correct pattern, applied to the wrong project.**
Six tests skip on `reduced-motion` with reasons like *"there is no canvas under
reduced motion"* and *"the fallback has no scroll-driven clock"*. Those two
sentences are now equally true of portrait, and the skips were not extended when
the portrait path was rewritten. The mobile branch replaced the portrait
fidelity suite with `tests/mobile-homepage-simple.spec.ts` and left this one
pointed at a surface that no longer exists.

Classification: **invalid test assumptions**, with one qualification below.

| Test | Line | Class |
|---|---|---|
| altitude climbs to exactly 30 000 m | 201 | scroll-driven clock — gone on portrait |
| keeps time while the tab is hidden | 279 | same |
| reaches the ceiling if the canvas never renders | 305 | same |
| instrument returns to its 0 m baseline | 1163 | same |
| altitude climbs continuously | 1196 | same |
| falls back to the static instrument without WebGL | 466 | WebGL scene — gone on portrait |
| every stage, case study and process step is real HTML | 324 | **needs judgement** |
| the CTA arrives over the scene | 574 | **needs judgement** |
| scrolling to the very end is not trapped | 626 | **needs judgement** |
| structural stages announced in order | 1224 | **needs judgement** |

**The four marked "needs judgement" are not safely stale.** Content being real
HTML, a skip link that lands somewhere, a page that is not scroll-trapped and
stages announced to assistive technology are properties a portrait page arguably
*should* still satisfy, whatever drives it. Whether the new portrait surface
satisfies them under different selectors, or fails to satisfy them at all, is a
question for the workstream that rewrote it.

**Nothing here was changed.** Extending a `test.skip` to three more projects is a
one-line edit and would have made the gate green in about a minute — which is
exactly why it was not done. Six of the ten are provably stale; four are not,
and skipping those four would convert an open question into a silent assumption.

### 9.2 The one desktop failure — a chunk that moved

`the build keeps the renderer lazy › three.js is absent from the eager entry and
never preloaded`, line 505. It fails in 62 ms, on an assertion rather than a
timeout, and it is worth reading closely because the property it protects is
**still true**.

Assertions 1–3 and 5 pass: one script tag, not the scene chunk; no
`modulepreload` of anything three-shaped; no `WebGLRenderer`, `BufferGeometry` or
`PerspectiveCamera` in the eager entry; no debug panel. Assertion 4 is the one
that fails:

```js
const scene = files.find((f) => f.startsWith('JourneyScene'));
expect(sceneCode.includes('WebGLRenderer')).toBe(true);
```

Measured in `dist/experiments/stratos-ascent-full/assets`:

| Chunk | `WebGLRenderer` | Size |
|---|---|---|
| `full-*.js` (eager entry) | **0** | 260K |
| `JourneyScene-*.js` | **0** | 172K |
| `Gltf-*.js` | **5** | 876K |
| `MobileInstrument-*.js` | 0 | 8.0K |

three.js is in a **shared `Gltf` chunk**, because the desktop scene and the new
mobile instrument both need it and Rollup hoisted it to their common ancestor.
That is the correct outcome and a better one than duplicating 876K.

The assertion names a **filename** where it means a **property**. The property —
*three.js exists, and is lazy, and is not in the eager entry* — holds. The
assertion exists so that assertions 1–3 cannot pass by three.js being nowhere at
all, which is a good reason for it to exist and not a good reason for it to
match on `JourneyScene*`.

Classification: **invalid test assumption**. The correct repair asserts that
*some* non-eager chunk contains the renderer. It was not applied here — same
branch, same reasoning as §9.1.

---

## 10. The deterministic suite — 8 failures, and a load story

All eight are in `tests/homepage-chrome.spec.ts`, on `desktop-1920` and
`reduced-motion`. **Zero are in any Phase 9 suite** — analytics, attribution,
consent, structured data, 404, forms, the lead endpoint, the portal, the new
portal-analytics and lead-notify suites are all green.

### 10.1 The count depends on the machine, and that was measured

Same commit, same command, three runs:

| Run | Conditions | Failed |
|---|---|---|
| 1 | immediately after a 43-minute journey suite, browser open | **56** |
| 2 | quiet machine | **3** |
| 3 | quiet machine, after a portal rebuild | **8** |
| isolation ×2 | that spec, those two projects, nothing else | **3**, then **3** — the same three |

Every failure in every run is a 30–40 s timeout in the same file, and the run-1
set is a superset of run-3's, which is a superset of the isolation set. The 41
tests that produced 27 timeouts in run 1 pass in **48 seconds** when that spec
runs alone.

So: a stable core of three, plus a load-proportional tail. Part 1 §4.2 already
recorded that this file is load-sensitive on a saturated machine. It has become
more so because the suite grew from 796 collected to 987 — the mobile branch
added `mobile-homepage-simple.spec.ts`, and more concurrent WebGL homepages is
exactly the pressure this file is sensitive to.

**No timeout was raised, nothing was skipped and no assertion was weakened**, in
either direction, for either group.

### 10.2 The stable three, and what they actually prove

| Test | Line | Project |
|---|---|---|
| the full-screen menu opens from every header state | 422 | desktop-1920 |
| focus is trapped inside the layer while it is open | 470 | desktop-1920 |
| focus is trapped inside the layer while it is open | 470 | reduced-motion |

Both fail on `locator.click()` / `hover()` against `.burger`, with the call log
stopping at *"waiting for element to be visible, enabled and stable"*. That
phrasing points at an oscillating layout, and the mobile report describes a real
oscillation elsewhere — a 4 px scroll loop that `DECK_STEP = 8` exists to damp —
so that was the first hypothesis. **It is wrong.** Measured at 1920, at all
three header states:

- the bounding box is **byte-identical across 90 consecutive animation frames**
  (`1729.109,18.594,114.094,42`);
- `getAnimations({subtree: true})` returns **[]** — nothing is running;
- computed style is `visibility: visible`, `display: flex`, `opacity: 1`,
  `pointer-events: auto`;
- `elementFromPoint` at the box centre returns the burger's own child, before
  and after a mouse move.

Then the decisive measurement:

| Call | Result |
|---|---|
| `isVisible()` / `isEnabled()` | **true** |
| `click({ trial: true })` — all actionability checks, no input | **passes** |
| `click({ force: true })` — input, checks skipped | **passes, and `aria-expanded` becomes `true`** |
| `hover()` | **times out** |
| `click()` | **times out** |

**The menu works.** A forced click opens it and the attribute flips correctly.
The actionability checks pass on their own. What hangs is the non-forced input
path on this page at this viewport — and since `desktop-1440`, `mobile-390` and
`mobile-430` all pass the same tests, it is specific to the 1920 viewport and to
`reduced-motion`.

Classification: **not a user-facing regression.** Something about this page's
input handling at 1920 defeats Playwright's non-forced click, and the honest
statement is that the cause is not yet identified. It belongs to the workstream
that added `experiments/src/full/siteHeader.ts`, and it is recorded here rather
than guessed at.

---

## 11. Why this is not the contradiction Part 1 resolved

Part 1 was about two reports of the *same* commit disagreeing. This is not that.
Three runs of this commit agree with each other about the core, disagree only in
a tail that tracks machine load, and the disagreement was **measured** rather
than argued — including by running the affected spec alone, twice, and getting
the same three both times.

**One authoritative set of totals, on `2154c77`:**

> **Deterministic suite: 987 collected, 115 skipped, 864 passed, 8 failed.**
> **Journey suite: 185 collected, 97 skipped, 57 passed, 31 failed.**
> **Nine other gates: exit 0.**
> **Phase 9 suites: 0 failures. All 39 failures are pre-existing and outside
> this continuation's diff.**
