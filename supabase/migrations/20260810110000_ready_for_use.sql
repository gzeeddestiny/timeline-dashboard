begin;

alter table public.task_workflow add column if not exists note_version bigint not null default 0;

create table if not exists public.sync_stage_tasks (
  run_id uuid not null references public.sync_runs(id) on delete cascade,
  task_key text not null,
  task_id text not null,
  spreadsheet_id text not null,
  sheet_gid bigint not null,
  row_index integer not null,
  client_name text not null,
  month text,
  topic text not null,
  responsibility text not null default '',
  due_date date,
  actual_submit date,
  done boolean not null default false,
  active boolean not null default true,
  removed_at timestamptz,
  source_synced_at timestamptz not null,
  primary key (run_id, task_key)
);

alter table public.sync_stage_tasks enable row level security;
revoke all on table public.sync_stage_tasks from public, anon, authenticated;
grant select, insert, delete on table public.sync_stage_tasks to service_role;

create or replace function public.apply_sync_snapshot(
  p_run_id uuid,
  p_synced_at timestamptz,
  p_sheet_ids text[],
  p_metric_rows jsonb,
  p_issues jsonb,
  p_finished_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  applied integer;
begin
  if not exists (select 1 from public.sync_runs where id = p_run_id and status = 'running') then
    raise exception 'Sync run is not active';
  end if;

  insert into public.tasks_current (
    task_key, task_id, spreadsheet_id, sheet_gid, row_index, client_name, month,
    topic, responsibility, due_date, actual_submit, done, active, removed_at, source_synced_at
  )
  select task_key, task_id, spreadsheet_id, sheet_gid, row_index, client_name, month,
    topic, responsibility, due_date, actual_submit, done, true, null, p_synced_at
  from public.sync_stage_tasks where run_id = p_run_id
  on conflict (task_key) do update set
    task_id = excluded.task_id,
    spreadsheet_id = excluded.spreadsheet_id,
    sheet_gid = excluded.sheet_gid,
    row_index = excluded.row_index,
    client_name = excluded.client_name,
    month = excluded.month,
    topic = excluded.topic,
    responsibility = excluded.responsibility,
    due_date = excluded.due_date,
    actual_submit = excluded.actual_submit,
    done = excluded.done,
    active = true,
    removed_at = null,
    source_synced_at = p_synced_at;

  update public.tasks_current task set active = false, removed_at = p_synced_at
  where task.active
    and task.spreadsheet_id = any(coalesce(p_sheet_ids, array[]::text[]))
    and not exists (
      select 1 from public.sync_stage_tasks staged
      where staged.run_id = p_run_id and staged.task_key = task.task_key
    );

  insert into public.daily_metrics(snapshot_date, dimension, dimension_key, metrics, source_sync_id, updated_at)
  select metric.snapshot_date, metric.dimension, metric.dimension_key, metric.metrics, p_run_id, metric.updated_at
  from jsonb_to_recordset(coalesce(p_metric_rows, '[]'::jsonb)) as metric(
    snapshot_date date, dimension text, dimension_key text, metrics jsonb, updated_at timestamptz
  )
  on conflict (snapshot_date, dimension, dimension_key) do update set
    metrics = excluded.metrics,
    source_sync_id = p_run_id,
    updated_at = excluded.updated_at;

  select count(*) into applied from public.sync_stage_tasks where run_id = p_run_id;
  update public.sync_runs set
    status = 'success', task_count = applied,
    invalid_row_count = (select count(*) from jsonb_array_elements(coalesce(p_issues, '[]'::jsonb)) issue where issue ->> 'type' <> 'skipped_tab'),
    issues = coalesce(p_issues, '[]'::jsonb), error = null, finished_at = p_finished_at
  where id = p_run_id and status = 'running';

  delete from public.sync_stage_tasks where run_id = p_run_id;
  return applied;
end
$$;

revoke execute on function public.apply_sync_snapshot(uuid, timestamptz, text[], jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_sync_snapshot(uuid, timestamptz, text[], jsonb, jsonb, timestamptz) to service_role;

drop function if exists public.patch_task_workflow(text, public.workflow_status, boolean, text, boolean, text, boolean, uuid);
create function public.patch_task_workflow(
  p_task_key text,
  p_status public.workflow_status,
  p_has_status boolean,
  p_note text,
  p_has_note boolean,
  p_priority text,
  p_has_priority boolean,
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
begin
  select * into saved from public.task_workflow where task_key = p_task_key for update;
  if found and p_has_note and not p_force_note and coalesce(p_expected_note_version, -1) <> saved.note_version then
    raise exception 'NOTE_CONFLICT' using errcode = '40001';
  end if;

  insert into public.task_workflow(task_key, status, note, priority, updated_by, updated_at, note_version)
  values (
    p_task_key,
    case when p_has_status then p_status else 'not_started'::public.workflow_status end,
    case when p_has_note then coalesce(p_note, '') else '' end,
    case when p_has_priority then p_priority else null end,
    p_actor, now(), case when p_has_note then 1 else 0 end
  )
  on conflict (task_key) do update set
    status = case when p_has_status then excluded.status else task_workflow.status end,
    note = case when p_has_note then excluded.note else task_workflow.note end,
    priority = case when p_has_priority then excluded.priority else task_workflow.priority end,
    note_version = case when p_has_note then task_workflow.note_version + 1 else task_workflow.note_version end,
    updated_by = p_actor,
    updated_at = now()
  returning * into saved;
  return saved;
end
$$;

revoke execute on function public.patch_task_workflow(text, public.workflow_status, boolean, text, boolean, text, boolean, uuid, bigint, boolean) from public, anon, authenticated;
grant execute on function public.patch_task_workflow(text, public.workflow_status, boolean, text, boolean, text, boolean, uuid, bigint, boolean) to service_role;
revoke insert, update, delete on table public.task_workflow from authenticated;

create or replace function public.finalize_completion(
  p_task_key text,
  p_row_index integer,
  p_done boolean,
  p_actual_submit date,
  p_actor uuid,
  p_actor_email text,
  p_synced_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.tasks_current;
  after_row public.tasks_current;
begin
  select * into before_row from public.tasks_current where task_key = p_task_key and active for update;
  if not found then raise exception 'Task unavailable'; end if;
  update public.tasks_current set
    row_index = p_row_index, done = p_done, actual_submit = p_actual_submit,
    source_synced_at = p_synced_at
  where task_key = p_task_key
  returning * into after_row;
  insert into public.task_events(resource, record_key, event_type, before_value, after_value, actor, actor_email)
  values ('tasks_current', p_task_key, 'update', to_jsonb(before_row), to_jsonb(after_row), p_actor, lower(p_actor_email));
end
$$;

revoke execute on function public.finalize_completion(text, integer, boolean, date, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.finalize_completion(text, integer, boolean, date, uuid, text, timestamptz) to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('team-avatars', 'team-avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists team_avatars_admin_insert on storage.objects;
create policy team_avatars_admin_insert on storage.objects for insert to authenticated
with check (bucket_id = 'team-avatars' and (select private.is_admin()));
drop policy if exists team_avatars_admin_update on storage.objects;
create policy team_avatars_admin_update on storage.objects for update to authenticated
using (bucket_id = 'team-avatars' and (select private.is_admin()))
with check (bucket_id = 'team-avatars' and (select private.is_admin()));
drop policy if exists team_avatars_admin_delete on storage.objects;
create policy team_avatars_admin_delete on storage.objects for delete to authenticated
using (bucket_id = 'team-avatars' and (select private.is_admin()));

drop function if exists private.queue_daily_digest();
drop table if exists public.email_outbox;

commit;
