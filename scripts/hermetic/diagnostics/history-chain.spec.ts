import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Back navigation, frame by frame, from the first paint of the restored
 * document.
 *
 * WHY FRAME BY FRAME
 * ------------------
 * `homepage-history.spec.ts:223` asserts the END of the restore: where the
 * visitor ended up. When it fails it reports a final `scrollY` and a timeout,
 * and every interesting question is about the twenty frames before that:
 *
 *   Did the browser restore at all, or land at 0?
 *   Did it restore to the right place and then get clamped?
 *   Was the reserve up when the restore happened, or did it arrive late?
 *   Did the reserve release before the real content had grown past it?
 *
 * Those four have the same final number and completely different causes. The
 * fix in `assets/js/home-history.js` exists because the browser's restore was
 * being clamped into a document that was still the parsed shell — `y` came back
 * as exactly `scrollHeight − innerHeight` — and that signature is only visible
 * on the frame it happens.
 *
 * So this samples `scrollY`, `scrollHeight` and the reserve on every animation
 * frame from the first line of the restored document, and records the lifecycle
 * events around them. §18's list, in the order the browser produces it, with
 * nothing inferred.
 *
 * NOT INHERITING THE HYPOTHESIS
 * -----------------------------
 * §18 says to start from scratch. The existing explanation — late-growing React
 * content clamping a correct restore — is written into the product file's
 * header, and it would be easy to record only the evidence that confirms it.
 * The sampler deliberately records the raw trajectory instead: if the restore
 * never happens at all, or happens correctly and is then undone by something
 * scrolling afterwards, this shows that just as plainly. `scrollTo` and
 * `scrollIntoView` are wrapped for the same reason — so "the application
 * scrolled after the restore" is an observation rather than a denial.
 */

const OUT = process.env.HISTORY_DIAG_OUT ?? '_build/reports/hermetic-gate/history-chain';
const ANCHORS = ['stage-selected-work', 'stage-system'] as const;
const TOLERANCE = 200;

type Frame = { t: number; y: number; h: number; ih: number; reserve: string };
type Event = { t: number; kind: string; detail?: unknown };

/**
 * Sampling starts before the document has a body, and stops on its own.
 *
 * 600 frames is ten seconds at 60 fps and about a megabyte of nothing if the
 * page is quiet, so the sampler stops early once the picture has stopped
 * changing — but only after the reserve has been released, because the release
 * is the event the whole mechanism turns on and stopping before it would hide
 * exactly the failure being looked for.
 */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    type W = { __frames: Frame[]; __events: Event[]; __t0: number; __scrolls: unknown[] };
    const w = window as unknown as W;
    w.__t0 = performance.timeOrigin ? Date.now() : Date.now();
    w.__frames = [];
    w.__events = [];
    w.__scrolls = [];
    const now = () => Date.now() - w.__t0;
    const rec = (kind: string, detail?: unknown) => w.__events.push({ t: now(), kind, detail });

    rec('init-script', {
      readyState: document.readyState,
      scrollRestoration: history.scrollRestoration,
      // What the reserve mechanism had banked before this document existed.
      stored: (() => { try { return sessionStorage.getItem('stratos.home-height'); } catch { return 'unreadable'; } })(),
    });

    /* Every programmatic scroll, with the stack that made it. If the restore is
       correct and something moves the page afterwards, this is the only place
       that would show it. */
    const wrap = (obj: any, name: string) => {
      const real = obj[name];
      if (typeof real !== 'function') return;
      obj[name] = function (...args: unknown[]) {
        w.__scrolls.push({ t: now(), fn: name, args: JSON.stringify(args).slice(0, 120), y: scrollY,
          stack: (new Error().stack ?? '').split('\n').slice(2, 5).join(' | ') });
        return real.apply(this, args);
      };
    };
    wrap(window, 'scrollTo');
    wrap(window, 'scrollBy');
    wrap(window, 'scroll');
    wrap(Element.prototype, 'scrollIntoView');
    wrap(Element.prototype, 'scrollTo');

    /* `scrollTop = n` is an ASSIGNMENT, not a call, so wrapping methods misses
       it entirely — and it is the form GSAP's ScrollTrigger uses. The first
       version of this file recorded an empty scroll log for a run that had
       plainly been moved, which is worse than no log: it reads as proof that
       nothing scrolled the page. Redefining the accessor is the only way to see
       it, and the original setter is still called, so behaviour is unchanged. */
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    if (desc?.set && desc.get) {
      Object.defineProperty(Element.prototype, 'scrollTop', {
        configurable: true,
        get: desc.get,
        set(v: number) {
          if (this === document.documentElement || this === document.body || this === document.scrollingElement) {
            w.__scrolls.push({ t: now(), fn: 'scrollTop=', args: String(v), y: scrollY,
              stack: (new Error().stack ?? '').split('\n').slice(2, 5).join(' | ') });
          }
          return desc.set!.call(this, v);
        },
      });
    }

    let stable = 0;
    let lastY = -1;
    let released = false;
    const sample = () => {
      const reserve = document.documentElement.style.getPropertyValue('--home-reserve');
      if (!reserve && w.__frames.length > 2) released = true;
      const y = Math.round(scrollY);
      w.__frames.push({
        t: now(), y,
        h: document.documentElement.scrollHeight,
        ih: innerHeight,
        reserve,
      });
      if (y === lastY) stable += 1; else { stable = 0; lastY = y; }
      // Stop once released AND settled, or at the hard cap.
      if (w.__frames.length < 600 && !(released && stable > 90)) requestAnimationFrame(sample);
      else rec('sampler-stopped', { frames: w.__frames.length, released, stable });
    };
    requestAnimationFrame(sample);

    addEventListener('DOMContentLoaded', () => rec('DOMContentLoaded', {
      y: Math.round(scrollY), h: document.documentElement.scrollHeight,
      reserve: document.documentElement.style.getPropertyValue('--home-reserve'),
    }));
    addEventListener('load', () => rec('load', {
      y: Math.round(scrollY), h: document.documentElement.scrollHeight,
      reserve: document.documentElement.style.getPropertyValue('--home-reserve'),
    }));
    addEventListener('pageshow', (e) => rec('pageshow', {
      persisted: e.persisted, y: Math.round(scrollY),
      h: document.documentElement.scrollHeight,
      reserve: document.documentElement.style.getPropertyValue('--home-reserve'),
    }));
    addEventListener('pagehide', (e) => rec('pagehide', {
      persisted: e.persisted, y: Math.round(scrollY),
      h: document.documentElement.scrollHeight,
      stored: (() => { try { return sessionStorage.getItem('stratos.home-height'); } catch { return 'unreadable'; } })(),
    }));
    addEventListener('popstate', () => rec('popstate', { y: Math.round(scrollY) }));
  });
}

const dump = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __frames: Frame[]; __events: Event[]; __scrolls: unknown[] };
    return { frames: w.__frames ?? [], events: w.__events ?? [], scrolls: w.__scrolls ?? [] };
  });

async function homepageReady(page: Page) {
  await page.waitForFunction(
    () => !!document.querySelector('[data-testid="altitude-value"],[data-testid="mobile-altitude"]'),
    null,
    { timeout: 30_000 },
  );
}

async function settled(page: Page) {
  await page.waitForLoadState('load');
  await homepageReady(page);
  await page.waitForFunction(
    () => !document.documentElement.style.getPropertyValue('--home-reserve'),
    null,
    { timeout: 20_000 },
  );
}

const place = (page: Page) =>
  page.evaluate(() => ({
    y: Math.round(scrollY),
    travel: document.documentElement.scrollHeight - innerHeight,
    h: document.documentElement.scrollHeight,
    headerState: document.querySelector('.nav')?.getAttribute('data-state') ?? null,
    chapter: (
      document.querySelector('[data-testid="altitude-stage"],[data-testid="mobile-stage"]')?.textContent ?? ''
    ).trim(),
    reserve: document.documentElement.style.getPropertyValue('--home-reserve'),
  }));

test.describe.configure({ timeout: 180_000 });

test('homepage history restoration — full trajectory', async ({ page }, info) => {
  const record: Record<string, unknown> = {
    project: info.project.name,
    repeat: info.repeatEachIndex,
    workerIndex: info.workerIndex,
    startedAt: new Date().toISOString(),
  };
  let outcome = 'PASS';

  await instrument(page);

  // ---- first visit --------------------------------------------------------
  await page.goto('/index.html');
  await settled(page);
  record.firstVisit = await place(page);
  record.firstVisitTrace = await dump(page);

  // ---- scroll to the anchor midpoint -------------------------------------
  const target = await page.evaluate((ids) => {
    const tops = ids.map((id) => {
      const el = document.getElementById(id);
      return el ? el.getBoundingClientRect().top + scrollY : null;
    });
    if (tops.some((t) => t === null)) return null;
    const travel = document.documentElement.scrollHeight - innerHeight;
    return Math.min(Math.round(((tops[0] as number) + (tops[1] as number)) / 2), travel);
  }, ANCHORS as unknown as string[]);
  record.target = target;

  if (target == null) {
    record.outcome = 'SKIP — anchors absent in this composition';
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${info.project.name}-r${info.repeatEachIndex}-${Date.now()}.json`),
      `${JSON.stringify(record, null, 2)}\n`);
    test.skip(true, 'anchors absent');
    return;
  }

  await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), target);
  await expect.poll(() => page.evaluate(() => Math.round(scrollY)), { timeout: 10_000 })
    .toBeGreaterThan(target - 50);
  const before = await place(page);
  record.before = before;

  // ---- leave by a footer link --------------------------------------------
  const href = await page.evaluate(() => {
    const a = document.querySelector<HTMLAnchorElement>('.foot a[href$=".html"]');
    return a ? a.getAttribute('href') : null;
  });
  record.leftBy = href;
  await Promise.all([
    page.waitForURL((url) => url.pathname.endsWith(href!.split('/').pop()!)),
    page.evaluate(() => document.querySelector<HTMLAnchorElement>('.foot a[href$=".html"]')!.click()),
  ]);
  record.destination = page.url();
  // What the homepage banked on its way out, read from the destination document
  // because the origin one no longer exists to be asked.
  record.storedAfterLeaving = await page.evaluate(() => {
    try { return sessionStorage.getItem('stratos.home-height'); } catch { return 'unreadable'; }
  });

  // ---- Back ---------------------------------------------------------------
  const backAt = Date.now();
  await page.goBack();
  record.goBackMs = Date.now() - backAt;

  // The trajectory of the restore, captured before anything is allowed to
  // settle — this is the part §18 asks for and the part a final assertion
  // throws away.
  const early = await dump(page);
  record.restoreTrace = early;
  record.firstFrames = early.frames.slice(0, 12);
  const reserved = early.frames.find((f) => f.reserve)?.reserve ?? null;
  record.reserveObserved = reserved;
  record.firstScrollY = early.frames[0]?.y ?? null;
  record.pageshow = early.events.find((e) => e.kind === 'pageshow') ?? null;
  record.persisted = (record.pageshow as Event | null)?.detail
    ? ((record.pageshow as Event).detail as { persisted: boolean }).persisted
    : null;

  try {
    await settled(page);
  } catch (err) {
    outcome = 'FAIL';
    record.settleError = String((err as Error).message).split('\n').slice(0, 6).join('\n');
  }

  const after = await place(page);
  record.after = after;
  record.finalTrace = await dump(page);

  /* ---- the SECOND traversal, which is the one that actually fails ---------
   *
   * `homepage-history.spec.ts:223` asserts the restore twice. The first
   * assertion is at :275 and the second at :293, after a `goForward()` to the
   * destination and a `goBack()` to the homepage again — and :293 is the one
   * the stack trace names in every failure captured so far, both the
   * load-induced one and the §20 mutation check.
   *
   * The first version of this diagnostic exercised only the first Back and
   * passed 48 times out of 48, which was not evidence that the mechanism holds:
   * it was evidence that the diagnostic was pointed at the wrong leg. The two
   * legs are not the same journey. On the second one the homepage document has
   * already been created once in this session, the destination page has had its
   * own lifecycle in between, and the sessionStorage the reserve reads from has
   * been written by something else since. Any of those could change what the
   * reserve is worth, and none of them is exercised by a single Back. */
  await page.goForward();
  await page.waitForURL((u) => u.pathname.endsWith(href!.split('/').pop()!));
  record.forwardTo = page.url();

  const back2At = Date.now();
  await page.goBack();
  record.goBack2Ms = Date.now() - back2At;

  const early2 = await dump(page);
  record.restoreTrace2 = early2;
  record.firstFrames2 = early2.frames.slice(0, 12);
  record.reserveObserved2 = early2.frames.find((f) => f.reserve)?.reserve ?? null;
  record.firstScrollY2 = early2.frames[0]?.y ?? null;
  const ps2 = early2.events.filter((e) => e.kind === 'pageshow').pop() ?? null;
  record.pageshow2 = ps2;
  record.persisted2 = ps2 ? (ps2.detail as { persisted: boolean }).persisted : null;

  try {
    await settled(page);
  } catch (err) {
    outcome = 'FAIL';
    record.settleError2 = String((err as Error).message).split('\n').slice(0, 6).join('\n');
  }

  const after2 = await place(page);
  record.after2 = after2;
  const checks2 = {
    notTop: after2.y > TOLERANCE,
    notBottom: after2.travel - after2.y > TOLERANCE,
    withinTolerance: Math.abs(after2.y - before.y) <= TOLERANCE,
    sameChapter: after2.chapter === before.chapter,
    sameHeader: after2.headerState === before.headerState,
  };
  record.checks2 = checks2;
  record.yError2 = after2.y - before.y;
  record.heightAfter2 = after2.h;
  if (!Object.values(checks2).every(Boolean)) outcome = 'FAIL';

  // ---- the product contract, evaluated but not thrown ---------------------
  // Recorded as booleans rather than asserted one at a time, so a failing run
  // still produces the whole picture instead of stopping at the first bad
  // number. The assertion at the end is what makes it a test.
  const checks = {
    notTop: after.y > TOLERANCE,
    notBottom: after.travel - after.y > TOLERANCE,
    withinTolerance: Math.abs(after.y - before.y) <= TOLERANCE,
    sameChapter: after.chapter === before.chapter,
    sameHeader: after.headerState === before.headerState,
  };
  record.checks = checks;
  record.yError = after.y - before.y;
  record.heightBefore = before.h;
  record.heightAfter = after.h;

  /* §21 — the boundary this run actually reached, named from surviving evidence
     rather than from which assertion happened to throw. */
  record.lastConfirmedEvent =
    Object.values(checks).every(Boolean) ? 'restoration satisfied'
    : checks.notTop && checks.notBottom ? 'restored, position outside tolerance'
    : !checks.notTop ? 'restored to the TOP (no restore, or reserve absent)'
    : 'restored to the BOTTOM (clamped into a short document)';

  if (!Object.values(checks).every(Boolean)) outcome = 'FAIL';
  record.outcome = outcome;
  // Which LEG failed, named separately, because "the restore broke" is two
  // different defects depending on the answer.
  record.failingLeg =
    outcome === 'PASS' ? null
    : !Object.values(checks).every(Boolean) ? 'first-back'
    : 'second-back (forward then back)';

  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, `${info.project.name}-r${info.repeatEachIndex}-w${info.workerIndex}-${Date.now()}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  );

  const ok = { notTop: true, notBottom: true, withinTolerance: true, sameChapter: true, sameHeader: true };
  expect(
    checks,
    `FIRST back: left at ${before.y}, came back to ${after.y} (h ${before.h} -> ${after.h}, ` +
      `reserve ${reserved ?? 'none'}, first frame y=${record.firstScrollY}) — ${record.lastConfirmedEvent}`,
  ).toEqual(ok);
  expect(
    checks2,
    `SECOND back (forward then back): left at ${before.y}, came back to ${after2.y} ` +
      `(h ${after2.h}, reserve ${record.reserveObserved2 ?? 'none'}, ` +
      `first frame y=${record.firstScrollY2}, persisted=${record.persisted2})`,
  ).toEqual(ok);
});
