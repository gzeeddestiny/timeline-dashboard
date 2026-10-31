alter table public.team_members
drop constraint if exists team_members_role_check;

alter table public.team_members
add constraint team_members_role_check
check (role in ('creative', 'graphic_editor', 'ae', 'media', 'pm'));

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
      or role not in ('creative', 'graphic_editor', 'ae', 'media', 'pm')
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

create or replace function public.save_access_with_member(
  p_email text,
  p_access_role text,
  p_member_name text,
  p_team_role text,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(coalesce(p_email, '')));
  normalized_name text := trim(coalesce(p_member_name, ''));
  canonical_name text;
  canonical_role text;
  linked_email text;
  previous_member_name text;
  access_exists boolean;
  saved_access public.access_list;
begin
  if not private.is_admin() then
    raise exception 'Admin access required';
  end if;
  if length(normalized_email) not between 3 and 320
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid email';
  end if;
  if p_access_role not in ('employee', 'manager', 'admin') then
    raise exception 'Invalid access role';
  end if;

  select member_name, true
  into previous_member_name, access_exists
  from public.access_list
  where email = normalized_email;

  if normalized_name = '' then
    if not coalesce(access_exists, false) or nullif(trim(coalesce(previous_member_name, '')), '') is not null then
      raise exception 'Employee name is required';
    end if;
    canonical_name := null;
  else
    if length(normalized_name) > 100 then
      raise exception 'Employee name must be 100 characters or fewer';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('save_access_with_member', 0));

    select name, role
    into canonical_name, canonical_role
    from public.team_members
    where lower(trim(name)) = lower(normalized_name)
    limit 1;

    if canonical_name is null then
      if p_team_role not in ('creative', 'graphic_editor', 'ae', 'media', 'pm') then
        raise exception 'Invalid team role';
      end if;
      canonical_name := normalized_name;
      canonical_role := p_team_role;
      insert into public.team_members(name, role, avatar, updated_by, updated_at)
      values (canonical_name, canonical_role, '', auth.uid(), now());
    end if;

    if coalesce(p_active, true) then
      select email into linked_email
      from public.access_list
      where active
        and email <> normalized_email
        and lower(trim(member_name)) = lower(canonical_name)
      limit 1;
      if linked_email is not null then
        raise exception 'Employee name "%" is already linked to active email %', canonical_name, linked_email;
      end if;
    end if;
  end if;

  insert into public.access_list(email, role, member_name, active, created_by, updated_at)
  values (normalized_email, p_access_role::public.app_role, canonical_name, coalesce(p_active, true), auth.uid(), now())
  on conflict (email) do update set
    role = excluded.role,
    member_name = excluded.member_name,
    active = excluded.active,
    updated_at = now()
  returning * into saved_access;

  return jsonb_build_object(
    'access', to_jsonb(saved_access),
    'member', case when canonical_name is null then null else jsonb_build_object('name', canonical_name, 'role', canonical_role) end
  );
end
$$;

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
  if not p_clear and p_role not in ('creative', 'graphic_editor', 'ae', 'media', 'pm') then
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
revoke execute on function public.save_access_with_member(text, text, text, text, boolean) from public, anon;
grant execute on function public.save_access_with_member(text, text, text, text, boolean) to authenticated;
revoke execute on function public.patch_assignment_role(text, text, jsonb, boolean, uuid) from public, anon, authenticated;
grant execute on function public.patch_assignment_role(text, text, jsonb, boolean, uuid) to service_role;
