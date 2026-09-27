-- =============================================================================
-- Stratos — phase 4: client accounts, document sharing, "Nyersanyag leadása"
--
-- Built on the owner's private document library (20260930000100). No second
-- file system: a shared document is a row of `project_documents`, a client
-- upload is a row of `project_documents` in its project's raw-material folder,
-- and every byte stays in the one private bucket.
--
--   1. accounts        `client_accounts`: one per e-mail, bound to ONE client
--                      company, linked to an auth user only after the checks
--   2. assignments     `client_project_access`: which projects an account may
--                      use. Revoking ends everything in that project; granting
--                      again later revives nothing.
--   3. shares          `document_shares`: a file or a folder, to one account.
--                      A folder share reaches its subfolders and files added
--                      later, through the CURRENT folder tree.
--   4. raw material    one "Ügyféltől érkezett nyersanyagok" folder per project;
--                      client uploads go there, each visible only to its uploader
--   5. the client API  SECURITY DEFINER functions that return only the fields a
--                      client may see — never a project row
--   6. uploads         the library's lifecycle, types and 50 MB limit, re-checked
--                      against the CURRENT assignment at start, at signing and
--                      at finish
--   7. storage         the bucket's policies extended to a client's own pending
--                      uploads and to the documents shared with them
--   8. owner tools     invite (prepare + attach), limits, grants
--
-- WHAT A CLIENT NEVER RECEIVES
-- ----------------------------
-- No table in this file or before it is readable by a client through the API.
-- `projects`, `project_milestones`, `project_costs`, `record_notes`,
-- `project_documents`, `document_folders` stay owner-only. A client calls the
-- `client_portal_*` functions, each of which returns a fixed list of columns:
-- a project's id and name; a shared document's id, name, size, date and the
-- folder it was shared through; the client's own uploads. No checkpoint, note,
-- blocker, money figure or market value is in any of their result types, so
-- there is nothing to hide on the screen.
--
-- WHY SOME FUNCTIONS ARE SECURITY DEFINER NOW
-- -------------------------------------------
-- Phases 1–3 kept every API-callable function that touches `projects` as
-- SECURITY INVOKER. A client may not read `projects` at all, and giving them a
-- row policy would hand over every column (RLS filters rows, not columns). So
-- the client functions run with the definer's rights, check the caller's
-- account and CURRENT assignment first, and return only the columns above. The
-- test that enforced "no definer reads projects" now names exactly these
-- functions and checks nothing else crept in.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- No auth user is created here and no e-mail is sent: that is
-- netlify/functions/portal-invite.mjs, with the server key, and it returns a
-- link for the owner to send by hand. No row is deleted anywhere; revoking is a
-- timestamp. No payment schedule.
--
-- Run after 20260930000100_document_library.sql. Refuses to run otherwise.
-- =============================================================================


-- ###########################################################################
-- 0. PRECONDITIONS AND THE DEFINER'S ROLE
-- ###########################################################################

do $$
begin
  if to_regclass('public.project_documents') is null then
    raise exception 'The document library (20260930000100_document_library.sql) is not applied.';
  end if;
  if not exists (select 1 from portal_owner o join profiles p on p.id = o.user_id where p.role = 'super_admin') then
    raise exception 'No portal owner who is a super_admin is designated.';
  end if;
  if current_user in ('anon', 'authenticated') then
    raise exception 'Run this migration from the SQL editor, not as an API role.';
  end if;
end $$;

-- The role that owns the definer functions below (the SQL editor's role —
-- `postgres` on Supabase). Captured once, as a literal, so the policies can
-- name it. Whether that role has BYPASSRLS on the hosted project is unverified
-- (OWNER_TRACKER.md §1); the library's tables FORCE row security, so the
-- definer is given its own policies (§9) and works either way. API roles can
-- never become this role.
do $$
begin
  execute format(
    'create or replace function client_definer_role() returns name language sql immutable as %L',
    format('select %L::name', current_user));
end $$;


-- ###########################################################################
-- 1. ACCOUNTS
-- ###########################################################################

create table if not exists client_accounts (
  id               uuid primary key default gen_random_uuid(),
  -- The ONE company this account belongs to. Fixed: an account is never moved
  -- to another company.
  organization_id  uuid not null references organizations(id) on delete restrict,
  contact_id       uuid references client_contacts(id) on delete set null,
  email            text not null
                   check (email = lower(btrim(email)) and length(email) <= 320
                          and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  full_name        text not null check (length(btrim(full_name)) between 1 and 200),
  -- Set once, by client_invite_attach(), after the auth user exists and its
  -- profile passed every check. Until then the account opens nothing.
  user_id          uuid unique references profiles(id) on delete restrict,
  status           text not null default 'active' check (status in ('active', 'revoked')),
  invite_count     integer not null default 0,
  last_invited_at  timestamptz,
  linked_at        timestamptz,
  first_seen_at    timestamptz,
  created_by       uuid references profiles(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  revoked_by       uuid references profiles(id) on delete set null,
  check ((status = 'revoked') = (revoked_at is not null))
);

-- One account per address, ever: inviting again reuses it.
create unique index if not exists client_accounts_email_key on client_accounts (email);
create index if not exists client_accounts_org_idx on client_accounts (organization_id);

drop trigger if exists client_accounts_updated_at on client_accounts;
create trigger client_accounts_updated_at before update on client_accounts
  for each row execute function set_updated_at();

comment on table client_accounts is
  'Client portal accounts. One per e-mail, bound to one company. Opens nothing until linked to an auth user and assigned projects. Owner-only.';

-- An invite may not be repeated faster than this, per owner (§8).
create table if not exists client_invite_log (
  id        bigint generated always as identity primary key,
  actor     uuid not null default auth.uid(),
  account   uuid references client_accounts(id) on delete restrict,
  at        timestamptz not null default now()
);
create index if not exists client_invite_log_actor_at on client_invite_log (actor, at desc);


-- ###########################################################################
-- 2. PROJECT ASSIGNMENTS
-- ###########################################################################

create table if not exists client_project_access (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references client_accounts(id) on delete restrict,
  project_id  uuid not null references projects(id) on delete restrict,
  granted_by  uuid references profiles(id) on delete set null default auth.uid(),
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid references profiles(id) on delete set null
);

-- At most one LIVE assignment per account and project. A revoked row stays as
-- history; granting again inserts a new row.
create unique index if not exists client_project_access_live_key
  on client_project_access (account_id, project_id) where revoked_at is null;
create index if not exists client_project_access_project_idx on client_project_access (project_id);


-- ###########################################################################
-- 3. SHARES
-- ###########################################################################

-- A project document is addressable by (project, id), so a share can carry the
-- project and the database can refuse a share that points across projects.
do $$ begin
  alter table project_documents add constraint project_documents_project_id_id_key unique (project_id, id);
exception when duplicate_object or duplicate_table then null; end $$;

create table if not exists document_shares (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references client_accounts(id) on delete restrict,
  project_id   uuid not null references projects(id) on delete restrict,
  document_id  uuid,
  folder_id    uuid,
  granted_by   uuid references profiles(id) on delete set null default auth.uid(),
  granted_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   uuid references profiles(id) on delete set null,
  foreign key (project_id, document_id) references project_documents (project_id, id),
  foreign key (project_id, folder_id) references document_folders (project_id, id),
  check (num_nonnulls(document_id, folder_id) = 1)
);

create unique index if not exists document_shares_live_key
  on document_shares (account_id, coalesce(document_id, folder_id)) where revoked_at is null;
create index if not exists document_shares_project_idx on document_shares (project_id);

comment on table document_shares is
  'A file or folder shared with one client account. A folder share covers its subfolders and later files, through the current folder tree. Revoking is a timestamp.';


-- ###########################################################################
-- 4. RAW MATERIAL — the folder, and who uploaded what
-- ###########################################################################

alter table document_folders add column if not exists purpose text;
do $$ begin
  alter table document_folders add constraint document_folders_purpose_check
    check (purpose is null or purpose = 'client_uploads');
exception when duplicate_object then null; end $$;

-- One live raw-material folder per project. If the owner trashes it, the next
-- client upload makes a new one; the trashed one keeps its files.
create unique index if not exists document_folders_client_uploads_key
  on document_folders (project_id) where purpose = 'client_uploads' and trashed_at is null;

-- Set only by client_begin_upload(); the owner's uploads leave it null.
alter table project_documents add column if not exists client_account_id uuid references client_accounts(id) on delete restrict;
create index if not exists project_documents_client_account_idx on project_documents (client_account_id)
  where client_account_id is not null;

-- One more reason an upload can fail: its uploader lost access before it
-- finished.
alter table project_documents drop constraint if exists project_documents_failure_reason_check;
alter table project_documents add constraint project_documents_failure_reason_check
  check (failure_reason in ('network', 'too_large', 'size_mismatch', 'expired', 'cancelled',
                            'storage_refused', 'access_revoked'));

create or replace function client_uploads_folder_name() returns text
  language sql immutable as $$ select 'Ügyféltől érkezett nyersanyagok'::text $$;


-- ###########################################################################
-- 5. WHO IS ASKING — the access predicates
-- ###########################################################################

-- The caller's LIVE account: linked to this auth user, not revoked, and the
-- profile is still a plain client. A client promoted to staff, or an account
-- revoked, answers null — and every predicate below with it.
create or replace function client_account_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select a.id
  from client_accounts a
  join profiles p on p.id = a.user_id
  where a.user_id = auth.uid() and a.status = 'active' and p.role = 'client'
$$;

-- Does the caller hold a live assignment to this project, now?
create or replace function client_has_project(p_project uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from client_project_access x
    where x.account_id = client_account_id() and x.project_id = p_project and x.revoked_at is null)
$$;

-- May the caller read this document? Ready, not in the trash, in a project
-- they are assigned to NOW, and shared with them directly or through a folder
-- that CURRENTLY contains it (its folder or any folder above it). A file moved
-- out of a shared folder loses that route the moment it is moved.
create or replace function client_may_read_document(p_document uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from project_documents d
    where d.id = p_document
      and d.upload_state = 'ready' and d.trashed_at is null
      and client_has_project(d.project_id)
      and exists (
        select 1 from document_shares s
        where s.account_id = client_account_id() and s.revoked_at is null
          and s.project_id = d.project_id
          and (s.document_id = d.id
               or s.folder_id in (
                 with recursive up as (
                   select f.id, f.parent_id from document_folders f
                   where f.id = d.folder_id and f.trashed_at is null
                   union
                   select f.id, f.parent_id from document_folders f join up on f.id = up.parent_id
                   where f.trashed_at is null
                 )
                 select id from up)))
  )
$$;

-- The same, by storage key — for the storage policies.
create or replace function client_may_read_object(p_path text) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select client_may_read_document(d.id) from project_documents d where d.storage_path = p_path), false)
$$;

-- May the caller put bytes at this key? Only their OWN pending upload, in a
-- project they are assigned to NOW. Checked when an upload link is issued.
create or replace function client_may_upload_object(p_path text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project_documents d
    where d.storage_path = p_path
      and d.upload_state = 'pending' and d.trashed_at is null
      and d.client_account_id is not null
      and d.client_account_id = client_account_id()
      and client_has_project(d.project_id))
$$;


-- ###########################################################################
-- 6. ROW RULES
-- ###########################################################################

create or replace function client_account_rules() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  new.email := lower(btrim(new.email));
  new.full_name := btrim(new.full_name);

  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id then
      raise exception 'stratos:client_company_fixed' using errcode = 'P0001',
        hint = 'An account belongs to one company. Invite a new address for another company.';
    end if;
    if new.email is distinct from old.email then
      raise exception 'stratos:client_email_fixed' using errcode = 'P0001';
    end if;
    if old.user_id is not null and new.user_id is distinct from old.user_id then
      raise exception 'stratos:client_user_fixed' using errcode = 'P0001';
    end if;
    if new.status = 'revoked' and old.status <> 'revoked' then
      new.revoked_at := now();
      new.revoked_by := auth.uid();
    elsif new.status = 'active' then
      new.revoked_at := null;
      new.revoked_by := null;
    end if;
  elsif new.status = 'revoked' then
    new.revoked_at := coalesce(new.revoked_at, now());
  end if;

  if new.contact_id is not null and not exists (
    select 1 from client_contacts c where c.id = new.contact_id and c.organization_id = new.organization_id) then
    raise exception 'stratos:client_contact_other_company' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists client_accounts_rules on client_accounts;
create trigger client_accounts_rules before insert or update on client_accounts
  for each row execute function client_account_rules();

-- Revoking an account revokes every assignment it holds (and through them,
-- every share and every unfinished upload — see the next trigger).
create or replace function client_account_revoked() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'revoked' and old.status <> 'revoked' then
    update client_project_access set revoked_at = now()
     where account_id = new.id and revoked_at is null;
  end if;
  return null;
end;
$$;

drop trigger if exists client_accounts_revoked on client_accounts;
create trigger client_accounts_revoked after update on client_accounts
  for each row execute function client_account_revoked();

create or replace function client_access_rules() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  acct client_accounts;
begin
  if tg_op = 'INSERT' then
    select * into acct from client_accounts where id = new.account_id;
    if acct.status <> 'active' then
      raise exception 'stratos:client_account_revoked' using errcode = 'P0001';
    end if;
    if not exists (select 1 from projects p where p.id = new.project_id and p.organization_id = acct.organization_id) then
      raise exception 'stratos:client_project_other_company' using errcode = 'P0001',
        hint = 'A client account can only be given projects of its own company.';
    end if;
    new.revoked_at := null;
    new.revoked_by := null;
    return new;
  end if;

  -- UPDATE: the only change there is, is revoking, once.
  if new.account_id is distinct from old.account_id or new.project_id is distinct from old.project_id
     or new.granted_at is distinct from old.granted_at or new.granted_by is distinct from old.granted_by then
    raise exception 'stratos:client_access_fixed' using errcode = 'P0001';
  end if;
  if old.revoked_at is not null then
    if new.revoked_at is distinct from old.revoked_at then
      raise exception 'stratos:client_access_revoked_final' using errcode = 'P0001',
        hint = 'A revoked assignment stays revoked. Grant the project again instead.';
    end if;
    return new;
  end if;
  if new.revoked_at is not null then
    new.revoked_at := now();
    new.revoked_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists client_project_access_rules on client_project_access;
create trigger client_project_access_rules before insert or update on client_project_access
  for each row execute function client_access_rules();

-- Losing a project ends everything in it: every share (they stay revoked if
-- the project is granted again later) and every upload still in flight (so a
-- file arriving later through an old link can never become a document).
create or replace function client_access_revoked() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.revoked_at is not null and old.revoked_at is null then
    update document_shares set revoked_at = now()
     where account_id = new.account_id and project_id = new.project_id and revoked_at is null;
    update project_documents set upload_state = 'failed', failure_reason = 'access_revoked'
     where client_account_id = new.account_id and project_id = new.project_id and upload_state = 'pending';
  end if;
  return null;
end;
$$;

drop trigger if exists client_project_access_revoked on client_project_access;
create trigger client_project_access_revoked after update on client_project_access
  for each row execute function client_access_revoked();

create or replace function client_share_rules() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from client_accounts a where a.id = new.account_id and a.status = 'active') then
      raise exception 'stratos:client_account_revoked' using errcode = 'P0001';
    end if;
    if not exists (select 1 from client_project_access x
                   where x.account_id = new.account_id and x.project_id = new.project_id and x.revoked_at is null) then
      raise exception 'stratos:share_not_assigned' using errcode = 'P0001',
        hint = 'Assign the project to this client account before sharing anything in it.';
    end if;
    if new.document_id is not null and exists (
         select 1 from project_documents d where d.id = new.document_id
           and (d.trashed_at is not null or d.upload_state <> 'ready')) then
      raise exception 'stratos:share_not_shareable' using errcode = 'P0001',
        hint = 'Only finished files outside the trash can be shared.';
    end if;
    if new.folder_id is not null and exists (
         select 1 from document_folders f where f.id = new.folder_id and f.trashed_at is not null) then
      raise exception 'stratos:share_not_shareable' using errcode = 'P0001';
    end if;
    new.revoked_at := null;
    new.revoked_by := null;
    return new;
  end if;

  if new.account_id is distinct from old.account_id or new.project_id is distinct from old.project_id
     or new.document_id is distinct from old.document_id or new.folder_id is distinct from old.folder_id then
    raise exception 'stratos:share_fixed' using errcode = 'P0001';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'stratos:share_revoked_final' using errcode = 'P0001',
      hint = 'Share it again instead.';
  end if;
  if old.revoked_at is null and new.revoked_at is not null then
    new.revoked_at := now();
    new.revoked_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists document_shares_rules on document_shares;
create trigger document_shares_rules before insert or update on document_shares
  for each row execute function client_share_rules();

-- A client's upload becomes a document only while its uploader still has the
-- project. Runs before `project_documents_rules` (triggers fire in name order):
-- instead of `ready`, such a row becomes `failed: access_revoked`, whoever
-- asked — the client, the owner's reconcile, or a direct PATCH.
create or replace function client_upload_rules() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.client_account_id is distinct from old.client_account_id then
    raise exception 'stratos:document_fact_fixed' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.client_account_id is not null
     and new.upload_state = 'ready' and old.upload_state <> 'ready'
     and not exists (
       select 1 from client_project_access x
       join client_accounts a on a.id = x.account_id
       where x.account_id = new.client_account_id and x.project_id = new.project_id
         and x.revoked_at is null and a.status = 'active') then
    new.upload_state := 'failed';
    new.failure_reason := 'access_revoked';
  end if;
  return new;
end;
$$;

drop trigger if exists project_documents_client_rules on project_documents;
create trigger project_documents_client_rules before insert or update on project_documents
  for each row execute function client_upload_rules();

-- The library's finish now answers with the state the row actually reached
-- (a client upload may have been turned away above), not the one it asked for.
create or replace function document_finish_upload(p_id uuid) returns text
  language plpgsql volatile security invoker set search_path = public as $$
declare
  d project_documents;
  stored bigint;
begin
  select * into d from project_documents where id = p_id for update;
  if not found then
    raise exception 'stratos:document_not_found' using errcode = 'P0002';
  end if;
  if d.upload_state = 'ready' then
    return 'ready';
  end if;

  stored := document_object_size(d.storage_path);
  if stored is null then
    return 'missing';
  end if;
  if stored > document_max_bytes() then
    update project_documents set upload_state = 'failed', failure_reason = 'too_large' where id = p_id;
    return 'failed';
  end if;
  if stored <> d.byte_size then
    update project_documents set upload_state = 'failed', failure_reason = 'size_mismatch' where id = p_id;
    return 'failed';
  end if;

  update project_documents set upload_state = 'ready' where id = p_id
    returning upload_state into d.upload_state;
  return d.upload_state;
end;
$$;


-- ###########################################################################
-- 7. THE CLIENT API — fixed columns, current access, nothing else
-- ###########################################################################

-- Who am I, for the header. No id of anything internal.
create or replace function client_portal_me()
returns table (full_name text, company text)
  language sql stable security definer set search_path = public as $$
  select a.full_name, o.name
  from client_accounts a join organizations o on o.id = a.organization_id
  where a.id = client_account_id()
$$;

-- "Projektjeim": the id and the name. Nothing else about a project leaves the
-- database for a client. The first call stamps when the account was first used.
create or replace function client_portal_projects()
returns table (project_id uuid, project_name text)
  language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := client_account_id();
begin
  if me is null then
    return;
  end if;
  update client_accounts set first_seen_at = now() where id = me and first_seen_at is null;
  return query
    select p.id, p.name
    from client_project_access x join projects p on p.id = x.project_id
    where x.account_id = me and x.revoked_at is null
    order by p.name;
end;
$$;

-- "Megosztott dokumentumok": what is shared with the caller right now. `via`
-- says whether through a folder (and which) or directly.
create or replace function client_portal_documents()
returns table (document_id uuid, project_id uuid, project_name text, name text, byte_size bigint,
               shared_at timestamptz, via_folder text)
  language sql stable security definer set search_path = public as $$
  select d.id, d.project_id, p.name, d.name, d.byte_size, coalesce(d.completed_at, d.created_at),
         case
           when exists (select 1 from document_shares s
                        where s.account_id = client_account_id() and s.document_id = d.id and s.revoked_at is null)
           then null
           else (select f.name
                 from document_shares s join document_folders f on f.id = s.folder_id
                 where s.account_id = client_account_id() and s.revoked_at is null
                   and s.folder_id in (
                     with recursive up as (
                       select f2.id, f2.parent_id from document_folders f2 where f2.id = d.folder_id
                       union
                       select f3.id, f3.parent_id from document_folders f3 join up on f3.id = up.parent_id
                     ) select up.id from up)
                 order by f.name limit 1)
         end
  from project_documents d join projects p on p.id = d.project_id
  where d.upload_state = 'ready' and d.trashed_at is null
    and client_may_read_document(d.id)
  order by p.name, d.name
$$;

-- "Nyersanyag leadása": the caller's OWN uploads, in projects they still have.
-- Another client's uploads to the same project are not here.
create or replace function client_portal_uploads()
returns table (document_id uuid, project_id uuid, project_name text, name text, byte_size bigint,
               uploaded_at timestamptz, state text, failure_reason text)
  language sql stable security definer set search_path = public as $$
  select d.id, d.project_id, p.name, d.name, d.byte_size, d.created_at, d.upload_state, d.failure_reason
  from project_documents d join projects p on p.id = d.project_id
  where d.client_account_id = client_account_id()
    and d.trashed_at is null
    and client_has_project(d.project_id)
  order by d.created_at desc
  limit 500
$$;


-- ###########################################################################
-- 8. CLIENT UPLOADS
-- ###########################################################################

-- Limits per account, on the server: a mistake or a stolen session cannot
-- fill the bucket. (Each file is also capped at document_max_bytes().)
create or replace function client_upload_limits()
returns table (max_pending integer, max_per_day integer, max_bytes_per_day bigint)
  language sql immutable as $$ select 10, 200, 2147483648::bigint $$;

create or replace function client_begin_upload(
  p_project uuid, p_name text, p_size bigint, p_type text default null, p_kind text default null
) returns table (id uuid, name text, storage_path text)
  language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  me uuid := client_account_id();
  lim record;
  folder uuid;
  clean text := document_clean_name(p_name);
  created project_documents;
begin
  if me is null or not client_has_project(p_project) then
    raise exception 'stratos:client_no_access' using errcode = '42501';
  end if;
  if p_size is null or p_size < 0 then
    raise exception 'stratos:document_size_unknown' using errcode = 'P0001';
  end if;
  if p_size > document_max_bytes() then
    raise exception 'stratos:document_too_large' using errcode = 'P0001';
  end if;
  if not document_type_allowed(clean, p_kind) then
    raise exception 'stratos:document_type_not_allowed' using errcode = 'P0001';
  end if;

  -- One begin at a time per account, so the limits below are counted against
  -- what the previous call committed. Without it, simultaneous calls each
  -- counted the same state and all passed (15 of 15 on a real Postgres,
  -- scripts/pg-integration-check.mjs). Transaction-scoped: released at commit.
  perform pg_advisory_xact_lock(hashtextextended('stratos:client_upload:' || me::text, 0));

  select * into lim from client_upload_limits();
  if (select count(*) from project_documents d
      where d.client_account_id = me and d.upload_state = 'pending') >= lim.max_pending then
    raise exception 'stratos:client_upload_limit' using errcode = 'P0001',
      detail = 'Too many uploads in progress. Wait for them to finish.';
  end if;
  if (select count(*) from project_documents d
      where d.client_account_id = me and d.created_at > now() - interval '24 hours') >= lim.max_per_day
     or (select coalesce(sum(d.byte_size), 0) from project_documents d
         where d.client_account_id = me and d.created_at > now() - interval '24 hours') + p_size > lim.max_bytes_per_day then
    raise exception 'stratos:client_upload_limit' using errcode = 'P0001',
      detail = 'The daily upload allowance is used up.';
  end if;

  perform document_lock(p_project);
  select f.id into folder from document_folders f
   where f.project_id = p_project and f.purpose = 'client_uploads' and f.trashed_at is null;
  if folder is null then
    insert into document_folders (project_id, parent_id, name, purpose, created_by)
    values (p_project, null,
            document_free_name(p_project, null, client_uploads_folder_name(), null, 'folder'),
            'client_uploads', auth.uid())
    returning document_folders.id into folder;
  end if;

  insert into project_documents (project_id, folder_id, name, byte_size, declared_type, content_kind, client_account_id)
  values (p_project, folder, document_free_name(p_project, folder, clean), p_size,
          nullif(left(btrim(coalesce(p_type, '')), 200), ''), p_kind, me)
  returning * into created;

  return query select created.id, created.name, created.storage_path;
end;
$$;

-- The client's own row, while they still have the project. Anything else —
-- another client's upload, a shared document, a guessed id — is "not found".
create or replace function client_own_upload(p_id uuid) returns project_documents
  language sql stable security definer set search_path = public as $$
  select d.* from project_documents d
  where d.id = p_id and d.client_account_id = client_account_id() and d.client_account_id is not null
$$;

create or replace function client_finish_upload(p_id uuid) returns text
  language plpgsql volatile security definer set search_path = public as $$
declare
  d project_documents := client_own_upload(p_id);
  stored bigint;
  reached text;
begin
  if d.id is null then
    raise exception 'stratos:document_not_found' using errcode = 'P0002';
  end if;
  if d.upload_state = 'ready' then
    return 'ready';
  end if;
  if not client_has_project(d.project_id) then
    update project_documents set upload_state = 'failed', failure_reason = 'access_revoked'
     where id = p_id and upload_state <> 'ready';
    return 'failed';
  end if;
  if d.upload_state <> 'pending' then
    return d.upload_state;
  end if;

  select (o.metadata->>'size')::bigint into stored
  from storage.objects o where o.bucket_id = document_bucket() and o.name = d.storage_path;
  if stored is null then
    return 'missing';
  end if;
  if stored > document_max_bytes() then
    update project_documents set upload_state = 'failed', failure_reason = 'too_large' where id = p_id;
    return 'failed';
  end if;
  if stored <> d.byte_size then
    update project_documents set upload_state = 'failed', failure_reason = 'size_mismatch' where id = p_id;
    return 'failed';
  end if;
  update project_documents set upload_state = 'ready' where id = p_id returning upload_state into reached;
  return reached;
end;
$$;

-- The client marks an upload failed (dropped connection, cancelled) or tries
-- it again. Only their own, only while they have the project, only these
-- reasons, and never a finished one.
create or replace function client_mark_upload(p_id uuid, p_state text, p_reason text default null) returns text
  language plpgsql volatile security definer set search_path = public as $$
declare
  d project_documents := client_own_upload(p_id);
begin
  if d.id is null then
    raise exception 'stratos:document_not_found' using errcode = 'P0002';
  end if;
  if not client_has_project(d.project_id) then
    raise exception 'stratos:client_no_access' using errcode = '42501';
  end if;
  if p_state = 'failed' and d.upload_state = 'pending' and p_reason in ('network', 'cancelled', 'storage_refused') then
    update project_documents set upload_state = 'failed', failure_reason = p_reason where id = p_id;
  elsif p_state = 'pending' and d.upload_state = 'failed'
        and d.failure_reason in ('network', 'cancelled', 'storage_refused', 'expired') then
    update project_documents set upload_state = 'pending' where id = p_id;
  else
    raise exception 'stratos:client_upload_state' using errcode = 'P0001';
  end if;
  return (select upload_state from project_documents where id = p_id);
end;
$$;


-- ###########################################################################
-- 9. THE OWNER'S INVITE — prepare, then (after the auth user exists) attach
-- ###########################################################################

-- Step 1, as the owner, before any auth user is touched. Idempotent per
-- e-mail. Refuses — before anything is created — an address that belongs to
-- staff or to another company. Grants the chosen projects, but an account opens
-- nothing until step 2 links it.
create or replace function client_invite_prepare(
  p_organization uuid, p_contact uuid, p_name text, p_email text, p_projects uuid[] default '{}'
) returns table (account_id uuid, user_id uuid, email text)
  language plpgsql volatile security invoker set search_path = public as $$
#variable_conflict use_column
declare
  addr text := lower(btrim(coalesce(p_email, '')));
  prof record;
  acct client_accounts;
  proj uuid;
begin
  if not is_owner() then
    raise exception 'stratos:owner_only' using errcode = '42501';
  end if;
  -- Invitations are prepared one at a time (a handful a day), so a double
  -- submit waits for the first and then finds its account instead of failing
  -- on the unique e-mail, and the hourly limit counts what was committed.
  perform pg_advisory_xact_lock(hashtextextended('stratos:client_invite', 0));
  if (select count(*) from client_invite_log l where l.actor = auth.uid() and l.at > now() - interval '1 hour') >= 30 then
    raise exception 'stratos:invite_limit' using errcode = 'P0001',
      detail = 'At most 30 invitations an hour.';
  end if;
  if addr !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'stratos:client_email_invalid' using errcode = 'P0001';
  end if;

  select p.id, p.role, p.organization_id into prof from profiles p where lower(p.email) = addr limit 1;
  if prof.id is not null and prof.role <> 'client' then
    raise exception 'stratos:client_email_is_staff' using errcode = 'P0001',
      hint = 'This address belongs to a staff account. Its role is not changed.';
  end if;
  if prof.id is not null and prof.organization_id is not null and prof.organization_id <> p_organization then
    raise exception 'stratos:client_other_company' using errcode = 'P0001',
      hint = 'This address belongs to another company''s account. It is not moved.';
  end if;

  select * into acct from client_accounts a where a.email = addr;
  if acct.id is not null and acct.organization_id <> p_organization then
    raise exception 'stratos:client_other_company' using errcode = 'P0001';
  end if;

  if acct.id is null then
    insert into client_accounts (organization_id, contact_id, email, full_name)
    values (p_organization, p_contact, addr, p_name)
    returning * into acct;
  else
    update client_accounts
       set full_name = coalesce(nullif(btrim(p_name), ''), full_name),
           contact_id = coalesce(p_contact, contact_id),
           status = 'active'
     where id = acct.id
     returning * into acct;
  end if;

  foreach proj in array coalesce(p_projects, '{}') loop
    if not exists (select 1 from client_project_access x
                   where x.account_id = acct.id and x.project_id = proj and x.revoked_at is null) then
      insert into client_project_access (account_id, project_id) values (acct.id, proj);
    end if;
  end loop;

  update client_accounts set invite_count = invite_count + 1, last_invited_at = now() where id = acct.id;
  insert into client_invite_log (account) values (acct.id);
  return query select acct.id, acct.user_id, acct.email;
end;
$$;

-- Step 2, as the owner, once the auth user exists. Links the account to THAT
-- user only if the user's own profile carries the account's e-mail, is a plain
-- client, and belongs to no other company — so a crafted call cannot attach an
-- admin, a staff member or someone else's client. Idempotent.
create or replace function client_invite_attach(p_account uuid, p_user uuid) returns void
  language plpgsql volatile security invoker set search_path = public as $$
declare
  acct client_accounts;
  prof profiles;
begin
  if not is_owner() then
    raise exception 'stratos:owner_only' using errcode = '42501';
  end if;
  select * into acct from client_accounts where id = p_account for update;
  if acct.id is null then
    raise exception 'stratos:client_account_not_found' using errcode = 'P0002';
  end if;
  if acct.status <> 'active' then
    raise exception 'stratos:client_account_revoked' using errcode = 'P0001';
  end if;
  if acct.user_id is not null then
    if acct.user_id = p_user then return; end if;
    raise exception 'stratos:client_user_fixed' using errcode = 'P0001';
  end if;

  select * into prof from profiles where id = p_user;
  if prof.id is null or lower(prof.email) <> acct.email then
    raise exception 'stratos:client_user_mismatch' using errcode = 'P0001';
  end if;
  if prof.role <> 'client' then
    raise exception 'stratos:client_email_is_staff' using errcode = 'P0001';
  end if;
  if prof.organization_id is not null and prof.organization_id <> acct.organization_id then
    raise exception 'stratos:client_other_company' using errcode = 'P0001';
  end if;

  if prof.organization_id is null then
    update profiles set organization_id = acct.organization_id where id = p_user;
  end if;
  update client_accounts set user_id = p_user, linked_at = now() where id = acct.id;
end;
$$;


-- ###########################################################################
-- 10. STORAGE — client reads and client uploads, inside the same guards
-- ###########################################################################

drop policy if exists project_documents_client_select on storage.objects;
drop policy if exists project_documents_client_insert on storage.objects;
drop policy if exists project_documents_definer_select on storage.objects;
drop policy if exists project_documents_guard_select on storage.objects;
drop policy if exists project_documents_guard_insert on storage.objects;

-- A client may read (download, sign a download link for) exactly the objects
-- shared with them now, and put bytes only at their own pending upload's key.
create policy project_documents_client_select on storage.objects
  as permissive for select to authenticated
  using (bucket_id = 'project-documents' and public.client_may_read_object(name));

create policy project_documents_client_insert on storage.objects
  as permissive for insert to authenticated
  with check (bucket_id = 'project-documents' and public.client_may_upload_object(name));

-- The definer functions read an object's size to finish a client upload.
do $$ begin
  execute format(
    'create policy project_documents_definer_select on storage.objects as permissive for select to %I '
    'using (bucket_id = %L)', client_definer_role(), 'project-documents');
end $$;

-- The guards, widened by exactly the two client paths and the definer. Update
-- and delete stay refused for everyone (unchanged from 20260930000100).
do $$ begin
  execute format($f$
    create policy project_documents_guard_select on storage.objects
      as restrictive for select
      using (bucket_id <> 'project-documents' or public.is_owner()
             or public.client_may_read_object(name) or current_user = %L)$f$, client_definer_role());
end $$;

create policy project_documents_guard_insert on storage.objects
  as restrictive for insert
  with check (
    bucket_id <> 'project-documents'
    or (public.is_owner()
        and exists (select 1 from public.project_documents d
                    where d.storage_path = objects.name and d.upload_state = 'pending' and d.trashed_at is null
                      and d.client_account_id is null))
    or public.client_may_upload_object(name)
  );

-- The owner's own insert policy: the owner signs only their OWN pending
-- uploads, not a client's.
drop policy if exists project_documents_owner_insert on storage.objects;
create policy project_documents_owner_insert on storage.objects
  as permissive for insert to authenticated
  with check (
    bucket_id = 'project-documents'
    and public.is_owner()
    and exists (select 1 from public.project_documents d
                where d.storage_path = objects.name and d.upload_state = 'pending' and d.trashed_at is null
                  and d.client_account_id is null)
  );


-- ###########################################################################
-- 11. ACCESS TO THE NEW TABLES AND FUNCTIONS
-- ###########################################################################

alter table client_accounts        enable row level security;
alter table client_accounts        force  row level security;
alter table client_project_access  enable row level security;
alter table client_project_access  force  row level security;
alter table document_shares        enable row level security;
alter table document_shares        force  row level security;
alter table client_invite_log      enable row level security;
alter table client_invite_log      force  row level security;

do $$
declare
  t text;
  f text;
begin
  foreach t in array array['client_accounts', 'client_project_access', 'document_shares', 'client_invite_log'] loop
    execute format('drop policy if exists %I on %I', t || '_owner_all', t);
    execute format('create policy %I on %I for all using (is_owner()) with check (is_owner())', t || '_owner_all', t);
    execute format('drop policy if exists %I on %I', t || '_definer_all', t);
    execute format('create policy %I on %I for all to %I using (true) with check (true)', t || '_definer_all', t, client_definer_role());
    execute format('revoke all on table %I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', t);
      -- Owner-only by the policy above. Never DELETE: revoking is a timestamp.
      execute format('grant select, insert, update on table %I to authenticated', t);
    end if;
  end loop;

  -- The library's own tables: the definer may write a client's upload and its
  -- folder whether or not its role bypasses RLS (they FORCE row security).
  foreach t in array array['project_documents', 'document_folders'] loop
    execute format('drop policy if exists %I on %I', t || '_definer_all', t);
    execute format('create policy %I on %I for all to %I using (true) with check (true)', t || '_definer_all', t, client_definer_role());
  end loop;

  foreach f in array array[
    'client_account_id()', 'client_has_project(uuid)', 'client_may_read_document(uuid)',
    'client_may_read_object(text)', 'client_may_upload_object(text)',
    'client_portal_me()', 'client_portal_projects()', 'client_portal_documents()', 'client_portal_uploads()',
    'client_begin_upload(uuid, text, bigint, text, text)', 'client_finish_upload(uuid)',
    'client_mark_upload(uuid, text, text)', 'client_own_upload(uuid)',
    'client_invite_prepare(uuid, uuid, text, text, uuid[])', 'client_invite_attach(uuid, uuid)',
    'client_upload_limits()', 'client_uploads_folder_name()', 'client_definer_role()'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;

  -- A client may not fetch another client's row through this helper directly.
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke execute on function client_own_upload(uuid) from authenticated';
  end if;
end $$;

-- The storage policies call these as the caller: anon must be able to
-- evaluate them (and get false).
do $$
declare f text;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    foreach f in array array['client_may_read_object(text)', 'client_may_upload_object(text)',
                             'client_account_id()', 'client_has_project(uuid)', 'client_may_read_document(uuid)'] loop
      execute format('grant execute on function %s to anon', f);
    end loop;
  end if;
end $$;
