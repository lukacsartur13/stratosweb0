import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import {
  LANGS, SENDER, campaignEmail, confirmationEmail, page, renderBody, verifyWebhook, welcomeEmail,
} from '../netlify/functions/newsletter-lib.mjs';
import * as core from '../netlify/functions/newsletter-core.mjs';
import { __resetLimits, makeHandler } from '../netlify/functions/newsletter.mjs';
import * as lead from '../netlify/functions/submit-lead.mjs';
import { U, freshNewsletterDb, rpcAdapter } from './helpers/newsletter-db';

/**
 * The newsletter's functions (netlify/functions/newsletter*.mjs): the words in
 * every language, the light markup, the pages the links open, Resend's
 * webhook signature, and the whole round on a real database (PGlite) with a
 * fake Resend — signup through /api/lead, the confirmation e-mail, its button,
 * the welcome, leaving and rejoining, the mail app's one-click, a bounce, a
 * campaign through the dispatcher. The database side is newsletter-db.spec.ts.
 */

test.describe.configure({ mode: 'serial' });

const ORIGIN = 'https://stratosweb.hu';
const T = 'a'.repeat(64);

/* ================================================================ words */

test.describe('the light markup', () => {
  test('paragraphs, headings, lists, bold and links — and nothing else', () => {
    const { html, text } = renderBody([
      '## Őszi hírek',
      'Első sor\nmásodik sor, **fontos**.',
      '',
      '- egy [cikk](https://stratosweb.hu/blog.html?a=1&b=2)',
      '- kettő https://example.com/x.',
      '',
      '<script>alert(1)</script> [rossz](javascript:alert(1)) "idézet"',
    ].join('\n'));
    expect(html).toContain('>Őszi hírek</h2>');
    expect(html).toContain('Első sor<br>második sor, <strong>fontos</strong>.');
    expect(html).toContain('<a href="https://stratosweb.hu/blog.html?a=1&amp;b=2"');
    expect(html).toContain('<a href="https://example.com/x"');
    expect(html).toMatch(/<ul[^>]*><li[^>]*>egy <a /);
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('[rossz](javascript:alert(1))');
    expect(text).toContain('ŐSZI HÍREK');
    expect(text).toContain('• egy cikk (https://stratosweb.hu/blog.html?a=1&b=2)');
    expect(text).toContain('második sor, fontos.');
  });

  test('empty or Windows line endings are fine', () => {
    expect(renderBody('')).toEqual({ html: '', text: '' });
    expect(renderBody('a\r\n\r\nb').html.match(/<p /g)).toHaveLength(2);
  });
});

test.describe('the e-mails', () => {
  for (const lang of LANGS) {
    test(`${lang}: confirmation, welcome and campaign say who sends them and how to leave`, () => {
      const conf = confirmationEmail({ lang, origin: ORIGIN, token: T });
      expect(conf.html).toContain(`${ORIGIN}/api/newsletter/confirm?t=${T}&amp;l=${lang}`);
      expect(conf.text).toContain(`${ORIGIN}/api/newsletter/confirm?t=${T}&l=${lang}`);
      expect(conf.headers).toEqual({});   // nothing to leave yet
      expect(conf.html).toContain(`lang="${lang}"`);

      const welcome = welcomeEmail({ lang, origin: ORIGIN, unsubscribeToken: T });
      const unsub = `${ORIGIN}/api/newsletter/unsubscribe?t=${T}&l=${lang}`;
      expect(welcome.headers).toEqual({ 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
      expect(welcome.text).toContain(unsub);

      const camp = campaignEmail({ lang, origin: ORIGIN, subject: '  Hírek  ', preheader: 'Előnézet', body: 'Szia!', unsubscribeToken: T });
      expect(camp.subject).toBe('Hírek');
      expect(camp.headers['List-Unsubscribe']).toBe(`<${unsub}>`);
      expect(camp.html).toContain('Előnézet');
      for (const m of [conf, welcome, camp]) {
        expect(m.subject.length).toBeGreaterThan(3);
        expect(m.html).toContain('Abda, Arany János utca 13.');
        expect(m.text).toContain(SENDER);
      }
      expect(campaignEmail({ lang, origin: ORIGIN, subject: 'x', body: 'y', unsubscribeToken: T, test: true }).text).toMatch(/^(PRÓBALEVÉL|TEST)/);
    });
  }

  test('every page the welcome links to exists on the site', () => {
    for (const lang of LANGS) {
      const links = [...welcomeEmail({ lang, origin: ORIGIN, unsubscribeToken: T }).html.matchAll(/href="https:\/\/stratosweb\.hu(\/[^"?]*)"/g)]
        .map((m) => m[1]).filter((p) => !p.startsWith('/api/'));
      expect(links.length).toBeGreaterThanOrEqual(5);
      for (const p of links) {
        const file = p.endsWith('/') ? `${p}index.html` : p;
        expect(fs.existsSync(path.join(process.cwd(), file.slice(1))), `${lang}: ${p}`).toBe(true);
      }
    }
  });
});

test.describe('the pages', () => {
  const STATES = ['confirm_ask', 'confirm_done', 'confirm_already', 'confirm_expired', 'confirm_unknown', 'unsubscribe_ask',
    'unsubscribe_done', 'unsubscribe_already', 'unsubscribe_unknown', 'resubscribe_done', 'resubscribe_no', 'error'];
  test('every state, in every language, is a page with no script and one way on', () => {
    for (const lang of LANGS) {
      for (const state of STATES) {
        const html = page({ lang, state, origin: ORIGIN, form: state.endsWith('_ask') ? { action: '/x', fields: { t: T } } : null });
        expect(html, `${lang} ${state}`).toContain(`<html lang="${lang}">`);
        expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
        expect(html).not.toContain('<script');
        expect(html).toMatch(state.endsWith('_ask') ? /<form method="post" action="\/x"><input type="hidden" name="t" value="a{64}"><button/ : /<a class="btn" href="https:\/\/stratosweb\.hu\//);
      }
    }
  });
});

test.describe("Resend's webhook signature", () => {
  const secret = `whsec_${Buffer.from('a very secret key').toString('base64')}`;
  const sign = (id: string, ts: number, body: string, key = secret) =>
    `v1,${createHmac('sha256', Buffer.from(key.slice(6), 'base64')).update(`${id}.${ts}.${body}`).digest('base64')}`;
  const now = 1_760_000_000_000;
  const ts = now / 1000;
  test('a good signature passes; a wrong key, a changed body or an old timestamp does not', () => {
    const body = '{"type":"email.bounced"}';
    expect(verifyWebhook({ secret, id: 'msg_1', timestamp: String(ts), signature: sign('msg_1', ts, body), body, now })).toBe(true);
    expect(verifyWebhook({ secret, id: 'msg_1', timestamp: String(ts), signature: `v1,bm9wZQ== ${sign('msg_1', ts, body)}`, body, now })).toBe(true);
    expect(verifyWebhook({ secret, id: 'msg_1', timestamp: String(ts), signature: sign('msg_1', ts, body, `whsec_${Buffer.from('other').toString('base64')}`), body, now })).toBe(false);
    expect(verifyWebhook({ secret, id: 'msg_1', timestamp: String(ts), signature: sign('msg_1', ts, body), body: `${body} `, now })).toBe(false);
    expect(verifyWebhook({ secret, id: 'msg_1', timestamp: String(ts - 600), signature: sign('msg_1', ts - 600, body), body, now })).toBe(false);
    expect(verifyWebhook({ secret, id: '', timestamp: String(ts), signature: sign('', ts, body), body, now })).toBe(false);
  });
});

/* ================================================================ the round */

type Sent = { path: string; body: any; key: string | undefined };

test.describe('the whole round, on a real database with a fake Resend', () => {
  let db: PGlite;
  let api: ReturnType<typeof rpcAdapter>;
  let handler: (req: Request) => Promise<Response>;
  const sent: Sent[] = [];
  let resendStatus = 200;
  const mail = { key: 're_test', from: 'Stratos <hirlevel@stratosweb.hu>', replyTo: 'hello@stratosweb.hu' };
  const webhookSecret = `whsec_${Buffer.from('webhook key').toString('base64')}`;
  const realFetch = core.__net.fetch;
  const realPace = core.__pace.ms;
  const realStore = (lead as any).__store.create;

  const realKey = process.env.RESEND_API_KEY;
  test.beforeAll(async () => {
    db = await freshNewsletterDb();
    api = rpcAdapter(db);
    core.__pace.ms = 0;
    // /api/lead reads its mail settings from the environment.
    process.env.RESEND_API_KEY = mail.key;
    core.__net.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const headers = (init.headers ?? {}) as Record<string, string>;
      if (url.startsWith('https://api.resend.com/')) {
        const body = JSON.parse(String(init.body));
        // The forms' "we have it" receipts (the Portal's sender) are
        // tests/email-automations.spec.ts's business; this round counts the
        // newsletter's own e-mails.
        if (!Array.isArray(body) && String(body.from).includes('portal@')) return Response.json({ id: 'receipt' });
        sent.push({ path: new URL(url).pathname, body, key: headers['Idempotency-Key'] });
        return new Response(JSON.stringify({ id: 'em_1' }), { status: resendStatus });
      }
      if (url === 'https://db.example/auth/v1/user') {
        if (headers.authorization === 'Bearer admin-session') return Response.json({ id: U.admin, email: 'admin@stratos.example' });
        if (headers.authorization === 'Bearer team-session') return Response.json({ id: U.team, email: 'team@stratos.example' });
        return new Response('{}', { status: 401 });
      }
      if (url === 'https://db.example/rest/v1/rpc/is_admin') return Response.json(headers.authorization === 'Bearer admin-session');
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;
    handler = makeHandler({ db: api, mail, origin: ORIGIN, creds: { supabase: 'https://db.example', publicKey: 'anon' }, webhookSecret });
    // /api/lead stores the lead in a stand-in and the subscriber in PGlite.
    (lead as any).__store.create = async () => ({
      insert: async () => ({ data: { id: crypto.randomUUID() }, error: null }),
      findBySubmissionId: async () => ({ data: null, error: null }),
      rpc: (fn: string, args: Record<string, unknown>) => api.rpc(fn, args),
    });
  });
  test.afterAll(async () => {
    if (realKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = realKey;
    core.__net.fetch = realFetch;
    core.__pace.ms = realPace;
    (lead as any).__store.create = realStore;
  });
  test.beforeEach(() => { __resetLimits(); });

  const call = (method: string, pathAndQuery: string, body?: string, headers: Record<string, string> = {}) =>
    handler(new Request(`${ORIGIN}/api/newsletter/${pathAndQuery}`, {
      method, body, headers: { 'x-nf-client-connection-ip': '203.0.113.9', ...(body && !headers['content-type'] ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...headers },
    }));
  const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
  const signup = (formType: 'newsletter' | 'contact', email: string, locale = 'hu', extra: Record<string, unknown> = {}) =>
    lead.default(new Request(`${ORIGIN}/api/lead`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': `198.51.100.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify({
        submissionId: crypto.randomUUID(), formType, locale, route: '/blog.html',
        fields: formType === 'newsletter' ? { email } : {
          vezeteknev: 'Kovács', keresztnev: 'Anna', email, telefon: '+36301234567', ceg: 'Kert Kft.',
          megjegyzes: 'Weboldalt szeretnénk.', adatvedelem_elfogadva: true, ...extra,
        },
        meta: { elapsedMs: 9000, botField: '' },
      }),
    }));
  const tokenIn = (s: string, kind: 'confirm' | 'unsubscribe') => new RegExp(`/api/newsletter/${kind}\\?t=([0-9a-f]{64})`).exec(s)?.[1] ?? '';

  test('a signup on the newsletter form stores a pending subscriber and sends ONE confirmation', async () => {
    const res = await signup('newsletter', 'Reader@Example.com', 'en');
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].path).toBe('/emails');
    expect(sent[0].body).toMatchObject({ from: mail.from, reply_to: mail.replyTo, to: ['reader@example.com'], subject: 'Confirm your subscription — Stratos newsletter' });
    expect(sent[0].key).toMatch(/^nl-confirm\/[0-9a-f]{64}$/);
    expect((await db.query(`select status, locale, source, confirm_sent_at is not null as sent from newsletter_subscribers where email = 'reader@example.com'`)).rows[0])
      .toEqual({ status: 'pending', locale: 'en', source: 'newsletter', sent: true });
    // Pressing the button again a moment later: the same answer, no second e-mail.
    expect((await signup('newsletter', 'reader@example.com', 'en')).status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  test('the contact form subscribes only when its box is ticked', async () => {
    await signup('contact', 'no-box@example.com');
    expect(sent).toHaveLength(1);
    await signup('contact', 'box@example.com', 'de', { hirlevel: true });
    expect(sent).toHaveLength(2);
    expect(sent[1].body.subject).toBe('Bitte bestätigen Sie Ihre Anmeldung — Stratos-Newsletter');
    expect((await db.query(`select source from newsletter_subscribers where email = 'box@example.com'`)).rows[0]).toEqual({ source: 'contact' });
    expect((await db.query(`select count(*)::int as n from newsletter_subscribers where email = 'no-box@example.com'`)).rows[0]).toEqual({ n: 0 });
  });

  test('the link opens a page with a button; only the button confirms, and the welcome goes out', async () => {
    const token = tokenIn(sent[0].body.text, 'confirm');
    const ask = await call('GET', `confirm?t=${token}&l=en`);
    expect(ask.status).toBe(200);
    expect(ask.headers.get('content-security-policy')).toContain("form-action 'self'");
    expect(ask.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await ask.text()).toContain(`<form method="post" action="/api/newsletter/confirm?l=en"><input type="hidden" name="t" value="${token}">`);
    expect((await db.query(`select status from newsletter_subscribers where email = 'reader@example.com'`)).rows[0]).toEqual({ status: 'pending' });

    const done = await call('POST', 'confirm?l=en', form({ t: token }));
    expect(await done.text()).toContain('You are subscribed!');
    expect(sent).toHaveLength(3);
    expect(sent[2].body).toMatchObject({ to: ['reader@example.com'], subject: 'Welcome to the Stratos newsletter' });
    expect(sent[2].body.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect((await db.query(`select status, welcome_sent_at is not null as welcomed from newsletter_subscribers where email = 'reader@example.com'`)).rows[0])
      .toEqual({ status: 'confirmed', welcomed: true });

    expect(await (await call('POST', 'confirm?l=en', form({ t: token }))).text()).toContain('Already subscribed');
    expect(sent).toHaveLength(3);
    expect(await (await call('GET', 'confirm?t=nope&l=de')).text()).toContain('Dieser Link ist nicht gültig');
  });

  test('leaving takes a button; "keep me subscribed" brings them straight back', async () => {
    const token = tokenIn(sent[2].body.text, 'unsubscribe');
    const ask = await (await call('GET', `unsubscribe?t=${token}&l=en`)).text();
    expect(ask).toContain('name="a" value="leave"');
    const left = await (await call('POST', 'unsubscribe?l=en', form({ t: token, a: 'leave' }))).text();
    expect(left).toContain('You are unsubscribed');
    expect(left).toContain('name="a" value="rejoin"');
    expect((await db.query(`select status, unsubscribe_source from newsletter_subscribers where email = 'reader@example.com'`)).rows[0])
      .toEqual({ status: 'unsubscribed', unsubscribe_source: 'link' });
    expect(await (await call('POST', 'unsubscribe?l=en', form({ t: token, a: 'rejoin' }))).text()).toContain('Glad you are staying!');
    expect((await db.query(`select status from newsletter_subscribers where email = 'reader@example.com'`)).rows[0]).toEqual({ status: 'confirmed' });
  });

  test("the mail app's one-click unsubscribes at once (RFC 8058)", async () => {
    const token = tokenIn(sent[2].body.headers['List-Unsubscribe'], 'unsubscribe');
    const res = await call('POST', `unsubscribe?t=${token}&l=en`, 'List-Unsubscribe=One-Click');
    expect(res.status).toBe(200);
    expect((await db.query(`select status, unsubscribe_source from newsletter_subscribers where email = 'reader@example.com'`)).rows[0])
      .toEqual({ status: 'unsubscribed', unsubscribe_source: 'one_click' });
    await call('POST', 'unsubscribe?l=en', form({ t: token, a: 'rejoin' }));
  });

  test('a signed hard bounce takes the address off; an unsigned one is refused; a soft one is ignored', async () => {
    const event = (type: string, bounceType?: string) => JSON.stringify({
      type, data: { to: ['reader@example.com'], ...(bounceType ? { bounce: { type: bounceType } } : {}) },
    });
    const post = (body: string, signed = true) => {
      const ts = Math.floor(Date.now() / 1000);
      const sig = createHmac('sha256', Buffer.from(webhookSecret.slice(6), 'base64')).update(`msg_1.${ts}.${body}`).digest('base64');
      return call('POST', 'webhook', body, {
        'content-type': 'application/json', 'svix-id': 'msg_1', 'svix-timestamp': String(ts), 'svix-signature': `v1,${signed ? sig : 'bm9wZQ=='}`,
      });
    };
    expect((await post(event('email.bounced', 'Permanent'), false)).status).toBe(401);
    expect(await (await post(event('email.bounced', 'Transient'))).json()).toEqual({ ok: true, ignored: true });
    expect(await (await post(event('email.delivered'))).json()).toEqual({ ok: true, ignored: true });
    expect((await db.query(`select status from newsletter_subscribers where email = 'reader@example.com'`)).rows[0]).toEqual({ status: 'confirmed' });
    expect(await (await post(event('email.bounced', 'Permanent'))).json()).toEqual({ ok: true, listed: 1 });
    expect((await db.query(`select status from newsletter_subscribers where email = 'reader@example.com'`)).rows[0]).toEqual({ status: 'bounced' });
  });

  test('a campaign goes out through the dispatcher in one batch, each with its own unsubscribe link', async () => {
    // Two confirmed subscribers: box@ (de) confirms now, and one more.
    await call('POST', 'confirm?l=de', form({ t: tokenIn(sent[1].body.text, 'confirm') }));
    await signup('newsletter', 'third@example.com', 'hu');
    await call('POST', 'confirm', form({ t: tokenIn(sent.at(-1)!.body.text, 'confirm') }));
    await db.query(`set role authenticated`);
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: U.admin, role: 'authenticated' })]);
    const c = (await db.query<{ id: string }>(`insert into newsletter_campaigns (subject, preheader, body) values ('Őszi hírek', 'Rövid', 'Szia!\n\n- egy') returning id`)).rows[0];
    expect((await db.query<{ n: number }>(`select newsletter_campaign_send($1) as n`, [c.id])).rows[0].n).toBe(2);
    await db.query('reset role');

    const before = sent.length;
    const out = await core.dispatch(api, mail, { origin: ORIGIN });
    expect(out).toMatchObject({ sent: 2, failed: 0, closed: 1 });
    const batch = sent.slice(before).find((s) => s.path === '/emails/batch')!;
    expect(batch.body).toHaveLength(2);
    expect(batch.key).toMatch(/^nl-batch\//);
    const tokens = batch.body.map((m: any) => tokenIn(m.headers['List-Unsubscribe'], 'unsubscribe'));
    expect(new Set(tokens).size).toBe(2);
    expect(batch.body.map((m: any) => m.subject)).toEqual(['Őszi hírek', 'Őszi hírek']);
    expect((await db.query(`select status, sent from newsletter_campaigns where id = $1`, [c.id])).rows[0]).toEqual({ status: 'sent', sent: 2 });
  });

  test("Resend's 429 puts a batch back without spending an attempt", async () => {
    await db.query(`set role authenticated`);
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: U.admin, role: 'authenticated' })]);
    const c = (await db.query<{ id: string }>(`insert into newsletter_campaigns (subject, body) values ('Második', 'Szia!') returning id`)).rows[0];
    await db.query(`select newsletter_campaign_send($1)`, [c.id]);
    await db.query('reset role');
    resendStatus = 429;
    expect(await core.dispatch(api, mail, { origin: ORIGIN })).toMatchObject({ released: 2, note: 'rate limited' });
    expect((await db.query(`select distinct status, attempts from newsletter_deliveries where campaign_id = $1`, [c.id])).rows).toEqual([{ status: 'queued', attempts: 0 }]);
    resendStatus = 200;
    expect(await core.dispatch(api, mail, { origin: ORIGIN })).toMatchObject({ sent: 2, closed: 1 });
  });

  test('a failed confirmation is retried by the dispatcher with a fresh link', async () => {
    resendStatus = 500;
    await signup('newsletter', 'retry@example.com');
    const first = tokenIn(sent.at(-1)!.body.text, 'confirm');
    resendStatus = 200;
    await db.query(`update newsletter_subscribers set confirm_claimed_at = null where email = 'retry@example.com'`);
    const before = sent.length;
    expect(await core.dispatch(api, mail, { origin: ORIGIN })).toMatchObject({ confirmations: 1 });
    const again = sent.slice(before).find((s) => s.path === '/emails/batch')!;
    expect(again.body[0].to).toEqual(['retry@example.com']);
    const fresh = tokenIn(again.body[0].text, 'confirm');
    expect(fresh).not.toBe(first);
    expect(await (await call('POST', 'confirm', form({ t: first }))).text()).toContain('Ez a link nem érvényes');
    expect(await (await call('POST', 'confirm', form({ t: fresh }))).text()).toContain('Kész, feliratkoztál!');
  });

  test('the Portal: admins preview and test; nobody else', async () => {
    const json = (session: string | null, route: string, body: unknown) => call('POST', route, JSON.stringify(body), {
      'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session}` } : {}),
    });
    const draft = { subject: 'Hírek', preheader: '', body: '## Cím\n\nSzöveg', locale: 'hu' };
    expect((await json(null, 'preview', draft)).status).toBe(401);
    expect((await json('team-session', 'preview', draft)).status).toBe(403);
    expect((await json('admin-session', 'preview', { ...draft, subject: '' })).status).toBe(422);
    const preview = await (await json('admin-session', 'preview', draft)).json();
    expect(preview).toMatchObject({ ok: true, subject: 'Hírek' });
    expect(preview.html).toContain('>Cím</h2>');
    const before = sent.length;
    expect(await (await json('admin-session', 'test', draft)).json()).toEqual({ ok: true, to: 'admin@stratos.example' });
    expect(sent.slice(before)).toHaveLength(1);
    expect(sent.at(-1)!.body).toMatchObject({ to: ['admin@stratos.example'], subject: '[TEST] Hírek' });
    expect(sent.at(-1)!.body.text).toMatch(/^PRÓBALEVÉL/);
  });
});
