import { test, expect, type Page } from '@playwright/test';

/**
 * The v2 shell — header, sheet, footer and the light/arrival states — on the
 * homepage, the one route that carries it so far (SHELL_V2_ROUTES in
 * _build/build.py).
 *
 * It replaces homepage-chrome.spec.ts, which tested the flight deck on the
 * WebGL homepage: deck states driven by the journey's altitude, the
 * full-screen menu over a canvas, "return to 0 m". None of that is on the
 * homepage any more. The questions that outlive it — does the navigation open
 * and close cleanly, does focus go where it should, is the page behind it out
 * of reach, does every link resolve, does it fit — are asked of the new shell
 * here, and of the deck where it still lives (the subpages) at the end.
 *
 * Runs on the HARDENING projects as well (desktop WebKit, portrait Chromium):
 * a menu's focus behaviour is exactly the thing the two engines disagree about.
 */

/**
 * Scroll the page to its end in reading-sized steps, the way a visitor does, so
 * anything that waits to be seen has been seen. By script rather than the
 * wheel: mobile WebKit has no wheel to emulate.
 */
async function readToTheEnd(page: Page) {
  await page.evaluate(async () => {
    const step = Math.round(innerHeight * 0.6);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
  });
  await page.waitForTimeout(500);
}

const PHONE = { width: 390, height: 844 };

async function openSheet(page: Page) {
  await page.setViewportSize(PHONE);
  await page.goto('/index.html');
  const trigger = page.locator('.hdr__menu');
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.locator('#hdr-sheet')).toBeVisible();
  return trigger;
}

test.describe('the header', () => {
  test('wide screens show four destinations, the languages and one action', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/index.html');
    const links = page.locator('.hdr__nav a');
    await expect(links).toHaveCount(4);
    await expect(links).toHaveText(['Munkáink', 'Szolgáltatások', 'Rólunk', 'Blog']);
    await expect(page.locator('.hdr__cta')).toHaveAttribute('href', '/arajanlat.html');
    await expect(page.locator('.hdr__end .lang a')).toHaveCount(3);
    await expect(page.locator('.hdr__end .lang a[aria-current]')).toHaveText('HU');
    await expect(page.locator('.hdr__menu')).toBeHidden();
  });

  test('it holds still: no hiding, no resizing, a hairline once the page moves', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/index.html');
    const box = page.locator('.hdr__box');
    const before = await box.boundingBox();
    await expect(page.locator('.hdr')).not.toHaveClass(/is-scrolled/);
    await page.evaluate(() => window.scrollBy(0, 1600));
    await expect(page.locator('.hdr')).toHaveClass(/is-scrolled/);
    const after = await box.boundingBox();
    expect(after?.height).toBe(before?.height);
    expect(after?.y).toBe(before?.y);
  });

  test('the brand leads home and every header link resolves', async ({ page, request }) => {
    await page.goto('/index.html');
    await expect(page.locator('.hdr .brand')).toHaveAttribute('href', '/');
    const hrefs = await page.locator('.hdr a[href^="/"]').evaluateAll((as) =>
      [...new Set(as.map((a) => a.getAttribute('href') as string))]);
    expect(hrefs.length).toBeGreaterThan(10);
    for (const href of hrefs) {
      const res = await request.get(href);
      expect(res.status(), href).toBeLessThan(400);
    }
  });
});

test.describe('the sheet', () => {
  test('opens from the trigger, names itself, and locks the page under it', async ({ page }) => {
    const trigger = await openSheet(page);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(trigger).toHaveAttribute('aria-controls', 'hdr-sheet');
    await expect(page.locator('html')).toHaveClass(/is-locked/);
    // The page behind is out of reach, not merely covered.
    expect(await page.evaluate(() => document.getElementById('main')?.inert)).toBe(true);
    expect(await page.evaluate(() => (document.querySelector('.ftr') as HTMLElement | null)?.inert)).toBe(true);
    // Focus lands inside the navigation, not on the page behind it.
    expect(await page.evaluate(() => !!document.activeElement?.closest('#hdr-sheet'))).toBe(true);
  });

  test('Escape closes it and focus goes back to the trigger', async ({ page }) => {
    const trigger = await openSheet(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#hdr-sheet')).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
    await expect(page.locator('html')).not.toHaveClass(/is-locked/);
    expect(await page.evaluate(() => document.getElementById('main')?.inert)).toBe(false);
  });

  test('a tap outside the box closes it', async ({ page }) => {
    await openSheet(page);
    await page.mouse.click(PHONE.width / 2, PHONE.height - 20);
    await expect(page.locator('#hdr-sheet')).toBeHidden();
  });

  test('the trigger closes it, and says so while it is open', async ({ page }) => {
    const trigger = await openSheet(page);
    await expect(trigger).toHaveAttribute('aria-label', 'Bezárás');
    await trigger.click();
    await expect(page.locator('#hdr-sheet')).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-label', 'Menü megnyitása');
  });

  test('growing past the breakpoint closes it rather than stranding a locked page', async ({ page }) => {
    await openSheet(page);
    await page.setViewportSize({ width: 1280, height: 844 });
    await expect(page.locator('html')).not.toHaveClass(/is-locked/);
    expect(await page.evaluate(() => document.getElementById('main')?.inert)).toBe(false);
  });

  test('its destinations are ordinary links and they navigate', async ({ page }) => {
    await openSheet(page);
    await page.locator('#hdr-sheet a', { hasText: 'Munkáink' }).click();
    await expect(page).toHaveURL(/\/munkaink(\.html)?$/);
  });
});

test.describe('the footer', () => {
  test('carries the lead form, NAP, the four profiles, legal links and the consent switch', async ({ page }) => {
    await page.goto('/index.html');
    const ftr = page.locator('footer.ftr');
    await expect(ftr).toHaveCount(1);
    const form = ftr.locator('form[data-lead="newsletter"]');
    await expect(form.locator('input[type="email"][name="email"][required]')).toHaveCount(1);
    await expect(form.locator('.hp input[name="company_website"]')).toHaveCount(1);
    await expect(form.locator('.form__note[role="status"]')).toHaveCount(1);
    await expect(ftr.locator('address')).toContainText('9027 Győr, Gesztenyefa út 4.');
    await expect(ftr.locator('address')).toContainText('9151 Abda, Arany János utca 13.');
    for (const profile of ['linkedin.com/company/stratos-media-agency', 'instagram.com/stratosweb',
      'facebook.com/profile.php?id=61590329356257', 'maps.google.com/?cid=2524074190501925711']) {
      await expect(ftr.locator(`a[href*="${profile}"]`), profile).toHaveCount(1);
    }
    await expect(ftr.locator('a[href="/adatkezelesi-tajekoztato.html"]')).toHaveCount(1);
    await expect(ftr.locator('a[href="/impresszum.html"]')).toHaveCount(1);
    await expect(ftr.locator('[data-consent-settings]')).toHaveCount(1);
    // The regional pages are Hungarian only, and so is their link.
    await expect(ftr.locator('a[href="/weboldal-keszites-gyor.html"]')).toHaveCount(1);
    await expect(ftr.locator('a[href="/weboldal-keszites-budapest.html"]')).toHaveCount(1);
  });

  test('every footer link resolves', async ({ page, request }) => {
    await page.goto('/index.html');
    const hrefs = await page.locator('footer.ftr a[href^="/"]').evaluateAll((as) =>
      [...new Set(as.map((a) => a.getAttribute('href') as string))]);
    expect(hrefs.length).toBeGreaterThan(15);
    for (const href of hrefs) {
      const res = await request.get(href);
      expect(res.status(), href).toBeLessThan(400);
    }
  });

  for (const [path, word] of [['/en/index.html', 'Pages'], ['/de/index.html', 'Seiten']] as const) {
    test(`speaks the page's language at ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('footer.ftr .ftr__h').first()).toHaveText(word);
      await expect(page.locator('footer.ftr a[href="/weboldal-keszites-gyor.html"]')).toHaveCount(0);
    });
  }
});

test.describe('light and arrival', () => {
  test('nothing above the fold is ever dimmed or held back', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForLoadState('load');
    const held = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.is-pre, .is-dim'))
        .filter((el) => el.getBoundingClientRect().top < innerHeight * 0.9).length);
    expect(held).toBe(0);
  });

  test('everything is lit and revealed when it is the thing being read', async ({ page }) => {
    // The guarantee is about what is ON SCREEN: an element that a fast fling
    // carried past its trigger while it was off screen is allowed to wait, and
    // lights the moment it comes back. So each one is brought to the middle of
    // the viewport, the way a reader stops on it, and must then be present.
    await page.goto('/index.html');
    const targets = page.locator('[data-reveal], [data-light]');
    const n = await targets.count();
    expect(n).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < n; i++) {
      await targets.nth(i).evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await expect(targets.nth(i), `scene element ${i}`).not.toHaveClass(/\bis-(pre|dim)\b/);
    }
  });

  test('a jump straight to the end leaves nothing dark behind it', async ({ page }) => {
    await page.goto('/index.html');
    await page.evaluate(() => window.scrollTo(0, document.querySelector('.ways')!.getBoundingClientRect().top + scrollY));
    await page.waitForTimeout(400);
    const dim = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.is-dim'))
        .filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight * 0.6; }).length);
    expect(dim).toBe(0);
  });
});

test.describe('it fits', () => {
  for (const size of [
    { width: 375, height: 812 }, { width: 390, height: 844 }, { width: 430, height: 932 },
    { width: 1440, height: 900 }, { width: 1728, height: 1117 },
  ]) {
    test(`no sideways scroll and no clipped headline at ${size.width}×${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      for (const path of ['/index.html', '/en/index.html', '/de/index.html']) {
        await page.goto(path);
        const m = await page.evaluate(() => {
          const h1 = document.querySelector('.hero__m')!.getBoundingClientRect();
          const box = document.querySelector('.hdr__box')!.getBoundingClientRect();
          return {
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            h1Right: h1.right, header: [box.left, box.right], vw: document.documentElement.clientWidth,
          };
        });
        expect(m.overflow, `${path} sideways`).toBeLessThanOrEqual(1);
        expect(m.h1Right, `${path} headline`).toBeLessThanOrEqual(m.vw);
        expect(m.header[0], `${path} header left`).toBeGreaterThanOrEqual(0);
        expect(m.header[1], `${path} header right`).toBeLessThanOrEqual(m.vw);
      }
    });
  }
});

test.describe('one shell on every page', () => {
  // Since the whole site moved to the v2 shell there is one header and one
  // footer. The questions the old deck tests asked of the subpages are asked of
  // this one, on a subpage.
  test('a subpage carries the same header, marking where you are', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/munkaink.html');
    await expect(page.locator('.hdr .brand')).toHaveAttribute('href', '/');
    await expect(page.locator('.hdr__nav a[aria-current="page"]')).toHaveText('Munkáink');
    await expect(page.locator('footer.ftr form[data-lead="newsletter"]')).toHaveCount(1);
    await expect(page.locator('.nav, #menu, .rail, .arrival, .plane-cursor, canvas')).toHaveCount(0);
  });

  test('the sheet opens on a subpage and Escape returns focus to its trigger', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/kkv.html');
    const trigger = page.locator('.hdr__menu');
    await trigger.click();
    await expect(page.locator('#hdr-sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
  });
});

test.describe('the cursor', () => {
  // The logo's paper plane (owner, 2026-10-16). Native everywhere as the
  // fallback; for a mouse, a plane that turns the way it flies. Asked on every
  // project, because the answer depends on the device: a touch screen and a
  // reader who asked for reduced motion get the static one and no element.
  const transform = (page: Page) =>
    page.locator('.cursor-plane').evaluate((el) => (el as HTMLElement).style.transform);
  const rotation = (t: string) => Number(/rotate\((-?[\d.]+)deg\)/.exec(t)?.[1]);
  const flip = (t: string) => Number(/scale\([\d.]+,\s*(-?[\d.]+)\)/.exec(t)?.[1]);

  test('the plane flies the way the pointer moves, and steps aside for a caret', async ({ page }) => {
    await page.goto('/ugyfelszolgalat.html');
    const env = await page.evaluate(() => ({
      fine: matchMedia('(hover: hover) and (pointer: fine)').matches,
      reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
    }));
    if (!env.fine || env.reduce) {
      await page.waitForTimeout(300);
      await expect(page.locator('.cursor-plane'), 'no moving plane without a mouse, or on reduced motion').toHaveCount(0);
      return;
    }
    // The native plane is the cursor until the element takes over.
    expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).toContain('cursor-plane');

    await page.mouse.move(300, 500);
    await page.mouse.move(700, 500, { steps: 14 });
    await expect(page.locator('html')).toHaveClass(/has-plane/);
    await expect.poll(async () => Math.abs(rotation(await transform(page)) - 35), { message: 'east: the art turned 35° down to level' }).toBeLessThan(4);
    expect(flip(await transform(page)), 'east: upright').toBeGreaterThan(0.9);
    expect(await page.evaluate(() => getComputedStyle(document.body).cursor), 'one cursor at a time').toBe('none');

    await page.mouse.move(300, 500, { steps: 14 });
    await expect.poll(async () => flip(await transform(page)), { message: 'west: mirrored, so never upside down' }).toBeLessThan(-0.9);

    const field = page.locator('main input[type="email"], main input[type="text"]').first();
    await field.scrollIntoViewIfNeeded();
    const box = (await field.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 4 });
    await expect(page.locator('.cursor-plane')).toHaveClass(/is-off/);
    expect(await field.evaluate((el) => getComputedStyle(el).cursor), 'fields keep the caret').toBe('text');
  });

  test('on the homepage the plane draws a strip through the clouds, under the header', async ({ page }) => {
    // Owner, 2026-10-17: the plane reveals the cloud texture in thick strips.
    await page.goto('/');
    const env = await page.evaluate(() => ({
      fine: matchMedia('(hover: hover) and (pointer: fine)').matches,
      reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
    }));
    const trail = page.locator('canvas.cloud-trail');
    await page.waitForTimeout(400);
    await expect(trail, 'nothing at all until a mouse moves').toHaveCount(0);
    await page.mouse.move(200, 400);
    await page.mouse.move(260, 420, { steps: 4 });
    if (!env.fine || env.reduce) {
      await page.waitForTimeout(600);
      await expect(trail, 'no strip without a mouse, or on reduced motion').toHaveCount(0);
      return;
    }
    await expect(trail).toHaveCount(1, { timeout: 5000 });
    const style = await trail.evaluate((el) => {
      const cs = getComputedStyle(el);
      const hdr = getComputedStyle(document.querySelector('.hdr')!).zIndex;
      return { below: Number(cs.zIndex) < Number(hdr), blend: cs.mixBlendMode, events: cs.pointerEvents, hidden: el.getAttribute('aria-hidden') };
    });
    // On top of the page, multiplied onto it — not behind it, where Safari's
    // compositor can bury a layer under the page's own background.
    expect(style, 'over the page, under the header, never a target, never read out')
      .toEqual({ below: true, blend: 'multiply', events: 'none', hidden: 'true' });
    // Something is drawn where the plane has just flown, and nothing once it is gone.
    const painted = () => trail.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++;
      return n;
    });
    await page.mouse.move(300, 450);
    await page.mouse.move(900, 450, { steps: 24 });
    await expect.poll(painted, { message: 'a strip behind the plane' }).toBeGreaterThan(0);
    await expect.poll(painted, { message: 'and gone again', timeout: 5000 }).toBe(0);
  });

  test('the plane and its strip come back after the page is left and restored', async ({ page }) => {
    // Owner, 2026-10-17: away to /branding and back, and the effect was gone.
    // A page restored from the back/forward cache can lose a frame it had
    // asked for; both loops are reset on the way out. Simulated here with the
    // page-transition events, as automation does not keep pages in that cache.
    await page.goto('/');
    const env = await page.evaluate(() => ({
      fine: matchMedia('(hover: hover) and (pointer: fine)').matches,
      reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
    }));
    test.skip(!env.fine || env.reduce, 'the plane is for a mouse, and not on reduced motion');
    const fly = async () => { await page.mouse.move(300, 450); await page.mouse.move(900, 470, { steps: 24 }); };
    const painted = () => page.locator('canvas.cloud-trail').evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++;
      return n;
    });
    await fly();
    await expect(page.locator('canvas.cloud-trail')).toHaveCount(1, { timeout: 5000 });
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect(page.locator('html'), 'back with the native plane').not.toHaveClass(/has-plane/);
    await fly();
    await expect(page.locator('html')).toHaveClass(/has-plane/);
    await expect.poll(painted, { message: 'the strip draws again' }).toBeGreaterThan(0);
  });

  test('the strip finds its texture even when the address comes back CSS-escaped', async ({ page }) => {
    // Owner, 2026-10-17: no strip at all in Safari 26.6. Safari serialises the
    // custom property's url() with escapes — `url(\\/assets\\/img\\/…\\.webp)` —
    // and the image at that literal address failed. Reproduced here by writing
    // the address escaped in the CSS itself, which every engine hands back as
    // written.
    await page.route('**/', async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const res = await route.fetch();
      const html = (await res.text()).replace(
        /--cloud-trail:\s*url\(\/assets\/img\/home-clouds-trail\.webp\)/,
        '--cloud-trail:url(\\/assets\\/img\\/home-clouds-trail\\.webp)',
      );
      expect(html, 'the page names its trail as the test expects').toContain('home-clouds-trail\\.webp');
      await route.fulfill({ response: res, body: html });
    });
    await page.goto('/');
    const env = await page.evaluate(() => ({
      fine: matchMedia('(hover: hover) and (pointer: fine)').matches,
      reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
    }));
    test.skip(!env.fine || env.reduce, 'the plane is for a mouse, and not on reduced motion');
    const asked: string[] = [];
    page.on('request', (r) => { if (/home-clouds-trail/.test(r.url())) asked.push(new URL(r.url()).pathname); });
    await page.mouse.move(300, 450);
    await page.mouse.move(900, 470, { steps: 24 });
    await expect(page.locator('canvas.cloud-trail')).toHaveCount(1, { timeout: 5000 });
    expect(asked, 'the texture is asked for at its real address').toContain('/assets/img/home-clouds-trail.webp');
  });

  test('a subpage has no strip: only the homepage names a cloud trail', async ({ page }) => {
    await page.goto('/munkaink.html');
    await page.mouse.move(300, 400);
    await page.mouse.move(700, 420, { steps: 8 });
    await page.waitForTimeout(800);
    await expect(page.locator('canvas.cloud-trail')).toHaveCount(0);
  });
});

test.describe('the smooth wheel', () => {
  // Owner, 2026-10-17, after immersive-g.com: a wheel glides instead of
  // stepping, and an uneven finger still draws one smooth curve.
  test('a wheel glides to where it was sent; anything else still moves the page at once', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/munkaink.html');
    const env = await page.evaluate(() => ({
      fine: matchMedia('(hover: hover) and (pointer: fine)').matches,
      reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
    }));
    test.skip(!env.fine, 'wheels are for a mouse or a trackpad');
    await page.mouse.move(700, 450);
    await page.mouse.wheel(0, 600);
    const early = await page.evaluate(() => new Promise<number>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(scrollY)))));
    if (!env.reduce) expect(early, 'a glide, not a jump').toBeLessThan(450);
    await expect.poll(() => page.evaluate(() => Math.round(scrollY)), { message: 'arrives where it was sent' }).toBeGreaterThan(590);
    // Anything else wins: a script (as the keyboard, an anchor or the scrollbar would).
    await page.mouse.wheel(0, 800);
    await page.evaluate(() => window.scrollTo(0, 120));
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => Math.round(scrollY)), 'the glide yields').toBeLessThan(140);
  });
});
