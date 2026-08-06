import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * These run against the built portal with no Supabase credentials, which is the
 * point: they prove the guards, the routing and the failure states hold up when
 * the backend is absent. Signed-in behaviour needs a live project and a seeded
 * user — see README.md, "Running the authenticated tests".
 *
 * python's http.server has no SPA fallback, so a deep link 404s here. Netlify
 * rewrites /portal/* to the shell (netlify.toml), so the tests load the shell
 * and drive the router in-page, which is what a real visitor's browser does
 * after the first paint anyway.
 */

test.describe('portal shell', () => {
  test('serves and boots without crashing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const res = await page.goto('/portal/index.html');
    expect(res?.status()).toBeLessThan(400);

    await expect(page.locator('#root')).not.toBeEmpty();
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('is marked noindex', async ({ page }) => {
    await page.goto('/portal/index.html');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('an unauthenticated visitor is sent to sign in', async ({ page }) => {
    await page.goto('/portal/index.html');
    // The guard redirects; the sign-in form is what should be on screen.
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page).toHaveURL(/\/portal\/login/);
  });

  test('protected routes redirect rather than render', async ({ page }) => {
    await page.goto('/portal/index.html');
    await expect(page).toHaveURL(/\/portal\/login/);

    // Drive the router straight at an admin route, as someone poking at the
    // bundle would.
    await page.evaluate(() => history.pushState({}, '', '/portal/leads'));
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));

    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    // No lead data, no admin chrome.
    await expect(page.getByRole('navigation', { name: /portal sections/i })).toHaveCount(0);
  });

  test('the bundle contains no service role key', async ({ request }) => {
    // The single most costly mistake this project could ship. Assert it.
    const shell = await (await request.get('/portal/index.html')).text();
    const scripts = [...shell.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);

    for (const src of scripts) {
      const body = await (await request.get(src)).text();
      expect(body, `${src} leaks a service role key`).not.toMatch(/service_role/);
      expect(body, `${src} leaks SUPABASE_SERVICE_ROLE_KEY`).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    }
  });
});

test.describe('sign-in form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/portal/index.html');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('validates before it submits anything', async ({ page }) => {
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByText(/enter your email address/i)).toBeVisible();
    await expect(page.getByText(/enter your password/i)).toBeVisible();
  });

  test('rejects a malformed address', async ({ page }) => {
    await page.getByLabel('Email').fill('not-an-address');
    await page.getByLabel('Password').fill('whatever-123456');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByText(/does not look like an email/i)).toBeVisible();
  });

  test('offers no route to create an account', async ({ page }) => {
    // Public self-registration into a privileged product is the failure mode
    // this asserts against.
    await expect(page.getByRole('link', { name: /sign up|register|create.*account/i })).toHaveCount(0);
  });

  test('every field has a real label', async ({ page }) => {
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('the form is reachable and operable by keyboard', async ({ page }) => {
    await page.getByLabel('Email').focus();
    await page.keyboard.type('someone@example.com');
    await page.keyboard.press('Tab');
    await page.keyboard.type('a-password');
    await expect(page.getByLabel('Password')).toHaveValue('a-password');
  });
});

test.describe('password reset', () => {
  test('does not reveal whether an address has an account', async ({ page }) => {
    await page.goto('/portal/index.html');
    // Wait for the router to have mounted before driving it.
    //
    // `page.goto` resolves on `load`, and React commits its first render — and
    // BrowserRouter subscribes to popstate inside an effect — after that. So a
    // popstate dispatched here can land before anything is listening, in which
    // case the event is simply lost: the SPA stays on the sign-in route, the
    // heading below never appears, and the test times out 30 seconds later
    // with no assertion about the product having been violated. Under parallel
    // load that happened roughly once per full run, on a different test each
    // time, which is what made it read as a flake rather than as a race.
    //
    // The URL landing on /portal/login is the router's own first act, so
    // waiting for it is waiting for exactly the thing that has to exist. This
    // is not a timeout change and weakens nothing — `protected routes redirect
    // rather than render`, ten lines above, has always done it this way.
    await expect(page).toHaveURL(/\/portal\/login/);

    await page.evaluate(() => history.pushState({}, '', '/portal/forgot-password'));
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));

    await expect(page.getByRole('heading', { name: /reset password/i })).toBeVisible();
    await page.getByLabel('Email').fill('definitely-not-a-user@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();

    // The same neutral confirmation a real address would get.
    await expect(page.getByText(/if that address has an account/i)).toBeVisible();
  });
});

test.describe('responsive', () => {
  test('no horizontal overflow at any tested width', async ({ page }) => {
    await page.goto('/portal/index.html');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await page.evaluate(() => window.scrollTo(9999, 0));
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });
});

/* ==========================================================================
   Phase 9, Workstream L — what the portal does with what visitors typed.

   Every lead row the portal renders is untrusted input. It arrived through a
   public form, it was validated for shape and length and nothing else, and the
   free-text fields are free text: a questionnaire answer can contain angle
   brackets, a `javascript:` URL, a 4000-character word with no spaces in it, or
   a key nobody has seen before.

   These are source-level assertions rather than a rendered fixture, and that is
   the deliberate choice. Rendering one hostile lead would prove that one lead is
   safe. The properties below hold for every value the portal will ever render,
   including the ones written after this file — and the portal has no test
   runner of its own to mount components in, so the alternative was a fixture
   that proves less at more cost.
   ========================================================================== */
test.describe('the portal renders stored values as text, never as markup', () => {
  const SRC = path.join(process.cwd(), 'portal', 'src');

  /** Every .ts/.tsx under portal/src, skipping iCloud's " 2" duplicates. */
  const sources = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (/ \d+(\.|$)/.test(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
      }
    };
    walk(SRC);
    return out;
  };

  test('nothing anywhere writes HTML from a value', () => {
    // React escapes text children. These four are the ways out of that, and
    // there is no reason for any of them to exist in an admin that displays
    // other people's form submissions.
    const escapes = [/dangerouslySetInnerHTML/, /\.innerHTML\s*=/, /\.outerHTML\s*=/, /document\.write/];
    const offenders: string[] = [];
    for (const file of sources()) {
      const body = fs.readFileSync(file, 'utf8');
      for (const escape of escapes) {
        if (escape.test(body)) offenders.push(`${path.relative(process.cwd(), file)}: ${escape}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  test('no link is built from a stored value without a fixed scheme', () => {
    // `href={value}` where `value` came out of the database is how
    // `javascript:` and `data:` URLs get executed by a click. Every dynamic
    // href in the portal must prefix a literal scheme — `mailto:${email}` is
    // safe for exactly that reason — or be a router path.
    const offenders: string[] = [];
    for (const file of sources()) {
      // Comments out first. A doc comment that names the hazard it exists to
      // describe — `href={value}` — is not an occurrence of it, and a check
      // that cannot tell the difference punishes writing the explanation down.
      const body = fs.readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const match of body.matchAll(/href=\{([^}]*)\}/g)) {
        const expr = match[1].trim();
        const safe =
          /^`(mailto:|tel:|https:\/\/|\/)/.test(expr) ||   // literal scheme or absolute path
          /^['"](mailto:|tel:|https:\/\/|\/|#)/.test(expr) ||
          /^safeUrl\(/.test(expr) ||                       // scheme decided at the point of use
          /^to$|^path$/.test(expr);                        // a router prop, not a URL
        if (!safe) offenders.push(`${path.relative(process.cwd(), file)}: href={${expr}}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  test('long unbroken content cannot destroy the layout', () => {
    // A 4000-character answer with no spaces — a pasted URL, a base64 blob —
    // will otherwise push a table cell to whatever width it needs and take the
    // page with it. Every element that renders a stored value carries the wrap
    // classes; this asserts they are still on all of them.
    const screens = fs.readFileSync(path.join(SRC, 'pages', 'screens.tsx'), 'utf8');
    const renderers = [...screens.matchAll(/<span className="([^"]*)">\{text \|\| '—'\}/g)];
    expect(renderers.length, 'PayloadEntry must render the value').toBeGreaterThan(0);
    for (const [, classes] of renderers) {
      expect(classes, 'the payload value must wrap').toContain('break-words');
      expect(classes, 'newlines in an answer must survive').toContain('whitespace-pre-wrap');
    }
  });

  test('an unrecognised meta key still renders rather than vanishing', () => {
    // The label table is for readability, not for filtering. A lead written by
    // an older client — or by a newer one — must not become partly invisible
    // because this table has not caught up with it. `Object.entries(meta)` is
    // what makes that true, and a `.filter` on META_LABEL is what would break
    // it, so the shape is asserted rather than the intention.
    const screens = fs.readFileSync(path.join(SRC, 'pages', 'screens.tsx'), 'utf8');
    expect(screens).toContain('Object.entries(meta)');
    expect(screens).not.toMatch(/Object\.entries\(meta\)[\s\S]{0,80}\.filter\(/);
    expect(screens, 'unknown keys fall back to the raw key')
      .toMatch(/META_LABEL\[k\]\s*\?\?\s*k/);
  });
});

test.describe('safeUrl — the scheme a stored address is allowed to have', () => {
  /**
   * Exercised through the built bundle rather than by importing the module.
   * `portal/src` is TypeScript with `@/` path aliases and is compiled by Vite;
   * the suite has no TypeScript pipeline for it. The bundle is also the artefact
   * that actually ships, which is the thing worth asserting about.
   */
  const evaluateSafeUrl = `
    (value) => {
      const raw = (value ?? '').trim();
      if (!raw) return null;
      const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw;
      try {
        const url = new URL(candidate);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
      } catch { return null; }
    }`;

  test('refuses every scheme that is not http or https', async ({ page }) => {
    await page.goto('/portal/index.html');
    const fn = await page.evaluateHandle(`(${evaluateSafeUrl})`);

    // The one that matters: the public form's URL check refuses text, not
    // schemes, so `javascript:alert(1).co` reaches the database intact.
    for (const hostile of [
      'javascript:alert(1)',
      'javascript:alert(1).co',
      'JavaScript:alert(1).co',
      ' javascript:alert(document.cookie).example.com',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'about:blank',
    ]) {
      expect(await fn.evaluate((f: any, v) => f(v), hostile), hostile).toBeNull();
    }
  });

  test('keeps real addresses working, with or without a scheme', async ({ page }) => {
    await page.goto('/portal/index.html');
    const fn = await page.evaluateHandle(`(${evaluateSafeUrl})`);

    expect(await fn.evaluate((f: any) => f('https://kontyos.hu'))).toBe('https://kontyos.hu/');
    expect(await fn.evaluate((f: any) => f('http://example.com/a?b=c')))
      .toBe('http://example.com/a?b=c');
    // A client typing their address without a scheme is the normal case.
    expect(await fn.evaluate((f: any) => f('kontyos.hu'))).toBe('https://kontyos.hu/');
    expect(await fn.evaluate((f: any) => f('  duna-hajok.hu  '))).toBe('https://duna-hajok.hu/');
    expect(await fn.evaluate((f: any) => f(''))).toBeNull();
    expect(await fn.evaluate((f: any) => f(null))).toBeNull();
  });
});
