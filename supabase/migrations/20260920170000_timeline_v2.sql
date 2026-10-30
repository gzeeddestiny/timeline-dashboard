-- Additive V2 workspace. No changes to legacy tables, triggers, cron or Sheets.
begin;
create table public.v2_plans (
  task_key text primary key references public.tasks_current(task_key),
  start_date date, end_date date, version integer not null default 1,
  updated_by uuid not null, updated_at timestamptz not null default now(),
  check ((start_date is null and end_date is null) or (start_date is not null and end_date is not null and start_date <= end_date))
);
create table public.v2_dependencies (
  predecessor text references public.tasks_current(task_key), successor text references public.tasks_current(task_key),
  created_by uuid not null, created_at timestamptz not null default now(),
  primary key(predecessor, successor), check(predecessor <> successor)
);
create table public.v2_saved_views (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null,
  name text not null check(length(name) between 1 and 80), config jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table public.v2_layouts (
  owner_id uuid primary key, layout jsonb not null default '[]', updated_at timestamptz not null default now()
);
create table public.v2_comments (
  id uuid primary key default gen_random_uuid(), task_key text not null references public.tasks_current(task_key),
  author_id uuid not null, author_email text not null, body text not null check(length(body) between 1 and 5000),
  version integer not null default 1, deleted boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.v2_mentions (
  id uuid primary key default gen_random_uuid(), comment_id uuid not null references public.v2_comments(id),
  task_key text not null references public.tasks_current(task_key), recipient_email text not null,
  actor_email text not null, read_at timestamptz, created_at timestamptz not null default now(),
  unique(comment_id, recipient_email)
);
create table public.v2_events (
  id uuid primary key default gen_random_uuid(), task_key text references public.tasks_current(task_key),
  action text not null, actor_email text not null, payload jsonb not null default '{}', created_at timestamptz not null default now()
);
create index v2_comments_task on public.v2_comments(task_key, created_at);
create index v2_mentions_recipient on public.v2_mentions(recipient_email, created_at);
create index v2_events_task on public.v2_events(task_key, created_at);

alter table public.v2_plans enable row level security;
alter table public.v2_dependencies enable row level security;
alter table public.v2_saved_views enable row level security;
alter table public.v2_layouts enable row level security;
alter table public.v2_comments enable row level security;
alter table public.v2_mentions enable row level security;
alter table public.v2_events enable row level security;
create policy v2_plans_read on public.v2_plans for select to authenticated using (private.is_active_user());
create policy v2_dependencies_read on public.v2_dependencies for select to authenticated using (private.is_active_user());
create policy v2_views_read on public.v2_saved_views for select to authenticated using (private.is_active_user() and owner_id = auth.uid());
create policy v2_layout_read on public.v2_layouts for select to authenticated using (private.is_active_user() and owner_id = auth.uid());
create policy v2_comments_read on public.v2_comments for select to authenticated using (private.is_active_user() and not deleted);
create policy v2_mentions_read on public.v2_mentions for select to authenticated using (private.is_active_user() and recipient_email = private.current_email());
create policy v2_events_read on public.v2_events for select to authenticated using (private.is_active_user());
revoke all on public.v2_plans, public.v2_dependencies, public.v2_saved_views, public.v2_layouts, public.v2_comments, public.v2_mentions, public.v2_events from anon, authenticated;
grant select on public.v2_plans, public.v2_dependencies, public.v2_saved_views, public.v2_layouts, public.v2_comments, public.v2_mentions, public.v2_events to authenticated;
grant all on public.v2_plans, public.v2_dependencies, public.v2_saved_views, public.v2_layouts, public.v2_comments, public.v2_mentions, public.v2_events to service_role;

-- All writes pass through this authenticated, validated boundary. Private UI
-- preferences cannot be saved for another user; actors are never client supplied.
create function public.v2_mutate(p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); v_actor_email text := private.current_email();
  k text := p_payload->>'taskKey'; old_plan public.v2_plans;
  comment_row public.v2_comments; result jsonb; identifier uuid;
  before_key text; after_key text; start_day date; end_day date;
begin
  if actor is null or not private.is_active_user() then raise exception 'Access denied' using errcode = '42501'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 65536 then raise exception 'Invalid payload'; end if;
  if p_action in ('plan','comment') then
    if k is null or not exists(select 1 from public.tasks_current where task_key = k and active) then raise exception 'Task unavailable'; end if;
  end if;
  if p_action = 'plan' then
    perform pg_advisory_xact_lock(hashtextextended('v2-plan:' || k, 0));
    select * into old_plan from public.v2_plans where task_key = k;
    if (p_payload->>'expectedVersion') is null or (p_payload->>'expectedVersion')::integer <> coalesce(old_plan.version, 0) then
      raise exception 'PLAN_CONFLICT: reload the latest plan' using errcode = '40001';
    end if;
    if nullif(p_payload->>'startDate','') is not null and (p_payload->>'startDate') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid start date'; end if;
    if nullif(p_payload->>'endDate','') is not null and (p_payload->>'endDate') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid end date'; end if;
    start_day := nullif(p_payload->>'startDate','')::date;
    end_day := nullif(p_payload->>'endDate','')::date;
    insert into public.v2_plans(task_key,start_date,end_date,updated_by) values(k,start_day,end_day,actor)
    on conflict(task_key) do update set start_date=excluded.start_date,end_date=excluded.end_date,version=v2_plans.version+1,updated_by=actor,updated_at=now()
    returning to_jsonb(v2_plans.*) into result;
  elsif p_action in ('dependency','remove_dependency') then
    -- Serialize graph edits to reject cycles even for concurrent transactions.
    perform pg_advisory_xact_lock(920261700);
    before_key := p_payload->>'predecessor'; after_key := p_payload->>'successor'; k := after_key;
    if before_key = after_key or before_key is null or after_key is null then raise exception 'Invalid dependency'; end if;
    if p_action = 'dependency' then
      if (select count(*) from public.tasks_current where active and task_key in (before_key,after_key)) <> 2 then raise exception 'Task unavailable'; end if;
      if exists(with recursive reachable(key) as (
        select successor from public.v2_dependencies where predecessor=after_key
        union select d.successor from public.v2_dependencies d join reachable r on d.predecessor=r.key
      ) select 1 from reachable where key=before_key) then raise exception 'DEPENDENCY_CYCLE'; end if;
      insert into public.v2_dependencies(predecessor,successor,created_by) values(before_key,after_key,actor) on conflict do nothing;
    else
      delete from public.v2_dependencies where predecessor=before_key and successor=after_key;
    end if;
    result := jsonb_build_object('predecessor',before_key,'successor',after_key);
  elsif p_action = 'view' then
    identifier := coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());
    if jsonb_typeof(p_payload->'config') is distinct from 'object' then raise exception 'Invalid view config'; end if;
    insert into public.v2_saved_views(id,owner_id,name,config) values(identifier,actor,trim(p_payload->>'name'),p_payload->'config')
    on conflict(id) do update set name=excluded.name,config=excluded.config,updated_at=now() where v2_saved_views.owner_id=actor
    returning to_jsonb(v2_saved_views.*) into result;
    if result is null then raise exception 'Access denied' using errcode='42501'; end if;
    return result;
  elsif p_action = 'remove_view' then
    delete from public.v2_saved_views where id=(p_payload->>'id')::uuid and owner_id=actor;
    return '{}'::jsonb;
  elsif p_action = 'layout' then
    if jsonb_typeof(p_payload->'layout') is distinct from 'array' or jsonb_array_length(p_payload->'layout') > 20 then raise exception 'Invalid layout'; end if;
    insert into public.v2_layouts(owner_id,layout) values(actor,p_payload->'layout')
    on conflict(owner_id) do update set layout=excluded.layout,updated_at=now() returning to_jsonb(v2_layouts.*) into result;
    return result;
  elsif p_action = 'comment' then
    identifier := coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());
    select * into comment_row from public.v2_comments where id=identifier for update;
    if found then
      if comment_row.task_key <> k or comment_row.deleted or (comment_row.author_id <> actor and not private.is_admin()) then raise exception 'Access denied' using errcode='42501'; end if;
      if (p_payload->>'expectedVersion') is null or comment_row.version <> (p_payload->>'expectedVersion')::integer then raise exception 'COMMENT_CONFLICT' using errcode='40001'; end if;
      update public.v2_comments set body=trim(p_payload->>'body'),version=version+1,updated_at=now() where id=identifier returning to_jsonb(v2_comments.*) into result;
    else
      insert into public.v2_comments(id,task_key,author_id,author_email,body) values(identifier,k,actor,v_actor_email,trim(p_payload->>'body')) returning to_jsonb(v2_comments.*) into result;
    end if;
    -- Explicitly selected member names resolve to approved active accounts only.
    insert into public.v2_mentions(comment_id,task_key,recipient_email,actor_email)
    select identifier,k,a.email,v_actor_email from public.access_list a
    where a.active and a.email <> v_actor_email and a.member_name in (select jsonb_array_elements_text(coalesce(p_payload->'mentions','[]')))
    on conflict(comment_id,recipient_email) do nothing;
  elsif p_action = 'remove_comment' then
    select * into comment_row from public.v2_comments where id=(p_payload->>'id')::uuid for update;
    if not found or (comment_row.author_id <> actor and not private.is_admin()) then raise exception 'Access denied' using errcode='42501'; end if;
    if (p_payload->>'expectedVersion') is null or comment_row.version <> (p_payload->>'expectedVersion')::integer then raise exception 'COMMENT_CONFLICT' using errcode='40001'; end if;
    k := comment_row.task_key;
    update public.v2_comments set deleted=true,version=version+1,updated_at=now() where id=comment_row.id;
    delete from public.v2_mentions where comment_id=comment_row.id;
    result := jsonb_build_object('id',comment_row.id);
  elsif p_action = 'read_mention' then
    update public.v2_mentions set read_at=coalesce(read_at,now()) where id=(p_payload->>'id')::uuid and recipient_email=v_actor_email;
    return '{}'::jsonb;
  else raise exception 'Unknown V2 action';
  end if;
  insert into public.v2_events(task_key,action,actor_email,payload) values(k,p_action,v_actor_email,result);
  return result;
end;
$$;
revoke all on function public.v2_mutate(text,jsonb) from public, anon;
grant execute on function public.v2_mutate(text,jsonb) to authenticated;

-- When sync_detected_activity ran before this migration, attach its activity triggers now.
do $$ begin
 if to_regprocedure('private.track_v2_plan_activity()') is not null then
   drop trigger if exists track_v2_plan_activity on public.v2_plans;
   create trigger track_v2_plan_activity after insert or update on public.v2_plans
   for each row execute function private.track_v2_plan_activity();
 end if;
 if to_regprocedure('private.track_v2_comment_activity()') is not null then
   drop trigger if exists track_v2_comment_activity on public.v2_comments;
   create trigger track_v2_comment_activity after insert or update on public.v2_comments
   for each row execute function private.track_v2_comment_activity();
 end if;
end $$;
commit;
