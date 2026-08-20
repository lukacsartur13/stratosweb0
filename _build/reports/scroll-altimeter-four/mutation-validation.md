# Mutation validation — §30, §31

Every corrected contract was required to catch a deliberate break of the
behaviour it claims to protect. Each mutation was applied to the **product**,
never to a test, and each was reverted immediately and verified reverted.

§31 was honoured throughout: not one mutation changes an arbitrary pixel value
to prove an exact-coordinate assertion. Every one of them negates a behaviour
the codebase states in prose.

| | Mutation | Target | Result |
|---|---|---|---|
| **M1** | `push()`'s gate restored verbatim — the defect itself | `assets/js/header.js` | **4 of 4 carrying projects FAIL** |
| **M2** | the deck stops printing the stage it is given | `assets/js/header.js` `paint()` | **8 of 8 FAIL** (both A contracts, 4 projects) |
| **M3** | the last anchor is no longer clamped to the end of the travel | `ascent.ts` `anchorOf` | **not caught — and correctly not** |
| **M3′** | the last band ends a screen past the foot of the document | `ascent.ts` `locate` | **not caught — and correctly not** |
| **M3″** | the ascent no longer advances with the document | `ascent.ts` `onScroll` | **4 of 4 FAIL** (B and C, 2 projects) |
| **M4** | the reader no longer catches up on the menu's close edge | `ascent.ts` `install` | **not caught — and correctly not** |
| **M5** | the scroll lock does not restore the position it captured | `assets/js/header.js` `close()` | **2 of 2 FAIL** |
| **M6** | the damper approaches forever instead of landing (`damp` for `settle`) | `journey.ts` `advance` | **not caught** |
| **M6′** | M6 **plus** the original progress-keyed closed-interval stage rule | `journey.ts` | **not caught** |
| **M6″** | the clock rests 0.0005 of the track short, on whichever side it came from | `journey.ts` `advance` | **FAIL, at the altitude assertion** |

---

## The mutation that matters most, and what it proved

**M1 is the reason this workstream has a strengthened contract rather than only
a product fix.**

The defect was restored verbatim and `homepage-chrome.spec.ts:482` — the test
that reported it in `final-closure-01` — **passed 10 of 10.**

That is not a small finding. The page-level test only witnesses the defect when
the journey happens to come to rest inside the ~9 px band above a stage
boundary, and where that band falls depends on where `calibrate()` put the
boundary on that run's layout. It caught the defect once, by luck. A product fix
alone would have left the repository with a green suite and no coverage of the
thing that had just been fixed.

So a second contract was added at the interface where the defect actually lives:

`tests/homepage-chrome.spec.ts` — *the deck prints a new stage pushed at an
unchanged scroll position*. The same progress, twice, with a different stage.
Deterministic, on all four carrying projects, and it does not depend on where a
boundary landed. **M1 kills it 4 of 4.**

## The three "not caught" results, stated rather than buried

None of these is a gap in coverage. Each is a mutation that turned out not to
change any behaviour the contract claims — which is a fact about the mutation,
and recording it is the point of §30.

* **M3 / M3′.** Both aimed at "the ceiling is a screen short of the bottom". Neither
  reaches it: the `destination` band is flat at 30 000 m (`from` and `to` are both
  the ceiling) and `full-stratosphere` ends there too, so the readout arrives at
  30 000 m at the foot of the document under either mutation. The behaviour was
  not broken, so the contract was right not to fail. M3″ then broke the contract's
  actual claim — *the altitude advances with the document* — and both B and C died.

* **M4.** Removing the `stratos:menu` catch-up does not leave the ascent
  displaced: `close()` calls `scrollTo(0, scrollLock)`, which fires a scroll
  event, and the reader catches up on the next frame. The catch-up listener makes
  the recovery *synchronous*; it is not what makes it *happen*. Contract C claims
  "the menu leaves the ascent where it was", and under M4 it still does. M5 —
  removing the position restore itself — breaks that claim exactly, and Contract C
  dies on both projects.

* **M6 / M6′.** The ulp-scale direction dependence these restore is genuinely
  below what this test can resolve: it samples panel tops rounded to whole
  pixels, so its sample positions sit ~0.5 px off the calibrated boundaries —
  about 0.6 m of altitude, four orders above the 6 × 10⁻⁵ m residual the snap was
  introduced to remove. **Contract D is regression coverage for direction
  dependence at pixel scale and above, not at ulp scale.** That is worth knowing
  and is now written down. M6″ introduces a direction-dependent rest position of
  0.0005 of the track — about 11 px, about 30 m near the boundary — and the test
  fails on `expect(back.metres).toBe(forward[y].metres)`, which is the assertion
  its own comment nominates as the one that matters.

## Revert verification

After the last mutation:

* `git checkout --` restored `experiments/src/full/journey.ts` and
  `experiments/src/full/mobile/ascent.ts`; `git status` reports them clean.
* `dist/assets/js/header.js` restored from the pre-mutation copy and
  `node --check`ed.
* `npm run build:full` and `npm run build:home` re-run from the restored source.
* All four changed files byte-compared against the working tree: **identical**.

The only source difference remaining in the subject is the Contract A product
fix itself.
