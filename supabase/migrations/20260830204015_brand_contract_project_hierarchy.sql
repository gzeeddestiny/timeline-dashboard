-- Brand -> Contract -> Project hierarchy.
--
-- The physical table names remain unchanged for a rolling deployment. New
-- clients use the Brand-level columns and RPCs below; the Project-level
-- workstream_id on contract_rounds stays nullable for one compatibility cycle.

alter table public.contract_rounds
  add column if not exists brand_id uuid references public.brand_catalog(id) on delete restrict,
  add column if not exists contract_type text,
  add column if not exists renewal_status text;

alter table public.brand_workstreams
  add column if not exists contract_id uuid references public.contract_rounds(id) on delete set null,
  add column if not exists start_date date,
  add column if not exists end_date date;

-- Ensure every legacy Project has its canonical Brand before contracts are
-- lifted from Project scope to Brand scope.
update public.brand_workstreams project
set brand_id = catalog.id
from public.brand_catalog catalog
where project.brand_id is null
  and catalog.brand_key = project.brand_key;

update public.contract_rounds contract
set brand_id = project.brand_id,
    contract_type = case when project.workstream_type = 'always_on' then 'always_on' else 'one_time' end,
    renewal_status = coalesce(contract.renewal_status, 'not_contacted')
from public.brand_workstreams project
where contract.workstream_id = project.id
  and (contract.brand_id is null or contract.contract_type is null or contract.renewal_status is null);

-- A legacy Project could contain several Contract rounds. Preserve every
-- Contract and select the latest open round (then latest end date) as the
-- Project's current Contract link.
update public.brand_workstreams project
set contract_id = (
  select contract.id
  from public.contract_rounds contract
  where contract.workstream_id = project.id
  order by (contract.status = 'open') desc, contract.end_date desc, contract.updated_at desc, contract.id
  limit 1
)
where project.contract_id is null
  and exists (select 1 from public.contract_rounds contract where contract.workstream_id = project.id);

-- Give migrated Projects useful dates when legacy Contract or task dates exist.
with project_dates as (
  select project.id, project.contract_id,
    min(task.due_date) filter (where task.due_date is not null) as first_due,
    max(task.due_date) filter (where task.due_date is not null) as last_due
  from public.brand_workstreams project
  left join public.brand_workstream_sources source on source.workstream_id = project.id
  left join public.tasks_current task
    on source.tab_key = task.spreadsheet_id || ':' || task.sheet_gid::text
   and task.active
  group by project.id, project.contract_id
)
update public.brand_workstreams project
set start_date = coalesce(project.start_date, dates.first_due, contract.start_date),
    end_date = coalesce(project.end_date, dates.last_due, contract.end_date)
from project_dates dates
left join public.contract_rounds contract on contract.id = dates.contract_id
where project.id = dates.id
  and (project.start_date is null or project.end_date is null);

update public.contract_rounds
set contract_type = coalesce(contract_type, 'one_time'),
    renewal_status = coalesce(renewal_status, 'not_contacted');

alter table public.contract_rounds alter column workstream_id drop not null;
alter table public.contract_rounds alter column brand_id set not null;
alter table public.contract_rounds alter column contract_type set default 'one_time';
alter table public.contract_rounds alter column contract_type set not null;
alter table public.contract_rounds alter column renewal_status set default 'not_contacted';
alter table public.contract_rounds alter column renewal_status set not null;

alter table public.contract_rounds drop constraint if exists contract_rounds_contract_type_check;
alter table public.contract_rounds add constraint contract_rounds_contract_type_check
  check (contract_type in ('always_on', 'one_time'));
alter table public.contract_rounds drop constraint if exists contract_rounds_renewal_status_check;
alter table public.contract_rounds add constraint contract_rounds_renewal_status_check
  check (renewal_status in ('not_contacted', 'contacted', 'awaiting_response', 'renewed', 'not_renewing'));
alter table public.brand_workstreams drop constraint if exists brand_workstreams_project_dates_check;
alter table public.brand_workstreams add constraint brand_workstreams_project_dates_check
  check (
    (start_date is null and end_date is null)
    or (start_date is not null and end_date is not null and end_date >= start_date)
  );

create index if not exists contract_rounds_brand_dates_idx
  on public.contract_rounds (brand_id, status, end_date);
create index if not exists brand_workstreams_contract_idx
  on public.brand_workstreams (contract_id) where contract_id is not null;
create index if not exists brand_workstreams_project_end_idx
  on public.brand_workstreams (end_date) where active;

create or replace function public.upsert_brand_contract(
  p_brand_id uuid,
  p_name text,
  p_contract_type text,
  p_start_date date,
  p_end_date date,
  p_term_months integer,
  p_renewal_status text default 'not_contacted',
  p_notes text default '',
  p_document_url text default null,
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid := p_id;
  clean_name text := trim(coalesce(p_name, ''));
  expected_end date;
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  if not exists (select 1 from public.brand_catalog where id = p_brand_id and active) then
    raise exception 'Brand not found';
  end if;
  if clean_name = '' or length(clean_name) > 300 then raise exception 'Contract name is required'; end if;
  if p_contract_type not in ('always_on', 'one_time') then raise exception 'Invalid contract type'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then raise exception 'Invalid contract dates'; end if;
  if p_renewal_status not in ('not_contacted', 'contacted', 'awaiting_response', 'renewed', 'not_renewing') then
    raise exception 'Invalid renewal status';
  end if;
  if p_contract_type = 'always_on' then
    if p_term_months not in (3, 6, 12) then raise exception 'Always-on contracts require a 3, 6 or 12 month term'; end if;
    expected_end := (p_start_date + make_interval(months => p_term_months) - interval '1 day')::date;
    if p_end_date <> expected_end then raise exception 'Always-on end date does not match its term'; end if;
  elsif p_term_months is not null then
    raise exception 'One-time contracts do not use a fixed month term';
  end if;
  if p_document_url is not null and trim(p_document_url) <> ''
    and (length(trim(p_document_url)) > 2000 or trim(p_document_url) !~ '^https://')
  then raise exception 'Document URL must be an https URL'; end if;

  if target_id is null then
    insert into public.contract_rounds (
      workstream_id, brand_id, name, contract_type, start_date, end_date,
      term_months, renewal_status, notes, document_url, created_by
    ) values (
      null, p_brand_id, clean_name, p_contract_type, p_start_date, p_end_date,
      case when p_contract_type = 'always_on' then p_term_months else null end,
      p_renewal_status, left(coalesce(p_notes, ''), 5000), nullif(trim(p_document_url), ''), auth.uid()
    ) returning id into target_id;
  else
    update public.contract_rounds
    set brand_id = p_brand_id,
        name = clean_name,
        contract_type = p_contract_type,
        start_date = p_start_date,
        end_date = p_end_date,
        term_months = case when p_contract_type = 'always_on' then p_term_months else null end,
        renewal_status = p_renewal_status,
        notes = left(coalesce(p_notes, ''), 5000),
        document_url = nullif(trim(p_document_url), '')
    where id = target_id;
    if not found then raise exception 'Contract not found'; end if;
    if exists (
      select 1 from public.brand_workstreams project
      where project.contract_id = target_id
        and project.start_date is not null
        and (project.start_date < p_start_date or project.end_date > p_end_date)
    ) then raise exception 'A linked Project falls outside the Contract dates'; end if;
  end if;
  return target_id;
end $$;

create or replace function public.upsert_brand_project(
  p_brand_id uuid,
  p_contract_id uuid,
  p_name text,
  p_start_date date,
  p_end_date date,
  p_assignment jsonb,
  p_source_tab_key text,
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid := p_id;
  brand public.brand_catalog%rowtype;
  contract public.contract_rounds%rowtype;
  clean_tab_key text := trim(coalesce(p_source_tab_key, ''));
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  select * into brand from public.brand_catalog where id = p_brand_id and active;
  if brand.id is null then raise exception 'Brand not found'; end if;
  if trim(coalesce(p_name, '')) = '' or length(trim(p_name)) > 300 then raise exception 'Project name is required'; end if;
  if clean_tab_key = '' or length(clean_tab_key) > 1000 then raise exception 'One source tab is required'; end if;
  if jsonb_typeof(coalesce(p_assignment, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_assignment, '{}'::jsonb)::text) > 10000
  then raise exception 'Invalid project assignment'; end if;
  if (p_start_date is null) <> (p_end_date is null) or (p_start_date is not null and p_end_date < p_start_date) then
    raise exception 'Project dates must be complete and valid';
  end if;
  if p_contract_id is not null then
    select * into contract from public.contract_rounds where id = p_contract_id and brand_id = brand.id and status <> 'cancelled';
    if contract.id is null then raise exception 'Contract not found for this Brand'; end if;
    if p_start_date is null or p_end_date is null then raise exception 'Linked Projects require start and end dates'; end if;
    if p_start_date < contract.start_date or p_end_date > contract.end_date then
      raise exception 'Project dates must stay inside the Contract dates';
    end if;
  end if;
  if exists (
    select 1 from public.brand_workstream_sources source
    where source.tab_key = clean_tab_key
      and (target_id is null or source.workstream_id <> target_id)
  ) then raise exception 'This source tab is already assigned to another Project'; end if;

  if target_id is null then
    insert into public.brand_workstreams (
      brand_id, brand_key, brand_name, contract_id, name, workstream_type,
      assignment, start_date, end_date, owner_member, created_by
    ) values (
      brand.id, brand.brand_key, brand.brand_name, p_contract_id, trim(p_name), 'other',
      coalesce(p_assignment, '{}'::jsonb), p_start_date, p_end_date, null, auth.uid()
    ) returning id into target_id;
  else
    update public.brand_workstreams
    set brand_id = brand.id,
        brand_key = brand.brand_key,
        brand_name = brand.brand_name,
        contract_id = p_contract_id,
        name = trim(p_name),
        workstream_type = 'other',
        assignment = coalesce(p_assignment, '{}'::jsonb),
        start_date = p_start_date,
        end_date = p_end_date,
        owner_member = null,
        active = true
    where id = target_id;
    if not found then raise exception 'Project not found'; end if;
  end if;

  delete from public.brand_workstream_sources where workstream_id = target_id;
  insert into public.brand_workstream_sources (workstream_id, tab_key) values (target_id, clean_tab_key);
  insert into public.brands (tab_key, brand_id, brand_name, updated_by, updated_at)
  values (clean_tab_key, brand.id, brand.brand_name, auth.uid(), now())
  on conflict (tab_key) do update
  set brand_id = excluded.brand_id,
      brand_name = excluded.brand_name,
      updated_by = auth.uid(),
      updated_at = now();
  return target_id;
exception when unique_violation then
  raise exception 'This Brand already has a Project with the same name, or the source tab is already in another Project';
end $$;

create or replace function public.set_brand_contract_renewal_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'Admin access required'; end if;
  if p_status not in ('not_contacted', 'contacted', 'awaiting_response', 'renewed', 'not_renewing') then
    raise exception 'Invalid renewal status';
  end if;
  update public.contract_rounds set renewal_status = p_status where id = p_id;
  if not found then raise exception 'Contract not found'; end if;
end $$;

revoke execute on function public.upsert_brand_contract(uuid,text,text,date,date,integer,text,text,text,uuid) from public, anon;
revoke execute on function public.upsert_brand_project(uuid,uuid,text,date,date,jsonb,text,uuid) from public, anon;
revoke execute on function public.set_brand_contract_renewal_status(uuid,text) from public, anon;
grant execute on function public.upsert_brand_contract(uuid,text,text,date,date,integer,text,text,text,uuid) to authenticated;
grant execute on function public.upsert_brand_project(uuid,uuid,text,date,date,jsonb,text,uuid) to authenticated;
grant execute on function public.set_brand_contract_renewal_status(uuid,text) to authenticated;

-- Renewal reminders go to every active Admin. Contacted/awaiting contracts keep
-- progressing through the 30/14/7-day reminders; resolved outcomes stop them.
create or replace function private.queue_contract_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  queued integer;
begin
  with due_contracts as (
    select contract.id, contract.name, contract.end_date, brand.brand_name,
      (contract.end_date - (timezone('Asia/Bangkok', now()))::date)::integer as days_remaining
    from public.contract_rounds contract
    join public.brand_catalog brand on brand.id = contract.brand_id and brand.active
    where contract.status = 'open'
      and contract.renewal_status not in ('renewed', 'not_renewing')
      and (contract.end_date - (timezone('Asia/Bangkok', now()))::date) in (30, 14, 7)
  ), recipients as (
    select due.*, access.email as recipient_email
    from due_contracts due
    cross join public.access_list access
    where access.active and access.role = 'admin'
  )
  insert into public.notifications (recipient_email, type, contract_id, notification_key, message)
  select lower(trim(recipient_email)), 'contract_expiry', id,
    id::text || ':renewal:' || days_remaining::text || ':' || lower(trim(recipient_email)),
    format('สัญญา %s · %s เหลือ %s วัน (สิ้นสุด %s)', brand_name, name, days_remaining, end_date)
  from recipients
  on conflict (notification_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end $$;

revoke execute on function private.queue_contract_notifications() from public, anon, authenticated;
grant execute on function private.queue_contract_notifications() to service_role;
