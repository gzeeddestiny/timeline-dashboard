-- Brand workstreams, contract rounds and milestone overrides.
-- Task dates remain sourced from Google Sheets; this migration adds only the
-- operational metadata needed to group and monitor them.

create table if not exists public.brand_workstreams (
  id uuid primary key default gen_random_uuid(),
  brand_key text not null check (length(brand_key) between 1 and 200),
  brand_name text not null check (length(trim(brand_name)) between 1 and 300),
  name text not null check (length(trim(name)) between 1 and 300),
  workstream_type text not null default 'other' check (workstream_type in ('always_on', 'production', 'other')),
  owner_member text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (brand_key, name)
);

create table if not exists public.brand_workstream_sources (
  workstream_id uuid not null references public.brand_workstreams(id) on delete cascade,
  tab_key text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.contract_rounds (
  id uuid primary key default gen_random_uuid(),
  workstream_id uuid not null references public.brand_workstreams(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  term_months integer check (term_months is null or term_months in (3, 6, 9, 12)),
  notes text not null default '' check (length(notes) <= 5000),
  document_url text check (document_url is null or (length(document_url) <= 2000 and document_url ~ '^https://')),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists contract_rounds_workstream_dates_idx
  on public.contract_rounds (workstream_id, start_date, end_date);

create table if not exists public.milestone_overrides (
  task_key text primary key,
  milestone_type text not null check (milestone_type in ('present_idea', 'draft_1', 'none')),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.notifications add column if not exists contract_id uuid references public.contract_rounds(id) on delete cascade;
alter table public.notifications add column if not exists notification_key text;
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('assignment', 'blocked', 'due', 'stale', 'contract_expiry'));
create unique index if not exists notifications_dedupe_key_idx
  on public.notifications (notification_key);

create or replace function private.normalized_brand_key(value text)
returns text language sql immutable as $$
  select regexp_replace(lower(trim(coalesce(value, ''))), '\s+', ' ', 'g')
$$;

create or replace function private.stamp_brand_timeline_actor()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists stamp_brand_workstream_actor on public.brand_workstreams;
create trigger stamp_brand_workstream_actor before insert or update on public.brand_workstreams
for each row execute function private.stamp_brand_timeline_actor();
drop trigger if exists stamp_contract_round_actor on public.contract_rounds;
create trigger stamp_contract_round_actor before insert or update on public.contract_rounds
for each row execute function private.stamp_brand_timeline_actor();

create or replace function public.save_brand_workstream(
  p_brand_key text,
  p_brand_name text,
  p_name text,
  p_workstream_type text,
  p_owner_member text,
  p_source_tab_keys text[],
  p_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  target_id uuid := p_id;
  normalized_key text := private.normalized_brand_key(p_brand_key);
  source_count integer := coalesce(array_length(p_source_tab_keys, 1), 0);
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  if normalized_key = '' or trim(coalesce(p_brand_name, '')) = '' or trim(coalesce(p_name, '')) = '' then
    raise exception 'Brand, workstream name and brand key are required';
  end if;
  if p_workstream_type not in ('always_on', 'production', 'other') then
    raise exception 'Invalid workstream type';
  end if;
  if source_count <> (select count(distinct value) from unnest(coalesce(p_source_tab_keys, '{}'::text[])) as source(value)) then
    raise exception 'Duplicate source tab';
  end if;
  if exists (
    select 1 from public.brand_workstream_sources s
    where s.tab_key = any(coalesce(p_source_tab_keys, '{}'::text[]))
      and (target_id is null or s.workstream_id <> target_id)
  ) then raise exception 'A source tab is already assigned to another workstream'; end if;

  if target_id is null then
    insert into public.brand_workstreams (brand_key, brand_name, name, workstream_type, owner_member, created_by)
    values (normalized_key, trim(p_brand_name), trim(p_name), p_workstream_type, nullif(trim(p_owner_member), ''), auth.uid())
    returning id into target_id;
  else
    update public.brand_workstreams
    set brand_key = normalized_key,
        brand_name = trim(p_brand_name),
        name = trim(p_name),
        workstream_type = p_workstream_type,
        owner_member = nullif(trim(p_owner_member), ''),
        active = true
    where id = target_id;
    if not found then raise exception 'Workstream not found'; end if;
  end if;

  delete from public.brand_workstream_sources where workstream_id = target_id;
  insert into public.brand_workstream_sources (workstream_id, tab_key)
  select target_id, value from unnest(coalesce(p_source_tab_keys, '{}'::text[])) as source(value);
  return target_id;
end $$;

create or replace function public.save_brand_contract(
  p_workstream_id uuid,
  p_start_date date,
  p_end_date date,
  p_term_months integer,
  p_notes text,
  p_document_url text,
  p_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  target_id uuid := p_id;
  stream_type text;
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  select workstream_type into stream_type from public.brand_workstreams where id = p_workstream_id and active;
  if stream_type is null then raise exception 'Workstream not found'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then raise exception 'Invalid contract dates'; end if;
  if stream_type = 'always_on' and p_term_months not in (3, 6, 9, 12) then raise exception 'Always-on contracts require a 3, 6, 9 or 12 month term'; end if;
  if stream_type <> 'always_on' and p_term_months is not null then raise exception 'Only Always-on contracts use a fixed term'; end if;
  if p_document_url is not null and (length(p_document_url) > 2000 or p_document_url !~ '^https://') then raise exception 'Document URL must be an https URL'; end if;
  -- Serialize writes per workstream so two Admins cannot pass the overlap
  -- check at the same time and create intersecting contract rounds.
  perform pg_advisory_xact_lock(hashtextextended(p_workstream_id::text, 0));
  if exists (
    select 1 from public.contract_rounds c
    where c.workstream_id = p_workstream_id
      and c.status <> 'cancelled'
      and c.id <> coalesce(target_id, gen_random_uuid())
      and daterange(c.start_date, c.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
  ) then raise exception 'Contract rounds cannot overlap for one workstream'; end if;

  if target_id is null then
    insert into public.contract_rounds (workstream_id, start_date, end_date, term_months, notes, document_url, created_by)
    values (p_workstream_id, p_start_date, p_end_date, p_term_months, left(coalesce(p_notes, ''), 5000), nullif(trim(p_document_url), ''), auth.uid())
    returning id into target_id;
  else
    update public.contract_rounds
    set start_date = p_start_date,
        end_date = p_end_date,
        term_months = p_term_months,
        notes = left(coalesce(p_notes, ''), 5000),
        document_url = nullif(trim(p_document_url), '')
    where id = target_id and workstream_id = p_workstream_id;
    if not found then raise exception 'Contract not found'; end if;
  end if;
  return target_id;
end $$;

create or replace function public.set_brand_contract_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  if p_status not in ('closed', 'cancelled', 'open') then raise exception 'Invalid contract status'; end if;
  update public.contract_rounds
  set status = p_status,
      closed_by = case when p_status = 'open' then null else auth.uid() end,
      closed_at = case when p_status = 'open' then null else now() end
  where id = p_id;
  if not found then raise exception 'Contract not found'; end if;
end $$;

create or replace function public.save_milestone_override(p_task_key text, p_milestone_type text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  if p_milestone_type not in ('present_idea', 'draft_1', 'none', 'auto') then raise exception 'Invalid milestone type'; end if;
  if p_milestone_type = 'auto' then
    delete from public.milestone_overrides where task_key = p_task_key;
  else
    insert into public.milestone_overrides (task_key, milestone_type, updated_by, updated_at)
    values (p_task_key, p_milestone_type, auth.uid(), now())
    on conflict (task_key) do update set milestone_type = excluded.milestone_type, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
end $$;

revoke execute on function public.save_brand_workstream(text,text,text,text,text,text[],uuid) from public, anon;
revoke execute on function public.save_brand_contract(uuid,date,date,integer,text,text,uuid) from public, anon;
revoke execute on function public.set_brand_contract_status(uuid,text) from public, anon;
revoke execute on function public.save_milestone_override(text,text) from public, anon;
grant execute on function public.save_brand_workstream(text,text,text,text,text,text[],uuid) to authenticated;
grant execute on function public.save_brand_contract(uuid,date,date,integer,text,text,uuid) to authenticated;
grant execute on function public.set_brand_contract_status(uuid,text) to authenticated;
grant execute on function public.save_milestone_override(text,text) to authenticated;

alter table public.brand_workstreams enable row level security;
alter table public.brand_workstream_sources enable row level security;
alter table public.contract_rounds enable row level security;
alter table public.milestone_overrides enable row level security;

drop policy if exists brand_workstreams_read on public.brand_workstreams;
create policy brand_workstreams_read on public.brand_workstreams for select to authenticated using ((select private.is_active_user()));
drop policy if exists brand_workstreams_admin_write on public.brand_workstreams;
create policy brand_workstreams_admin_write on public.brand_workstreams for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists brand_sources_read on public.brand_workstream_sources;
create policy brand_sources_read on public.brand_workstream_sources for select to authenticated using ((select private.is_active_user()));
drop policy if exists brand_sources_admin_write on public.brand_workstream_sources;
create policy brand_sources_admin_write on public.brand_workstream_sources for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists contract_rounds_read on public.contract_rounds;
create policy contract_rounds_read on public.contract_rounds for select to authenticated using ((select private.is_active_user()));
drop policy if exists contract_rounds_admin_write on public.contract_rounds;
create policy contract_rounds_admin_write on public.contract_rounds for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists milestone_overrides_read on public.milestone_overrides;
create policy milestone_overrides_read on public.milestone_overrides for select to authenticated using ((select private.is_active_user()));
drop policy if exists milestone_overrides_admin_write on public.milestone_overrides;
create policy milestone_overrides_admin_write on public.milestone_overrides for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create or replace function private.queue_contract_notifications()
returns integer language plpgsql security definer set search_path = public as $$
declare
  queued integer;
begin
  with due_contracts as (
    select c.id, c.end_date, c.workstream_id,
      (c.end_date - (timezone('Asia/Bangkok', now()))::date)::integer as days_remaining,
      w.brand_key, w.brand_name, w.name as workstream_name, w.owner_member
    from public.contract_rounds c
    join public.brand_workstreams w on w.id = c.workstream_id and w.active
    where c.status = 'open'
      and (c.end_date - (timezone('Asia/Bangkok', now()))::date) in (45, 30, 14, 0)
  ), assigned_members as (
    select distinct d.id, d.days_remaining, d.end_date, d.brand_name, d.workstream_name, d.owner_member,
      jsonb_array_elements_text(case when jsonb_typeof(role_values.value) = 'array' then role_values.value else jsonb_build_array(role_values.value) end) as member_name
    from due_contracts d
    join public.assignments a on a.brand_key = d.brand_key
    cross join lateral jsonb_each(a.value) as role_values(role_name, value)
  ), recipients as (
    select d.id, d.days_remaining, d.end_date, d.brand_name, d.workstream_name, lower(trim(al.email)) as recipient_email
    from due_contracts d
    join public.access_list al on al.active and lower(trim(al.member_name)) = lower(trim(d.owner_member))
    where d.owner_member is not null
    union
    select m.id, m.days_remaining, m.end_date, m.brand_name, m.workstream_name, lower(trim(al.email))
    from assigned_members m
    join public.access_list al on al.active and lower(trim(al.member_name)) = lower(trim(m.member_name))
  )
  insert into public.notifications (recipient_email, type, contract_id, notification_key, message)
  select recipient_email, 'contract_expiry', id,
    id::text || ':' || days_remaining::text || ':' || recipient_email,
    format('สัญญา %s · %s เหลือ %s วัน (สิ้นสุด %s)', brand_name, workstream_name, days_remaining, end_date)
  from recipients
  where recipient_email is not null
  on conflict (notification_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end $$;

revoke execute on function private.queue_contract_notifications() from public, anon, authenticated;
grant execute on function private.queue_contract_notifications() to service_role;

-- Keep the canonical brand mapping and Brand workstreams in the same atomic
-- rename operation. The original rename_brand function predates the Brand
-- timeline tables and only updated brands/assignments.
create or replace function public.rename_brand(old_name text, new_name text, tab_keys text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  old_key text := regexp_replace(lower(trim(coalesce(old_name, ''))), '\s+', ' ', 'g');
  new_key text := regexp_replace(lower(trim(coalesce(new_name, ''))), '\s+', ' ', 'g');
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  if old_key = '' or new_key = '' or coalesce(array_length(tab_keys, 1), 0) = 0 then
    raise exception 'Invalid brand rename';
  end if;
  if old_key <> new_key and exists (select 1 from public.assignments where brand_key = new_key) then
    raise exception 'The target brand already has an assignment';
  end if;
  if old_key <> new_key and exists (
    select 1
    from public.brand_workstreams source
    join public.brand_workstreams target
      on target.brand_key = new_key and target.name = source.name
    where source.brand_key = old_key
  ) then
    raise exception 'The target brand already has a workstream with the same name';
  end if;
  if old_key <> new_key and exists (select 1 from public.assignments where brand_key = old_key) then
    insert into public.assignments(brand_key, value, updated_by, updated_at)
    select new_key, value, auth.uid(), now() from public.assignments where brand_key = old_key;
    delete from public.assignments where brand_key = old_key;
  end if;
  update public.brands
  set brand_name = trim(new_name), updated_by = auth.uid(), updated_at = now()
  where tab_key = any(tab_keys) and brand_name = old_name;
  update public.brand_workstreams
  set brand_key = new_key, brand_name = trim(new_name)
  where brand_key = old_key;
end $$;

revoke execute on function public.rename_brand(text, text, text[]) from public, anon;
grant execute on function public.rename_brand(text, text, text[]) to authenticated;
