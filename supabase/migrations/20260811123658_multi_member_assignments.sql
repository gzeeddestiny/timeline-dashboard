update public.assignments assignment
set value = coalesce((
  select jsonb_object_agg(entry.key, case
    when jsonb_typeof(entry.value) = 'array' then entry.value
    when jsonb_typeof(entry.value) = 'string' then jsonb_build_array(entry.value)
    else '[]'::jsonb
  end)
  from jsonb_each(assignment.value) entry
), '{}'::jsonb);

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
        select 1
        from public.assignments assignment
        cross join lateral jsonb_each(assignment.value) role_members
        cross join lateral jsonb_array_elements_text(
          case when jsonb_typeof(role_members.value) = 'array' then role_members.value else jsonb_build_array(role_members.value) end
        ) assigned_member
        where assigned_member.value = existing.name
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

drop function if exists public.patch_assignment_role(text, text, text, boolean, uuid);

create or replace function public.patch_assignment_role(
  p_brand_key text,
  p_role text,
  p_members jsonb,
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
  clean_members jsonb;
  member_count integer;
  unique_member_count integer;
begin
  if length(trim(coalesce(p_brand_key, ''))) not between 1 and 200 then
    raise exception 'Invalid assignment key';
  end if;
  if not p_clear and p_role not in ('creative', 'ae', 'media', 'pm') then
    raise exception 'Invalid assignment role';
  end if;
  if not p_clear and (p_members is null or jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) > 100) then
    raise exception 'Invalid assignment members';
  end if;
  if not p_clear and exists (select 1 from jsonb_array_elements(p_members) member where jsonb_typeof(member) <> 'string') then
    raise exception 'Invalid assignment member';
  end if;

  select count(*), count(distinct lower(trim(value))), coalesce(jsonb_agg(trim(value) order by ordinality), '[]'::jsonb)
  into member_count, unique_member_count, clean_members
  from jsonb_array_elements_text(case when p_clear then '[]'::jsonb else p_members end) with ordinality as member(value, ordinality);

  if member_count <> unique_member_count or exists (
    select 1 from jsonb_array_elements_text(clean_members) member
    where length(trim(member)) not between 1 and 100
      or not exists (select 1 from public.team_members where name = member)
  ) then
    raise exception 'Unknown or duplicate team member';
  end if;

  insert into public.assignments(brand_key, value, updated_by, updated_at)
  values (
    trim(p_brand_key),
    case when p_clear or member_count = 0 then '{}'::jsonb else jsonb_build_object(p_role, clean_members) end,
    p_actor,
    now()
  )
  on conflict (brand_key) do update set
    value = case
      when p_clear then '{}'::jsonb
      when member_count = 0 then assignments.value - p_role
      else jsonb_set(assignments.value, array[p_role], clean_members, true)
    end,
    updated_by = p_actor,
    updated_at = now()
  returning value into saved;

  return saved;
end
$$;

revoke execute on function public.replace_team_members(jsonb) from public, anon;
grant execute on function public.replace_team_members(jsonb) to authenticated;
revoke execute on function public.patch_assignment_role(text, text, jsonb, boolean, uuid) from public, anon, authenticated;
grant execute on function public.patch_assignment_role(text, text, jsonb, boolean, uuid) to service_role;
