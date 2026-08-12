do $$
declare
  duplicate_names text;
begin
  select string_agg(member_name, ', ' order by member_name)
  into duplicate_names
  from (
    select min(trim(member_name)) as member_name
    from public.access_list
    where active and nullif(trim(member_name), '') is not null
    group by lower(trim(member_name))
    having count(*) > 1
  ) duplicates;

  if duplicate_names is not null then
    raise exception 'Active employee names are already linked to multiple emails: %', duplicate_names;
  end if;
end
$$;

create unique index if not exists access_list_active_member_name_unique
on public.access_list (lower(trim(member_name)))
where active and nullif(trim(member_name), '') is not null;

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

  -- Existing unlinked accounts are grandfathered so an old admin is never locked out.
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
      if p_team_role not in ('creative', 'ae', 'media', 'pm') then
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

revoke execute on function public.save_access_with_member(text, text, text, text, boolean) from public, anon;
grant execute on function public.save_access_with_member(text, text, text, text, boolean) to authenticated;
