import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CONTRACT A — `homepage-chrome.spec.ts:1005`
 * "a subpage reached from the homepage carries the same working header"
 *
 * THE FAILURE, EXACTLY
 * --------------------
 *     expect(locator('#menu')).toBeVisible() failed
 *     Expected: visible   Received: hidden   Timeout: 5000 ms
 *
 * `hidden`, not "not found" and not "strict mode violation". That distinction
 * decides the whole investigation and it is worth stating before any hypothesis:
 * **`#menu` is an id selector and there is exactly one of them.** The brief's
 * §3–§7 are written for a selector matching several candidates — an inactive
 * composition, a transition copy, a mobile/desktop duplicate — and that is a
 * reasonable thing to suspect from the phrase "assertion evaluated against a
 * hidden element". It is not what happened here, and this file's first job is to
 * establish the candidate count rather than to assume it.
 *
 * If there is one candidate and it is `hidden`, then the question is not *which*
 * element the assertion found. It is why the layer never opened.
 *
 * WHAT THIS RECORDS
 * -----------------
 * The test's sequence is:
 *
 *     goto /index.html → burger.click() → click a link in the menu
 *       → [full document navigation]
 *       → expect(header).toBeVisible() → burger.click() → expect(#menu).toBeVisible()
 *
 * The second `burger.click()` happens on a **freshly navigated document**.
 * `header.nav` and `.burger` are both in the server-rendered HTML, so they are
 * visible and clickable the instant the document parses — considerably before
 * the deferred `assets/js/header.js` has run and bound
 * `burger.addEventListener('click', …)` (header.js:371).
 *
 * Playwright's actionability check waits for visible, stable, enabled and
 * receives-events. **None of those is "has a JavaScript listener".** A click
 * delivered in that window is a real click on a real button that nothing is
 * listening to, and the layer correctly stays `hidden` for the full 5 000 ms.
 *
 * So this captures, at the instant before the click, whether the script that
 * makes the button work had run: `window.Stratos.header` is published at
 * header.js:419, AFTER every listener in the file is bound, which makes it an
 * exact readiness marker rather than an approximate one.
 */

const OUT = process.env.CONTRACT_A_OUT ?? '_build/reports/final-two-contracts/contract-a';

/** Everything about `#menu` and its would-be duplicates. §4. */
const auditMenu = (page: Page) =>
  page.evaluate(() => {
    const all = [...document.querySelectorAll('#menu, [id="menu"], .menu, [data-menu]')];
    return {
      // §4 asks for the candidate audit. If this is 1, §3–§7 do not apply.
      candidateCount: all.length,
      idMenuCount: document.querySelectorAll('[id="menu"]').length,
      candidates: all.slice(0, 6).map((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          path: (() => {
            const p: string[] = [];
            let n: Element | null = el;
            while (n && p.length < 6) { p.unshift(n.tagName + (n.id ? '#' + n.id : '')); n = n.parentElement; }
            return p.join('>');
          })(),
          id: el.id,
          cls: el.className?.toString?.().slice(0, 60),
          hiddenAttr: (el as HTMLElement).hidden,
          ariaHidden: el.getAttribute('aria-hidden'),
          inert: el.hasAttribute('inert'),
          display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
          box: { x: r.x, y: r.y, w: r.width, h: r.height },
          inViewport: r.width > 0 && r.height > 0,
        };
      }),
    };
  });

/** Did the script that makes the button work actually run? */
const readiness = (page: Page) =>
  page.evaluate(() => ({
    readyState: document.readyState,
    // header.js:419 — published after every listener in the file is bound.
    stratosHeader: typeof (window as any).Stratos?.header === 'object',
    burgerPresent: !!document.querySelector('.burger'),
    burgerExpanded: document.querySelector('.burger')?.getAttribute('aria-expanded') ?? null,
    menuHidden: (document.getElementById('menu') as HTMLElement | null)?.hidden ?? null,
    // Is the script element there at all, and did it finish?
    headerScript: [...document.querySelectorAll('script[src]')]
      .map((s) => (s as HTMLScriptElement).src)
      .filter((s) => /header/.test(s))
      .map((s) => s.split('/').pop()),
    url: location.pathname,
  }));

const deck = (page: Page) => page.locator('header.nav');
const burger = (page: Page) => page.locator('.burger');
const menu = (page: Page) => page.locator('#menu');

test.describe.configure({ timeout: 120_000 });

test('contract A — subpage header, instrumented', async ({ page }, info) => {
  const rec: Record<string, unknown> = {
    project: info.project.name,
    repeat: info.repeatEachIndex,
    worker: info.workerIndex,
    startedAt: new Date().toISOString(),
  };

  await page.goto('/index.html');
  rec.homeReadiness = await readiness(page);

  await burger(page).click();
  rec.homeAfterBurger = await readiness(page);

  const href = await menu(page).locator('.menu__panel a[href]').first().getAttribute('href');
  rec.followedHref = href;
  await menu(page).locator('.menu__panel a[href]').first().click();

  // The subpage. Everything below is on the new document.
  await expect(deck(page)).toBeVisible();

  /* The state at the exact moment the real test would click. This is the
     measurement the whole contract turns on: if `stratosHeader` is false here,
     the button is painted and inert, and the click that follows is delivered to
     nothing. */
  const atClick = await readiness(page);
  rec.subpageAtClickTime = atClick;
  rec.subpageMenuAudit = await auditMenu(page);
  rec.scriptBoundBeforeClick = atClick.stratosHeader;

  await burger(page).click();

  /* Poll the layer the way the assertion does, but record the trajectory rather
     than only the verdict — including whether the script finished binding at
     some point AFTER the click, which is the signature of a click delivered
     into the gap. */
  const trail: unknown[] = [];
  const deadline = Date.now() + 5_000;
  let visible = false;
  while (Date.now() < deadline) {
    const s = await page.evaluate(() => {
      const m = document.getElementById('menu') as HTMLElement | null;
      const r = m?.getBoundingClientRect();
      return {
        hidden: m?.hidden ?? null,
        expanded: document.querySelector('.burger')?.getAttribute('aria-expanded') ?? null,
        stratosHeader: typeof (window as any).Stratos?.header === 'object',
        display: m ? getComputedStyle(m).display : null,
        visibility: m ? getComputedStyle(m).visibility : null,
        w: r?.width ?? 0, h: r?.height ?? 0,
      };
    });
    trail.push({ t: Date.now(), ...s });
    if (s.hidden === false && s.w > 0 && s.h > 0 && s.visibility !== 'hidden') { visible = true; break; }
    await page.waitForTimeout(100);
  }
  rec.trail = trail.slice(0, 60);
  rec.becameVisible = visible;
  rec.finalReadiness = await readiness(page);

  /* §12 — the first divergence, named from the record rather than from the
     assertion that happened to throw. */
  rec.firstDivergence = visible
    ? null
    : !atClick.stratosHeader
      ? 'header.js had NOT bound when the click was delivered (Stratos.header absent at click time)'
      : (trail[0] as any)?.expanded === 'false'
        ? 'script was bound, click delivered, but aria-expanded never became true'
        : 'script bound and aria-expanded true, but the layer stayed hidden';

  rec.outcome = visible ? 'PASS' : 'FAIL';

  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, `${info.project.name}-r${info.repeatEachIndex}-w${info.workerIndex}-${Date.now()}.json`),
    `${JSON.stringify(rec, null, 2)}\n`,
  );

  expect(visible, `layer never opened — ${rec.firstDivergence}`).toBe(true);
});
