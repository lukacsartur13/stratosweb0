-- =============================================================================
-- Demo links, meetings, help centre (phase 7) — VERIFY. Run in the SQL editor
-- after 20261004000100 and 20261004000200. One transaction ending in ROLLBACK;
-- impersonates every profile. Every row should read `ok`.
-- =============================================================================

begin;

create temp table verify_result (check_name text, ok boolean, detail text) on commit drop;
grant insert, select on verify_result to authenticated, anon;

insert into verify_result
select 'phase-7 tables force RLS',
       (select bool_and(c.relrowsecurity and c.relforcerowsecurity) and count(*) = 3 from pg_class c
        where c.relname in ('project_demos', 'project_meetings', 'help_articles') and c.relnamespace = 'public'::regnamespace), null
union all
select 'no DELETE and no anon access on phase-7 tables',
       not exists (select 1 from unnest(array['project_demos', 'project_meetings', 'help_articles']) t
                   where has_table_privilege('authenticated', t, 'delete') or has_table_privilege('anon', t, 'select')), null
union all
select 'the client functions return fixed columns',
       (select string_agg(p.proname || ':' || array_to_string(p.proargnames[p.pronargs + 1:], ','), ' ' order by p.proname) from pg_proc p
        where p.proname in ('client_portal_demos', 'client_portal_meetings', 'client_help_articles') and p.pronamespace = 'public'::regnamespace)
       -- `translations` from 20261010000100_help_translations.sql (before it, the column is absent).
       in ('client_help_articles:article_id,question,answer,topic,alt_questions client_portal_demos:demo_id,project_id,project_name,title,url,note,updated_at client_portal_meetings:meeting_id,project_id,project_name,title,starts_at,ends_at,time_zone,join_url,location,note,cancelled',
           'client_help_articles:article_id,question,answer,topic,alt_questions,translations client_portal_demos:demo_id,project_id,project_name,title,url,note,updated_at client_portal_meetings:meeting_id,project_id,project_name,title,starts_at,ends_at,time_zone,join_url,location,note,cancelled'),
       null
union all
select 'phase-8 tables force RLS (when applied)',
       to_regclass('public.demo_feedback') is null or (
         select bool_and(c.relrowsecurity and c.relforcerowsecurity) and count(*) = 2 from pg_class c
         where c.relname in ('demo_feedback', 'meeting_change_requests') and c.relnamespace = 'public'::regnamespace), null
union all
select 'no DELETE on phase-8 tables; no direct UPDATE of a reschedule request (decisions go through the owner function)',
       to_regclass('public.demo_feedback') is null or (
         not has_table_privilege('authenticated', 'demo_feedback', 'delete')
         and not has_table_privilege('authenticated', 'meeting_change_requests', 'delete')
         and not has_table_privilege('authenticated', 'meeting_change_requests', 'update')
         and not has_table_privilege('authenticated', 'meeting_change_requests', 'insert')
         and not has_table_privilege('authenticated', 'demo_feedback', 'insert')
         and not has_table_privilege('anon', 'demo_feedback', 'select')
         and not has_table_privilege('anon', 'meeting_change_requests', 'select')), null
union all
select 'every stored demo and join link passes the URL rule',
       not exists (select 1 from project_demos where not portal_safe_https_url(url))
       and not exists (select 1 from project_meetings where join_url is not null and not portal_safe_https_url(join_url)), null;

create temp table verify_seen (user_id uuid, article_id uuid) on commit drop;
grant insert on verify_seen to authenticated;

do $$
declare
  u record;
  foreign_demos bigint; foreign_meetings bigint; drafts bigint; direct bigint; owner_like boolean;
begin
  for u in select p.id, p.email, p.role from profiles p order by p.role, p.email limit 200 loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    owner_like := is_owner();
    -- Demos and meetings of a project the caller has NO live assignment to.
    select count(*) into foreign_demos from client_portal_demos() d where not client_has_project(d.project_id);
    select count(*) into foreign_meetings from client_portal_meetings() m where not client_has_project(m.project_id);
    insert into verify_seen select u.id, h.article_id from client_help_articles() h;
    direct := case when owner_like then 0 else
      (select count(*) from project_demos) + (select count(*) from project_meetings) + (select count(*) from help_articles) end;
    execute 'reset role';
    select count(*) into drafts from verify_seen v join help_articles h on h.id = v.article_id
      where v.user_id = u.id and h.status <> 'published';
    insert into verify_result values (
      format('%s (%s): own projects only, no draft article, no direct table read', u.email, u.role),
      foreign_demos = 0 and foreign_meetings = 0 and drafts = 0 and direct = 0,
      format('foreign demos %s, foreign meetings %s, drafts %s, direct rows %s', foreign_demos, foreign_meetings, drafts, direct));
  end loop;

  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';
  begin
    perform * from client_help_articles();
    insert into verify_result values ('anon: no help, demo or meeting function', false, 'client_help_articles answered anon');
  exception when insufficient_privilege then
    execute 'reset role';
    insert into verify_result values ('anon: no help, demo or meeting function', true, null);
  end;
end $$;

select * from verify_result order by ok, check_name;

rollback;
