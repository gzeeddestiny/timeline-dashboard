-- Central state writes must be atomic and validated. Browser clients can read
-- team data directly, but all mutations go through this admin-only RPC.
create or replace function public.replace_team_members(members jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_count integer;
  unique_name_count integer;
begin
  if not private.is_admin() then
    raise exception 'Admin access required';
  end if;
  if members is null or jsonb_typeof(members) <> 'array' or jsonb_array_length(members) > 100 then
    raise exception 'Team members must be an array with at most 100 entries';
  end if;

  select count(*), count(distinct lower(trim(name)))
  into member_count, unique_name_count
  from jsonb_to_recordset(members) as member(name text, role text, avatar text);

  if member_count <> unique_name_count then
    raise exception 'Team member names must be unique';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(members) as member(name text, role text, avatar text)
    where length(trim(coalesce(name, ''))) not between 1 and 100
      or role not in ('creative', 'ae', 'media', 'pm')
      or octet_length(coalesce(avatar, '')) > 100000
      or (
        coalesce(avatar, '') <> ''
        and avatar !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$'
        and avatar !~ '^https://'
      )
  ) then
    raise exception 'Invalid team member payload';
  end if;
  if exists (
    select 1
    from public.team_members existing
    where not exists (
      select 1 from jsonb_to_recordset(members) as member(name text)
      where member.name = existing.name
    )
    and (
      exists (select 1 from public.access_list where active and member_name = existing.name)
      or exists (
        select 1 from public.assignments assignment, jsonb_each_text(assignment.value) role_member
        where role_member.value = existing.name
      )
    )
  ) then
    raise exception 'Cannot remove a team member that is still assigned or linked to an active user';
  end if;

  insert into public.team_members(name, role, avatar, updated_by, updated_at)
  select trim(name), role, coalesce(avatar, ''), auth.uid(), now()
  from jsonb_to_recordset(members) as member(name text, role text, avatar text)
  on conflict (name) do update set
    role = excluded.role,
    avatar = excluded.avatar,
    updated_by = auth.uid(),
    updated_at = now();

  delete from public.team_members existing
  where not exists (
    select 1
    from jsonb_to_recordset(members) as member(name text)
    where member.name = existing.name
  );
end
$$;

revoke execute on function public.replace_team_members(jsonb) from public, anon;
grant execute on function public.replace_team_members(jsonb) to authenticated;
revoke insert, update, delete on table public.team_members from authenticated;

-- Patch only the fields supplied by a request. This avoids note, priority and
-- status requests overwriting one another after reading the same old row.
create or replace function public.patch_task_workflow(
  p_task_key text,
  p_status public.workflow_status,
  p_has_status boolean,
  p_note text,
  p_has_note boolean,
  p_priority text,
  p_has_priority boolean,
  p_actor uuid
)
returns public.task_workflow
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved public.task_workflow;
begin
  insert into public.task_workflow(task_key, status, note, priority, updated_by, updated_at)
  values (
    p_task_key,
    case when p_has_status then p_status else 'not_started'::public.workflow_status end,
    case when p_has_note then coalesce(p_note, '') else '' end,
    case when p_has_priority then p_priority else null end,
    p_actor,
    now()
  )
  on conflict (task_key) do update set
    status = case when p_has_status then excluded.status else task_workflow.status end,
    note = case when p_has_note then excluded.note else task_workflow.note end,
    priority = case when p_has_priority then excluded.priority else task_workflow.priority end,
    updated_by = p_actor,
    updated_at = now()
  returning * into saved;
  return saved;
end
$$;

revoke execute on function public.patch_task_workflow(text, public.workflow_status, boolean, text, boolean, text, boolean, uuid)
from public, anon, authenticated;
grant execute on function public.patch_task_workflow(text, public.workflow_status, boolean, text, boolean, text, boolean, uuid)
to service_role;

create or replace function public.patch_assignment_role(
  p_brand_key text,
  p_role text,
  p_member text,
  p_clear boolean,
  p_actor uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved jsonb;
begin
  if length(trim(coalesce(p_brand_key, ''))) not between 1 and 200 then
    raise exception 'Invalid assignment key';
  end if;
  if not p_clear and p_role not in ('creative', 'ae', 'media', 'pm') then
    raise exception 'Invalid assignment role';
  end if;
  if not p_clear and p_member is not null
    and not exists (select 1 from public.team_members where name = p_member) then
    raise exception 'Unknown team member';
  end if;

  insert into public.assignments(brand_key, value, updated_by, updated_at)
  values (
    p_brand_key,
    case when p_clear or p_member is null then '{}'::jsonb else jsonb_build_object(p_role, p_member) end,
    p_actor,
    now()
  )
  on conflict (brand_key) do update set
    value = case
      when p_clear then '{}'::jsonb
      when p_member is null then assignments.value - p_role
      else jsonb_set(assignments.value, array[p_role], to_jsonb(p_member), true)
    end,
    updated_by = p_actor,
    updated_at = now()
  returning value into saved;
  return saved;
end
$$;

revoke execute on function public.patch_assignment_role(text, text, text, boolean, uuid)
from public, anon, authenticated;
grant execute on function public.patch_assignment_role(text, text, text, boolean, uuid)
to service_role;
revoke insert, update, delete on table public.assignments from authenticated;

-- Include every user-managed shared resource in the audit history.
create or replace function private.audit_shared_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_key text;
  actor_id uuid;
  actor_mail text;
begin
  if TG_TABLE_NAME = 'task_workflow' then
    record_key := coalesce(new.task_key, old.task_key);
  elsif TG_TABLE_NAME = 'assignments' then
    record_key := coalesce(new.brand_key, old.brand_key);
  elsif TG_TABLE_NAME = 'brands' then
    record_key := coalesce(new.tab_key, old.tab_key);
  elsif TG_TABLE_NAME = 'sheets' then
    record_key := coalesce(new.spreadsheet_id, old.spreadsheet_id);
    actor_id := coalesce(auth.uid(), new.created_by, old.created_by);
  elsif TG_TABLE_NAME = 'team_members' then
    record_key := coalesce(new.name, old.name);
  else
    raise exception 'Unsupported audit table: %', TG_TABLE_NAME;
  end if;
  if TG_TABLE_NAME <> 'sheets' then
    actor_id := case when TG_OP = 'DELETE' then coalesce(old.updated_by, auth.uid()) else coalesce(new.updated_by, auth.uid()) end;
  end if;
  select email into actor_mail from auth.users where id = actor_id;
  insert into public.task_events(resource, record_key, event_type, before_value, after_value, actor, actor_email)
  values (TG_TABLE_NAME, record_key, lower(TG_OP), to_jsonb(old), to_jsonb(new), actor_id, actor_mail);
  return coalesce(new, old);
end
$$;

drop trigger if exists audit_sheets on public.sheets;
create trigger audit_sheets after insert or update or delete on public.sheets
for each row execute function private.audit_shared_change();

drop trigger if exists audit_team_members on public.team_members;
create trigger audit_team_members after insert or update or delete on public.team_members
for each row execute function private.audit_shared_change();

revoke execute on function private.audit_shared_change() from public, anon, authenticated;

-- Postgres Changes remains a simple invalidation signal; polling is the
-- convergence fallback when a WebSocket is unavailable.
do $$
declare
  target text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach target in array array['public.sheets', 'public.team_members'] loop
      if not exists (
        select 1 from pg_publication_rel
        where prpubid = (select oid from pg_publication where pubname = 'supabase_realtime')
          and prrelid = to_regclass(target)
      ) then
        execute format('alter publication supabase_realtime add table %s', target);
      end if;
    end loop;
  end if;
end
$$;
