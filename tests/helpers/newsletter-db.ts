import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

/**
 * A real Postgres (PGlite) with every migration up to and including the
 * newsletter (20261019000100) and everything after it, for the newsletter
 * and automatic e-mail tests. `seed` runs just before the newsletter migration
 * (old newsletter leads, for the import); `between` right after it, before
 * the later ones (someone already subscribed when the automations arrive).
 */

const MIGRATIONS = path.join(process.cwd(), 'supabase', 'migrations');
export const NEWSLETTER = '20261019000100_newsletter.sql';
export const readMigration = (file: string) => fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const U = { owner: id(1), admin: id(3), team: id(4), client: id(5) } as const;

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
  create table storage.buckets (
    id text primary key, name text not null, owner uuid, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[],
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
    name text not null, owner uuid, metadata jsonb, created_at timestamptz default now(),
    unique (bucket_id, name));
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  grant select on storage.buckets to anon, authenticated;
  insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);
`;

export async function freshNewsletterDb(seed = '', between = ''): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STANDIN);
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_[a-z_]+\.sql$/.test(f)).sort();
  for (const file of files.filter((f) => f <= '20260928000200_owner_tracker.sql')) await db.exec(readMigration(file));
  await db.exec(`
    insert into auth.users (id, email) values
      ('${U.owner}', 'owner@example.invalid'), ('${U.admin}', 'admin@example.invalid'),
      ('${U.team}', 'team@example.invalid'), ('${U.client}', 'client@example.invalid');
    update profiles set role = 'super_admin' where id = '${U.owner}';
    update profiles set role = 'admin' where id = '${U.admin}';
    update profiles set role = 'team_member' where id = '${U.team}';
  `);
  await db.query(`select portal_set_owner('owner@example.invalid')`);
  for (const file of files.filter((f) => f > '20260928000200_owner_tracker.sql' && f < NEWSLETTER)) await db.exec(readMigration(file));
  if (seed) await db.exec(seed);
  await db.exec(readMigration(NEWSLETTER));
  if (between) await db.exec(between);
  for (const file of files.filter((f) => f > NEWSLETTER)) await db.exec(readMigration(file));
  return db;
}

/**
 * The server key's `rpc`, as PostgREST answers it: a set-returning function
 * gives its rows, a scalar one its value. Runs as the database owner, which
 * — like the service role — reads past RLS.
 */
export function rpcAdapter(db: PGlite) {
  return {
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      const names = Object.keys(args);
      const sql = `select * from ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;
      try {
        const r = await db.query<Record<string, unknown>>(sql, names.map((n) => args[n]));
        const cols = r.fields.map((f) => f.name);
        if (cols.length === 1 && cols[0] === fn) return { data: r.rows[0]?.[fn] ?? null, error: null };
        return { data: r.rows, error: null };
      } catch (error) {
        const e = error as { code?: string; message: string };
        return { data: null, error: { code: e.code ?? 'error', message: e.message } };
      }
    },
  };
}
