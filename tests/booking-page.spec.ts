import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * The public booking page (/idopontfoglalas, /en/book-a-call,
 * /de/termin-buchen; assets/js/booking.js) on the built site, with
 * /api/booking answered by the test: the free times by day, the form, the
 * confirmation with Google's invitation and the guest's private link, a time
 * taken meanwhile, booking unavailable, the guest's own booking (cancel and
 * move), and the English and German pages. The function itself is
 * tests/booking.spec.ts.
 */

const ZONE = 'Europe/Budapest';
const TOKEN = 'a'.repeat(32);

/** Free times from two days ahead: five days, every 30 minutes from 9:00 to 12:00 Budapest. */
function freeSlots() {
  const out: { start: string; end: string }[] = [];
  for (let d = 2; d < 7; d += 1) {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(Date.now() + d * 864e5));
    const offset = Number(new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', hourCycle: 'h23' }).format(new Date(`${day}T12:00:00Z`))) - 12;
    for (let m = 9 * 60; m + 30 <= 12 * 60; m += 30) {
      const start = new Date(Date.parse(`${day}T00:00:00Z`) + (m - offset * 60) * 60_000);
      out.push({ start: start.toISOString(), end: new Date(start.getTime() + 30 * 60_000).toISOString() });
    }
  }
  return out;
}

type Api = { gets: number; posts: Record<string, unknown>[]; answer: (body: Record<string, unknown>) => { status: number; body: unknown } };
async function fakeApi(page: Page, opts: { get?: { status: number; body: unknown }; post?: Api['answer'] } = {}): Promise<Api> {
  const api: Api = {
    gets: 0, posts: [],
    answer: opts.post ?? ((b) => ({ status: 200, body: { ok: true, booking: {
      id: 'bk-1', start: b.start, end: new Date(Date.parse(String(b.start)) + 30 * 60_000).toISOString(), timeZone: ZONE, minutes: 30, status: 'confirmed',
      meetUrl: 'https://meet.google.com/abc-defg-hij', email: b.email, manageUrl: `https://stratosweb.hu/idopontfoglalas#m=${TOKEN}`, canChange: true } } })),
  };
  await page.route('**/api/booking*', async (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      api.gets += 1;
      const g = opts.get ?? { status: 200, body: { ok: true, timeZone: ZONE, minutes: 30, options: [30], changeHours: 12, slots: freeSlots() } };
      return route.fulfill({ status: g.status, contentType: 'application/json', body: JSON.stringify(g.body) });
    }
    const body = JSON.parse(req.postData() || '{}');
    api.posts.push(body);
    const a = api.answer(body);
    return route.fulfill({ status: a.status, contentType: 'application/json', body: JSON.stringify(a.body) });
  });
  return api;
}

const budapest = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

test('books a free time: the days and times from the calendar, the form, then Google\'s invitation and the private link', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const api = await fakeApi(page);
  await page.goto('/idopontfoglalas.html');
  const days = page.locator('[data-booking-days] .booking__day');
  await expect(days).toHaveCount(5);
  await expect(days.first()).toHaveAttribute('aria-pressed', 'true');
  await days.nth(1).click();
  await expect(days.nth(1)).toHaveAttribute('aria-pressed', 'true');
  const times = page.locator('[data-booking-times] .booking__time');
  await expect(times).toHaveCount(6);
  await expect(times.first()).toHaveText('09:00');
  // The row of days scrolls by itself; the page never does.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const box = await times.nth(1).boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const chosen = freeSlots()[6];
  await times.first().click();

  const form = page.locator('[data-booking-form]');
  await expect(form).toBeVisible();
  await expect(page.locator('[data-booking-chosen]')).toContainText('09:00–09:30');
  await expect(page.locator('#bk-name')).toBeFocused();
  // Nothing filled in: told what is missing, nothing sent.
  await form.getByRole('button', { name: 'Lefoglalom' }).click();
  await expect(page.locator('[data-booking-form-state]')).toHaveText('Nézd át a megjelölt mezőket.');
  await expect(page.locator('#bk-name')).toHaveAttribute('aria-invalid', 'true');
  expect(api.posts).toEqual([]);

  await page.locator('#bk-name').fill('Kovács Anna');
  await page.locator('#bk-email').fill('anna@kert.example');
  await page.locator('#bk-company').fill('Kert Kft.');
  await page.locator('#bk-topic').fill('Új webshop a kertészetnek');
  await form.locator('input[name="consent"]').check();
  await form.getByRole('button', { name: 'Lefoglalom' }).click();

  const done = page.locator('[data-booking-done]');
  await expect(done).toBeVisible({ timeout: 10_000 });
  await expect(done.getByRole('heading', { name: 'Lefoglaltuk.' })).toBeVisible();
  await expect(page.locator('[data-booking-done-email]')).toHaveText('anna@kert.example');
  await expect(page.locator('[data-booking-meet-link]')).toHaveAttribute('href', 'https://meet.google.com/abc-defg-hij');
  await expect(page.locator('[data-booking-manage-link]')).toHaveAttribute('href', `https://stratosweb.hu/idopontfoglalas#m=${TOKEN}`);
  await expect(page.locator('[data-booking-done-when]')).toContainText('09:00–09:30');

  expect(api.posts).toHaveLength(1);
  const sent = api.posts[0];
  expect(sent).toMatchObject({ action: 'book', start: chosen.start, minutes: 30, name: 'Kovács Anna', email: 'anna@kert.example', company: 'Kert Kft.',
    topic: 'Új webshop a kertészetnek', consent: true, locale: 'hu', company_website: '' });
  expect(sent.elapsedMs as number).toBeGreaterThanOrEqual(3000);
  expect(budapest(String(sent.start))).toBe('09:00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('a time taken meanwhile: the guest is told, and the free times are asked for again', async ({ page }) => {
  test.slow();
  const api = await fakeApi(page, { post: () => ({ status: 409, body: { ok: false, code: 'TAKEN' } }) });
  await page.goto('/idopontfoglalas.html');
  await page.locator('[data-booking-times] .booking__time').first().click();
  await page.locator('#bk-name').fill('Kovács Anna');
  await page.locator('#bk-email').fill('anna@kert.example');
  await page.locator('#bk-topic').fill('Weboldal');
  await page.locator('[data-booking-form] input[name="consent"]').check();
  await page.locator('[data-booking-form]').getByRole('button', { name: 'Lefoglalom' }).click();
  await expect(page.locator('[data-booking-state]')).toHaveText('Ezt az időpontot közben lefoglalták. Válassz egy másikat.', { timeout: 10_000 });
  await expect(page.locator('[data-booking-form]')).toBeHidden();
  expect(api.gets).toBe(2);
});

for (const [why, get] of [
  ['Google not connected yet', { status: 503, body: { ok: false, code: 'CALENDAR_NOT_CONNECTED' } }],
  ['no booking function on this server (a local preview)', { status: 404, body: {} }],
] as const) {
  test(`booking unavailable (${why}): said plainly, not as a fault, with the way to the contact page`, async ({ page }) => {
    await fakeApi(page, { get });
    await page.goto('/idopontfoglalas.html');
    const state = page.locator('[data-booking-state]');
    await expect(state).toHaveText('Az online foglalás most nem elérhető. Írj nekünk, és egyeztetünk időpontot. Üzenet küldése');
    await expect(state).not.toHaveAttribute('data-state', 'error');
    await expect(state.getByRole('link', { name: 'Üzenet küldése' })).toHaveAttribute('href', /ugyfelszolgalat/);
    await expect(page.locator('[data-booking-days] .booking__day')).toHaveCount(0);
  });
}

test('a real fault (the server failed) is said as one, and offers the contact page too', async ({ page }) => {
  await fakeApi(page, { get: { status: 500, body: { ok: false, code: 'FAILED' } } });
  await page.goto('/idopontfoglalas.html');
  const state = page.locator('[data-booking-state]');
  await expect(state).toHaveText('Nem sikerült betölteni az időpontokat. Próbáld újra kicsit később. Üzenet küldése');
  await expect(state).toHaveAttribute('data-state', 'error');
});

test('the guest\'s link: shows the booking; cancelling takes a second click; moving picks a new time', async ({ page }) => {
  const slots = freeSlots();
  const booking = { id: 'bk-1', start: slots[0].start, end: slots[0].end, timeZone: ZONE, minutes: 30, status: 'confirmed', meetUrl: null, name: 'Kovács Anna', canChange: true };
  const api = await fakeApi(page, {
    post: (b) => {
      if (b.action === 'manage') return { status: 200, body: { ok: true, booking, changeHours: 12, timeZone: ZONE, slots: slots.slice(1) } };
      if (b.action === 'move') return { status: 200, body: { ok: true, booking: { ...booking, start: b.start, end: new Date(Date.parse(String(b.start)) + 30 * 60_000).toISOString() } } };
      if (b.action === 'cancel') return { status: 200, body: { ok: true } };
      return { status: 400, body: { ok: false } };
    },
  });
  await page.goto(`/idopontfoglalas.html#m=${TOKEN}`);
  const manage = page.locator('[data-booking-manage]');
  await expect(manage).toBeVisible();
  await expect(page.locator('[data-booking-manage-when]')).toContainText(`${budapest(slots[0].start)}–${budapest(slots[0].end)}`);
  await expect(page.locator('[data-booking-pick]')).toBeHidden();
  expect(api.gets).toBe(0);
  expect(api.posts[0]).toEqual({ action: 'manage', token: TOKEN });

  // Move: the free times appear, one is chosen.
  await manage.getByRole('button', { name: 'Másik időpontra teszem' }).click();
  await expect(page.locator('[data-booking-pick]')).toBeVisible();
  await page.locator('[data-booking-days] .booking__day').nth(2).click();
  await page.locator('[data-booking-times] .booking__time').first().click();
  await expect(page.locator('[data-booking-manage-state]')).toHaveText('Áthelyeztük. A Google elküldi a frissített meghívót.');
  const moved = api.posts.find((p) => p.action === 'move')!;
  expect(moved).toEqual({ action: 'move', token: TOKEN, start: slots[12].start });
  await expect(page.locator('[data-booking-pick]')).toBeHidden();

  // Cancel: the first click only asks.
  await manage.getByRole('button', { name: 'Lemondom' }).click();
  await expect(page.locator('[data-booking-manage-state]')).toHaveText('Biztosan lemondod? Kattints még egyszer a Lemondom gombra.');
  expect(api.posts.some((p) => p.action === 'cancel')).toBe(false);
  await manage.getByRole('button', { name: 'Lemondom' }).click();
  await expect(page.locator('[data-booking-manage-state]')).toHaveText('Lemondtuk. A Google értesítést küld róla, és az időpont felszabadult.');
  await expect(page.locator('[data-booking-manage-note]')).toHaveText('Ez a foglalás le van mondva.');
  await expect(page.locator('[data-booking-manage-actions]')).toBeHidden();
});

test('a link that matches no booking says so', async ({ page }) => {
  await fakeApi(page, { post: () => ({ status: 404, body: { ok: false, code: 'NOT_FOUND' } }) });
  await page.goto(`/idopontfoglalas.html#m=${TOKEN}`);
  await expect(page.locator('[data-booking-manage-note]')).toContainText('Ezt a foglalást nem találjuk.');
});

for (const [path, h1, weekday, lang] of [
  ['/en/book-a-call.html', 'thirty minutes', /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/, 'en'],
  ['/de/termin-buchen.html', 'eine halbe Stunde', /^(Mo|Di|Mi|Do|Fr|Sa|So)/, 'de'],
] as const) {
  test(`${lang}: the page is translated and the days are named in its language`, async ({ page }) => {
    await fakeApi(page);
    await page.goto(path);
    await expect(page.locator('h1')).toContainText(h1);
    await expect(page.locator('html')).toHaveAttribute('lang', new RegExp(`^${lang}`));
    await expect(page.locator('.booking__day-w').first()).toHaveText(weekday);
    await page.locator('[data-booking-times] .booking__time').first().click();
    await expect(page.locator('[data-booking-form] button[type="submit"]')).toContainText(lang === 'en' ? 'Book this time' : 'Termin buchen');
  });
}

test('the contact page leads to it, in every language', async ({ page }) => {
  for (const [path, target] of [['/ugyfelszolgalat.html', /idopontfoglalas/], ['/en/contact.html', /\/en\/book-a-call/], ['/de/kontakt.html', /\/de\/termin-buchen/]] as const) {
    await page.goto(path);
    const hrefs = await page.locator('.phead a').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    expect(hrefs.some((h) => target.test(h)), `${path}: ${hrefs.join(', ')}`).toBe(true);
  }
});
