import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { LANGS, bookingReminder, receiptEmail } from '../netlify/functions/newsletter-lib.mjs';
import * as core from '../netlify/functions/newsletter-core.mjs';
import { announce, dispatchBookingReminders, dispatchSeries } from '../netlify/functions/mail-automations.mjs';
import * as lead from '../netlify/functions/submit-lead.mjs';
import { U, freshNewsletterDb, rpcAdapter } from './helpers/newsletter-db';

/**
 * The automatic e-mails (20261019000200_email_automations.sql,
 * netlify/functions/mail-automations.mjs): the receipt after a form, the
 * reminder before a booked call, the welcome series and the announcement of a
 * new article or case study — on a real database (PGlite) with a fake Resend,
 * and the site's list the announcements are read from.
 */

test.describe.configure({ mode: 'serial' });

const ORIGIN = 'https://stratosweb.hu';
type Sent = { path: string; body: any };

test.describe('automatic e-mails', () => {
  let db: PGlite;
  let api: ReturnType<typeof rpcAdapter>;
  const sent: Sent[] = [];
  let feed: unknown = { items: [] };
  const mail = { key: 're_test', from: 'Stratos <hirlevel@stratosweb.hu>', replyTo: 'hello@stratosweb.hu' };
  const realFetch = core.__net.fetch;
  const realPace = core.__pace.ms;
  const realStore = (lead as any).__store.create;
  const realKey = process.env.RESEND_API_KEY;

  test.beforeAll(async () => {
    // Someone already confirmed when the automations arrive: no series for them.
    db = await freshNewsletterDb('', `
      insert into newsletter_subscribers (email, locale, status, confirmed_at, welcome_sent_at)
      values ('early@x.example', 'hu', 'confirmed', now() - interval '4 days', now() - interval '4 days');
    `);
    api = rpcAdapter(db);
    core.__pace.ms = 0;
    process.env.RESEND_API_KEY = 're_test';
    core.__net.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === `${ORIGIN}/assets/data/newsletter-feed.json`) return Response.json(feed);
      sent.push({ path: new URL(url).pathname, body: JSON.parse(String(init.body)) });
      return Response.json({ id: 'em_1' });
    }) as typeof fetch;
    // /api/lead stores into PGlite, so the database can count today's forms.
    (lead as any).__store.create = async () => ({
      insert: async (row: Record<string, any>) => {
        const r = await db.query<{ id: string }>(`insert into leads (name, email, form_type, locale) values ($1, $2, $3, $4) returning id`,
          [row.name, row.email, row.form_type, row.locale]);
        return { data: { id: r.rows[0].id }, error: null };
      },
      findBySubmissionId: async () => ({ data: null, error: null }),
      rpc: (fn: string, args: Record<string, unknown>) => api.rpc(fn, args),
    });
  });
  test.afterAll(() => {
    core.__net.fetch = realFetch;
    core.__pace.ms = realPace;
    (lead as any).__store.create = realStore;
    if (realKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = realKey;
  });

  const submit = (formType: string, fields: Record<string, unknown>, locale = 'hu') =>
    lead.default(new Request(`${ORIGIN}/api/lead`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': `198.51.100.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify({ submissionId: crypto.randomUUID(), formType, locale, route: '/x.html', fields, meta: { elapsedMs: 60_000, botField: '' } }),
    }));
  const SPAM = 'BUY CHEAP PILLS at spam.example';
  const contact = (email: string) => ({
    vezeteknev: SPAM, keresztnev: 'János', email, telefon: '+36 30 000 0000', ceg: SPAM, megjegyzes: SPAM, adatvedelem_elfogadva: 'Igen',
  });

  /* ============================================================ receipts */

  test('a contact form gets "we have it" — in fixed words, nothing the sender typed', async () => {
    expect((await submit('contact', contact('janos@example.com'))).status).toBe(200);
    expect(sent).toHaveLength(1);
    const m = sent[0].body;
    expect(sent[0].path).toBe('/emails');
    expect(m).toMatchObject({ from: 'Stratos <portal@stratosweb.hu>', reply_to: 'hello@stratosweb.hu', to: ['janos@example.com'], subject: 'Megkaptuk az üzeneted — Stratos' });
    expect(`${m.html}${m.text}${m.subject}`).not.toContain('PILLS');
    expect(m.text).toContain(`${ORIGIN}/idopontfoglalas.html`);
    expect(m.text).toContain('egy munkanapon belül');
  });

  test('one per address per day; the newsletter form gets none', async () => {
    await submit('contact', contact('janos@example.com'));
    expect(sent).toHaveLength(1);
    await submit('newsletter', { email: 'reader@example.com' });
    // Only the double opt-in e-mail, no receipt.
    expect(sent.slice(1).map((s) => s.body.subject)).toEqual(['Erősítsd meg a feliratkozásod — Stratos hírlevél']);
    // A day later the same address is welcome again.
    await db.query(`update leads set created_at = now() - interval '25 hours' where email = 'janos@example.com'`);
    const before = sent.length;
    await submit('contact', contact('janos@example.com'));
    expect(sent.length).toBe(before + 1);
  });

  test('the questionnaire (German) and the Impact application (its "mail" field) get theirs', async () => {
    const before = sent.length;
    await submit('questionnaire', {
      cegnev: 'Beispiel GmbH', kitolto: 'Anna Muster', email: 'anna@beispiel.de', telefon: '+49 30 000000', agazat: 'kkv',
      answers: [{ q: 'Wie heißt das Unternehmen?', a: SPAM }],
    }, 'de');
    await submit('impact', {
      org: 'Példa Alapítvány', kapcs: 'Nagy Anna', mail: 'anna@example.org', tel: '+36 30 111 2222', web: 'https://pelda.hu',
      terulet: 'Mentális egészség', mivel: SPAM, hatas: SPAM, miert: SPAM, adatkezeles_elfogadva: 'Igen',
    }, 'en');
    const [q, i] = sent.slice(before).map((s) => s.body);
    expect(q).toMatchObject({ to: ['anna@beispiel.de'], subject: 'Ihre Angebotsanfrage ist angekommen — Stratos' });
    expect(q.text).toContain(`${ORIGIN}/de/termin-buchen.html`);
    expect(i).toMatchObject({ to: ['anna@example.org'], subject: 'We have your application — Stratos Impact Program' });
    expect(i.text).toContain(`${ORIGIN}/en/impact-program.html`);
    for (const m of [q, i]) expect(`${m.html}${m.text}`).not.toContain('PILLS');
  });

  /* ================================================ booking reminders */

  test('a call starting within a day gets ONE reminder — not if the time was set less than 25 hours before', async () => {
    await db.exec(`
      insert into bookings (kind, starts_at, ends_at, guest_name, guest_email, locale, meet_url, scheduled_at) values
        ('public', now() + interval '20 hours', now() + interval '20 hours 30 minutes', 'Anna', 'due@x.example', 'de',
         'https://meet.google.com/abc-defg-hij', now() - interval '3 days'),
        ('public', now() + interval '21 hours', now() + interval '21 hours 30 minutes', 'Béla', 'late@x.example', 'hu',
         'https://meet.google.com/abc-defg-hik', now() - interval '2 hours'),
        ('public', now() + interval '3 days', now() + interval '3 days 30 minutes', 'Cili', 'far@x.example', 'hu',
         null, now() - interval '3 days');
    `);
    const before = sent.length;
    expect(await dispatchBookingReminders(api, mail, { origin: ORIGIN })).toEqual({ reminders: 1 });
    const batch = sent.slice(before);
    expect(batch).toHaveLength(1);
    expect(batch[0].path).toBe('/emails/batch');
    const m = batch[0].body[0];
    expect(m.to).toEqual(['due@x.example']);
    expect(m.subject).toMatch(/^Erinnerung: unser Gespräch — /);
    expect(m.text).toContain('Google Meet beitreten: https://meet.google.com/abc-defg-hij');
    expect(m.text).toContain('Budapester Zeit');
    expect(m.text).not.toContain('Anna');
    expect(await dispatchBookingReminders(api, mail, { origin: ORIGIN })).toEqual({ reminders: 0 });
  });

  test('a moved call starts its reminder over; a cancelled one gets none', async () => {
    await db.exec(`
      update bookings set starts_at = starts_at + interval '2 hours', ends_at = ends_at + interval '2 hours' where guest_email = 'due@x.example';
    `);
    // Moved just now: the time was set less than 25 hours before → no reminder.
    expect((await db.query(`select reminder_sent_at, scheduled_at > now() - interval '1 minute' as fresh from bookings where guest_email = 'due@x.example'`)).rows[0])
      .toEqual({ reminder_sent_at: null, fresh: true });
    expect(await dispatchBookingReminders(api, mail, { origin: ORIGIN })).toEqual({ reminders: 0 });
    await db.exec(`
      update bookings set scheduled_at = now() - interval '3 days' where guest_email = 'due@x.example';
      update bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'guest' where guest_email = 'due@x.example';
    `);
    expect(await dispatchBookingReminders(api, mail, { origin: ORIGIN })).toEqual({ reminders: 0 });
  });

  test('the reminder in every language: when, the Meet link, how to change it — a client is sent to the portal', () => {
    for (const lang of LANGS) {
      const pub = bookingReminder({ lang, origin: ORIGIN, kind: 'public', startsAt: '2026-11-03T08:00:00Z', meetUrl: 'https://meet.google.com/abc-defg-hij' });
      expect(pub.text).toContain('https://meet.google.com/abc-defg-hij');
      expect(pub.html).toContain(`lang="${lang}"`);
      const cli = bookingReminder({ lang, origin: ORIGIN, kind: 'client', startsAt: '2026-11-03T08:00:00Z', meetUrl: 'javascript:alert(1)' });
      expect(cli.text).not.toContain('javascript');
      expect(cli.text).toMatch(/portál|portal/i);
      expect(receiptEmail({ lang, origin: ORIGIN, formType: 'contact' }).subject.length).toBeGreaterThan(5);
    }
  });

  /* ======================================================= the series */

  const confirm = async (email: string, locale: string, daysAgo: number) => {
    await db.query(`insert into newsletter_subscribers (email, locale, status, confirmed_at, welcome_sent_at)
                    values ($1, $2, 'confirmed', now() - make_interval(days => $3), now() - make_interval(days => $3))`, [email, locale, daysAgo]);
  };
  const position = async (email: string) =>
    (await db.query<{ series_position: number }>(`select series_position from newsletter_subscribers where email = $1`, [email])).rows[0].series_position;

  test('the seeded series is a draft: switched off, three steps per language, nothing is sent', async () => {
    expect((await db.query(`select locale, count(*)::int as n, bool_or(enabled) as on from newsletter_series group by locale order by locale`)).rows)
      .toEqual([{ locale: 'de', n: 3, on: false }, { locale: 'en', n: 3, on: false }, { locale: 'hu', n: 3, on: false }]);
    await confirm('new@x.example', 'hu', 4);
    expect(await dispatchSeries(api, mail, { origin: ORIGIN })).toEqual({ series: 0 });
  });

  test('switched on: each step on its day, in order; the overdue skipped; the early subscriber gets none', async () => {
    await db.exec(`update newsletter_series set enabled = true where locale = 'hu'`);
    await confirm('old@x.example', 'hu', 30);      // every hu step long overdue
    const before = sent.length;
    expect(await dispatchSeries(api, mail, { origin: ORIGIN })).toEqual({ series: 1 });
    const m = sent.slice(before)[0].body[0];
    expect(m.to).toEqual(['new@x.example']);
    expect(m.subject).toBe('Min dolgoztunk mostanában?');
    expect(m.headers['List-Unsubscribe']).toMatch(/\/api\/newsletter\/unsubscribe\?t=[0-9a-f]{64}&l=hu>$/);
    expect(await position('new@x.example')).toBe(1);
    expect(await position('old@x.example')).toBe(3);      // skipped, not sent late
    expect(await position('early@x.example')).toBe(100);  // there before the series
    expect(await dispatchSeries(api, mail, { origin: ORIGIN })).toEqual({ series: 0 });

    await db.query(`update newsletter_subscribers set confirmed_at = now() - interval '8 days' where email = 'new@x.example'`);
    await dispatchSeries(api, mail, { origin: ORIGIN });
    expect(sent.at(-1)!.body[0].subject).toBe('Mennyibe kerülne nálad egy weboldal?');
    expect(await position('new@x.example')).toBe(2);
  });

  test('someone who left gets no more of the series', async () => {
    await db.query(`update newsletter_subscribers set status = 'unsubscribed', confirmed_at = now() - interval '15 days' where email = 'new@x.example'`);
    expect(await dispatchSeries(api, mail, { origin: ORIGIN })).toEqual({ series: 0 });
  });

  /* ================================================== announcements */

  const item = (key: string, type = 'post') => ({
    key, type, langs: {
      hu: { title: `Cím ${key}`, desc: 'Rövid leírás', url: `/${key}` },
      en: { title: `Title ${key}`, desc: 'Short', url: `/en/${key}` },
    },
  });

  test('the first list is only remembered; a new article becomes a campaign per language with subscribers, and goes out', async () => {
    feed = { items: [item('post-a'), item('case-b', 'case')] };
    expect(await announce(api, { origin: ORIGIN })).toEqual({ campaigns: 0 });
    expect((await db.query(`select key, baseline from newsletter_announced order by key`)).rows)
      .toEqual([{ key: 'case-b', baseline: true }, { key: 'post-a', baseline: true }]);

    feed = { items: [item('post-a'), item('case-b', 'case'), item('post-new')] };
    // hu has confirmed subscribers (early@), en has none: one campaign.
    expect(await announce(api, { origin: ORIGIN })).toEqual({ campaigns: 1 });
    const [c] = (await db.query<Record<string, any>>(`select * from newsletter_campaigns where source_key = 'post-new'`)).rows;
    expect(c).toMatchObject({ kind: 'announce', audience: 'hu', status: 'sending', subject: 'Új cikk: Cím post-new', preheader: 'Rövid leírás' });
    expect(c.body).toContain(`[Elolvasom a cikket](${ORIGIN}/post-new)`);
    expect(await announce(api, { origin: ORIGIN })).toEqual({ campaigns: 0 });   // never twice

    const before = sent.length;
    const out = await core.dispatch(api, mail, { origin: ORIGIN });
    expect(out.sent).toBeGreaterThanOrEqual(1);
    expect(sent.slice(before).flatMap((s) => s.body).map((m: any) => m.subject)).toContain('Új cikk: Cím post-new');
  });

  test('"draft" makes drafts (even with nobody to send to); "off" only remembers', async () => {
    await db.exec(`update newsletter_settings set auto_announce = 'draft'`);
    feed = { items: [item('case-new', 'case')] };
    expect(await announce(api, { origin: ORIGIN })).toEqual({ campaigns: 2 });
    expect((await db.query(`select audience, status, subject from newsletter_campaigns where source_key = 'case-new' order by audience`)).rows).toEqual([
      { audience: 'en', status: 'draft', subject: 'New case study: Title case-new' },
      { audience: 'hu', status: 'draft', subject: 'Új esettanulmány: Cím case-new' },
    ]);
    await db.exec(`update newsletter_settings set auto_announce = 'off'`);
    feed = { items: [item('post-off')] };
    expect(await announce(api, { origin: ORIGIN })).toEqual({ campaigns: 0 });
    expect((await db.query(`select baseline, campaigns from newsletter_announced where key = 'post-off'`)).rows[0]).toEqual({ baseline: false, campaigns: 0 });
  });

  test('an unreadable list is no news', async () => {
    feed = 'not json at all';
    expect((await announce(api, { origin: ORIGIN })).campaigns).toBe(0);
  });

  /* ========================================================== access */

  test('admins change the setting and the series; nobody else; nobody calls the server functions', async () => {
    const as = async (who: keyof typeof U | 'anon', sql: string) => {
      await db.query(`select set_config('request.jwt.claims', $1, false)`, [who === 'anon' ? '{}' : JSON.stringify({ sub: U[who], role: 'authenticated' })]);
      await db.exec(`set role ${who === 'anon' ? 'anon' : 'authenticated'}`);
      try { return { rows: (await db.query(sql)).rows, code: null as string | null }; } catch (e: any) { return { rows: [], code: e.code as string }; } finally { await db.exec('reset role'); }
    };
    expect((await as('admin', `update newsletter_settings set auto_announce = 'send' returning auto_announce`)).rows).toEqual([{ auto_announce: 'send' }]);
    expect((await as('team', `update newsletter_settings set auto_announce = 'off' returning auto_announce`)).rows).toEqual([]);
    expect((await as('admin', `update newsletter_series set enabled = false where locale = 'hu' returning id`)).rows).toHaveLength(3);
    expect((await as('team', `select id from newsletter_series`)).rows).toEqual([]);
    expect((await as('admin', `insert into newsletter_series (locale, position, delay_days, subject, body) values ('hu', 1, 2, 'x', 'y')`)).code).toBe('23505');
    for (const sql of [`select lead_confirmation_allowed('a@b.example')`, `select * from booking_reminders_due(5)`,
      `select * from newsletter_series_due(5)`, `select newsletter_announce('[]'::jsonb)`]) {
      for (const who of ['anon', 'admin'] as const) expect((await as(who, sql)).code, `${who}: ${sql}`).toBe('42501');
    }
  });
});

test.describe("the site's list of articles and case studies", () => {
  test('every post and every reachable case study, in each language, at a page that exists', () => {
    const feed = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'assets', 'data', 'newsletter-feed.json'), 'utf8'));
    const keys = feed.items.map((i: any) => i.key);
    expect(keys.filter((k: string) => k.startsWith('post-')).length).toBeGreaterThanOrEqual(10);
    expect(keys).toContain('case-rapidkert');
    for (const i of feed.items) {
      expect(['post', 'case']).toContain(i.type);
      for (const [lang, v] of Object.entries<any>(i.langs)) {
        expect(v.title, `${i.key} ${lang}`).not.toMatch(/\| Stratos$/);
        const file = path.join(process.cwd(), `${v.url.replace(/^\//, '')}.html`);
        expect(fs.existsSync(file), `${i.key} ${lang}: ${v.url}`).toBe(true);
      }
    }
  });
});
