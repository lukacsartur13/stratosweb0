import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The lead submission, event by event, so a failure can name the step it stopped
 * at instead of the number of milliseconds it waited.
 *
 * WHY THIS FILE EXISTS AND WHY IT IS NOT IN tests/
 * -----------------------------------------------
 * `lead-forms.spec.ts:177` — the 422 contract — has been failing intermittently
 * and reporting `Timeout 30000ms exceeded`, which says only that something did
 * not happen. §22 forbids retaining a failure described that way, and §21
 * forbids inferring which boundary was crossed from the test's name.
 *
 * The chain between the click and the assertion has eight links, and the
 * previous trace established that the *first* of them was fine — the button
 * existed, a listener was bound, Playwright considered the element actionable.
 * That rules out the first link and says nothing about the other seven:
 *
 *   locator.click ─▶ pointerdown ─▶ mousedown ─▶ pointerup ─▶ mouseup
 *     ─▶ click ─▶ submit ─▶ [client-side check] ─▶ state:submitting
 *     ─▶ MIN_FILL_MS wait ─▶ fetch ─▶ 422 ─▶ state:invalid ─▶ message
 *
 * This file records every one of them, on both the passing and the failing
 * path, so the two can be diffed and the first divergence named.
 *
 * It lives under scripts/ rather than tests/ deliberately. `testDir` is
 * `./tests`, so a diagnostic placed there would join the repository-wide gate
 * and change its collected count — which is the one number §30's arithmetic
 * check depends on being stable across six runs. A diagnostic that alters the
 * gate it is diagnosing is not a diagnostic.
 *
 * THE FORK THIS IS BUILT TO RESOLVE
 * ---------------------------------
 * `data-state="invalid"` has TWO producers in assets/js/lead.js, and the test
 * asserts the attribute before it asserts the message:
 *
 *   1. the CLIENT-side `check()`, which fires synchronously on submit and sets
 *      the generic 'Kérjük, ellenőrizd a kiemelt mezőket.';
 *   2. the SERVER's 422, which sets 'That email address does not look right.'
 *
 * A run where a field did not take would satisfy `toHaveAttribute` from
 * producer 1 and then fail on `toHaveText` — a completely different defect from
 * a timeout, wearing the same line number. The timeline below distinguishes
 * them by recording which producer ran.
 */

const OUT = process.env.LEAD_DIAG_OUT ?? '_build/reports/hermetic-gate/lead-chain';

type Timeline = { t: number; kind: string; detail?: unknown }[];

/**
 * Install the recorders before any page script runs.
 *
 * `addInitScript` rather than `evaluate`, because a listener attached after
 * `lead.js` has bound its own would sit behind it in the same phase and could
 * not observe an event that a handler earlier in the list had already acted on.
 * These go on `window` in the CAPTURE phase, which is ahead of everything the
 * page attaches to the form.
 */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __chain: Timeline; __t0: number };
    w.__t0 = Date.now();
    w.__chain = [];
    const rec = (kind: string, detail?: unknown) =>
      w.__chain.push({ t: Date.now() - w.__t0, kind, detail });

    rec('init-script');

    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      addEventListener(
        type,
        (e) => {
          const el = e.target as HTMLElement | null;
          rec(`event:${type}`, {
            target: el?.tagName,
            type_: (el as HTMLButtonElement | null)?.type,
            name: el?.getAttribute?.('name'),
            insideLeadForm: !!el?.closest?.('form[data-lead]'),
            isTrusted: (e as Event).isTrusted,
          });
        },
        true,
      );
    }

    /* Both phases for `submit`: the capture record proves the event was
       dispatched at all, and the bubble record — which runs after lead.js's own
       listener — carries `defaultPrevented`, which is how we know the
       controller took it rather than the browser navigating away. */
    addEventListener('submit', (e) => rec('event:submit-capture', {
      form: (e.target as HTMLFormElement)?.dataset?.lead,
    }), true);
    addEventListener('submit', (e) => rec('event:submit-bubble', {
      defaultPrevented: e.defaultPrevented,
    }), false);

    /* The network boundary, in four parts: requested, sent, answered, parsed.
       A fetch that is never *called* is a controller fault; one called and never
       answered is a route/server fault; the difference is invisible from
       outside the page. */
    const realFetch = window.fetch;
    window.fetch = function (...args: Parameters<typeof fetch>) {
      const url = String(args[0]);
      const init = args[1] as RequestInit | undefined;
      let body: unknown = null;
      try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = '(unparsed)'; }
      rec('fetch:request', {
        url,
        method: init?.method,
        // Field NAMES and the shape only. The values are a synthetic fixture,
        // but a diagnostic that prints form contents is one bad fixture away
        // from printing a real person's details into a report.
        fieldKeys: body && typeof body === 'object' ? Object.keys((body as any).fields ?? {}) : null,
        elapsedMs: (body as any)?.elapsedMs,
        attempt: (body as any)?.attempt,
        submissionId: (body as any)?.submissionId ? 'present' : 'absent',
      });
      return realFetch.apply(this, args).then(
        (res) => { rec('fetch:response', { url, status: res.status, ok: res.ok }); return res; },
        (err) => { rec('fetch:error', { url, message: String(err?.message ?? err) }); throw err; },
      );
    };

    /* State transitions, from the DOM rather than from the controller, so this
       records what the page ACTUALLY showed and not what it meant to. */
    addEventListener('DOMContentLoaded', () => {
      rec('DOMContentLoaded');
      const form = document.querySelector('form[data-lead="contact"]');
      const note = document.querySelector('.form__status');
      if (form) {
        rec('form:found', { bound: (form as HTMLElement).dataset.leadBound });
        new MutationObserver(() =>
          rec('state:form', { state: (form as HTMLElement).dataset.state }),
        ).observe(form, { attributes: true, attributeFilter: ['data-state'] });
      } else rec('form:MISSING');
      if (note) {
        new MutationObserver(() =>
          rec('state:note', {
            state: (note as HTMLElement).dataset.state,
            text: (note.textContent ?? '').slice(0, 80),
          }),
        ).observe(note, { attributes: true, childList: true, characterData: true, subtree: true });
      } else rec('note:MISSING');
    });

    addEventListener('load', () => rec('load'));
    addEventListener('pageshow', (e) => rec('pageshow', { persisted: e.persisted }));
    addEventListener('pagehide', () => rec('pagehide'));
  });
}

/**
 * Everything about the button at the instant before it is clicked.
 *
 * §15, and none of it uses `force: true`. The point is to find out whether the
 * click lands, not to make it land: a forced click that succeeds proves only
 * that the diagnostic can be made to pass.
 */
async function hitTest(page: Page) {
  return page.evaluate(() => {
    const btn = [...document.querySelectorAll('form[data-lead="contact"] button')]
      .find((b) => /Küldés/.test(b.textContent ?? '')) as HTMLButtonElement | undefined;
    if (!btn) return { found: false };
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const at = document.elementFromPoint(cx, cy);
    const cs = getComputedStyle(btn);
    const form = btn.closest('form') as HTMLFormElement;
    return {
      found: true,
      box: { x: r.x, y: r.y, w: r.width, h: r.height },
      center: { x: cx, y: cy },
      inViewport: r.top >= 0 && r.bottom <= innerHeight,
      scrollY: Math.round(scrollY),
      // The element the browser would actually deliver the pointer to. If this
      // is not the button or a child of it, something is over the top.
      elementFromPoint: at ? { tag: at.tagName, cls: at.className?.toString?.().slice(0, 60) } : null,
      hitsButton: at === btn || btn.contains(at),
      computed: {
        visibility: cs.visibility, opacity: cs.opacity, pointerEvents: cs.pointerEvents,
        zIndex: cs.zIndex, transform: cs.transform, display: cs.display,
      },
      disabled: btn.disabled,
      formState: form?.dataset?.state ?? '',
      formValid: form?.checkValidity?.() ?? null,
      // Which required fields the browser itself considers unsatisfied — the
      // fork between "the click did nothing" and "the client check rejected it".
      invalidFields: [...form.querySelectorAll('input, textarea, select')]
        .filter((f) => !(f as HTMLInputElement).checkValidity())
        .map((f) => (f as HTMLInputElement).name || (f as HTMLInputElement).id),
      runningTransitions: document.getAnimations?.().length ?? null,
      // Anything painted over the page that could intercept a pointer.
      overlays: [...document.querySelectorAll('body *')]
        .filter((e) => {
          const s = getComputedStyle(e);
          return (s.position === 'fixed' || s.position === 'absolute') &&
            s.pointerEvents !== 'none' && s.visibility !== 'hidden' &&
            Number(s.opacity) > 0.01 && (e as HTMLElement).offsetHeight > 40;
        })
        .slice(0, 8)
        .map((e) => `${e.tagName}.${e.className?.toString?.().slice(0, 40)}`),
    };
  });
}

const chain = (page: Page) =>
  page.evaluate(() => (window as unknown as { __chain: Timeline }).__chain ?? []);

async function fillContact(page: Page) {
  await page.fill('#vez', 'Kovács');
  await page.fill('#ker', 'János');
  await page.fill('#em', 'janos@example.com');
  await page.fill('#tl', '+36 30 000 0000');
  await page.fill('#cg', 'Példa Kft.');
  await page.fill('#mj', 'Szeretnék árajánlatot kérni egy új weboldalra.');
  await page.check('input[name="adatvedelem_elfogadva"]');
}

test.describe.configure({ timeout: 120_000 });

test('lead 422 contract — full event chain', async ({ page }, info) => {
  const record: Record<string, unknown> = {
    project: info.project.name,
    repeat: info.repeatEachIndex,
    workerIndex: info.workerIndex,
    startedAt: new Date().toISOString(),
  };

  await instrument(page);

  let routeSeen = false;
  await page.route('**/api/lead', async (route) => {
    routeSeen = true;
    record.routeHitAt = Date.now();
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false, code: 'VALIDATION_FAILED',
        message: 'Please check the highlighted fields.',
        errors: { email: 'That email address does not look right.' },
      }),
    });
  });

  const navStart = Date.now();
  await page.goto('/ugyfelszolgalat.html');
  record.navMs = Date.now() - navStart;

  // §15: the state of the world immediately before the interaction, and again
  // immediately before the click, because filling seven fields is itself time
  // in which a transition can start.
  record.hitTestBeforeFill = await hitTest(page);
  await fillContact(page);
  record.hitTestBeforeClick = await hitTest(page);

  const clickAt = Date.now();
  record.clickRequestedAt = clickAt;
  await page.getByRole('button', { name: 'Küldés' }).click();
  record.clickReturnedMs = Date.now() - clickAt;

  // The two assertions of the real contract, timed separately so a report can
  // say WHICH of them was not reached.
  const st = page.locator('.form__status');
  let attrMs: number | null = null;
  let textMs: number | null = null;
  let outcome = 'PASS';
  try {
    await expect(st).toHaveAttribute('data-state', 'invalid', { timeout: 15_000 });
    attrMs = Date.now() - clickAt;
    await expect(st).toHaveText(/does not look right/i, { timeout: 15_000 });
    textMs = Date.now() - clickAt;
  } catch (err) {
    outcome = 'FAIL';
    record.error = String((err as Error).message).split('\n').slice(0, 8).join('\n');
  }

  record.outcome = outcome;
  record.attrMs = attrMs;
  record.textMs = textMs;
  record.routeSeen = routeSeen;
  record.chain = await chain(page);
  record.finalState = await page.evaluate(() => ({
    form: (document.querySelector('form[data-lead="contact"]') as HTMLElement)?.dataset?.state ?? null,
    note: (document.querySelector('.form__status') as HTMLElement)?.dataset?.state ?? null,
    text: document.querySelector('.form__status')?.textContent?.slice(0, 120) ?? null,
  }));
  record.hitTestAfter = await hitTest(page);

  /* §21: name the LAST CONFIRMED EVENT rather than letting the reader infer a
     boundary from the test's title. Ordered from latest to earliest, so the
     first match is the furthest the chain actually got. */
  const kinds = new Set((record.chain as Timeline).map((c) => c.kind));
  record.lastConfirmedEvent =
    (record.finalState as any)?.note === 'invalid' && textMs ? 'assertion-satisfied'
    : kinds.has('fetch:response') ? 'response received'
    : kinds.has('fetch:request') ? 'request sent'
    : kinds.has('state:form') ? 'controller entered (state changed)'
    : kinds.has('event:submit-bubble') ? 'submit dispatched'
    : kinds.has('event:click') ? 'click delivered'
    : kinds.has('event:pointerdown') ? 'pointerdown delivered'
    : kinds.has('DOMContentLoaded') ? 'document parsed, no input delivered'
    : 'nothing recorded';

  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, `${info.project.name}-r${info.repeatEachIndex}-w${info.workerIndex}-${Date.now()}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  );

  expect(outcome, `chain stopped at: ${record.lastConfirmedEvent}`).toBe('PASS');
});
