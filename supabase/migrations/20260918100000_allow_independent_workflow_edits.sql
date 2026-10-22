-- Allow notes and priorities on legacy tasks without a Next Action.
create or replace function public.patch_task_workflow(
  p_task_key text,
  p_status public.workflow_status,
  p_has_status boolean,
  p_note text,
  p_has_note boolean,
  p_priority text,
  p_has_priority boolean,
  p_next_action text,
  p_has_next_action boolean,
  p_actor uuid,
  p_expected_note_version bigint,
  p_force_note boolean
)
returns public.task_workflow
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.task_workflow;
  next_status public.workflow_status;
  next_action_value text;
begin
  select * into saved from public.task_workflow where task_key = p_task_key for update;
  if found and p_has_note and not p_force_note and coalesce(p_expected_note_version, -1) <> saved.note_version then
    raise exception 'NOTE_CONFLICT' using errcode = '40001';
  end if;
  next_status := case when p_has_status then p_status else coalesce(saved.status, 'not_started'::public.workflow_status) end;
  next_action_value := trim(case when p_has_next_action then coalesce(p_next_action, '') else coalesce(saved.next_action, '') end);
  if (p_has_status or p_has_next_action) and next_status in ('in_progress', 'waiting_client', 'blocked') and next_action_value = '' then
    raise exception 'NEXT_ACTION_REQUIRED' using errcode = '23514';
  end if;

  insert into public.task_workflow(task_key, status, note, priority, next_action, updated_by, updated_at, note_version)
  values (
    p_task_key,
    next_status,
    case when p_has_note then coalesce(p_note, '') else '' end,
    case when p_has_priority then p_priority else null end,
    next_action_value,
    p_actor, now(), case when p_has_note then 1 else 0 end
  )
  on conflict (task_key) do update set
    status = next_status,
    note = case when p_has_note then excluded.note else task_workflow.note end,
    priority = case when p_has_priority then excluded.priority else task_workflow.priority end,
    next_action = next_action_value,
    note_version = case when p_has_note then task_workflow.note_version + 1 else task_workflow.note_version end,
    updated_by = p_actor,
    updated_at = now()
  returning * into saved;
  return saved;
end $$;

revoke execute on function public.patch_task_workflow(text, public.workflow_status, boolean, text, boolean, text, boolean, text, boolean, uuid, bigint, boolean) from public, anon, authenticated;
grant execute on function public.patch_task_workflow(text, public.workflow_status, boolean, text, boolean, text, boolean, text, boolean, uuid, bigint, boolean) to service_role;
