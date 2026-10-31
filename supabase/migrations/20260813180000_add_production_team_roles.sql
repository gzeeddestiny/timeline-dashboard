alter table public.team_members
drop constraint if exists team_members_role_check;

alter table public.team_members
add constraint team_members_role_check
check (role in (
  'creative', 'graphic_editor', 'cameraman', 'ae',
  'media_planner', 'media', 'ads_optimizer', 'pm'
));

-- These validated RPCs share the same canonical role allowlist. Rebuild their
-- definitions in place so existing privileges, behavior, and data stay intact.
do $migration$
declare
  function_name regprocedure;
  previous_definition text;
  next_definition text;
  old_roles constant text := '(''creative'', ''graphic_editor'', ''ae'', ''media'', ''pm'')';
  new_roles constant text := '(''creative'', ''graphic_editor'', ''cameraman'', ''ae'', ''media_planner'', ''media'', ''ads_optimizer'', ''pm'')';
begin
  foreach function_name in array array[
    'public.replace_team_members(jsonb)'::regprocedure,
    'public.save_access_with_member(text,text,text,text,boolean)'::regprocedure,
    'public.patch_assignment_role(text,text,jsonb,boolean,uuid)'::regprocedure
  ] loop
    select pg_get_functiondef(function_name) into previous_definition;
    next_definition := replace(previous_definition, old_roles, new_roles);
    if next_definition = previous_definition then
      raise exception 'Role allowlist was not found in %', function_name;
    end if;
    execute next_definition;
  end loop;
end
$migration$;
