-- Canonical Brand -> Project model.
--
-- This migration deliberately keeps the existing brand_workstreams and
-- contract_rounds table names so deployed clients can roll forward without a
-- destructive table rename. The application presents workstreams as Projects.

create table if not exists public.brand_catalog (
  id uuid primary key default gen_random_uuid(),
  brand_key text not null unique check (length(brand_key) between 1 and 200),
  brand_name text not null check (length(trim(brand_name)) between 1 and 300),
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

insert into public.brand_catalog (brand_key, brand_name)
select brand_key, min(brand_name)
from (
  select private.normalized_brand_key(brand_name) as brand_key, trim(brand_name) as brand_name
  from public.brands
  where trim(coalesce(brand_name, '')) <> ''
  union all
  select private.normalized_brand_key(brand_name), trim(brand_name)
  from public.brand_workstreams
  where trim(coalesce(brand_name, '')) <> ''
) candidates
where brand_key <> ''
group by brand_key
on conflict (brand_key) do update set brand_name = excluded.brand_name;

alter table public.brands add column if not exists brand_id uuid references public.brand_catalog(id);
alter table public.brand_workstreams add column if not exists brand_id uuid references public.brand_catalog(id);
alter table public.brand_workstreams add column if not exists assignment jsonb not null default '{}'::jsonb;

update public.brands source
set brand_id = catalog.id
from public.brand_catalog catalog
where source.brand_id is null
  and catalog.brand_key = private.normalized_brand_key(source.brand_name);

update public.brand_workstreams project
set brand_id = catalog.id
from public.brand_catalog catalog
where project.brand_id is null
  and catalog.brand_key = project.brand_key;

-- Existing brand-level teams become the starting team for every migrated
-- Project. From this point on the Project assignment is authoritative.
update public.brand_workstreams project
set assignment = legacy.value
from public.assignments legacy
where legacy.brand_key = project.brand_key
  and project.assignment = '{}'::jsonb;

-- Preserve the previous single Workstream owner as a Project team member when
-- that person is not already present in the copied Brand assignment.
update public.brand_workstreams project
set assignment = jsonb_set(
  project.assignment,
  array[member.role],
  coalesce(project.assignment -> member.role, '[]'::jsonb) || to_jsonb(project.owner_member),
  true
)
from public.team_members member
where project.owner_member is not null
  and lower(trim(member.name)) = lower(trim(project.owner_member))
  and not exists (
    select 1
    from jsonb_each(project.assignment) roles(role_name, role_value)
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(roles.role_value) = 'array' then roles.role_value else jsonb_build_array(roles.role_value) end
    ) assigned(value)
    where lower(trim(assigned.value)) = lower(trim(project.owner_member))
  );

alter table public.contract_rounds add column if not exists name text;
with numbered as (
  select id, row_number() over (partition by workstream_id order by start_date, created_at, id) as position
  from public.contract_rounds
  where nullif(trim(name), '') is null
)
update public.contract_rounds contract
set name = 'Contract ' || numbered.position::text
from numbered
where contract.id = numbered.id;
alter table public.contract_rounds alter column name set default 'Contract';
alter table public.contract_rounds alter column name set not null;
alter table public.contract_rounds drop constraint if exists contract_rounds_name_check;
alter table public.contract_rounds add constraint contract_rounds_name_check
  check (length(trim(name)) between 1 and 300);

create index if not exists brands_brand_id_idx on public.brands (brand_id);
create index if not exists brand_workstreams_brand_id_idx on public.brand_workstreams (brand_id);
create index if not exists brand_catalog_active_name_idx on public.brand_catalog (active, brand_name);

create or replace function private.stamp_brand_catalog_actor()
returns trigger language plpgsql set search_path = public as $$
begin
  if TG_OP = 'INSERT' and auth.uid() is not null then new.created_by := auth.uid(); end if;
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists stamp_brand_catalog_actor on public.brand_catalog;
create trigger stamp_brand_catalog_actor before insert or update on public.brand_catalog
for each row execute function private.stamp_brand_catalog_actor();

create or replace function private.prevent_assigned_project_member_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1
    from public.brand_workstreams project
    cross join lateral jsonb_each(project.assignment) roles(role_name, role_value)
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(roles.role_value) = 'array' then roles.role_value else jsonb_build_array(roles.role_value) end
    ) assigned(value)
    where project.active and lower(trim(assigned.value)) = lower(trim(old.name))
  ) then raise exception 'Cannot remove a team member that is still assigned to an active Project'; end if;
  return old;
end $$;

drop trigger if exists protect_project_team_member on public.team_members;
create trigger protect_project_team_member before delete on public.team_members
for each row execute function private.prevent_assigned_project_member_delete();
revoke execute on function private.prevent_assigned_project_member_delete() from public, anon, authenticated;

create or replace function public.save_brand_catalog(p_name text, p_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  target_id uuid := p_id;
  clean_name text := trim(coalesce(p_name, ''));
  normalized_key text := private.normalized_brand_key(p_name);
  old_key text;
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  if clean_name = '' or length(clean_name) > 300 or length(normalized_key) > 200 then
    raise exception 'Invalid brand name';
  end if;

  if target_id is null then
    insert into public.brand_catalog (brand_key, brand_name, created_by)
    values (normalized_key, clean_name, auth.uid())
    returning id into target_id;
  else
    select brand_key into old_key from public.brand_catalog where id = target_id for update;
    if old_key is null then raise exception 'Brand not found'; end if;
    update public.brand_catalog
    set brand_key = normalized_key, brand_name = clean_name, active = true
    where id = target_id;
    update public.brands
    set brand_id = target_id, brand_name = clean_name, updated_by = auth.uid(), updated_at = now()
    where brand_id = target_id or (brand_id is null and private.normalized_brand_key(brand_name) = old_key);
    update public.brand_workstreams
    set brand_id = target_id, brand_key = normalized_key, brand_name = clean_name
    where brand_id = target_id or (brand_id is null and brand_key = old_key);
  end if;
  return target_id;
exception when unique_violation then
  raise exception 'A brand with this name already exists';
end $$;

create or replace function public.set_brand_catalog_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  update public.brand_catalog set active = p_active where id = p_id;
  if not found then raise exception 'Brand not found'; end if;
end $$;

create or replace function public.assign_tabs_to_brand(p_brand_id uuid, p_tab_keys text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  target public.brand_catalog%rowtype;
  source_count integer := coalesce(array_length(p_tab_keys, 1), 0);
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  select * into target from public.brand_catalog where id = p_brand_id and active;
  if target.id is null then raise exception 'Brand not found'; end if;
  if source_count = 0 then raise exception 'At least one source tab is required'; end if;
  if source_count <> (select count(distinct value) from unnest(p_tab_keys) as source(value)) then
    raise exception 'Duplicate source tab';
  end if;
  if exists (
    select 1
    from public.brand_workstream_sources source
    join public.brand_workstreams project on project.id = source.workstream_id
    where source.tab_key = any(p_tab_keys)
      and coalesce(project.brand_id <> target.id, project.brand_key <> target.brand_key)
  ) then raise exception 'A source tab already belongs to a Project under another Brand'; end if;

  insert into public.brands (tab_key, brand_id, brand_name, updated_by, updated_at)
  select value, target.id, target.brand_name, auth.uid(), now()
  from unnest(p_tab_keys) as source(value)
  on conflict (tab_key) do update
  set brand_id = excluded.brand_id,
      brand_name = excluded.brand_name,
      updated_by = auth.uid(),
      updated_at = now();
end $$;

create or replace function public.save_brand_project(
  p_brand_id uuid,
  p_name text,
  p_workstream_type text,
  p_assignment jsonb,
  p_source_tab_keys text[],
  p_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  target_id uuid := p_id;
  brand public.brand_catalog%rowtype;
  source_count integer := coalesce(array_length(p_source_tab_keys, 1), 0);
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  select * into brand from public.brand_catalog where id = p_brand_id and active;
  if brand.id is null then raise exception 'Brand not found'; end if;
  if trim(coalesce(p_name, '')) = '' or length(trim(p_name)) > 300 then raise exception 'Project name is required'; end if;
  if p_workstream_type not in ('always_on', 'production', 'other') then raise exception 'Invalid project type'; end if;
  if jsonb_typeof(coalesce(p_assignment, '{}'::jsonb)) <> 'object' or octet_length(coalesce(p_assignment, '{}'::jsonb)::text) > 10000 then
    raise exception 'Invalid project assignment';
  end if;
  if source_count <> (select count(distinct value) from unnest(coalesce(p_source_tab_keys, '{}'::text[])) as source(value)) then
    raise exception 'Duplicate source tab';
  end if;
  if exists (
    select 1 from public.brand_workstream_sources source
    where source.tab_key = any(coalesce(p_source_tab_keys, '{}'::text[]))
      and (target_id is null or source.workstream_id <> target_id)
  ) then raise exception 'A source tab is already assigned to another Project'; end if;

  if target_id is null then
    insert into public.brand_workstreams (
      brand_id, brand_key, brand_name, name, workstream_type, owner_member, assignment, created_by
    ) values (
      brand.id, brand.brand_key, brand.brand_name, trim(p_name), p_workstream_type, null,
      coalesce(p_assignment, '{}'::jsonb), auth.uid()
    ) returning id into target_id;
  else
    update public.brand_workstreams
    set brand_id = brand.id,
        brand_key = brand.brand_key,
        brand_name = brand.brand_name,
        name = trim(p_name),
        workstream_type = p_workstream_type,
        owner_member = null,
        assignment = coalesce(p_assignment, '{}'::jsonb),
        active = true
    where id = target_id;
    if not found then raise exception 'Project not found'; end if;
  end if;

  delete from public.brand_workstream_sources where workstream_id = target_id;
  insert into public.brand_workstream_sources (workstream_id, tab_key)
  select target_id, value from unnest(coalesce(p_source_tab_keys, '{}'::text[])) as source(value);

  if source_count > 0 then
    insert into public.brands (tab_key, brand_id, brand_name, updated_by, updated_at)
    select value, brand.id, brand.brand_name, auth.uid(), now()
    from unnest(p_source_tab_keys) as source(value)
    on conflict (tab_key) do update
    set brand_id = excluded.brand_id,
        brand_name = excluded.brand_name,
        updated_by = auth.uid(),
        updated_at = now();
  end if;
  return target_id;
exception when unique_violation then
  raise exception 'This Brand already has a Project with the same name, or a source tab is in another Project';
end $$;

create or replace function public.set_brand_project_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  update public.brand_workstreams set active = p_active where id = p_id;
  if not found then raise exception 'Project not found'; end if;
end $$;

create or replace function public.save_brand_project_assignment(p_project_id uuid, p_assignment jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not private.is_active_user() then raise exception 'Active access required'; end if;
  if jsonb_typeof(coalesce(p_assignment, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_assignment, '{}'::jsonb)::text) > 10000
  then raise exception 'Invalid project assignment'; end if;
  update public.brand_workstreams
  set assignment = coalesce(p_assignment, '{}'::jsonb)
  where id = p_project_id and active;
  if not found then raise exception 'Project not found'; end if;
end $$;

create or replace function public.save_brand_project_contract(
  p_project_id uuid,
  p_name text,
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
  project_type text;
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  select workstream_type into project_type from public.brand_workstreams where id = p_project_id and active;
  if project_type is null then raise exception 'Project not found'; end if;
  if trim(coalesce(p_name, '')) = '' or length(trim(p_name)) > 300 then raise exception 'Contract name is required'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then raise exception 'Invalid contract dates'; end if;
  if project_type = 'always_on' and p_term_months not in (3, 6, 9, 12) then
    raise exception 'Always-on contracts require a 3, 6, 9 or 12 month term';
  end if;
  if project_type <> 'always_on' and p_term_months is not null then
    raise exception 'Only Always-on contracts use a fixed term';
  end if;
  if p_document_url is not null and (length(p_document_url) > 2000 or p_document_url !~ '^https://') then
    raise exception 'Document URL must be an https URL';
  end if;

  if target_id is null then
    insert into public.contract_rounds (
      workstream_id, name, start_date, end_date, term_months, notes, document_url, created_by
    ) values (
      p_project_id, trim(p_name), p_start_date, p_end_date, p_term_months,
      left(coalesce(p_notes, ''), 5000), nullif(trim(p_document_url), ''), auth.uid()
    ) returning id into target_id;
  else
    update public.contract_rounds
    set name = trim(p_name),
        start_date = p_start_date,
        end_date = p_end_date,
        term_months = p_term_months,
        notes = left(coalesce(p_notes, ''), 5000),
        document_url = nullif(trim(p_document_url), '')
    where id = target_id and workstream_id = p_project_id;
    if not found then raise exception 'Contract not found'; end if;
  end if;
  return target_id;
end $$;

revoke execute on function public.save_brand_catalog(text,uuid) from public, anon;
revoke execute on function public.set_brand_catalog_active(uuid,boolean) from public, anon;
revoke execute on function public.assign_tabs_to_brand(uuid,text[]) from public, anon;
revoke execute on function public.save_brand_project(uuid,text,text,jsonb,text[],uuid) from public, anon;
revoke execute on function public.set_brand_project_active(uuid,boolean) from public, anon;
revoke execute on function public.save_brand_project_assignment(uuid,jsonb) from public, anon;
revoke execute on function public.save_brand_project_contract(uuid,text,date,date,integer,text,text,uuid) from public, anon;
grant execute on function public.save_brand_catalog(text,uuid) to authenticated;
grant execute on function public.set_brand_catalog_active(uuid,boolean) to authenticated;
grant execute on function public.assign_tabs_to_brand(uuid,text[]) to authenticated;
grant execute on function public.save_brand_project(uuid,text,text,jsonb,text[],uuid) to authenticated;
grant execute on function public.set_brand_project_active(uuid,boolean) to authenticated;
grant execute on function public.save_brand_project_assignment(uuid,jsonb) to authenticated;
grant execute on function public.save_brand_project_contract(uuid,text,date,date,integer,text,text,uuid) to authenticated;

alter table public.brand_catalog enable row level security;
-- Brand and Project history is archive-only. Authenticated clients never get a
-- hard-delete RLS path for these two entities.
drop policy if exists brand_workstreams_admin_delete on public.brand_workstreams;
drop policy if exists brand_catalog_read on public.brand_catalog;
create policy brand_catalog_read on public.brand_catalog for select to authenticated
  using ((select private.is_active_user()));
drop policy if exists brand_catalog_admin_insert on public.brand_catalog;
create policy brand_catalog_admin_insert on public.brand_catalog for insert to authenticated
  with check ((select private.is_admin()));
drop policy if exists brand_catalog_admin_update on public.brand_catalog;
create policy brand_catalog_admin_update on public.brand_catalog for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

grant select on table public.brand_catalog to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_rel
      where prpubid = (select oid from pg_publication where pubname = 'supabase_realtime')
        and prrelid = 'public.brand_catalog'::regclass
    )
  then alter publication supabase_realtime add table public.brand_catalog;
  end if;
end $$;

-- Contract notifications now follow the Project team. Every overlapping open
-- contract is evaluated independently and includes its human-readable name.
create or replace function private.queue_contract_notifications()
returns integer language plpgsql security definer set search_path = public as $$
declare
  queued integer;
begin
  with due_contracts as (
    select c.id, c.name as contract_name, c.end_date,
      (c.end_date - (timezone('Asia/Bangkok', now()))::date)::integer as days_remaining,
      w.brand_name, w.name as project_name, w.assignment
    from public.contract_rounds c
    join public.brand_workstreams w on w.id = c.workstream_id and w.active
    join public.brand_catalog b on b.id = w.brand_id and b.active
    where c.status = 'open'
      and (c.end_date - (timezone('Asia/Bangkok', now()))::date) in (45, 30, 14, 0)
  ), assigned_members as (
    select distinct d.id, d.contract_name, d.days_remaining, d.end_date, d.brand_name, d.project_name,
      jsonb_array_elements_text(
        case when jsonb_typeof(role_values.value) = 'array' then role_values.value else jsonb_build_array(role_values.value) end
      ) as member_name
    from due_contracts d
    cross join lateral jsonb_each(d.assignment) as role_values(role_name, value)
  ), recipients as (
    select m.id, m.contract_name, m.days_remaining, m.end_date, m.brand_name, m.project_name,
      lower(trim(access.email)) as recipient_email
    from assigned_members m
    join public.access_list access on access.active and lower(trim(access.member_name)) = lower(trim(m.member_name))
  )
  insert into public.notifications (recipient_email, type, contract_id, notification_key, message)
  select recipient_email, 'contract_expiry', id,
    id::text || ':' || days_remaining::text || ':' || recipient_email,
    format('สัญญา %s · %s · %s เหลือ %s วัน (สิ้นสุด %s)', brand_name, project_name, contract_name, days_remaining, end_date)
  from recipients
  where recipient_email is not null
  on conflict (notification_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end $$;
