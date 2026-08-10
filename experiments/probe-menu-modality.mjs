/**
 * Where keyboard focus goes while the full-screen navigation is open, and why.
 *
 * §1 of the final hardening brief reports that on WebKit a Tab from inside the
 * open menu reaches page content behind it — the newsletter field among other
 * things. The trap in `assets/js/header.js` is a `keydown` handler that wraps
 * focus at the two ends of a list it builds itself, so "focus escaped" has
 * exactly two possible mechanisms and this probe distinguishes them:
 *
 *   1. the list is wrong — `focusables()` filters on `offsetParent !== null`,
 *      and the layer sits inside a `position: fixed` header on a `position:
 *      fixed` body while the lock is on. If an engine reports `null` there, the
 *      list collapses and the wrap never fires.
 *
 *   2. the list is right but the wrap is at the wrong end — the trigger is
 *      spliced in at index 0 while the DOM may place it after the layer, so
 *      "the last element" in the array is not the last one in tab order.
 *
 * Both are recorded for both engines, along with the actual tab trail, so the
 * fix is chosen against a measurement rather than against a theory.
 *
 *   node experiments/probe-menu-modality.mjs
 *
 * Writes _build/reports/menu-modality-<label>.json.
 */
import { chromium, webkit } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const ORIGIN = arg('origin', 'http://127.0.0.1:4322');
const LABEL = arg('label', 'before');

const ARMS = [
  { name: 'home-desktop', url: '/index.html', viewport: { width: 1440, height: 900 } },
  { name: 'home-portrait', url: '/index.html', viewport: { width: 390, height: 844 } },
  { name: 'static-desktop', url: '/rolunk.html', viewport: { width: 1440, height: 900 } },
];

async function run(engineName, launcher) {
  const browser = await launcher.launch();
  const out = { engine: engineName, arms: [] };

  for (const arm of ARMS) {
    const context = await browser.newContext({ viewport: arm.viewport });
    const page = await context.newPage();
    await page.goto(ORIGIN + arm.url, { waitUntil: 'load' });
    await page.waitForTimeout(2000);

    await page.locator('.burger').click();
    await page.waitForTimeout(300);

    // The DOM audit, taken with the layer open so the scroll lock is in force.
    const audit = await page.evaluate(() => {
      const burger = document.querySelector('.burger');
      const menu = document.getElementById('menu');
      const SEL = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';
      const inMenu = [...menu.querySelectorAll(SEL)];
      const describe = (el) => ({
        tag: el.tagName,
        cls: String(el.className).slice(0, 30),
        offsetParent: el.offsetParent ? el.offsetParent.tagName + '.' + String(el.offsetParent.className).slice(0, 16) : null,
        visible: el.getClientRects().length > 0,
      });
      return {
        bodyChildren: [...document.body.children].map((el) => el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).split(' ')[0] : '')),
        bodyPosition: getComputedStyle(document.body).position,
        menuBeforeBurger: !!(menu.compareDocumentPosition(burger) & Node.DOCUMENT_POSITION_FOLLOWING),
        burger: describe(burger),
        menuCount: inMenu.length,
        menuVisibleByOffsetParent: inMenu.filter((el) => el.offsetParent !== null).length,
        menuVisibleByRects: inMenu.filter((el) => el.getClientRects().length > 0).length,
        firstThree: inMenu.slice(0, 3).map(describe),
        // What the shipped trap would compute, verbatim.
        trapList: [burger, ...inMenu]
          .filter((el) => el.offsetParent !== null || el === document.activeElement)
          .map((el) => el.tagName + '.' + String(el.className).split(' ')[0]),
        supportsInert: 'inert' in HTMLElement.prototype,
        backgroundFocusables: [...document.querySelectorAll(SEL)].filter(
          (el) => !menu.contains(el) && el !== burger,
        ).length,
      };
    });

    // The tab trail, recorded in the page.
    await page.evaluate(() => {
      const w = window;
      w.__trail = [];
      const where = () => {
        const el = document.activeElement;
        if (!el) return 'nothing';
        if (el.closest('#menu')) return 'menu';
        if (el.classList.contains('burger')) return 'burger';
        return `ESCAPED:${el.tagName}#${el.id}.${String(el.className).slice(0, 20)}`;
      };
      w.__trail.push(where());
      document.addEventListener('focusin', () => w.__trail.push(where()));
    });

    for (let i = 0; i < 30; i++) await page.keyboard.press('Tab');
    const forward = await page.evaluate(() => window.__trail);

    await page.evaluate(() => { window.__trail = []; });
    for (let i = 0; i < 30; i++) await page.keyboard.press('Shift+Tab');
    const backward = await page.evaluate(() => window.__trail);

    // Can a pointer still activate something behind the layer?
    const pointer = await page.evaluate(() => {
      const nl = document.getElementById('nl');
      if (!nl) return { newsletterPresent: false };
      const r = nl.getBoundingClientRect();
      const topAt = document.elementFromPoint(
        Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1),
        Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1),
      );
      nl.focus();
      return {
        newsletterPresent: true,
        newsletterTookFocus: document.activeElement === nl,
        elementAtNewsletterPoint: topAt ? topAt.tagName + '.' + String(topAt.className).slice(0, 20) : null,
      };
    });

    out.arms.push({
      name: arm.name,
      viewport: arm.viewport,
      audit,
      pointer,
      forwardEscapes: forward.filter((t) => t.startsWith('ESCAPED') || t === 'nothing'),
      backwardEscapes: backward.filter((t) => t.startsWith('ESCAPED') || t === 'nothing'),
      forwardTrail: forward.slice(0, 12),
      backwardTrail: backward.slice(0, 12),
    });

    await context.close();
  }

  await browser.close();
  return out;
}

const report = { origin: ORIGIN, label: LABEL, at: new Date().toISOString(), engines: [] };
report.engines.push(await run('chromium', chromium));
report.engines.push(await run('webkit', webkit));

const dir = resolve(ROOT, '_build/reports');
mkdirSync(dir, { recursive: true });
const path = resolve(dir, `menu-modality-${LABEL}.json`);
writeFileSync(path, JSON.stringify(report, null, 2));

for (const engine of report.engines) {
  console.log(`\n  ${engine.engine}`);
  for (const arm of engine.arms) {
    console.log(`    ${arm.name} ${arm.viewport.width}x${arm.viewport.height}`);
    console.log(`      body position: ${arm.audit.bodyPosition}; inert supported: ${arm.audit.supportsInert}`);
    console.log(`      menu focusables: ${arm.audit.menuCount}; by offsetParent: ${arm.audit.menuVisibleByOffsetParent}; by rects: ${arm.audit.menuVisibleByRects}`);
    console.log(`      burger offsetParent: ${arm.audit.burger.offsetParent}`);
    console.log(`      trap list length: ${arm.audit.trapList.length}; background focusables: ${arm.audit.backgroundFocusables}`);
    console.log(`      forward escapes: ${arm.forwardEscapes.length} ${arm.forwardEscapes.slice(0, 4).join(', ')}`);
    console.log(`      backward escapes: ${arm.backwardEscapes.length} ${arm.backwardEscapes.slice(0, 4).join(', ')}`);
    console.log(`      newsletter took focus while open: ${arm.pointer.newsletterTookFocus}; element at its point: ${arm.pointer.elementAtNewsletterPoint}`);
  }
}
console.log(`\n  written: ${path}\n`);
