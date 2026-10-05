import { test, expect } from '@playwright/test';
// @ts-expect-error — plain .mjs Netlify function modules
import { compose, line, LANGS } from '../netlify/functions/notify-templates.mjs';
// @ts-expect-error — plain .mjs Netlify function modules
import { dispatch, __net, VAPID_PUBLIC_KEY } from '../netlify/functions/notify-dispatch.mjs';
import { readFileSync } from 'node:fs';

/**
 * Notifications: what they say (netlify/functions/notify-templates.mjs) and how
 * one run sends them (notify-dispatch.mjs), with a fake database and a fake
 * Resend. The database side is tests/portal-client-extras-db.spec.ts.
 */

const KINDS = ['client_upload', 'client_feedback', 'client_reschedule', 'client_reschedule_withdrawn', 'test',
  'document_shared', 'demo_published', 'meeting_scheduled', 'meeting_changed', 'meeting_cancelled', 'reschedule_decided', 'feedback_replied',
  // 20261014000100: client experience
  'client_message', 'client_approved', 'client_changes_requested', 'client_request_done', 'client_survey',
  'request_added', 'message_posted', 'approval_requested', 'survey_requested'];
const msg = (kind: string, payload: Record<string, unknown> = {}) => ({
  id: `m-${kind}`, kind, audience: kind.startsWith('client_') || kind === 'test' ? 'owner' : 'client',
  project_id: 'p1', project_name: 'Rapidkert weboldal', payload,
});

test.describe('what a notification says', () => {
  test('every kind reads in every language, with no placeholder left', () => {
    for (const kind of KINDS) {
      for (const lang of LANGS) {
        const s = line(msg(kind, { name: 'logo.png', title: 'Demó', excerpt: 'Szép', reply: 'Köszi', starts_at: '2026-10-07T08:00:00Z', decision: 'accepted', score: 9, due_on: '2026-10-12' }), lang);
        expect(s, `${kind}/${lang}`).not.toMatch(/\{\w+\}/);
        expect(s.length, `${kind}/${lang}`).toBeGreaterThan(10);
      }
    }
  });

  test('a request with a due date says the day; a survey score reads as n/10', () => {
    expect(line(msg('request_added', { title: 'Logó', due_on: '2026-10-12' }), 'hu')).toBe('Kérünk tőled valamit: Logó (határidő: október 12.)');
    expect(line(msg('request_added', { title: 'Logó' }), 'en')).toBe('We need something from you: Logó');
    expect(line({ ...msg('client_survey', { score: 9 }), client_name: 'Kovács Anna' }, 'en')).toBe('Kovács Anna rated you 9/10 (Rapidkert weboldal)');
  });

  test('a client e-mail greets, links and says who it is from; a person\'s text is escaped in HTML', () => {
    const out = compose([msg('document_shared', { name: '<b>Ár</b>ajánlat.pdf' })], { audience: 'client', lang: 'hu', name: 'Anna', origin: 'https://stratosweb.hu' });
    expect(out.subject).toBe('Újdonság a Stratos ügyfélportálon');
    expect(out.text).toContain('Szia Anna!');
    expect(out.text).toContain('https://stratosweb.hu/portal/megosztott');
    expect(out.html).toContain('&lt;b&gt;Ár&lt;/b&gt;ajánlat.pdf');
    expect(out.html).not.toContain('<b>Ár</b>');
    const de = compose([msg('demo_published', { title: 'Startseite' })], { audience: 'client', lang: 'de', name: 'Anna', origin: 'https://stratosweb.hu' });
    expect(de.text).toContain('Hallo Anna,');
    expect(de.text).toMatch(/dein/i);
  });

  test('several messages to the owner are one e-mail and one push, linking to Today', () => {
    const out = compose([msg('client_upload', { name: 'a.png' }), msg('client_feedback', { excerpt: 'x' })],
      { audience: 'owner', lang: 'en', name: 'Owner', origin: 'https://stratosweb.hu' });
    expect(out.subject).toBe('Stratos portal: 2 new events');
    expect(out.push.body).toBe('2 new events in the portal');
    expect(out.push.url).toBe('https://stratosweb.hu/portal/today');
  });
});

test.describe('one run of the sender', () => {
  function fakeDb(rows: unknown[]) {
    const done: { id: string; error: string | null }[] = [];
    const quarterly: number[] = [];
    const db = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (fn === 'notification_claim') return { data: rows, error: null };
        if (fn === 'survey_quarterly_due') { quarterly.push(1); return { data: 0, error: null }; }
        done.push({ id: args.p_id as string, error: (args.p_error as string) ?? null });
        return { data: null, error: null };
      },
      from: () => ({
        select: () => ({ in: async () => ({ data: [{ id: 'acc-1', full_name: 'Kovács Anna' }], error: null }) }),
      }),
    };
    return { db, done, quarterly };
  }

  test('each run first creates the quarterly surveys that are due', async () => {
    const { db, quarterly } = fakeDb([]);
    await dispatch(db, { origin: 'https://stratosweb.hu' });
    expect(quarterly).toEqual([1]);
  });

  test('one e-mail per person; the client is greeted in their language; sent messages are marked', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    delete process.env.VAPID_PRIVATE_KEY;
    const sent: { to: string[]; subject: string; text: string; reply_to: string; from: string }[] = [];
    const original = __net.fetch;
    __net.fetch = async (_url: string, init: { body: string }) => { sent.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); };
    try {
      const anna = { email: 'anna@a.example', name: 'Anna', locale: 'de', user_id: 'u-a' };
      const owner = { email: 'owner@example.invalid', name: 'Owner', locale: 'hu', user_id: 'u-o' };
      const { db, done } = fakeDb([
        { ...msg('demo_published', { title: 'Startseite' }), recipients: [anna] },
        { ...msg('meeting_scheduled', { title: 'Kick-off', starts_at: '2026-10-07T08:00:00Z' }), recipients: [anna] },
        { ...msg('client_upload', { name: 'logo.png', account_id: 'acc-1' }), recipients: [owner] },
        { ...msg('document_shared', { name: 'x.pdf' }), recipients: [] },
      ]);
      const r = await dispatch(db, { origin: 'https://stratosweb.hu' });
      expect(r).toMatchObject({ messages: 4, people: 2, emails: 2, failed: 0 });
      const toAnna = sent.find((s) => s.to[0] === 'anna@a.example')!;
      expect(toAnna.text).toContain('Hallo Anna,');
      expect(toAnna.text).toContain('Startseite');
      expect(toAnna.text).toContain('Kick-off');
      expect(toAnna.from).toBe('Stratos <portal@stratosweb.hu>');
      expect(toAnna.reply_to).toBe('lukacs.artur@media-stratos.com');
      const toOwner = sent.find((s) => s.to[0] === 'owner@example.invalid')!;
      expect(toOwner.subject).toContain('Kovács Anna feltöltött egy fájlt: logo.png');
      expect(done.map((d) => d.error)).toEqual([null, null, null, null]);
    } finally {
      __net.fetch = original;
    }
  });

  test('an admin who turned e-mails off gets no e-mail; the owner still does', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    delete process.env.VAPID_PRIVATE_KEY;
    const sent: { to: string[] }[] = [];
    const original = __net.fetch;
    __net.fetch = async (_url: string, init: { body: string }) => { sent.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); };
    try {
      const owner = { email: 'owner@example.invalid', name: 'Owner', locale: 'hu', user_id: 'u-o', email_on: true };
      const admin = { email: 'admin@example.invalid', name: 'Admin', locale: 'hu', user_id: 'u-a', email_on: false };
      const { db, done } = fakeDb([{ ...msg('client_upload', { name: 'logo.png' }), recipients: [owner, admin] }]);
      const r = await dispatch(db, { origin: 'https://stratosweb.hu' });
      expect(r).toMatchObject({ people: 2, emails: 1, failed: 0 });
      expect(sent.map((x) => x.to[0])).toEqual(['owner@example.invalid']);
      expect(done.map((d) => d.error)).toEqual([null]);
    } finally {
      __net.fetch = original;
    }
  });

  test('a client e-mail that fails is given back for a retry; nothing personal is logged', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    const original = __net.fetch;
    const logs: string[] = [];
    const origError = console.error;
    const origLog = console.log;
    console.error = (...a: unknown[]) => logs.push(a.join(' '));
    console.log = (...a: unknown[]) => logs.push(a.join(' '));
    __net.fetch = async () => new Response('{}', { status: 500 });
    try {
      const { db, done } = fakeDb([{ ...msg('demo_published', { title: 'X' }), recipients: [{ email: 'anna@a.example', name: 'Anna', locale: 'hu' }] }]);
      await dispatch(db, { origin: 'https://stratosweb.hu' });
      expect(done).toEqual([{ id: 'm-demo_published', error: 'resend 500' }]);
      expect(logs.join('\n')).not.toContain('anna@a.example');
    } finally {
      __net.fetch = original;
      console.error = origError;
      console.log = origLog;
    }
  });
});

test('the browser and the sender use the same VAPID public key', () => {
  const src = readFileSync(new URL('../portal/src/lib/push.ts', import.meta.url), 'utf8');
  const m = src.match(/VAPID_PUBLIC_KEY = '([^']+)'/);
  expect(m?.[1]).toBe(VAPID_PUBLIC_KEY);
  expect(VAPID_PUBLIC_KEY).toMatch(/^B[A-Za-z0-9_-]{86}$/);
});
