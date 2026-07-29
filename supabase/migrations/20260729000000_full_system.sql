create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

do $$ begin
  create type public.app_role as enum ('employee', 'manager', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.workflow_status as enum ('not_started', 'in_progress', 'waiting_client', 'blocked');
exception when duplicate_object then null; end $$;

create table if not exists public.access_list (
  email text primary key check (email = lower(trim(email))),
  role public.app_role not null default 'employee',
  member_name text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sheets (
  spreadsheet_id text primary key,
  url text not null,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_members (
  name text primary key,
  role text not null check (role in ('creative', 'ae', 'media', 'pm')),
  avatar text not null default '',
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.brands (
  tab_key text primary key,
  brand_name text not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.assignments (
  brand_key text primary key check (length(brand_key) between 1 and 200),
  value jsonb not null default '{}'::jsonb check (jsonb_typeof(value) = 'object' and octet_length(value::text) <= 10000),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks_current (
  task_key text primary key,
  task_id text not null,
  spreadsheet_id text not null,
  sheet_gid bigint not null,
  row_index integer not null,
  client_name text not null,
  month text,
  topic text not null,
  responsibility text not null default '',
  due_date date,
  actual_submit date,
  done boolean not null default false,
  active boolean not null default true,
  removed_at timestamptz,
  source_synced_at timestamptz not null default now(),
  unique (spreadsheet_id, sheet_gid, task_id)
);

alter table public.tasks_current add column if not exists task_id text;
alter table public.tasks_current add column if not exists active boolean not null default true;
alter table public.tasks_current add column if not exists removed_at timestamptz;
alter table public.tasks_current drop constraint if exists tasks_current_spreadsheet_id_sheet_gid_row_index_key;

alter table public.tasks_current drop constraint if exists tasks_current_spreadsheet_id_fkey;
alter table public.tasks_current add constraint tasks_current_spreadsheet_id_fkey
  foreign key (spreadsheet_id) references public.sheets(spreadsheet_id) on delete restrict;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_current_stable_task_key') then
    alter table public.tasks_current add constraint tasks_current_stable_task_key unique (spreadsheet_id, sheet_gid, task_id);
  end if;
end $$;

create index if not exists tasks_current_due_date_idx on public.tasks_current (due_date);
create index if not exists tasks_current_sheet_idx on public.tasks_current (spreadsheet_id);

create table if not exists public.task_workflow (
  task_key text primary key references public.tasks_current(task_key),
  status public.workflow_status not null default 'not_started',
  note text not null default '' check (length(note) <= 5000),
  priority text check (priority is null or priority in ('fire', 'think')),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.task_workflow drop constraint if exists task_workflow_task_key_fkey;
alter table public.task_workflow add constraint task_workflow_task_key_fkey
  foreign key (task_key) references public.tasks_current(task_key) on delete restrict;

create table if not exists public.task_aliases (
  legacy_task_key text primary key,
  task_key text not null references public.tasks_current(task_key) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('running', 'success', 'failed')),
  trigger_type text not null default 'client' check (trigger_type in ('client', 'manual', 'migration')),
  triggered_by uuid references auth.users(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  task_count integer,
  invalid_row_count integer not null default 0,
  issues jsonb not null default '[]'::jsonb,
  error text
);

create unique index if not exists one_running_sync_idx on public.sync_runs ((status)) where status = 'running';
create index if not exists sync_runs_finished_idx on public.sync_runs (finished_at desc);

create table if not exists public.task_events (
  id bigint generated always as identity primary key,
  resource text not null,
  record_key text not null,
  event_type text not null check (event_type in ('insert', 'update', 'delete')),
  before_value jsonb,
  after_value jsonb,
  actor uuid references auth.users(id),
  actor_email text,
  created_at timestamptz not null default now()
);

alter table public.task_events add column if not exists actor_email text;

create index if not exists task_events_record_idx on public.task_events (resource, record_key, created_at desc);
create index if not exists task_events_created_idx on public.task_events (created_at desc);

create table if not exists public.daily_metrics (
  snapshot_date date not null,
  dimension text not null check (dimension in ('overall', 'month', 'person', 'month_person')),
  dimension_key text not null,
  metrics jsonb not null,
  source_sync_id uuid references public.sync_runs(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (snapshot_date, dimension, dimension_key)
);

alter table public.daily_metrics drop constraint if exists daily_metrics_dimension_check;
alter table public.daily_metrics add constraint daily_metrics_dimension_check
  check (dimension in ('overall', 'month', 'person', 'month_person'));

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  type text not null check (type in ('assignment', 'blocked', 'due', 'stale')),
  task_key text,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_idx on public.notifications (recipient_email, created_at desc);

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  template text not null check (template in ('urgent', 'daily_digest', 'stale')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sent', 'cancelled', 'failed')),
  scheduled_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create or replace function private.current_email()
returns text language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function private.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.access_list
    where email = private.current_email() and active
  )
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.access_list
    where email = private.current_email() and active and role = 'admin'
  )
$$;

create or replace function private.stamp_authenticated_actor()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function private.protect_last_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.active and old.role = 'admin' and (
    TG_OP = 'DELETE' or not new.active or new.role <> 'admin'
  ) and (select count(*) from public.access_list where active and role = 'admin') <= 1 then
    raise exception 'Cannot remove or disable the last active admin';
  end if;
  return case when TG_OP = 'DELETE' then old else new end;
end $$;

drop trigger if exists protect_last_admin on public.access_list;
create trigger protect_last_admin before update or delete on public.access_list
for each row execute function private.protect_last_admin();

drop trigger if exists stamp_workflow_actor on public.task_workflow;
create trigger stamp_workflow_actor before insert or update on public.task_workflow
for each row execute function private.stamp_authenticated_actor();
drop trigger if exists stamp_assignment_actor on public.assignments;
create trigger stamp_assignment_actor before insert or update on public.assignments
for each row execute function private.stamp_authenticated_actor();
drop trigger if exists stamp_brand_actor on public.brands;
create trigger stamp_brand_actor before insert or update on public.brands
for each row execute function private.stamp_authenticated_actor();
drop trigger if exists stamp_team_actor on public.team_members;
create trigger stamp_team_actor before insert or update on public.team_members
for each row execute function private.stamp_authenticated_actor();

create or replace function private.archive_tasks_for_disabled_sheet()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.active and not new.active then
    update public.tasks_current set active = false, removed_at = now()
    where spreadsheet_id = new.spreadsheet_id and active;
  end if;
  return new;
end $$;

drop trigger if exists archive_disabled_sheet_tasks on public.sheets;
create trigger archive_disabled_sheet_tasks after update of active on public.sheets
for each row execute function private.archive_tasks_for_disabled_sheet();

create or replace function public.rename_brand(old_name text, new_name text, tab_keys text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  old_key text := regexp_replace(lower(trim(old_name)), '\s+', ' ', 'g');
  new_key text := regexp_replace(lower(trim(new_name)), '\s+', ' ', 'g');
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  if new_key = '' or coalesce(array_length(tab_keys, 1), 0) = 0 then raise exception 'Invalid brand rename'; end if;
  if old_key <> new_key and exists (select 1 from public.assignments where brand_key = new_key) then
    raise exception 'The target brand already has an assignment';
  end if;
  if old_key <> new_key and exists (select 1 from public.assignments where brand_key = old_key) then
    insert into public.assignments(brand_key, value, updated_by, updated_at)
    select new_key, value, auth.uid(), now() from public.assignments where brand_key = old_key;
    delete from public.assignments where brand_key = old_key;
  end if;
  update public.brands set brand_name = trim(new_name), updated_by = auth.uid(), updated_at = now()
  where tab_key = any(tab_keys) and brand_name = old_name;
end $$;

revoke execute on function public.rename_brand(text, text, text[]) from public, anon;
grant execute on function public.rename_brand(text, text, text[]) to authenticated;

create or replace function private.audit_shared_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  record_key text;
  actor_id uuid;
  actor_mail text;
begin
  record_key := case TG_TABLE_NAME
    when 'task_workflow' then coalesce(new.task_key, old.task_key)
    when 'assignments' then coalesce(new.brand_key, old.brand_key)
    when 'brands' then coalesce(new.tab_key, old.tab_key)
  end;
  actor_id := case when TG_OP = 'DELETE'
    then coalesce(old.updated_by, auth.uid())
    else coalesce(new.updated_by, auth.uid())
  end;
  select email into actor_mail from auth.users where id = actor_id;
  insert into public.task_events(resource, record_key, event_type, before_value, after_value, actor, actor_email)
  values (
    TG_TABLE_NAME,
    record_key,
    lower(TG_OP),
    to_jsonb(old),
    to_jsonb(new),
    actor_id,
    actor_mail
  );
  return coalesce(new, old);
end $$;

drop trigger if exists audit_task_workflow on public.task_workflow;
create trigger audit_task_workflow after insert or update or delete on public.task_workflow
for each row execute function private.audit_shared_change();

drop trigger if exists audit_assignments on public.assignments;
create trigger audit_assignments after insert or update or delete on public.assignments
for each row execute function private.audit_shared_change();

drop trigger if exists audit_brands on public.brands;
create trigger audit_brands after insert or update or delete on public.brands
for each row execute function private.audit_shared_change();

create or replace function private.queue_daily_digest()
returns integer language plpgsql security definer set search_path = public as $$
declare
  queued integer;
  latest_sync timestamptz;
begin
  select max(finished_at) into latest_sync from public.sync_runs where status = 'success';
  insert into public.email_outbox(recipient_email, template, payload, scheduled_at)
  select email, 'daily_digest', jsonb_build_object(
    'dataAsOf', latest_sync,
    'stale', latest_sync is null or latest_sync < now() - interval '24 hours'
  ), now()
  from public.access_list where active;
  get diagnostics queued = row_count;
  return queued;
end $$;

create or replace function private.purge_operational_history()
returns void language sql security definer set search_path = public as $$
  delete from public.daily_metrics where snapshot_date < current_date - 365;
  delete from public.sync_runs where started_at < now() - interval '90 days';
$$;

revoke execute on function private.queue_daily_digest() from public, anon, authenticated;
grant execute on function private.queue_daily_digest() to service_role;
revoke execute on function private.purge_operational_history() from public, anon, authenticated;
grant execute on function private.purge_operational_history() to service_role;

alter table public.access_list enable row level security;
alter table public.sheets enable row level security;
alter table public.team_members enable row level security;
alter table public.brands enable row level security;
alter table public.assignments enable row level security;
alter table public.tasks_current enable row level security;
alter table public.task_workflow enable row level security;
alter table public.task_aliases enable row level security;
alter table public.sync_runs enable row level security;
alter table public.task_events enable row level security;
alter table public.daily_metrics enable row level security;
alter table public.notifications enable row level security;
alter table public.email_outbox enable row level security;

drop policy if exists access_list_read on public.access_list;
create policy access_list_read on public.access_list for select to authenticated
using ((select private.is_admin()) or email = (select private.current_email()));
drop policy if exists access_list_admin_write on public.access_list;
create policy access_list_admin_write on public.access_list for all to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists sheets_read on public.sheets;
create policy sheets_read on public.sheets for select to authenticated using ((select private.is_active_user()));
drop policy if exists sheets_admin_write on public.sheets;
drop policy if exists sheets_admin_insert on public.sheets;
drop policy if exists sheets_admin_update on public.sheets;
create policy sheets_admin_insert on public.sheets for insert to authenticated
with check ((select private.is_admin()));
create policy sheets_admin_update on public.sheets for update to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists team_read on public.team_members;
create policy team_read on public.team_members for select to authenticated using ((select private.is_active_user()));
drop policy if exists team_admin_write on public.team_members;
create policy team_admin_write on public.team_members for all to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists brands_read on public.brands;
create policy brands_read on public.brands for select to authenticated using ((select private.is_active_user()));
drop policy if exists brands_admin_write on public.brands;
create policy brands_admin_write on public.brands for all to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists assignments_read on public.assignments;
create policy assignments_read on public.assignments for select to authenticated using ((select private.is_active_user()));
drop policy if exists assignments_write on public.assignments;
drop policy if exists assignments_admin_write on public.assignments;
create policy assignments_write on public.assignments for all to authenticated
using ((select private.is_active_user())) with check ((select private.is_active_user()));

drop policy if exists tasks_read on public.tasks_current;
create policy tasks_read on public.tasks_current for select to authenticated using ((select private.is_active_user()) and active);

drop policy if exists aliases_read on public.task_aliases;
create policy aliases_read on public.task_aliases for select to authenticated using ((select private.is_active_user()));

drop policy if exists workflow_read on public.task_workflow;
create policy workflow_read on public.task_workflow for select to authenticated using ((select private.is_active_user()));
drop policy if exists workflow_write on public.task_workflow;
drop policy if exists workflow_insert on public.task_workflow;
drop policy if exists workflow_update on public.task_workflow;
create policy workflow_insert on public.task_workflow for insert to authenticated
with check ((select private.is_active_user()));
create policy workflow_update on public.task_workflow for update to authenticated
using ((select private.is_active_user())) with check ((select private.is_active_user()));

drop policy if exists sync_runs_read on public.sync_runs;
create policy sync_runs_read on public.sync_runs for select to authenticated using ((select private.is_active_user()));
drop policy if exists events_read on public.task_events;
create policy events_read on public.task_events for select to authenticated using ((select private.is_active_user()));
drop policy if exists metrics_read on public.daily_metrics;
create policy metrics_read on public.daily_metrics for select to authenticated using ((select private.is_active_user()));

drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
using ((select private.is_active_user()) and lower(recipient_email) = (select private.current_email()));
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
using (lower(recipient_email) = (select private.current_email()))
with check (lower(recipient_email) = (select private.current_email()));

-- Notification/outbox creation and all source-table writes are performed by
-- authenticated Vercel Functions using the server-only Supabase secret key.

-- Realtime is additive and idempotent. Polling remains the fallback.
do $$
declare
  target text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach target in array array[
      'public.access_list',
      'public.task_workflow',
      'public.assignments',
      'public.brands',
      'public.notifications',
      'public.tasks_current',
      'public.sync_runs',
      'public.task_events'
    ] loop
      if not exists (
        select 1 from pg_publication_rel
        where prpubid = (select oid from pg_publication where pubname = 'supabase_realtime')
          and prrelid = to_regclass(target)
      ) then
        execute format('alter publication supabase_realtime add table %s', target);
      end if;
    end loop;
  end if;
end $$;
