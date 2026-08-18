# The final two nondeterministic contracts — inventory

Recorded **before** any modification. Both come from run `g2-04` of the six-run
hermetic sequence over frozen commit `6fda3ff`; both were absent from runs 1, 2,
3, 5 and 6.

---

## Contract A

| Field | Value |
| --- | --- |
| Spec file | `tests/homepage-chrome.spec.ts` |
| Line | **1005** |
| Test name | `a subpage reached from the homepage carries the same working header` |
| Enclosing describe | `the full-screen menu on the homepage` |
| Project | **`desktop-1440`** |
| Browser / viewport | Chromium (ANGLE Metal), 1440 × 900 |
| Duration at failure | 7.0 s |
| Failing assertion | `await expect(menu(page)).toBeVisible()` where `menu = page.locator('#menu')` |
| Failure message | `expect(locator).toBeVisible() failed` — `Locator: locator('#menu')`, `Expected: visible`, `Received: hidden`, `Timeout: 5000ms` |
| Last successful step | `await burger(page).click()` on the arrived document — the click itself was delivered without error |
| Trace | none retained (`trace: 'on-first-retry'` with `retries: 0`) |
| Screenshot | `screenshot: 'only-on-failure'`, written under the run's `test-results/`, not committed |
| Machine-readable record | `_build/reports/hermetic-gate/failures/g2-04-01-desktop1440.json` |

### The sequence under test

```
goto /index.html
  → burger.click()                          opens the layer on the homepage
  → menu .menu__panel a[href] :first .click()   follows a menu link
  → [full cross-document navigation]
  → expect(header.nav).toBeVisible()
  → burger.click()                          the click that did nothing
  → expect(#menu).toBeVisible()             FAILED — hidden for the full 5 000 ms
```

### DOM state at the assertion — §4

Measured directly (`scripts/hermetic/diagnostics/contract-a.spec.ts`), 100
executions:

```
candidateCount : 1
idMenuCount    : 1
path           : HTML>BODY>DIV#menu
class          : menu
hidden attr    : true
aria-hidden    : null
inert          : false
display        : none
visibility     : visible
opacity        : 1
box            : 0 × 0
```

**There is exactly one `#menu` in the document.** No inactive composition, no
transition copy, no mobile/desktop duplicate, no accessibility-only duplicate,
no stale node. The brief's §3–§7 are written for a selector matching several
candidates; that premise does not hold here and the corresponding remedies
(`.filter({ visible: true })`, `.first()`, `.last()`, nth, active-instance
discriminators) would all be answering a question the DOM does not pose.

The assertion did not pick the wrong element. **The layer never opened.**

### Incidental observation

The link followed by `.menu__panel a[href]` `.first()` is `href="/"` — the home
link. The "subpage" the test name refers to is in fact the homepage again,
reached by a full cross-document navigation. That is not the cause of the
failure, but it means the second `burger.click()` lands on a freshly loading
~1.4 MB WebGL document rather than on a light generated route.

---

## Contract B

| Field | Value |
| --- | --- |
| Spec file | `tests/homepage-modality.spec.ts` |
| Line | **96** (throw site **248**) |
| Test name | `while it is open the page behind it cannot be reached, and afterwards it can` |
| Enclosing describe | `the full-screen navigation is a modal layer` |
| Project | **`portrait-chromium`** |
| Browser / viewport | Chromium, 390 × 844, `isMobile`, `hasTouch`, DPR 3 |
| Duration at failure | 2.3 s |
| Failing call | `await page.evaluate(() => document.activeElement?.id ?? '')` |
| Failure message | `page.evaluate: Execution context was destroyed, most likely because of a navigation` |
| Last successful step | `await page.mouse.click(point[0], point[1])` — the click was delivered |
| Trace | none retained |
| Machine-readable record | `_build/reports/hermetic-gate/failures/g2-04-02-portraitchromium.json` |

### The shape under test

```ts
const target = await page.evaluate(([x, y]) => {          // sampled BEFORE the click
  const el = document.elementFromPoint(x, y);
  return { landedOn: …, href: el?.closest('a[href]')?.getAttribute('href') ?? null };
}, point);

if (target.href) {                                        // predicted: will navigate
  await Promise.all([page.waitForURL(…), page.mouse.click(…)]);
  …
}
await page.mouse.click(point[0], point[1]);               // predicted: cannot navigate
expect(await page.evaluate(() => document.activeElement?.id ?? ''), …)  // ← threw
```

### This is the second attempt at this failure

The spec carries a comment describing an earlier fix: the original version
clicked and then called `waitForLoadState`, which resolves immediately against
the already-loaded document and settled nothing. The current version replaced
that with the prediction above and states "Neither branch races." That claim is
what failed in run 4.

### Prior classification, and why it was provisional

`six-run-matrix.md` recorded this as a navigation **race**, not a stall, on the
strength of the error text alone, and explicitly declined to name a cause from
one occurrence. The reconstruction is in `final-report.md`.
