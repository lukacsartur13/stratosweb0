import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { NEWSLETTER, U, freshNewsletterDb, readMigration } from './helpers/newsletter-db';

/**
 * The newsletter (20261019000100_newsletter.sql) against real Postgres
 * (PGlite): the old requests coming in as pending, double opt-in with its
 * abuse ceiling, the welcome claim, unsubscribing (and back), bounces, the
 * 30-day clean-up, campaigns and their queue, and who may read or write what
 * through the API. The functions' side is tests/newsletter.spec.ts.
 */

test.describe.configure({ mode: 'serial' });

const read = readMigration;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
type Who = keyof typeof U | 'anon' | 'server';

/** Every migration up to the newsletter, four old leads, then the newsletter. */
const fresh = () => freshNewsletterDb(`
  insert into leads (name, email, form_type, locale, created_at) values
    ('Newsletter subscriber', 'Old@Reader.example ', 'newsletter', 'en', now() - interval '60 days'),
    ('Newsletter subscriber', 'old@reader.example', 'newsletter', 'hu', now() - interval '50 days'),
    ('Newsletter subscriber', 'second@reader.example', 'newsletter', 'de', now() - interval '40 days'),
    ('Kovács Anna', 'anna@kert.example', 'contact', 'hu', now() - interval '10 days');
  insert into leads (name, email, form_type, locale, trashed_at) values
    ('Newsletter subscriber', 'trashed@reader.example', 'newsletter', 'hu', now());
`);

type Result = { rows: Record<string, unknown>[]; error: null | { code?: string; message: string } };
/** As a person through the API, or — `server` — as the newsletter functions' server key does. */
async function as(db: PGlite, who: Who, sql: string, params: unknown[] = []): Promise<Result> {
  const claims = who === 'anon' || who === 'server' ? '{}' : JSON.stringify({ sub: U[who], role: 'authenticated' });
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  if (who !== 'server') await db.exec(`set role ${who === 'anon' ? 'anon' : 'authenticated'}`);
  try {
    const r = await db.query<Record<string, unknown>>(sql, params);
    return { rows: r.rows, error: null };
  } catch (error) {
    const e = error as { code?: string; message: string };
    return { rows: [], error: { code: e.code, message: e.message } };
  } finally {
    await db.exec('reset role');
  }
}
const ok = async (db: PGlite, who: Who, sql: string, params: unknown[] = []) => {
  const r = await as(db, who, sql, params);
  if (r.error) throw new Error(`${who}: ${r.error.message}`);
  return r.rows;
};
const refusal = (r: Result) => /stratos:[a-z_]+/.exec(r.error?.message ?? '')?.[0] ?? r.error?.code ?? null;
const row = async (db: PGlite, email: string) =>
  (await db.query<Record<string, unknown>>(`select * from newsletter_subscribers where email = $1`, [email])).rows[0];
const subscribe = async (db: PGlite, email: string, locale = 'hu', source = 'newsletter') =>
  (await ok(db, 'server', `select * from newsletter_subscribe($1, $2, $3, '/blog.html', null)`, [email, locale, source]))[0] as
    { subscriber_id: string; outcome: string; email: string; locale: string; token: string | null };
/** Make the latest confirmation look `minutes` old (the 2-minute double-click guard). */
const age = (db: PGlite, email: string, minutes: number) =>
  db.query(`update newsletter_subscribers set confirm_claimed_at = now() - make_interval(mins => $2)
            where email = $1`, [email, minutes]);

/* ===================================================================== */

test.describe('the old requests', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('every live newsletter lead is one PENDING row, nobody is asked yet', async () => {
    const rows = (await db.query(`select email, locale, status, source, confirm_requested_at from newsletter_subscribers order by email`)).rows;
    expect(rows).toEqual([
      // The earliest of the two spellings wins, and its language.
      { email: 'old@reader.example', locale: 'en', status: 'pending', source: 'import', confirm_requested_at: null },
      { email: 'second@reader.example', locale: 'de', status: 'pending', source: 'import', confirm_requested_at: null },
    ]);
    // Nothing is due until an admin asks.
    expect(await ok(db, 'server', `select * from newsletter_confirmations_due(50)`)).toEqual([]);
  });

  test('an admin asks once: each gets a fresh link from the dispatcher', async () => {
    expect((await as(db, 'team', `select newsletter_request_confirmations() as n`)).error?.code).toBe('42501');
    expect((await ok(db, 'admin', `select newsletter_request_confirmations() as n`))[0].n).toBe(2);
    expect((await ok(db, 'admin', `select newsletter_request_confirmations() as n`))[0].n).toBe(0);
    const due = await ok(db, 'server', `select * from newsletter_confirmations_due(50)`);
    expect(due.map((r) => r.email).sort()).toEqual(['old@reader.example', 'second@reader.example']);
    for (const r of due) {
      expect(r.token).toMatch(/^[0-9a-f]{64}$/);
      expect((await row(db, r.email as string)).confirm_hash).toBe(sha(r.token as string));
    }
    // Claimed: a second dispatcher run in the same minute takes nothing.
    expect(await ok(db, 'server', `select * from newsletter_confirmations_due(50)`)).toEqual([]);
  });

  test('a re-run of the migration does not bring back an erased address', async () => {
    await ok(db, 'admin', `delete from newsletter_subscribers where email = 'second@reader.example'`);
    await db.exec(read(NEWSLETTER));
    expect((await db.query(`select email from newsletter_subscribers order by email`)).rows).toEqual([{ email: 'old@reader.example' }]);
  });
});

test.describe('double opt-in', () => {
  let db: PGlite;
  test.beforeAll(async () => { db = await fresh(); });

  test('a signup is pending with only the hash of its link; the link confirms it once', async () => {
    const s = await subscribe(db, '  Reader@Example.COM ', 'de', 'contact');
    expect(s).toMatchObject({ outcome: 'send', email: 'reader@example.com', locale: 'de' });
    expect(s.token).toMatch(/^[0-9a-f]{64}$/);
    const r = await row(db, 'reader@example.com');
    expect(r).toMatchObject({ status: 'pending', source: 'contact', source_route: '/blog.html', confirm_hash: sha(s.token!) });
    expect(JSON.stringify(r)).not.toContain(s.token!);

    await ok(db, 'server', `select newsletter_confirmation_done($1, null)`, [s.subscriber_id]);
    const c = (await ok(db, 'server', `select * from newsletter_confirm($1)`, [s.token]))[0];
    expect(c).toMatchObject({ outcome: 'confirmed', email: 'reader@example.com', locale: 'de' });
    expect(c.unsubscribe_token).toMatch(/^[0-9a-f]{64}$/);
    expect(await row(db, 'reader@example.com')).toMatchObject({ status: 'confirmed', welcome_attempts: 1 });
    // The welcome is claimed by the click itself: the dispatcher leaves it alone.
    expect(await ok(db, 'server', `select * from newsletter_welcomes_due(50)`)).toEqual([]);

    expect((await ok(db, 'server', `select * from newsletter_confirm($1)`, [s.token]))[0].outcome).toBe('already');
    expect((await ok(db, 'server', `select * from newsletter_confirm($1)`, ['f'.repeat(64)]))[0].outcome).toBe('unknown');
    expect((await ok(db, 'server', `select * from newsletter_confirm($1)`, ['not a token']))[0].outcome).toBe('unknown');
    // Signing up again as a subscriber sends nothing.
    expect(await subscribe(db, 'reader@example.com')).toMatchObject({ outcome: 'confirmed', token: null });
  });

  test('a failed welcome is retried by the dispatcher, for a week', async () => {
    const s = await subscribe(db, 'welcome@example.com');
    const c = (await ok(db, 'server', `select * from newsletter_confirm($1)`, [s.token]))[0];
    await ok(db, 'server', `select newsletter_welcome_done($1, 'resend 500')`, [c.subscriber_id]);
    const due = await ok(db, 'server', `select * from newsletter_welcomes_due(50)`);
    expect(due).toEqual([{ subscriber_id: c.subscriber_id, email: 'welcome@example.com', locale: 'hu', unsubscribe_token: c.unsubscribe_token }]);
    await ok(db, 'server', `select newsletter_welcome_done($1, null)`, [c.subscriber_id]);
    await db.query(`update newsletter_subscribers set welcome_claimed_at = null where id = $1`, [c.subscriber_id]);
    expect(await ok(db, 'server', `select * from newsletter_welcomes_due(50)`)).toEqual([]);
  });

  test('no mail-bombing: two minutes between confirmations, three a day; a new link replaces the old', async () => {
    const first = await subscribe(db, 'target@example.com');
    expect(first.outcome).toBe('send');
    expect((await subscribe(db, 'target@example.com')).outcome).toBe('throttled');
    await age(db, 'target@example.com', 3);
    const second = await subscribe(db, 'target@example.com');
    expect(second.outcome).toBe('send');
    expect(second.token).not.toBe(first.token);
    expect((await ok(db, 'server', `select * from newsletter_confirm($1)`, [first.token]))[0].outcome).toBe('unknown');
    await age(db, 'target@example.com', 3);
    expect((await subscribe(db, 'target@example.com')).outcome).toBe('send');
    await age(db, 'target@example.com', 3);
    expect((await subscribe(db, 'target@example.com')).outcome).toBe('throttled');
    // A day later the window opens again.
    await db.query(`update newsletter_subscribers set confirm_window_at = now() - interval '25 hours' where email = 'target@example.com'`);
    expect((await subscribe(db, 'target@example.com')).outcome).toBe('send');
  });

  test('a confirmation that failed to send is retried with a fresh link, five tries at most', async () => {
    const s = await subscribe(db, 'flaky@example.com');
    await ok(db, 'server', `select newsletter_confirmation_done($1, 'resend 503')`, [s.subscriber_id]);
    const [again] = await ok(db, 'server', `select * from newsletter_confirmations_due(50)`);
    expect(again).toMatchObject({ subscriber_id: s.subscriber_id, email: 'flaky@example.com' });
    expect(again.token).not.toBe(s.token);
    for (let i = 0; i < 4; i += 1) {
      await ok(db, 'server', `select newsletter_confirmation_done($1, 'resend 503')`, [s.subscriber_id]);
      await ok(db, 'server', `select * from newsletter_confirmations_due(50)`);
    }
    expect((await row(db, 'flaky@example.com')).confirm_attempts).toBe(5);
    await ok(db, 'server', `select newsletter_confirmation_done($1, 'resend 503')`, [s.subscriber_id]);
    expect(await ok(db, 'server', `select * from newsletter_confirmations_due(50)`)).toEqual([]);
  });

  test('a link older than 30 days has expired', async () => {
    const s = await subscribe(db, 'late@example.com');
    await db.query(`update newsletter_subscribers set confirm_requested_at = now() - interval '31 days' where email = 'late@example.com'`);
    expect((await ok(db, 'server', `select * from newsletter_confirm($1)`, [s.token]))[0].outcome).toBe('expired');
    expect((await row(db, 'late@example.com')).status).toBe('pending');
  });

  test('a bad address is refused by the database', async () => {
    const r = await as(db, 'server', `select * from newsletter_subscribe('not-an-address', 'hu', 'newsletter', null, null)`);
    expect(refusal(r)).toBe('stratos:newsletter_email');
  });

  test('unconfirmed requests are deleted 30 days after their last e-mail; untouched old requests stay', async () => {
    const s = await subscribe(db, 'never@example.com');
    await ok(db, 'server', `select newsletter_confirmation_done($1, null)`, [s.subscriber_id]);
    await db.query(`update newsletter_subscribers set confirm_sent_at = now() - interval '31 days' where id = $1`, [s.subscriber_id]);
    const before = (await db.query<{ n: number }>(`select count(*)::int as n from newsletter_subscribers where source = 'import'`)).rows[0].n;
    expect((await ok(db, 'server', `select newsletter_purge() as n`))[0].n).toBe(1);
    expect(await row(db, 'never@example.com')).toBeUndefined();
    expect((await db.query<{ n: number }>(`select count(*)::int as n from newsletter_subscribers where source = 'import'`)).rows[0].n).toBe(before);
    expect(await row(db, 'reader@example.com')).toBeDefined();
  });
});

test.describe('leaving', () => {
  let db: PGlite;
  let token = '';
  test.beforeAll(async () => {
    db = await fresh();
    const s = await subscribe(db, 'leaver@example.com');
    token = (await ok(db, 'server', `select * from newsletter_confirm($1)`, [s.token]))[0].unsubscribe_token as string;
  });

  test('the link unsubscribes once, and "I clicked by mistake" brings them straight back', async () => {
    expect(await ok(db, 'server', `select * from newsletter_unsubscribe($1, 'one_click')`, [token])).toEqual([{ outcome: 'done', locale: 'hu' }]);
    expect(await row(db, 'leaver@example.com')).toMatchObject({ status: 'unsubscribed', unsubscribe_source: 'one_click' });
    expect((await ok(db, 'server', `select * from newsletter_unsubscribe($1, 'link')`, [token]))[0].outcome).toBe('already');
    expect((await ok(db, 'server', `select * from newsletter_resubscribe($1)`, [token]))[0].outcome).toBe('done');
    expect(await row(db, 'leaver@example.com')).toMatchObject({ status: 'confirmed', unsubscribed_at: null });
    expect((await ok(db, 'server', `select * from newsletter_unsubscribe($1, 'link')`, ['0'.repeat(64)]))[0].outcome).toBe('unknown');
  });

  test('a hard bounce or a complaint takes them off for good; resubscribing by link is refused', async () => {
    expect((await ok(db, 'server', `select newsletter_suppress('LEAVER@example.com', 'bounced') as x`))[0].x).toBe(true);
    expect(await row(db, 'leaver@example.com')).toMatchObject({ status: 'bounced', unsubscribe_source: 'bounce' });
    expect((await ok(db, 'server', `select * from newsletter_resubscribe($1)`, [token]))[0].outcome).toBe('no');
    expect((await ok(db, 'server', `select newsletter_suppress('nobody@example.com', 'complained') as x`))[0].x).toBe(false);
    // Signing up on the site again starts a new double opt-in.
    expect((await subscribe(db, 'leaver@example.com')).outcome).toBe('send');
  });

  test('a pending signup can leave too; its confirmation link stops working', async () => {
    const s = await subscribe(db, 'pending@example.com');
    const t = (await row(db, 'pending@example.com')).unsubscribe_token as string;
    expect((await ok(db, 'server', `select * from newsletter_unsubscribe($1, 'link')`, [t]))[0].outcome).toBe('done');
    expect((await ok(db, 'server', `select * from newsletter_confirm($1)`, [s.token]))[0].outcome).toBe('unknown');
  });
});

test.describe('campaigns', () => {
  let db: PGlite;
  const ids: Record<string, string> = {};
  test.beforeAll(async () => {
    db = await fresh();
    for (const [email, locale] of [['a@x.example', 'hu'], ['b@x.example', 'hu'], ['c@x.example', 'en'], ['d@x.example', 'de']]) {
      const s = await subscribe(db, email, locale);
      const c = (await ok(db, 'server', `select * from newsletter_confirm($1)`, [s.token]))[0];
      ids[email] = c.subscriber_id as string;
    }
    await subscribe(db, 'pending@x.example', 'hu');   // not confirmed: never a recipient
  });

  const draft = async (who: Who, audience = 'all') =>
    as(db, who, `insert into newsletter_campaigns (subject, preheader, body, audience) values ('  Őszi hírek ', '', 'Szia!', $1) returning id, created_by, preheader, subject`, [audience]);

  test('admins write drafts; nobody else reads or writes them', async () => {
    const d = await draft('admin');
    expect(d.error).toBeNull();
    expect(d.rows[0]).toMatchObject({ created_by: U.admin, preheader: null, subject: 'Őszi hírek' });
    expect((await draft('team')).error).not.toBeNull();
    expect((await draft('client')).error).not.toBeNull();
    expect((await draft('anon')).error).not.toBeNull();
    expect(await ok(db, 'team', `select id from newsletter_campaigns`)).toEqual([]);
    expect((await as(db, 'anon', `select id from newsletter_campaigns`)).error?.code).toBe('42501');
    // Status and counts are the functions' business, never a hand edit.
    expect((await as(db, 'admin', `update newsletter_campaigns set status = 'sent'`)).error?.code).toBe('42501');
    expect((await as(db, 'admin', `insert into newsletter_campaigns (subject, body, status) values ('x', 'y', 'sent')`)).error?.code).toBe('42501');
  });

  test('sending queues every confirmed subscriber of the audience, once; then the draft is frozen', async () => {
    const [c] = (await draft('owner', 'hu')).rows;
    expect((await ok(db, 'admin', `select newsletter_campaign_send($1) as n`, [c.id]))[0].n).toBe(2);
    expect(refusal(await as(db, 'admin', `select newsletter_campaign_send($1)`, [c.id]))).toBe('stratos:newsletter_not_draft');
    expect((await ok(db, 'admin', `update newsletter_campaigns set subject = 'changed' where id = $1 returning id`, [c.id]))).toEqual([]);
    expect((await ok(db, 'admin', `delete from newsletter_campaigns where id = $1 returning id`, [c.id]))).toEqual([]);
    expect((await as(db, 'team', `select newsletter_campaign_send($1)`, [c.id])).error?.code).toBe('42501');

    const empty = (await as(db, 'admin', `insert into newsletter_campaigns (subject, body, audience) values ('x', 'y', 'de') returning id`)).rows[0];
    await ok(db, 'server', `update newsletter_subscribers set status = 'unsubscribed' where email = 'd@x.example'`);
    expect(refusal(await as(db, 'admin', `select newsletter_campaign_send($1)`, [empty.id]))).toBe('stratos:newsletter_no_recipients');
    expect((await db.query(`select status from newsletter_campaigns where id = $1`, [empty.id])).rows[0]).toEqual({ status: 'draft' });
  });

  test('the dispatcher claims, sends, retries and settles; a leaver is skipped', async () => {
    const [c] = (await draft('owner', 'all')).rows;
    expect((await ok(db, 'admin', `select newsletter_campaign_send($1) as n`, [c.id]))[0].n).toBe(3);  // d left above
    await ok(db, 'server', `select * from newsletter_unsubscribe($1, 'link')`,
      [(await row(db, 'c@x.example')).unsubscribe_token]);

    const batch = await ok(db, 'server', `select * from newsletter_claim_deliveries(100)`);
    // Both campaigns are sending: two hu recipients of the first, a and b of the second.
    expect(batch.map((b) => b.email).sort()).toEqual(['a@x.example', 'a@x.example', 'b@x.example', 'b@x.example']);
    expect(batch[0]).toMatchObject({ subject: 'Őszi hírek', body: 'Szia!' });
    expect(batch[0].unsubscribe_token).toMatch(/^[0-9a-f]{64}$/);
    expect(await ok(db, 'server', `select * from newsletter_claim_deliveries(100)`)).toEqual([]);

    const of = (rows: Record<string, unknown>[], email: string) =>
      rows.filter((b) => b.campaign_id === c.id && b.email === email).map((b) => b.delivery_id);
    const [a] = of(batch, 'a@x.example');
    const [b] = of(batch, 'b@x.example');
    const other = batch.filter((x) => x.campaign_id !== c.id).map((x) => x.delivery_id);
    await ok(db, 'server', `select newsletter_deliveries_done($1::uuid[], 'sent')`, [other]);
    await ok(db, 'server', `select newsletter_deliveries_done($1::uuid[], 'released', 'resend 429')`, [[a]]);
    await ok(db, 'server', `select newsletter_deliveries_done($1::uuid[], 'failed', 'resend 422')`, [[b]]);
    expect((await ok(db, 'server', `select newsletter_campaigns_settle() as n`))[0].n).toBe(1);   // the hu one is done
    // Released costs no attempt; failed does.
    expect((await db.query(`select id, attempts from newsletter_deliveries where id in ($1, $2) order by attempts`, [a, b])).rows)
      .toEqual([{ id: a, attempts: 0 }, { id: b, attempts: 1 }]);

    const second = await ok(db, 'server', `select * from newsletter_claim_deliveries(100)`);
    expect(second.map((x) => x.delivery_id).sort()).toEqual([a, b].sort());
    await ok(db, 'server', `select newsletter_deliveries_done($1::uuid[], 'sent')`, [[a]]);
    await ok(db, 'server', `select newsletter_deliveries_done($1::uuid[], 'failed', 'resend 422')`, [[b]]);
    // The third failure gives it up.
    const third = await ok(db, 'server', `select * from newsletter_claim_deliveries(100)`);
    expect(third.map((x) => x.delivery_id)).toEqual([b]);
    await ok(db, 'server', `select newsletter_deliveries_done($1::uuid[], 'failed', 'resend 422')`, [[b]]);
    expect(await ok(db, 'server', `select * from newsletter_claim_deliveries(100)`)).toEqual([]);

    await ok(db, 'server', `select newsletter_campaigns_settle()`);
    const done = (await ok(db, 'admin', `select status, recipients, sent, failed from newsletter_campaigns where id = $1`, [c.id]))[0];
    expect(done).toEqual({ status: 'sent', recipients: 3, sent: 1, failed: 2 });
    const statuses = (await ok(db, 'admin', `select n.email, d.status from newsletter_deliveries d join newsletter_subscribers n on n.id = d.subscriber_id where d.campaign_id = $1 order by 1`, [c.id]));
    expect(statuses.map((r) => r.status)).toEqual(['sent', 'failed', 'skipped']);
  });

  test('cancelling skips what has not gone yet', async () => {
    const [c] = (await draft('admin', 'hu')).rows;
    await ok(db, 'admin', `select newsletter_campaign_send($1)`, [c.id]);
    expect((await ok(db, 'admin', `select newsletter_campaign_cancel($1) as n`, [c.id]))[0].n).toBe(2);
    expect((await ok(db, 'admin', `select status, sent, failed from newsletter_campaigns where id = $1`, [c.id]))[0])
      .toEqual({ status: 'cancelled', sent: 0, failed: 2 });
    expect(await ok(db, 'server', `select * from newsletter_claim_deliveries(100)`)).toEqual([]);
  });
});

test.describe('access', () => {
  let db: PGlite;
  test.beforeAll(async () => {
    db = await fresh();
    await subscribe(db, 'someone@example.com');
  });

  test('admins read the list, never its tokens; team members, clients and visitors read nothing', async () => {
    expect(await ok(db, 'admin', `select email, status from newsletter_subscribers order by email`)).toEqual([
      { email: 'old@reader.example', status: 'pending' },
      { email: 'second@reader.example', status: 'pending' },
      { email: 'someone@example.com', status: 'pending' },
    ]);
    for (const col of ['unsubscribe_token', 'confirm_hash', 'ip_hash']) {
      expect((await as(db, 'owner', `select ${col} from newsletter_subscribers`)).error?.code, col).toBe('42501');
    }
    expect(await ok(db, 'team', `select email from newsletter_subscribers`)).toEqual([]);
    expect(await ok(db, 'client', `select email from newsletter_subscribers`)).toEqual([]);
    expect((await as(db, 'anon', `select email from newsletter_subscribers`)).error?.code).toBe('42501');
    expect((await as(db, 'admin', `update newsletter_subscribers set status = 'confirmed'`)).error?.code).toBe('42501');
    expect((await as(db, 'admin', `insert into newsletter_subscribers (email) values ('x@y.example')`)).error?.code).toBe('42501');
  });

  test('the server functions are not callable through the API', async () => {
    for (const sql of [
      `select * from newsletter_subscribe('a@b.example', 'hu', 'newsletter', null, null)`,
      `select * from newsletter_confirm('${'a'.repeat(64)}')`,
      `select * from newsletter_unsubscribe('${'a'.repeat(64)}', 'link')`,
      `select * from newsletter_claim_deliveries(10)`,
      `select newsletter_purge()`,
      `select newsletter_new_token()`,
    ]) {
      for (const who of ['anon', 'owner'] as const) expect((await as(db, who, sql)).error?.code, `${who}: ${sql}`).toBe('42501');
    }
  });

  test('an admin unsubscribes someone by hand, or erases them', async () => {
    const [s] = await ok(db, 'admin', `select id from newsletter_subscribers where email = 'someone@example.com'`);
    expect((await as(db, 'team', `select newsletter_admin_unsubscribe($1)`, [s.id])).error?.code).toBe('42501');
    await ok(db, 'admin', `select newsletter_admin_unsubscribe($1)`, [s.id]);
    expect(await row(db, 'someone@example.com')).toMatchObject({ status: 'unsubscribed', unsubscribe_source: 'portal' });
    expect(await ok(db, 'team', `delete from newsletter_subscribers where id = $1 returning id`, [s.id])).toEqual([]);
    expect(await ok(db, 'admin', `delete from newsletter_subscribers where id = $1 returning id`, [s.id])).toEqual([{ id: s.id }]);
  });
});
