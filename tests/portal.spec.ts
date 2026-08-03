import { test, expect } from '@playwright/test';

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
