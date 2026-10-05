import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { intlLocale, registerDictionary, setLang, t } from '../portal/src/lib/i18n';

/**
 * The portal language: `profiles.locale` (20261009000100_profile_locale.sql)
 * against a real Postgres (PGlite), and the translation function itself.
 */

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const PARTS = path.join(ROOT, 'portal', 'src', 'i18n', 'parts');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { owner: id(1), anna: id(5) };

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
    const r = await db.query<Record<string, unknown>>(sql, params);
    return { rows: r.rows, affected: r.affectedRows ?? 0, error: null as null | string };
  } catch (e) {
    return { rows: [], affected: 0, error: (e as Error).message };
  } finally {
    await db.exec('reset role');
  }
}

test.describe('profiles.locale', () => {
  let db: PGlite;
  test.beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(STANDIN);
    const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_[a-z_]+\.sql$/.test(f)).sort();
    for (const file of files.filter((f) => f <= '20260928000200_owner_tracker.sql')) {
      await db.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
    }
    await db.exec(`insert into auth.users (id, email) values ('${U.owner}', 'owner@example.invalid'), ('${U.anna}', 'anna@a.example');
                   update profiles set role = 'super_admin' where id = '${U.owner}';`);
    await db.query(`select portal_set_owner('owner@example.invalid')`);
    for (const file of files.filter((f) => f > '20260928000200_owner_tracker.sql')) {
      await db.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
    }
  });

  test('starts unchosen; each user sets their own; only hu, en, de', async () => {
    expect((await as(db, 'anna', `select locale from profiles where id = $1`, [U.anna])).rows).toEqual([{ locale: null }]);
    expect((await as(db, 'anna', `update profiles set locale = 'de' where id = $1`, [U.anna])).affected).toBe(1);
    expect((await as(db, 'anna', `select locale from profiles where id = $1`, [U.anna])).rows).toEqual([{ locale: 'de' }]);
    expect((await as(db, 'anna', `update profiles set locale = 'fr' where id = $1`, [U.anna])).error).toContain('profiles_locale_check');
  });

  test('nobody sets another user\'s language', async () => {
    expect((await as(db, 'anna', `update profiles set locale = 'en' where id = $1`, [U.owner])).affected).toBe(0);
  });
});

test.describe('t()', () => {
  test('source text without a language; translation, placeholders and fallback with one', () => {
    setLang(null);
    expect(t('Projects')).toBe('Projects');
    expect(intlLocale('hu-HU')).toBe('hu-HU');
    registerDictionary('hu', { '{n} of {total}': '{n} / {total}', Projects: 'Projektek' });
    setLang('hu');
    expect(t('Projects')).toBe('Projektek');
    expect(t('{n} of {total}', { n: 3, total: 9 })).toBe('3 / 9');
    expect(t('Never translated')).toBe('Never translated');
    expect(t('{a} and {b}', { a: 1 })).toBe('1 and {b}');
    expect(intlLocale('en-GB')).toBe('hu-HU');
    setLang(null);
  });

  test('every dictionary part is valid, and keeps the placeholders of its key', () => {
    for (const name of fs.readdirSync(PARTS).filter((n) => n.endsWith('.json'))) {
      const part = JSON.parse(fs.readFileSync(path.join(PARTS, name), 'utf8')) as Record<string, Record<string, string>>;
      for (const [key, langs] of Object.entries(part)) {
        const want = (key.match(/\{\w+\}/g) ?? []).sort().join();
        for (const [lang, text] of Object.entries(langs)) {
          expect(['hu', 'en', 'de'], `${name}: ${key}`).toContain(lang);
          expect(text.trim().length, `${name}: ${key} [${lang}] is empty`).toBeGreaterThan(0);
          expect((text.match(/\{\w+\}/g) ?? []).sort().join(), `${name}: ${key} [${lang}] placeholders`).toBe(want);
        }
      }
    }
  });
});
