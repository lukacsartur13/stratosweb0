import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { buildIndex, fullyTranslated, localise, reply, type HelpArticle } from '../portal/src/lib/helpMatcher';

/**
 * The help centre in English and German (20261010000100_help_translations.sql)
 * against a real Postgres (PGlite), and the assistant answering in them.
 */

test.describe.configure({ mode: 'serial' });

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const TRANSLATIONS = '20261010000100_help_translations.sql';
const read = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), anna: id(5) };
const ORG = id(101);
const PROJECT = id(201);

const STANDIN = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid
  $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables    to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, owner uuid, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
    name text not null, owner uuid, metadata jsonb, created_at timestamptz default now(), unique (bucket_id, name));
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  grant select on storage.buckets to anon, authenticated;
`;

async function as(db: PGlite, who: keyof typeof U, sql: string, params: unknown[] = []) {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: U[who], role: 'authenticated' })]);
  await db.exec('set role authenticated');
  try {
    return { rows: (await db.query<Record<string, unknown>>(sql, params)).rows, error: null as null | string };
  } catch (e) {
    return { rows: [], error: (e as Error).message };
  } finally {
    await db.exec('reset role');
  }
}

let db: PGlite;
let articles: HelpArticle[] = [];

test.beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STANDIN);
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_[a-z_]+\.sql$/.test(f)).sort();
  for (const file of files.filter((f) => f <= '20260928000200_owner_tracker.sql')) await db.exec(read(file));
  await db.exec(`insert into auth.users (id, email) values ('${U.owner}', 'owner@example.invalid'), ('${U.anna}', 'anna@a.example');
                 update profiles set role = 'super_admin' where id = '${U.owner}';
                 insert into organizations (id, name, slug, status) values ('${ORG}', 'A Kft.', 'a', 'active');
                 insert into projects (id, organization_id, name, slug, status, currency) values ('${PROJECT}', '${ORG}', 'Web', 'web', 'active', 'HUF');`);
  await db.query(`select portal_set_owner('owner@example.invalid')`);
  for (const file of files.filter((f) => f > '20260928000200_owner_tracker.sql' && f < TRANSLATIONS)) await db.exec(read(file));
  // An article the owner edited in the Portal before the translations arrive.
  await db.exec(`update help_articles set answer = answer || ' (szerkesztve)' where slug = 'web-branding-1'`);
  for (const file of files.filter((f) => f >= TRANSLATIONS)) await db.exec(read(file));
  const [acct] = (await as(db, 'owner', `select * from client_invite_prepare($1, null, 'Anna', 'anna@a.example', $2::uuid[])`, [ORG, [PROJECT]])).rows;
  await as(db, 'owner', `select client_invite_attach($1, $2)`, [acct.account_id, U.anna]);
  articles = (await as(db, 'anna', `select * from client_help_articles()`)).rows as unknown as HelpArticle[];
});

test('every seeded article is translated, except one the owner had edited', async () => {
  const r = await db.query<{ slug: string; en: boolean; de: boolean }>(
    `select slug, translations ? 'en' as en, translations ? 'de' as de from help_articles where slug is not null order by slug`);
  expect(r.rows.length).toBe(74);
  const missing = r.rows.filter((x) => !x.en || !x.de).map((x) => x.slug);
  expect(missing).toEqual(['web-branding-1']);
});

test('the website\'s own English and German are used, in the site\'s informal German', async () => {
  const [row] = (await db.query<{ tr: { en: { question: string }; de: { question: string; answer: string } } }>(
    `select translations as tr from help_articles where slug = 'web-branding-2'`)).rows;
  // Exactly the website's English and German for this FAQ entry (_build/i18n/branding.json).
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, '_build', 'i18n', 'branding.json'), 'utf8')) as Record<string, string[]>;
  expect([row.tr.en.question, row.tr.de.question]).toEqual(site['Mi a különbség egy logó és egy komplett arculat között?']);
  expect(row.tr.de.answer).toMatch(/\b(du|dein|deine|dir)\b/i);
});

test('the shape is enforced: only en/de, each with question, answer and topic', async () => {
  const bad = [
    `{"fr": {"question": "Quoi ?", "answer": "Oui", "topic": "Web"}}`,
    `{"en": {"question": "Hi", "answer": "Yes", "topic": "Web"}}`,
    `{"en": {"question": "Where is it?", "answer": "", "topic": "Web"}}`,
    `{"en": {"question": "Where is it?", "answer": "Here", "topic": "Web", "alt_questions": "x"}}`,
  ];
  for (const tr of bad) {
    const r = await as(db, 'owner', `update help_articles set translations = $1::jsonb where slug = 'web-branding-1'`, [tr]);
    expect(r.error, tr).toContain('help_articles_translations_check');
  }
  const ok = await as(db, 'owner', `update help_articles set translations = $1::jsonb where slug = 'web-branding-1'`,
    [`{"en": {"question": "Where is it?", "answer": "Here", "topic": "Web", "alt_questions": ["where"]}}`]);
  expect(ok.error).toBeNull();
});

test('the client receives the translations, and the assistant answers in English and German', async () => {
  expect(articles.length).toBeGreaterThanOrEqual(70);
  expect(articles.every((a) => a.translations && typeof a.translations === 'object')).toBe(true);

  const en = buildIndex(localise(articles, 'en'));
  const upload = reply(en, 'Where do I upload the logo?');
  expect(upload.kind).toBe('answer');
  if (upload.kind === 'answer') expect(upload.article.answer).toContain('Hand over materials');

  const de = buildIndex(localise(articles, 'de'));
  const time = reply(de, 'Wie kann ich einen anderen Termin vorschlagen?');
  expect(time.kind).toBe('answer');
  if (time.kind === 'answer') expect(time.article.answer).toContain('Neue Zeit vorschlagen');

  // Hungarian is unchanged.
  const hu = reply(buildIndex(localise(articles, null)), 'Hol adhatom le a logót?');
  expect(hu.kind).toBe('answer');
  if (hu.kind === 'answer') expect(hu.article.answer).toContain('Nyersanyag leadása');
});

test('an article without a language falls back to Hungarian, and says so', async () => {
  const one = [{ article_id: 'x', question: 'Kérdés?', answer: 'Válasz.', topic: 'Téma', alt_questions: [] }];
  expect(localise(one, 'de')[0].answer).toBe('Válasz.');
  expect(fullyTranslated(one, 'de')).toBe(false);
  expect(fullyTranslated(one, null)).toBe(true);
});
