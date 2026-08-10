begin;

alter table public.task_workflow drop constraint if exists task_workflow_priority_check;

update public.task_workflow
set priority = case priority when 'fire' then 'urgent' when 'think' then 'high' else coalesce(priority, 'normal') end;

alter table public.task_workflow
  add constraint task_workflow_priority_check
  check (priority is null or priority in ('normal', 'high', 'urgent'));

commit;
