create or replace function public.rename_access_email(p_old_email text, p_new_email text)
returns public.access_list
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_email text := lower(trim(coalesce(p_old_email, '')));
  new_email text := lower(trim(coalesce(p_new_email, '')));
  saved public.access_list;
begin
  if not private.is_admin() then
    raise exception 'Admin access required';
  end if;
  if length(new_email) not between 3 and 320
    or new_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid email';
  end if;
  if old_email = new_email then
    select * into saved from public.access_list where email = old_email;
    if saved.email is null then raise exception 'Access entry not found'; end if;
    return saved;
  end if;
  if exists (select 1 from public.access_list where email = new_email) then
    raise exception 'The new email already has an access entry';
  end if;

  update public.access_list
  set email = new_email, updated_at = now()
  where email = old_email
  returning * into saved;

  if saved.email is null then raise exception 'Access entry not found'; end if;
  return saved;
end
$$;

revoke execute on function public.rename_access_email(text, text) from public, anon;
grant execute on function public.rename_access_email(text, text) to authenticated;
